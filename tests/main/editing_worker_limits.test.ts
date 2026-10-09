import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EditingCommitRequest } from '../../src/core/editing/editing_contract'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { saveHwpxAs } from '../../src/core/editing/save_as'
import { HwpxTextAnchor, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditTransaction, projectEditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { EditingSessionManager, EditingSessionManagerOptions } from '../../src/main/editing_session'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'
import { projectedSessionManager, ProjectedEditingSessionManager } from './projected_session_manager'
import { writeEditingWorkerShim } from './ts_worker_shim'

const sectionPath = 'Contents/section0.xml'
const externalFixture = join(__dirname, '../fixtures/public/external/ext-hwpxlib-table-scores.hwpx')

/*
 * 테스트 전용 worker preamble. 실제 editing_worker.ts를 불러오기 전에 history·save_as를 monkeypatch해
 * transaction id나 저장 목적지 이름으로 멈춤·지연·메모리 폭주·비정상 종료를 재현한다. production 코드에는 seam이 없다.
 */
const PREAMBLE = `
const { writeFileSync } = require('fs')
const history = requireSource('core/editing/history')
const commit = history.HwpxEditHistory.prototype.commitSynchronized
history.HwpxEditHistory.prototype.commitSynchronized = function (transaction) {
  if (transaction.id === 'stall') for (;;) {}
  if (transaction.id === 'hungry') {
    const retained = []
    for (;;) retained.push(new Array(1_000_000).fill(retained.length))
  }
  if (transaction.id === 'crash') process.exit(3)
  const slow = /^slow-(\\d+)/.exec(transaction.id)
  if (slow) {
    const end = Date.now() + Number(slow[1])
    while (Date.now() < end) {}
  }
  return commit.call(this, transaction)
}
const saveAs = requireSource('core/editing/save_as')
const save = saveAs.saveHwpxAs
saveAs.saveHwpxAs = (sourcePackage, destinationPath, options = {}) => {
  if (!destinationPath.includes('stall-save')) return save(sourcePackage, destinationPath, options)
  return save(sourcePackage, destinationPath, {
    ...options,
    onBeforePublish: () => {
      // 임시 파일을 쓰고 재개봉·viewer 검증까지 마친 뒤 게시 직전에 멈춘다.
      writeFileSync(destinationPath + '.reached', 'reached')
      for (;;) {}
    }
  })
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

function typing(
  sessionId: string,
  anchor: HwpxTextAnchor,
  transactionId: string,
  offset: number,
  insert: string,
  timestamp: number
): EditingCommitRequest {
  return {
    sessionId,
    transactionId,
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

/** 이전 main process 경로와 같은 순서로 history에 직접 commit한다(editing_session.ts의 이전 commit 구현). */
function transactionOf(request: EditingCommitRequest, revision: number): EditTransaction {
  return {
    id: request.transactionId,
    baseRevision: revision,
    commands: [{
      type: 'replace-text',
      sectionPath: request.sectionPath,
      textNodeId: request.textNodeId,
      from: request.from,
      to: request.to,
      insert: request.insert
    }],
    selectionBefore: { ...request.selectionBefore },
    selectionAfter: { ...request.selectionAfter },
    inputType: request.inputType,
    compositionId: request.compositionId,
    timestamp: request.timestamp
  }
}

/**
 * ZIP local·central header의 DOS 수정 시각만 0으로 바꾼다. identity writer(adm-zip)는 저장 시각을 기록하므로
 * 두 저장 시각이 2초 경계를 넘으면 그 필드만 달라진다. 나머지 byte(순서·압축 결과·CRC·내용)는 그대로 비교한다.
 */
function withoutZipTimestamps(buffer: Buffer): Buffer {
  const bytes = Buffer.from(buffer)
  let eocd = bytes.length - 22
  while (eocd >= 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1
  let offset = bytes.readUInt32LE(eocd + 16)
  for (let index = 0; index < bytes.readUInt16LE(eocd + 10); index += 1) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
    bytes.writeUInt32LE(0, offset + 12)
    const local = bytes.readUInt32LE(offset + 42)
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50)
    bytes.writeUInt32LE(0, local + 10)
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
  return bytes
}

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났습니다.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('편집 엔진 worker 격리', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-worker-'))
  const fixture = createRoundTripHwpx(directory)
  const workerPath = writeEditingWorkerShim(directory, { name: 'editing-worker-test', preamble: PREAMBLE })
  const managers: EditingSessionManager[] = []
  // 편집 결과의 projection patch를 renderer처럼 적용해 `document`(전체 문서)를 붙인다.
  const manager = (options: Omit<EditingSessionManagerOptions, 'workerPath'> = {}): ProjectedEditingSessionManager => {
    const created = new EditingSessionManager(undefined, { workerPath, ...options })
    managers.push(created)
    return projectedSessionManager(created)
  }
  const firstAnchor = async (path: string): Promise<HwpxTextAnchor> =>
    listHwpxTextAnchors(await HwpxSourcePackage.open(path), sectionPath).find((anchor) => anchor.text.length > 1)!

  afterAll(async () => {
    await Promise.all(managers.map((created) => created.dispose()))
    rmSync(directory, { recursive: true, force: true })
  })

  test.each([
    ['기준 합성 fixture', fixture],
    ['외부 fixture', externalFixture]
  ])('%s: start·commit·undo·redo·Save As 결과가 이전 main thread 경로와 byte 단위로 같다(ZIP 저장 시각 제외)', async (_label, source) => {
    const anchor = await firstAnchor(source)
    const editing = manager()
    const started = await editing.start(1, source)
    const inProcess = new HwpxEditHistory(await HwpxSourcePackage.open(source))
    expect(started.document).toEqual(await decodeViewerDocument(inProcess.package))

    const requests = [
      typing(started.sessionId, anchor, 'round-trip-1', 1, '시험', 1),
      typing(started.sessionId, anchor, 'round-trip-2', 3, ' 입력', 2_000)
    ]
    for (const request of requests) {
      const viaWorker = await editing.commit(1, request)
      const result = inProcess.commitSynchronized(transactionOf(request, inProcess.package.revision))
      expect(viaWorker.document).toEqual(await projectEditTransaction(result))
      expect(viaWorker).toMatchObject({
        revision: inProcess.package.revision,
        savedRevision: inProcess.savedRevision,
        canUndo: inProcess.canUndo,
        canRedo: inProcess.canRedo,
        isDirty: inProcess.isDirty,
        selection: inProcess.selection
      })
    }
    const undone = await editing.undo(1, started.sessionId)
    inProcess.undo()
    expect(undone.document).toEqual(await decodeViewerDocument(inProcess.package))
    const redone = await editing.redo(1, started.sessionId)
    inProcess.redo()
    expect(redone).toMatchObject({ revision: inProcess.package.revision, isDirty: true })
    expect(editing.isDirty(1, started.sessionId)).toBe(true)

    const viaWorkerPath = join(directory, `worker-${_label === '외부 fixture' ? 'external' : 'baseline'}.hwpx`)
    const inProcessPath = join(directory, `main-${_label === '외부 fixture' ? 'external' : 'baseline'}.hwpx`)
    const saved = await editing.saveAs(1, started.sessionId, viaWorkerPath)
    await saveHwpxAs(inProcess.package, inProcessPath)
    inProcess.markSaved()
    expect(saved).toMatchObject({
      destinationPath: viaWorkerPath,
      revision: inProcess.package.revision,
      savedRevision: inProcess.savedRevision,
      isDirty: false,
      lossPolicy: { structures: [{ structure: 'text' }] }
    })
    expect(editing.isDirty(1, started.sessionId)).toBe(false)
    const viaWorkerBytes = readFileSync(viaWorkerPath)
    const inProcessBytes = readFileSync(inProcessPath)
    expect(viaWorkerBytes.length).toBe(inProcessBytes.length)
    expect(withoutZipTimestamps(viaWorkerBytes).equals(withoutZipTimestamps(inProcessBytes))).toBe(true)
  }, 60_000)

  test('멈춘 command는 timeout으로 worker를 종료하고 session을 끝낸다', async () => {
    const anchor = await firstAnchor(fixture)
    const editing = manager({ timeouts: { command: 500 } })
    const started = await editing.start(2, fixture)
    await editing.commit(2, typing(started.sessionId, anchor, 'before-stall', 0, '가', 1))
    expect(editing.isDirty(2)).toBe(true)
    const startedAt = Date.now()
    await expect(editing.commit(2, typing(started.sessionId, anchor, 'stall', 1, '나', 2_000))).rejects.toMatchObject({
      code: 'EDITING_ENGINE_TIMEOUT',
      recovery: 'restart-session',
      message: expect.stringContaining('제한 시간(1초)')
    })
    expect(Date.now() - startedAt).toBeLessThan(10_000)
    // session은 끝났고 dirty 확인·원본 보호 목록에서도 빠진다. 다음 요청은 만료로 거부한다.
    expect(editing.currentSessionId(2)).toBeUndefined()
    expect(editing.isDirty(2)).toBe(false)
    expect(editing.protectedSourcePaths()).toEqual([])
    await expect(editing.undo(2, started.sessionId)).rejects.toMatchObject({ code: 'EDITING_SESSION_EXPIRED' })
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 30_000)

  test('worker가 비정상 종료하면 EDITING_ENGINE_CRASHED로 session을 끝낸다', async () => {
    const anchor = await firstAnchor(fixture)
    const editing = manager()
    const started = await editing.start(3, fixture)
    await expect(editing.commit(3, typing(started.sessionId, anchor, 'crash', 0, '가', 1))).rejects.toMatchObject({
      code: 'EDITING_ENGINE_CRASHED',
      recovery: 'restart-session'
    })
    expect(editing.currentSessionId(3)).toBeUndefined()
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 30_000)

  // 프로세스 전역 --max-old-space-size(NODE_OPTIONS 포함)가 걸려 있으면 Node가 worker
  // resourceLimits를 무시하므로 그 환경에서는 OOM 재현이 불가능해 건너뛴다.
  const heapFlagPinned =
    /max-old-space-size/.test(process.env.NODE_OPTIONS ?? '') ||
    process.execArgv.some((argument) => argument.includes('max-old-space-size'))
  const oomTest = heapFlagPinned ? test.skip : test
  oomTest('heap 한도 초과는 app abort 대신 EDITING_RESOURCE_EXHAUSTED로 끝난다', async () => {
    const anchor = await firstAnchor(fixture)
    const editing = manager({
      timeouts: { command: 30_000 },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 }
    })
    const started = await editing.start(4, fixture)
    await expect(editing.commit(4, typing(started.sessionId, anchor, 'hungry', 0, '가', 1))).rejects.toMatchObject({
      code: 'EDITING_RESOURCE_EXHAUSTED',
      recovery: 'restart-session',
      message: expect.stringContaining('메모리 한도(96 MiB)')
    })
    expect(editing.currentSessionId(4)).toBeUndefined()
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 60_000)

  test('저장 timeout은 임시 파일과 목적지를 남기지 않는다', async () => {
    const anchor = await firstAnchor(fixture)
    const saveDirectory = join(directory, 'save-timeout')
    mkdirSync(saveDirectory)
    const editing = manager({ timeouts: { save: 1_500 } })
    const started = await editing.start(5, fixture)
    await editing.commit(5, typing(started.sessionId, anchor, 'before-save', 0, '가', 1))
    const destination = join(saveDirectory, 'stall-save.hwpx')
    await expect(editing.saveAs(5, started.sessionId, destination)).rejects.toMatchObject({
      code: 'EDITING_ENGINE_TIMEOUT',
      message: expect.stringContaining('저장 파일은 만들지 않았고')
    })
    // worker는 임시 파일을 쓰고 검증까지 마친 뒤 멈췄다. 강제 종료 뒤 main이 그 임시 파일을 지웠다.
    expect(existsSync(`${destination}.reached`)).toBe(true)
    expect(existsSync(destination)).toBe(false)
    expect(readdirSync(saveDirectory).filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(editing.currentSessionId(5)).toBeUndefined()
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 30_000)

  test('worker에서 느린 편집이 도는 동안 main event loop는 막히지 않고 다른 창 session은 병렬로 진행한다', async () => {
    const anchor = await firstAnchor(fixture)
    const editing = manager()
    const slowSession = await editing.start(6, fixture)
    const fastSession = await editing.start(7, fixture)

    let maxLag = 0
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      maxLag = Math.max(maxLag, now - last - 10)
      last = now
    }, 10)
    const order: string[] = []
    try {
      const slow = editing.commit(6, typing(slowSession.sessionId, anchor, 'slow-1500', 0, '느림', 1))
        .then((result) => { order.push('slow'); return result })
      // 같은 창의 다음 command는 느린 command 뒤에 순서대로 처리된다.
      const queued = editing.commit(6, typing(slowSession.sessionId, anchor, 'after-slow', 2, '다음', 2_000))
        .then((result) => { order.push('queued'); return result })
      const fast = await editing.commit(7, typing(fastSession.sessionId, anchor, 'fast', 0, '빠름', 1))
      order.push('fast')
      expect(JSON.stringify(fast.document)).toContain('빠름')
      const [slowResult, queuedResult] = await Promise.all([slow, queued])
      expect(slowResult.revision).toBe(1)
      expect(queuedResult.revision).toBe(2)
      expect(JSON.stringify(queuedResult.document)).toContain('느림다음')
    } finally {
      clearInterval(timer)
    }
    expect(order).toEqual(['fast', 'slow', 'queued'])
    expect(maxLag).toBeLessThan(200)
  }, 30_000)

  test('응답 전 변경 요청은 dirty로 보고, stop은 대기 중인 요청을 session 만료로 끝내고 worker를 종료한다', async () => {
    const anchor = await firstAnchor(fixture)
    const editing = manager()
    const started = await editing.start(8, fixture)
    const pending = editing.commit(8, typing(started.sessionId, anchor, 'slow-1000', 0, '가', 1))
    await new Promise((resolve) => setTimeout(resolve, 100))
    // 응답 전인 변경 요청이 있으면 닫기 확인이 놓치지 않도록 dirty로 본다.
    expect(started.isDirty).toBe(false)
    expect(editing.isDirty(8, started.sessionId)).toBe(true)
    editing.stop(8)
    await expect(pending).rejects.toMatchObject({ code: 'EDITING_SESSION_EXPIRED' })
    await waitFor(() => editing.runningWorkerCount === 0)
  }, 30_000)
})
