import type { ParagraphStructureBlock } from '../editing/paragraph_structure'
export type HwpUnit = number

export interface ViewerDocument {
  page: { width: HwpUnit; height: HwpUnit; margin: BoxSpacing; headerOffset: HwpUnit; footerOffset: HwpUnit }
  fonts: Record<string, string>
  charStyles: Record<string, ViewerCharStyle>
  paraStyles: Record<string, ViewerParaStyle>
  cellStyles: Record<string, ViewerCellStyle>
  resources: Record<string, ViewerResource>
  sections: ViewerSection[]
  diagnostics: ViewerDiagnostic[]
}

export interface ViewerPageNumber {
  position: string
  formatType: string
  sideChar: string
  start?: number
  hiddenOnFirstPage: boolean
}

export interface ViewerHeaderFooter {
  id: string
  applyPageType: string
  paragraphs: ViewerParagraph[]
}

export interface ViewerParseTimings {
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
}

export interface BoxSpacing { top: HwpUnit; right: HwpUnit; bottom: HwpUnit; left: HwpUnit }
export interface ViewerDiagnostic { source: string; message: string; code?: string }
export interface ViewerCharStyle { id: string; height: HwpUnit; color: string; bold: boolean; italic: boolean; underline: boolean; strikeout: boolean; fontId?: string; fontFamily?: string }
export interface ViewerParaStyle { id: string; align?: string; lineSpacing?: number; indent?: HwpUnit; margin: BoxSpacing; tabPrId?: string; heading?: ViewerHeadingStyle }
export interface ViewerHeadingStyle { type: string; idRef: string; level: number; bullet?: string; numberPattern?: string; numberFormat?: string }
export interface ViewerBorder { type: string; widthMm: number; color: string }
export interface ViewerCellStyle { id: string; backgroundColor?: string; left: ViewerBorder; right: ViewerBorder; top: ViewerBorder; bottom: ViewerBorder }
export interface ViewerResource { id: string; path: string; mime: string; data: string }
export interface ViewerColumnDefinition { width: HwpUnit; gap: HwpUnit }
export interface ViewerColumnLayout { type: string; layout: string; count: number; sameSize: boolean; sameGap: HwpUnit; columns: ViewerColumnDefinition[] }
export interface ViewerSection { id: string; blocks: ViewerParagraph[]; pageNumber?: ViewerPageNumber; columnLayout?: ViewerColumnLayout; headers: ViewerHeaderFooter[]; footers: ViewerHeaderFooter[] }
export interface ViewerParagraph {
  id: string
  paraStyleId: string
  pageBreak: boolean
  columnBreak?: boolean
  layoutTop?: HwpUnit
  layoutHeight: HwpUnit
  marker?: string
  content: ViewerContent[]
  /**
   * 원본 문단이 문단 구조 command(Enter 분할·경계 병합·여러 문단 범위)의 대상이 될 수 없는 이유. 없으면 구조 규칙을 통과한다.
   * 편집 코어와 같은 규칙(`editing/paragraph_structure.ts`)으로 decoder가 채운다. 글자 입력 가능 여부와는 관계없다.
   */
  structureBlock?: ParagraphStructureBlock
}
export type ViewerContent = ViewerText | ViewerTable | ViewerImage | ViewerObjectPlaceholder | ViewerNoteList
export interface ViewerSourceAnchor { sectionPath: string; textNodeId: string }
export interface ViewerText {
  type: 'text'
  text: string
  charStyleId: string
  sourceAnchor?: ViewerSourceAnchor
}
export interface ViewerImage { type: 'image'; resourceId?: string; width?: HwpUnit; height?: HwpUnit }

/** viewer가 원본처럼 그리지 못하는 run 안 개체의 종류. */
export type ViewerObjectKind =
  | 'equation'
  | 'chart'
  | 'ole'
  | 'text-box'
  | 'shape'
  | 'form-control'
  | 'video'
  | 'footnote'
  | 'endnote'
  | 'memo'
  | 'field'
  | 'ruby'
  | 'unknown'

/**
 * 개체가 본문 흐름에서 차지하는 자리.
 * - `inline`: 글자처럼 취급(`hp:pos treatAsChar="1"`). 선언 크기만큼 줄 안에 자리를 잡는다.
 * - `block`: 자리 차지(`TOP_AND_BOTTOM`·`SQUARE` 등). 선언 크기만큼 한 줄을 차지한다.
 * - `floating`: 글 앞·뒤(`IN_FRONT_OF_TEXT`·`BEHIND_TEXT`)라 원본에서 본문 자리를 차지하지 않는다. 작은 표시만 둔다.
 * - `marker`: 각주·미주 번호처럼 글자 크기로 줄 안에 놓인다.
 */
export type ViewerObjectFlow = 'inline' | 'block' | 'floating' | 'marker'

/**
 * 원본 개체 자리 표시. 원본 bytes는 package에 그대로 남고 화면·PDF에는 이 상자로 나온다. 편집하지 않는다(읽기 전용).
 */
export interface ViewerObjectPlaceholder {
  type: 'object-placeholder'
  kind: ViewerObjectKind
  /** 원본 element 이름(예: `hp:equation`). */
  element: string
  /** `${sectionPath}#${element}:${section 안 같은 element의 문서 순서 번호}`. section을 모르면 `#${element}:N`. */
  sourcePath: string
  flow: ViewerObjectFlow
  /** `hp:curSz`(0이 아니면) 또는 `hp:sz`의 선언 크기(HWPUNIT). */
  size?: { width: HwpUnit; height: HwpUnit }
  /** 화면에 보이는 한국어 이름(예: "수식"). */
  label: string
  /** 원본에서 읽은 대체 text(수식 script, 단추 caption, 덧말 본말 등). */
  fallbackText?: string
  /** 덧말(`hp:dutmal`)의 덧말 text와 위치. */
  ruby?: { text: string; position: 'top' | 'bottom' }
  /** 글상자·도형 글(`hp:drawText/hp:subList`)이나 메모 본문에서 되살린 읽기 전용 문단. */
  paragraphs?: ViewerParagraph[]
  /** 각주·미주 번호 표시(예: "1)"). */
  marker?: string
}

/** 구역 끝에 모아 보여 주는 각주·미주 본문 목록(읽기 전용). */
export interface ViewerNoteList {
  type: 'note-list'
  notes: ViewerNote[]
}
export interface ViewerNote { kind: 'footnote' | 'endnote'; marker: string; sourcePath: string; paragraphs: ViewerParagraph[] }
export interface ViewerTable { type: 'table'; id: string; rowCount: number; columnCount: number; width?: HwpUnit; height?: HwpUnit; pageBreak?: string; repeatHeader: boolean; rows: ViewerTableRow[] }
export interface ViewerTableRow { cells: ViewerTableCell[]; fragmentHeight?: HwpUnit }
export interface ViewerTableCell {
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
  borderFillId?: string
  verticalAlign?: string
  header: boolean
  paragraphs: ViewerParagraph[]
  sourceCellId?: string
  splitTop?: boolean
  splitBottom?: boolean
}

/**
 * 편집 가능 여부를 정할 때 건너뛰는 읽기 전용 개체 자리 표시인지. 자리 표시는 원본 개체를 그리기만 하므로 같은 문단의
 * 글자 run 편집 가능 여부(자리 표시를 넣기 전과 같다)를 바꾸지 않는다. 편집 코어와 renderer가 같은 규칙을 쓴다.
 */
export function isObjectPlaceholder(item: ViewerContent): item is ViewerObjectPlaceholder {
  return item.type === 'object-placeholder'
}

export function supportsViewerColumnFlow(layout?: ViewerColumnLayout): layout is ViewerColumnLayout {
  return Boolean(
    layout &&
    layout.count > 1 &&
    layout.type === 'NEWSPAPER' &&
    layout.layout === 'LEFT' &&
    layout.sameSize
  )
}

export function viewerColumnContentWidth(bodyWidth: HwpUnit, layout?: ViewerColumnLayout): HwpUnit {
  if (!supportsViewerColumnFlow(layout)) return bodyWidth
  return Math.max((bodyWidth - layout.sameGap * (layout.count - 1)) / layout.count, 0)
}
