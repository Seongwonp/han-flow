import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { HwpxEditHistory } from '../../src/core/editing/history'
import { createEditorSelection, type EditorSelection } from '../../src/core/editing/selection'
import { resolveTableFragmentCommand } from '../../src/core/editing/table_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import type { EditCommand } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { EditingEngine } from '../../src/main/editing_engine'
import {
  createRecoveryJournalHeader,
  decodeRecoveryJournal,
  encodeRecoveryRecord,
  RECOVERY_JOURNAL_LIMITS,
  RecoveryJournalWriter,
  type RecoveryJournalEntry
} from '../../src/main/recovery_journal'
import { createLargeTableHwpx } from '../fixtures/public/create_synthetic_hwpx'

// 큰 표 구조 편집의 복구 기록 한도 회귀. 전에는 commit record가 표 원문 두 벌(약 200 KiB 표에서 약 450 KB)을 담아 64 MiB 한도에
// 약 150번째 편집에서 닿았다. 지금은 변경 조각만 담아 같은 편집(+실행 취소)이 5,000번 넘게 한도 안에 든다.

const sectionPath = 'Contents/section0.xml'

type CommitEntry = Extract<RecoveryJournalEntry, { type: 'commit' }>

function historyOf(engine: EditingEngine): HwpxEditHistory {
  return (engine as unknown as { history: HwpxEditHistory }).history
}

function caret(sourcePackage: HwpxSourcePackage, text: string): EditorSelection {
  const anchor = listHwpxTextAnchors(sourcePackage, sectionPath).find((item) => item.text === text)
  if (!anchor) throw new Error(`${text} 셀이 없습니다.`)
  return createEditorSelection(sectionPath, anchor.textNodeId, 0)
}

/** writer가 한도로 멈추기 전까지 `entries`를 반복해 넣을 수 있는 commit 수(최대 `maxCommits`). */
function commitsBeforeStop(entries: readonly RecoveryJournalEntry[], header: ReturnType<typeof createRecoveryJournalHeader>, maxCommits: number): number {
  let stopped = false
  const writer = new RecoveryJournalWriter(join(tmpdir(), 'han-flow-never-written'), header, {
    limits: RECOVERY_JOURNAL_LIMITS,
    onStopped: () => { stopped = true }
  })
  let commits = 0
  while (commits < maxCommits) {
    for (const entry of entries) {
      // dirty가 아니면 파일은 만들지 않고 크기·개수 한도만 센다.
      writer.append([entry], false)
      if (stopped) return commits
      if (entry.type === 'commit') commits += 1
    }
  }
  return commits
}

describe('큰 표 편집의 복구 기록', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-recovery-table-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('행 추가·실행 취소를 반복한 기록이 한도 안에 훨씬 많이 들고, replay하면 같은 표로 돌아온다', async () => {
    const source = createLargeTableHwpx(directory)
    const original = await HwpxSourcePackage.open(source)
    const { engine } = await EditingEngine.open(source)
    let timestamp = 1
    const request = (selectionBefore: EditorSelection) => ({
      sessionId: 'table',
      transactionId: `t${timestamp}`,
      selectionBefore,
      timestamp: (timestamp += 2_000)
    })
    const middle = caret(original, 'R60C2')
    for (let index = 0; index < 5; index += 1) {
      await engine.insertTableRowAfter(request(middle))
      await engine.undo()
    }
    await engine.insertTableRowAfter(request(middle))
    const current = () => historyOf(engine).package
    await engine.insertTableColumnAfter(request(caret(current(), 'R90C3')))
    await engine.deleteTableRow(request(caret(current(), 'R100C1')))
    // 병합한 표에는 행·열 command를 더 쓸 수 없으므로 마지막에 한다.
    await engine.mergeTableCellRight(request(caret(current(), 'R30C1')))
    const entries = engine.takeJournal()
    expect(entries.map((entry) => entry.type)).toEqual([
      ...Array.from({ length: 5 }, () => ['commit', 'undo']).flat(),
      'commit', 'commit', 'commit', 'commit'
    ])
    const commits = entries.filter((entry): entry is CommitEntry => entry.type === 'commit')
    expect(commits.every((entry) => entry.transaction.commands[0].type === 'patch-table-fragment')).toBe(true)

    // 같은 첫 행 추가를 이전 형식(표 원문 두 벌)으로 기록했을 때와 비교한다.
    const first = commits[0]
    const firstCommand = first.transaction.commands[0] as Extract<EditCommand, { type: 'patch-table-fragment' }>
    const { expectedFragment, replacementFragment } = resolveTableFragmentCommand(original, firstCommand)
    expect(Buffer.byteLength(expectedFragment)).toBeGreaterThan(190 * 1024)
    const legacyFirst: CommitEntry = {
      ...first,
      transaction: {
        ...first.transaction,
        commands: [{
          type: 'replace-table-fragment',
          sectionPath,
          textNodeId: firstCommand.textNodeId,
          expectedFragment,
          replacementFragment
        }]
      }
    }
    const patchRecordBytes = encodeRecoveryRecord(first).byteLength
    const legacyRecordBytes = encodeRecoveryRecord(legacyFirst).byteLength
    expect(patchRecordBytes * 20).toBeLessThan(legacyRecordBytes)

    const header = createRecoveryJournalHeader(source, { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }, 'test')
    const undo = entries[1]
    const legacyCapacity = commitsBeforeStop([legacyFirst, undo], header, 100_000)
    const patchCapacity = commitsBeforeStop([first, undo], header, 100_000)
    if (process.env.HAN_FLOW_RECORD_SIZE_SUMMARY === '1') {
      console.log(`HAN_FLOW_JOURNAL_TABLE ${JSON.stringify({ legacyRecordBytes, patchRecordBytes, legacyCapacity, patchCapacity })}`)
    }
    expect(legacyCapacity).toBeLessThan(160)
    expect(patchCapacity).toBeGreaterThan(5_000)

    // 기록 파일 bytes로 되읽어 새 엔진에서 replay하면 live 편집과 같은 section bytes·revision이다.
    const bytes = Buffer.concat([encodeRecoveryRecord(header), ...entries.map(encodeRecoveryRecord)])
    const decoded = decodeRecoveryJournal(bytes)
    expect(decoded.header.version).toBe(2)
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(replayed.status()).toMatchObject({ revision: engine.status().revision, isDirty: true })
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(historyOf(engine).package.readEntry(sectionPath))).toBe(true)
    // 복구한 history로 실행 취소를 끝까지 하면 원본 bytes다.
    while (replayed.status().canUndo) await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
  }, 180_000)

  test('version 1 기록의 표 원문 command도 그대로 replay한다', async () => {
    const source = createLargeTableHwpx(directory, { rows: 6, columns: 3, fileName: 'legacy.hwpx' })
    const original = await HwpxSourcePackage.open(source)
    const { engine } = await EditingEngine.open(source)
    await engine.insertTableRowAfter({ sessionId: 'v1', transactionId: 'row', selectionBefore: caret(original, 'R2C2'), timestamp: 1 })
    const [entry] = engine.takeJournal() as CommitEntry[]
    const command = entry.transaction.commands[0] as Extract<EditCommand, { type: 'patch-table-fragment' }>
    const legacy: CommitEntry = {
      ...entry,
      transaction: {
        ...entry.transaction,
        commands: [{
          type: 'replace-table-fragment',
          sectionPath,
          textNodeId: command.textNodeId,
          ...resolveTableFragmentCommand(original, command)
        }]
      }
    }
    const header = { ...createRecoveryJournalHeader(source, { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }, '0.9.0'), version: 1 }
    const decoded = decodeRecoveryJournal(Buffer.concat([encodeRecoveryRecord(header), encodeRecoveryRecord(legacy)]))
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(historyOf(engine).package.readEntry(sectionPath))).toBe(true)
    await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
  }, 60_000)
})
