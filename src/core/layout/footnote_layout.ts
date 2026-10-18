import { DEFAULT_FOOTNOTE_SETTINGS, ViewerContent, ViewerFootnoteSettings, ViewerNote, ViewerParagraph } from '../document/viewer_document'

/**
 * 각주 본문 안 글자 위치: 문단 content 순번과 그 글자 run 안 UTF-16 offset. 문단 사이 경계면 `position`이 없다.
 */
export interface NoteTextPosition { content: number; offset: number }

/**
 * 각주를 쪽 사이에서 나눌 수 있는 자리. `y`는 각주 위에서부터 잰 높이(HWPUNIT)이고, 나눈 앞 조각은 `y`까지, 뒤 조각은 `y`부터다.
 * `position`이 없으면 `paragraph`번 문단 앞(문단 경계), 있으면 `paragraph`번 문단 안 줄 경계(그 글자부터 다음 쪽)다.
 */
export interface NoteBreak { y: number; paragraph: number; position?: NoteTextPosition }

/**
 * 각주 하나의 높이와 나눌 수 있는 자리(`y` 오름차순, 0과 `height`는 넣지 않는다). `paragraphTops`는 문단마다 위 끝 `y`다.
 * 화면 측정(`measureNoteElement`)이 줄 경계까지 채우고, 측정 전에는 decoder 줄 배치 높이로 문단 경계만 둔다.
 */
export interface ViewerNoteMetrics { height: number; paragraphTops: number[]; breaks: NoteBreak[] }

/**
 * 쪽(단) 아래 각주 조각에 든 문단 조각.
 * - `whole`: 원본 문단 그대로(편집 입력 칸).
 * - `head`: 원본 문단의 앞 줄들. 화면·PDF에는 앞 줄 글자만(`paragraph`), 편집 중에는 원본 문단 전체를 `clipHeight`
 *   높이로 잘라 그 자리에서 편집한다(입력 칸은 이 조각 하나에만 있다).
 * - `rest`: 앞 쪽에서 이어지는 줄들. 읽기 전용(편집 anchor를 지운 글자)이라 같은 입력 칸이 두 번 나오지 않는다.
 */
export interface ViewerNotePiece {
  paragraph: ViewerParagraph
  source: ViewerParagraph
  part: 'whole' | 'head' | 'rest'
  clipHeight?: number
}

/**
 * 쪽(단) 아래에 놓인 각주 조각. `continued`면 앞 쪽에서 이어지는 조각이라 번호를 다시 쓰지 않고, `continues`면 다음 쪽에서 이어진다.
 * `height`는 pagination이 잡은 조각 높이(HWPUNIT, 각주 사이 간격 제외)다.
 */
export interface ViewerPageFootnote {
  note: ViewerNote
  marker: string
  pieces: ViewerNotePiece[]
  continued: boolean
  continues: boolean
  height: number
}

const HWPUNIT_PER_MM = 7200 / 25.4

/** 구분선 굵기(HWPUNIT). 선 종류가 없거나 길이가 0이면 0이다. */
export function footnoteLineThickness(settings: ViewerFootnoteSettings): number {
  if (!footnoteLineVisible(settings)) return 0
  return Math.max(Math.round(settings.line.widthMm * HWPUNIT_PER_MM), 1)
}

export function footnoteLineVisible(settings: ViewerFootnoteSettings): boolean {
  return settings.line.type !== 'NONE' && settings.line.length !== 0
}

/**
 * 구분선 길이(HWPUNIT). 음수(한/글 기본값 -1)는 단 너비의 1/3, 양수는 그 길이(단 너비를 넘지 않게)다.
 */
export function footnoteLineLength(settings: ViewerFootnoteSettings, columnWidth: number): number {
  if (!footnoteLineVisible(settings)) return 0
  return settings.line.length < 0 ? columnWidth / 3 : Math.min(settings.line.length, columnWidth)
}

/** 각주 영역 높이: 본문과 구분선 사이 + 구분선 + 구분선과 첫 각주 사이 + 각주 조각 높이 합 + 각주 사이 간격. */
export function footnoteAreaHeight(settings: ViewerFootnoteSettings, count: number, notesHeight: number): number {
  if (count <= 0) return 0
  return settings.spacing.aboveLine + footnoteLineThickness(settings) + settings.spacing.belowLine + notesHeight + settings.spacing.betweenNotes * (count - 1)
}

export function sectionFootnoteSettings(settings: ViewerFootnoteSettings | undefined): ViewerFootnoteSettings {
  return settings ?? DEFAULT_FOOTNOTE_SETTINGS
}

/** 측정 전 각주 높이: decoder 줄 배치 높이(문단마다 최소 1000) 합. 문단 경계에서만 나눈다. */
export function estimatedNoteMetrics(note: ViewerNote): ViewerNoteMetrics {
  const paragraphTops: number[] = []
  const breaks: NoteBreak[] = []
  let y = 0
  note.paragraphs.forEach((paragraph, index) => {
    paragraphTops.push(y)
    if (index > 0) breaks.push({ y, paragraph: index })
    y += Math.max(paragraph.layoutHeight, 1000)
  })
  return { height: Math.max(y, 1000), paragraphTops, breaks }
}

/** 각주 조각 경계 index(-1은 각주 처음, `breaks.length`는 끝)의 `y`. */
export function noteCursorY(metrics: ViewerNoteMetrics, cursor: number): number {
  if (cursor < 0) return 0
  if (cursor >= metrics.breaks.length) return metrics.height
  return metrics.breaks[cursor].y
}

/**
 * `from` 경계부터 높이 `space` 안에 들어가는 가장 먼 경계. 하나도 들어가지 않으면 `from`을 그대로 돌려준다.
 */
export function fitNoteCursor(metrics: ViewerNoteMetrics, from: number, space: number): number {
  const start = noteCursorY(metrics, from)
  let best = from
  for (let cursor = Math.max(from + 1, 0); cursor <= metrics.breaks.length; cursor += 1) {
    if (noteCursorY(metrics, cursor) - start <= space + 0.5) best = cursor
    else break
  }
  return best
}

function textItem(item: ViewerContent, text: string): ViewerContent {
  if (item.type !== 'text') return item
  const { sourceAnchor: _sourceAnchor, ...rest } = item
  return { ...rest, text }
}

/**
 * 문단 하나의 `from`~`to`(없으면 처음·끝) 글자. 나눈 조각은 읽기 전용이라 글자 run의 편집 anchor를 지운다.
 * 글머리 표시(`marker`)는 문단 처음이 든 조각에만 둔다.
 */
export function sliceNoteParagraph(paragraph: ViewerParagraph, from?: NoteTextPosition, to?: NoteTextPosition): ViewerParagraph {
  const content: ViewerContent[] = []
  paragraph.content.forEach((item, index) => {
    if (from && index < from.content) return
    if (to && index > to.content) return
    if (item.type !== 'text') {
      // 글자 run이 아닌 content(자리 표시 등)는 나눌 수 없다. 경계 content가 아니면 그대로 둔다.
      if ((!to || index < to.content) && (!from || index >= from.content)) content.push(item)
      return
    }
    const start = from && index === from.content ? from.offset : 0
    const end = to && index === to.content ? to.offset : item.text.length
    if (end > start) content.push(textItem(item, item.text.slice(start, end)))
  })
  const { marker, structureBlock: _structureBlock, ...rest } = paragraph
  return {
    ...rest,
    id: `${paragraph.id}@${from ? `${from.content}.${from.offset}` : '0'}`,
    ...(from ? {} : marker !== undefined ? { marker } : {}),
    content
  }
}

/** 각주의 `from`~`to` 경계 조각에 든 문단 조각. */
export function noteFragmentPieces(note: ViewerNote, metrics: ViewerNoteMetrics, from: number, to: number): ViewerNotePiece[] {
  const start: Omit<NoteBreak, 'y'> = from < 0 ? { paragraph: 0 } : metrics.breaks[from]
  const end: Omit<NoteBreak, 'y'> = to >= metrics.breaks.length ? { paragraph: note.paragraphs.length } : metrics.breaks[to]
  const last = end.position ? end.paragraph : end.paragraph - 1
  const pieces: ViewerNotePiece[] = []
  for (let index = start.paragraph; index <= last; index += 1) {
    const source = note.paragraphs[index]
    if (!source) continue
    const fromPosition = index === start.paragraph ? start.position : undefined
    const toPosition = index === end.paragraph ? end.position : undefined
    if (!fromPosition && !toPosition) {
      pieces.push({ paragraph: source, source, part: 'whole' })
      continue
    }
    const paragraph = sliceNoteParagraph(source, fromPosition, toPosition)
    if (fromPosition) pieces.push({ paragraph, source, part: 'rest' })
    else pieces.push({ paragraph, source, part: 'head', clipHeight: Math.max(noteCursorY(metrics, to) - (metrics.paragraphTops[index] ?? 0), 0) })
  }
  return pieces
}
