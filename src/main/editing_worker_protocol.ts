import type { ViewerDocument } from '../core/document/viewer_document'
import type { EditingHistoryStatus } from '../core/editing/editing_contract'
import { EditingOperationError, type EditingRecovery } from '../core/editing/editing_error'
import type { RecoveryJournalEntry, RecoverySourceFingerprint } from './recovery_journal'

/*
 * main process ↔ 편집 worker 메시지. 모두 structured clone으로 건너가는 평범한 data다.
 * 요청 하나에 응답 하나가 같은 id로 돌아온다. worker는 package·history를 돌려보내지 않고
 * renderer에 필요한 projection과 상태만 보낸다. projection은 session 시작·refresh·fallback이면 전체 ViewerDocument,
 * 그 밖에는 바뀐 section만 담은 patch(`viewer_document_patch.ts`)다.
 */

export type EditingWorkerMethod =
  | 'start'
  | 'replay'
  | 'commit'
  | 'commitRange'
  | 'splitParagraph'
  | 'mergeParagraph'
  | 'applyCharacterStyle'
  | 'applyParagraphStyle'
  | 'applyCellStyle'
  | 'insertTableRowAfter'
  | 'deleteTableRow'
  | 'insertTableColumnAfter'
  | 'deleteTableColumn'
  | 'mergeTableCellRight'
  | 'splitTableCell'
  | 'undo'
  | 'redo'
  | 'refresh'
  | 'lossPolicy'
  | 'saveAs'

export interface EditingWorkerRequest {
  id: number
  method: EditingWorkerMethod
  payload?: unknown
}

export type EditingWorkerErrorPayload =
  | {
      kind: 'operation'
      code: EditingOperationError['code']
      message: string
      recovery: EditingRecovery
    }
  | {
      kind: 'error'
      name: string
      message: string
      code?: string
    }

/**
 * `journal`은 이 요청으로 history에 일어난 commit·undo·redo·저장 지점이다(없으면 생략). 요청이 실패해도 history가 바뀌었을 수
 * 있으므로(예: commit 뒤 projection 실패) 실패 응답에도 싣는다. main은 이것을 복구 기록에 덧붙인다.
 */
export type EditingWorkerResponse =
  | { id: number; ok: true; value: unknown; status?: EditingHistoryStatus; journal?: RecoveryJournalEntry[] }
  | {
      id: number
      ok: false
      error: EditingWorkerErrorPayload
      status?: EditingHistoryStatus
      journal?: RecoveryJournalEntry[]
    }

export interface EditingWorkerStartResult {
  sourcePath: string
  document: ViewerDocument
  projectionId: number
  /** worker가 실제로 읽은 원본의 크기·수정 시각·SHA-256(복구 기록 header) */
  source: RecoverySourceFingerprint
}

export interface EditingWorkerReplayRequest {
  entries: RecoveryJournalEntry[]
}

export function serializeEditingWorkerError(reason: unknown): EditingWorkerErrorPayload {
  if (reason instanceof EditingOperationError) {
    return { kind: 'operation', code: reason.code, message: reason.message, recovery: reason.recovery }
  }
  const code = reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string'
    ? reason.code
    : undefined
  return {
    kind: 'error',
    name: reason instanceof Error ? reason.name : 'Error',
    message: reason instanceof Error ? reason.message : String(reason),
    ...(code ? { code } : {})
  }
}

/** worker에서 던진 일반 오류. `code`(예: HWPX_EDIT_CONFLICT)를 보존해 `classifyEditingError`가 같은 분류를 하게 한다. */
export class EditingWorkerRemoteError extends Error {
  constructor(name: string, message: string, readonly code?: string) {
    super(message)
    this.name = name
  }
}

export function deserializeEditingWorkerError(payload: EditingWorkerErrorPayload): Error {
  if (payload.kind === 'operation') {
    return new EditingOperationError(payload.code, payload.message, payload.recovery)
  }
  return new EditingWorkerRemoteError(payload.name, payload.message, payload.code)
}
