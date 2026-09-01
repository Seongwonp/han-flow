import {
  EditingErrorPayload,
  EditingIpcResult,
  unwrapEditingIpcResult
} from '../../src/core/editing/editing_error'
import {
  editingErrorStatus,
  editingStatusTone
} from '../../src/renderer/src/editing_error_status'

function transported(error: EditingErrorPayload): unknown {
  const result: EditingIpcResult<never> = { ok: false, error }
  try {
    unwrapEditingIpcResult(result)
  } catch (reason) {
    return reason
  }
}

describe('renderer 편집 오류 안내', () => {
  test('지원 제한은 문서가 손상된 것처럼 표시하지 않는다', () => {
    expect(editingErrorStatus('글자 모양', transported({
      code: 'EDITING_UNSUPPORTED',
      message: '여러 run 서식은 아직 지원하지 않습니다.',
      recoverable: true,
      recovery: 'preserve'
    }))).toBe('글자 모양 제한 · 여러 run 서식은 아직 지원하지 않습니다.')
  })

  test('conflict는 변경하지 않았음을 알리고 재시도를 안내할 근거를 보존한다', () => {
    expect(editingErrorStatus('범위 편집', transported({
      code: 'EDITING_CONFLICT',
      message: 'selection 기준 위치가 변경되었습니다.',
      recoverable: true,
      recovery: 'retry'
    }))).toBe('범위 편집 충돌 · 변경하지 않았습니다. selection 기준 위치가 변경되었습니다.')
  })

  test('적용 대상이 없는 경계 동작은 사용자 오류를 표시하지 않는다', () => {
    expect(editingErrorStatus('문단 병합', transported({
      code: 'EDITING_NOT_APPLICABLE',
      message: '병합할 인접 문단이 없습니다.',
      recoverable: true,
      recovery: 'preserve'
    }))).toBeNull()
  })

  test('세션 종료와 알 수 없는 오류를 구분한다', () => {
    expect(editingErrorStatus('편집', transported({
      code: 'EDITING_SESSION_EXPIRED',
      message: '문서를 다시 열어 주세요.',
      recoverable: true,
      recovery: 'restart-session'
    }))).toBe('편집 세션 종료 · 문서를 다시 열어 주세요.')
    expect(editingErrorStatus('편집', new Error('일반 실패'))).toBe('편집 오류 · 일반 실패')
  })

  test('저장 실패는 변경 내용이 유지됐음을 알린다', () => {
    expect(editingErrorStatus('저장', transported({
      code: 'EDITING_SAVE_FAILED',
      message: '목적지와 파일 상태를 확인해 주세요.',
      recoverable: true,
      recovery: 'retry'
    }))).toBe('저장 실패 · 변경 내용은 유지했습니다. 목적지와 파일 상태를 확인해 주세요.')
  })

  test('상태바에서 제한과 실패를 서로 다른 톤으로 표시한다', () => {
    expect(editingStatusTone('글자 모양 제한 · 여러 run 선택')).toBe('warning')
    expect(editingStatusTone('저장 실패 · 변경 내용은 유지했습니다.')).toBe('error')
    expect(editingStatusTone('편집 준비 완료')).toBe('normal')
  })
})
