import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  EditingCommitRequest,
  EditingHistoryStatus,
  EditingParagraphStyleRequest,
  EditingSplitParagraphRequest
} from '../../src/core/editing/editing_contract'
import { listHwpxTextAnchors, type HwpxTextAnchor } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { EditingEngine } from '../../src/main/editing_engine'
import {
  EditingSessionLostEvent,
  EditingSessionManager,
  RecoverySourceChangedError
} from '../../src/main/editing_session'
import {
  decodeRecoveryJournal,
  readRecoveryJournal,
  RECOVERY_JOURNAL_FILE,
  scanRecoveryJournals,
  verifyRecoverySource
} from '../../src/main/recovery_journal'
import { createListMarkerHwpx } from '../fixtures/public/create_synthetic_hwpx'
import { projectedSessionManager, ProjectedEditingSessionManager } from './projected_session_manager'
import { writeEditingWorkerShim } from './ts_worker_shim'

const sectionPath = 'Contents/section0.xml'

/** ZIP local·central header의 DOS 수정 시각만 0으로 바꾼다(editing_worker_limits.test.ts와 같은 비교). */
function withoutZipTimestamps(buffer: Buffer): Buffer {
  const bytes = Buffer.from(buffer)
  let eocd = bytes.length - 22
  while (eocd >= 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1
  let offset = bytes.readUInt32LE(eocd + 16)
  for (let index = 0; index < bytes.readUInt16LE(eocd + 10); index += 1) {
    bytes.writeUInt32LE(0, offset + 12)
    const local = bytes.readUInt32LE(offset + 42)
    bytes.writeUInt32LE(0, local + 10)
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
  return bytes
}

function caret(anchor: HwpxTextAnchor, offset: number) {
  return {
    sectionPath: anchor.sectionPath,
    anchorTextNodeId: anchor.textNodeId,
    anchorOffset: offset,
    focusTextNodeId: anchor.textNodeId,
    focusOffset: offset
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났습니다.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

type Step =
  | { kind: 'commit'; request: (sessionId: string) => EditingCommitRequest }
  | { kind: 'paragraphStyle'; request: (sessionId: string) => EditingParagraphStyleRequest }
  | { kind: 'split'; request: (sessionId: string) => EditingSplitParagraphRequest }
  | { kind: 'undo' | 'redo' }
  | { kind: 'save'; destination: string }

describe('편집 복구 기록(실제 편집 worker)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-recovery-worker-'))
  const workerPath = writeEditingWorkerShim(directory, { name: 'editing-worker-recovery' })
  const managers: EditingSessionManager[] = []
  afterAll(async () => {
    await Promise.all(managers.map((created) => created.dispose()))
    rmSync(directory, { recursive: true, force: true })
  })

  const manager = (recoveryDirectory: string, lost: EditingSessionLostEvent[] = []) => {
    const created = new EditingSessionManager(undefined, {
      workerPath,
      recovery: { directory: recoveryDirectory, appVersion: 'test', onSessionLost: (event) => lost.push(event) }
    })
    managers.push(created)
    return { raw: created, editing: projectedSessionManager(created) }
  }

  /** 문서 하나에 text·문단 style·문단 나누기·저장 지점·실행 취소·다시 실행을 섞어 적용한다. */
  const steps = (anchor: HwpxTextAnchor, saveDestination: string): Step[] => {
    const typing = (id: string, offset: number, insert: string, timestamp: number) => (sessionId: string): EditingCommitRequest => ({
      sessionId,
      transactionId: id,
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: offset,
      to: offset,
      insert,
      selectionBefore: caret(anchor, offset),
      selectionAfter: caret(anchor, offset + insert.length),
      inputType: 'insertText',
      timestamp
    })
    return [
      { kind: 'commit', request: typing('k1', 1, '복', 1) },
      // 1초 안의 연속 입력은 history에서 하나로 묶인다. replay도 같은 timestamp로 같은 묶음을 만들어야 한다.
      { kind: 'commit', request: typing('k2', 2, '구', 2) },
      { kind: 'save', destination: saveDestination },
      { kind: 'commit', request: typing('k3', 3, '검증', 5_000) },
      {
        kind: 'paragraphStyle',
        request: (sessionId) => ({
          sessionId,
          transactionId: 'align',
          sectionPath: anchor.sectionPath,
          textNodeId: anchor.textNodeId,
          selection: caret(anchor, 1),
          align: 'CENTER',
          timestamp: 9_000
        })
      },
      {
        kind: 'split',
        request: (sessionId) => ({
          sessionId,
          transactionId: 'split',
          selectionBefore: caret(anchor, 2),
          timestamp: 12_000
        })
      },
      { kind: 'undo' },
      { kind: 'undo' },
      { kind: 'redo' },
      { kind: 'commit', request: typing('k4', 0, '앞', 20_000) },
      { kind: 'undo' }
    ]
  }

  async function runLive(
    editing: ProjectedEditingSessionManager,
    senderId: number,
    sessionId: string,
    step: Step
  ) {
    switch (step.kind) {
      case 'commit': return editing.commit(senderId, step.request(sessionId))
      case 'paragraphStyle': return editing.applyParagraphStyle(senderId, step.request(sessionId))
      case 'split': return editing.splitParagraph(senderId, step.request(sessionId))
      case 'undo': return editing.undo(senderId, sessionId)
      case 'redo': return editing.redo(senderId, sessionId)
      case 'save': return editing.saveAs(senderId, sessionId, step.destination)
    }
  }

  async function runInProcess(engine: EditingEngine, step: Step): Promise<void> {
    switch (step.kind) {
      case 'commit': await engine.commit(step.request('in-process')); return
      case 'paragraphStyle': await engine.applyParagraphStyle(step.request('in-process')); return
      case 'split': await engine.splitParagraph(step.request('in-process')); return
      case 'undo': await engine.undo(); return
      case 'redo': await engine.redo(); return
      case 'save': await engine.saveAs({ destinationPath: `${step.destination}.in-process.hwpx`, overwrite: false, protectedPaths: [] })
    }
  }

  /** 편집 뒤 worker를 강제 종료한다. 기록 폴더·지난 live 결과·같은 단계를 거친 in-process 엔진을 돌려준다. */
  async function editThenKill(name: string, senderId: number) {
    const source = join(directory, `${name}.hwpx`)
    copyFileSync(createListMarkerHwpx(directory, `${name}-generated.hwpx`), source)
    const recoveryDirectory = join(directory, `${name}-recovery`)
    const lost: EditingSessionLostEvent[] = []
    const { raw, editing } = manager(recoveryDirectory, lost)
    const anchor = listHwpxTextAnchors(await HwpxSourcePackage.open(source), sectionPath).find((candidate) => candidate.text === '글머리표 첫 항목')!
    const started = await editing.start(senderId, source)
    const plan = steps(anchor, join(directory, `${name}-saved.hwpx`))
    const expected = (await EditingEngine.open(source)).engine
    let last: unknown = started
    for (const step of plan) {
      const result = await runLive(editing, senderId, started.sessionId, step)
      if (step.kind !== 'save') last = result
      await runInProcess(expected, step)
      // 저장 직후에는 dirty가 아니므로 기록 파일이 없다.
      if (step.kind === 'save') {
        await raw.flushJournal(senderId)
        expect(existsSync(join(recoveryDirectory, started.sessionId))).toBe(false)
      }
    }
    await raw.flushJournal(senderId)
    const liveStatus = raw.isDirty(senderId) ? { ...(last as EditingHistoryStatus) } : undefined
    expect(liveStatus).toBeDefined()
    expect(expected.status()).toMatchObject({
      revision: (last as EditingHistoryStatus).revision,
      savedRevision: (last as EditingHistoryStatus).savedRevision,
      canUndo: (last as EditingHistoryStatus).canUndo,
      canRedo: (last as EditingHistoryStatus).canRedo,
      isDirty: true
    })

    // 응답을 기다리지 않는 강제 종료(worker 중단). main의 기록은 남고 복구 제안 event가 온다.
    const session = (raw as unknown as { sessions: Map<number, { engine: { worker: { terminate(): Promise<number> } } }> })
      .sessions.get(senderId)!
    await session.engine.worker.terminate()
    await waitFor(() => lost.length === 1)
    expect(lost[0]).toMatchObject({ senderId, journalId: started.sessionId, sourcePath: source })
    expect(lost[0].reason).toMatchObject({ code: 'EDITING_ENGINE_CRASHED' })
    expect(raw.currentSessionId(senderId)).toBeUndefined()
    return { source, recoveryDirectory, journalId: started.sessionId, last: last as EditingHistoryStatus & { document: unknown }, expected }
  }

  test('편집·실행 취소·다시 실행·저장 지점 뒤 worker를 강제 종료해도 같은 package·revision·저장 지점으로 복구하고, 저장하면 기록을 지운다', async () => {
    const { source, recoveryDirectory, journalId, last, expected } = await editThenKill('crash', 1)
    const journalPath = join(recoveryDirectory, journalId, RECOVERY_JOURNAL_FILE)
    if (process.platform !== 'win32') expect(statSync(journalPath).mode & 0o777).toBe(0o600)
    const decoded = decodeRecoveryJournal(readFileSync(journalPath))
    expect(decoded.tornTail).toBe(false)
    expect(decoded.entries.map((entry) => entry.type)).toEqual([
      'commit', 'commit', 'saved', 'commit', 'commit', 'commit', 'undo', 'undo', 'redo', 'commit', 'undo'
    ])
    // 문서 bytes는 기록하지 않는다(입력 글자·command만).
    expect(readFileSync(journalPath).includes(readFileSync(source).subarray(0, 64))).toBe(false)

    // 앱을 다시 띄운 것처럼 새 manager가 남은 기록을 찾아 복구한다.
    const scan = await scanRecoveryJournals(recoveryDirectory)
    expect(scan.candidates.map((candidate) => candidate.sessionId)).toEqual([journalId])
    expect(scan.candidates[0].editCount).toBe(6)
    expect(await verifyRecoverySource(scan.candidates[0].header)).toBe('match')
    const { raw, editing } = manager(recoveryDirectory)
    const recovered = await editing.recover(11, journalId)
    expect(recovered).toMatchObject({
      revision: last.revision,
      savedRevision: last.savedRevision,
      canUndo: last.canUndo,
      canRedo: last.canRedo,
      isDirty: true,
      recoveredEntries: 11,
      recoveredEdits: 6
    })
    expect(recovered.document).toEqual(last.document)
    // 옛 기록은 지우고 새 session 기록으로 옮겼다.
    expect(existsSync(join(recoveryDirectory, journalId))).toBe(false)
    expect(decodeRecoveryJournal(readFileSync(join(recoveryDirectory, recovered.sessionId, RECOVERY_JOURNAL_FILE))).entries)
      .toHaveLength(11)

    // 복구한 history로 실행 취소·다시 실행도 같다.
    const redone = await editing.redo(11, recovered.sessionId)
    await expected.redo()
    expect(redone).toMatchObject({ revision: expected.status().revision, canRedo: false })
    const destination = join(directory, 'recovered.hwpx')
    await editing.saveAs(11, recovered.sessionId, destination)
    const expectedPath = join(directory, 'expected.hwpx')
    await expected.saveAs({ destinationPath: expectedPath, overwrite: false, protectedPaths: [] })
    const recoveredBytes = readFileSync(destination)
    const expectedBytes = readFileSync(expectedPath)
    expect(recoveredBytes.length).toBe(expectedBytes.length)
    expect(withoutZipTimestamps(recoveredBytes).equals(withoutZipTimestamps(expectedBytes))).toBe(true)

    // 저장(Save As) 뒤에는 dirty가 아니므로 기록이 남지 않는다. 정상 종료해도 남지 않는다.
    await raw.flushJournal(11)
    expect(readdirSync(recoveryDirectory)).toEqual([])
    raw.stop(11)
    expect((await scanRecoveryJournals(recoveryDirectory)).candidates).toEqual([])
  }, 90_000)

  test('원본이 바뀌었으면 복구를 거절하고 기록을 보관한다', async () => {
    const { source, recoveryDirectory, journalId } = await editThenKill('changed', 2)
    const later = new Date(Date.now() + 60_000)
    utimesSync(source, later, later)
    const candidate = (await readRecoveryJournal(recoveryDirectory, journalId))!
    expect(await verifyRecoverySource(candidate.header)).toBe('changed')
    const { editing } = manager(recoveryDirectory)
    await expect(editing.recover(21, journalId)).rejects.toBeInstanceOf(RecoverySourceChangedError)
    expect(existsSync(join(recoveryDirectory, journalId, RECOVERY_JOURNAL_FILE))).toBe(true)
    expect(editing.currentSessionId(21)).toBeUndefined()

    rmSync(source)
    expect(await verifyRecoverySource(candidate.header)).toBe('missing')
  }, 90_000)

  test('기록 끝이 쓰다 끊겼으면 완전한 record까지 모두 복구한다', async () => {
    const { recoveryDirectory, journalId } = await editThenKill('torn', 3)
    const journalPath = join(recoveryDirectory, journalId, RECOVERY_JOURNAL_FILE)
    const complete = decodeRecoveryJournal(readFileSync(journalPath)).entries
    truncateSync(journalPath, statSync(journalPath).size - 5)
    const candidate = (await readRecoveryJournal(recoveryDirectory, journalId))!
    expect(candidate.tornTail).toBe(true)
    expect(candidate.entries).toEqual(complete.slice(0, -1))
    const { editing } = manager(recoveryDirectory)
    const recovered = await editing.recover(31, journalId)
    // 마지막 실행 취소 record가 잘렸으므로 그 직전(k4 입력 뒤) 상태다.
    expect(recovered).toMatchObject({
      revision: complete.at(-2)!.revision,
      isDirty: true,
      canRedo: false,
      recoveredEntries: complete.length - 1
    })
    expect(JSON.stringify(recovered.document)).toContain('앞')
  }, 90_000)

  test('replay가 실패하는 기록은 실행을 멈추고 격리한다', async () => {
    const { recoveryDirectory, journalId } = await editThenKill('poison', 4)
    const journalPath = join(recoveryDirectory, journalId, RECOVERY_JOURNAL_FILE)
    // 구조는 맞지만 문서에 없는 위치를 가리키는 기록(다른 문서용 기록 등)
    const text = readFileSync(journalPath, 'utf8').split('\n')
    const { encodeRecoveryRecord } = await import('../../src/main/recovery_journal')
    const decoded = decodeRecoveryJournal(readFileSync(journalPath))
    const first = decoded.entries[0] as Extract<typeof decoded.entries[number], { type: 'commit' }>
    const poisoned = {
      ...first,
      transaction: {
        ...first.transaction,
        commands: [{ ...first.transaction.commands[0], textNodeId: `${sectionPath}#hp:t:9999` }]
      }
    }
    const rewritten = Buffer.concat([
      Buffer.from(`${text[0]}\n`),
      encodeRecoveryRecord(poisoned),
      ...decoded.entries.slice(1).map(encodeRecoveryRecord)
    ])
    require('fs').writeFileSync(journalPath, rewritten)
    const { editing } = manager(recoveryDirectory)
    const failure = await editing.recover(41, journalId).catch((reason: unknown) => reason)
    expect(failure).toMatchObject({ code: 'EDITING_RECOVERY_FAILED', quarantinePath: expect.stringContaining('quarantine-') })
    expect(failure).not.toBeInstanceOf(RecoverySourceChangedError)
    expect(existsSync(join(recoveryDirectory, journalId))).toBe(false)
    expect(existsSync((failure as { quarantinePath: string }).quarantinePath)).toBe(true)
    expect((await scanRecoveryJournals(recoveryDirectory)).candidates).toEqual([])
    expect(editing.currentSessionId(41)).toBeUndefined()
  }, 90_000)
})
