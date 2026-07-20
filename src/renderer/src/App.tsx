import { CSSProperties, DragEvent, useMemo, useState } from 'react'
import { ViewerCellStyle, ViewerContent, ViewerDocument, ViewerParagraph, ViewerTable } from '../../core/document/viewer_document'
import { hwpUnitToCssPx } from '../../core/layout/hwp_unit'

const api = () => (window as any).api

function borderCss(border: ViewerCellStyle['left']): string {
  return border.type === 'NONE' ? 'none' : `${Math.max(border.widthMm, 0.12)}mm solid ${border.color}`
}

function splitPages(document: ViewerDocument): ViewerParagraph[][] {
  const pages: ViewerParagraph[][] = [[]]
  document.sections.forEach((section) => section.blocks.forEach((block) => {
    if (block.pageBreak && pages[pages.length - 1].length) pages.push([])
    pages[pages.length - 1].push(block)
  }))
  return pages.filter((page) => page.length)
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

function ParagraphView({ paragraph, document }: { paragraph: ViewerParagraph; document: ViewerDocument }) {
  const style = document.paraStyles[paragraph.paraStyleId]
  const css: CSSProperties = {
    textAlign: style?.align === 'CENTER' ? 'center' : style?.align === 'RIGHT' ? 'right' : style?.align === 'JUSTIFY' ? 'justify' : 'left',
    marginLeft: hwpUnitToCssPx(style?.margin.left ?? 0),
    marginRight: hwpUnitToCssPx(style?.margin.right ?? 0),
    marginTop: hwpUnitToCssPx(style?.margin.top ?? 0),
    marginBottom: hwpUnitToCssPx(style?.margin.bottom ?? 0),
    lineHeight: style?.lineSpacing ? Math.max(style.lineSpacing / 100, 1) : 1.5
  }
  return <div className="viewer-paragraph" style={css}>{paragraph.content.map((item, index) => <Content key={`${paragraph.id}:${index}`} item={item} document={document} />)}</div>
}

function TableView({ table, document }: { table: ViewerTable; document: ViewerDocument }) {
  return <table className="viewer-table" style={{ width: table.width ? hwpUnitToCssPx(table.width) : '100%' }}><tbody>{table.rows.map((row, rowIndex) => <tr key={`${table.id}:r${rowIndex}`}>{row.cells.map((cell) => {
    const style = cell.borderFillId ? document.cellStyles[cell.borderFillId] : undefined
    return <td key={`${table.id}:r${cell.row}c${cell.column}`} colSpan={cell.columnSpan} rowSpan={cell.rowSpan} style={{
      width: hwpUnitToCssPx(cell.width), minHeight: hwpUnitToCssPx(cell.height),
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
  const pages = useMemo(() => document ? splitPages(document) : [], [document])

  const openPath = async (path: string) => {
    setLoading(true); setError(null)
    try { setDocument(await api().parseHWPX(path)); setFileName(path.split('/').pop() ?? path) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }
  const chooseFile = async () => { const path = await api().openFile(); if (path) await openPath(path) }
  const onDrop = async (event: DragEvent) => { event.preventDefault(); const path = (event.dataTransfer.files[0] as any)?.path; if (path?.toLowerCase().endsWith('.hwpx')) await openPath(path); else setError('HWPX 파일만 열 수 있습니다.') }

  return <main className="viewer-app" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
    <header className="viewer-toolbar"><div className="viewer-title"><span className="viewer-mark">한</span><span>{fileName}</span></div><div className="viewer-actions"><button onClick={() => setZoom((value) => Math.max(.5, value - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2, value + .1))}>+</button><button className="viewer-open" onClick={chooseFile}>HWPX 열기</button></div></header>
    <section className="viewer-stage">
      {loading && <div className="viewer-empty">문서를 해석하는 중…</div>}
      {error && <div className="viewer-empty viewer-error">{error}<button onClick={chooseFile}>다른 파일 열기</button></div>}
      {!loading && !error && !document && <div className="viewer-empty"><div className="viewer-drop-icon">HWPX</div><h1>문서를 여기에 놓으세요</h1><p>읽기 전용으로 안전하게 엽니다.</p><button onClick={chooseFile}>파일 선택</button></div>}
      {document && !loading && <div className="viewer-pages" style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>{pages.map((page, index) => <article className="viewer-page" key={index} style={{ width: hwpUnitToCssPx(document.page.width), minHeight: hwpUnitToCssPx(document.page.height), padding: `${hwpUnitToCssPx(document.page.margin.top)}px ${hwpUnitToCssPx(document.page.margin.right)}px ${hwpUnitToCssPx(document.page.margin.bottom)}px ${hwpUnitToCssPx(document.page.margin.left)}px` }}>{page.map((paragraph) => <ParagraphView key={paragraph.id} paragraph={paragraph} document={document} />)}<span className="viewer-page-number">{index + 1}</span></article>)}</div>}
    </section>
  </main>
}
