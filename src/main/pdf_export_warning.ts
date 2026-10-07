import type { MessageBoxOptions } from 'electron'
import {
  formatObjectPlaceholderCounts,
  objectPlaceholderDetailLines,
  sanitizeObjectPlaceholderCounts,
  totalObjectPlaceholders
} from '../core/document/object_placeholder'

/** PDF 확인 대화상자의 버튼 순서. 0이면 내보내기를 계속한다. */
export const PDF_OBJECT_WARNING_CONTINUE = 0

/**
 * renderer가 보낸 자리 표시 개수로 PDF 내보내기 확인 대화상자 옵션을 만든다.
 * 개수는 신뢰하지 않는 IPC 입력이므로 알려진 종류의 양의 정수만 남기고, 남는 것이 없으면 undefined(확인 없이 내보낸다).
 */
export function pdfObjectPlaceholderConfirmation(rawCounts: unknown): MessageBoxOptions | undefined {
  const counts = sanitizeObjectPlaceholderCounts(rawCounts)
  const total = totalObjectPlaceholders(counts)
  if (!total) return undefined
  return {
    type: 'warning',
    buttons: ['그래도 내보내기', '취소'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: 'PDF로 내보내기',
    message: 'PDF에 원본과 다르게 나올 수 있는 개체가 있습니다.',
    detail: [
      `화면에 완전히 표시되지 않는 개체 ${total}개(${formatObjectPlaceholderCounts(counts)})는 PDF에도 화면과 같은 자리 표시로 나옵니다.`,
      ...objectPlaceholderDetailLines(counts).map((line) => `· ${line}`)
    ].join('\n')
  }
}
