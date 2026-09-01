import {
  captureEditingIpcResult,
  classifyEditingError,
  EditingOperationError,
  readEditingError,
  unwrapEditingIpcResult
} from '../../src/core/editing/editing_error'
import { HwpxHistoryLimitError } from '../../src/core/editing/history'
import { HwpxEditConflictError } from '../../src/core/editing/text_patch'

describe('편집 오류 IPC contract', () => {
  test('지원 제한과 복구 정책을 안정적인 payload로 전달한다', async () => {
    const result = await captureEditingIpcResult(() => {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '여러 run 서식은 아직 지원하지 않습니다.'
      )
    })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'EDITING_UNSUPPORTED',
        message: '여러 run 서식은 아직 지원하지 않습니다.',
        recoverable: true,
        recovery: 'preserve'
      }
    })
  })

  test('conflict와 history limit을 서로 다른 오류 코드로 분류한다', () => {
    expect(classifyEditingError(new HwpxEditConflictError('anchor가 변경되었습니다.')))
      .toMatchObject({ code: 'EDITING_CONFLICT', recovery: 'retry' })
    expect(classifyEditingError(new HwpxHistoryLimitError('기록 한도 초과')))
      .toMatchObject({ code: 'EDITING_HISTORY_LIMIT', recovery: 'preserve' })
  })

  test('Electron 오류 접두 문구가 붙어도 payload를 복원한다', () => {
    const result = {
      ok: false as const,
      error: {
        code: 'EDITING_SESSION_EXPIRED' as const,
        message: '편집 session이 종료되었습니다.',
        recoverable: true,
        recovery: 'restart-session' as const
      }
    }
    let transported: unknown
    try {
      unwrapEditingIpcResult(result)
    } catch (reason) {
      transported = new Error(`Error invoking remote method: ${String(reason)}`)
    }
    expect(readEditingError(transported)).toEqual(result.error)
  })

  test('분류되지 않은 내부 오류의 원문과 경로를 payload에 노출하지 않는다', () => {
    const payload = classifyEditingError(new Error('C:\\private\\document.hwpx 원문 내용'))
    expect(payload).toEqual({
      code: 'EDITING_INTERNAL',
      message: '편집 처리 중 내부 오류가 발생했습니다.',
      recoverable: false,
      recovery: 'none'
    })
  })
})
