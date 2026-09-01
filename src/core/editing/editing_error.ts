export type EditingErrorCode =
  | 'EDITING_CONFLICT'
  | 'EDITING_HISTORY_LIMIT'
  | 'EDITING_INVALID_REQUEST'
  | 'EDITING_NOT_APPLICABLE'
  | 'EDITING_SAVE_FAILED'
  | 'EDITING_SESSION_EXPIRED'
  | 'EDITING_UNSUPPORTED'
  | 'EDITING_INTERNAL'

export type EditingRecovery = 'preserve' | 'retry' | 'restart-session' | 'none'

export interface EditingErrorPayload {
  code: EditingErrorCode
  message: string
  recoverable: boolean
  recovery: EditingRecovery
}

export type EditingIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EditingErrorPayload }

const ERROR_MARKER = 'HAN_FLOW_EDITING_ERROR:'
const EDITING_ERROR_CODES: readonly EditingErrorCode[] = [
  'EDITING_CONFLICT',
  'EDITING_HISTORY_LIMIT',
  'EDITING_INVALID_REQUEST',
  'EDITING_NOT_APPLICABLE',
  'EDITING_SAVE_FAILED',
  'EDITING_SESSION_EXPIRED',
  'EDITING_UNSUPPORTED',
  'EDITING_INTERNAL'
]

export class EditingOperationError extends Error {
  constructor(
    readonly code: Exclude<EditingErrorCode, 'EDITING_CONFLICT' | 'EDITING_HISTORY_LIMIT' | 'EDITING_INTERNAL'>,
    message: string,
    readonly recovery: EditingRecovery = 'preserve'
  ) {
    super(message)
    this.name = 'EditingOperationError'
  }
}

export function classifyEditingError(reason: unknown): EditingErrorPayload {
  if (reason instanceof EditingOperationError) {
    return {
      code: reason.code,
      message: reason.message,
      recoverable: reason.recovery !== 'none',
      recovery: reason.recovery
    }
  }
  const sourceCode = reason && typeof reason === 'object' && 'code' in reason
    ? String(reason.code)
    : undefined
  if (sourceCode === 'HWPX_EDIT_CONFLICT') {
    return {
      code: 'EDITING_CONFLICT',
      message: reason instanceof Error ? reason.message : '편집 기준 위치가 변경되었습니다.',
      recoverable: true,
      recovery: 'retry'
    }
  }
  if (sourceCode === 'HWPX_HISTORY_LIMIT') {
    return {
      code: 'EDITING_HISTORY_LIMIT',
      message: reason instanceof Error ? reason.message : '편집 기록 용량 제한을 초과했습니다.',
      recoverable: true,
      recovery: 'preserve'
    }
  }
  return {
    code: 'EDITING_INTERNAL',
    message: '편집 처리 중 내부 오류가 발생했습니다.',
    recoverable: false,
    recovery: 'none'
  }
}

export async function captureEditingIpcResult<T>(
  action: () => T | Promise<T>
): Promise<EditingIpcResult<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (reason) {
    return { ok: false, error: classifyEditingError(reason) }
  }
}

export function unwrapEditingIpcResult<T>(result: EditingIpcResult<T>): T {
  if (result.ok) return result.value
  throw new Error(`${ERROR_MARKER}${JSON.stringify(result.error)}`)
}

export function readEditingError(reason: unknown): EditingErrorPayload | undefined {
  const message = reason instanceof Error ? reason.message : String(reason)
  const marker = message.indexOf(ERROR_MARKER)
  if (marker < 0) return undefined
  try {
    const payload = JSON.parse(message.slice(marker + ERROR_MARKER.length)) as Partial<EditingErrorPayload>
    if (
      !EDITING_ERROR_CODES.includes(payload.code as EditingErrorCode) ||
      typeof payload.message !== 'string' ||
      typeof payload.recoverable !== 'boolean' ||
      !['preserve', 'retry', 'restart-session', 'none'].includes(String(payload.recovery))
    ) return undefined
    return payload as EditingErrorPayload
  } catch {
    return undefined
  }
}
