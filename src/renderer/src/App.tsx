import { CSSProperties, DragEvent, memo, ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, WheelEvent } from 'react'
import { DocumentImportBackgroundError, DocumentImportComplete, DocumentImportResult } from '../../core/document/document_import'
import { BoxSpacing, isObjectPlaceholder, paragraphFootnotes, viewerColumnContentWidth, ViewerCellStyle, ViewerCharStyle, ViewerContent, ViewerDocument, ViewerFootnoteSettings, ViewerHeaderFooter, ViewerNote, ViewerNoteList, ViewerObjectPlaceholder, ViewerParagraph, ViewerResource, ViewerSection, ViewerSourceAnchor, ViewerTable, ViewerTableCell, ViewerText } from '../../core/document/viewer_document'
import { FixedPageDescriptor, FixedPageTextLayout } from '../../core/document/fixed_page_document'
import { applyViewerDocumentPatchIfCurrent } from '../../core/document/viewer_document_patch'
import { EditingActionResult, EditingResolveDirtyResult, EditingSaveAsDialogResult, EditingStartResult } from '../../core/editing/editing_contract'
import { TextCommitIntent } from '../../core/editing/composition_input'
import {
  cellParagraphStructure,
  EditingCapabilities,
  editingCapabilities,
  EditingCapabilityReason,
  ParagraphStructureGate,
  reconcileEditingSelection,
  sublistParagraphRangeScope,
  SublistStructure,
  tableParagraphRangeScope,
  tableParagraphTexts,
  topLevelParagraphStructure
} from '../../core/editing/editing_capability'
import { EditorSelection } from '../../core/editing/transaction'
import { isEmptyParagraphAnchorId, isSyntheticCaretAnchorId } from '../../core/editing/empty_paragraph_anchor'
import {
  equalTableCellSelections,
  reconcileTableCellSelection,
  selectableMergedTableCell,
  TableCellSelection
} from '../../core/editing/table_cell_selection'
import type { ParagraphAlignment } from '../../core/editing/style_patch'
import { cssPxToHwpUnit, hwpUnitToCssPx, hwpUnitToInches } from '../../core/layout/hwp_unit'
import { fixedPageOffsets, fixedPageVirtualRange } from '../../core/layout/fixed_page_virtualization'
import { cssFontFamilyName, KOREAN_SANS_STACK, resolveDocumentFonts } from '../../core/fonts/font_resolver'
import { LayoutMeasurements, pageColumnRegions, paginateViewerSectionsIncremental, SectionPagination, ViewerColumnRegion } from '../../core/layout/pagination'
import { footnoteLineLength, footnoteLineThickness, sectionFootnoteSettings, ViewerNoteMetrics, ViewerPageFootnote } from '../../core/layout/footnote_layout'
import { measureNoteElement } from './footnote_measurement'
import { paragraphIndentBox } from '../../core/layout/paragraph_indent'
import { cellMinimumHeight } from '../../core/layout/cell_fragment'
import {
  contentPlacement,
  HorizontalFrame,
  ObjectPlacement,
  objectX,
  objectY,
  PageBand,
  pageBandLayout,
  PageFrame,
  paragraphObjectOffset,
  PositionedContent,
  positionedContent,
  regionPageBands,
  wrapTextSide,
  blockObjectBands
} from '../../core/layout/object_position'
import { columnMeasurementGroups, ColumnMeasurementGroup, columnRects, columnSeparators, columnWidthKey } from '../../core/layout/column_layout'
import { formatPageNumber, pageNumberPosition } from '../../core/layout/page_number'
import { resolvePageDecorations } from '../../core/layout/page_decorations'
import { pinchZoom, stepZoom } from '../../core/layout/zoom'
import { waitForFixedPagePrintReady } from './pdf_print_readiness'
import { ParagraphInputSurface, ParagraphStructureAction } from './ParagraphInputSurface'
import {
  editingCapabilityStatus,
  editingErrorCode,
  editingErrorStatus,
  editingSelectionProjectionStatus,
  editingStatusTone,
  isEditingEngineFailure
} from './editing_error_status'
import {
  moveParagraphEditorSelection,
  paragraphEditorInstance,
  paragraphEditorRangeScope,
  paragraphEditorSurfaces,
  readParagraphEditorSelection,
  restoreParagraphEditorSelection
} from './paragraph_selection'
import { answerInputFlushRequest, DocumentLayoutMeasurements, EditingImeTransientState, EditingInputFlusher, selectionAfterInput } from './renderer_state'
import { MeasurementStylesTracker, resolveCharStyles, type ViewerRenderStyles } from './measurement_styles'
import { useRendererState } from './use_renderer_state'
import { ObjectPlaceholderBanner, ViewerColumnFlow, ViewerColumnRule, ViewerPageStack, ViewerStage, ViewerStatusBar } from './ViewerShell'
import { countIncompleteObjectPlaceholders, OBJECT_PAGE_HEIGHT_RATIO, totalObjectPlaceholders } from '../../core/document/object_placeholder'
import { hancomPuaDisplayText } from '../../core/document/hancom_pua_display'
import { ViewerToolbar } from './ViewerToolbar'
import { EquationView } from './EquationView'
import { APP_TITLE, documentFileName, documentTitle } from './document_title'
import { HistoryDirection, resolveShortcut, rendererPlatform } from './keyboard_shortcuts'

const api = () => (window as any).api
const shortcutPlatform = rendererPlatform()

type RhwpAdapter = typeof import('./rhwp_fixed_page_adapter')
let rhwpAdapter: Promise<RhwpAdapter> | null = null
const loadRhwpAdapter = (): Promise<RhwpAdapter> => {
  rhwpAdapter ??= import('./rhwp_fixed_page_adapter')
  return rhwpAdapter
}

const ms = (value: number): string => `${Math.round(value)}ms`

function borderCss(border: ViewerCellStyle['left']): string {
  return border.type === 'NONE' ? 'none' : `${Math.max(border.widthMm, 0.12)}mm solid ${border.color}`
}

export type { ViewerRenderStyles }

function textCss(item: Extract<ViewerContent, { type: 'text' }>, document: ViewerRenderStyles): CSSProperties {
  const style = document.charStyles[item.charStyleId]
  return {
    fontFamily: style?.fontFamily ? `${cssFontFamilyName(style.fontFamily)}, ${KOREAN_SANS_STACK}` : undefined,
    fontSize: style ? `${style.height / 100}pt` : undefined,
    fontWeight: style?.bold ? 700 : 400,
    fontStyle: style?.italic ? 'italic' : 'normal',
    textDecorationLine: [style?.underline && 'underline', style?.strikeout && 'line-through'].filter(Boolean).join(' ') || 'none',
    color: style?.color
  }
}

export function cellFragmentKey(tableId: string, cell: ViewerTableCell): string {
  const fragment = cell.splitTop ? (cell.splitBottom ? 'tb' : 't') : (cell.splitBottom ? 'b' : 'full')
  return `${tableId}:${cell.sourceCellId ?? `r${cell.row}c${cell.column}`}:${fragment}`
}

/** 글자 칸(`hp:t`)이 없는 빈 문단에 decoder가 붙인 합성 caret text인지(`empty_paragraph_anchor.ts`). */
export function isEmptyParagraphText(item: ViewerContent): boolean {
  return item.type === 'text' && isEmptyParagraphAnchorId(item.sourceAnchor?.textNodeId)
}

export function isEditableTableCell(cell: ViewerTableCell, measurable = false): boolean {
  return (
    !measurable &&
    !cell.splitTop &&
    !cell.splitBottom &&
    !cell.header &&
    cell.rowSpan === 1 &&
    cell.columnSpan === 1 &&
    cell.paragraphs.length > 0 &&
    // 빈 문단이 있는 셀은 문단 나눔·행열 command가 쓸 `hp:t`가 없으므로 text 전용 셀로 둔다.
    cell.paragraphs.every((paragraph) => isEditableTextParagraph(paragraph) && !paragraph.content.some(isEmptyParagraphText))
  )
}

export type TableCellEditingMode = 'structure' | 'text'

/**
 * 표 셀 편집 방식.
 * - `'structure'`: 병합되지 않은 일반 body 셀. text와 문단 나눔·범위 치환, 행·열·셀 style command를 허용한다.
 * - `'text'`: 병합·머리글 셀이나 여러 run 문단이 있는 셀. 문단 하나 안의 text 입력·삭제·치환과
 *   글자·문단 모양(capability가 ribbon·단축키를 연다)만 허용한다.
 * 쪽을 넘어 나뉜 셀 조각은 조각 사이 caret·선택 복원을 검증하지 않았으므로 편집하지 않는다.
 */
export function tableCellEditingMode(cell: ViewerTableCell, measurable = false): TableCellEditingMode | undefined {
  if (measurable || cell.splitTop || cell.splitBottom) return undefined
  if (isEditableTableCell(cell)) return 'structure'
  return cell.paragraphs.some((paragraph) => isEditableTextParagraph(paragraph, true)) ? 'text' : undefined
}

export function tableCellRangeScope(tableId: string, cell: ViewerTableCell): string | undefined {
  const text = cell.paragraphs.flatMap((paragraph) => paragraph.content)
    .find((item): item is ViewerText => item.type === 'text' && Boolean(item.sourceAnchor))
  return text?.sourceAnchor
    ? `${text.sourceAnchor.sectionPath}:table-cell:${cell.sourceCellId ?? `${tableId}:r${cell.row}c${cell.column}`}`
    : undefined
}

export function tableCellParagraphLabel(index: number, count: number, textOnly = false): string {
  const action = textOnly ? '글자 편집' : '편집'
  return count > 1
    ? `HWPX 표 셀 ${index + 1}/${count} 문단 ${action}`
    : `HWPX 표 셀 ${action}`
}

/** 셀 안 입력 surface에서 시작한 click·key는 병합 셀 선택이 아니라 text 편집으로 둔다. */
function fromEditorSurface(target: EventTarget | null): boolean {
  return typeof (target as Element | null)?.closest === 'function' &&
    Boolean((target as Element).closest('[data-editor-range-scope]'))
}

export function Content({
  item,
  document,
  measurable = false,
  contentIndex,
  editing
}: {
  item: ViewerContent
  document: ViewerRenderStyles
  measurable?: boolean
  /** 측정 DOM에서 각주 줄 경계를 content 순번으로 찾을 때 쓴다(`footnote_measurement.ts`). */
  contentIndex?: number
  editing?: ParagraphEditingProps
}) {
  if (item.type === 'text') {
    // 화면 표시만 검증된 한컴 PUA 기호를 표준 글자로 바꾼다(편집 입력 surface와 원문은 그대로).
    return <span style={textCss(item, document)} data-content-index={measurable ? contentIndex : undefined}>{hancomPuaDisplayText(item.text)}</span>
  }
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    // 쪽보다 높은 그림은 decoder가 같은 비율로 줄였다(`fitted`). E2E census가 줄여 그린 개체로 센다.
    return <img
      className="viewer-image"
      src={resourceDataUrl(resource)}
      data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
      style={{ width: item.width ? hwpUnitToCssPx(item.width) : undefined, height: item.height ? hwpUnitToCssPx(item.height) : undefined }}
    />
  }
  if (item.type === 'object-placeholder') return <ObjectPlaceholderView item={item} document={document} editing={measurable ? undefined : editing} />
  if (item.type === 'note-list') return <NoteListView item={item} document={document} editing={measurable ? undefined : editing} />
  return <TableView table={item} document={document} measurable={measurable} editing={editing} />
}

/**
 * 그림 resource의 data URL. 큰 그림(수 MB base64)을 render마다 이어 붙이면 새 문자열이 생기고 React가 이전 `src`와 글자 단위로
 * 비교해, 그림이 든 머리말·꼬리말이 있는 쪽마다 수십 ms가 든다. resource object마다 한 번만 만들어 같은 문자열을 쓴다.
 */
const resourceDataUrls = new WeakMap<ViewerResource, string>()
function resourceDataUrl(resource: ViewerResource): string {
  let url = resourceDataUrls.get(resource)
  if (url === undefined) {
    url = `data:${resource.mime};base64,${resource.data}`
    resourceDataUrls.set(resource, url)
  }
  return url
}

/** 문단들의 글자만 이어 붙인다(줄 안 메모·필드 표시용). */
function paragraphsPlainText(paragraphs: readonly ViewerParagraph[]): string {
  return hancomPuaDisplayText(paragraphs.map((paragraph) => paragraph.content.map((item) =>
    item.type === 'text' ? item.text : item.type === 'object-placeholder' ? item.fallbackText ?? '' : ''
  ).join('')).join(' ').trim())
}

/**
 * 원본처럼 그리지 못하는 개체의 자리 표시. 테두리 상자와 한국어 이름, 원본에서 읽은 대체 글(수식 script 등)을 보여 주고
 * 글상자 글은 읽기 전용 문단으로 안에 그린다. 화면과 인쇄(PDF)가 같은 모양이다.
 */
/**
 * 되살린 글이 든 자리 표시 본문이 쪽 본문 높이 한도(`OBJECT_PAGE_HEIGHT_RATIO`)를 넘으면 CSS `zoom`으로 글을 같은 비율로
 * 줄여 한 쪽 안에 둔다. `zoom`은 layout 크기도 줄이므로 측정·pagination·PDF가 같은 높이를 본다. 상태 대신 DOM style을
 * layout effect에서 바로 고쳐 같은 commit의 높이 측정이 줄인 높이를 읽게 한다.
 */
function useFitBodyHeight(limitPx: number | undefined) {
  const bodyRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || !limitPx) return
    body.style.removeProperty('zoom')
    delete body.dataset.fitScale
    const natural = body.scrollHeight
    if (natural <= limitPx) return
    const scale = Math.max(limitPx / natural, 0.05)
    body.style.setProperty('zoom', String(scale))
    body.dataset.fitScale = scale.toFixed(3)
  })
  return bodyRef
}

export function ObjectPlaceholderView({ item, document, positioned = false, editing }: {
  item: ViewerObjectPlaceholder
  document: ViewerRenderStyles
  /** 원본 위치로 그리는 개체 상자(`PositionedObjectBody`) 안을 채운다. */
  positioned?: boolean
  /** 편집 중이면 글자만 든 글상자 글·메모 본문을 입력 칸으로 그린다(`objectTextEditing`). */
  editing?: ParagraphEditingProps
}) {
  // 일부 단위 테스트는 쪽 설정 없는 문서 조각을 넘긴다.
  const page = document.page as ViewerDocument['page'] | undefined
  const pageBodyHeight = page ? page.height - page.margin.top - page.margin.bottom : 0
  const bodyRef = useFitBodyHeight(pageBodyHeight > 0 ? hwpUnitToCssPx(pageBodyHeight * OBJECT_PAGE_HEIGHT_RATIO) : undefined)
  const common = {
    'data-object-kind': item.kind,
    'data-object-element': item.element,
    'data-source-path': item.sourcePath,
    contentEditable: false as const
  }
  if (item.kind === 'footnote' || item.kind === 'endnote') {
    return <sup {...common} className="viewer-note-marker" title={`${item.label} ${item.marker ?? ''}`.trim()}>{item.marker}</sup>
  }
  if (item.kind === 'equation' && item.equation) return <EquationView item={item} positioned={positioned} common={common} />
  if (item.kind === 'ruby' && item.ruby) {
    return <ruby {...common} className={`viewer-ruby viewer-ruby-${item.ruby.position}`} title="덧말">{item.fallbackText}<rt>{item.ruby.text}</rt></ruby>
  }
  const reserve = item.size && (item.flow === 'inline' || item.flow === 'block')
  // 수식은 script가 선언 크기보다 길기 마련이라 폭을 최소값으로만 두어 한 줄로 읽히게 한다.
  const style: CSSProperties = positioned
    ? { width: '100%', minHeight: '100%' }
    : reserve
    ? item.kind === 'equation'
      ? { minWidth: hwpUnitToCssPx(item.size!.width), minHeight: hwpUnitToCssPx(item.size!.height) }
      : { width: hwpUnitToCssPx(item.size!.width), minHeight: hwpUnitToCssPx(item.size!.height) }
    : {}
  const markerText = item.flow === 'marker' && item.paragraphs ? paragraphsPlainText(item.paragraphs) : ''
  // 글상자처럼 되살린 문단이 있으면 이름표를 모서리에 겹쳐 두어 상자가 선언 크기보다 커지지 않게 한다.
  const hasBody = item.flow !== 'marker' && Boolean(item.paragraphs?.length)
  const bodyEditing = objectTextEditing(item, editing)
  return <span
    {...common}
    className={`viewer-object-placeholder viewer-object-${positioned ? 'block' : item.flow}${hasBody ? ' viewer-object-with-body' : ''}${item.fitted ? ' viewer-object-fitted' : ''}`}
    data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
    role="group"
    aria-label={`${item.label} (원본 개체 자리 표시${item.fitted ? ', 쪽에 맞게 줄임' : ''})`}
    title={`${item.label}: 원본 개체를 그대로 그리지 못해 자리 표시로 보여 줍니다.${item.fitted ? ' 원본 높이가 쪽보다 커서 줄여 표시합니다.' : ''} 저장할 때 원본은 그대로 보존합니다.`}
    style={style}
  >
    {/* 줄 안 표시의 쌍점은 CSS ::after가 아니라 글자로 둔다. ::after 글은 화면 innerText에 없지만 PDF에는 추출돼 글자 수가 어긋난다. */}
    <span className="viewer-object-label">{item.fitted ? `${item.label} (축소)` : item.label}{item.flow === 'marker' && (item.fallbackText || markerText) ? ':' : ''}</span>
    {item.fallbackText && <span className={`viewer-object-fallback${item.kind === 'equation' ? ' viewer-object-script' : ''}`}>{item.fallbackText}</span>}
    {/* 편집 중인 메모는 줄 안 본문 글 자리에 같은 글을 입력 칸으로 그린다(보기 모드와 같은 글이라 줄 배치가 거의 같다). */}
    {markerText && (item.kind === 'memo' && bodyEditing
      ? <span className="viewer-object-fallback viewer-memo-body">
          {item.paragraphs!.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} editing={bodyEditing} />)}
        </span>
      : <span className="viewer-object-fallback">{markerText}</span>)}
    {hasBody && <ContainerBody item={item} document={document} bodyRef={bodyRef} editing={bodyEditing} />}
  </span>
}

/**
 * 원본 위치로 그리는 개체(`hp:pos treatAsChar="0"`)가 놓인 쪽과 단(용지 기준 HWPUNIT). 본문 최상위 문단은 놓인 쪽·단, 머리말·꼬리말
 * 문단은 쪽 본문 폭, 표 셀·글상자 문단은 칸 기준 가상 용지(`containerObjectFrame`)를 받는다. 각주 안 문단은 받지 않아 개체를 줄 흐름
 * 안에 그대로 둔다. 측정 DOM은 첫 단·1쪽으로 잰다(문단 기준 개체와 칸 안 개체만 높이에 든다).
 */
export interface ObjectFrame {
  page: PageFrame
  columnLeft: number
  columnWidth: number
  /** 1부터 센 쪽 번호(안쪽·바깥쪽 가로 맞춤). */
  pageNumber: number
}

/** 문단 왼쪽·오른쪽 여백 안쪽을 문단 기준 가로 범위로 쓴다(내어쓰기 폭은 문단 안이다). */
export function paragraphHorizontalFrame(frame: ObjectFrame, marginLeft: number, marginRight: number): HorizontalFrame {
  return {
    columnLeft: frame.columnLeft,
    columnWidth: frame.columnWidth,
    paraLeft: frame.columnLeft + marginLeft,
    paraWidth: Math.max(frame.columnWidth - marginLeft - marginRight, 0)
  }
}

/** 글 뒤 개체는 본문 글 아래(쪽 배경 위), 나머지는 본문 글 위에 그린다. 쪽(`.viewer-page`)이 stacking context다. */
function objectZIndex(item: PositionedContent): number {
  return item.position.wrap === 'BEHIND_TEXT' ? -1 : 1
}

/**
 * 개체가 자리를 잡는 상자 크기(한/글이 쪽 배치에 쓰는 `hp:sz`). 표는 행 높이대로 늘어난다. 글상자 글이 이 높이보다 길면 상자는
 * 아래로 넘쳐 그리되(한/글처럼) 본문 자리는 선언 높이만큼만 잡는다.
 */
function positionedBoxSize(item: PositionedContent): CSSProperties {
  const width = hwpUnitToCssPx(item.position.width)
  if (item.type === 'table') return { width }
  return { width, height: hwpUnitToCssPx(item.position.height) }
}

/**
 * 표 셀처럼 편집하는 개체가 아니면 글 앞·뒤 개체가 밑의 본문 글 선택·caret을 가리지 않게 한다. 편집 중인 글상자(글자만 든
 * 글상자)는 그 글을 누를 수 있게 둔다.
 */
function positionedPointerEvents(item: PositionedContent, placement: ObjectPlacement, editing?: ParagraphEditingProps): CSSProperties['pointerEvents'] {
  if (item.type === 'table' || (item.type === 'object-placeholder' && objectTextEditing(item, editing))) return undefined
  return placement === 'overlay' || placement === 'page' ? 'none' : undefined
}

const SHAPE_SVG_ELEMENTS = new Set(['hp:rect', 'hp:ellipse', 'hp:line', 'hp:polygon'])

/** 사각형·타원·선·다각형을 원본 선·채우기로 그린다. 선 굵기는 화면에서 보이도록 0.5pt 이상으로 둔다. */
export function ShapeView({ item }: { item: ViewerObjectPlaceholder & { position: NonNullable<ViewerObjectPlaceholder['position']> } }) {
  const width = Math.max(item.position.width, 1)
  const height = Math.max(item.position.height, 1)
  const shape = item.shape ?? {}
  const paint = {
    fill: shape.fill ?? 'none',
    stroke: shape.stroke?.color ?? 'none',
    strokeWidth: shape.stroke ? Math.max(shape.stroke.width, 50) : 0
  }
  const points = shape.points?.map((point) => `${point.x},${point.y}`).join(' ')
  // 굵은 선·높이 0인 가로선도 잘리지 않게 SVG 상자를 선 굵기 절반만큼 넓히고 그만큼 왼쪽 위로 옮긴다.
  const pad = paint.strokeWidth / 2
  const figure = item.element === 'hp:ellipse'
    ? <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...paint} />
    : item.element === 'hp:line'
      ? <line x1={shape.points?.[0]?.x ?? 0} y1={shape.points?.[0]?.y ?? 0} x2={shape.points?.[1]?.x ?? width} y2={shape.points?.[1]?.y ?? 0} {...paint} fill="none" />
      : item.element === 'hp:polygon' && points
        ? <polygon points={points} {...paint} />
        : <rect x={0} y={0} width={width} height={height} {...paint} />
  return <svg
    className="viewer-shape"
    data-object-kind={item.kind}
    data-object-element={item.element}
    data-source-path={item.sourcePath}
    role="img"
    aria-label={item.label}
    width={hwpUnitToCssPx(width + pad * 2)}
    height={hwpUnitToCssPx(height + pad * 2)}
    viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
    style={pad ? { marginLeft: -hwpUnitToCssPx(pad), marginTop: -hwpUnitToCssPx(pad) } : undefined}
    overflow="visible"
  >{figure}</svg>
}

/**
 * 원본 위치에 그리는 글상자. 원본 선·채우기·안쪽 여백·세로 맞춤으로 상자를 그리고 글은 읽기 전용 문단으로 안에 둔다. 글이 쪽 본문
 * 높이 한도(`OBJECT_PAGE_HEIGHT_RATIO`)를 넘으면 자리 표시처럼 같은 비율로 줄인다.
 */
export function TextBoxView({ item, document, editing }: { item: ViewerObjectPlaceholder; document: ViewerRenderStyles; editing?: ParagraphEditingProps }) {
  const page = document.page as ViewerDocument['page'] | undefined
  const pageBodyHeight = page ? page.height - page.margin.top - page.margin.bottom : 0
  const bodyRef = useFitBodyHeight(pageBodyHeight > 0 ? hwpUnitToCssPx(pageBodyHeight * OBJECT_PAGE_HEIGHT_RATIO) : undefined)
  const shape = item.shape
  const margin = shape?.textMargin
  const align = shape?.textVerticalAlign
  const bodyEditing = objectTextEditing(item, editing)
  return <div
    className={`viewer-text-box${item.fitted ? ' viewer-object-fitted' : ''}`}
    data-object-kind={item.kind}
    data-object-element={item.element}
    data-source-path={item.sourcePath}
    data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
    contentEditable={false}
    role="group"
    aria-label={`${item.label}${item.fitted ? ' (쪽에 맞게 줄임)' : ''}`}
    style={{
      border: shape?.stroke ? `${Math.max(hwpUnitToCssPx(shape.stroke.width), 0.75)}px solid ${shape.stroke.color}` : undefined,
      background: shape?.fill,
      minHeight: item.position ? hwpUnitToCssPx(item.position.height) : undefined,
      padding: margin ? `${hwpUnitToCssPx(margin.top)}px ${hwpUnitToCssPx(margin.right)}px ${hwpUnitToCssPx(margin.bottom)}px ${hwpUnitToCssPx(margin.left)}px` : undefined,
      justifyContent: align === 'CENTER' ? 'center' : align === 'BOTTOM' ? 'flex-end' : 'flex-start'
    }}
  >
    <ContainerBody item={item} document={document} bodyRef={bodyRef} editing={bodyEditing} />
  </div>
}

/**
 * 글상자 글(되살린 읽기 전용 문단). 안쪽 여백 안 글 영역을 칸으로 보고 그 안 글자처럼 취급하지 않는 개체를 칸 기준 원본 위치에
 * 그린다(`containerObjectFrame`). 크기를 모르는 상자는 개체를 줄 흐름 안에 둔다.
 */
function ContainerBody({ item, document, bodyRef, editing }: {
  item: ViewerObjectPlaceholder
  document: ViewerRenderStyles
  bodyRef: RefObject<HTMLSpanElement>
  editing?: ParagraphEditingProps
}) {
  const size = item.position ?? item.size
  const margin = item.shape?.textMargin
  const frame = size
    ? containerObjectFrame(
        Math.max(size.width - (margin?.left ?? 0) - (margin?.right ?? 0), 0),
        Math.max(size.height - (margin?.top ?? 0) - (margin?.bottom ?? 0), 0)
      )
    : undefined
  const paragraphs = item.paragraphs!
  const layered = Boolean(frame) && hasContainerPageObjects(paragraphs)
  // 칸 기준 개체가 있으면 글 영역 전체를 기준 상자로 쓰도록 본문을 글 영역 높이로 늘린다(이때 글은 위에 맞춘다).
  return <span className="viewer-object-body" ref={bodyRef} style={layered ? { position: 'relative', minHeight: hwpUnitToCssPx(frame!.page.height) } : undefined}>
    {frame && <ContainerObjectLayer paragraphs={paragraphs} frame={frame} container="text-box" document={document} />}
    {paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} objectFrame={frame} editing={editing} />)}
  </span>
}

/** 원본 위치 개체의 내용(그림·표·글상자·도형·자리 표시). 크기는 감싼 상자(`positionedBoxSize`)가 정한다. */
function PositionedObjectBody({ item, document, measurable, editing }: {
  item: PositionedContent
  document: ViewerRenderStyles
  measurable: boolean
  editing?: ParagraphEditingProps
}) {
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    return <img
      className="viewer-image viewer-image-positioned"
      src={resourceDataUrl(resource)}
      data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
      style={{ width: '100%', height: '100%' }}
    />
  }
  if (item.type === 'table') return <TableView table={item} document={document} measurable={measurable} editing={editing} />
  if (item.kind === 'text-box' && item.paragraphs?.length) return <TextBoxView item={item} document={document} editing={editing} />
  if (item.kind === 'shape' && SHAPE_SVG_ELEMENTS.has(item.element)) return <ShapeView item={item} />
  return <ObjectPlaceholderView item={item} document={document} positioned editing={editing} />
}

/**
 * 문단 기준 개체(`band`·`wrap`·`overlay`)를 그 문단 안에 그린다. 세로는 문단 위 끝에서 `vertOffset`, 가로는 원본 기준·맞춤으로
 * 정한 용지 위치를 문단 왼쪽 끝 기준으로 바꾼다.
 * - `band`: 문단 흐름 안 블록(개체 높이와 아래 바깥 여백만큼 뒤 글을 민다).
 * - `wrap`: 문단 안 float. 문단 글이 줄 단위로 개체 옆을 흐른다(흐를 쪽은 `wrapTextSide`, float는 그 반대쪽).
 * - `overlay`: 문단 기준 절대 위치(글 흐름에 영향 없음).
 */
function ParagraphObjectView({ item, placement, frame, horizontal, paddingLeft, document, measurable, editing }: {
  item: PositionedContent
  placement: Exclude<ObjectPlacement, 'page'>
  frame: ObjectFrame
  horizontal: HorizontalFrame
  /** 내어쓰기 폭. 흐름 안 개체는 문단 content box 기준이라 이만큼 뺀다. */
  paddingLeft: number
  document: ViewerRenderStyles
  measurable: boolean
  editing?: ParagraphEditingProps
}) {
  const position = item.position
  const x = objectX(position, frame.page, horizontal, frame.pageNumber)
  const relativeX = x - horizontal.paraLeft
  const box = positionedBoxSize(item)
  let style: CSSProperties
  if (placement === 'band') {
    style = {
      ...box,
      boxSizing: 'content-box',
      marginLeft: hwpUnitToCssPx(relativeX - paddingLeft),
      paddingTop: hwpUnitToCssPx(paragraphObjectOffset(position, true)),
      paddingBottom: hwpUnitToCssPx(position.outMargin.bottom)
    }
  } else if (placement === 'wrap') {
    const paraRight = horizontal.paraLeft + horizontal.paraWidth
    const rightGap = paraRight - x - position.width
    const side = wrapTextSide(position.textFlow, x - position.outMargin.left - horizontal.paraLeft, rightGap - position.outMargin.right)
    // 글이 오른쪽(또는 어느 쪽에도 못 흐름)이면 왼쪽 float. 못 흐르면 float가 문단 폭을 다 차지해 글이 개체 아래로 간다.
    const floatLeft = side !== 'left'
    style = {
      ...box,
      boxSizing: 'content-box',
      float: floatLeft ? 'left' : 'right',
      marginTop: hwpUnitToCssPx(paragraphObjectOffset(position, true)),
      marginBottom: hwpUnitToCssPx(position.outMargin.bottom),
      marginLeft: hwpUnitToCssPx(floatLeft ? relativeX - paddingLeft : position.outMargin.left),
      marginRight: hwpUnitToCssPx(floatLeft ? side === 'none' ? Math.max(rightGap, position.outMargin.right) : position.outMargin.right : rightGap)
    }
  } else {
    style = {
      ...box,
      position: 'absolute',
      left: hwpUnitToCssPx(relativeX),
      top: hwpUnitToCssPx(paragraphObjectOffset(position, false)),
      zIndex: objectZIndex(item),
      pointerEvents: positionedPointerEvents(item, placement, editing)
    }
  }
  return <div
    className={`viewer-float viewer-float-${placement}`}
    data-object-placement={placement}
    data-object-wrap={position.wrap}
    style={style}
  ><PositionedObjectBody item={item} document={document} measurable={measurable} editing={editing} /></div>
}

/** 용지·쪽 기준 개체 하나를 쪽 위 절대 위치(용지 왼쪽 위 기준)에 그린다. */
function PageObjectView({ item, frame, horizontal, document, editing, container }: {
  item: PositionedContent
  frame: ObjectFrame
  horizontal: HorizontalFrame
  document: ViewerRenderStyles
  editing?: ParagraphEditingProps
  container?: ObjectContainer
}) {
  const x = objectX(item.position, frame.page, horizontal, frame.pageNumber)
  const y = objectY(item.position, frame.page)
  return <div
    className="viewer-float viewer-float-page"
    data-object-placement="page"
    data-object-wrap={item.position.wrap}
    data-object-container={container}
    style={{
      ...positionedBoxSize(item),
      position: 'absolute',
      left: hwpUnitToCssPx(x),
      top: hwpUnitToCssPx(y),
      zIndex: objectZIndex(item),
      pointerEvents: positionedPointerEvents(item, 'page', editing)
    }}
  ><PositionedObjectBody item={item} document={document} measurable={false} editing={editing} /></div>
}

/**
 * 쪽에 놓인 block(본문 최상위 문단)의 용지·쪽 기준 개체를 쪽 위 절대 위치에 모아 그린다. 단이 여럿이면 block이 놓인 다단 영역·단을
 * 쓴다(단 기준 가로 위치).
 */
export function PageObjectLayer({ blocks, regions, frameOf, document, editing, container }: {
  blocks: readonly ViewerParagraph[]
  regions?: readonly Pick<ViewerColumnRegion, 'columns'>[]
  frameOf: (regionIndex: number, columnIndex: number) => ObjectFrame
  document: ViewerRenderStyles
  editing?: ParagraphEditingProps
  /** 머리말·꼬리말·표 셀·글상자 문단의 개체면 그 칸 종류(`data-object-container`). 본문 최상위 문단이면 없다. */
  container?: ObjectContainer
}) {
  const objects: ReactNode[] = []
  for (const block of blocks) {
    const items = block.content.filter((item): item is PositionedContent => positionedContent(item) && contentPlacement(item) === 'page')
    if (!items.length) continue
    let regionIndex = 0
    let columnIndex = 0
    regions?.some((region, index) => {
      const column = region.columns.findIndex((candidate) => candidate.includes(block))
      if (column < 0) return false
      regionIndex = index
      columnIndex = column
      return true
    })
    const frame = frameOf(regionIndex, columnIndex)
    const style = document.paraStyles[block.paraStyleId]
    const indent = paragraphIndentBox(style?.margin ?? {}, style?.indent)
    const horizontal = paragraphHorizontalFrame(frame, indent.marginLeft, style?.margin.right ?? 0)
    items.forEach((item, index) => objects.push(<PageObjectView
      key={`${block.id}:page-object${index}`}
      item={item}
      frame={frame}
      horizontal={horizontal}
      document={document}
      editing={editing}
      container={container}
    />))
  }
  return <>{objects}</>
}

/** 원본 위치 개체를 품은 칸. 본문 최상위 문단 밖에서 원본 위치로 그리는 개체에 `data-object-container`로 붙인다. */
export type ObjectContainer = 'cell' | 'text-box' | 'header' | 'footer'

/**
 * 표 셀·글상자 안 개체의 기준 영역. 칸(표 셀은 안쪽 여백을 포함한 칸, 글상자는 안쪽 여백 안 글 영역)을 용지로, 그 안쪽 여백 안을
 * 쪽 본문·단으로 본다. 그래서 칸 안 개체의 용지·쪽 기준 위치는 칸 왼쪽 위에서, 문단 기준 위치는 칸 안 문단에서 잰다. 칸 안에는
 * 쪽 번호가 없으므로 안쪽·바깥쪽 맞춤은 홀수 쪽으로 본다.
 */
export function containerObjectFrame(width: number, height: number, margin: BoxSpacing = { top: 0, right: 0, bottom: 0, left: 0 }): ObjectFrame {
  return {
    page: { width, height, margin },
    columnLeft: margin.left,
    columnWidth: Math.max(width - margin.left - margin.right, 0),
    pageNumber: 1
  }
}

/** 칸 안 문단에 칸 기준(용지·쪽 기준, `contentPlacement` = `page`)으로 그릴 개체가 있는지. */
function hasContainerPageObjects(paragraphs: readonly ViewerParagraph[]): boolean {
  return paragraphs.some((paragraph) => paragraph.content.some((item) => contentPlacement(item) === 'page'))
}

/**
 * 표 셀·글상자 안 문단의 용지·쪽 기준 개체를 칸 기준 원본 위치에 그린다. 칸 요소(`position: relative`, 안쪽 여백 상자가 기준)의
 * 맨 앞에 두어, 글 앞·뒤가 아닌 개체는 쪽 본문 띠처럼 칸 글 흐름에서 세로 띠(글 옆 배치는 개체 옆 남은 폭)를 비운다. 칸은 글이
 * 늘면 함께 늘어나므로 칸 아래 끝에 닿는 띠도 float로 비운다.
 */
function ContainerObjectLayer({ paragraphs, frame, container, document, editing }: {
  paragraphs: readonly ViewerParagraph[]
  frame: ObjectFrame
  container: ObjectContainer
  document: ViewerRenderStyles
  editing?: ParagraphEditingProps
}) {
  if (!hasContainerPageObjects(paragraphs)) return null
  const bands = paragraphs.flatMap((paragraph) => blockObjectBands(paragraph, frame.page, true))
  return <>
    <PageBandSpacers bands={bands} bodyHeight={Infinity} />
    <PageObjectLayer blocks={paragraphs} frameOf={() => frame} document={document} editing={editing} container={container} />
  </>
}

/**
 * pagination이 쪽 본문에서 비운 용지·쪽 기준 개체 띠(`ViewerPage.bands`)를 본문 DOM에서도 비운다(`pageBandLayout`). 본문 위 끝
 * 띠는 빈 블록, 가운데 띠는 폭 0 float로 띠 위까지 내려간 뒤 폭 전체 float로 띠를 차지한다. 아래 끝 띠는 pagination이 덜 채운다.
 */
export function PageBandSpacers({ bands, bodyHeight }: { bands?: readonly PageBand[]; bodyHeight: number }) {
  if (!bands?.length) return null
  const layout = pageBandLayout(bands, bodyHeight)
  let previous = layout.top
  // 글 옆 배치 띠(`wrap`)는 개체 쪽 끝에서 개체까지만 비우는 좁은 float라 글이 남은 폭으로 흐른다. 오른쪽 float가 앞 띠 옆에
  // 올라붙지 않도록 그때는 모든 float가 양쪽을 비운다(clear both).
  const clear = layout.middle.some((band) => band.wrap) ? 'both' : 'left'
  return <>
    {layout.top > 0 && <div className="viewer-float-band-spacer" aria-hidden="true" style={{ height: hwpUnitToCssPx(layout.top) }} />}
    {layout.middle.map((band, index) => {
      const gap = Math.max(band.top - previous, 0)
      previous = band.bottom
      return [
        <div key={`gap${index}`} className="viewer-float-band-spacer" aria-hidden="true" style={{ float: 'left', clear, width: 0, height: hwpUnitToCssPx(gap) }} />,
        <div
          key={`band${index}`}
          className="viewer-float-band-spacer"
          aria-hidden="true"
          data-band-wrap={band.wrap?.float}
          style={{ float: band.wrap?.float ?? 'left', clear, width: band.wrap ? hwpUnitToCssPx(band.wrap.width) : '100%', height: hwpUnitToCssPx(band.bottom - band.top) }}
        />
      ]
    })}
  </>
}

const TABLE_PARAGRAPH_SURFACE_LABEL = 'HWPX 표 앞뒤 글자 편집'
const MEMO_STRUCTURE_GATE: ParagraphStructureGate = { split: 'SUBLIST_TEXT', mergePrevious: 'SUBLIST_TEXT', mergeNext: 'SUBLIST_TEXT' }
const TABLE_PARAGRAPH_GATE: ParagraphStructureGate = { split: 'TABLE_PARAGRAPH', mergePrevious: 'TABLE_PARAGRAPH', mergeNext: 'TABLE_PARAGRAPH' }

/**
 * 각주·미주·머리말·꼬리말·글상자·메모 문단의 편집 props. 글자 입력·삭제·치환(문단 하나 범위, 여러 run 허용)을 받고, 메모가 아니면
 * capability와 같은 문단 구조 gate(`documentStructureOf`, 개체가 든 문단·빈 문단은 막는다)로 Enter·경계 병합도 받는다. 메모는
 * 문단 나눔·병합을 `SUBLIST_TEXT`로 막는다. 표·그림이 든 문단은 `isEditableTextParagraph`가 걸러 읽기 전용이다.
 */
export function sublistParagraphEditing(
  editing: ParagraphEditingProps | undefined,
  structure: SublistStructure,
  surfaceLabel: string,
  desiredSelection: EditorSelection | undefined
): ParagraphEditingProps | undefined {
  const memo = structure === 'MEMO_TEXT'
  return editing && {
    ...editing,
    surfaceLabel,
    allowMultipleRuns: true,
    allowParagraphRange: false,
    allowParagraphStructure: !memo,
    allowTableParagraph: false,
    rangeScope: undefined,
    rangeScopeOf: (sectionPath, paragraphId) => sublistParagraphRangeScope(sectionPath, structure, paragraphId),
    structureOf: memo ? undefined : editing.documentStructureOf,
    structureGate: memo ? MEMO_STRUCTURE_GATE : undefined,
    allowParagraphMergePrevious: true,
    allowParagraphMergeNext: true,
    desiredSelection
  }
}

const TEXT_BOX_SURFACE_LABEL = 'HWPX 글상자 편집'
const MEMO_SURFACE_LABEL = 'HWPX 메모 편집'

/**
 * 글상자 글·메모 본문의 편집 props. decoder가 anchor를 붙인(글자만 든) 글상자·메모이고 편집 중일 때만 있다. 개체가 든 글상자·메모와
 * 필드 subList는 읽기 전용이다. 머리말 안 글상자처럼 쪽마다 되풀이되는 글상자는 바깥 편집 props의 selection 복원을 그대로 따른다.
 */
export function objectTextEditing(item: ViewerObjectPlaceholder, editing: ParagraphEditingProps | undefined): ParagraphEditingProps | undefined {
  if (!editing || (item.kind !== 'text-box' && item.kind !== 'memo') || !item.paragraphs?.length) return undefined
  if (!item.paragraphs.some((paragraph) => isEditableTextParagraph(paragraph, true))) return undefined
  return item.kind === 'memo'
    ? sublistParagraphEditing(editing, 'MEMO_TEXT', MEMO_SURFACE_LABEL, editing.desiredSelection)
    : sublistParagraphEditing(editing, 'TEXT_BOX_TEXT', TEXT_BOX_SURFACE_LABEL, editing.desiredSelection)
}

/** 구역 끝에 모은 미주 본문. 편집 중에는 본문 문단의 글자를 고칠 수 있다(번호·본문 위치의 번호 표시는 그대로). */
export function NoteListView({ item, document, editing }: { item: ViewerNoteList; document: ViewerRenderStyles; editing?: ParagraphEditingProps }) {
  const noteEditing = sublistParagraphEditing(editing, 'NOTE_TEXT', 'HWPX 각주·미주 편집', editing?.desiredSelection)
  const groups = (['footnote', 'endnote'] as const)
    .map((kind) => ({ kind, notes: item.notes.filter((note) => note.kind === kind) }))
    .filter((group) => group.notes.length)
  // decoder는 쪽 사이에서 나눌 수 있게 각주·미주 문단마다 block을 만든다. 이어지는 block은 구분선·같은 종류 제목·같은 각주 번호를 다시 쓰지 않는다.
  return <div className={`viewer-note-list${item.continuesKind ? ' viewer-note-list-continued' : ''}`} data-object-kind="note-list" contentEditable={false}>
    {groups.map((group) => <section key={group.kind} className="viewer-note-group" data-note-kind={group.kind}>
      {item.continuesKind !== group.kind && <div className="viewer-note-heading">{group.kind === 'footnote' ? '각주' : '미주'}</div>}
      {group.notes.map((note) => <div key={note.sourcePath} className="viewer-note" data-source-path={note.sourcePath}>
        <span className="viewer-note-number">{item.continuesNote ? '' : note.marker}</span>
        <div className="viewer-note-body">{note.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} editing={noteEditing} />)}</div>
      </div>)}
    </section>)}
  </div>
}

const FOOTNOTE_LINE_STYLES: Record<string, CSSProperties['borderTopStyle']> = {
  DASH: 'dashed', DOT: 'dotted', DASH_DOT: 'dashed', DASH_DOT_DOT: 'dashed', LONG_DASH: 'dashed', CIRCLE: 'dotted',
  DOUBLE_SLIM: 'double', SLIM_THICK: 'double', THICK_SLIM: 'double', SLIM_THICK_SLIM: 'double'
}

/**
 * 쪽(단) 아래 각주 하나의 조각. 번호·본문 배치는 구역 끝 미주 목록과 같다(`.viewer-note`). 앞 쪽에서 이어지는 조각은 번호
 * 칸을 보이지 않게 남겨(본문 폭이 측정 때와 같아 줄이 같은 자리에서 바뀐다) 번호를 다시 쓰지 않는다.
 * 편집 중에는 온전한 문단과 앞 줄 조각(`head`, 원본 문단 전체를 조각 높이로 잘라 그린다)만 입력 칸이고, 이어지는 줄 조각은 읽기 전용이다.
 */
export function FootnoteView({ footnote, superscript, document, editing, measureId }: {
  footnote: Pick<ViewerPageFootnote, 'note' | 'marker' | 'pieces' | 'continued' | 'continues'>
  superscript: boolean
  document: ViewerRenderStyles
  editing?: ParagraphEditingProps
  /** 측정 DOM에서 각주 전체를 그릴 때 `data-measure-note`로 쓰는 각주 source path. */
  measureId?: string
}) {
  const measurable = measureId !== undefined
  return <div
    className={`viewer-note viewer-footnote${footnote.continued ? ' viewer-footnote-continued' : ''}`}
    data-source-path={footnote.note.sourcePath}
    data-measure-note={measureId}
    data-footnote-continues={footnote.continues ? 'true' : undefined}
  >
    <span className={`viewer-note-number${superscript ? ' viewer-note-number-sup' : ''}`} style={footnote.continued ? { visibility: 'hidden' } : undefined} aria-hidden={footnote.continued || undefined}>{footnote.marker}</span>
    <div className="viewer-note-body">{footnote.pieces.map((piece) => {
      if (piece.part === 'head' && editing && !measurable) {
        return <div key={piece.paragraph.id} className="viewer-footnote-clip" style={{ height: hwpUnitToCssPx(piece.clipHeight ?? 0) }}>
          <ParagraphView paragraph={piece.source} document={document} editing={editing} />
        </div>
      }
      return <ParagraphView key={piece.paragraph.id} paragraph={piece.paragraph} document={document} measurable={measurable} editing={piece.part === 'whole' ? editing : undefined} />
    })}</div>
  </div>
}

/**
 * 쪽(단) 아래 각주 영역: 본문과의 간격, 구역 각주 모양의 구분선(종류·굵기·색·길이), 구분선 아래 간격, 각주 사이 간격.
 * 높이는 pagination(`footnoteAreaHeight`)이 본문에서 뺀 높이와 같다.
 */
export function FootnoteAreaView({ footnotes, settings, columnWidth, document, editing, style }: {
  footnotes: readonly ViewerPageFootnote[]
  settings: ViewerFootnoteSettings
  columnWidth: number
  document: ViewerRenderStyles
  editing?: ParagraphEditingProps
  style?: CSSProperties
}) {
  const noteEditing = sublistParagraphEditing(editing, 'NOTE_TEXT', 'HWPX 각주·미주 편집', editing?.desiredSelection)
  const thickness = footnoteLineThickness(settings)
  return <div
    className="viewer-footnotes"
    data-note-kind="footnote"
    contentEditable={false}
    style={{ ...style, paddingTop: hwpUnitToCssPx(settings.spacing.aboveLine) }}
  >
    <div
      className="viewer-footnote-line"
      aria-hidden
      style={{
        width: hwpUnitToCssPx(footnoteLineLength(settings, columnWidth)),
        height: hwpUnitToCssPx(thickness),
        borderTop: thickness ? `${Math.max(hwpUnitToCssPx(thickness), 0.75)}px ${FOOTNOTE_LINE_STYLES[settings.line.type] ?? 'solid'} ${settings.line.color}` : undefined,
        marginBottom: hwpUnitToCssPx(settings.spacing.belowLine)
      }}
    />
    {footnotes.map((footnote, index) => <div key={`${footnote.note.sourcePath}:${footnote.continued ? 'next' : 'first'}`} style={index ? { marginTop: hwpUnitToCssPx(settings.spacing.betweenNotes) } : undefined}>
      <FootnoteView footnote={footnote} superscript={settings.format.superscript} document={document} editing={noteEditing} />
    </div>)}
  </div>
}

interface ParagraphEditingProps {
  pending: boolean
  restoreToken?: unknown
  surfaceLabel?: string
  allowMultipleRuns?: boolean
  allowParagraphRange?: boolean
  allowParagraphStructure?: boolean
  rangeScope?: string
  allowParagraphMergePrevious?: boolean
  allowParagraphMergeNext?: boolean
  /** 표만 든 본문 문단(`table_caret.ts`)의 표 앞·뒤 글자 편집을 연다. 쪽의 구역 본문 문단에만 준다. */
  allowTableParagraph?: boolean
  /** 문단 범위 scope를 정해 준다(각주·머리말 등 문단 하나 scope). 있으면 빈 문단에서도 이 값을 쓴다. */
  rangeScopeOf?: (sectionPath: string, paragraphId: string) => string
  /**
   * 본문 문단 id → 문단 구조 gate와 여러 문단 범위 scope(`editing_capability.ts`의 `topLevelParagraphStructure`).
   * 표 셀은 대신 {@link structureGate}와 {@link rangeScope}를 문단마다 직접 넘긴다.
   */
  structureOf?: (paragraphId: string) => { rangeScope: string; gate: ParagraphStructureGate } | undefined
  /**
   * 문서 전체 문단 id → 문단 구조 gate(`topLevelParagraphStructure`, subList 문단 포함). 표 셀 편집 props가 {@link structureOf}를
   * 비워도 남아 셀·머리말 안 글상자 같은 subList 문단이 capability와 같은 gate를 쓴다.
   */
  documentStructureOf?: (paragraphId: string) => { rangeScope: string; gate: ParagraphStructureGate } | undefined
  structureGate?: ParagraphStructureGate
  editorHostRef?: RefObject<HTMLDivElement>
  desiredSelection?: EditorSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
  /** 입력 칸이 남은 글자를 내보내는 손잡이를 등록한다. 편집 command가 돌기 전에 모두 부른다. */
  registerInputFlush?: (flusher: EditingInputFlusher) => () => void
  onSelectionChange: (
    anchor: ViewerSourceAnchor,
    selection: { anchorOffset: number; focusOffset: number }
  ) => void
  onEditorSelectionChange: (selection: EditorSelection) => void
  onRangeCommit: (
    selection: EditorSelection,
    insert: string,
    inputType: string,
    timestamp: number
  ) => void
  onSplitParagraph: (selection: EditorSelection, timestamp: number) => void
  onMergeParagraph: (
    selection: EditorSelection,
    direction: 'previous' | 'next',
    inputType: 'deleteContentBackward' | 'deleteContentForward',
    timestamp: number
  ) => void
  onParagraphStructureUnavailable: (reason?: EditingCapabilityReason) => void
  onHistory?: (direction: HistoryDirection) => void
  tableCellSelection?: TableCellSelection
  onTableCellSelectionChange: (selection: TableCellSelection) => void
}

export interface EditingActiveStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strikeout: boolean
  height: number
  color: string
  fontId?: string
  fontFamily?: string
  align: ParagraphAlignment
  lineSpacing: number
  indent: number
  marginBefore: number
  marginAfter: number
}

export interface EditingActiveCellStyle {
  backgroundColor: string
  borderColor: string
  borderWidth: number
}

export interface EditingRibbonState {
  activeStyle?: EditingActiveStyle
  activeCellStyle?: EditingActiveCellStyle
  characterStyleAvailable: boolean
  paragraphStyleAvailable: boolean
  cellStyleAvailable: boolean
}

/**
 * 편집 ribbon의 글자·문단·셀 모양 control 상태. 본문과 표 셀(병합·머리글 셀 포함)을 구분하지 않고
 * capability가 열어 준 command만 켠다. 단축키(굵게·기울임·밑줄)도 같은 값을 쓴다.
 */
export function editingRibbonState(
  document: ViewerDocument | null | undefined,
  capabilities: EditingCapabilities
): EditingRibbonState {
  const focus = capabilities.focus
  let activeStyle: EditingActiveStyle | undefined
  if (document && focus) {
    const charStyle = document.charStyles[focus.charStyleId]
    const paraStyle = document.paraStyles[focus.paraStyleId]
    activeStyle = {
      bold: charStyle?.bold ?? false,
      italic: charStyle?.italic ?? false,
      underline: charStyle?.underline ?? false,
      strikeout: charStyle?.strikeout ?? false,
      height: charStyle?.height ?? 1000,
      color: charStyle?.color ?? '#000000',
      fontId: charStyle?.fontId,
      fontFamily: charStyle?.fontFamily,
      align: (paraStyle?.align ?? 'LEFT') as ParagraphAlignment,
      lineSpacing: paraStyle?.lineSpacing || 160,
      indent: paraStyle?.indent ?? 0,
      marginBefore: paraStyle?.margin.top ?? 0,
      marginAfter: paraStyle?.margin.bottom ?? 0
    }
  }
  const cellStyleId = focus?.cellStyleId
  const cellStyle = document && cellStyleId ? document.cellStyles[cellStyleId] : undefined
  const activeCellStyle = cellStyle
    ? {
        backgroundColor: /^#[0-9a-f]{6}$/i.test(cellStyle.backgroundColor ?? '')
          ? cellStyle.backgroundColor!
          : '#FFFFFF',
        borderColor: /^#[0-9a-f]{6}$/i.test(cellStyle.left.color) ? cellStyle.left.color : '#000000',
        borderWidth: cellStyle.left.widthMm || 0.12
      }
    : undefined
  return {
    activeStyle,
    activeCellStyle,
    characterStyleAvailable: Boolean(activeStyle && capabilities.characterStyle.available),
    paragraphStyleAvailable: Boolean(activeStyle && capabilities.paragraphStyle.available),
    cellStyleAvailable: Boolean(activeCellStyle && capabilities.cellStyle.available)
  }
}

export function isEditableTextParagraph(
  paragraph: ViewerParagraph,
  allowMultipleRuns = false
): boolean {
  // 개체 자리 표시는 읽기 전용으로 그 자리에 그리고, 편집 가능 여부는 글자 run만으로 정한다(`editing_capability.ts`와 같은 규칙).
  const content = paragraph.content.filter((item) => !isObjectPlaceholder(item))
  return (
    content.length > 0 &&
    (allowMultipleRuns || content.length === 1) &&
    content.every((item) => item.type === 'text' && Boolean(item.sourceAnchor))
  )
}

export function ParagraphView({
  paragraph,
  document,
  measurable = false,
  editing,
  availableWidth,
  objectFrame
}: {
  paragraph: ViewerParagraph
  document: ViewerRenderStyles
  measurable?: boolean
  editing?: ParagraphEditingProps
  /** 문단이 놓이는 칸(표 셀)의 안쪽 폭(HWPUNIT). 내어쓰기 폭을 이 안으로 줄인다. */
  availableWidth?: number
  /**
   * 문단이 놓인 쪽·단(표 셀·글상자면 칸 기준 가상 용지). 있으면 글자처럼 취급하지 않는 개체를 원본 위치로 그린다(문단 기준 개체는
   * 문단 앞에 모아 그리고, 용지·쪽 기준 개체는 쪽 layer `PageObjectLayer`·칸 layer `ContainerObjectLayer`가 그리므로 여기서는 뺀다).
   * 없으면(각주) 개체를 줄 흐름 안에 둔다.
   */
  objectFrame?: ObjectFrame
}) {
  const style = document.paraStyles[paragraph.paraStyleId]
  // 음수 intent(내어쓰기)는 첫 줄을 왼쪽 여백에 두고 둘째 줄부터 들인다. 첫 줄을 용지·셀 밖으로 당기지 않는다.
  const indentBox = paragraphIndentBox(style?.margin ?? {}, style?.indent, availableWidth)
  const paragraphObjects = objectFrame
    ? paragraph.content.filter((item): item is PositionedContent => positionedContent(item) && contentPlacement(item) !== 'page')
    : []
  const outOfLine = (item: ViewerContent) => Boolean(objectFrame) && positionedContent(item)
  const objectHorizontal = objectFrame ? paragraphHorizontalFrame(objectFrame, indentBox.marginLeft, style?.margin.right ?? 0) : undefined
  const hasWrapObject = paragraphObjects.some((item) => contentPlacement(item) === 'wrap')
  const hasOverlayObject = paragraphObjects.some((item) => contentPlacement(item) === 'overlay')
  const css: CSSProperties = {
    textAlign: style?.align === 'CENTER' ? 'center' : style?.align === 'RIGHT' ? 'right' : style?.align === 'JUSTIFY' ? 'justify' : 'left',
    marginLeft: hwpUnitToCssPx(indentBox.marginLeft),
    paddingLeft: indentBox.paddingLeft ? hwpUnitToCssPx(indentBox.paddingLeft) : undefined,
    marginRight: hwpUnitToCssPx(style?.margin.right ?? 0),
    marginTop: hwpUnitToCssPx(style?.margin.top ?? 0),
    marginBottom: hwpUnitToCssPx(style?.margin.bottom ?? 0),
    textIndent: hwpUnitToCssPx(indentBox.textIndent),
    lineHeight: style?.lineSpacing ? Math.max(style.lineSpacing / 100, 1) : 1.5
  }
  // 표만 든 본문 문단: 표는 셀 편집과 함께 그대로 그리고, 표 앞·뒤 글자(합성 caret 포함)만 문단 입력 surface로 받는다.
  const tableTexts = !measurable && editing?.allowTableParagraph ? tableParagraphTexts(paragraph) : undefined
  const activeEditing =
    !measurable && editing && (tableTexts || isEditableTextParagraph(paragraph, editing.allowMultipleRuns))
      ? editing
      : undefined
  const editableTexts = activeEditing
    ? tableTexts ?? paragraph.content.filter(
        (item): item is Extract<ViewerContent, { type: 'text' }> =>
          item.type === 'text' && Boolean(item.sourceAnchor)
      )
    : undefined
  const paragraphRef = useRef<HTMLDivElement>(null)
  const sectionPath = editableTexts?.[0]?.sourceAnchor?.sectionPath
  // 글자 칸 없는 빈 문단의 합성 anchor: 첫 입력만 받고 문단 나눔·병합·여러 문단 범위에는 끼지 않는다.
  const emptyParagraph = Boolean(editableTexts?.some((text) => isEmptyParagraphText(text)))
  // 문단 구조 command(Enter·경계 병합·여러 문단 범위) gate는 capability와 같은 규칙(`paragraph_structure.ts`)을 쓴다.
  // 개체가 든 문단은 글자 입력은 그대로 받고 문단 나눔·병합·여러 문단 범위에서만 빠진다.
  const structure = tableTexts ? undefined : activeEditing?.structureOf?.(paragraph.id)
  const structureGate: ParagraphStructureGate = tableTexts ? TABLE_PARAGRAPH_GATE : activeEditing?.structureGate ?? structure?.gate ??
    (paragraph.structureBlock ? { split: paragraph.structureBlock, mergePrevious: paragraph.structureBlock, mergeNext: paragraph.structureBlock } : {})
  const structureBlocked = Boolean(structureGate.split)
  // 표 문단은 글자 run마다 scope가 따로라(표를 사이에 둔 범위를 만들지 않는다) 문단 단위 scope가 없다.
  const rangeScope = sectionPath && activeEditing && !tableTexts
    ? activeEditing.rangeScopeOf?.(sectionPath, paragraph.id) ??
      (emptyParagraph ? undefined : activeEditing.rangeScope ?? structure?.rangeScope) ??
      paragraphEditorRangeScope(sectionPath, paragraph.id, Boolean(activeEditing.allowParagraphRange) && !emptyParagraph && !structureBlocked)
    : undefined
  const surfaceScope = (index: number) => tableTexts ? tableParagraphRangeScope(sectionPath!, paragraph.id, index) : rangeScope!
  const paragraphStructureUnavailable = (action: ParagraphStructureAction) => {
    activeEditing?.onParagraphStructureUnavailable(
      emptyParagraph && !tableTexts ? 'EMPTY_PARAGRAPH' : action === 'split' ? structureGate.split : structureGate[action] ?? structureGate.split
    )
  }
  const editorHost = () => activeEditing?.editorHostRef?.current ?? paragraphRef.current
  const readEditorSelection = () => {
    const host = editorHost()
    if (!activeEditing || !sectionPath || !host) return undefined
    if (!tableTexts) return rangeScope ? readParagraphEditorSelection(host, sectionPath, rangeScope) : undefined
    // 표 문단 안의 표 셀 surface에서 올라온 event는 셀 쪽이 처리한다. 이 문단 글자 surface의 선택만 읽는다.
    const selection = readParagraphEditorSelection(host, sectionPath)
    const own = new Set(tableTexts.map((text) => text.sourceAnchor!.textNodeId))
    return selection && own.has(selection.anchorTextNodeId) && own.has(selection.focusTextNodeId) ? selection : undefined
  }
  const syncEditorSelection = (preserveModeledRange = false) => {
    if (!activeEditing) return
    const selection = readEditorSelection()
    if (
      preserveModeledRange &&
      activeEditing.desiredSelection?.anchorTextNodeId !==
        activeEditing.desiredSelection?.focusTextNodeId &&
      selection?.anchorTextNodeId === selection?.focusTextNodeId
    ) return
    if (selection) activeEditing.onEditorSelectionChange(selection)
  }
  return <div
    ref={paragraphRef}
    onMouseUp={() => syncEditorSelection()}
    onKeyUp={() => syncEditorSelection(true)}
    className="viewer-paragraph"
    data-measure-block-id={measurable ? paragraph.id : undefined}
    data-paragraph-structure-block={activeEditing && structureBlocked ? structureGate.split : undefined}
    style={tableTexts || hasOverlayObject || hasWrapObject
      ? { ...css, ...(tableTexts || hasOverlayObject ? { position: 'relative' as const } : {}), ...(hasWrapObject ? { display: 'flow-root' } : {}) }
      : css}
  >{paragraphObjects.map((item, index) => <ParagraphObjectView
    key={`${paragraph.id}:object-position${index}`}
    item={item}
    placement={contentPlacement(item) as Exclude<ObjectPlacement, 'page'>}
    frame={objectFrame!}
    horizontal={objectHorizontal!}
    paddingLeft={indentBox.paddingLeft}
    document={document}
    measurable={measurable}
    editing={editing}
  />)}{paragraph.marker && <span className="viewer-paragraph-marker">{hancomPuaDisplayText(paragraph.marker)} </span>}{editableTexts && activeEditing
    ? paragraph.content.map((item, contentIndex) => {
      if (outOfLine(item)) return null
      if (isObjectPlaceholder(item)) {
        return <ObjectPlaceholderView key={`${paragraph.id}:object${contentIndex}`} item={item} document={document} editing={editing} />
      }
      if (tableTexts && item.type === 'table') {
        return <TableView key={`${paragraph.id}:${item.id}`} table={item} document={document} editing={editing} />
      }
      const index = editableTexts.indexOf(item as ViewerText)
      if (index < 0) return null
      const editableText = editableTexts[index]
      const surface = <ParagraphInputSurface
      key={`${paragraph.id}:runs${editableTexts.length}:${editableText.sourceAnchor!.textNodeId}`}
      text={editableText.text}
      sourceAnchor={editableText.sourceAnchor!}
      style={textCss(editableText, document)}
      pending={activeEditing.pending}
      restoreToken={activeEditing.restoreToken}
      ariaLabel={tableTexts ? TABLE_PARAGRAPH_SURFACE_LABEL : activeEditing.surfaceLabel}
      rangeScope={surfaceScope(index)}
      desiredSelection={
        activeEditing.desiredSelection?.anchorTextNodeId === activeEditing.desiredSelection?.focusTextNodeId &&
        activeEditing.desiredSelection?.focusTextNodeId === editableText.sourceAnchor!.textNodeId
          ? activeEditing.desiredSelection
          : undefined
      }
      onCommit={activeEditing.onCommit}
      onComposingChange={activeEditing.onComposingChange}
      registerInputFlush={activeEditing.registerInputFlush}
      onSelectionChange={activeEditing.onSelectionChange}
      getRangeSelection={() => {
        const nativeSelection = readEditorSelection()
        if (nativeSelection?.anchorTextNodeId !== nativeSelection?.focusTextNodeId) {
          return nativeSelection
        }
        const desired = activeEditing.desiredSelection
        const textNodeIds = new Set(editableTexts.map((text) => text.sourceAnchor!.textNodeId))
        return desired &&
          desired.anchorTextNodeId !== desired.focusTextNodeId &&
          textNodeIds.has(desired.anchorTextNodeId) &&
          textNodeIds.has(desired.focusTextNodeId)
          ? desired
          : nativeSelection
      }}
      onRangeCommit={activeEditing.onRangeCommit}
      onSplitParagraph={activeEditing.onSplitParagraph}
      onMergeParagraph={activeEditing.onMergeParagraph}
      allowMergePrevious={!tableTexts && !emptyParagraph && index === 0 && (activeEditing.allowParagraphMergePrevious ?? true)}
      allowMergeNext={!tableTexts && !emptyParagraph && index === editableTexts.length - 1 && (activeEditing.allowParagraphMergeNext ?? true)}
      mergePreviousBlocked={tableTexts ? true : !emptyParagraph && index === 0 && (activeEditing.allowParagraphMergePrevious ?? true) && Boolean(structureGate.mergePrevious)}
      mergeNextBlocked={tableTexts ? true : !emptyParagraph && index === editableTexts.length - 1 && (activeEditing.allowParagraphMergeNext ?? true) && Boolean(structureGate.mergeNext)}
      allowParagraphStructure={!tableTexts && activeEditing.allowParagraphStructure && !emptyParagraph && !structureBlocked}
      onParagraphStructureUnavailable={paragraphStructureUnavailable}
      onHistory={activeEditing.onHistory}
      onBoundaryNavigate={(direction, selection) => {
        const host = editorHost()
        const currentAnchor = editableText.sourceAnchor
        if (!host || !currentAnchor) return
        const modeled = readEditorSelection() ?? {
          sectionPath: currentAnchor.sectionPath,
          anchorTextNodeId: currentAnchor.textNodeId,
          anchorOffset: selection.anchorOffset,
          focusTextNodeId: currentAnchor.textNodeId,
          focusOffset: selection.focusOffset
        }
        const moved = moveParagraphEditorSelection(
          paragraphEditorSurfaces(host),
          currentAnchor.textNodeId,
          direction,
          modeled,
          false,
          paragraphEditorInstance(paragraphRef.current)
        )
        if (moved) activeEditing.onEditorSelectionChange(moved)
      }}
      onBoundaryExtend={(direction, selection) => {
        const host = editorHost()
        const currentAnchor = editableText.sourceAnchor
        if (!host || !currentAnchor) return
        const modeled = readEditorSelection() ?? (
          activeEditing.desiredSelection?.focusTextNodeId === currentAnchor.textNodeId
            ? activeEditing.desiredSelection
            : {
                sectionPath: currentAnchor.sectionPath,
                anchorTextNodeId: currentAnchor.textNodeId,
                anchorOffset: selection.anchorOffset,
                focusTextNodeId: currentAnchor.textNodeId,
                focusOffset: selection.focusOffset
              }
        )
        const moved = moveParagraphEditorSelection(
          paragraphEditorSurfaces(host),
          currentAnchor.textNodeId,
          direction,
          modeled,
          true,
          paragraphEditorInstance(paragraphRef.current)
        )
        if (moved) activeEditing.onEditorSelectionChange(moved)
      }}
    />
      // 아직 글자가 없는 표 앞·뒤 caret은 흐름 밖의 좁은 입력 칸으로 두어 편집 모드에서도 쪽 배치가 보기 모드와 같게 한다.
      // 글자를 넣으면 projection이 그 글자를 표 앞·뒤 흐름 안에 다시 그린다.
      if (tableTexts && !editableText.text) {
        const side = paragraph.content.indexOf(item) < paragraph.content.findIndex((content) => content.type === 'table') ? 'before' : 'after'
        return <span
          key={`${paragraph.id}:caret:${editableText.sourceAnchor!.textNodeId}`}
          className={`viewer-table-caret viewer-table-caret-${side}`}
          title={side === 'before' ? '표 앞에 글자 입력' : '표 뒤에 글자 입력'}
        >{surface}</span>
      }
      return surface
    })
    : paragraph.content.map((item, index) => outOfLine(item)
      ? null
      : <Content key={`${paragraph.id}:${index}`} item={item} document={document} measurable={measurable} contentIndex={index} editing={editing} />)}</div>
}

/**
 * section 하나의 측정용 DOM. 편집 patch가 바꾸지 않은 section은 다시 그리지 않는다. style은 측정값 표지(`stylesKey`)가 같으면
 * 바뀌어도 건너뛴다. 표지가 같다는 것은 바뀐 style id를 쓰는 section이 모두 새 object라는 뜻이다(`MeasurementStylesTracker`).
 */
const MeasurementSection = memo(function MeasurementSection({
  section,
  styles,
  width
}: {
  section: ViewerSection
  styles: ViewerRenderStyles
  stylesKey: object
  width: number
}) {
  const footnotes = sectionFootnotes(section)
  const superscript = sectionFootnoteSettings(section.footnoteSettings).format.superscript
  const bodyWidth = styles.page.width - styles.page.margin.left - styles.page.margin.right
  // 다단 정의마다 그 영역 첫 단 너비로 재고, 첫 단과 너비가 다른 단은 그 너비로 한 번 더 잰다(`columnMeasurementGroups`).
  const groups = useMemo(() => columnMeasurementGroups(section, bodyWidth), [section, bodyWidth])
  // 문단 기준 개체는 문단 높이에 들므로 첫 단·1쪽 기준으로 같은 자리에 그려 잰다(가로 위치만 쪽마다 다를 수 있다).
  const frameOf = (group: ColumnMeasurementGroup, columnWidth: number): ObjectFrame => ({
    page: styles.page,
    columnLeft: styles.page.margin.left + (columnRects(group.layout, bodyWidth, 1)[0]?.left ?? 0),
    columnWidth,
    pageNumber: 1
  })
  const paragraphs = (group: ColumnMeasurementGroup, columnWidth: number) => {
    const objectFrame = frameOf(group, columnWidth)
    return group.blocks.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={styles} measurable objectFrame={objectFrame} />)
  }
  const single = groups.length === 1 && !groups[0].extraWidths.length
  return <div data-measure-section={section.id} style={{ width: single ? width : hwpUnitToCssPx(bodyWidth) }}>
    {single
      ? paragraphs(groups[0], groups[0].width)
      : groups.map((group, index) => <div key={`group${index}`}>
          <div style={{ width: hwpUnitToCssPx(group.width) }}>{paragraphs(group, group.width)}</div>
          {group.extraWidths.map((extraWidth) => <div key={columnWidthKey(extraWidth)} data-measure-variant={columnWidthKey(extraWidth)} style={{ width: hwpUnitToCssPx(extraWidth) }}>
            {paragraphs(group, extraWidth)}
          </div>)}
        </div>)}
    {footnotes.length > 0 && <div className="viewer-footnotes-measure" style={single ? undefined : { width: hwpUnitToCssPx(groups[0].width) }}>{footnotes.map((note) => <FootnoteView
      key={note.sourcePath}
      footnote={{ note, marker: note.marker, pieces: note.paragraphs.map((paragraph) => ({ paragraph, source: paragraph, part: 'whole' })), continued: false, continues: false }}
      superscript={superscript}
      document={styles}
      measureId={note.sourcePath}
    />)}</div>}
  </div>
}, (previous, next) => previous.section === next.section && previous.width === next.width && previous.stylesKey === next.stylesKey)

/** section 본문의 각주(문서 순서). section object는 바꾸지 않으므로 object마다 한 번만 모은다. */
const sectionFootnoteCache = new WeakMap<ViewerSection, ViewerNote[]>()
function sectionFootnotes(section: ViewerSection): ViewerNote[] {
  let notes = sectionFootnoteCache.get(section)
  if (!notes) {
    notes = section.blocks.flatMap(paragraphFootnotes)
    sectionFootnoteCache.set(section, notes)
  }
  return notes
}

/** 입력 지연 측정 hook(E2E)이 읽는 시각 표시. 이름마다 마지막 하나만 남긴다. */
function markEditingTiming(name: string): void {
  performance.clearMarks(name)
  performance.mark(name)
}

function markLayoutMeasured(measuredSections: number): void {
  performance.clearMarks('han-flow:layout-measured')
  performance.mark('han-flow:layout-measured', { detail: { measuredSections } })
}

/** `reuse`에서 그대로 가져오지 않고 새로 잰 section 수. */
export function countMeasuredSections(next: DocumentLayoutMeasurements, reuse: DocumentLayoutMeasurements | undefined): number {
  return next.sections.filter((entry, index) => entry && entry !== reuse?.sections[index]).length
}

function measureHeights(elements: Iterable<HTMLElement>, key: (element: HTMLElement) => string): Record<string, number> {
  return Object.fromEntries(Array.from(elements, (item) => [key(item), cssPxToHwpUnit(item.getBoundingClientRect().height)]))
}

function measureSectionElement(element: Element, section: ViewerSection): LayoutMeasurements {
  // 서로 다른 너비 단으로 한 번 더 그린 묶음(`data-measure-variant`)은 단 너비별 높이(`columnHeights`)로 따로 모은다.
  const variants = Array.from(element.querySelectorAll<HTMLElement>('[data-measure-variant]'))
  const outsideVariants = (item: HTMLElement) => !variants.length || !item.closest('[data-measure-variant]')
  const blockHeights = measureHeights(Array.from(element.querySelectorAll<HTMLElement>('[data-measure-block-id]')).filter(outsideVariants), (item) => item.dataset.measureBlockId!)
  const tableRowHeights = measureHeights(Array.from(element.querySelectorAll<HTMLElement>('[data-measure-row-id]')).filter(outsideVariants), (item) => item.dataset.measureRowId!)
  let columnHeights: LayoutMeasurements['columnHeights']
  for (const variant of variants) {
    const key = variant.dataset.measureVariant!
    columnHeights ??= {}
    const entry = columnHeights[key] ??= { blockHeights: {}, tableRowHeights: {} }
    Object.assign(entry.blockHeights, measureHeights(variant.querySelectorAll<HTMLElement>('[data-measure-block-id]'), (item) => item.dataset.measureBlockId!))
    Object.assign(entry.tableRowHeights, measureHeights(variant.querySelectorAll<HTMLElement>('[data-measure-row-id]'), (item) => item.dataset.measureRowId!))
  }
  const footnotes = sectionFootnotes(section)
  if (!footnotes.length) return { blockHeights, tableRowHeights, ...(columnHeights ? { columnHeights } : {}) }
  const notes = new Map(footnotes.map((note) => [note.sourcePath, note]))
  const noteMetrics: Record<string, ViewerNoteMetrics> = {}
  element.querySelectorAll<HTMLElement>('[data-measure-note]').forEach((item) => {
    const note = notes.get(item.dataset.measureNote!)
    if (note) noteMetrics[note.sourcePath] = measureNoteElement(item, note)
  })
  return { blockHeights, tableRowHeights, noteMetrics, ...(columnHeights ? { columnHeights } : {}) }
}

/**
 * 측정 DOM(`container`의 section별 자식)에서 section 높이를 잰다. `reuse`가 같은 style 묶음 표지(`styles`)로 잰 값이면
 * object가 그대로인 section은 다시 재지 않고 그 측정 object를 그대로 쓴다.
 */
export function measureDocumentLayout(
  document: Pick<ViewerDocument, 'sections'>,
  styles: object,
  container: Element,
  reuse: DocumentLayoutMeasurements | undefined
): DocumentLayoutMeasurements {
  const previous = reuse?.styles === styles ? reuse : undefined
  return {
    styles,
    sections: document.sections.map((section, index) => {
      const cached = previous?.sections[index]
      if (cached && cached.section === section) return cached
      const element = container.children[index]
      return element ? { section, measurements: measureSectionElement(element, section) } : undefined
    })
  }
}

/**
 * 쪽 머리말·꼬리말. 편집 중에는 글자만 든 문단을 고칠 수 있고, 같은 머리말을 쓰는 모든 쪽이 projection 뒤 함께 바뀐다.
 * 같은 source anchor의 입력 칸이 쪽마다 하나씩 있으므로 selection 복원(`desiredSelection`)은 마지막으로 focus를 받은 쪽(`active`)의
 * 머리말·꼬리말에만 넘겨 여러 쪽의 입력 칸이 focus를 다투지 않게 한다.
 */
export function HeaderFooterView({ control, kind, document, offset, editing, active = false, onActivate, objectFrame }: {
  control?: ViewerHeaderFooter
  kind: 'header' | 'footer'
  document: ViewerRenderStyles
  offset: number
  editing?: ParagraphEditingProps
  active?: boolean
  onActivate?: () => void
  /**
   * 머리말·꼬리말이 놓인 쪽(단은 쪽 본문 폭 하나). 있으면 글자처럼 취급하지 않는 개체를 원본 위치로 그린다. 문단 기준 개체는 머리말
   * 문단 안에, 용지·쪽 기준 개체는 쪽 위 절대 위치(`PageObjectLayer`)에 둔다. 머리말 개체는 본문 자리를 비우지 않는다.
   */
  objectFrame?: ObjectFrame
}) {
  if (!control) return null
  const controlEditing = sublistParagraphEditing(
    editing,
    'HEADER_FOOTER_TEXT',
    kind === 'header' ? 'HWPX 머리말 편집' : 'HWPX 꼬리말 편집',
    active ? editing?.desiredSelection : undefined
  )
  return <><div
    className={`viewer-${kind}`}
    data-header-footer-id={control.id}
    onFocusCapture={controlEditing ? onActivate : undefined}
    style={{ [kind === 'header' ? 'top' : 'bottom']: hwpUnitToCssPx(offset), left: hwpUnitToCssPx(document.page.margin.left), right: hwpUnitToCssPx(document.page.margin.right) }}
  >
    {control.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} editing={controlEditing} objectFrame={objectFrame} />)}
  </div>{objectFrame && <PageObjectLayer blocks={control.paragraphs} frameOf={() => objectFrame} document={document} container={kind} />}</>
}

export function TableView({
  table,
  document,
  measurable = false,
  editing
}: {
  table: ViewerTable
  document: ViewerRenderStyles
  measurable?: boolean
  editing?: ParagraphEditingProps
}) {
  const columnWidths = Array.from({ length: table.columnCount }, () => 0)
  const candidates = table.rows.flatMap((row) => row.cells).sort((a, b) => a.columnSpan - b.columnSpan)
  candidates.forEach((cell) => {
    const unresolved = Array.from({ length: cell.columnSpan }, (_, offset) => cell.column + offset).filter((column) => !columnWidths[column])
    const known = Array.from({ length: cell.columnSpan }, (_, offset) => columnWidths[cell.column + offset] ?? 0).reduce((sum, width) => sum + width, 0)
    const share = Math.max((cell.width - known) / Math.max(unresolved.length, 1), 0)
    unresolved.forEach((column) => { columnWidths[column] = share })
  })
  const fallback = (table.width ?? 0) / Math.max(table.columnCount, 1)
  const resolvedWidths = columnWidths.map((width) => width || fallback)
  const totalWidth = resolvedWidths.reduce((sum, width) => sum + width, 0)
  const pageBodyHeight = document.page ? document.page.height - document.page.margin.top - document.page.margin.bottom : undefined
  return <table className="viewer-table" style={{ width: table.width ? hwpUnitToCssPx(table.width) : '100%' }}><colgroup>{resolvedWidths.map((width, index) => <col key={index} style={{ width: `${(width / totalWidth) * 100}%` }} />)}</colgroup><tbody>{table.rows.map((row, rowIndex) => <tr data-measure-row-id={measurable ? `${table.id}:r${row.cells[0]?.row ?? rowIndex}` : undefined} key={`${table.id}:r${rowIndex}`}>{row.cells.map((cell) => {
    const style = cell.borderFillId ? document.cellStyles[cell.borderFillId] : undefined
    const fragmented = cell.splitTop || cell.splitBottom
    const minimumHeight = cellMinimumHeight(cell, pageBodyHeight)
    // 셀 안 글자처럼 취급하지 않는 개체는 셀(안쪽 여백 포함)을 용지로 보고 원본 위치에 그린다(`containerObjectFrame`).
    const cellFrame = containerObjectFrame(cell.width, cell.height, cell.margin)
    const cellObjects = hasContainerPageObjects(cell.paragraphs)
    const cellRangeScope = tableCellRangeScope(table.id, cell)
    const cellSelection = editing && !measurable
      ? selectableMergedTableCell(table, cell)
      : undefined
    const selected = equalTableCellSelections(cellSelection, editing?.tableCellSelection)
    const cellMode = editing ? tableCellEditingMode(cell, measurable) : undefined
    const cellStructure = cellMode === 'structure' && cellRangeScope
      ? cellParagraphStructure(cell.paragraphs, cellRangeScope)
      : undefined
    const selectCell = () => {
      if (!cellSelection || !editing) return
      globalThis.getSelection()?.removeAllRanges()
      editing.onTableCellSelectionChange(cellSelection)
    }
    return <td
      key={cellFragmentKey(table.id, cell)}
      className={cellSelection ? `viewer-selectable-table-cell${selected ? ' viewer-table-cell-selected' : ''}` : undefined}
      colSpan={cell.columnSpan}
      rowSpan={cell.rowSpan}
      aria-selected={cellSelection ? selected : undefined}
      aria-label={cellSelection ? `병합 표 셀 ${cell.row + 1}행 ${cell.column + 1}열` : undefined}
      tabIndex={cellSelection ? 0 : undefined}
      onClick={cellSelection ? (event) => {
        if (fromEditorSurface(event.target)) return
        selectCell()
      } : undefined}
      onKeyDown={cellSelection ? (event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        selectCell()
      } : undefined}
      style={{
      // 표 칸의 height는 행 최소 높이로 쓰인다(min-height는 표 칸에 듣지 않는다). 선언 높이는 안쪽 여백·테두리를 포함한다.
      height: minimumHeight !== undefined ? hwpUnitToCssPx(minimumHeight) : undefined, boxSizing: minimumHeight !== undefined ? 'border-box' : undefined, verticalAlign: fragmented ? 'top' : cell.verticalAlign === 'TOP' ? 'top' : cell.verticalAlign === 'BOTTOM' ? 'bottom' : 'middle',
      padding: fragmented ? undefined : `${hwpUnitToCssPx(cell.margin.top)}px ${hwpUnitToCssPx(cell.margin.right)}px ${hwpUnitToCssPx(cell.margin.bottom)}px ${hwpUnitToCssPx(cell.margin.left)}px`,
      paddingTop: fragmented ? hwpUnitToCssPx(cell.splitTop ? 0 : cell.margin.top) : undefined,
      paddingRight: fragmented ? hwpUnitToCssPx(cell.margin.right) : undefined,
      paddingBottom: fragmented ? hwpUnitToCssPx(cell.splitBottom ? 0 : cell.margin.bottom) : undefined,
      paddingLeft: fragmented ? hwpUnitToCssPx(cell.margin.left) : undefined,
      background: style?.backgroundColor === '#000000' ? '#000' : style?.backgroundColor,
      borderLeft: style ? borderCss(style.left) : undefined, borderRight: style ? borderCss(style.right) : undefined,
      borderTop: cell.splitTop ? 'none' : style ? borderCss(style.top) : undefined,
      borderBottom: cell.splitBottom ? 'none' : style ? borderCss(style.bottom) : undefined,
      position: cellObjects ? 'relative' : undefined
    }}>{cellObjects && <ContainerObjectLayer paragraphs={cell.paragraphs} frame={cellFrame} container="cell" document={document} editing={editing} />}{cell.paragraphs.map((paragraph, paragraphIndex) => <ParagraphView
      key={paragraph.id}
      paragraph={paragraph}
      document={document}
      measurable={measurable}
      objectFrame={cellFrame}
      availableWidth={Math.max(0, cell.width - cell.margin.left - cell.margin.right)}
      editing={
        cellMode === 'structure' && editing
          ? {
              ...editing,
              surfaceLabel: tableCellParagraphLabel(paragraphIndex, cell.paragraphs.length),
              allowMultipleRuns: false,
              allowParagraphRange: cell.paragraphs.length > 1,
              allowParagraphStructure: true,
              rangeScope: cellStructure?.[paragraphIndex].rangeScope ?? cellRangeScope,
              rangeScopeOf: undefined,
              allowTableParagraph: false,
              structureOf: undefined,
              structureGate: cellStructure?.[paragraphIndex].gate ?? {},
              allowParagraphMergePrevious: paragraphIndex > 0,
              allowParagraphMergeNext: paragraphIndex < cell.paragraphs.length - 1
            }
          : cellMode === 'text' && editing
            ? {
                ...editing,
                surfaceLabel: tableCellParagraphLabel(paragraphIndex, cell.paragraphs.length, true),
                allowMultipleRuns: true,
                allowParagraphRange: false,
                allowParagraphStructure: false,
                rangeScope: undefined,
                rangeScopeOf: undefined,
                allowTableParagraph: false,
                structureOf: undefined,
                structureGate: undefined,
                allowParagraphMergePrevious: false,
                allowParagraphMergeNext: false
              }
            : undefined
      }
    />)}</td>
  })}</tr>)}</tbody></table>
}

function FixedPageView({
  page,
  printPage,
  renderEnabled,
  searchQuery,
  activeSearchPage,
  onReady,
  onError
}: {
  page: FixedPageDescriptor
  printPage?: Awaited<ReturnType<RhwpAdapter['renderRhwpFixedPage']>>
  renderEnabled: boolean
  searchQuery: string
  activeSearchPage: boolean
  onReady: () => void
  onError: (message: string) => void
}) {
  const [source, setSource] = useState<string | null>(null)
  const [textLayout, setTextLayout] = useState<FixedPageTextLayout | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | undefined
    setReady(false)
    setTextLayout(null)
    if (!renderEnabled) {
      setSource(null)
      return
    }
    const load = async () => {
      try {
        const rendered = printPage ?? await (await loadRhwpAdapter()).renderRhwpFixedPage(page.index)
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml' }))
        setSource(objectUrl)
      } catch (reason) {
        if (!cancelled) onError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [page.index, printPage, renderEnabled])
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    void loadRhwpAdapter()
      .then((adapter) => adapter.getRhwpFixedPageTextLayout(page.index))
      .then((layout) => {
        if (!cancelled) setTextLayout(layout)
      })
      .catch((reason) => {
        if (!cancelled) onError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { cancelled = true }
  }, [page.index, ready])
  return <article
    className={`viewer-page viewer-fixed-page${activeSearchPage ? ' viewer-fixed-page-search-active' : ''}`}
    data-page-index={page.index}
    data-page-ready={ready}
    data-text-characters={textLayout?.nonWhitespaceCharacters ?? 0}
    {...fixedPageTextCensus(textLayout?.text)}
    role="document"
    aria-label={`${page.index + 1}페이지`}
    style={{ width: page.width, height: page.height }}
  >
    {source && <img
      className="viewer-fixed-page-image"
      src={source}
      alt=""
      aria-hidden="true"
      draggable={false}
      onLoad={() => {
        setReady(true)
        onReady()
      }}
      onError={() => onError(`${page.index + 1}페이지 이미지를 표시할 수 없습니다.`)}
    />}
    {textLayout && <FixedPageTextLayer layout={textLayout} searchQuery={searchQuery} />}
  </article>
}

/**
 * PDF 비교용 페이지 글자 census(`scripts/pdf_text_count.mjs`의 `textCensus`와 같은 규칙, code point 단위):
 * 공백 외 전체 글자·사설 영역 글자·ASCII 숫자. E2E visual state가 화면 쪽 값으로 읽는다.
 */
function fixedPageTextCensus(text: string | undefined): Record<string, number | string> {
  const normalized = (text ?? '').normalize('NFC')
  const privateUse = normalized.match(/\p{Co}/gu) ?? []
  return {
    'data-text-raw': (normalized.match(/\S/gu) ?? []).length,
    'data-text-private-use': privateUse.length,
    // 사설 영역 글자별 수(`U+F028B:2 U+F03DA:1`). PDF에서 빠진 사설 영역 글자를 code point별로 판정한다.
    'data-text-private-use-code-points': privateUseCodePointList(privateUse),
    'data-text-digits': (normalized.match(/[0-9]/g) ?? []).length
  }
}

function privateUseCodePointList(characters: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const character of characters) {
    const key = `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}:${count}`).join(' ')
}

function highlightedText(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const needle = query.trim().toLocaleLowerCase('ko-KR')
  if (!needle) return [{ text, hit: false }]
  const haystack = text.toLocaleLowerCase('ko-KR')
  const pieces: Array<{ text: string; hit: boolean }> = []
  let offset = 0
  let match = haystack.indexOf(needle)
  while (match >= 0) {
    if (match > offset) pieces.push({ text: text.slice(offset, match), hit: false })
    pieces.push({ text: text.slice(match, match + needle.length), hit: true })
    offset = match + needle.length
    match = haystack.indexOf(needle, offset)
  }
  if (offset < text.length) pieces.push({ text: text.slice(offset), hit: false })
  return pieces.length ? pieces : [{ text, hit: false }]
}

export function FixedPageTextLayer({ layout, searchQuery }: { layout: FixedPageTextLayout; searchQuery: string }) {
  return <div className="viewer-fixed-page-text-layer" aria-label="페이지 텍스트">
    {layout.runs.map((run, runIndex) => <span
      className="viewer-fixed-page-text-run"
      key={runIndex}
      style={{
        left: run.x,
        top: run.y,
        width: run.width,
        height: Math.max(run.height, run.fontSize),
        fontFamily: run.fontFamily,
        fontSize: run.fontSize,
        lineHeight: 1,
        transform: run.ratio === 1 ? undefined : `scaleX(${run.ratio})`
      }}
    >{highlightedText(run.text, searchQuery).map((piece, pieceIndex) =>
      piece.hit
        ? <mark className="viewer-fixed-page-search-hit" key={pieceIndex}>{piece.text}</mark>
        : piece.text
    )}</span>)}
  </div>
}

export function fixedPagePrintCss(pages: FixedPageDescriptor[]): string {
  return pages.map((page) => {
    const name = `han-flow-fixed-page-${page.index}`
    return `@page ${name} { size: ${page.width}px ${page.height}px; margin: 0; }\n.viewer-fixed-page[data-page-index="${page.index}"] { page: ${name}; }`
  }).join('\n')
}

export default function App() {
  const {
    document,
    fixedDocument,
    fileName,
    openedPath,
    error,
    errorCode,
    loading,
    fontResolutions,
    loadTiming,
    sectionProgress,
    backgroundError,
    zoom,
    overflowPages,
    printing,
    pdfStatus,
    visibleRange,
    fixedPrintPages,
    fixedFirstPageReady,
    fixedFollowingPagesEnabled,
    searchOpen,
    searchQuery,
    searchResults,
    activeSearchResult,
    searching,
    layoutMeasurements,
    editing,
    editingSelection,
    tableCellSelection,
    editingPending,
    editingStatus,
    editingSelectionNotice,
    setDocument,
    setFixedDocument,
    setFileName,
    setOpenedPath,
    setError,
    setErrorCode,
    setLoading,
    setFontResolutions,
    setLoadTiming,
    setSectionProgress,
    setBackgroundError,
    setZoom,
    setOverflowPages,
    setPrinting,
    setPdfStatus,
    setVisibleRange,
    setFixedPrintPages,
    setFixedFirstPageReady,
    setFixedFollowingPagesEnabled,
    setSearchOpen,
    setSearchQuery,
    setSearchResults,
    setActiveSearchResult,
    setSearching,
    setLayoutMeasurements,
    setEditing,
    setEditingSelection,
    setTableCellSelection,
    setEditingPending,
    setEditingStatus,
    setEditingSelectionNotice,
    resetEditing
  } = useRendererState()
  const reportedBenchmark = useRef<number | null>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const editingHostRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchSequence = useRef(0)
  const activeLoadId = useRef('')
  const loadSequence = useRef(0)
  const automaticPdfStarted = useRef(false)
  const editingTransient = useRef(new EditingImeTransientState())
  const stageRef = useRef<HTMLElement>(null)
  // 편집 결과 patch를 적용할 기준 문서와 그 projection 번호. 편집 결과는 도착 순서대로 바로 앞 결과 위에 쌓이므로
  // React state가 다시 그려지기 전에도 최신 값을 알아야 한다. 문서를 바꾸는 곳은 모두 `showDocument`를 거친다.
  const documentRef = useRef<ViewerDocument | null>(null)
  const projectionIdRef = useRef<number | undefined>(undefined)
  // 전체 문서로 바뀌었는지(편집 patch가 아닌지). 그러면 이전처럼 측정값을 비우고 모든 section을 다시 잰다.
  const documentReplacedRef = useRef(false)
  // 측정값을 다시 쓸 수 있는 style 묶음 표지. 편집 patch가 알린 style id만 바뀌면 표지가 그대로다.
  const measurementStyles = useRef(new MeasurementStylesTracker())
  const showDocument = useCallback((next: ViewerDocument | null, projectionId?: number, patched = false) => {
    documentRef.current = next
    projectionIdRef.current = projectionId
    documentReplacedRef.current = !patched
    if (!patched) measurementStyles.current.reset()
    setDocument(next)
  }, [])
  editingTransient.current.synchronize(editing, editingPending)
  // 입력 칸에 아직 보내지 않은 글자(한글 음절 묶음 대기)가 있는지. 이때도 실행 취소·저장 버튼을 눌러 둘 수 있게 한다.
  const [editingInputBuffered, setEditingInputBuffered] = useState(false)
  // 입력 반영을 기다린 command가 쓸 최신 편집 selection. 편집 결과·selection 변경 때 React가 다시 그리기 전에 바로 바꾼다.
  const editingSelectionRef = useRef<EditorSelection | undefined>(editingSelection)
  editingSelectionRef.current = editingSelection
  // 편집 patch가 section만 바꾸면 style map object가 그대로라 아래 값도 모두 그대로다(측정 DOM memo·측정 재사용의 기준).
  // style definition을 바꾼 patch도 바뀐 id만 새 object이고, 글꼴을 바꾼 글자 모양 object도 id별로 다시 쓴다.
  const charStyles = document?.charStyles
  const resolvedCharStyleCache = useRef(new WeakMap<ViewerCharStyle, ViewerCharStyle>())
  const resolvedCharStyles = useMemo(() => charStyles
    ? resolveCharStyles(charStyles, fontResolutions, resolvedCharStyleCache.current)
    : undefined, [charStyles, fontResolutions])
  const effectiveDocument = useMemo(
    () => document && resolvedCharStyles ? { ...document, charStyles: resolvedCharStyles } : null,
    [document, resolvedCharStyles]
  )
  const renderStyles = useMemo<ViewerRenderStyles | null>(
    () => document && resolvedCharStyles
      ? { page: document.page, charStyles: resolvedCharStyles, paraStyles: document.paraStyles, cellStyles: document.cellStyles, resources: document.resources }
      : null,
    [document?.page, resolvedCharStyles, document?.paraStyles, document?.cellStyles, document?.resources]
  )
  const measurementStylesKey = useMemo(() => renderStyles ? measurementStyles.current.keyFor(renderStyles) : undefined, [renderStyles])
  const sectionPaginationCache = useRef<SectionPagination[]>([])
  const pagination = useMemo(() => {
    const startedAt = performance.now()
    // section마다 새 쪽에서 시작하므로 object가 그대로인 section(측정값 포함)은 앞 결과의 쪽을 그대로 쓴다.
    const result = effectiveDocument
      ? paginateViewerSectionsIncremental(
          effectiveDocument,
          (index) => layoutMeasurements?.sections[index]?.measurements,
          sectionPaginationCache.current
        )
      : undefined
    sectionPaginationCache.current = result?.sections ?? []
    return { pages: result?.pages ?? [], layoutMs: performance.now() - startedAt }
  }, [effectiveDocument, layoutMeasurements])
  const pages = pagination.pages
  // 머리말·꼬리말 입력 칸은 쪽마다 같은 anchor로 되풀이된다. 마지막으로 focus를 받은 쪽의 것만 selection을 복원한다.
  const [activeDecorationPage, setActiveDecorationPage] = useState<number>()
  const decorations = useMemo(() => effectiveDocument ? resolvePageDecorations(effectiveDocument, pages) : [], [effectiveDocument, pages])
  const pageCount = fixedDocument?.pageCount ?? pages.length
  const hasDocument = Boolean(effectiveDocument || fixedDocument)
  const virtualized = pageCount > 50 && !printing
  const pageHeight = effectiveDocument ? hwpUnitToCssPx(effectiveDocument.page.height) : 0
  const pageStride = (pageHeight + 24) * zoom
  useLayoutEffect(() => {
    if (
      !editing ||
      !editingSelection ||
      editingSelection.anchorTextNodeId === editingSelection.focusTextNodeId ||
      !editingHostRef.current
    ) return
    restoreParagraphEditorSelection(editingHostRef.current, editingSelection)
  }, [
    editing?.sessionId,
    editingSelection?.anchorTextNodeId,
    editingSelection?.anchorOffset,
    editingSelection?.focusTextNodeId,
    editingSelection?.focusOffset,
    layoutMeasurements,
    visibleRange.start,
    visibleRange.end
  ])
  useEffect(() => {
    if (!tableCellSelection) return
    const projection = reconcileTableCellSelection(effectiveDocument, tableCellSelection)
    if (projection.status === 'CLEARED') setTableCellSelection(undefined)
  }, [effectiveDocument, tableCellSelection, setTableCellSelection])
  const updateVisibleRange = (scrollTop: number, viewportHeight: number) => {
    if (!virtualized) return
    const next = fixedDocument
      ? fixedPageVirtualRange(fixedDocument.pages, scrollTop, viewportHeight, zoom)
      : {
          start: Math.max(Math.floor(scrollTop / pageStride) - 2, 0),
          end: Math.min(Math.ceil((scrollTop + viewportHeight) / pageStride) + 2, pages.length),
          topSpacer: Math.max(Math.floor(scrollTop / pageStride) - 2, 0) * (pageHeight + 24),
          bottomSpacer: Math.max(pages.length - Math.min(Math.ceil((scrollTop + viewportHeight) / pageStride) + 2, pages.length), 0) * (pageHeight + 24)
        }
    setVisibleRange((current) =>
      current.start === next.start &&
      current.end === next.end &&
      current.topSpacer === next.topSpacer &&
      current.bottomSpacer === next.bottomSpacer
        ? current
        : next
    )
  }
  const changeZoomAt = (nextZoom: number, anchorY?: number) => {
    const stage = stageRef.current
    if (!stage || nextZoom === zoom) return
    const viewportAnchor = anchorY ?? stage.clientHeight / 2
    const documentAnchor = (stage.scrollTop + viewportAnchor) / zoom
    setZoom(nextZoom)
    requestAnimationFrame(() => { stage.scrollTop = documentAnchor * nextZoom - viewportAnchor })
  }
  const onStageWheel = (event: WheelEvent<HTMLElement>) => {
    if (!event.ctrlKey) return
    event.preventDefault()
    const top = event.currentTarget.getBoundingClientRect().top
    changeZoomAt(pinchZoom(zoom, event.deltaY), event.clientY - top)
  }
  const objectPlaceholderCounts = useMemo(() => document ? countIncompleteObjectPlaceholders(document) : {}, [document])
  const objectPlaceholderTotal = totalObjectPlaceholders(objectPlaceholderCounts)
  const [objectNotice, setObjectNotice] = useState({ dismissed: false, expanded: false })
  useEffect(() => setObjectNotice({ dismissed: false, expanded: false }), [openedPath])
  const substitutions = Object.values(fontResolutions).filter((resolution) => resolution.substituted)
  const documentLoading = Boolean(sectionProgress && sectionProgress.loaded < sectionProgress.total)

  const resolveEditingBeforeOpen = async (): Promise<boolean> => {
    const currentEditing = editingTransient.current.currentSession
    if (!currentEditing?.isDirty) return true
    try {
      const resolution = await api().resolveDirtyEditing(
        currentEditing.sessionId
      ) as EditingResolveDirtyResult
      if (resolution.outcome === 'cancelled') {
        setEditingStatus('문서 열기 취소 · 편집 내용 유지')
        return false
      }
    } catch (reason) {
      const status = editingErrorStatus('문서 교체', reason) ?? '문서 교체 취소'
      if (isEditingEngineFailure(reason)) endEditingAfterEngineFailure(status)
      else setEditingStatus(status)
      return false
    }
    return true
  }
  const openPath = async (path: string, openReceivedAt = Date.now()) => {
    if (editingTransient.current.currentSession) {
      // 입력 칸에 남은 글자와 진행 중인 편집 command를 먼저 반영한 뒤 dirty 여부를 본다. 입력 직후 다른 문서를 열어도
      // 마지막 글자가 저장 확인에 들어간다(편집 상태가 그 사이 끝났으면 확인 없이 연다).
      let proceed: boolean | undefined
      await editingTransient.current.runAfterInput(async () => {
        proceed = await resolveEditingBeforeOpen()
      })
      if (proceed === false) return
    }
    const requestStartedAt = performance.now()
    const loadId = String(++loadSequence.current)
    activeLoadId.current = loadId
    setLoading(true); setError(null); setErrorCode(null)
    setLoadTiming(null)
    setSectionProgress(null)
    setBackgroundError(null)
    setFixedPrintPages(null)
    setFixedFirstPageReady(false)
    setFixedFollowingPagesEnabled(false)
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    void api().stopEditing()
    editingTransient.current.reset()
    resetEditing()
    setOpenedPath(null)
    showDocument(null)
    setLayoutMeasurements(undefined)
    setFixedDocument(null)
    try {
      if (rhwpAdapter) (await rhwpAdapter).closeRhwpFixedPageDocument()
      const imported = await api().importDocument({ filePath: path, loadId }) as DocumentImportResult
      if (activeLoadId.current !== imported.loadId) return
      if (!imported.ok) {
        setErrorCode(imported.error.code)
        setError(imported.error.message)
        return
      }
      if (imported.format === 'hwp') {
        const adapter = await loadRhwpAdapter()
        if (activeLoadId.current !== loadId) return
        const result = await adapter.openRhwpFixedPageDocument(
          new Uint8Array(imported.bytes),
          async (assetUrl) => {
            if (assetUrl.startsWith('file:')) {
              return new Uint8Array(await api().readRhwpWasm(assetUrl))
            }
            const response = await fetch(assetUrl)
            if (!response.ok) throw new Error('HWP WASM을 불러오지 못했습니다.')
            return new Uint8Array(await response.arrayBuffer())
          }
        )
        if (activeLoadId.current !== loadId) {
          adapter.closeRhwpFixedPageDocument()
          return
        }
        setFixedDocument(result.document)
        setSectionProgress({ loaded: result.document.sectionCount, total: result.document.sectionCount })
        setLoadTiming({
          format: 'hwp',
          requestStartedAt,
          openReceivedAt,
          requestToModelMs: performance.now() - requestStartedAt,
          packageOpenMs: imported.timings.sourceReadMs,
          packageIndexMs: 0,
          decodeMs: result.timings.parseMs,
          mainTotalMs: performance.now() - requestStartedAt,
          wasmInitMs: result.timings.wasmInitMs,
          pageInfoMs: result.timings.pageInfoMs
        })
        setFileName(documentFileName(path))
        setOpenedPath(path)
        return
      }
      showDocument(imported.document)
      setSectionProgress({ loaded: imported.complete ? imported.sectionCount : imported.document.sections.length, total: imported.sectionCount })
      setLoadTiming({ format: 'hwpx', requestStartedAt, openReceivedAt, requestToModelMs: performance.now() - requestStartedAt, ...imported.timings })
      setFileName(documentFileName(path))
      setOpenedPath(path)
    }
    catch (reason) {
      if (activeLoadId.current === loadId) {
        setErrorCode(
          reason && typeof reason === 'object' && 'code' in reason
            ? String(reason.code)
            : 'DOCUMENT_OPEN_FAILED'
        )
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    finally { if (activeLoadId.current === loadId) setLoading(false) }
  }
  useEffect(() => {
    // PDF 메타데이터 제목은 page title에서 온다. 창 제목은 main이 `<파일 이름> - Han-Flow`로 따로 정한다.
    globalThis.document.title = openedPath ? documentTitle(openedPath) : APP_TITLE
  }, [openedPath])
  useEffect(() => {
    if (!fixedFirstPageReady) {
      setFixedFollowingPagesEnabled(false)
      return
    }
    const timeout = setTimeout(() => setFixedFollowingPagesEnabled(true), 75)
    return () => clearTimeout(timeout)
  }, [fixedFirstPageReady])
  useEffect(() => {
    if (
      !hasDocument ||
      !loadTiming ||
      loadTiming.firstPaintMs !== undefined ||
      pageCount === 0 ||
      (fixedDocument && !fixedFirstPageReady)
    ) return
    const requestStartedAt = loadTiming.requestStartedAt
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setLoadTiming((current) =>
        current?.requestStartedAt === requestStartedAt && current.firstPaintMs === undefined
          ? { ...current, firstPaintMs: performance.now() - requestStartedAt, openToFirstPaintMs: Date.now() - current.openReceivedAt }
          : current
      ))
    })
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [hasDocument, loadTiming, pageCount, fixedDocument, fixedFirstPageReady])
  useEffect(() => {
    if (loadTiming?.openToFirstPaintMs === undefined || reportedBenchmark.current === loadTiming.requestStartedAt) return
    reportedBenchmark.current = loadTiming.requestStartedAt
    void api().reportBenchmark(loadTiming)
  }, [loadTiming])
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const initialPath = query.get('open')
    const initialReceivedAt = Number(query.get('openReceivedAt')) || Date.now()
    if (initialPath) void openPath(initialPath, initialReceivedAt)
    const unsubscribe = api().onOpenFile(({ filePath, receivedAt }: { filePath: string; receivedAt: number }) => { void openPath(filePath, receivedAt) })
    return unsubscribe
  }, [])
  useEffect(() => api().onDocumentComplete((payload: DocumentImportComplete) => {
    if (payload.loadId !== activeLoadId.current) return
    showDocument(payload.document)
    setSectionProgress({ loaded: payload.document.sections.length, total: payload.document.sections.length })
  }), [])
  useEffect(() => api().onDocumentError((payload: DocumentImportBackgroundError) => {
    if (payload.loadId !== activeLoadId.current) return
    setBackgroundError(payload.error.message)
  }), [])
  useEffect(() => {
    const stopPrepare = api().onPreparePdf(async (requestId: string) => {
      setPrinting(true)
      if (fixedDocument) {
        const renderedPages = await (await loadRhwpAdapter()).renderAllRhwpFixedPages(fixedDocument.pageCount)
        setFixedPrintPages(renderedPages)
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await globalThis.document.fonts.ready
      if (fixedDocument) {
        await waitForFixedPagePrintReady(globalThis.document, fixedDocument.pageCount)
      } else {
        await Promise.all(Array.from(globalThis.document.images).map((image) =>
          image.complete && image.naturalWidth > 0
            ? Promise.resolve()
            : image.decode()
        ))
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      api().pdfReady(requestId)
    })
    const stopFinish = api().onFinishPdf(() => {
      setPrinting(false)
      setFixedPrintPages(null)
    })
    return () => { stopPrepare(); stopFinish() }
  }, [fixedDocument])
  // 문서가 쓰는 글꼴 목록이 바뀔 때만 글꼴을 다시 찾는다(편집 patch는 보통 style map을 바꾸지 않는다).
  const requestedFontsKey = useMemo(() => charStyles
    ? `doc:${JSON.stringify([...new Set(Object.values(charStyles).map((style) => style.fontFamily).filter((font): font is string => Boolean(font)))])}`
    : 'none', [charStyles])
  useEffect(() => {
    if (requestedFontsKey === 'none') return
    const requested = JSON.parse(requestedFontsKey.slice(4)) as string[]
    const fontOptions = { platform: rendererPlatform() }
    void api().getFonts()
      .then((fonts: string[]) => setFontResolutions(resolveDocumentFonts(requested, fonts, fontOptions)))
      .catch(() => setFontResolutions(resolveDocumentFonts(requested, [], fontOptions)))
  }, [requestedFontsKey])
  const layoutMeasurementsRef = useRef(layoutMeasurements)
  layoutMeasurementsRef.current = layoutMeasurements
  // 이번 측정에서 새로 잰 section 수. 측정값으로 다시 나눈 쪽이 commit되면 표시를 남긴다(입력 지연 측정 'bold' mode가 읽는다).
  const measuredSectionsRef = useRef<number | undefined>(undefined)
  const commitMeasurements = useCallback((next: DocumentLayoutMeasurements, previous: DocumentLayoutMeasurements | undefined) => {
    measuredSectionsRef.current = countMeasuredSections(next, previous)
    setLayoutMeasurements(next)
  }, [setLayoutMeasurements])
  useLayoutEffect(() => {
    const measuredSections = measuredSectionsRef.current
    if (measuredSections === undefined) return
    measuredSectionsRef.current = undefined
    markLayoutMeasured(measuredSections)
  }, [pagination])
  useLayoutEffect(() => {
    const container = measurementRef.current
    if (!effectiveDocument || !measurementStylesKey || !container) return
    const replaced = documentReplacedRef.current
    documentReplacedRef.current = false
    const previous = replaced ? undefined : layoutMeasurementsRef.current
    if (replaced) {
      // 새 문서(열기·편집 시작·refresh): 이전처럼 측정값을 비우고 모든 section을 다시 잰다.
      if (layoutMeasurementsRef.current) setLayoutMeasurements(undefined)
    } else if (previous && previous.styles === measurementStylesKey) {
      // 편집 patch: style 표지·쪽 크기가 그대로면 바뀐 section(style definition이 바뀐 id를 쓰는 section 포함)만
      // 그리기 전에 바로 잰다(한 번에 맞는 쪽으로 그린다).
      // 글꼴을 내려받는 중이면(또는 이번 측정이 글꼴 내려받기를 시작했으면) 아래 비동기 측정이 다시 잰다.
      if (globalThis.document.fonts.status === 'loaded') {
        const next = measureDocumentLayout(effectiveDocument, measurementStylesKey, container, previous)
        if (next.sections.length !== previous.sections.length || next.sections.some((entry, index) => entry !== previous.sections[index])) {
          commitMeasurements(next, previous)
        } else {
          markLayoutMeasured(0)
        }
        if (globalThis.document.fonts.status === 'loaded') return
      }
    }
    // 그 밖(첫 측정, 글꼴 목록·찾은 글꼴이 바뀐 편집 결과): 글꼴이 준비된 다음 frame에 잰다. 표지가 그대로면 바뀐 section만 잰다.
    let cancelled = false
    const reuse = previous?.styles === measurementStylesKey ? previous : undefined
    void globalThis.document.fonts.ready.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))).then(() => {
      if (cancelled || !measurementRef.current) return
      commitMeasurements(measureDocumentLayout(effectiveDocument, measurementStylesKey, measurementRef.current, reuse), reuse)
    })
    return () => { cancelled = true }
  }, [effectiveDocument, measurementStylesKey])
  useEffect(() => () => {
    if (rhwpAdapter) void rhwpAdapter.then((adapter) => adapter.closeRhwpFixedPageDocument())
  }, [])
  useEffect(() => {
    const sequence = ++searchSequence.current
    const query = searchQuery.trim()
    if (!fixedDocument || !query) {
      setSearchResults([])
      setActiveSearchResult(0)
      setSearching(false)
      return
    }
    setSearching(true)
    const timeout = setTimeout(() => {
      void loadRhwpAdapter()
        .then((adapter) => adapter.searchRhwpFixedPages(query, fixedDocument.pageCount))
        .then((results) => {
          if (searchSequence.current !== sequence) return
          setSearchResults(results)
          setActiveSearchResult(0)
          setSearching(false)
        })
        .catch((reason) => {
          if (searchSequence.current !== sequence) return
          setSearching(false)
          setBackgroundError(reason instanceof Error ? reason.message : String(reason))
        })
    }, 120)
    return () => clearTimeout(timeout)
  }, [fixedDocument, searchQuery])
  useEffect(() => {
    const result = searchResults[activeSearchResult]
    const stage = stageRef.current
    if (!fixedDocument || !result || !stage) return
    const offsets = fixedPageOffsets(fixedDocument.pages)
    stage.scrollTo({ top: offsets[result.pageIndex] * zoom, behavior: 'smooth' })
  }, [fixedDocument, searchResults, activeSearchResult, zoom])
  const openSearch = () => {
    if (!fixedDocument) return
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }
  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    setActiveSearchResult(0)
  }
  const stepSearchResult = (direction: number) => {
    if (!searchResults.length) return
    setActiveSearchResult((current) => (current + direction + searchResults.length) % searchResults.length)
  }
  const applyEditingResultRef = useRef<(result: EditingActionResult) => void>(() => undefined)
  const resynchronizeEditingProjection = useCallback(async () => {
    const current = editingTransient.current.currentSession
    if (!current) return
    try {
      applyEditingResultRef.current(await api().refreshEditing(current.sessionId) as EditingActionResult)
    } catch (reason) {
      setEditingStatus(editingErrorStatus('편집 화면 동기화', reason) ?? '편집 화면을 다시 맞추지 못했습니다.')
    }
  }, [])
  const applyEditingResult = useCallback((result: EditingActionResult) => {
    markEditingTiming('han-flow:editing-result')
    let next: ViewerDocument
    if (result.patch) {
      const patched = applyViewerDocumentPatchIfCurrent(documentRef.current, projectionIdRef.current, result.patch)
      if (!patched) {
        // 앞 projection을 놓쳤거나(응답 직렬화 실패 등) section 수·위치가 지금 문서와 맞지 않는다.
        // 이 patch는 버리고 worker에서 전체 문서를 받아 다시 맞춘다(편집 실패로 다루지 않는다).
        void resynchronizeEditingProjection()
        return
      }
      next = patched
      measurementStyles.current.notePatch(result.patch)
      showDocument(next, result.patch.projectionId, true)
    } else {
      next = result.document
      showDocument(next, result.projectionId)
    }
    setEditing((current) => current ? {
      sessionId: current.sessionId,
      revision: result.revision,
      savedRevision: result.savedRevision,
      canUndo: result.canUndo,
      canRedo: result.canRedo,
      isDirty: result.isDirty
    } : current)
    editingTransient.current.noteHistory(result)
    if (result.selection) setTableCellSelection(undefined)
    const projection = reconcileEditingSelection(next, result.selection)
    editingSelectionRef.current = projection.selection
    setEditingSelection(projection.selection)
    setEditingSelectionNotice(editingSelectionProjectionStatus(projection.status))
  }, [])
  applyEditingResultRef.current = applyEditingResult
  // 편집 엔진(worker)이 timeout·crash·메모리 초과로 끝나면 main은 session을 이미 지웠다.
  // 편집 모드만 닫고 마지막으로 보이던 문서 화면은 그대로 둔다.
  const endEditingAfterEngineFailure = useCallback((status: string) => {
    void api().stopEditing()
    editingTransient.current.reset()
    resetEditing()
    setEditingStatus(status)
  }, [])
  const recoverEditingFailure = useCallback(async (action: string, reason: unknown) => {
    const status = editingErrorStatus(action, reason) ?? '편집 중'
    if (isEditingEngineFailure(reason)) {
      endEditingAfterEngineFailure(status)
      return
    }
    const current = editingTransient.current.currentSession
    // 엔진 실패로 편집 모드를 이미 닫았다면 뒤이어 실패한 대기 요청의 session 만료 안내로 덮어쓰지 않는다.
    if (!current && editingErrorCode(reason) === 'EDITING_SESSION_EXPIRED') return
    if (editingErrorCode(reason) !== 'EDITING_CONFLICT' || !current) {
      setEditingStatus(status)
      return
    }
    try {
      applyEditingResult(await api().refreshEditing(current.sessionId) as EditingActionResult)
      setEditingStatus(`${status} · 최신 문서 상태로 복구했습니다.`)
    } catch (refreshReason) {
      setEditingStatus(
        `${status} · ${editingErrorStatus('편집 상태 복구', refreshReason) ?? '복구하지 못했습니다.'}`
      )
    }
  }, [applyEditingResult, endEditingAfterEngineFailure])
  const updateEditingSelection = useCallback((
    anchor: ViewerSourceAnchor,
    selection: { anchorOffset: number; focusOffset: number }
  ) => {
    setEditingSelectionNotice(null)
    setTableCellSelection(undefined)
    editingSelectionRef.current = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      focusTextNodeId: anchor.textNodeId,
      ...selection
    }
    setEditingSelection(editingSelectionRef.current)
  }, [])
  const updateEditorSelection = useCallback((selection: EditorSelection) => {
    setEditingSelectionNotice(null)
    setTableCellSelection(undefined)
    editingSelectionRef.current = selection
    setEditingSelection(selection)
  }, [])
  const updateTableCellSelection = useCallback((selection: TableCellSelection) => {
    editingSelectionRef.current = undefined
    setEditingSelection(undefined)
    setEditingSelectionNotice(null)
    setTableCellSelection(selection)
    setEditingStatus(`병합 셀 선택 · ${selection.row + 1}행 ${selection.column + 1}열`)
  }, [])
  const commitParagraph = useCallback((anchor: ViewerSourceAnchor, intent: TextCommitIntent) => {
    if (!editing) return
    const sessionId = editing.sessionId
    const transactionId = editingTransient.current.nextTransactionId('ui')
    markEditingTiming('han-flow:editing-commit')
    setEditingPending((current) => current + 1)
    setEditingStatus('변경 반영 중…')
    // 응답까지 센다. 입력 직후 누른 실행 취소·모양·저장 command는 이 commit이 끝난 뒤에 돈다(`runAfterInput`).
    void editingTransient.current.trackInput(api().commitEditing({
      sessionId,
      transactionId,
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: intent.from,
      to: intent.to,
      insert: intent.insert,
      selectionBefore: {
        sectionPath: anchor.sectionPath,
        anchorTextNodeId: anchor.textNodeId,
        focusTextNodeId: anchor.textNodeId,
        ...intent.selectionBefore
      },
      selectionAfter: {
        sectionPath: anchor.sectionPath,
        anchorTextNodeId: anchor.textNodeId,
        focusTextNodeId: anchor.textNodeId,
        ...intent.selectionAfter
      },
      inputType: intent.inputType,
      compositionId: intent.compositionId,
      timestamp: intent.timestamp
    }) as Promise<EditingActionResult>).then((result: EditingActionResult) => {
      applyEditingResult(result)
      setEditingStatus('편집 중')
    }).catch((reason: unknown) => {
      return recoverEditingFailure('편집', reason)
    }).finally(() => {
      setEditingPending((current) => Math.max(0, current - 1))
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const commitRangeParagraph = useCallback((
    selection: EditorSelection,
    insert: string,
    inputType: string,
    timestamp: number
  ) => {
    if (!editing || editingTransient.current.isImeComposing) return
    const sessionId = editing.sessionId
    // 남은 글자 commit을 먼저 보낸 뒤 보낸다(범위 selection의 글자 offset은 이미 그 글자를 포함한다).
    void editingTransient.current.runTypingCommand(async () => {
      setEditingPending((current) => current + 1)
      setEditingStatus('여러 글자 범위 반영 중…')
      try {
        applyEditingResult(await api().commitRangeEditing({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-range'),
          selectionBefore: selection,
          insert,
          inputType,
          timestamp
        }) as EditingActionResult)
        setEditingStatus('편집 중')
      } catch (reason) {
        await recoverEditingFailure('범위 편집', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const splitEditingParagraph = useCallback((selection: EditorSelection, timestamp: number) => {
    if (!editing || editingTransient.current.isImeComposing) return
    const sessionId = editing.sessionId
    // 한글 입력 직후 Enter도 남은 글자 commit을 먼저 보낸 뒤 나눈다. 빈 문단 첫 입력이면 caret anchor가 바뀌므로 그 commit
    // 결과를 기다린다.
    void editingTransient.current.runTypingCommand(async (waitedForInput) => {
      setEditingPending((current) => current + 1)
      setEditingStatus('문단 나누는 중…')
      try {
        applyEditingResult(await api().splitParagraphEditing({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-split'),
          selectionBefore: selectionAfterInput(selection, editingSelectionRef.current, waitedForInput, { followSameSurface: false }),
          timestamp
        }) as EditingActionResult)
        setEditingStatus('편집 중')
      } catch (reason) {
        await recoverEditingFailure('문단 나눔', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    }, isSyntheticCaretAnchorId(selection.focusTextNodeId))
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const mergeEditingParagraph = useCallback((
    selection: EditorSelection,
    direction: 'previous' | 'next',
    inputType: 'deleteContentBackward' | 'deleteContentForward',
    timestamp: number
  ) => {
    if (!editing || editingTransient.current.isImeComposing) return
    const sessionId = editing.sessionId
    void editingTransient.current.runTypingCommand(async (waitedForInput) => {
      setEditingPending((current) => current + 1)
      setEditingStatus('문단 합치는 중…')
      try {
        applyEditingResult(await api().mergeParagraphEditing({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-merge'),
          selectionBefore: selectionAfterInput(selection, editingSelectionRef.current, waitedForInput, { followSameSurface: false }),
          direction,
          inputType,
          timestamp
        }) as EditingActionResult)
        setEditingStatus('편집 중')
      } catch (reason) {
        await recoverEditingFailure('문단 병합', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    }, isSyntheticCaretAnchorId(selection.focusTextNodeId))
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const onComposingChange = useCallback((composing: boolean) => {
    editingTransient.current.setComposing(composing)
    setEditingInputBuffered(composing)
  }, [])
  const registerInputFlush = useCallback(
    (flusher: EditingInputFlusher) => editingTransient.current.registerInputFlusher(flusher),
    []
  )
  const editingCapabilityState = useMemo(
    () => editingCapabilities(document, editingSelection),
    [document, editingSelection]
  )
  const paragraphStructureReason = editingCapabilityState.paragraphStructure.reason
  const paragraphStructureUnavailable = useCallback((reason?: EditingCapabilityReason) => {
    setEditingStatus(
      editingCapabilityStatus(
        '문단 나눔·병합',
        reason ?? (paragraphStructureReason === 'EMPTY_PARAGRAPH' ? 'EMPTY_PARAGRAPH' : 'TABLE_CELL_STRUCTURE')
      ) ?? '편집 중'
    )
  }, [paragraphStructureReason])
  const topLevelStructure = useMemo(
    () => document ? topLevelParagraphStructure(document) : undefined,
    [document]
  )
  const structureOf = useCallback(
    (paragraphId: string) => topLevelStructure?.get(paragraphId),
    [topLevelStructure]
  )
  const {
    activeStyle,
    activeCellStyle,
    characterStyleAvailable,
    paragraphStyleAvailable,
    cellStyleAvailable
  } = useMemo(
    () => editingRibbonState(document, editingCapabilityState),
    [document, editingCapabilityState]
  )
  const characterStyleState = editingCapabilityState.characterStyle
  const applyCharacterStyle = useCallback(async (
    style: { bold?: boolean; italic?: boolean; underline?: boolean; strikeout?: boolean; height?: number; color?: string; fontId?: string }
  ) => {
    if (
      !editing ||
      !editingSelection ||
      !characterStyleState.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('글자 모양 반영 중…')
      try {
        applyEditingResult(await api().applyCharacterStyle({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-style'),
          sectionPath: selection.sectionPath,
          textNodeId: selection.focusTextNodeId,
          selection,
          ...style,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus(
          style.bold !== undefined
            ? style.bold ? '굵게 적용' : '굵게 해제'
            : style.italic !== undefined
              ? style.italic ? '기울임 적용' : '기울임 해제'
              : style.underline !== undefined
                ? style.underline ? '밑줄 적용' : '밑줄 해제'
                : style.strikeout !== undefined
                  ? style.strikeout ? '취소선 적용' : '취소선 해제'
            : style.height !== undefined
              ? `글자 크기 ${style.height / 100}pt`
              : style.color !== undefined
                ? '글자 색상 적용'
                : '문서 글꼴 적용'
        )
      } catch (reason) {
        await recoverEditingFailure('글자 모양', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    characterStyleState.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const applyParagraphStyle = useCallback(async (style: {
    align?: ParagraphAlignment
    lineSpacing?: number
    indent?: number
    marginBefore?: number
    marginAfter?: number
  }) => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.paragraphStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('문단 모양 반영 중…')
      try {
        applyEditingResult(await api().applyParagraphStyle({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-style'),
          sectionPath: selection.sectionPath,
          textNodeId: selection.focusTextNodeId,
          selection,
          ...style,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus(
          style.align !== undefined
            ? '문단 정렬 적용'
            : style.lineSpacing !== undefined
              ? `줄 간격 ${style.lineSpacing}%`
              : style.indent !== undefined
                ? style.indent >= 0 ? `첫 줄 들여쓰기 ${style.indent / 100}pt` : `첫 줄 내어쓰기 ${Math.abs(style.indent) / 100}pt`
                : style.marginBefore !== undefined
                  ? `문단 앞 간격 ${style.marginBefore / 100}pt`
                  : `문단 뒤 간격 ${(style.marginAfter ?? 0) / 100}pt`
        )
      } catch (reason) {
        await recoverEditingFailure('문단 모양', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.paragraphStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const applyCellStyle = useCallback(async (style: {
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
    borderType?: 'NONE' | 'SOLID'
  }) => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 셀 모양 반영 중…')
      try {
        applyEditingResult(await api().applyCellStyle({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-cell-style'),
          sectionPath: selection.sectionPath,
          textNodeId: selection.focusTextNodeId,
          selection,
          ...style,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus(
          style.backgroundColor !== undefined
            ? '표 셀 배경색 적용'
            : style.borderType === 'NONE'
              ? '표 셀 테두리 해제'
              : style.borderWidth !== undefined
                ? `표 셀 테두리 ${style.borderWidth}mm`
                : '표 셀 테두리색 적용'
        )
      } catch (reason) {
        await recoverEditingFailure('표 셀 모양', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const insertTableRowAfter = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 행 추가 중…')
      try {
        applyEditingResult(await api().insertTableRowAfter({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-row'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('현재 셀 아래에 빈 행 추가')
      } catch (reason) {
        await recoverEditingFailure('표 행 추가', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const deleteTableRow = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 행 삭제 중…')
      try {
        applyEditingResult(await api().deleteTableRow({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-row'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('현재 표 행 삭제')
      } catch (reason) {
        await recoverEditingFailure('표 행 삭제', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const insertTableColumnAfter = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 열 추가 중…')
      try {
        applyEditingResult(await api().insertTableColumnAfter({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-column'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('현재 열 오른쪽에 빈 열 추가')
      } catch (reason) {
        await recoverEditingFailure('표 열 추가', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const deleteTableColumn = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 열 삭제 중…')
      try {
        applyEditingResult(await api().deleteTableColumn({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-column'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('현재 표 열 삭제')
      } catch (reason) {
        await recoverEditingFailure('표 열 삭제', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const mergeTableCellRight = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('표 셀 병합 중…')
      try {
        applyEditingResult(await api().mergeTableCellRight({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-cell-merge'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('오른쪽 셀과 병합 · 병합 셀은 읽기 전용')
      } catch (reason) {
        await recoverEditingFailure('표 셀 병합', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const splitTableCell = useCallback(async () => {
    if (
      !editing ||
      !tableCellSelection
    ) return
    const sessionId = editing.sessionId
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 돈다.
    await editingTransient.current.runAfterInput(async () => {
      setEditingPending((current) => current + 1)
      setEditingStatus('병합 셀 분할 중…')
      try {
        applyEditingResult(await api().splitTableCell({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-table-cell-split'),
          selection: tableCellSelection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('병합 셀 분할 · 왼쪽 셀 편집 가능')
      } catch (reason) {
        await recoverEditingFailure('표 셀 분할', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    tableCellSelection,
    applyEditingResult,
    recoverEditingFailure
  ])
  const insertFootnote = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.footnote.available
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('각주 넣는 중…')
      try {
        applyEditingResult(await api().insertFootnote({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-footnote-insert'),
          selectionBefore: selection,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('caret 자리에 각주를 넣고 각주 본문으로 이동')
      } catch (reason) {
        await recoverEditingFailure('각주 넣기', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.footnote.available,
    applyEditingResult,
    recoverEditingFailure
  ])
  const deleteFootnote = useCallback(async () => {
    const notePath = editingCapabilityState.focus?.footnotePath
    if (
      !editing ||
      !editingSelection ||
      !notePath
    ) return
    const sessionId = editing.sessionId
    const requested = editingSelectionRef.current ?? editingSelection
    // 입력 직후 눌러도 버리지 않는다. 입력 칸의 남은 글자를 먼저 반영한 뒤 그 결과 selection에서 돈다.
    await editingTransient.current.runAfterInput(async (waitedForInput) => {
      const selection = selectionAfterInput(requested, editingSelectionRef.current, waitedForInput)
      setEditingPending((current) => current + 1)
      setEditingStatus('각주 지우는 중…')
      try {
        applyEditingResult(await api().deleteFootnote({
          sessionId,
          transactionId: editingTransient.current.nextTransactionId('ui-footnote-delete'),
          selectionBefore: selection,
          notePath,
          timestamp: performance.now()
        }) as EditingActionResult)
        setEditingStatus('각주를 지우고 뒤 각주 번호를 다시 매김')
      } catch (reason) {
        await recoverEditingFailure('각주 지우기', reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.focus?.footnotePath,
    applyEditingResult,
    recoverEditingFailure
  ])
  const startEditing = async () => {
    if (!openedPath || fixedDocument || documentLoading || editing) return
    setEditingStatus('편집 준비 중…')
    try {
      const result = await api().startEditing({ filePath: openedPath }) as EditingStartResult
      showDocument(result.document, result.projectionId)
      setEditingSelectionNotice(null)
      setEditing({
        sessionId: result.sessionId,
        revision: result.revision,
        savedRevision: result.savedRevision,
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        isDirty: result.isDirty
      })
      setEditingStatus('편집 중 · 일반 문단·표 셀')
    } catch (reason) {
      setEditingStatus(editingErrorStatus('편집 시작', reason) ?? '편집 시작 취소')
    }
  }
  // main이 [복구]를 고른 편집 기록. 원본을 열고(이미 열려 있으면 그대로) 배경 로딩이 끝나면 기록을 replay한다.
  const [pendingRecovery, setPendingRecovery] = useState<{ filePath: string; journalId: string; opened: boolean } | null>(null)
  // 복구 기록이 멈춘 편집 session. 그 session이 이어지는 동안 상태 막대에 계속 알린다.
  const [recoveryJournalStopped, setRecoveryJournalStopped] = useState<{ sessionId: string; message: string } | null>(null)
  useEffect(() => api().onRecoveryJournalStopped((notice: { sessionId: string; message: string }) => {
    setRecoveryJournalStopped(notice)
    if (editingTransient.current.currentSession?.sessionId === notice.sessionId) setEditingStatus(notice.message)
  }), [])
  // 창 닫기·앱 종료 전 main의 요청: 입력 칸에 남은 글자를 commit하고 끝나면 답한다. main은 답을 받은 뒤 dirty를 본다.
  useEffect(() => api().onFlushEditingInput((requestId: string) => {
    void answerInputFlushRequest(editingTransient.current, () => api().editingInputFlushed(requestId))
  }), [])
  useEffect(() => api().onRecoveryStart((request: { filePath: string; journalId: string }) => {
    // 엔진이 끝난 session을 renderer가 아직 모를 수 있다. 편집 상태를 먼저 정리한다.
    if (editingTransient.current.currentSession) {
      void api().stopEditing()
      editingTransient.current.reset()
      resetEditing()
    }
    setEditingStatus('편집 내용 복구 준비 중…')
    setPendingRecovery({ ...request, opened: false })
  }), [])
  useEffect(() => {
    if (!pendingRecovery || loading) return
    if (openedPath !== pendingRecovery.filePath) {
      if (pendingRecovery.opened) {
        // 원본을 열지 못했다(오류 화면). main은 기록을 그대로 보관한다.
        setPendingRecovery(null)
        setEditingStatus('편집 복구 취소 · 원본 문서를 열지 못했습니다.')
        return
      }
      setPendingRecovery({ ...pendingRecovery, opened: true })
      void openPath(pendingRecovery.filePath)
      return
    }
    if (documentLoading || editing || fixedDocument) return
    const { journalId } = pendingRecovery
    setPendingRecovery(null)
    void (async () => {
      setEditingStatus('편집 내용 복구 중…')
      try {
        const result = await api().recoverEditing({ journalId }) as EditingStartResult & {
          recoveredEdits: number
          recoveredTornTail?: boolean
        }
        showDocument(result.document, result.projectionId)
        setEditingSelectionNotice(null)
        setEditing({
          sessionId: result.sessionId,
          revision: result.revision,
          savedRevision: result.savedRevision,
          canUndo: result.canUndo,
          canRedo: result.canRedo,
          isDirty: result.isDirty
        })
        // 마지막 순간 쓰다 끊긴 기록은 [복구] 뒤 편집 worker가 전체 기록을 해석해야 알 수 있어 여기서 알린다.
        const tornNote = result.recoveredTornTail ? ' (마지막 순간의 기록 일부는 끝까지 저장되지 않아 제외)' : ''
        setEditingStatus(`편집 내용 복구 · 편집 ${result.recoveredEdits}개${tornNote} · 확인한 뒤 다른 이름으로 저장하세요`)
      } catch (reason) {
        setEditingStatus(editingErrorStatus('편집 복구', reason) ?? '편집 복구 취소')
      }
    })()
  }, [pendingRecovery, loading, openedPath, documentLoading, editing, fixedDocument])
  // 실행 취소·다시 실행은 입력 칸에 남은 글자(한글 음절 묶음 대기·응답 대기 commit)를 먼저 반영한 뒤 돈다. 입력 직후
  // 첫 실행 취소가 그 글자를 되돌린다(예전에는 조합 대기·응답 대기 중 누른 실행 취소를 그냥 버렸다).
  const runHistory = useCallback(async (direction: HistoryDirection) => {
    if (!editing) return
    const sessionId = editing.sessionId
    await editingTransient.current.runAfterInput(async () => {
      const label = direction === 'redo' ? '다시 실행' : '실행 취소'
      setEditingPending((current) => current + 1)
      try {
        applyEditingResult(await (direction === 'redo'
          ? api().redoEditing(sessionId)
          : api().undoEditing(sessionId)) as EditingActionResult)
        setEditingStatus(label)
      } catch (reason) {
        await recoverEditingFailure(label, reason)
      } finally {
        setEditingPending((current) => Math.max(0, current - 1))
      }
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const undoEditing = useCallback(() => runHistory('undo'), [runHistory])
  const redoEditing = useCallback(() => runHistory('redo'), [runHistory])
  const routeNativeHistory = useCallback((direction: HistoryDirection) => {
    if (editingTransient.current.isImeComposing) return
    void runHistory(direction)
  }, [runHistory])
  const saveEditingAs = useCallback(async () => {
    if (!editing) return
    // 입력 직후 저장도 마지막 글자까지 담는다. 남은 글자를 반영한 뒤 그 결과의 dirty 상태로 저장 여부를 정한다.
    const hadInput = editing.isDirty || editingTransient.current.hasPendingInput
    if (!hadInput) return
    await editingTransient.current.runAfterInput(() => saveEditingAsNow())
  }, [editing?.sessionId, editing?.isDirty])
  const saveEditingAsNow = async () => {
    const current = editingTransient.current.currentSession
    if (!current?.isDirty) return
    setEditingPending((count) => count + 1)
    setEditingStatus('HWPX 변경본 검증 중…')
    try {
      const result = await api().saveEditingAs(current.sessionId) as EditingSaveAsDialogResult
      if (result.outcome === 'cancelled') {
        setEditingStatus('편집 중')
        return
      }
      editingTransient.current.noteHistory(result)
      setEditing((session) => session ? {
        sessionId: session.sessionId,
        revision: result.revision,
        savedRevision: result.savedRevision,
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        isDirty: result.isDirty
      } : session)
      const savedName = result.destinationPath.split(/[\\/]/).pop() ?? result.destinationPath
      const structureLabels = {
        text: '본문',
        'character-style': '글자 모양',
        'paragraph-style': '문단 모양',
        'paragraph-structure': '문단 구조',
        'table-cell-style': '표 셀 모양',
        'table-structure': '표 구조',
        'note-structure': '각주'
      } as const
      const savedStructures = result.lossPolicy.structures
        .map(({ structure }) => structureLabels[structure])
        .join('·') || '구조 변경 없음'
      const previewStatus = result.previewStatus === 'stale'
        ? 'Preview 갱신 안 됨'
        : result.previewStatus === 'omitted'
          ? 'Preview 없음'
          : 'Preview 일치'
      setEditingStatus(
        `저장 완료 · r${result.savedRevision} · ${savedName} · ${savedStructures} · ${previewStatus}`
      )
    } catch (reason) {
      const status = editingErrorStatus('저장', reason) ?? '편집 중'
      if (isEditingEngineFailure(reason)) endEditingAfterEngineFailure(status)
      else setEditingStatus(status)
    } finally {
      setEditingPending((count) => Math.max(0, count - 1))
    }
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        closeSearch()
        return
      }
      const action = resolveShortcut(event, shortcutPlatform)
      if (!action) return
      if (action === 'bold' && editing && activeStyle && characterStyleAvailable) {
        event.preventDefault()
        void applyCharacterStyle({ bold: !activeStyle.bold })
        return
      }
      if (action === 'italic' && editing && activeStyle && characterStyleAvailable) {
        event.preventDefault()
        void applyCharacterStyle({ italic: !activeStyle.italic })
        return
      }
      if (action === 'underline' && editing && activeStyle && characterStyleAvailable) {
        event.preventDefault()
        void applyCharacterStyle({ underline: !activeStyle.underline })
        return
      }
      if (action === 'save' && editing) {
        event.preventDefault()
        void saveEditingAs()
        return
      }
      // IME가 조합 중인 키(event.isComposing)는 IME 몫이다. 조합을 마친 뒤 대기 중인 글자는 실행 취소가 먼저 반영한다.
      if ((action === 'undo' || action === 'redo') && editing && !event.isComposing && !editingTransient.current.isImeComposing) {
        event.preventDefault()
        if (action === 'redo') void redoEditing()
        else void undoEditing()
        return
      }
      if (action === 'search' && fixedDocument) {
        event.preventDefault()
        openSearch()
        return
      }
      if (action === 'zoomIn') { event.preventDefault(); changeZoomAt(stepZoom(zoom, 1)) }
      if (action === 'zoomOut') { event.preventDefault(); changeZoomAt(stepZoom(zoom, -1)) }
      if (action === 'zoomReset') { event.preventDefault(); changeZoomAt(1) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    zoom,
    fixedDocument,
    searchOpen,
    searchResults.length,
    editing,
    activeStyle,
    characterStyleAvailable,
    applyCharacterStyle,
    undoEditing,
    redoEditing,
    saveEditingAs
  ])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const overflow = Array.from(globalThis.document.querySelectorAll<HTMLElement>('.viewer-page'))
        .map((page) => page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1 ? Number(page.dataset.pageIndex) + 1 : 0)
        .filter(Boolean)
      setOverflowPages(overflow)
    })
    return () => cancelAnimationFrame(frame)
  }, [effectiveDocument, fixedDocument, pages.length, visibleRange])
  const chooseFile = async () => { const path = await api().openFile(); if (path) await openPath(path) }
  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    const path: string | undefined = file ? api().getPathForFile(file) || undefined : undefined
    if (path && /\.(?:hwp|hwpx)$/iu.test(path)) await openPath(path)
    else {
      setErrorCode('UNSUPPORTED_FILE_TYPE')
      setError('HWP 또는 HWPX 파일만 열 수 있습니다.')
    }
  }
  const exportPdf = async () => {
    if (!hasDocument || printing || documentLoading) return
    setPrinting(true); setPdfStatus('PDF 저장 중…')
    try {
      const fixedPage = fixedDocument?.pages[0]
      const path = await api().exportPdf({
        width: fixedPage ? fixedPage.width / 96 : hwpUnitToInches(effectiveDocument!.page.width),
        height: fixedPage ? fixedPage.height / 96 : hwpUnitToInches(effectiveDocument!.page.height),
        preferCssPageSize: Boolean(fixedDocument),
        // main이 내보내기 전에 원본과 다르게 나올 개체를 확인받는다(E2E 경로는 확인하지 않는다).
        ...(!fixedDocument && objectPlaceholderTotal ? { objectPlaceholders: objectPlaceholderCounts } : {})
      })
      setPdfStatus(path ? 'PDF 저장 완료' : null)
      setPrinting(false)
    } catch (reason) {
      setPdfStatus(`PDF 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
      setPrinting(false)
    }
  }
  useEffect(() => {
    if (!hasDocument || documentLoading || automaticPdfStarted.current || new URLSearchParams(window.location.search).get('exportPdf') !== '1') return
    automaticPdfStarted.current = true
    void exportPdf()
  }, [hasDocument, documentLoading])
  const timingDetails = loadTiming
    ? loadTiming.format === 'hwp'
      ? [
          `HWP 읽기 ${ms(loadTiming.packageOpenMs)}`,
          `WASM 초기화 ${ms(loadTiming.wasmInitMs ?? 0)}`,
          `HWP 해석 ${ms(loadTiming.decodeMs)}`,
          `페이지 정보 ${ms(loadTiming.pageInfoMs ?? 0)}`,
          `IPC→모델 ${ms(loadTiming.requestToModelMs)}`,
          `요청→첫 화면 ${loadTiming.firstPaintMs === undefined ? '측정 중' : ms(loadTiming.firstPaintMs)}`,
          `열기→첫 화면 ${loadTiming.openToFirstPaintMs === undefined ? '측정 중' : ms(loadTiming.openToFirstPaintMs)}`
        ]
      : [
          `ZIP 열기 ${ms(loadTiming.packageOpenMs)}`,
          `패키지 인덱스 ${ms(loadTiming.packageIndexMs)}`,
          `전체 디코딩 ${ms(loadTiming.decodeMs)}`,
          `main 합계 ${ms(loadTiming.mainTotalMs)}`,
          `IPC→모델 ${ms(loadTiming.requestToModelMs)}`,
          `레이아웃 ${ms(pagination.layoutMs)}`,
          `요청→첫 화면 ${loadTiming.firstPaintMs === undefined ? '측정 중' : ms(loadTiming.firstPaintMs)}`,
          `열기→첫 화면 ${loadTiming.openToFirstPaintMs === undefined ? '측정 중' : ms(loadTiming.openToFirstPaintMs)}`
        ]
    : []
  const editingStatusText = editingStatus
    ? `${editingStatus}${editing?.isDirty ? ' · 저장 안 됨' : ''}`
    : null
  const editingTone = editingStatusTone(editingStatusText)
  const editingStatusClass = editingTone === 'error'
    ? 'viewer-status-error'
    : editingTone === 'warning'
      ? 'viewer-status-warn'
      : ''
  const totalSearchOccurrences = searchResults.reduce((sum, result) => sum + result.occurrences, 0)
  const activeSearchPage = searchResults[activeSearchResult]?.pageIndex

  return <main className="viewer-app" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    {printing && fixedDocument && <style>{fixedPagePrintCss(fixedDocument.pages)}</style>}
    {effectiveDocument && renderStyles && <div ref={measurementRef} className="viewer-measurement">{effectiveDocument.sections.map((section) => <MeasurementSection
      key={section.id}
      section={section}
      styles={renderStyles}
      stylesKey={measurementStylesKey!}
      width={hwpUnitToCssPx(viewerColumnContentWidth(
        effectiveDocument.page.width - effectiveDocument.page.margin.left - effectiveDocument.page.margin.right,
        section.columnLayout
      ))}
    />)}</div>}
    <ViewerToolbar
      fileName={fileName}
      shortcutPlatform={shortcutPlatform}
      editing={editing}
      editingPending={editingPending}
      editingInputPending={editingInputBuffered || editingTransient.current.hasPendingInput}
      documentLoading={documentLoading}
      loading={loading}
      hasDocument={hasDocument}
      printing={printing}
      fixedDocument={Boolean(fixedDocument)}
      canStartEditing={Boolean(document && !fixedDocument)}
      zoom={zoom}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      searching={searching}
      searchPageCount={searchResults.length}
      searchOccurrences={totalSearchOccurrences}
      searchInputRef={searchInputRef}
      activeStyle={activeStyle}
      characterStyleAvailable={characterStyleAvailable}
      paragraphStyleAvailable={paragraphStyleAvailable}
      activeCellStyle={activeCellStyle}
      cellStyleAvailable={cellStyleAvailable}
      tableCellSelectionAvailable={Boolean(tableCellSelection)}
      cellStyleTitle={editingCapabilityStatus('표 셀 모양', editingCapabilityState.cellStyle.reason)}
      characterStyleTitle={editingCapabilityStatus('글자 모양', characterStyleState.reason)}
      paragraphStyleTitle={editingCapabilityStatus(
        '문단 모양',
        editingCapabilityState.paragraphStyle.reason
      )}
      documentFonts={Object.entries(document?.fonts ?? {}).map(([id, family]) => ({ id, family }))}
      onSearchQueryChange={setSearchQuery}
      onSearchStep={stepSearchResult}
      onSearchClose={closeSearch}
      onSearchOpen={openSearch}
      onStartEditing={() => void startEditing()}
      onZoomStep={(direction) => changeZoomAt(stepZoom(zoom, direction))}
      onZoomReset={() => changeZoomAt(1)}
      onOpenNewWindow={() => void api().openNewWindow()}
      onExportPdf={() => void exportPdf()}
      onChooseFile={() => void chooseFile()}
      onSaveEditing={() => void saveEditingAs()}
      onUndoEditing={() => void undoEditing()}
      onRedoEditing={() => void redoEditing()}
      onCharacterStyle={(style) => void applyCharacterStyle(style)}
      onParagraphStyle={(style) => void applyParagraphStyle(style)}
      onCellStyle={(style) => void applyCellStyle(style)}
      onInsertTableRowAfter={() => void insertTableRowAfter()}
      onDeleteTableRow={() => void deleteTableRow()}
      onInsertTableColumnAfter={() => void insertTableColumnAfter()}
      onDeleteTableColumn={() => void deleteTableColumn()}
      onMergeTableCellRight={() => void mergeTableCellRight()}
      onSplitTableCell={() => void splitTableCell()}
      footnoteAvailable={editingCapabilityState.footnote.available}
      footnoteDeleteAvailable={Boolean(editingCapabilityState.focus?.footnotePath)}
      onInsertFootnote={() => void insertFootnote()}
      onDeleteFootnote={() => void deleteFootnote()}
    />
    {effectiveDocument && !loading && !objectNotice.dismissed && <ObjectPlaceholderBanner
      counts={objectPlaceholderCounts}
      expanded={objectNotice.expanded}
      onToggleDetails={() => setObjectNotice((current) => ({ ...current, expanded: !current.expanded }))}
      onDismiss={() => setObjectNotice({ dismissed: true, expanded: false })}
    />}
    <ViewerStage
      stageRef={stageRef}
      loading={loading}
      error={error}
      errorCode={errorCode}
      hasDocument={hasDocument}
      onChooseFile={() => void chooseFile()}
      onWheel={onStageWheel}
      onScroll={(event) => updateVisibleRange(
        event.currentTarget.scrollTop,
        event.currentTarget.clientHeight
      )}
    >
      {effectiveDocument && !loading && <ViewerPageStack
        stackRef={editingHostRef}
        kind="hwpx"
        totalPages={pages.length}
        documentLoading={documentLoading}
        layoutMeasured={Boolean(layoutMeasurements)}
        zoom={zoom}
        virtualized={virtualized}
        editing={Boolean(editing)}
        editingRevision={editing?.revision}
        topSpacer={visibleRange.topSpacer}
        bottomSpacer={visibleRange.bottomSpacer}
      >
        {(virtualized ? pages.slice(visibleRange.start, visibleRange.end) : pages).map((page, localIndex) => {
          const index = virtualized ? visibleRange.start + localIndex : localIndex
          const decoration = decorations[index]
          const pageNumber = decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined
          const pageEditing: ParagraphEditingProps | undefined = editing && !printing ? { pending: Boolean(editingPending), restoreToken: layoutMeasurements, allowMultipleRuns: true, allowParagraphRange: true, allowParagraphStructure: true, allowTableParagraph: true, editorHostRef: editingHostRef, desiredSelection: editingSelection, onCommit: commitParagraph, onComposingChange, registerInputFlush, onSelectionChange: updateEditingSelection, onEditorSelectionChange: updateEditorSelection, onRangeCommit: commitRangeParagraph, onSplitParagraph: splitEditingParagraph, onMergeParagraph: mergeEditingParagraph, onParagraphStructureUnavailable: paragraphStructureUnavailable, structureOf, documentStructureOf: structureOf, onHistory: routeNativeHistory, tableCellSelection, onTableCellSelectionChange: updateTableCellSelection } : undefined
          const pageFrame = effectiveDocument.page
          const bodyWidth = pageFrame.width - pageFrame.margin.left - pageFrame.margin.right
          const bodyHeight = pageFrame.height - pageFrame.margin.top - pageFrame.margin.bottom
          const pageNumberForColumns = index + 1
          // 다단 영역(위에서부터)과 영역마다의 단 범위. 오른쪽부터 놓는 배치(`RIGHT`, 짝수 쪽 `MIRROR`)는 쪽 번호로 정한다.
          const regions = pageColumnRegions(page)
          const regionRects = regions.map((region) => columnRects(region.columnLayout, bodyWidth, pageNumberForColumns))
          // 단마다 원본 위치 개체의 가로 기준(단·문단)이 다르다. 쪽 번호는 안쪽·바깥쪽 맞춤에 쓴다.
          const objectFrameOf = (regionIndex: number, columnIndex: number): ObjectFrame => {
            const rect = regionRects[regionIndex]?.[columnIndex] ?? { left: 0, width: bodyWidth }
            return { page: pageFrame, columnLeft: pageFrame.margin.left + rect.left, columnWidth: rect.width, pageNumber: index + 1 }
          }
          // 머리말·꼬리말은 단과 관계없이 쪽 본문 폭에 놓인다.
          const decorationFrame: ObjectFrame = { page: pageFrame, columnLeft: pageFrame.margin.left, columnWidth: bodyWidth, pageNumber: index + 1 }
          const renderParagraphs = (paragraphs: typeof page.blocks, regionIndex = 0, columnIndex = 0) => {
            const objectFrame = objectFrameOf(regionIndex, columnIndex)
            return paragraphs.map((paragraph) => <ParagraphView
              key={paragraph.id}
              paragraph={paragraph}
              document={renderStyles!}
              editing={pageEditing}
              objectFrame={objectFrame}
            />)
          }
          // 각주는 단마다(단이 하나면 쪽) 아래에 둔다. 본문 바로 아래 두기(`beneathText`)면 본문 흐름 뒤에 잇는다.
          // 다단 영역이 여럿이면 마지막 영역의 단 아래에 둔다.
          const footnoteSettings = sectionFootnoteSettings(effectiveDocument.sections[page.sectionIndex]?.footnoteSettings)
          const lastRegion = regions.length - 1
          const footnoteArea = (columnIndex: number, style?: CSSProperties) => page.footnotes?.[columnIndex]?.length
            ? <FootnoteAreaView footnotes={page.footnotes[columnIndex]} settings={footnoteSettings} columnWidth={regionRects[lastRegion]?.[columnIndex]?.width ?? bodyWidth} document={renderStyles!} editing={pageEditing} style={style} />
            : undefined
          const columnRules = (regionIndex: number): ViewerColumnRule[] => {
            const line = regions[regionIndex].columnLayout?.line
            if (!line) return []
            const width = Math.max(hwpUnitToCssPx(line.widthMm * 7200 / 25.4), 0.75)
            return columnSeparators(regions[regionIndex].columnLayout, bodyWidth, pageNumberForColumns).map((separator) => ({
              x: hwpUnitToCssPx(separator.x),
              width,
              style: FOOTNOTE_LINE_STYLES[line.type] ?? 'solid',
              color: line.color
            }))
          }
          let regionsAbove = 0
          const body = regions.length > 1 || regions[0].columnLayout
            ? regions.map((region, regionIndex) => {
                const last = regionIndex === lastRegion
                const regionHeight = last ? Math.max(bodyHeight - region.top, 0) : region.height ?? 0
                const bandSpacers = <PageBandSpacers key="object-bands" bands={regionPageBands(page.bands, region.top, last ? Infinity : regionHeight)} bodyHeight={regionHeight} />
                const rules = columnRules(regionIndex)
                const footers = last && page.footnotes ? region.columns.map((_column, columnIndex) => footnoteArea(columnIndex)) : undefined
                // 뒤 영역이 이어지는 영역은 pagination이 잡은 높이로, 마지막 영역은 쪽 본문 끝까지(구분선·각주가 있을 때) 둔다.
                const height = !last
                  ? `${hwpUnitToCssPx(regionHeight)}px`
                  : rules.length || footers?.some(Boolean) ? (regionsAbove > 0 ? `calc(100% - ${regionsAbove}px)` : '100%') : undefined
                if (!last) regionsAbove += hwpUnitToCssPx(regionHeight)
                return <ViewerColumnFlow
                  key={`region${regionIndex}`}
                  regionIndex={regions.length > 1 ? regionIndex : undefined}
                  rects={regionRects[regionIndex].map((rect) => ({ left: hwpUnitToCssPx(rect.left), width: hwpUnitToCssPx(rect.width) }))}
                  rules={rules}
                  height={height}
                  columns={region.columns.map((column, columnIndex) => [bandSpacers, ...renderParagraphs(column, regionIndex, columnIndex)])}
                  footers={footers}
                  footersBeneathText={footnoteSettings.placement.beneathText}
                />
              })
            : <><PageBandSpacers key="object-bands" bands={page.bands} bodyHeight={bodyHeight} />{renderParagraphs(page.blocks)}{footnoteArea(0, footnoteSettings.placement.beneathText ? undefined : {
                position: 'absolute',
                left: hwpUnitToCssPx(effectiveDocument.page.margin.left),
                right: hwpUnitToCssPx(effectiveDocument.page.margin.right),
                bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom)
              })}</>
          return <article className="viewer-page" data-page-index={index} key={index} style={{ width: hwpUnitToCssPx(effectiveDocument.page.width), height: pageHeight, padding: `${hwpUnitToCssPx(effectiveDocument.page.margin.top)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.right)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.bottom)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.left)}px` }}><HeaderFooterView control={decoration.header} kind="header" document={renderStyles!} offset={effectiveDocument.page.headerOffset} editing={pageEditing} active={activeDecorationPage === index} onActivate={() => setActiveDecorationPage(index)} objectFrame={decorationFrame} />{body}<PageObjectLayer blocks={page.blocks} regions={regions} frameOf={objectFrameOf} document={renderStyles!} editing={pageEditing} /><HeaderFooterView control={decoration.footer} kind="footer" document={renderStyles!} offset={effectiveDocument.page.footerOffset} editing={pageEditing} active={activeDecorationPage === index} onActivate={() => setActiveDecorationPage(index)} objectFrame={decorationFrame} />{pageNumber && decoration.pageNumber && <span className={`viewer-page-number viewer-page-number-${pageNumberPosition(decoration.pageNumber.position)}`} style={{ bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom) }}>{pageNumber}</span>}</article>
        })}
      </ViewerPageStack>}
      {fixedDocument && !loading && !error && <ViewerPageStack
        kind="hwp"
        totalPages={fixedDocument.pageCount}
        documentLoading={false}
        layoutMeasured
        zoom={zoom}
        virtualized={virtualized}
        topSpacer={visibleRange.topSpacer}
        bottomSpacer={visibleRange.bottomSpacer}
      >
        {(virtualized
          ? fixedDocument.pages.slice(visibleRange.start, visibleRange.end)
          : fixedDocument.pages
        ).map((page) => <FixedPageView
          key={page.index}
          page={page}
          printPage={fixedPrintPages?.[page.index]}
          renderEnabled={page.index === 0 || fixedFollowingPagesEnabled || printing}
          searchQuery={searchOpen ? searchQuery : ''}
          activeSearchPage={activeSearchPage === page.index}
          onReady={() => {
            if (page.index === 0) setFixedFirstPageReady(true)
          }}
          onError={setError}
        />)}
      </ViewerPageStack>}
    </ViewerStage>
    <ViewerStatusBar
      hasDocument={hasDocument}
      title={[...timingDetails, ...substitutions.map(
        (font) => `${font.requested} → ${font.resolved}`
      )].join('\n')}
      pageCount={pageCount}
      formatLabel={fixedDocument ? `HWP · ${fixedDocument.sectionCount}구역` : 'HWPX'}
      editing={editing}
      editingStatusText={editingStatusText}
      editingStatusClass={editingStatusClass}
      editingSelectionNotice={editingSelectionNotice}
      recoveryJournalNotice={editing && recoveryJournalStopped?.sessionId === editing.sessionId
        ? recoveryJournalStopped.message
        : null}
      progress={sectionProgress}
      backgroundError={backgroundError}
      hasEffectiveDocument={Boolean(effectiveDocument)}
      substitutionCount={substitutions.length}
      overflowPages={overflowPages}
      virtualized={virtualized}
      openTiming={loadTiming
        ? loadTiming.openToFirstPaintMs === undefined
          ? '측정 중…'
          : ms(loadTiming.openToFirstPaintMs)
        : undefined}
      openTimingSlow={Boolean(
        loadTiming?.openToFirstPaintMs !== undefined &&
        loadTiming.openToFirstPaintMs > 1000
      )}
      pdfStatus={pdfStatus}
      objectPlaceholderCount={effectiveDocument ? objectPlaceholderTotal : 0}
      onShowObjectPlaceholders={() => setObjectNotice({ dismissed: false, expanded: true })}
    />
  </main>
}
