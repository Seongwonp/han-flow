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
  type EditingWorkerReplayRequest,
  type EditingWorkerRequest,
  type EditingWorkerResponse,
  type EditingWorkerStartResult
} from './editing_worker_protocol'
import {
  createRecoveryJournalHeader,
  discardRecoveryJournal,
  isRecoverySessionId,
  quarantineRecoveryJournal,
  readRecoveryJournal,
  recoveryJournalDirectory,
  recoveryJournalIdFor,
  RecoveryJournalWriter,
  sameFingerprint,
  type RecoveryJournalEntry,
  type RecoveryJournalHeader,
  type RecoveryJournalLimits
} from './recovery_journal'

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
  save: 180_000,
  /** 복구 기록 전체 replay와 전체 projection */
  replay: 300_000
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

/** 편집 엔진이 timeout·crash·OOM으로 끝났고 그 session의 복구 기록이 디스크에 남은 경우. */
export interface EditingSessionLostEvent {
  senderId: number
  journalId: string
  sourcePath: string
  reason: Error
}

export interface EditingRecoveryOptions {
  /** 복구 기록 폴더(`<userData>/recovery`) */
  directory: string
  appVersion: string
  flushIntervalMs?: number
  limits?: RecoveryJournalLimits
  /** 엔진이 비정상 종료해 남은 기록을 다 내린 뒤 부른다. main은 곧바로 복구를 제안한다. */
  onSessionLost?: (event: EditingSessionLostEvent) => void
}

export interface EditingSessionManagerOptions {
  /** 빌드된 `editing_worker.js` 경로. 테스트는 TypeScript shim 경로를 넘긴다. */
  workerPath?: string
  timeouts?: Partial<EditingEngineTimeouts>
  resourceLimits?: ResourceLimits
  /** 없으면 복구 기록을 쓰지 않는다. */
  recovery?: EditingRecoveryOptions
}

export interface EditingRecoverResult extends EditingStartResult {
  /** 적용한 기록 record 수(commit·실행 취소·다시 실행·저장 지점) */
  recoveredEntries: number
  /** 그중 편집(commit) 수 */
  recoveredEdits: number
}

/** 원본이 기록을 만든 때와 달라 복구를 거절했다. 기록은 그대로 두고 다른 파일에 적용하지 않는다. */
export class RecoverySourceChangedError extends EditingOperationError {
  readonly sourceChanged = true
  constructor() {
    super(
      'EDITING_RECOVERY_FAILED',
      '원본 문서가 편집을 시작한 때와 달라 복구하지 않았습니다. 복구 기록은 그대로 보관합니다.',
      'none'
    )
  }
}

const TIMEOUT_KIND: Record<EditingWorkerMethod, keyof EditingEngineTimeouts> = {
  start: 'start',
  replay: 'replay',
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

const SESSION_ENDED_SUFFIX = '보기 모드로 돌아갑니다. 원본 문서는 바뀌지 않았고, 저장하지 않은 편집은 복구 기록에서 되살릴 수 있습니다.'

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

export function samePath(left: string, right: string): boolean {
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
    private readonly onEnded: (handle: EditingEngineHandle, reason: Error) => void,
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
  ): Promise<{ value: T; status?: EditingHistoryStatus; journal?: RecoveryJournalEntry[] }> {
    if (this.failure) return Promise.reject(this.failure)
    const id = this.nextId++
    const timeoutMs = this.timeouts[TIMEOUT_KIND[method]]
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => this.fail(timeoutError(method, timeoutMs)), timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (response) => resolvePromise({
          value: response.value as T,
          status: response.status,
          journal: response.journal
        }),
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
        journal?: RecoveryJournalEntry[]
      }
      error.status = response.status
      if (response.journal) error.journal = response.journal
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
    this.onEnded(this, reason)
  }
}

interface EditingSession {
  id: string
  sourcePath: string
  status: EditingHistoryStatus
  /** worker에 보냈지만 아직 응답이 없는 변경 요청 수. 응답 전에 창을 닫아도 dirty로 보고 확인하게 한다. */
  pendingMutations: number
  engine: EditingEngineHandle
  /** 복구 기록(복구 기록을 켠 경우) */
  journal?: RecoveryJournalWriter
  journalId?: string
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
  private readonly recovery: EditingRecoveryOptions | undefined

  constructor(
    private readonly createSessionId: () => string = randomUUID,
    options: EditingSessionManagerOptions = {}
  ) {
    this.workerPath = options.workerPath ?? join(__dirname, 'editing_worker.js')
    this.timeouts = { ...EDITING_ENGINE_TIMEOUTS_MS, ...options.timeouts }
    this.resourceLimits = options.resourceLimits ?? EDITING_ENGINE_RESOURCE_LIMITS
    this.recovery = options.recovery
  }

  /** 복구 기록 폴더. 복구 기록을 끄면 undefined. */
  get recoveryDirectory(): string | undefined {
    return this.recovery?.directory
  }

  private createJournal(sessionId: string, header: RecoveryJournalHeader): Pick<EditingSession, 'journal' | 'journalId'> {
    if (!this.recovery) return {}
    const journalId = recoveryJournalIdFor(sessionId)
    const journal = new RecoveryJournalWriter(recoveryJournalDirectory(this.recovery.directory, journalId), header, {
      flushIntervalMs: this.recovery.flushIntervalMs,
      limits: this.recovery.limits,
      onStopped: (reason) => console.warn(`복구 기록을 멈췄습니다(${journalId}): ${reason.message}`)
    })
    return { journal, journalId }
  }

  /** 열려 있는 편집 session의 복구 기록 ID. 남은 기록을 찾을 때 이 기록들은 건너뛴다. */
  activeJournalIds(): Set<string> {
    return new Set(
      [...this.sessions.values()].flatMap((session) => (session.journalId ? [session.journalId] : []))
    )
  }

  /** 창의 복구 기록을 지금 디스크에 내린다(창 blur·닫기 확인 전). */
  async flushJournal(senderId: number): Promise<void> {
    await this.sessions.get(senderId)?.journal?.flush()
  }

  /**
   * 남은 복구 기록으로 편집 session을 연다. 원본을 새 worker로 열어 기록 header의 크기·수정 시각·SHA-256과 비교하고,
   * 같을 때만 기록을 replay한다(다르면 RecoverySourceChangedError, 기록은 그대로 둔다). replay는 worker의 일반 한도·timeout 안에서
   * live 편집과 같은 commit·undo·redo·저장 지점 경로로 돈다. 성공하면 새 session의 기록을 디스크에 내린 뒤 옛 기록을 지운다.
   */
  async recover(senderId: number, journalId: string): Promise<EditingRecoverResult> {
    const recovery = this.recovery
    if (!recovery || !isRecoverySessionId(journalId)) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '복구 기록 요청 형식이 올바르지 않습니다.')
    }
    return this.enqueue(senderId, async () => {
      if (this.activeJournalIds().has(journalId)) {
        throw new EditingOperationError('EDITING_INVALID_REQUEST', '열려 있는 편집 session의 기록은 복구할 수 없습니다.')
      }
      const candidate = await readRecoveryJournal(recovery.directory, journalId)
      if (!candidate) {
        throw new EditingOperationError('EDITING_RECOVERY_FAILED', '복구 기록을 찾을 수 없습니다.', 'none')
      }
      assertHwpxPath(candidate.header.sourcePath)
      const engine = this.createEngine()
      let session: EditingSession
      let replayed: { value: EditingActionResult; status?: EditingHistoryStatus; journal?: RecoveryJournalEntry[] }
      let replaying = false
      try {
        const started = await engine.request<EditingWorkerStartResult>('start', { filePath: candidate.header.sourcePath })
        if (!sameFingerprint(candidate.header, started.value.source)) throw new RecoverySourceChangedError()
        const request: EditingWorkerReplayRequest = { entries: candidate.entries }
        replaying = true
        replayed = await engine.request<EditingActionResult>('replay', request)
        replaying = false
        if (!replayed.status || !replayed.value.document || replayed.value.projectionId === undefined) {
          throw new Error('편집 worker가 복구 결과를 보내지 않았습니다.')
        }
        const id = this.createSessionId()
        session = {
          id,
          sourcePath: started.value.sourcePath,
          status: replayed.status,
          pendingMutations: 0,
          engine,
          ...this.createJournal(id, candidate.header)
        }
        // 새 기록을 디스크에 내린 뒤에야 옛 기록을 지운다. 그 사이에 멈추면 두 기록이 남을 뿐 잃지 않는다.
        session.journal?.append(replayed.journal ?? [], replayed.status.isDirty)
        await session.journal?.flush()
        await discardRecoveryJournal(recovery.directory, journalId)
      } catch (reason) {
        void engine.stop()
        // replay가 실패·timeout·crash한 기록은 다시 실행하지 않도록 격리한다(사용자가 버리기 전까지 사본을 남긴다).
        if (replaying && reason && typeof reason === 'object') {
          await engine.whenTerminated()
          const quarantinePath = await quarantineRecoveryJournal(recovery.directory, journalId).catch(() => undefined)
          if (quarantinePath) (reason as { quarantinePath?: string }).quarantinePath = quarantinePath
        }
        throw reason
      }
      const previous = this.sessions.get(senderId)
      this.sessions.set(senderId, session)
      if (previous) {
        void previous.journal?.discard()
        void previous.engine.stop()
      }
      return {
        sessionId: session.id,
        document: replayed.value.document,
        projectionId: replayed.value.projectionId,
        recoveredEntries: candidate.entries.length,
        recoveredEdits: candidate.editCount,
        ...session.status
      }
    })
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
      const id = this.createSessionId()
      const session: EditingSession = {
        id,
        sourcePath: started.value.sourcePath,
        status: started.status,
        pendingMutations: 0,
        engine,
        ...this.createJournal(
          id,
          createRecoveryJournalHeader(started.value.sourcePath, started.value.source, this.recovery?.appVersion ?? '')
        )
      }
      this.sessions.set(senderId, session)
      if (previous) {
        void previous.journal?.discard()
        void previous.engine.stop()
      }
      return {
        sessionId: session.id,
        document: started.value.document,
        projectionId: started.value.projectionId,
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
      // 저장 중 앱이 강제 종료돼도 직전 편집까지 남도록 먼저 기록을 내린다.
      await session.journal?.flush()
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

  /**
   * 정상 종료(편집 끝내기·창 닫기·다른 문서 열기). 호출하는 쪽이 이미 저장했거나 버리기를 골랐으므로 복구 기록도 지운다.
   */
  stop(senderId: number): void {
    const session = this.sessions.get(senderId)
    this.sessions.delete(senderId)
    this.queues.delete(senderId)
    if (session) {
      void session.journal?.discard()
      void session.engine.stop()
    }
  }

  /** 모든 편집 worker를 끝낸다(테스트 정리용). 복구 기록은 지우지 않고 내린 뒤 닫는다. */
  async dispose(): Promise<void> {
    const journals = [...this.sessions.values()].flatMap((session) => (session.journal ? [session.journal] : []))
    this.sessions.clear()
    this.queues.clear()
    await Promise.all([
      ...journals.map((journal) => journal.retain()),
      ...[...this.runningEngines].map((engine) => engine.stop())
    ])
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
      (handle, reason) => {
        // timeout·crash·OOM으로 끝난 worker의 session은 즉시 지운다. renderer는 다음 요청부터 만료로 본다.
        // 복구 기록은 지우지 않는다. 응답까지 받은 편집은 모두 main에 있으므로 바로 내리고 복구를 제안하게 한다.
        for (const [senderId, session] of this.sessions) {
          if (session.engine !== handle) continue
          this.sessions.delete(senderId)
          const journal = session.journal
          const journalId = session.journalId
          if (!journal || !journalId) continue
          void journal.retain().then(() => {
            if (journal.hasFile) {
              this.recovery?.onSessionLost?.({ senderId, journalId, sourcePath: session.sourcePath, reason })
            }
          })
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
      session.journal?.append(response.journal ?? [], session.status.isDirty)
      return response.value
    } catch (reason) {
      const failed = reason as { status?: EditingHistoryStatus; journal?: RecoveryJournalEntry[] }
      if (failed.status) {
        session.status = failed.status
        delete failed.status
      }
      // 요청은 실패했어도 history가 바뀌었을 수 있다(commit 뒤 projection 실패 등).
      if (failed.journal) {
        session.journal?.append(failed.journal, session.status.isDirty)
        delete failed.journal
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
