import { CSSProperties, DragEvent, useCallback, useEffect, useMemo, useRef, useState, WheelEvent } from 'react'
import { DocumentImportBackgroundError, DocumentImportComplete, DocumentImportResult } from '../../core/document/document_import'
import { ViewerCellStyle, ViewerContent, ViewerDocument, ViewerHeaderFooter, ViewerParagraph, ViewerSourceAnchor, ViewerTable, ViewerTableCell } from '../../core/document/viewer_document'
import { FixedPageDescriptor, FixedPageDocument, FixedPageTextLayout } from '../../core/document/fixed_page_document'
import { EditingActionResult, EditingHistoryStatus, EditingResolveDirtyResult, EditingSaveAsDialogResult, EditingStartResult } from '../../core/editing/editing_contract'
import { TextCommitIntent } from '../../core/editing/composition_input'
import { EditorSelection } from '../../core/editing/transaction'
import type { ParagraphAlignment } from '../../core/editing/style_patch'
import { cssPxToHwpUnit, hwpUnitToCssPx, hwpUnitToInches } from '../../core/layout/hwp_unit'
import { fixedPageOffsets, fixedPageVirtualRange } from '../../core/layout/fixed_page_virtualization'
import { FontResolution, resolveDocumentFonts } from '../../core/fonts/font_resolver'
import { LayoutMeasurements, paginateViewerDocument } from '../../core/layout/pagination'
import { formatPageNumber, pageNumberPosition } from '../../core/layout/page_number'
import { resolvePageDecorations } from '../../core/layout/page_decorations'
import { pinchZoom, stepZoom } from '../../core/layout/zoom'
import { waitForFixedPagePrintReady } from './pdf_print_readiness'
import { ParagraphInputSurface } from './ParagraphInputSurface'

const api = () => (window as any).api

interface ViewerLoadTiming {
  format: 'hwp' | 'hwpx'
  requestStartedAt: number
  openReceivedAt: number
  requestToModelMs: number
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
  wasmInitMs?: number
  pageInfoMs?: number
  firstPaintMs?: number
  openToFirstPaintMs?: number
}

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
    fontFamily: style?.fontFamily ? `"${style.fontFamily}", "Apple SD Gothic Neo", sans-serif` : undefined,
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

export function isEditableTableCell(cell: ViewerTableCell, measurable = false): boolean {
  return (
    !measurable &&
    !cell.splitTop &&
    !cell.splitBottom &&
    !cell.header &&
    cell.rowSpan === 1 &&
    cell.columnSpan === 1 &&
    cell.paragraphs.length === 1
  )
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
    return <span style={textCss(item, document)}>{item.text}</span>
  }
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    return <img className="viewer-image" src={`data:${resource.mime};base64,${resource.data}`} style={{ width: item.width ? hwpUnitToCssPx(item.width) : undefined, height: item.height ? hwpUnitToCssPx(item.height) : undefined }} />
  }
  return <TableView table={item} document={document} measurable={measurable} editing={editing} />
}

interface ParagraphEditingProps {
  pending: boolean
  restoreToken?: unknown
  surfaceLabel?: string
  allowMultipleRuns?: boolean
  desiredSelection?: EditorSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
  onSelectionChange: (
    anchor: ViewerSourceAnchor,
    selection: { anchorOffset: number; focusOffset: number }
  ) => void
}

export function isEditableTextParagraph(
  paragraph: ViewerParagraph,
  allowMultipleRuns = false
): boolean {
  return (
    paragraph.content.length > 0 &&
    (allowMultipleRuns || paragraph.content.length === 1) &&
    paragraph.content.every((item) => item.type === 'text' && Boolean(item.sourceAnchor))
  )
}

export function ParagraphView({
  paragraph,
  document,
  measurable = false,
  editing
}: {
  paragraph: ViewerParagraph
  document: ViewerDocument
  measurable?: boolean
  editing?: ParagraphEditingProps
}) {
  const style = document.paraStyles[paragraph.paraStyleId]
  const css: CSSProperties = {
    textAlign: style?.align === 'CENTER' ? 'center' : style?.align === 'RIGHT' ? 'right' : style?.align === 'JUSTIFY' ? 'justify' : 'left',
    marginLeft: hwpUnitToCssPx(style?.margin.left ?? 0),
    marginRight: hwpUnitToCssPx(style?.margin.right ?? 0),
    marginTop: hwpUnitToCssPx(style?.margin.top ?? 0),
    marginBottom: hwpUnitToCssPx(style?.margin.bottom ?? 0),
    lineHeight: style?.lineSpacing ? Math.max(style.lineSpacing / 100, 1) : 1.5
  }
  const editableTexts =
    !measurable && editing && isEditableTextParagraph(paragraph, editing.allowMultipleRuns)
      ? paragraph.content.filter((item) => item.type === 'text' && item.sourceAnchor)
      : undefined
  return <div className="viewer-paragraph" data-measure-block-id={measurable ? paragraph.id : undefined} style={css}>{paragraph.marker && <span className="viewer-paragraph-marker">{paragraph.marker} </span>}{editableTexts
    ? editableTexts.map((editableText, index) => <ParagraphInputSurface
      key={`${paragraph.id}:runs${editableTexts.length}:${editableText.sourceAnchor!.textNodeId}`}
      text={editableText.text}
      sourceAnchor={editableText.sourceAnchor!}
      style={textCss(editableText, document)}
      pending={editing.pending}
      restoreToken={editing.restoreToken}
      ariaLabel={editing.surfaceLabel}
      desiredSelection={
        editing.desiredSelection?.textNodeId === editableText.sourceAnchor!.textNodeId
          ? editing.desiredSelection
          : undefined
      }
      onCommit={editing.onCommit}
      onComposingChange={editing.onComposingChange}
      onSelectionChange={editing.onSelectionChange}
      onBoundaryNavigate={(direction) => {
        const neighbor = editableTexts[index + (direction === 'previous' ? -1 : 1)]
        if (!neighbor?.sourceAnchor) return
        const offset = direction === 'previous' ? neighbor.text.length : 0
        editing.onSelectionChange(neighbor.sourceAnchor, {
          anchorOffset: offset,
          focusOffset: offset
        })
      }}
    />)
    : paragraph.content.map((item, index) => <Content key={`${paragraph.id}:${index}`} item={item} document={document} measurable={measurable} editing={editing} />)}</div>
}

function HeaderFooterView({ control, kind, document, offset }: { control?: ViewerHeaderFooter; kind: 'header' | 'footer'; document: ViewerDocument; offset: number }) {
  if (!control) return null
  return <div className={`viewer-${kind}`} style={{ [kind === 'header' ? 'top' : 'bottom']: hwpUnitToCssPx(offset), left: hwpUnitToCssPx(document.page.margin.left), right: hwpUnitToCssPx(document.page.margin.right) }}>
    {control.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}
  </div>
}

function TableView({
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
    return <td key={cellFragmentKey(table.id, cell)} colSpan={cell.columnSpan} rowSpan={cell.rowSpan} style={{
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
    }}>{cell.paragraphs.map((paragraph) => <ParagraphView
      key={paragraph.id}
      paragraph={paragraph}
      document={document}
      measurable={measurable}
      editing={
        isEditableTableCell(cell, measurable) && editing
          ? { ...editing, surfaceLabel: 'HWPX 표 셀 편집', allowMultipleRuns: false }
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
  const [document, setDocument] = useState<ViewerDocument | null>(null)
  const [fixedDocument, setFixedDocument] = useState<FixedPageDocument | null>(null)
  const [fileName, setFileName] = useState('문서를 열어 주세요')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fontResolutions, setFontResolutions] = useState<Record<string, FontResolution>>({})
  const [overflowPages, setOverflowPages] = useState<number[]>([])
  const [loadTiming, setLoadTiming] = useState<ViewerLoadTiming | null>(null)
  const reportedBenchmark = useRef<number | null>(null)
  const [sectionProgress, setSectionProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 12, topSpacer: 0, bottomSpacer: 0 })
  const [fixedPrintPages, setFixedPrintPages] = useState<Awaited<ReturnType<RhwpAdapter['renderRhwpFixedPage']>>[] | null>(null)
  const [fixedFirstPageReady, setFixedFirstPageReady] = useState(false)
  const [fixedFollowingPagesEnabled, setFixedFollowingPagesEnabled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ pageIndex: number; occurrences: number }>>([])
  const [activeSearchResult, setActiveSearchResult] = useState(0)
  const [searching, setSearching] = useState(false)
  const [layoutMeasurements, setLayoutMeasurements] = useState<LayoutMeasurements | undefined>()
  const [openedPath, setOpenedPath] = useState<string | null>(null)
  const [editing, setEditing] = useState<(EditingHistoryStatus & { sessionId: string }) | null>(null)
  const [editingSelection, setEditingSelection] = useState<EditorSelection | undefined>()
  const [editingPending, setEditingPending] = useState(0)
  const [editingStatus, setEditingStatus] = useState<string | null>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchSequence = useRef(0)
  const activeLoadId = useRef('')
  const loadSequence = useRef(0)
  const automaticPdfStarted = useRef(false)
  const editSequence = useRef(0)
  const editingComposing = useRef(false)
  const editingStateRef = useRef<typeof editing>(null)
  const editingPendingRef = useRef(0)
  const stageRef = useRef<HTMLElement>(null)
  editingStateRef.current = editing
  editingPendingRef.current = editingPending
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
  const substitutions = Object.values(fontResolutions).filter((resolution) => resolution.substituted)
  const documentLoading = Boolean(sectionProgress && sectionProgress.loaded < sectionProgress.total)

  const openPath = async (path: string, openReceivedAt = Date.now()) => {
    const currentEditing = editingStateRef.current
    if (currentEditing?.isDirty) {
      if (editingPendingRef.current || editingComposing.current) {
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
          `문서 교체 오류: ${reason instanceof Error ? reason.message : String(reason)}`
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
    setEditing(null)
    setEditingSelection(undefined)
    setEditingPending(0)
    setEditingStatus(null)
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
        setFileName(path.split('/').pop() ?? path)
        setOpenedPath(path)
        return
      }
      setDocument(imported.document)
      setSectionProgress({ loaded: imported.complete ? imported.sectionCount : imported.document.sections.length, total: imported.sectionCount })
      setLoadTiming({ format: 'hwpx', requestStartedAt, openReceivedAt, requestToModelMs: performance.now() - requestStartedAt, ...imported.timings })
      setFileName(path.split('/').pop() ?? path)
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
    void api().getFonts().then((fonts: string[]) => setFontResolutions(resolveDocumentFonts(requested, fonts))).catch(() => setFontResolutions(resolveDocumentFonts(requested, [])))
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
      canUndo: result.canUndo,
      canRedo: result.canRedo,
      isDirty: result.isDirty
    } : current)
    setEditingSelection(result.selection)
  }, [])
  const updateEditingSelection = useCallback((
    anchor: ViewerSourceAnchor,
    selection: { anchorOffset: number; focusOffset: number }
  ) => {
    setEditingSelection({
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      ...selection
    })
  }, [])
  const commitParagraph = useCallback((anchor: ViewerSourceAnchor, intent: TextCommitIntent) => {
    if (!editing) return
    const sessionId = editing.sessionId
    const transactionId = `ui-${++editSequence.current}`
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
        textNodeId: anchor.textNodeId,
        ...intent.selectionBefore
      },
      selectionAfter: {
        sectionPath: anchor.sectionPath,
        textNodeId: anchor.textNodeId,
        ...intent.selectionAfter
      },
      inputType: intent.inputType,
      compositionId: intent.compositionId,
      timestamp: intent.timestamp
    }).then((result: EditingActionResult) => {
      applyEditingResult(result)
      setEditingStatus('편집 중')
    }).catch((reason: unknown) => {
      setEditingStatus(`편집 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    }).finally(() => {
      setEditingPending((current) => Math.max(0, current - 1))
    })
  }, [editing?.sessionId, applyEditingResult])
  const onComposingChange = useCallback((composing: boolean) => {
    editingComposing.current = composing
  }, [])
  const activeStyle = useMemo(() => {
    if (!document || !editingSelection) return undefined
    for (const section of document.sections) {
      for (const paragraph of section.blocks) {
        const text = paragraph.content.find(
          (item) =>
            item.type === 'text' &&
            item.sourceAnchor?.sectionPath === editingSelection.sectionPath &&
            item.sourceAnchor.textNodeId === editingSelection.textNodeId
        )
        if (!text || text.type !== 'text') continue
        return {
          bold: document.charStyles[text.charStyleId]?.bold ?? false,
          italic: document.charStyles[text.charStyleId]?.italic ?? false,
          underline: document.charStyles[text.charStyleId]?.underline ?? false,
          strikeout: document.charStyles[text.charStyleId]?.strikeout ?? false,
          height: document.charStyles[text.charStyleId]?.height ?? 1000,
          color: document.charStyles[text.charStyleId]?.color ?? '#000000',
          align: (document.paraStyles[paragraph.paraStyleId]?.align ?? 'LEFT') as ParagraphAlignment,
          lineSpacing: document.paraStyles[paragraph.paraStyleId]?.lineSpacing || 160,
          marginBefore: document.paraStyles[paragraph.paraStyleId]?.margin.top ?? 0,
          marginAfter: document.paraStyles[paragraph.paraStyleId]?.margin.bottom ?? 0
        }
      }
    }
    return undefined
  }, [document, editingSelection?.sectionPath, editingSelection?.textNodeId])
  const applyCharacterStyle = useCallback(async (
    style: { bold?: boolean; italic?: boolean; underline?: boolean; strikeout?: boolean; height?: number; color?: string }
  ) => {
    if (!editing || !editingSelection || editingPending || editingComposing.current) return
    setEditingPending((current) => current + 1)
    setEditingStatus('글자 모양 반영 중…')
    try {
      applyEditingResult(await api().applyCharacterStyle({
        sessionId: editing.sessionId,
        transactionId: `ui-style-${++editSequence.current}`,
        sectionPath: editingSelection.sectionPath,
        textNodeId: editingSelection.textNodeId,
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
            : '글자 색상 적용'
      )
    } catch (reason) {
      setEditingStatus(`글자 모양 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [editing?.sessionId, editingSelection, editingPending, applyEditingResult])
  const applyParagraphStyle = useCallback(async (style: {
    align?: ParagraphAlignment
    lineSpacing?: number
    marginBefore?: number
    marginAfter?: number
  }) => {
    if (!editing || !editingSelection || editingPending || editingComposing.current) return
    setEditingPending((current) => current + 1)
    setEditingStatus('문단 모양 반영 중…')
    try {
      applyEditingResult(await api().applyParagraphStyle({
        sessionId: editing.sessionId,
        transactionId: `ui-style-${++editSequence.current}`,
        sectionPath: editingSelection.sectionPath,
        textNodeId: editingSelection.textNodeId,
        selection: editingSelection,
        ...style,
        timestamp: performance.now()
      }) as EditingActionResult)
      setEditingStatus(
        style.align !== undefined
          ? '문단 정렬 적용'
          : style.lineSpacing !== undefined
            ? `줄 간격 ${style.lineSpacing}%`
            : style.marginBefore !== undefined
              ? `문단 앞 간격 ${style.marginBefore / 100}pt`
              : `문단 뒤 간격 ${(style.marginAfter ?? 0) / 100}pt`
      )
    } catch (reason) {
      setEditingStatus(`문단 모양 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setEditingPending((current) => Math.max(0, current - 1))
    }
  }, [editing?.sessionId, editingSelection, editingPending, applyEditingResult])
  const startEditing = async () => {
    if (!openedPath || fixedDocument || documentLoading || editing) return
    setEditingStatus('편집 준비 중…')
    try {
      const result = await api().startEditing({ filePath: openedPath }) as EditingStartResult
      setDocument(result.document)
      setEditing({
        sessionId: result.sessionId,
        revision: result.revision,
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        isDirty: result.isDirty
      })
      setEditingStatus('편집 중 · 일반 문단·표 셀')
    } catch (reason) {
      setEditingStatus(`편집 시작 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }
  const undoEditing = useCallback(async () => {
    if (!editing || editingPending || editingComposing.current) return
    try {
      applyEditingResult(await api().undoEditing(editing.sessionId) as EditingActionResult)
      setEditingStatus('실행 취소')
    } catch (reason) {
      setEditingStatus(`실행 취소 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [editing?.sessionId, editingPending, applyEditingResult])
  const redoEditing = useCallback(async () => {
    if (!editing || editingPending || editingComposing.current) return
    try {
      applyEditingResult(await api().redoEditing(editing.sessionId) as EditingActionResult)
      setEditingStatus('다시 실행')
    } catch (reason) {
      setEditingStatus(`다시 실행 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
  }, [editing?.sessionId, editingPending, applyEditingResult])
  const saveEditingAs = useCallback(async () => {
    if (!editing?.isDirty || editingPending || editingComposing.current) return
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
        canUndo: result.canUndo,
        canRedo: result.canRedo,
        isDirty: result.isDirty
      } : current)
      const savedName = result.destinationPath.split('/').pop() ?? result.destinationPath
      setEditingStatus(
        `저장 완료 · ${savedName} · Preview ${result.previewStatus === 'stale' ? '갱신 안 됨' : '없음'}`
      )
    } catch (reason) {
      setEditingStatus(`저장 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
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
      if (!event.metaKey) return
      if (event.key.toLocaleLowerCase() === 'b' && editing && activeStyle) {
        event.preventDefault()
        void applyCharacterStyle({ bold: !activeStyle.bold })
        return
      }
      if (event.key.toLocaleLowerCase() === 'i' && editing && activeStyle) {
        event.preventDefault()
        void applyCharacterStyle({ italic: !activeStyle.italic })
        return
      }
      if (event.key.toLocaleLowerCase() === 'u' && editing && activeStyle) {
        event.preventDefault()
        void applyCharacterStyle({ underline: !activeStyle.underline })
        return
      }
      if (event.key.toLocaleLowerCase() === 's' && editing) {
        event.preventDefault()
        void saveEditingAs()
        return
      }
      if (event.key.toLocaleLowerCase() === 'z' && editing && !editingComposing.current) {
        event.preventDefault()
        if (event.shiftKey) void redoEditing()
        else void undoEditing()
        return
      }
      if (event.key.toLocaleLowerCase() === 'f' && fixedDocument) {
        event.preventDefault()
        openSearch()
        return
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoomAt(stepZoom(zoom, 1)) }
      if (event.key === '-') { event.preventDefault(); changeZoomAt(stepZoom(zoom, -1)) }
      if (event.key === '0') { event.preventDefault(); changeZoomAt(1) }
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
    const path = (event.dataTransfer.files[0] as any)?.path
    if (/\.(?:hwp|hwpx)$/iu.test(path ?? '')) await openPath(path)
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
        preferCssPageSize: Boolean(fixedDocument)
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
  const totalSearchOccurrences = searchResults.reduce((sum, result) => sum + result.occurrences, 0)
  const activeSearchPage = searchResults[activeSearchResult]?.pageIndex

  return <main className="viewer-app" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    {printing && fixedDocument && <style>{fixedPagePrintCss(fixedDocument.pages)}</style>}
    {effectiveDocument && <div ref={measurementRef} className="viewer-measurement" style={{ width: hwpUnitToCssPx(effectiveDocument.page.width - effectiveDocument.page.margin.left - effectiveDocument.page.margin.right) }}>{effectiveDocument.sections.flatMap((section) => section.blocks).map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} measurable />)}</div>}
    <header className={`viewer-toolbar${editing ? ' viewer-toolbar-editing' : ''}`}>
      <div className="viewer-toolbar-main">
        <div className="viewer-title"><span className="viewer-mark">한</span><span>{fileName}</span></div>
        <div className="viewer-actions">
          {searchOpen && <div className="viewer-search" role="search">
            <input
              ref={searchInputRef}
              aria-label="HWP 문서 검색"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  stepSearchResult(event.shiftKey ? -1 : 1)
                }
              }}
              placeholder="문서 검색"
            />
            <span
              aria-live="polite"
              data-searching={searching}
              data-search-pages={searchResults.length}
              data-search-occurrences={totalSearchOccurrences}
            >{searching ? '검색 중…' : searchQuery.trim() ? `${searchResults.length}쪽 · ${totalSearchOccurrences}건` : ''}</span>
            <button aria-label="이전 검색 결과" onClick={() => stepSearchResult(-1)} disabled={!searchResults.length}>↑</button>
            <button aria-label="다음 검색 결과" onClick={() => stepSearchResult(1)} disabled={!searchResults.length}>↓</button>
            <button aria-label="검색 닫기" onClick={closeSearch}>×</button>
          </div>}
          {fixedDocument && !searchOpen && <button aria-label="검색" onClick={openSearch}>⌕</button>}
          {document && !fixedDocument && !editing && <button onClick={() => void startEditing()} disabled={documentLoading || loading}>편집</button>}
          {editing && <span className="viewer-editing-badge">HWPX 편집</span>}
          <button aria-label="축소" onClick={() => changeZoomAt(stepZoom(zoom, -1))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="확대" onClick={() => changeZoomAt(stepZoom(zoom, 1))}>+</button>
          <button onClick={() => void exportPdf()} disabled={!hasDocument || printing || documentLoading}>PDF</button>
          <button className="viewer-open" onClick={chooseFile}>문서 열기</button>
        </div>
      </div>
      {editing && <div className="viewer-edit-ribbon" aria-label="HWPX 편집 리본">
        <div className="viewer-ribbon-tabs" role="tablist" aria-label="편집 메뉴">
          <button role="tab" aria-selected="true">홈</button>
        </div>
        <div className="viewer-ribbon-groups" role="toolbar" aria-label="홈 편집 도구">
          <div className="viewer-ribbon-group viewer-ribbon-file-group">
            <div className="viewer-ribbon-controls">
              <button
                aria-label="HWPX 변경본 저장"
                className="viewer-ribbon-save"
                onClick={() => void saveEditingAs()}
                disabled={!editing.isDirty || Boolean(editingPending)}
              ><span className="viewer-ribbon-icon">⇩</span><span>다른 이름으로 저장</span></button>
            </div>
            <span className="viewer-ribbon-group-label">파일</span>
          </div>
          <div className="viewer-ribbon-group">
            <div className="viewer-ribbon-controls">
              <button aria-label="실행 취소" title="실행 취소 (⌘Z)" onMouseDown={(event) => event.preventDefault()} onClick={() => void undoEditing()} disabled={!editing.canUndo || Boolean(editingPending)}>↶</button>
              <button aria-label="다시 실행" title="다시 실행 (⇧⌘Z)" onMouseDown={(event) => event.preventDefault()} onClick={() => void redoEditing()} disabled={!editing.canRedo || Boolean(editingPending)}>↷</button>
            </div>
            <span className="viewer-ribbon-group-label">기록</span>
          </div>
          <div className="viewer-ribbon-group viewer-ribbon-font-group">
            <div className="viewer-ribbon-controls">
              <button
                aria-label="현재 텍스트 블록 굵게"
                title="굵게"
                aria-pressed={activeStyle?.bold ?? false}
                className="viewer-style-bold"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyCharacterStyle({ bold: !(activeStyle?.bold ?? false) })}
                disabled={!activeStyle || Boolean(editingPending)}
              >B</button>
              <button
                aria-label="현재 텍스트 블록 기울임"
                title="기울임 (⌘I)"
                aria-pressed={activeStyle?.italic ?? false}
                className="viewer-style-italic"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyCharacterStyle({ italic: !(activeStyle?.italic ?? false) })}
                disabled={!activeStyle || Boolean(editingPending)}
              >I</button>
              <button
                aria-label="현재 텍스트 블록 밑줄"
                title="밑줄 (⌘U)"
                aria-pressed={activeStyle?.underline ?? false}
                className="viewer-style-underline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyCharacterStyle({ underline: !(activeStyle?.underline ?? false) })}
                disabled={!activeStyle || Boolean(editingPending)}
              >U</button>
              <button
                aria-label="현재 텍스트 블록 취소선"
                title="취소선"
                aria-pressed={activeStyle?.strikeout ?? false}
                className="viewer-style-strikeout"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyCharacterStyle({ strikeout: !(activeStyle?.strikeout ?? false) })}
                disabled={!activeStyle || Boolean(editingPending)}
              >S</button>
              <div className="viewer-style-size-control">
                <button
                  aria-label="글자 크기 줄이기"
                  title="글자 크기 줄이기"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activeStyle && void applyCharacterStyle({ height: Math.max(500, activeStyle.height - 100) })}
                  disabled={!activeStyle || activeStyle.height <= 500 || Boolean(editingPending)}
                >A−</button>
                <span className="viewer-style-size" aria-label="현재 글자 크기">{activeStyle ? `${activeStyle.height / 100}pt` : '—'}</span>
                <button
                  aria-label="글자 크기 늘리기"
                  title="글자 크기 늘리기"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => activeStyle && void applyCharacterStyle({ height: Math.min(7200, activeStyle.height + 100) })}
                  disabled={!activeStyle || activeStyle.height >= 7200 || Boolean(editingPending)}
                >A+</button>
              </div>
              <label className="viewer-style-color-label" title="글자 색상">
                <input
                  className="viewer-style-color"
                  type="color"
                  aria-label="글자 색상"
                  value={activeStyle && /^#[0-9a-f]{6}$/i.test(activeStyle.color) ? activeStyle.color : '#000000'}
                  onChange={(event) => void applyCharacterStyle({ color: event.target.value })}
                  disabled={!activeStyle || Boolean(editingPending)}
                />
                <span>글자색</span>
              </label>
            </div>
            <span className="viewer-ribbon-group-label">글자 모양</span>
          </div>
          <div className="viewer-ribbon-group">
            <div className="viewer-ribbon-controls">
              {([
                ['LEFT', '왼쪽 정렬', '⇤'],
                ['CENTER', '가운데 정렬', '↔'],
                ['RIGHT', '오른쪽 정렬', '⇥'],
                ['JUSTIFY', '양쪽 정렬', '☰']
              ] as const).map(([align, label, icon]) => <button
                key={align}
                aria-label={label}
                title={label}
                aria-pressed={activeStyle?.align === align}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyParagraphStyle({ align })}
                disabled={!activeStyle || Boolean(editingPending)}
              >{icon}</button>)}
            </div>
            <span className="viewer-ribbon-group-label">문단 정렬</span>
          </div>
          <div className="viewer-ribbon-group viewer-ribbon-spacing-group">
            <div className="viewer-ribbon-controls viewer-ribbon-spacing-controls">
              <div className="viewer-paragraph-metric">
                <span>줄 간격</span>
                <button aria-label="줄 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ lineSpacing: Math.max(100, activeStyle.lineSpacing - 10) })} disabled={!activeStyle || activeStyle.lineSpacing <= 100 || Boolean(editingPending)}>−</button>
                <output aria-label="현재 줄 간격">{activeStyle ? `${activeStyle.lineSpacing}%` : '—'}</output>
                <button aria-label="줄 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ lineSpacing: Math.min(300, activeStyle.lineSpacing + 10) })} disabled={!activeStyle || activeStyle.lineSpacing >= 300 || Boolean(editingPending)}>＋</button>
              </div>
              <div className="viewer-paragraph-metric">
                <span>문단 앞</span>
                <button aria-label="문단 앞 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ marginBefore: Math.max(0, activeStyle.marginBefore - 100) })} disabled={!activeStyle || activeStyle.marginBefore <= 0 || Boolean(editingPending)}>−</button>
                <output aria-label="현재 문단 앞 간격">{activeStyle ? `${activeStyle.marginBefore / 100}pt` : '—'}</output>
                <button aria-label="문단 앞 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ marginBefore: Math.min(7200, activeStyle.marginBefore + 100) })} disabled={!activeStyle || activeStyle.marginBefore >= 7200 || Boolean(editingPending)}>＋</button>
              </div>
              <div className="viewer-paragraph-metric">
                <span>문단 뒤</span>
                <button aria-label="문단 뒤 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ marginAfter: Math.max(0, activeStyle.marginAfter - 100) })} disabled={!activeStyle || activeStyle.marginAfter <= 0 || Boolean(editingPending)}>−</button>
                <output aria-label="현재 문단 뒤 간격">{activeStyle ? `${activeStyle.marginAfter / 100}pt` : '—'}</output>
                <button aria-label="문단 뒤 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && void applyParagraphStyle({ marginAfter: Math.min(7200, activeStyle.marginAfter + 100) })} disabled={!activeStyle || activeStyle.marginAfter >= 7200 || Boolean(editingPending)}>＋</button>
              </div>
            </div>
            <span className="viewer-ribbon-group-label">문단 간격</span>
          </div>
        </div>
      </div>}
    </header>
    <section ref={stageRef} className="viewer-stage" onWheel={onStageWheel} onScroll={(event) => updateVisibleRange(event.currentTarget.scrollTop, event.currentTarget.clientHeight)}>
      {loading && <div className="viewer-empty">문서를 해석하는 중…</div>}
      {error && <div className="viewer-empty viewer-error" data-error-code={errorCode ?? undefined}>{error}<button onClick={chooseFile}>다른 파일 열기</button></div>}
      {!loading && !error && !hasDocument && <div className="viewer-empty"><div className="viewer-drop-icon">한</div><h1>HWP 또는 HWPX를 여기에 놓으세요</h1><p>읽기 전용으로 안전하게 엽니다.</p><button onClick={chooseFile}>파일 선택</button></div>}
      {effectiveDocument && !loading && <div className={`viewer-pages${virtualized ? ' viewer-pages-virtualized' : ''}`} data-document-format="hwpx" data-total-pages={pages.length} data-document-loading={documentLoading} data-layout-measured={Boolean(layoutMeasurements)} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.topSpacer }} />}
        {(virtualized ? pages.slice(visibleRange.start, visibleRange.end) : pages).map((page, localIndex) => {
          const index = virtualized ? visibleRange.start + localIndex : localIndex
          const decoration = decorations[index]
          const pageNumber = decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined
          return <article className="viewer-page" data-page-index={index} key={index} style={{ width: hwpUnitToCssPx(effectiveDocument.page.width), height: pageHeight, padding: `${hwpUnitToCssPx(effectiveDocument.page.margin.top)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.right)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.bottom)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.left)}px` }}><HeaderFooterView control={decoration.header} kind="header" document={effectiveDocument} offset={effectiveDocument.page.headerOffset} />{page.blocks.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} editing={editing && !printing ? { pending: Boolean(editingPending), restoreToken: layoutMeasurements, allowMultipleRuns: true, desiredSelection: editingSelection, onCommit: commitParagraph, onComposingChange, onSelectionChange: updateEditingSelection } : undefined} />)}<HeaderFooterView control={decoration.footer} kind="footer" document={effectiveDocument} offset={effectiveDocument.page.footerOffset} />{pageNumber && decoration.pageNumber && <span className={`viewer-page-number viewer-page-number-${pageNumberPosition(decoration.pageNumber.position)}`} style={{ bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom) }}>{pageNumber}</span>}</article>
        })}
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.bottomSpacer }} />}
      </div>}
      {fixedDocument && !loading && !error && <div
        className={`viewer-pages viewer-fixed-pages${virtualized ? ' viewer-pages-virtualized' : ''}`}
        data-document-format="hwp"
        data-total-pages={fixedDocument.pageCount}
        data-document-loading="false"
        data-layout-measured="true"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
      >
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.topSpacer }} />}
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
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.bottomSpacer }} />}
      </div>}
    </section>
    {hasDocument && <footer className="viewer-status" title={[...timingDetails, ...substitutions.map((font) => `${font.requested} → ${font.resolved}`)].join('\n')}><span>{pageCount}페이지</span><span>{fixedDocument ? `HWP · ${fixedDocument.sectionCount}구역` : 'HWPX'}</span>{editingStatus && <span className={editingStatus.includes('오류') ? 'viewer-status-error' : editing?.isDirty ? 'viewer-status-warn' : ''}>{editingStatus}{editing?.isDirty ? ' · 저장 안 됨' : ''}</span>}{sectionProgress && sectionProgress.loaded < sectionProgress.total && !backgroundError && <span>불러오는 중 {sectionProgress.loaded}/{sectionProgress.total}</span>}{backgroundError && <span className="viewer-status-error">나머지 페이지 오류</span>}{effectiveDocument && <span className={substitutions.length ? 'viewer-status-warn' : ''}>글꼴 대체 {substitutions.length}</span>}<span className={overflowPages.length ? 'viewer-status-error' : ''}>{virtualized ? '보이는 페이지 넘침' : '페이지 넘침'} {overflowPages.length}{overflowPages.length ? ` (${overflowPages.join(', ')})` : ''}</span>{loadTiming && <span className={loadTiming.openToFirstPaintMs !== undefined && loadTiming.openToFirstPaintMs > 1000 ? 'viewer-status-error' : ''}>열기 {loadTiming.openToFirstPaintMs === undefined ? '측정 중…' : ms(loadTiming.openToFirstPaintMs)}</span>}{pdfStatus && <span className={pdfStatus.startsWith('PDF 오류') ? 'viewer-status-error' : ''}>{pdfStatus}</span>}</footer>}
  </main>
}
