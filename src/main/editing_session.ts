import { randomUUID } from 'crypto'
import { lstat, stat, unlink } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import { Worker, type ResourceLimits } from 'worker_threads'
import {
  EditingActionResult,
  EditingCharacterStyleRequest,
  EditingCellStyleRequest,
  EditingCommitRequest,
  EditingDeleteTableRowRequest,
  EditingDeleteTableColumnRequest,
  EditingHistoryStatus,
  EditingInsertTableColumnRequest,
  EditingMergeTableCellRightRequest,
  EditingMergeParagraphRequest,
  EditingInsertTableRowRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingSplitTableCellRequest,
  EditingSavedResult,
  EditingStartResult
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import type { HwpxSaveLossPolicy } from '../core/editing/loss_policy'
import { saveTemporaryPath } from '../core/editing/save_as'
import type { EditingEngineSaveRequest } from './editing_engine'
import {
  deserializeEditingWorkerError,
  type EditingWorkerMethod,
  type EditingWorkerRequest,
  type EditingWorkerResponse,
  type EditingWorkerStartResult
} from './editing_worker_protocol'

export {
  INVALID_DESTINATION_MESSAGE,
  PROTECTED_DESTINATION_MESSAGE,
  pdfExportFailureMessage,
  saveAsFailureMessage
} from './editing_save_messages'

/*
 * 편집 엔진 격리. 편집 session마다(=창마다) worker thread 하나를 resourceLimits를 걸어 만들고, 그 안에서
 * HwpxSourcePackage·source tree cache·history·projection 디코딩·Save As 검증을 모두 실행한다.
 * main process에는 창별 session 목록, 상태 거울(dirty 등), 원본 경로, 저장 목적지 결정만 남는다.
 */

/** 요청 종류별 wall-clock 한도. 넘으면 worker를 terminate하고 session을 끝낸다. */
export const EDITING_ENGINE_TIMEOUTS_MS = {
  /** package 전체 압축 해제 + 첫 projection 디코딩 */
  start: 120_000,
  /** text·style·문단·표 command 하나와 그 projection(refresh·loss policy 포함) */
  command: 60_000,
  /** 실행 취소·다시 실행과 그 projection */
  history: 60_000,
  /** 임시 파일 쓰기·fsync·재개봉 비교·viewer 디코딩·게시 */
  save: 180_000
} as const

export type EditingEngineTimeouts = { [Key in keyof typeof EDITING_ENGINE_TIMEOUTS_MS]: number }

/**
 * 편집 worker 하나의 heap 한도. 편집 session은 package bytes·source tree·history·projection을 함께 들고 있으므로
 * decoder worker(1 GiB)보다 넉넉하게 둔다. 초과 시 app abort 대신 ERR_WORKER_OUT_OF_MEMORY로 끝난다.
 */
export const EDITING_ENGINE_RESOURCE_LIMITS: ResourceLimits = {
  maxOldGenerationSizeMb: 1536,
  maxYoungGenerationSizeMb: 64
}

export interface EditingSessionManagerOptions {
  /** 빌드된 `editing_worker.js` 경로. 테스트는 TypeScript shim 경로를 넘긴다. */
  workerPath?: string
  timeouts?: Partial<EditingEngineTimeouts>
  resourceLimits?: ResourceLimits
}

const TIMEOUT_KIND: Record<EditingWorkerMethod, keyof EditingEngineTimeouts> = {
  start: 'start',
  commit: 'command',
  commitRange: 'command',
  splitParagraph: 'command',
  mergeParagraph: 'command',
  applyCharacterStyle: 'command',
  applyParagraphStyle: 'command',
  applyCellStyle: 'command',
  insertTableRowAfter: 'command',
  deleteTableRow: 'command',
  insertTableColumnAfter: 'command',
  deleteTableColumn: 'command',
  mergeTableCellRight: 'command',
  splitTableCell: 'command',
  refresh: 'command',
  lossPolicy: 'command',
  undo: 'history',
  redo: 'history',
  saveAs: 'save'
}

const SESSION_ENDED_SUFFIX = '저장하지 않은 변경 내용은 반영되지 않았고 보기 모드로 돌아갑니다. 원본 문서는 바뀌지 않았습니다.'

function sessionExpiredError(): EditingOperationError {
  return new EditingOperationError(
    'EDITING_SESSION_EXPIRED',
    '편집 session이 종료되었습니다. 문서를 다시 열어 주세요.',
    'restart-session'
  )
}

function timeoutError(method: EditingWorkerMethod, timeoutMs: number): EditingOperationError {
  const seconds = Math.ceil(timeoutMs / 1000)
  const action = method === 'saveAs'
    ? '변경본 저장·검증'
    : method === 'start'
      ? '편집 준비'
      : method === 'undo' || method === 'redo'
        ? '실행 취소·다시 실행'
        : '편집 처리'
  const saveNote = method === 'saveAs' ? ' 저장 파일은 만들지 않았고 임시 파일도 지웠습니다.' : ''
  return new EditingOperationError(
    'EDITING_ENGINE_TIMEOUT',
    `${action}가 제한 시간(${seconds}초)을 넘어 편집 엔진을 중단했습니다.${saveNote} 문서가 지나치게 크거나 복잡할 수 있습니다. ${SESSION_ENDED_SUFFIX}`,
    'restart-session'
  )
}

function crashedError(detail?: string): EditingOperationError {
  return new EditingOperationError(
    'EDITING_ENGINE_CRASHED',
    `편집 엔진이 예기치 않게 종료되었습니다${detail ? `(${detail})` : ''}. ${SESSION_ENDED_SUFFIX}`,
    'restart-session'
  )
}

function resourceExhaustedError(limitMb: number | undefined): EditingOperationError {
  return new EditingOperationError(
    'EDITING_RESOURCE_EXHAUSTED',
    `편집 처리 중 메모리 한도${limitMb ? `(${limitMb} MiB)` : ''}를 넘어 편집 엔진을 중단했습니다. 문서가 지나치게 크거나 복잡할 수 있습니다. ${SESSION_ENDED_SUFFIX}`,
    'restart-session'
  )
}

function assertHwpxPath(filePath: string): void {
  if (typeof filePath !== 'string' || extname(filePath).toLowerCase() !== '.hwpx') {
    throw new EditingOperationError(
      'EDITING_UNSUPPORTED',
      '편집 모드는 HWPX 문서만 지원합니다.'
    )
  }
}

export type SaveAsDestinationDecision = 'new' | 'replace' | 'protected' | 'invalid'

export interface EditingSaveAsOptions {
  /** OS 저장 대화상자가 기존 파일 교체를 이미 확인했을 때만 true. */
  overwrite?: boolean
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}

interface PendingRequest {
  method: EditingWorkerMethod
  resolve: (response: Extract<EditingWorkerResponse, { ok: true }>) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** session 하나를 맡은 worker. 끝나면(failure 설정) 다시 쓰지 않는다. */
class EditingEngineHandle {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private failure: Error | undefined
  private terminated: Promise<void> | undefined

  constructor(
    workerPath: string,
    private readonly resourceLimits: ResourceLimits,
    private readonly timeouts: EditingEngineTimeouts,
    private readonly onEnded: (handle: EditingEngineHandle) => void,
    private readonly onExit: (handle: EditingEngineHandle) => void
  ) {
    this.worker = new Worker(workerPath, { resourceLimits })
    // 대기 중인 요청은 timeout timer가 process를 붙잡는다. 놀고 있는 편집 worker가 종료를 막지 않게 한다.
    this.worker.unref()
    this.worker.on('message', (response: EditingWorkerResponse) => this.settle(response))
    this.worker.on('error', (error: Error & { code?: string }) => {
      this.fail(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? resourceExhaustedError(this.resourceLimits.maxOldGenerationSizeMb)
          : crashedError(error.message)
      )
    })
    this.worker.on('exit', (code) => {
      this.fail(crashedError(`exit ${code}`))
      this.onExit(this)
    })
  }

  get ended(): boolean {
    return this.failure !== undefined
  }

  request<T>(
    method: EditingWorkerMethod,
    payload?: unknown
  ): Promise<{ value: T; status?: EditingHistoryStatus }> {
    if (this.failure) return Promise.reject(this.failure)
    const id = this.nextId++
    const timeoutMs = this.timeouts[TIMEOUT_KIND[method]]
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => this.fail(timeoutError(method, timeoutMs)), timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (response) => resolvePromise({ value: response.value as T, status: response.status }),
        reject: rejectPromise,
        timer
      })
      const message: EditingWorkerRequest = { id, method, payload }
      try {
        this.worker.postMessage(message)
      } catch (reason) {
        clearTimeout(timer)
        this.pending.delete(id)
        rejectPromise(reason instanceof Error ? reason : new Error(String(reason)))
      }
    })
  }

  /** 정상 종료(창 닫기·편집 끝내기·다른 문서로 교체). 대기 중인 요청은 session 만료로 끝난다. */
  stop(): Promise<void> {
    this.fail(sessionExpiredError())
    return this.whenTerminated()
  }

  /** worker가 완전히 멈춘 뒤 resolve한다. 강제 종료 뒤 남은 임시 파일을 지우기 전에 기다린다. */
  whenTerminated(): Promise<void> {
    this.terminated ??= this.worker.terminate().then(() => undefined, () => undefined)
    return this.terminated
  }

  private settle(response: EditingWorkerResponse): void {
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response)
    else {
      const error = deserializeEditingWorkerError(response.error) as Error & {
        status?: EditingHistoryStatus
      }
      error.status = response.status
      pending.reject(error)
    }
  }

  private fail(reason: Error): void {
    if (this.failure) return
    this.failure = reason
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
    void this.whenTerminated()
    this.onEnded(this)
  }
}

interface EditingSession {
  id: string
  sourcePath: string
  status: EditingHistoryStatus
  /** worker에 보냈지만 아직 응답이 없는 변경 요청 수. 응답 전에 창을 닫아도 dirty로 보고 확인하게 한다. */
  pendingMutations: number
  engine: EditingEngineHandle
}

/** 문서를 바꾸지 않는 요청. 그 밖의 요청은 응답 전까지 dirty일 수 있다고 본다. */
const READ_ONLY_METHODS: ReadonlySet<EditingWorkerMethod> = new Set(['refresh', 'lossPolicy', 'saveAs'])

export class EditingSessionManager {
  private readonly sessions = new Map<number, EditingSession>()
  private readonly queues = new Map<number, Promise<void>>()
  /** 아직 종료되지 않은 편집 worker. session이 끝난 뒤 terminate가 끝날 때까지도 남는다. */
  private readonly runningEngines = new Set<EditingEngineHandle>()
  private readonly workerPath: string
  private readonly timeouts: EditingEngineTimeouts
  private readonly resourceLimits: ResourceLimits

  constructor(
    private readonly createSessionId: () => string = randomUUID,
    options: EditingSessionManagerOptions = {}
  ) {
    this.workerPath = options.workerPath ?? join(__dirname, 'editing_worker.js')
    this.timeouts = { ...EDITING_ENGINE_TIMEOUTS_MS, ...options.timeouts }
    this.resourceLimits = options.resourceLimits ?? EDITING_ENGINE_RESOURCE_LIMITS
  }

  async start(senderId: number, filePath: string): Promise<EditingStartResult> {
    return this.enqueue(senderId, async () => {
      assertHwpxPath(filePath)
      const engine = this.createEngine()
      let started: { value: EditingWorkerStartResult; status?: EditingHistoryStatus }
      try {
        started = await engine.request<EditingWorkerStartResult>('start', { filePath })
      } catch (reason) {
        void engine.stop()
        throw reason
      }
      if (!started.status) {
        void engine.stop()
        throw new Error('편집 worker가 상태를 보내지 않았습니다.')
      }
      const previous = this.sessions.get(senderId)
      const session: EditingSession = {
        id: this.createSessionId(),
        sourcePath: started.value.sourcePath,
        status: started.status,
        pendingMutations: 0,
        engine
      }
      this.sessions.set(senderId, session)
      if (previous) void previous.engine.stop()
      return {
        sessionId: session.id,
        document: started.value.document,
        ...session.status
      }
    })
  }

  commit(senderId: number, request: EditingCommitRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'commit', request)
  }

  commitRange(senderId: number, request: EditingRangeCommitRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'commitRange', request)
  }

  splitParagraph(senderId: number, request: EditingSplitParagraphRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'splitParagraph', request)
  }

  mergeParagraph(senderId: number, request: EditingMergeParagraphRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'mergeParagraph', request)
  }

  applyCharacterStyle(
    senderId: number,
    request: EditingCharacterStyleRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'applyCharacterStyle', request)
  }

  applyParagraphStyle(
    senderId: number,
    request: EditingParagraphStyleRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'applyParagraphStyle', request)
  }

  undo(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.action(senderId, sessionId, 'undo')
  }

  redo(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.action(senderId, sessionId, 'redo')
  }

  applyCellStyle(senderId: number, request: EditingCellStyleRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'applyCellStyle', request)
  }

  insertTableRowAfter(
    senderId: number,
    request: EditingInsertTableRowRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'insertTableRowAfter', request)
  }

  deleteTableRow(senderId: number, request: EditingDeleteTableRowRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'deleteTableRow', request)
  }

  insertTableColumnAfter(
    senderId: number,
    request: EditingInsertTableColumnRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'insertTableColumnAfter', request)
  }

  deleteTableColumn(
    senderId: number,
    request: EditingDeleteTableColumnRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'deleteTableColumn', request)
  }

  mergeTableCellRight(
    senderId: number,
    request: EditingMergeTableCellRightRequest
  ): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'mergeTableCellRight', request)
  }

  splitTableCell(senderId: number, request: EditingSplitTableCellRequest): Promise<EditingActionResult> {
    return this.action(senderId, request.sessionId, 'splitTableCell', request)
  }

  refresh(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.action(senderId, sessionId, 'refresh')
  }

  suggestedSaveAsPath(senderId: number, sessionId: string): string {
    const session = this.requireSession(senderId, sessionId)
    const sourcePath = session.sourcePath
    const extension = extname(sourcePath)
    const stem = basename(sourcePath, extension)
    return join(dirname(sourcePath), `${stem}_수정본.hwpx`)
  }

  currentSessionId(senderId: number): string | undefined {
    return this.sessions.get(senderId)?.id
  }

  isDirty(senderId: number, sessionId?: string): boolean {
    const session = this.sessions.get(senderId)
    if (!session || (sessionId !== undefined && session.id !== sessionId)) return false
    return session.status.isDirty || session.pendingMutations > 0
  }

  async lossPolicy(senderId: number, sessionId: string): Promise<HwpxSaveLossPolicy> {
    return this.enqueue(senderId, async () =>
      this.call<HwpxSaveLossPolicy>(this.requireSession(senderId, sessionId), 'lossPolicy')
    )
  }

  /** 원본 보호 대상: 열려 있는 모든 편집 session의 원본 경로. PDF 내보내기도 같은 목록을 쓴다. */
  protectedSourcePaths(): string[] {
    return [...this.sessions.values()].map((session) => session.sourcePath)
  }

  /**
   * 저장 대화상자에서 고른 경로를 어떻게 다룰지 결정한다.
   * 원본(또는 다른 session의 원본)이면 protected, 일반 파일이 아니면(심볼릭 링크·폴더 등) invalid,
   * 이미 있는 다른 파일이면 replace, 없으면 new. 목적지는 lstat으로 보므로 링크를 따라가지 않는다.
   */
  async saveAsDestinationDecision(
    senderId: number,
    sessionId: string,
    destinationPath: string
  ): Promise<SaveAsDestinationDecision> {
    this.requireSession(senderId, sessionId)
    const protectedPaths = this.protectedSourcePaths()
    if (protectedPaths.some((path) => samePath(path, destinationPath))) return 'protected'
    let destinationStats: Awaited<ReturnType<typeof lstat>>
    try {
      destinationStats = await lstat(destinationPath)
    } catch {
      return 'new'
    }
    if (!destinationStats.isFile()) return 'invalid'
    for (const path of protectedPaths) {
      const protectedStats = await stat(path).catch(() => undefined)
      if (
        protectedStats &&
        protectedStats.ino !== 0 &&
        protectedStats.dev === destinationStats.dev &&
        protectedStats.ino === destinationStats.ino
      ) {
        return 'protected'
      }
    }
    return 'replace'
  }

  async saveAs(
    senderId: number,
    sessionId: string,
    destinationPath: string,
    options: EditingSaveAsOptions = {}
  ): Promise<EditingSavedResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, sessionId)
      const temporaryToken = randomUUID()
      const request: EditingEngineSaveRequest = {
        destinationPath,
        overwrite: options.overwrite === true,
        protectedPaths: this.protectedSourcePaths(),
        temporaryToken
      }
      try {
        return await this.call<EditingSavedResult>(session, 'saveAs', request)
      } catch (reason) {
        if (session.engine.ended) {
          // timeout·OOM으로 worker를 강제 종료했다면 worker의 finally가 돌지 못했을 수 있다.
          // 완전히 멈춘 뒤 이 저장 요청의 임시 파일을 지운다. 목적지는 검증 뒤 link/rename으로만 게시하므로 반쯤 쓴 목적지는 없다.
          await session.engine.whenTerminated()
          await unlink(saveTemporaryPath(destinationPath, temporaryToken)).catch(() => undefined)
        }
        throw reason
      }
    })
  }

  stop(senderId: number): void {
    const session = this.sessions.get(senderId)
    this.sessions.delete(senderId)
    this.queues.delete(senderId)
    if (session) void session.engine.stop()
  }

  /** 모든 편집 worker를 끝낸다(테스트 정리용). */
  async dispose(): Promise<void> {
    this.sessions.clear()
    this.queues.clear()
    await Promise.all([...this.runningEngines].map((engine) => engine.stop()))
  }

  /** 실행 중인 편집 worker 수(진단·테스트용). */
  get runningWorkerCount(): number {
    return this.runningEngines.size
  }

  private createEngine(): EditingEngineHandle {
    const engine = new EditingEngineHandle(
      this.workerPath,
      this.resourceLimits,
      this.timeouts,
      (handle) => {
        // timeout·crash·OOM으로 끝난 worker의 session은 즉시 지운다. renderer는 다음 요청부터 만료로 본다.
        for (const [senderId, session] of this.sessions) {
          if (session.engine === handle) this.sessions.delete(senderId)
        }
      },
      (handle) => this.runningEngines.delete(handle)
    )
    this.runningEngines.add(engine)
    return engine
  }

  private action(
    senderId: number,
    sessionId: string,
    method: EditingWorkerMethod,
    request?: unknown
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () =>
      this.call<EditingActionResult>(this.requireSession(senderId, sessionId), method, request)
    )
  }

  private async call<T>(session: EditingSession, method: EditingWorkerMethod, payload?: unknown): Promise<T> {
    const mutation = !READ_ONLY_METHODS.has(method)
    if (mutation) session.pendingMutations += 1
    try {
      const response = await session.engine.request<T>(method, payload)
      if (response.status) session.status = response.status
      return response.value
    } catch (reason) {
      const status = (reason as { status?: EditingHistoryStatus }).status
      if (status) {
        session.status = status
        delete (reason as { status?: EditingHistoryStatus }).status
      }
      throw reason
    } finally {
      if (mutation) session.pendingMutations -= 1
    }
  }

  private requireSession(senderId: number, sessionId: string): EditingSession {
    const session = this.sessions.get(senderId)
    if (!session || session.id !== sessionId) throw sessionExpiredError()
    return session
  }

  private enqueue<T>(senderId: number, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(senderId) ?? Promise.resolve()
    const result = previous.then(action)
    this.queues.set(
      senderId,
      result.then(
        () => undefined,
        () => undefined
      )
    )
    return result
  }
}
