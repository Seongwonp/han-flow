import { CSSProperties, DragEvent, useEffect, useMemo, useRef, useState, WheelEvent } from 'react'
import { ViewerCellStyle, ViewerContent, ViewerDocument, ViewerDocumentComplete, ViewerHeaderFooter, ViewerParagraph, ViewerParseResult, ViewerTable, ViewerTableCell } from '../../core/document/viewer_document'
import { FixedPageDescriptor, FixedPageDocument, FixedPageTextLayout } from '../../core/document/fixed_page_document'
import { cssPxToHwpUnit, hwpUnitToCssPx, hwpUnitToInches } from '../../core/layout/hwp_unit'
import { fixedPageOffsets, fixedPageVirtualRange } from '../../core/layout/fixed_page_virtualization'
import { FontResolution, resolveDocumentFonts } from '../../core/fonts/font_resolver'
import { LayoutMeasurements, paginateViewerDocument } from '../../core/layout/pagination'
import { formatPageNumber, pageNumberPosition } from '../../core/layout/page_number'
import { resolvePageDecorations } from '../../core/layout/page_decorations'
import { pinchZoom, stepZoom } from '../../core/layout/zoom'

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

export function cellFragmentKey(tableId: string, cell: ViewerTableCell): string {
  const fragment = cell.splitTop ? (cell.splitBottom ? 'tb' : 't') : (cell.splitBottom ? 'b' : 'full')
  return `${tableId}:${cell.sourceCellId ?? `r${cell.row}c${cell.column}`}:${fragment}`
}

function Content({ item, document, measurable = false }: { item: ViewerContent; document: ViewerDocument; measurable?: boolean }) {
  if (item.type === 'text') {
    const style = document.charStyles[item.charStyleId]
    return <span style={{ fontFamily: style?.fontFamily ? `"${style.fontFamily}", "Apple SD Gothic Neo", sans-serif` : undefined, fontSize: style ? `${style.height / 100}pt` : undefined, fontWeight: style?.bold ? 700 : 400, color: style?.color }}>{item.text}</span>
  }
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    return <img className="viewer-image" src={`data:${resource.mime};base64,${resource.data}`} style={{ width: item.width ? hwpUnitToCssPx(item.width) : undefined, height: item.height ? hwpUnitToCssPx(item.height) : undefined }} />
  }
  return <TableView table={item} document={document} measurable={measurable} />
}

export function ParagraphView({ paragraph, document, measurable = false }: { paragraph: ViewerParagraph; document: ViewerDocument; measurable?: boolean }) {
  const style = document.paraStyles[paragraph.paraStyleId]
  const css: CSSProperties = {
    textAlign: style?.align === 'CENTER' ? 'center' : style?.align === 'RIGHT' ? 'right' : style?.align === 'JUSTIFY' ? 'justify' : 'left',
    marginLeft: hwpUnitToCssPx(style?.margin.left ?? 0),
    marginRight: hwpUnitToCssPx(style?.margin.right ?? 0),
    marginTop: hwpUnitToCssPx(style?.margin.top ?? 0),
    marginBottom: hwpUnitToCssPx(style?.margin.bottom ?? 0),
    lineHeight: style?.lineSpacing ? Math.max(style.lineSpacing / 100, 1) : 1.5
  }
  return <div className="viewer-paragraph" data-measure-block-id={measurable ? paragraph.id : undefined} style={css}>{paragraph.marker && <span className="viewer-paragraph-marker">{paragraph.marker} </span>}{paragraph.content.map((item, index) => <Content key={`${paragraph.id}:${index}`} item={item} document={document} measurable={measurable} />)}</div>
}

function HeaderFooterView({ control, kind, document, offset }: { control?: ViewerHeaderFooter; kind: 'header' | 'footer'; document: ViewerDocument; offset: number }) {
  if (!control) return null
  return <div className={`viewer-${kind}`} style={{ [kind === 'header' ? 'top' : 'bottom']: hwpUnitToCssPx(offset), left: hwpUnitToCssPx(document.page.margin.left), right: hwpUnitToCssPx(document.page.margin.right) }}>
    {control.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}
  </div>
}

function TableView({ table, document, measurable = false }: { table: ViewerTable; document: ViewerDocument; measurable?: boolean }) {
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
    }}>{cell.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} measurable={measurable} />)}</td>
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

export default function App() {
  const [document, setDocument] = useState<ViewerDocument | null>(null)
  const [fixedDocument, setFixedDocument] = useState<FixedPageDocument | null>(null)
  const [fileName, setFileName] = useState('문서를 열어 주세요')
  const [error, setError] = useState<string | null>(null)
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
  const measurementRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchSequence = useRef(0)
  const activeLoadId = useRef('')
  const loadSequence = useRef(0)
  const automaticPdfStarted = useRef(false)
  const stageRef = useRef<HTMLElement>(null)
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
    const requestStartedAt = performance.now()
    const loadId = String(++loadSequence.current)
    activeLoadId.current = loadId
    setLoading(true); setError(null)
    setLoadTiming(null)
    setSectionProgress(null)
    setBackgroundError(null)
    setFixedPrintPages(null)
    setFixedFirstPageReady(false)
    setFixedFollowingPagesEnabled(false)
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    setDocument(null)
    setFixedDocument(null)
    try {
      if (path.toLowerCase().endsWith('.hwp')) {
        const readStartedAt = performance.now()
        const binary = await api().readHwp(path) as { bytes: Uint8Array; readMs: number }
        const adapter = await loadRhwpAdapter()
        const result = await adapter.openRhwpFixedPageDocument(
          new Uint8Array(binary.bytes),
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
          packageOpenMs: binary.readMs,
          packageIndexMs: 0,
          decodeMs: result.timings.parseMs,
          mainTotalMs: performance.now() - readStartedAt,
          wasmInitMs: result.timings.wasmInitMs,
          pageInfoMs: result.timings.pageInfoMs
        })
        setFileName(path.split('/').pop() ?? path)
        return
      }
      if (fixedDocument) (await loadRhwpAdapter()).closeRhwpFixedPageDocument()
      const result = await api().parseHWPX(path, loadId) as ViewerParseResult
      if (activeLoadId.current !== result.loadId) return
      setDocument(result.document)
      setSectionProgress({ loaded: result.complete ? result.sectionCount : result.document.sections.length, total: result.sectionCount })
      setLoadTiming({ format: 'hwpx', requestStartedAt, openReceivedAt, requestToModelMs: performance.now() - requestStartedAt, ...result.timings })
      setFileName(path.split('/').pop() ?? path)
    }
    catch (reason) { if (activeLoadId.current === loadId) setError(reason instanceof Error ? reason.message : String(reason)) }
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
  useEffect(() => api().onDocumentComplete((payload: ViewerDocumentComplete) => {
    if (payload.loadId !== activeLoadId.current) return
    setDocument(payload.document)
    setSectionProgress({ loaded: payload.document.sections.length, total: payload.document.sections.length })
  }), [])
  useEffect(() => api().onDocumentError((payload: { loadId: string; message: string }) => {
    if (payload.loadId !== activeLoadId.current) return
    setBackgroundError(payload.message)
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
      await Promise.all(Array.from(globalThis.document.images).map((image) => image.complete ? Promise.resolve() : image.decode().catch(() => undefined)))
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        closeSearch()
        return
      }
      if (!event.metaKey) return
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
  }, [zoom, fixedDocument, searchOpen, searchResults.length])
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
    else setError('HWP 또는 HWPX 파일만 열 수 있습니다.')
  }
  const exportPdf = async () => {
    if (!hasDocument || printing || documentLoading) return
    setPrinting(true); setPdfStatus('PDF 저장 중…')
    try {
      const fixedPage = fixedDocument?.pages[0]
      const path = await api().exportPdf({
        width: fixedPage ? fixedPage.width / 96 : hwpUnitToInches(effectiveDocument!.page.width),
        height: fixedPage ? fixedPage.height / 96 : hwpUnitToInches(effectiveDocument!.page.height)
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
    {effectiveDocument && <div ref={measurementRef} className="viewer-measurement" style={{ width: hwpUnitToCssPx(effectiveDocument.page.width - effectiveDocument.page.margin.left - effectiveDocument.page.margin.right) }}>{effectiveDocument.sections.flatMap((section) => section.blocks).map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} measurable />)}</div>}
    <header className="viewer-toolbar"><div className="viewer-title"><span className="viewer-mark">한</span><span>{fileName}</span></div><div className="viewer-actions">
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
      <button aria-label="축소" onClick={() => changeZoomAt(stepZoom(zoom, -1))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="확대" onClick={() => changeZoomAt(stepZoom(zoom, 1))}>+</button><button onClick={() => void exportPdf()} disabled={!hasDocument || printing || documentLoading}>PDF</button><button className="viewer-open" onClick={chooseFile}>문서 열기</button>
    </div></header>
    <section ref={stageRef} className="viewer-stage" onWheel={onStageWheel} onScroll={(event) => updateVisibleRange(event.currentTarget.scrollTop, event.currentTarget.clientHeight)}>
      {loading && <div className="viewer-empty">문서를 해석하는 중…</div>}
      {error && <div className="viewer-empty viewer-error">{error}<button onClick={chooseFile}>다른 파일 열기</button></div>}
      {!loading && !error && !hasDocument && <div className="viewer-empty"><div className="viewer-drop-icon">한</div><h1>HWP 또는 HWPX를 여기에 놓으세요</h1><p>읽기 전용으로 안전하게 엽니다.</p><button onClick={chooseFile}>파일 선택</button></div>}
      {effectiveDocument && !loading && <div className={`viewer-pages${virtualized ? ' viewer-pages-virtualized' : ''}`} data-total-pages={pages.length} data-document-loading={documentLoading} data-layout-measured={Boolean(layoutMeasurements)} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.topSpacer }} />}
        {(virtualized ? pages.slice(visibleRange.start, visibleRange.end) : pages).map((page, localIndex) => {
          const index = virtualized ? visibleRange.start + localIndex : localIndex
          const decoration = decorations[index]
          const pageNumber = decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined
          return <article className="viewer-page" data-page-index={index} key={index} style={{ width: hwpUnitToCssPx(effectiveDocument.page.width), height: pageHeight, padding: `${hwpUnitToCssPx(effectiveDocument.page.margin.top)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.right)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.bottom)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.left)}px` }}><HeaderFooterView control={decoration.header} kind="header" document={effectiveDocument} offset={effectiveDocument.page.headerOffset} />{page.blocks.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} />)}<HeaderFooterView control={decoration.footer} kind="footer" document={effectiveDocument} offset={effectiveDocument.page.footerOffset} />{pageNumber && decoration.pageNumber && <span className={`viewer-page-number viewer-page-number-${pageNumberPosition(decoration.pageNumber.position)}`} style={{ bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom) }}>{pageNumber}</span>}</article>
        })}
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.bottomSpacer }} />}
      </div>}
      {fixedDocument && !loading && !error && <div
        className={`viewer-pages viewer-fixed-pages${virtualized ? ' viewer-pages-virtualized' : ''}`}
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
    {hasDocument && <footer className="viewer-status" title={[...timingDetails, ...substitutions.map((font) => `${font.requested} → ${font.resolved}`)].join('\n')}><span>{pageCount}페이지</span><span>{fixedDocument ? `HWP · ${fixedDocument.sectionCount}구역` : 'HWPX'}</span>{sectionProgress && sectionProgress.loaded < sectionProgress.total && !backgroundError && <span>불러오는 중 {sectionProgress.loaded}/{sectionProgress.total}</span>}{backgroundError && <span className="viewer-status-error">나머지 페이지 오류</span>}{effectiveDocument && <span className={substitutions.length ? 'viewer-status-warn' : ''}>글꼴 대체 {substitutions.length}</span>}<span className={overflowPages.length ? 'viewer-status-error' : ''}>{virtualized ? '보이는 페이지 넘침' : '페이지 넘침'} {overflowPages.length}{overflowPages.length ? ` (${overflowPages.join(', ')})` : ''}</span>{loadTiming && <span className={loadTiming.openToFirstPaintMs !== undefined && loadTiming.openToFirstPaintMs > 1000 ? 'viewer-status-error' : ''}>열기 {loadTiming.openToFirstPaintMs === undefined ? '측정 중…' : ms(loadTiming.openToFirstPaintMs)}</span>}{pdfStatus && <span className={pdfStatus.startsWith('PDF 오류') ? 'viewer-status-error' : ''}>{pdfStatus}</span>}</footer>}
  </main>
}
