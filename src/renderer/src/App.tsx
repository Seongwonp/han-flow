import { CSSProperties, DragEvent, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, WheelEvent } from 'react'
import { DocumentImportBackgroundError, DocumentImportComplete, DocumentImportResult } from '../../core/document/document_import'
import { isObjectPlaceholder, viewerColumnContentWidth, ViewerCellStyle, ViewerContent, ViewerDocument, ViewerHeaderFooter, ViewerNoteList, ViewerObjectPlaceholder, ViewerParagraph, ViewerSourceAnchor, ViewerTable, ViewerTableCell, ViewerText } from '../../core/document/viewer_document'
import { FixedPageDescriptor, FixedPageTextLayout } from '../../core/document/fixed_page_document'
import { EditingActionResult, EditingResolveDirtyResult, EditingSaveAsDialogResult, EditingStartResult } from '../../core/editing/editing_contract'
import { TextCommitIntent } from '../../core/editing/composition_input'
import {
  cellParagraphStructure,
  EditingCapabilities,
  editingCapabilities,
  EditingCapabilityReason,
  ParagraphStructureGate,
  reconcileEditingSelection,
  topLevelParagraphStructure
} from '../../core/editing/editing_capability'
import { EditorSelection } from '../../core/editing/transaction'
import { isEmptyParagraphAnchorId } from '../../core/editing/empty_paragraph_anchor'
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
import { paginateViewerDocument } from '../../core/layout/pagination'
import { paragraphIndentBox } from '../../core/layout/paragraph_indent'
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
  editingStatusTone
} from './editing_error_status'
import {
  moveParagraphEditorSelection,
  paragraphEditorRangeScope,
  paragraphEditorSurfaces,
  readParagraphEditorSelection,
  restoreParagraphEditorSelection
} from './paragraph_selection'
import { EditingImeTransientState } from './renderer_state'
import { useRendererState } from './use_renderer_state'
import { ObjectPlaceholderBanner, ViewerColumnFlow, ViewerPageStack, ViewerStage, ViewerStatusBar } from './ViewerShell'
import { countObjectPlaceholders, OBJECT_PAGE_HEIGHT_RATIO, totalObjectPlaceholders } from '../../core/document/object_placeholder'
import { hancomPuaDisplayText } from '../../core/document/hancom_pua_display'
import { ViewerToolbar } from './ViewerToolbar'
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

function textCss(item: Extract<ViewerContent, { type: 'text' }>, document: ViewerDocument): CSSProperties {
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

function Content({
  item,
  document,
  measurable = false,
  editing
}: {
  item: ViewerContent
  document: ViewerDocument
  measurable?: boolean
  editing?: ParagraphEditingProps
}) {
  if (item.type === 'text') {
    // 화면 표시만 검증된 한컴 PUA 기호를 표준 글자로 바꾼다(편집 입력 surface와 원문은 그대로).
    return <span style={textCss(item, document)}>{hancomPuaDisplayText(item.text)}</span>
  }
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    return <img className="viewer-image" src={`data:${resource.mime};base64,${resource.data}`} style={{ width: item.width ? hwpUnitToCssPx(item.width) : undefined, height: item.height ? hwpUnitToCssPx(item.height) : undefined }} />
  }
  if (item.type === 'object-placeholder') return <ObjectPlaceholderView item={item} document={document} />
  if (item.type === 'note-list') return <NoteListView item={item} document={document} />
  return <TableView table={item} document={document} measurable={measurable} editing={editing} />
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

export function ObjectPlaceholderView({ item, document }: { item: ViewerObjectPlaceholder; document: ViewerDocument }) {
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
  if (item.kind === 'ruby' && item.ruby) {
    return <ruby {...common} className={`viewer-ruby viewer-ruby-${item.ruby.position}`} title="덧말">{item.fallbackText}<rt>{item.ruby.text}</rt></ruby>
  }
  const reserve = item.size && (item.flow === 'inline' || item.flow === 'block')
  // 수식은 script가 선언 크기보다 길기 마련이라 폭을 최소값으로만 두어 한 줄로 읽히게 한다.
  const style: CSSProperties = reserve
    ? item.kind === 'equation'
      ? { minWidth: hwpUnitToCssPx(item.size!.width), minHeight: hwpUnitToCssPx(item.size!.height) }
      : { width: hwpUnitToCssPx(item.size!.width), minHeight: hwpUnitToCssPx(item.size!.height) }
    : {}
  const markerText = item.flow === 'marker' && item.paragraphs ? paragraphsPlainText(item.paragraphs) : ''
  // 글상자처럼 되살린 문단이 있으면 이름표를 모서리에 겹쳐 두어 상자가 선언 크기보다 커지지 않게 한다.
  const hasBody = item.flow !== 'marker' && Boolean(item.paragraphs?.length)
  return <span
    {...common}
    className={`viewer-object-placeholder viewer-object-${item.flow}${hasBody ? ' viewer-object-with-body' : ''}${item.fitted ? ' viewer-object-fitted' : ''}`}
    data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
    role="group"
    aria-label={`${item.label} (원본 개체 자리 표시${item.fitted ? ', 쪽에 맞게 줄임' : ''})`}
    title={`${item.label}: 원본 개체를 그대로 그리지 못해 자리 표시로 보여 줍니다.${item.fitted ? ' 원본 높이가 쪽보다 커서 줄여 표시합니다.' : ''} 저장할 때 원본은 그대로 보존합니다.`}
    style={style}
  >
    <span className="viewer-object-label">{item.fitted ? `${item.label} (축소)` : item.label}</span>
    {item.fallbackText && <span className={`viewer-object-fallback${item.kind === 'equation' ? ' viewer-object-script' : ''}`}>{item.fallbackText}</span>}
    {markerText && <span className="viewer-object-fallback">{markerText}</span>}
    {hasBody && <span className="viewer-object-body" ref={bodyRef}>
      {item.paragraphs!.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}
    </span>}
  </span>
}

/** 구역 끝에 모은 각주·미주 본문(읽기 전용). */
export function NoteListView({ item, document }: { item: ViewerNoteList; document: ViewerDocument }) {
  const groups = (['footnote', 'endnote'] as const)
    .map((kind) => ({ kind, notes: item.notes.filter((note) => note.kind === kind) }))
    .filter((group) => group.notes.length)
  // decoder는 쪽 사이에서 나눌 수 있게 각주·미주 문단마다 block을 만든다. 이어지는 block은 구분선·같은 종류 제목·같은 각주 번호를 다시 쓰지 않는다.
  return <div className={`viewer-note-list${item.continuesKind ? ' viewer-note-list-continued' : ''}`} data-object-kind="note-list" contentEditable={false}>
    {groups.map((group) => <section key={group.kind} className="viewer-note-group" data-note-kind={group.kind}>
      {item.continuesKind !== group.kind && <div className="viewer-note-heading">{group.kind === 'footnote' ? '각주' : '미주'}</div>}
      {group.notes.map((note) => <div key={note.sourcePath} className="viewer-note" data-source-path={note.sourcePath}>
        <span className="viewer-note-number">{item.continuesNote ? '' : note.marker}</span>
        <div className="viewer-note-body">{note.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}</div>
      </div>)}
    </section>)}
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
  /**
   * 본문 문단 id → 문단 구조 gate와 여러 문단 범위 scope(`editing_capability.ts`의 `topLevelParagraphStructure`).
   * 표 셀은 대신 {@link structureGate}와 {@link rangeScope}를 문단마다 직접 넘긴다.
   */
  structureOf?: (paragraphId: string) => { rangeScope: string; gate: ParagraphStructureGate } | undefined
  structureGate?: ParagraphStructureGate
  editorHostRef?: RefObject<HTMLDivElement>
  desiredSelection?: EditorSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
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
  availableWidth
}: {
  paragraph: ViewerParagraph
  document: ViewerDocument
  measurable?: boolean
  editing?: ParagraphEditingProps
  /** 문단이 놓이는 칸(표 셀)의 안쪽 폭(HWPUNIT). 내어쓰기 폭을 이 안으로 줄인다. */
  availableWidth?: number
}) {
  const style = document.paraStyles[paragraph.paraStyleId]
  // 음수 intent(내어쓰기)는 첫 줄을 왼쪽 여백에 두고 둘째 줄부터 들인다. 첫 줄을 용지·셀 밖으로 당기지 않는다.
  const indentBox = paragraphIndentBox(style?.margin ?? {}, style?.indent, availableWidth)
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
  const activeEditing =
    !measurable && editing && isEditableTextParagraph(paragraph, editing.allowMultipleRuns)
      ? editing
      : undefined
  const editableTexts = activeEditing
    ? paragraph.content.filter(
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
  const structure = activeEditing?.structureOf?.(paragraph.id)
  const structureGate: ParagraphStructureGate = activeEditing?.structureGate ?? structure?.gate ??
    (paragraph.structureBlock ? { split: paragraph.structureBlock, mergePrevious: paragraph.structureBlock, mergeNext: paragraph.structureBlock } : {})
  const structureBlocked = Boolean(structureGate.split)
  const rangeScope = sectionPath && activeEditing
    ? (emptyParagraph ? undefined : activeEditing.rangeScope ?? structure?.rangeScope) ??
      paragraphEditorRangeScope(sectionPath, paragraph.id, Boolean(activeEditing.allowParagraphRange) && !emptyParagraph && !structureBlocked)
    : undefined
  const paragraphStructureUnavailable = (action: ParagraphStructureAction) => {
    activeEditing?.onParagraphStructureUnavailable(
      emptyParagraph ? 'EMPTY_PARAGRAPH' : action === 'split' ? structureGate.split : structureGate[action] ?? structureGate.split
    )
  }
  const editorHost = () => activeEditing?.editorHostRef?.current ?? paragraphRef.current
  const readEditorSelection = () => {
    const host = editorHost()
    return activeEditing && sectionPath && rangeScope && host
      ? readParagraphEditorSelection(host, sectionPath, rangeScope)
      : undefined
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
    style={css}
  >{paragraph.marker && <span className="viewer-paragraph-marker">{hancomPuaDisplayText(paragraph.marker)} </span>}{editableTexts && activeEditing
    ? paragraph.content.map((item, contentIndex) => {
      if (isObjectPlaceholder(item)) {
        return <ObjectPlaceholderView key={`${paragraph.id}:object${contentIndex}`} item={item} document={document} />
      }
      const index = editableTexts.indexOf(item as ViewerText)
      if (index < 0) return null
      const editableText = editableTexts[index]
      return <ParagraphInputSurface
      key={`${paragraph.id}:runs${editableTexts.length}:${editableText.sourceAnchor!.textNodeId}`}
      text={editableText.text}
      sourceAnchor={editableText.sourceAnchor!}
      style={textCss(editableText, document)}
      pending={activeEditing.pending}
      restoreToken={activeEditing.restoreToken}
      ariaLabel={activeEditing.surfaceLabel}
      rangeScope={rangeScope!}
      desiredSelection={
        activeEditing.desiredSelection?.anchorTextNodeId === activeEditing.desiredSelection?.focusTextNodeId &&
        activeEditing.desiredSelection?.focusTextNodeId === editableText.sourceAnchor!.textNodeId
          ? activeEditing.desiredSelection
          : undefined
      }
      onCommit={activeEditing.onCommit}
      onComposingChange={activeEditing.onComposingChange}
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
      allowMergePrevious={!emptyParagraph && index === 0 && (activeEditing.allowParagraphMergePrevious ?? true)}
      allowMergeNext={!emptyParagraph && index === editableTexts.length - 1 && (activeEditing.allowParagraphMergeNext ?? true)}
      mergePreviousBlocked={!emptyParagraph && index === 0 && (activeEditing.allowParagraphMergePrevious ?? true) && Boolean(structureGate.mergePrevious)}
      mergeNextBlocked={!emptyParagraph && index === editableTexts.length - 1 && (activeEditing.allowParagraphMergeNext ?? true) && Boolean(structureGate.mergeNext)}
      allowParagraphStructure={activeEditing.allowParagraphStructure && !emptyParagraph && !structureBlocked}
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
          false
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
          true
        )
        if (moved) activeEditing.onEditorSelectionChange(moved)
      }}
    />
    })
    : paragraph.content.map((item, index) => <Content key={`${paragraph.id}:${index}`} item={item} document={document} measurable={measurable} editing={editing} />)}</div>
}

function HeaderFooterView({ control, kind, document, offset }: { control?: ViewerHeaderFooter; kind: 'header' | 'footer'; document: ViewerDocument; offset: number }) {
  if (!control) return null
  return <div className={`viewer-${kind}`} style={{ [kind === 'header' ? 'top' : 'bottom']: hwpUnitToCssPx(offset), left: hwpUnitToCssPx(document.page.margin.left), right: hwpUnitToCssPx(document.page.margin.right) }}>
    {control.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}
  </div>
}

export function TableView({
  table,
  document,
  measurable = false,
  editing
}: {
  table: ViewerTable
  document: ViewerDocument
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
  return <table className="viewer-table" style={{ width: table.width ? hwpUnitToCssPx(table.width) : '100%' }}><colgroup>{resolvedWidths.map((width, index) => <col key={index} style={{ width: `${(width / totalWidth) * 100}%` }} />)}</colgroup><tbody>{table.rows.map((row, rowIndex) => <tr data-measure-row-id={measurable ? `${table.id}:r${row.cells[0]?.row ?? rowIndex}` : undefined} key={`${table.id}:r${rowIndex}`}>{row.cells.map((cell) => {
    const style = cell.borderFillId ? document.cellStyles[cell.borderFillId] : undefined
    const fragmented = cell.splitTop || cell.splitBottom
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
      minHeight: fragmented ? undefined : hwpUnitToCssPx(cell.height), verticalAlign: fragmented ? 'top' : cell.verticalAlign === 'TOP' ? 'top' : cell.verticalAlign === 'BOTTOM' ? 'bottom' : 'middle',
      padding: fragmented ? undefined : `${hwpUnitToCssPx(cell.margin.top)}px ${hwpUnitToCssPx(cell.margin.right)}px ${hwpUnitToCssPx(cell.margin.bottom)}px ${hwpUnitToCssPx(cell.margin.left)}px`,
      paddingTop: fragmented ? hwpUnitToCssPx(cell.splitTop ? 0 : cell.margin.top) : undefined,
      paddingRight: fragmented ? hwpUnitToCssPx(cell.margin.right) : undefined,
      paddingBottom: fragmented ? hwpUnitToCssPx(cell.splitBottom ? 0 : cell.margin.bottom) : undefined,
      paddingLeft: fragmented ? hwpUnitToCssPx(cell.margin.left) : undefined,
      background: style?.backgroundColor === '#000000' ? '#000' : style?.backgroundColor,
      borderLeft: style ? borderCss(style.left) : undefined, borderRight: style ? borderCss(style.right) : undefined,
      borderTop: cell.splitTop ? 'none' : style ? borderCss(style.top) : undefined,
      borderBottom: cell.splitBottom ? 'none' : style ? borderCss(style.bottom) : undefined
    }}>{cell.paragraphs.map((paragraph, paragraphIndex) => <ParagraphView
      key={paragraph.id}
      paragraph={paragraph}
      document={document}
      measurable={measurable}
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
function fixedPageTextCensus(text: string | undefined): Record<string, number> {
  const normalized = (text ?? '').normalize('NFC')
  return {
    'data-text-raw': (normalized.match(/\S/gu) ?? []).length,
    'data-text-private-use': (normalized.match(/\p{Co}/gu) ?? []).length,
    'data-text-digits': (normalized.match(/[0-9]/g) ?? []).length
  }
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
  editingTransient.current.synchronize(editing, editingPending)
  const effectiveDocument = useMemo(() => document ? {
    ...document,
    charStyles: Object.fromEntries(Object.entries(document.charStyles).map(([id, style]) => [id, {
      ...style,
      fontFamily: style.fontFamily ? fontResolutions[style.fontFamily]?.resolved ?? style.fontFamily : undefined
    }]))
  } : null, [document, fontResolutions])
  const pagination = useMemo(() => {
    const startedAt = performance.now()
    const pages = effectiveDocument ? paginateViewerDocument(effectiveDocument, layoutMeasurements) : []
    return { pages, layoutMs: performance.now() - startedAt }
  }, [effectiveDocument, layoutMeasurements])
  const pages = pagination.pages
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
  const objectPlaceholderCounts = useMemo(() => document ? countObjectPlaceholders(document) : {}, [document])
  const objectPlaceholderTotal = totalObjectPlaceholders(objectPlaceholderCounts)
  const [objectNotice, setObjectNotice] = useState({ dismissed: false, expanded: false })
  useEffect(() => setObjectNotice({ dismissed: false, expanded: false }), [openedPath])
  const substitutions = Object.values(fontResolutions).filter((resolution) => resolution.substituted)
  const documentLoading = Boolean(sectionProgress && sectionProgress.loaded < sectionProgress.total)

  const openPath = async (path: string, openReceivedAt = Date.now()) => {
    const currentEditing = editingTransient.current.currentSession
    if (currentEditing?.isDirty) {
      if (editingTransient.current.pendingCount || editingTransient.current.isComposing) {
        setEditingStatus('입력 반영이 끝난 뒤 다시 문서를 열어 주세요.')
        return
      }
      try {
        const resolution = await api().resolveDirtyEditing(
          currentEditing.sessionId
        ) as EditingResolveDirtyResult
        if (resolution.outcome === 'cancelled') {
          setEditingStatus('문서 열기 취소 · 편집 내용 유지')
          return
        }
      } catch (reason) {
        setEditingStatus(
          editingErrorStatus('문서 교체', reason) ?? '문서 교체 취소'
        )
        return
      }
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
    setDocument(null)
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
      setDocument(imported.document)
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
    setDocument(payload.document)
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
  useEffect(() => {
    if (!document) return
    setLayoutMeasurements(undefined)
    const requested = Object.values(document.charStyles).map((style) => style.fontFamily).filter((font): font is string => Boolean(font))
    const fontOptions = { platform: rendererPlatform() }
    void api().getFonts()
      .then((fonts: string[]) => setFontResolutions(resolveDocumentFonts(requested, fonts, fontOptions)))
      .catch(() => setFontResolutions(resolveDocumentFonts(requested, [], fontOptions)))
  }, [document])
  useEffect(() => {
    if (!effectiveDocument || !measurementRef.current) return
    let cancelled = false
    void globalThis.document.fonts.ready.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))).then(() => {
      if (cancelled || !measurementRef.current) return
      const blockHeights = Object.fromEntries(Array.from(measurementRef.current.querySelectorAll<HTMLElement>('[data-measure-block-id]')).map((element) => [element.dataset.measureBlockId!, cssPxToHwpUnit(element.getBoundingClientRect().height)]))
      const tableRowHeights = Object.fromEntries(Array.from(measurementRef.current.querySelectorAll<HTMLElement>('[data-measure-row-id]')).map((element) => [element.dataset.measureRowId!, cssPxToHwpUnit(element.getBoundingClientRect().height)]))
      setLayoutMeasurements({ blockHeights, tableRowHeights })
    })
    return () => { cancelled = true }
  }, [effectiveDocument])
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
  const applyEditingResult = useCallback((result: EditingActionResult) => {
    setDocument(result.document)
    setEditing((current) => current ? {
      sessionId: current.sessionId,
      revision: result.revision,
      savedRevision: result.savedRevision,
      canUndo: result.canUndo,
      canRedo: result.canRedo,
      isDirty: result.isDirty
    } : current)
    if (result.selection) setTableCellSelection(undefined)
    const projection = reconcileEditingSelection(result.document, result.selection)
    setEditingSelection(projection.selection)
    setEditingSelectionNotice(editingSelectionProjectionStatus(projection.status))
  }, [])
  const recoverEditingFailure = useCallback(async (action: string, reason: unknown) => {
    const status = editingErrorStatus(action, reason) ?? '편집 중'
    const current = editingTransient.current.currentSession
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
  }, [applyEditingResult])
  const updateEditingSelection = useCallback((
    anchor: ViewerSourceAnchor,
    selection: { anchorOffset: number; focusOffset: number }
  ) => {
    setEditingSelectionNotice(null)
    setTableCellSelection(undefined)
    setEditingSelection({
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      focusTextNodeId: anchor.textNodeId,
      ...selection
    })
  }, [])
  const updateEditorSelection = useCallback((selection: EditorSelection) => {
    setEditingSelectionNotice(null)
    setTableCellSelection(undefined)
    setEditingSelection(selection)
  }, [])
  const updateTableCellSelection = useCallback((selection: TableCellSelection) => {
    setEditingSelection(undefined)
    setEditingSelectionNotice(null)
    setTableCellSelection(selection)
    setEditingStatus(`병합 셀 선택 · ${selection.row + 1}행 ${selection.column + 1}열`)
  }, [])
  const commitParagraph = useCallback((anchor: ViewerSourceAnchor, intent: TextCommitIntent) => {
    if (!editing) return
    const sessionId = editing.sessionId
    const transactionId = editingTransient.current.nextTransactionId('ui')
    setEditingPending((current) => current + 1)
    setEditingStatus('변경 반영 중…')
    void api().commitEditing({
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
    }).then((result: EditingActionResult) => {
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
    if (!editing || editingTransient.current.isComposing) return
    setEditingPending((current) => current + 1)
    setEditingStatus('여러 글자 범위 반영 중…')
    void api().commitRangeEditing({
      sessionId: editing.sessionId,
      transactionId: editingTransient.current.nextTransactionId('ui-range'),
      selectionBefore: selection,
      insert,
      inputType,
      timestamp
    }).then((result: EditingActionResult) => {
      applyEditingResult(result)
      setEditingStatus('편집 중')
    }).catch((reason: unknown) => {
      return recoverEditingFailure('범위 편집', reason)
    }).finally(() => {
      setEditingPending((current) => Math.max(0, current - 1))
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const splitEditingParagraph = useCallback((selection: EditorSelection, timestamp: number) => {
    if (!editing || editingTransient.current.isComposing) return
    setEditingPending((current) => current + 1)
    setEditingStatus('문단 나누는 중…')
    void api().splitParagraphEditing({
      sessionId: editing.sessionId,
      transactionId: editingTransient.current.nextTransactionId('ui-split'),
      selectionBefore: selection,
      timestamp
    }).then((result: EditingActionResult) => {
      applyEditingResult(result)
      setEditingStatus('편집 중')
    }).catch((reason: unknown) => {
      return recoverEditingFailure('문단 나눔', reason)
    }).finally(() => {
      setEditingPending((current) => Math.max(0, current - 1))
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const mergeEditingParagraph = useCallback((
    selection: EditorSelection,
    direction: 'previous' | 'next',
    inputType: 'deleteContentBackward' | 'deleteContentForward',
    timestamp: number
  ) => {
    if (!editing || editingTransient.current.isComposing) return
    setEditingPending((current) => current + 1)
    setEditingStatus('문단 합치는 중…')
    void api().mergeParagraphEditing({
      sessionId: editing.sessionId,
      transactionId: editingTransient.current.nextTransactionId('ui-merge'),
      selectionBefore: selection,
      direction,
      inputType,
      timestamp
    }).then((result: EditingActionResult) => {
      applyEditingResult(result)
      setEditingStatus('편집 중')
    }).catch((reason: unknown) => {
      return recoverEditingFailure('문단 병합', reason)
    }).finally(() => {
      setEditingPending((current) => Math.max(0, current - 1))
    })
  }, [editing?.sessionId, applyEditingResult, recoverEditingFailure])
  const onComposingChange = useCallback((composing: boolean) => {
    editingTransient.current.setComposing(composing)
  }, [])
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
      !characterStyleState.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('글자 모양 반영 중…')
    try {
      applyEditingResult(await api().applyCharacterStyle({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-style'),
        sectionPath: editingSelection.sectionPath,
        textNodeId: editingSelection.focusTextNodeId,
        selection: editingSelection,
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
  }, [
    editing?.sessionId,
    editingSelection,
    characterStyleState.available,
    editingPending,
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
      !editingCapabilityState.paragraphStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('문단 모양 반영 중…')
    try {
      applyEditingResult(await api().applyParagraphStyle({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-style'),
        sectionPath: editingSelection.sectionPath,
        textNodeId: editingSelection.focusTextNodeId,
        selection: editingSelection,
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
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.paragraphStyle.available,
    editingPending,
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
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 셀 모양 반영 중…')
    try {
      applyEditingResult(await api().applyCellStyle({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-cell-style'),
        sectionPath: editingSelection.sectionPath,
        textNodeId: editingSelection.focusTextNodeId,
        selection: editingSelection,
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
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const insertTableRowAfter = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 행 추가 중…')
    try {
      applyEditingResult(await api().insertTableRowAfter({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-table-row'),
        selectionBefore: editingSelection,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus('현재 셀 아래에 빈 행 추가')
    } catch (reason) {
      await recoverEditingFailure('표 행 추가', reason)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const deleteTableRow = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 행 삭제 중…')
    try {
      applyEditingResult(await api().deleteTableRow({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-table-row'),
        selectionBefore: editingSelection,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus('현재 표 행 삭제')
    } catch (reason) {
      await recoverEditingFailure('표 행 삭제', reason)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const insertTableColumnAfter = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 열 추가 중…')
    try {
      applyEditingResult(await api().insertTableColumnAfter({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-table-column'),
        selectionBefore: editingSelection,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus('현재 열 오른쪽에 빈 열 추가')
    } catch (reason) {
      await recoverEditingFailure('표 열 추가', reason)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const deleteTableColumn = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 열 삭제 중…')
    try {
      applyEditingResult(await api().deleteTableColumn({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-table-column'),
        selectionBefore: editingSelection,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus('현재 표 열 삭제')
    } catch (reason) {
      await recoverEditingFailure('표 열 삭제', reason)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const mergeTableCellRight = useCallback(async () => {
    if (
      !editing ||
      !editingSelection ||
      !editingCapabilityState.cellStyle.available ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('표 셀 병합 중…')
    try {
      applyEditingResult(await api().mergeTableCellRight({
        sessionId: editing.sessionId,
        transactionId: editingTransient.current.nextTransactionId('ui-table-cell-merge'),
        selectionBefore: editingSelection,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus('오른쪽 셀과 병합 · 병합 셀은 읽기 전용')
    } catch (reason) {
      await recoverEditingFailure('표 셀 병합', reason)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [
    editing?.sessionId,
    editingSelection,
    editingCapabilityState.cellStyle.available,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const splitTableCell = useCallback(async () => {
    if (
      !editing ||
      !tableCellSelection ||
      editingPending ||
      editingTransient.current.isComposing
    ) return
    setEditingPending((current) => current + 1)
    setEditingStatus('병합 셀 분할 중…')
    try {
      applyEditingResult(await api().splitTableCell({
        sessionId: editing.sessionId,
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
  }, [
    editing?.sessionId,
    tableCellSelection,
    editingPending,
    applyEditingResult,
    recoverEditingFailure
  ])
  const startEditing = async () => {
    if (!openedPath || fixedDocument || documentLoading || editing) return
    setEditingStatus('편집 준비 중…')
    try {
      const result = await api().startEditing({ filePath: openedPath }) as EditingStartResult
      setDocument(result.document)
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
  const undoEditing = useCallback(async () => {
    if (!editing || editingPending || editingTransient.current.isComposing) return
    try {
      applyEditingResult(await api().undoEditing(editing.sessionId) as EditingActionResult)
      setEditingStatus('실행 취소')
    } catch (reason) {
      await recoverEditingFailure('실행 취소', reason)
    }
  }, [editing?.sessionId, editingPending, applyEditingResult, recoverEditingFailure])
  const redoEditing = useCallback(async () => {
    if (!editing || editingPending || editingTransient.current.isComposing) return
    try {
      applyEditingResult(await api().redoEditing(editing.sessionId) as EditingActionResult)
      setEditingStatus('다시 실행')
    } catch (reason) {
      await recoverEditingFailure('다시 실행', reason)
    }
  }, [editing?.sessionId, editingPending, applyEditingResult, recoverEditingFailure])
  const routeNativeHistory = useCallback((direction: HistoryDirection) => {
    if (editingTransient.current.isComposing) return
    if (direction === 'redo') void redoEditing()
    else void undoEditing()
  }, [undoEditing, redoEditing])
  const saveEditingAs = useCallback(async () => {
    if (!editing?.isDirty || editingPending || editingTransient.current.isComposing) return
    setEditingPending((current) => current + 1)
    setEditingStatus('HWPX 변경본 검증 중…')
    try {
      const result = await api().saveEditingAs(editing.sessionId) as EditingSaveAsDialogResult
      if (result.outcome === 'cancelled') {
        setEditingStatus('편집 중')
        return
      }
      setEditing((current) => current ? {
        sessionId: current.sessionId,
        revision: result.revision,
        savedRevision: result.savedRevision,
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        isDirty: result.isDirty
      } : current)
      const savedName = result.destinationPath.split(/[\\/]/).pop() ?? result.destinationPath
      const structureLabels = {
        text: '본문',
        'character-style': '글자 모양',
        'paragraph-style': '문단 모양',
        'paragraph-structure': '문단 구조',
        'table-cell-style': '표 셀 모양',
        'table-structure': '표 구조'
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
      setEditingStatus(editingErrorStatus('저장', reason) ?? '편집 중')
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [editing?.sessionId, editing?.isDirty, editingPending])
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
      if ((action === 'undo' || action === 'redo') && editing && !editingTransient.current.isComposing) {
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
    {effectiveDocument && <div ref={measurementRef} className="viewer-measurement">{effectiveDocument.sections.map((section) => <div
      key={section.id}
      style={{ width: hwpUnitToCssPx(viewerColumnContentWidth(
        effectiveDocument.page.width - effectiveDocument.page.margin.left - effectiveDocument.page.margin.right,
        section.columnLayout
      )) }}
    >{section.blocks.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} measurable />)}</div>)}</div>}
    <ViewerToolbar
      fileName={fileName}
      shortcutPlatform={shortcutPlatform}
      editing={editing}
      editingPending={editingPending}
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
        topSpacer={visibleRange.topSpacer}
        bottomSpacer={visibleRange.bottomSpacer}
      >
        {(virtualized ? pages.slice(visibleRange.start, visibleRange.end) : pages).map((page, localIndex) => {
          const index = virtualized ? visibleRange.start + localIndex : localIndex
          const decoration = decorations[index]
          const pageNumber = decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined
          const renderParagraphs = (paragraphs: typeof page.blocks) => paragraphs.map((paragraph) => <ParagraphView
            key={paragraph.id}
            paragraph={paragraph}
            document={effectiveDocument}
            editing={editing && !printing ? { pending: Boolean(editingPending), restoreToken: layoutMeasurements, allowMultipleRuns: true, allowParagraphRange: true, allowParagraphStructure: true, editorHostRef: editingHostRef, desiredSelection: editingSelection, onCommit: commitParagraph, onComposingChange, onSelectionChange: updateEditingSelection, onEditorSelectionChange: updateEditorSelection, onRangeCommit: commitRangeParagraph, onSplitParagraph: splitEditingParagraph, onMergeParagraph: mergeEditingParagraph, onParagraphStructureUnavailable: paragraphStructureUnavailable, structureOf, onHistory: routeNativeHistory, tableCellSelection, onTableCellSelectionChange: updateTableCellSelection } : undefined}
          />)
          const body = page.columns && page.columnLayout
            ? <ViewerColumnFlow
                gap={hwpUnitToCssPx(page.columnLayout.sameGap)}
                columns={page.columns.map(renderParagraphs)}
              />
            : renderParagraphs(page.blocks)
          return <article className="viewer-page" data-page-index={index} key={index} style={{ width: hwpUnitToCssPx(effectiveDocument.page.width), height: pageHeight, padding: `${hwpUnitToCssPx(effectiveDocument.page.margin.top)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.right)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.bottom)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.left)}px` }}><HeaderFooterView control={decoration.header} kind="header" document={effectiveDocument} offset={effectiveDocument.page.headerOffset} />{body}<HeaderFooterView control={decoration.footer} kind="footer" document={effectiveDocument} offset={effectiveDocument.page.footerOffset} />{pageNumber && decoration.pageNumber && <span className={`viewer-page-number viewer-page-number-${pageNumberPosition(decoration.pageNumber.position)}`} style={{ bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom) }}>{pageNumber}</span>}</article>
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
