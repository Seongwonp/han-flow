import { CSSProperties, DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ViewerCellStyle, ViewerContent, ViewerDocument, ViewerDocumentComplete, ViewerHeaderFooter, ViewerParagraph, ViewerParseResult, ViewerTable } from '../../core/document/viewer_document'
import { cssPxToHwpUnit, hwpUnitToCssPx, hwpUnitToInches } from '../../core/layout/hwp_unit'
import { FontResolution, resolveDocumentFonts } from '../../core/fonts/font_resolver'
import { LayoutMeasurements, paginateViewerDocument } from '../../core/layout/pagination'
import { formatPageNumber, pageNumberPosition } from '../../core/layout/page_number'
import { resolvePageDecorations } from '../../core/layout/page_decorations'

const api = () => (window as any).api

interface ViewerLoadTiming {
  requestStartedAt: number
  openReceivedAt: number
  requestToModelMs: number
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
  firstPaintMs?: number
  openToFirstPaintMs?: number
}

const ms = (value: number): string => `${Math.round(value)}ms`

function borderCss(border: ViewerCellStyle['left']): string {
  return border.type === 'NONE' ? 'none' : `${Math.max(border.widthMm, 0.12)}mm solid ${border.color}`
}

function Content({ item, document }: { item: ViewerContent; document: ViewerDocument }) {
  if (item.type === 'text') {
    const style = document.charStyles[item.charStyleId]
    return <span style={{ fontFamily: style?.fontFamily ? `"${style.fontFamily}", "Apple SD Gothic Neo", sans-serif` : undefined, fontSize: style ? `${style.height / 100}pt` : undefined, fontWeight: style?.bold ? 700 : 400, color: style?.color }}>{item.text}</span>
  }
  if (item.type === 'image') {
    const resource = item.resourceId ? document.resources[item.resourceId] : undefined
    if (!resource) return <span className="viewer-warning">이미지 없음</span>
    return <img className="viewer-image" src={`data:${resource.mime};base64,${resource.data}`} style={{ width: item.width ? hwpUnitToCssPx(item.width) : undefined, height: item.height ? hwpUnitToCssPx(item.height) : undefined }} />
  }
  return <TableView table={item} document={document} />
}

function ParagraphView({ paragraph, document, measurable = false }: { paragraph: ViewerParagraph; document: ViewerDocument; measurable?: boolean }) {
  const style = document.paraStyles[paragraph.paraStyleId]
  const css: CSSProperties = {
    textAlign: style?.align === 'CENTER' ? 'center' : style?.align === 'RIGHT' ? 'right' : style?.align === 'JUSTIFY' ? 'justify' : 'left',
    marginLeft: hwpUnitToCssPx(style?.margin.left ?? 0),
    marginRight: hwpUnitToCssPx(style?.margin.right ?? 0),
    marginTop: hwpUnitToCssPx(style?.margin.top ?? 0),
    marginBottom: hwpUnitToCssPx(style?.margin.bottom ?? 0),
    lineHeight: style?.lineSpacing ? Math.max(style.lineSpacing / 100, 1) : 1.5
  }
  return <div className="viewer-paragraph" data-measure-block-id={measurable ? paragraph.id : undefined} style={css}>{paragraph.marker && <span className="viewer-paragraph-marker">{paragraph.marker} </span>}{paragraph.content.map((item, index) => <Content key={`${paragraph.id}:${index}`} item={item} document={document} />)}</div>
}

function HeaderFooterView({ control, kind, document, offset }: { control?: ViewerHeaderFooter; kind: 'header' | 'footer'; document: ViewerDocument; offset: number }) {
  if (!control) return null
  return <div className={`viewer-${kind}`} style={{ [kind === 'header' ? 'top' : 'bottom']: hwpUnitToCssPx(offset), left: hwpUnitToCssPx(document.page.margin.left), right: hwpUnitToCssPx(document.page.margin.right) }}>
    {control.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}
  </div>
}

function TableView({ table, document }: { table: ViewerTable; document: ViewerDocument }) {
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
  return <table className="viewer-table" style={{ width: table.width ? hwpUnitToCssPx(table.width) : '100%' }}><colgroup>{resolvedWidths.map((width, index) => <col key={index} style={{ width: `${(width / totalWidth) * 100}%` }} />)}</colgroup><tbody>{table.rows.map((row, rowIndex) => <tr data-measure-row-id={`${table.id}:r${row.cells[0]?.row ?? rowIndex}`} key={`${table.id}:r${rowIndex}`}>{row.cells.map((cell) => {
    const style = cell.borderFillId ? document.cellStyles[cell.borderFillId] : undefined
    return <td key={`${table.id}:r${cell.row}c${cell.column}`} colSpan={cell.columnSpan} rowSpan={cell.rowSpan} style={{
      minHeight: hwpUnitToCssPx(cell.height), verticalAlign: cell.verticalAlign === 'TOP' ? 'top' : cell.verticalAlign === 'BOTTOM' ? 'bottom' : 'middle',
      padding: `${hwpUnitToCssPx(cell.margin.top)}px ${hwpUnitToCssPx(cell.margin.right)}px ${hwpUnitToCssPx(cell.margin.bottom)}px ${hwpUnitToCssPx(cell.margin.left)}px`,
      background: style?.backgroundColor === '#000000' ? '#000' : style?.backgroundColor,
      borderLeft: style ? borderCss(style.left) : undefined, borderRight: style ? borderCss(style.right) : undefined,
      borderTop: style ? borderCss(style.top) : undefined, borderBottom: style ? borderCss(style.bottom) : undefined
    }}>{cell.paragraphs.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}</td>
  })}</tr>)}</tbody></table>
}

export default function App() {
  const [document, setDocument] = useState<ViewerDocument | null>(null)
  const [fileName, setFileName] = useState('문서를 열어 주세요')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fontResolutions, setFontResolutions] = useState<Record<string, FontResolution>>({})
  const [overflowPages, setOverflowPages] = useState<number[]>([])
  const [loadTiming, setLoadTiming] = useState<ViewerLoadTiming | null>(null)
  const [sectionProgress, setSectionProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [backgroundError, setBackgroundError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 12 })
  const [layoutMeasurements, setLayoutMeasurements] = useState<LayoutMeasurements | undefined>()
  const measurementRef = useRef<HTMLDivElement>(null)
  const activeLoadId = useRef('')
  const loadSequence = useRef(0)
  const automaticPdfStarted = useRef(false)
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
  const virtualized = pages.length > 50 && !printing
  const pageHeight = effectiveDocument ? hwpUnitToCssPx(effectiveDocument.page.height) : 0
  const pageStride = (pageHeight + 24) * zoom
  const updateVisibleRange = (scrollTop: number, viewportHeight: number) => {
    if (!virtualized || pageStride <= 0) return
    const start = Math.max(Math.floor(scrollTop / pageStride) - 2, 0)
    const end = Math.min(Math.ceil((scrollTop + viewportHeight) / pageStride) + 2, pages.length)
    setVisibleRange((current) => current.start === start && current.end === end ? current : { start, end })
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
    try {
      const result = await api().parseHWPX(path, loadId) as ViewerParseResult
      if (activeLoadId.current !== result.loadId) return
      setDocument(result.document)
      setSectionProgress({ loaded: result.complete ? result.sectionCount : result.document.sections.length, total: result.sectionCount })
      setLoadTiming({ requestStartedAt, openReceivedAt, requestToModelMs: performance.now() - requestStartedAt, ...result.timings })
      setFileName(path.split('/').pop() ?? path)
    }
    catch (reason) { if (activeLoadId.current === loadId) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (activeLoadId.current === loadId) setLoading(false) }
  }
  useEffect(() => {
    if (!document || !loadTiming || loadTiming.firstPaintMs !== undefined || pages.length === 0) return
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
  }, [document, loadTiming, pages.length])
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
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await globalThis.document.fonts.ready
      await Promise.all(Array.from(globalThis.document.images).map((image) => image.complete ? Promise.resolve() : image.decode().catch(() => undefined)))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      api().pdfReady(requestId)
    })
    const stopFinish = api().onFinishPdf(() => setPrinting(false))
    return () => { stopPrepare(); stopFinish() }
  }, [])
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
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const overflow = Array.from(globalThis.document.querySelectorAll<HTMLElement>('.viewer-page'))
        .map((page) => page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1 ? Number(page.dataset.pageIndex) + 1 : 0)
        .filter(Boolean)
      setOverflowPages(overflow)
    })
    return () => cancelAnimationFrame(frame)
  }, [effectiveDocument, pages.length, visibleRange])
  const chooseFile = async () => { const path = await api().openFile(); if (path) await openPath(path) }
  const onDrop = async (event: DragEvent) => { event.preventDefault(); const path = (event.dataTransfer.files[0] as any)?.path; if (path?.toLowerCase().endsWith('.hwpx')) await openPath(path); else setError('HWPX 파일만 열 수 있습니다.') }
  const exportPdf = async () => {
    if (!effectiveDocument || printing || documentLoading) return
    setPrinting(true); setPdfStatus('PDF 저장 중…')
    try {
      const path = await api().exportPdf({
        width: hwpUnitToInches(effectiveDocument.page.width),
        height: hwpUnitToInches(effectiveDocument.page.height)
      })
      setPdfStatus(path ? 'PDF 저장 완료' : null)
      setPrinting(false)
    } catch (reason) {
      setPdfStatus(`PDF 오류: ${reason instanceof Error ? reason.message : String(reason)}`)
      setPrinting(false)
    }
  }
  useEffect(() => {
    if (!effectiveDocument || documentLoading || automaticPdfStarted.current || new URLSearchParams(window.location.search).get('exportPdf') !== '1') return
    automaticPdfStarted.current = true
    void exportPdf()
  }, [effectiveDocument, documentLoading])
  const timingDetails = loadTiming ? [
    `ZIP 열기 ${ms(loadTiming.packageOpenMs)}`,
    `패키지 인덱스 ${ms(loadTiming.packageIndexMs)}`,
    `전체 디코딩 ${ms(loadTiming.decodeMs)}`,
    `main 합계 ${ms(loadTiming.mainTotalMs)}`,
    `IPC→모델 ${ms(loadTiming.requestToModelMs)}`,
    `레이아웃 ${ms(pagination.layoutMs)}`,
    `요청→첫 화면 ${loadTiming.firstPaintMs === undefined ? '측정 중' : ms(loadTiming.firstPaintMs)}`,
    `열기→첫 화면 ${loadTiming.openToFirstPaintMs === undefined ? '측정 중' : ms(loadTiming.openToFirstPaintMs)}`
  ] : []

  return <main className="viewer-app" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    {effectiveDocument && <div ref={measurementRef} className="viewer-measurement" style={{ width: hwpUnitToCssPx(effectiveDocument.page.width - effectiveDocument.page.margin.left - effectiveDocument.page.margin.right) }}>{effectiveDocument.sections.flatMap((section) => section.blocks).map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} measurable />)}</div>}
    <header className="viewer-toolbar"><div className="viewer-title"><span className="viewer-mark">한</span><span>{fileName}</span></div><div className="viewer-actions"><button onClick={() => setZoom((value) => Math.max(.5, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2, value + .1))}>+</button><button onClick={() => void exportPdf()} disabled={!effectiveDocument || printing || documentLoading}>PDF</button><button className="viewer-open" onClick={chooseFile}>HWPX 열기</button></div></header>
    <section className="viewer-stage" onScroll={(event) => updateVisibleRange(event.currentTarget.scrollTop, event.currentTarget.clientHeight)}>
      {loading && <div className="viewer-empty">문서를 해석하는 중…</div>}
      {error && <div className="viewer-empty viewer-error">{error}<button onClick={chooseFile}>다른 파일 열기</button></div>}
      {!loading && !error && !document && <div className="viewer-empty"><div className="viewer-drop-icon">HWPX</div><h1>문서를 여기에 놓으세요</h1><p>읽기 전용으로 안전하게 엽니다.</p><button onClick={chooseFile}>파일 선택</button></div>}
      {effectiveDocument && !loading && <div className={`viewer-pages${virtualized ? ' viewer-pages-virtualized' : ''}`} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
        {virtualized && <div className="viewer-page-spacer" style={{ height: visibleRange.start * (pageHeight + 24) }} />}
        {(virtualized ? pages.slice(visibleRange.start, visibleRange.end) : pages).map((page, localIndex) => {
          const index = virtualized ? visibleRange.start + localIndex : localIndex
          const decoration = decorations[index]
          const pageNumber = decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined
          return <article className="viewer-page" data-page-index={index} key={index} style={{ width: hwpUnitToCssPx(effectiveDocument.page.width), height: pageHeight, padding: `${hwpUnitToCssPx(effectiveDocument.page.margin.top)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.right)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.bottom)}px ${hwpUnitToCssPx(effectiveDocument.page.margin.left)}px` }}><HeaderFooterView control={decoration.header} kind="header" document={effectiveDocument} offset={effectiveDocument.page.headerOffset} />{page.blocks.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={effectiveDocument} />)}<HeaderFooterView control={decoration.footer} kind="footer" document={effectiveDocument} offset={effectiveDocument.page.footerOffset} />{pageNumber && decoration.pageNumber && <span className={`viewer-page-number viewer-page-number-${pageNumberPosition(decoration.pageNumber.position)}`} style={{ bottom: hwpUnitToCssPx(effectiveDocument.page.margin.bottom) }}>{pageNumber}</span>}</article>
        })}
        {virtualized && <div className="viewer-page-spacer" style={{ height: Math.max(pages.length - visibleRange.end, 0) * (pageHeight + 24) }} />}
      </div>}
    </section>
    {effectiveDocument && <footer className="viewer-status" title={[...timingDetails, ...substitutions.map((font) => `${font.requested} → ${font.resolved}`)].join('\n')}><span>{pages.length}페이지</span>{sectionProgress && sectionProgress.loaded < sectionProgress.total && !backgroundError && <span>불러오는 중 {sectionProgress.loaded}/{sectionProgress.total}</span>}{backgroundError && <span className="viewer-status-error">나머지 페이지 오류</span>}<span className={substitutions.length ? 'viewer-status-warn' : ''}>글꼴 대체 {substitutions.length}</span><span className={overflowPages.length ? 'viewer-status-error' : ''}>{virtualized ? '보이는 페이지 넘침' : '페이지 넘침'} {overflowPages.length}{overflowPages.length ? ` (${overflowPages.join(', ')})` : ''}</span>{loadTiming && <span className={loadTiming.openToFirstPaintMs !== undefined && loadTiming.openToFirstPaintMs > 1000 ? 'viewer-status-error' : ''}>열기 {loadTiming.openToFirstPaintMs === undefined ? '측정 중…' : ms(loadTiming.openToFirstPaintMs)}</span>}{pdfStatus && <span className={pdfStatus.startsWith('PDF 오류') ? 'viewer-status-error' : ''}>{pdfStatus}</span>}</footer>}
  </main>
}
