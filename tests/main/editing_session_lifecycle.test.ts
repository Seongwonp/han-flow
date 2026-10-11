import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EditingCommitRequest } from '../../src/core/editing/editing_contract'
import { planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { HwpxTextAnchor, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import type { EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import {
  EditingJournalStoppedEvent,
  EditingSessionManager,
  EditingSessionManagerOptions
} from '../../src/main/editing_session'
import {
  createRecoveryJournalHeader,
  encodeRecoveryRecord,
  fingerprintFile,
  RECOVERY_JOURNAL_FILE,
  RECOVERY_JOURNAL_LIMITS,
  recoveryJournalPath,
  scanRecoveryJournals
} from '../../src/main/recovery_journal'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'
import { writeEditingWorkerShim } from './ts_worker_shim'

const sectionPath = 'Contents/section0.xml'

/* 테스트 전용 worker preamble. 실제 editing_worker.ts를 불러오기 전에 엔진·fs를 monkeypatch한다. */
const SLOW_START = `
const engineModule = requireSource('main/editing_engine')
const open = engineModule.EditingEngine.open
engineModule.EditingEngine.open = async (filePath) => { await new Promise((r) => setTimeout(r, 1500)); return open(filePath) }
`
const SLOW_REPLAY = `
const engineModule = requireSource('main/editing_engine')
const replay = engineModule.EditingEngine.prototype.replay
engineModule.EditingEngine.prototype.replay = async function (entries) {
  await new Promise((r) => setTimeout(r, 1500))
  return replay.call(this, entries)
}
`
// 게시(hard link) 직후 임시 이름 unlink에서 멈춘다(느린 네트워크 공유·폴더 동기화 지연을 흉내).
const STALL_AFTER_PUBLISH = `
const fsp = require('fs/promises')
const unlink = fsp.unlink
fsp.unlink = (path, ...rest) => {
  if (String(path).includes('after-publish') && String(path).endsWith('.tmp')) for (;;) {}
  return unlink(path, ...rest)
}
`

function caret(anchor: HwpxTextAnchor, offset: number) {
  return {
    sectionPath: anchor.sectionPath,
    anchorTextNodeId: anchor.textNodeId,
    anchorOffset: offset,
    focusTextNodeId: anchor.textNodeId,
    focusOffset: offset
  }
}

function typing(sessionId: string, anchor: HwpxTextAnchor, id: string, offset: number, insert: string, timestamp: number): EditingCommitRequest {
  return {
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
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났습니다.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const journalNames = (recoveryDirectory: string): string[] =>
  existsSync(recoveryDirectory) ? readdirSync(recoveryDirectory) : []

describe('편집 session 수명(창 닫기·앱 종료·복구 경쟁)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-lifecycle-'))
  const workerPath = writeEditingWorkerShim(directory, { name: 'lifecycle-worker' })
  const slowStartWorker = writeEditingWorkerShim(directory, { name: 'lifecycle-slow-start', preamble: SLOW_START })
  const slowReplayWorker = writeEditingWorkerShim(directory, { name: 'lifecycle-slow-replay', preamble: SLOW_REPLAY })
  const afterPublishWorker = writeEditingWorkerShim(directory, { name: 'lifecycle-after-publish', preamble: STALL_AFTER_PUBLISH })
  const managers: EditingSessionManager[] = []
  const manager = (options: EditingSessionManagerOptions = {}): EditingSessionManager => {
    const created = new EditingSessionManager(undefined, { workerPath, ...options })
    managers.push(created)
    return created
  }
  const recoveryOptions = (recoveryDirectory: string, extra: Partial<NonNullable<EditingSessionManagerOptions['recovery']>> = {}) => ({
    recovery: { directory: recoveryDirectory, appVersion: 'test', ...extra }
  })
  let counter = 0
  const source = () => createSyntheticHwpx(directory, { fileName: `lifecycle-${counter += 1}.hwpx` })
  const firstAnchor = async (path: string): Promise<HwpxTextAnchor> =>
    listHwpxTextAnchors(await HwpxSourcePackage.open(path), sectionPath).find((anchor) => anchor.text.length > 0)!

  afterAll(async () => {
    await Promise.all(managers.map((created) => created.dispose()))
    rmSync(directory, { recursive: true, force: true })
  })

  /** 편집 하나를 남긴 기록을 만든다(앱이 강제 종료된 것처럼 기록을 지우지 않고 worker만 끝낸다). */
  async function leftoverJournal(recoveryDirectory: string): Promise<{ file: string; journalId: string }> {
    const file = source()
    const anchor = await firstAnchor(file)
    const editing = manager(recoveryOptions(recoveryDirectory))
    const started = await editing.start(1, file)
    await editing.commit(1, typing(started.sessionId, anchor, 'left', 0, '남김', 1))
    await editing.flushJournal(1)
    await editing.dispose()
    expect(existsSync(recoveryJournalPath(recoveryDirectory, started.sessionId))).toBe(true)
    return { file, journalId: started.sessionId }
  }

  test('[저장하지 않음]으로 닫을 때 stop은 복구 기록 삭제까지 끝낸 뒤 resolve한다', async () => {
    const recoveryDirectory = join(directory, 'discard-recovery')
    const file = source()
    const anchor = await firstAnchor(file)
    const editing = manager(recoveryOptions(recoveryDirectory))
    const started = await editing.start(1, file)
    await editing.commit(1, typing(started.sessionId, anchor, 'dirty', 0, '버림', 1))
    await editing.flushJournal(1)
    expect(journalNames(recoveryDirectory)).toEqual([started.sessionId])
    // 창을 닫기 전에 기다리는 Promise. resolve한 순간 기록이 없어야 앱이 끝나도 다음 실행에서 묻지 않는다.
    await editing.stop(1)
    expect(journalNames(recoveryDirectory)).toEqual([])
    expect(editing.runningWorkerCount).toBe(0)

    // 기다리지 않은 stop(창 destroyed)도 앱 종료 전 whenStopped로 기다릴 수 있다.
    const second = await editing.start(2, file)
    await editing.commit(2, typing(second.sessionId, anchor, 'dirty-2', 0, '또', 1))
    await editing.flushJournal(2)
    expect(journalNames(recoveryDirectory)).toEqual([second.sessionId])
    void editing.stop(2)
    await editing.whenStopped()
    expect(journalNames(recoveryDirectory)).toEqual([])
    expect((await scanRecoveryJournals(recoveryDirectory)).candidates).toEqual([])
  }, 60_000)

  test('편집 준비 중 창이 닫히면 준비가 끝난 뒤 worker를 끝내고 session을 만들지 않는다', async () => {
    const recoveryDirectory = join(directory, 'start-race-recovery')
    const editing = manager({ workerPath: slowStartWorker, ...recoveryOptions(recoveryDirectory) })
    const started = editing.start(7, source())
    await new Promise((resolve) => setTimeout(resolve, 200))
    await editing.stop(7) // 창 destroyed 처리와 같은 호출
    await expect(started).rejects.toMatchObject({ code: 'EDITING_SESSION_EXPIRED' })
    expect(editing.currentSessionId(7)).toBeUndefined()
    expect(editing.protectedSourcePaths()).toEqual([])
    await waitFor(() => editing.runningWorkerCount === 0)
    expect(journalNames(recoveryDirectory)).toEqual([])

    // 같은 창(sender)에서 다시 시작하면 정상으로 연다.
    const again = await editing.start(7, source())
    expect(editing.currentSessionId(7)).toBe(again.sessionId)
  }, 60_000)

  test('복구 중 창이 닫히면 새 worker를 끝내고 옛 기록은 그대로 둔다', async () => {
    const recoveryDirectory = join(directory, 'recover-race-recovery')
    const { journalId } = await leftoverJournal(recoveryDirectory)
    const editing = manager({ workerPath: slowReplayWorker, ...recoveryOptions(recoveryDirectory) })
    const recovering = editing.recover(9, journalId)
    await waitFor(() => editing.activeJournalIds().has(journalId))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await editing.stop(9)
    await expect(recovering).rejects.toMatchObject({ code: 'EDITING_SESSION_EXPIRED' })
    expect(editing.currentSessionId(9)).toBeUndefined()
    await waitFor(() => editing.runningWorkerCount === 0)
    // 격리하지 않고 다음에 다시 복구할 수 있게 남긴다.
    expect(journalNames(recoveryDirectory)).toEqual([journalId])
    expect(editing.activeJournalIds().has(journalId)).toBe(false)
    expect((await scanRecoveryJournals(recoveryDirectory)).candidates.map((candidate) => candidate.sessionId)).toEqual([journalId])
  }, 60_000)

  test('두 창이 같은 기록을 동시에 복구하면 한 창만 복구하고, 복구 중인 기록은 사용 중으로 본다', async () => {
    const recoveryDirectory = join(directory, 'concurrent-recovery')
    const { journalId } = await leftoverJournal(recoveryDirectory)
    const editing = manager({ workerPath: slowReplayWorker, ...recoveryOptions(recoveryDirectory) })
    const settled = Promise.allSettled([editing.recover(1, journalId), editing.recover(2, journalId)])
    await waitFor(() => editing.activeJournalIds().has(journalId))
    // 복구 중인 기록은 남은 기록 목록·제안에서 뺀다.
    expect((await scanRecoveryJournals(recoveryDirectory, editing.activeJournalIds())).candidates).toEqual([])
    const results = await settled
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')!
    expect(rejected.reason).toMatchObject({ code: 'EDITING_INVALID_REQUEST' })
    const winner = results[0].status === 'fulfilled' ? 1 : 2
    expect(editing.currentSessionId(winner)).toBeDefined()
    expect(editing.currentSessionId(winner === 1 ? 2 : 1)).toBeUndefined()
    // 옛 기록은 새 session 기록으로 옮겨져 하나만 남는다.
    expect(journalNames(recoveryDirectory)).toEqual([editing.currentSessionId(winner)])
  }, 60_000)

  test('복구 기록이 한도에 닿으면 조용히 멈추지 않고 창과 session을 알려 준다', async () => {
    const recoveryDirectory = join(directory, 'limit-recovery')
    const stopped: EditingJournalStoppedEvent[] = []
    const file = source()
    const anchor = await firstAnchor(file)
    const editing = manager(recoveryOptions(recoveryDirectory, {
      limits: { ...RECOVERY_JOURNAL_LIMITS, maxRecords: 1 },
      onJournalStopped: (event) => stopped.push(event)
    }))
    const started = await editing.start(3, file)
    await editing.commit(3, typing(started.sessionId, anchor, 'one', 0, '가', 1))
    await editing.flushJournal(3)
    expect(stopped).toEqual([])
    await editing.commit(3, typing(started.sessionId, anchor, 'two', 1, '나', 5_000))
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toMatchObject({ senderId: 3, sessionId: started.sessionId, reason: { reason: 'oversized' } })
    // 편집은 계속되고 dirty다. 최신 상태를 담지 못하는 기록 파일은 지운다.
    expect(editing.isDirty(3)).toBe(true)
    await editing.flushJournal(3)
    expect(journalNames(recoveryDirectory)).toEqual([])
  }, 60_000)

  test('게시한 뒤 timeout이 나면 저장 파일을 만들지 않았다고 하지 않고 이미 만들었다고 알린다', async () => {
    const saveDirectory = join(directory, 'after-publish-save')
    mkdirSync(saveDirectory)
    const file = source()
    const anchor = await firstAnchor(file)
    const editing = manager({ workerPath: afterPublishWorker, timeouts: { save: 3_000 } })
    const started = await editing.start(1, file)
    await editing.commit(1, typing(started.sessionId, anchor, 'a', 0, '가', 1))
    const destination = join(saveDirectory, 'after-publish.hwpx')
    const error = await editing.saveAs(1, started.sessionId, destination).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'EDITING_ENGINE_TIMEOUT' })
    expect(existsSync(destination)).toBe(true)
    expect((error as Error).message).not.toContain('저장 파일은 만들지 않았고')
    expect((error as Error).message).toContain('저장 파일은 이미 만들었지만')
    // worker를 끝낸 뒤 main이 남은 임시 이름을 지웠다.
    expect(readdirSync(saveDirectory).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 60_000)

  test('조작한 기록의 임의 XML fragment는 replay하지 않고 격리한다', async () => {
    const recoveryDirectory = join(directory, 'hostile-recovery')
    const file = source()
    const sourcePackage = await HwpxSourcePackage.open(file)
    let split: ReturnType<typeof planSplitParagraph> | undefined
    let selection = caret(listHwpxTextAnchors(sourcePackage, sectionPath)[0], 0)
    for (const anchor of listHwpxTextAnchors(sourcePackage, sectionPath)) {
      selection = caret(anchor, 0)
      try {
        split = planSplitParagraph(sourcePackage, selection)
        break
      } catch {
        // 문단 나누기를 지원하지 않는 문단은 건너뛴다.
      }
    }
    expect(split).toBeDefined()
    const command = {
      ...split!.command,
      replacementFragment: '<hp:p id="1" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>INJECTED-FROM-JOURNAL</hp:t></hp:run>' +
        '<evil:payload xmlns:evil="urn:x">x</evil:payload></hp:p>'
    }
    const transaction: EditTransaction = {
      id: 'forged',
      baseRevision: 0,
      commands: [command],
      selectionBefore: selection,
      selectionAfter: selection,
      timestamp: 1
    }
    const journalId = randomUUID()
    mkdirSync(join(recoveryDirectory, journalId), { recursive: true })
    writeFileSync(join(recoveryDirectory, journalId, RECOVERY_JOURNAL_FILE), Buffer.concat([
      encodeRecoveryRecord(createRecoveryJournalHeader(file, await fingerprintFile(file), 'forged')),
      encodeRecoveryRecord({ type: 'commit', revision: 1, at: 1, transaction })
    ]))
    const editing = manager(recoveryOptions(recoveryDirectory))
    const failure = await editing.recover(1, journalId).catch((reason: unknown) => reason)
    expect(failure).toMatchObject({ code: 'EDITING_RECOVERY_FAILED', quarantinePath: expect.stringContaining('quarantine-') })
    expect(editing.currentSessionId(1)).toBeUndefined()
    expect(existsSync(join(recoveryDirectory, journalId))).toBe(false)
    expect((await scanRecoveryJournals(recoveryDirectory)).candidates).toEqual([])
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 60_000)
})
