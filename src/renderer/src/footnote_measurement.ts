import { ViewerNote, ViewerParagraph } from '../../core/document/viewer_document'
import { hancomPuaDisplayText } from '../../core/document/hancom_pua_display'
import { NoteBreak, NoteTextPosition, ViewerNoteMetrics } from '../../core/layout/footnote_layout'
import type { ParagraphLineBreak } from '../../core/layout/pagination'
import { cssPxToHwpUnit } from '../../core/layout/hwp_unit'

/**
 * 화면 표시 글자 offset을 원본 글자 offset으로 바꾼다. 화면은 일부 한컴 PUA 기호를 다른 길이의 글자로 바꿔 그리므로
 * (`hancomPuaDisplayText`) 바뀐 기호 중간 offset은 그 기호 앞으로 맞춘다.
 */
export function displayOffsetToSource(text: string, displayOffset: number): number {
  if (hancomPuaDisplayText(text) === text) return Math.min(displayOffset, text.length)
  let source = 0
  let display = 0
  for (const character of text) {
    const width = hancomPuaDisplayText(character).length
    if (display + width > displayOffset) break
    display += width
    source += character.length
  }
  return source
}

interface LineFragment { rect: DOMRect; content: number; node: Text; nodeStart: boolean }

/** 글자 run만 든 문단인지(줄 경계에서 글자를 나눠 그릴 수 있는지). */
function splittableParagraph(paragraph: ViewerParagraph): boolean {
  return paragraph.content.length > 0 && paragraph.content.every((item) => item.type === 'text')
}

/** `node`에서 `rect` 줄이 시작하는 글자 offset. 줄 안 글자의 위 끝은 줄마다 달라 이분 탐색으로 찾는다. */
function lineStartOffset(node: Text, top: number, range: Range): number {
  let low = 0
  let high = node.length
  while (low < high) {
    const middle = (low + high) >> 1
    range.setStart(node, middle)
    range.setEnd(node, Math.min(middle + 1, node.length))
    const rect = range.getBoundingClientRect()
    if (rect.top >= top - 1) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * 문단 하나의 줄 경계. 글자 run span(`data-content-index`)의 text node 줄 조각(`getClientRects`)을 문서 순서로 훑어 왼쪽으로
 * 되돌아가며 아래로 내려간 조각을 새 줄 시작으로 본다. 줄 경계 `y`는 앞 줄 글자 아래 끝과 다음 줄 글자 위 끝의 가운데다.
 */
function paragraphLineBreaks(element: HTMLElement, paragraph: ViewerParagraph, paragraphIndex: number, noteTop: number): NoteBreak[] {
  const fragments: LineFragment[] = []
  const range = element.ownerDocument.createRange()
  element.querySelectorAll<HTMLElement>('[data-content-index]').forEach((span) => {
    const content = Number(span.dataset.contentIndex)
    span.childNodes.forEach((child) => {
      if (child.nodeType !== Node.TEXT_NODE || !(child as Text).length) return
      range.selectNodeContents(child)
      Array.from(range.getClientRects()).forEach((rect, index) => fragments.push({ rect, content, node: child as Text, nodeStart: index === 0 }))
    })
  })
  const breaks: NoteBreak[] = []
  let lineBottom = -Infinity
  let previous: LineFragment | undefined
  for (const fragment of fragments) {
    const wrapped = previous !== undefined && fragment.rect.left < previous.rect.right - 1 && fragment.rect.top > previous.rect.top + 1
    if (previous && (wrapped || fragment.rect.top >= lineBottom - 1)) {
      const text = paragraph.content[fragment.content]
      // text node의 첫 줄 조각이면 node 처음부터 새 줄이다.
      const displayOffset = fragment.nodeStart ? 0 : lineStartOffset(fragment.node, fragment.rect.top, range)
      const offset = text?.type === 'text' ? displayOffsetToSource(text.text, displayOffset) : displayOffset
      const y = cssPxToHwpUnit((lineBottom + fragment.rect.top) / 2 - noteTop)
      // 글자 run 끝에서 줄이 바뀌면 다음 run 처음으로 둔다(빈 앞 조각을 만들지 않는다).
      const position = text?.type === 'text' && offset >= text.text.length && fragment.content + 1 < paragraph.content.length
        ? { content: fragment.content + 1, offset: 0 }
        : { content: fragment.content, offset }
      if (position.content > 0 || position.offset > 0) breaks.push({ y, paragraph: paragraphIndex, position })
      lineBottom = fragment.rect.bottom
    } else {
      lineBottom = Math.max(lineBottom, fragment.rect.bottom)
    }
    previous = fragment
  }
  return breaks
}

/**
 * 본문 최상위 문단의 줄 경계(문단 위 끝 기준 `y`, HWPUNIT)와 그 줄이 시작하는 글자 위치. pagination이 문단을 쪽(단) 사이에서 줄
 * 단위로 나눌 때 쓴다(`ParagraphLineBreak`). 글자 run만 든 문단만 잰다(그 밖은 빈 배열).
 */
export function measureParagraphLineBreaks(element: HTMLElement, paragraph: ViewerParagraph): ParagraphLineBreak[] {
  if (!splittableParagraph(paragraph) || typeof element.ownerDocument?.createRange !== 'function') return []
  const box = element.getBoundingClientRect()
  const height = cssPxToHwpUnit(box.height)
  return paragraphLineBreaks(element, paragraph, 0, box.top)
    .filter((item): item is NoteBreak & { position: NoteTextPosition } => Boolean(item.position) && item.y > 0 && item.y < height)
    .map(({ y, position }) => ({ y, position }))
}

/**
 * 측정 DOM의 각주 하나(`data-measure-note`)에서 높이와 나눌 수 있는 자리를 잰다. 문단 경계는 언제나, 글자 run만 든 문단은
 * 줄 경계도 나눌 자리로 둔다. 문단 요소는 각주 본문(`.viewer-note-body`)의 직속 자식이고 순서가 `note.paragraphs`와 같다.
 */
export function measureNoteElement(element: HTMLElement, note: ViewerNote): ViewerNoteMetrics {
  const box = element.getBoundingClientRect()
  const noteTop = box.top
  const height = cssPxToHwpUnit(box.height)
  const body = element.querySelector<HTMLElement>('.viewer-note-body')
  const paragraphElements = body ? Array.from(body.children).filter((child): child is HTMLElement => child.classList.contains('viewer-paragraph')) : []
  const paragraphTops: number[] = []
  const breaks: NoteBreak[] = []
  let previousBottom = 0
  paragraphElements.forEach((paragraphElement, index) => {
    const paragraph = note.paragraphs[index]
    if (!paragraph) return
    const rect = paragraphElement.getBoundingClientRect()
    const marginTop = parseFloat(getComputedStyle(paragraphElement).marginTop) || 0
    const top = index === 0 ? 0 : Math.max(cssPxToHwpUnit(rect.top - marginTop - noteTop), previousBottom)
    paragraphTops.push(top)
    if (index > 0 && top > 0 && top < height) breaks.push({ y: top, paragraph: index })
    if (splittableParagraph(paragraph)) {
      breaks.push(...paragraphLineBreaks(paragraphElement, paragraph, index, noteTop).filter((item) => item.y > top && item.y < height))
    }
    previousBottom = cssPxToHwpUnit(rect.bottom - noteTop)
  })
  return { height: Math.max(height, 1), paragraphTops, breaks: breaks.sort((left, right) => left.y - right.y) }
}
