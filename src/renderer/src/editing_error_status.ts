import { isEditingEngineFailureCode, readEditingError } from '../../core/editing/editing_error'
import type {
  EditingCapabilityReason,
  EditingSelectionProjectionStatus
} from '../../core/editing/editing_capability'

export type EditingStatusTone = 'normal' | 'warning' | 'error'

export function editingErrorCode(reason: unknown) {
  return readEditingError(reason)?.code
}

/** 편집 엔진(worker)을 timeout·crash·메모리 초과로 종료해 session이 끝난 오류인지. 편집 모드를 닫아야 한다. */
export function isEditingEngineFailure(reason: unknown): boolean {
  return isEditingEngineFailureCode(readEditingError(reason)?.code)
}

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
    case 'EDITING_ENGINE_TIMEOUT':
      return `${action} 시간 초과 · 편집 세션 종료 · ${error.message}`
    case 'EDITING_ENGINE_CRASHED':
      return `${action} 오류 · 편집 세션 종료 · ${error.message}`
    case 'EDITING_RESOURCE_EXHAUSTED':
      return `${action} 메모리 한도 초과 · 편집 세션 종료 · ${error.message}`
    case 'EDITING_RECOVERY_FAILED':
      return `${action} 실패 · ${error.message}`
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

export function editingCapabilityStatus(
  action: string,
  reason: EditingCapabilityReason | undefined
): string | undefined {
  switch (reason) {
    case 'NO_SELECTION':
      return `${action}을 적용할 텍스트를 먼저 선택해 주세요.`
    case 'STALE_SELECTION':
      return `문서가 갱신되어 ${action} 기준 위치를 다시 선택해야 합니다.`
    case 'CROSS_STRUCTURE_SELECTION':
      return `본문과 표 셀처럼 서로 다른 구조를 함께 선택해 ${action}을 적용할 수 없습니다.`
    case 'MULTI_RUN_SELECTION':
      return `여러 글자 run에 걸친 ${action}은 아직 지원하지 않습니다.`
    case 'MULTI_PARAGRAPH_SELECTION':
      return `여러 문단에 걸친 ${action}은 아직 지원하지 않습니다.`
    case 'TABLE_CELL_STRUCTURE':
      return `현재 선택한 본문·표 셀 구조에는 ${action}을 적용할 수 없습니다.`
    case 'EMPTY_PARAGRAPH':
      return `빈 문단에는 글자를 먼저 입력한 뒤 ${action}을 적용할 수 있습니다.`
    case 'PARAGRAPH_HAS_OBJECT':
      return `수식·글상자·그림 같은 개체나 조판 부호가 든 문단에는 ${action}을 적용할 수 없습니다. 글자 입력·삭제는 그대로 할 수 있습니다.`
    case 'PARAGRAPH_COMPLEX_RUN':
      return `이 문단의 글자 구조에는 아직 ${action}을 적용할 수 없습니다. 글자 입력·삭제는 그대로 할 수 있습니다.`
    default:
      return undefined
  }
}

export function editingSelectionProjectionStatus(
  status: EditingSelectionProjectionStatus
): string | null {
  switch (status) {
    case 'CURRENT':
      return null
    case 'CLAMPED':
      return '문서 갱신으로 선택 범위를 현재 텍스트 길이에 맞게 조정했습니다.'
    case 'COLLAPSED':
      return '문서 갱신으로 선택 기준 일부가 사라져 남아 있는 위치로 이동했습니다.'
    case 'CLEARED':
      return '문서 갱신으로 선택 위치가 사라져 선택을 해제했습니다. 편집할 위치를 다시 선택해 주세요.'
  }
}
