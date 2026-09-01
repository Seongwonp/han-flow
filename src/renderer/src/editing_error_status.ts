import { readEditingError } from '../../core/editing/editing_error'

export type EditingStatusTone = 'normal' | 'warning' | 'error'

export function editingErrorStatus(action: string, reason: unknown): string | null {
  const error = readEditingError(reason)
  if (!error) {
    return `${action} 오류 · ${reason instanceof Error ? reason.message : String(reason)}`
  }
  switch (error.code) {
    case 'EDITING_NOT_APPLICABLE':
      return null
    case 'EDITING_UNSUPPORTED':
      return `${action} 제한 · ${error.message}`
    case 'EDITING_CONFLICT':
      return `${action} 충돌 · 변경하지 않았습니다. ${error.message}`
    case 'EDITING_HISTORY_LIMIT':
      return `편집 기록 제한 · 변경하지 않았습니다. ${error.message}`
    case 'EDITING_SESSION_EXPIRED':
      return `편집 세션 종료 · ${error.message}`
    case 'EDITING_INVALID_REQUEST':
      return `${action} 요청 오류 · ${error.message}`
    case 'EDITING_SAVE_FAILED':
      return `저장 실패 · 변경 내용은 유지했습니다. ${error.message}`
    case 'EDITING_INTERNAL':
      return `${action} 오류 · ${error.message}`
  }
}

export function editingStatusTone(status: string | null): EditingStatusTone {
  if (!status) return 'normal'
  if (['오류', '실패', '충돌', '세션 종료'].some((label) => status.includes(label))) {
    return 'error'
  }
  if (['제한', '저장 안 됨'].some((label) => status.includes(label))) {
    return 'warning'
  }
  return 'normal'
}
