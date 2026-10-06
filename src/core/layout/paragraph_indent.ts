import { HwpUnit } from '../document/viewer_document'

export interface ParagraphIndentBox {
  /** 문단 왼쪽 여백(`hc:left`). */
  marginLeft: HwpUnit
  /** 내어쓰기로 둘째 줄부터 더 들어가는 폭. 첫 줄은 `textIndent`로 이만큼 당겨 `marginLeft`에서 시작한다. */
  paddingLeft: HwpUnit
  /** CSS `text-indent`. */
  textIndent: HwpUnit
}

/**
 * 한/글 문단 모양의 들여쓰기(`hc:intent`)를 CSS box로 옮긴다.
 *
 * - 양수(들여쓰기): 첫 줄만 왼쪽 여백에서 `intent`만큼 더 들어간다.
 * - 음수(내어쓰기): 첫 줄은 왼쪽 여백에서 시작하고 둘째 줄부터 `|intent|`만큼 들어간다.
 *   음수를 그대로 `text-indent`에 넣으면 첫 줄이 글상자·용지 왼쪽 밖으로 나가 PDF에서 잘린다.
 *
 * `availableWidth`(문단이 놓이는 칸의 안쪽 폭)를 알면 내어쓰기 폭을 남는 줄 폭 이하로 줄여,
 * 좁은 표 셀에서도 첫 줄이 칸 폭을 넘거나 이웃 칸으로 번지지 않게 한다.
 */
export function paragraphIndentBox(
  margin: { left?: HwpUnit; right?: HwpUnit },
  indent: HwpUnit | undefined,
  availableWidth?: HwpUnit
): ParagraphIndentBox {
  const marginLeft = margin.left ?? 0
  const value = indent ?? 0
  if (value >= 0) return { marginLeft, paddingLeft: 0, textIndent: value }
  const lineWidth = availableWidth === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, availableWidth - marginLeft - (margin.right ?? 0))
  const hanging = Math.min(-value, lineWidth)
  return { marginLeft, paddingLeft: hanging, textIndent: hanging === 0 ? 0 : -hanging }
}
