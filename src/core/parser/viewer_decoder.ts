import { ViewerBorder, ViewerCellStyle, ViewerCharStyle, ViewerContent, ViewerDocument, ViewerImage, ViewerParagraph, ViewerParaStyle, ViewerTable, ViewerTableCell } from '../document/viewer_document'
import { OrderedXmlNode, walkOrderedXml } from './ordered_xml'
import { HwpxPackageIndex, HwpxPackageReader } from './package_reader'

const num = (value?: string): number => Number(value ?? 0)
const children = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => node.children.filter((child) => child.name === name)
const child = (node: OrderedXmlNode, name: string): OrderedXmlNode | undefined => children(node, name)[0]
const descendants = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => walkOrderedXml(node.children).filter((item) => item.name === name)
const textOf = (node: OrderedXmlNode): string => walkOrderedXml(node.children).filter((item) => item.name === '#text').map((item) => item.text ?? '').join('')
const box = (node?: OrderedXmlNode) => ({ top: num(node?.attributes.top), right: num(node?.attributes.right), bottom: num(node?.attributes.bottom), left: num(node?.attributes.left) })

function decodeParagraph(node: OrderedXmlNode, id: string): ViewerParagraph {
  const content: ViewerContent[] = []
  children(node, 'hp:run').forEach((run) => {
    const charStyleId = run.attributes.charPrIDRef ?? '0'
    run.children.forEach((item) => {
      if (item.name === 'hp:t') content.push({ type: 'text', text: textOf(item), charStyleId })
      if (item.name === 'hp:tbl') content.push(decodeTable(item, `${id}:tbl${content.length}`))
      if (item.name === 'hp:pic') content.push(decodeImage(item))
      if (item.name === 'hp:tab') content.push({ type: 'text', text: '\t', charStyleId })
      if (item.name === 'hp:lineBreak') content.push({ type: 'text', text: '\n', charStyleId })
    })
  })
  const lineSegments = children(child(node, 'hp:linesegarray') ?? node, 'hp:lineseg')
  const starts = lineSegments.map((segment) => num(segment.attributes.vertpos))
  const ends = lineSegments.map((segment) => num(segment.attributes.vertpos) + num(segment.attributes.vertsize))
  const layoutHeight = lineSegments.length ? Math.max(...ends) - Math.min(...starts) : 0
  return { id, paraStyleId: node.attributes.paraPrIDRef ?? '0', pageBreak: node.attributes.pageBreak === '1', layoutHeight, content }
}

function decodeImage(node: OrderedXmlNode): ViewerImage {
  const resource = descendants(node, 'hc:img')[0]
  const size = descendants(node, 'hp:curSz')[0] ?? child(node, 'hp:sz')
  return { type: 'image', resourceId: resource?.attributes.binaryItemIDRef, width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined }
}

function decodeTable(node: OrderedXmlNode, id: string): ViewerTable {
  const size = child(node, 'hp:sz')
  const rows = children(node, 'hp:tr').map((row, rowIndex) => ({
    cells: children(row, 'hp:tc').map((cell, cellIndex): ViewerTableCell => {
      const address = child(cell, 'hp:cellAddr')
      const span = child(cell, 'hp:cellSpan')
      const cellSize = child(cell, 'hp:cellSz')
      const subList = child(cell, 'hp:subList')
      const column = num(address?.attributes.colAddr ?? String(cellIndex))
      const actualRow = num(address?.attributes.rowAddr ?? String(rowIndex))
      return {
        row: actualRow,
        column,
        rowSpan: num(span?.attributes.rowSpan) || 1,
        columnSpan: num(span?.attributes.colSpan) || 1,
        width: num(cellSize?.attributes.width),
        height: num(cellSize?.attributes.height),
        margin: box(child(cell, 'hp:cellMargin')),
        borderFillId: cell.attributes.borderFillIDRef,
        verticalAlign: subList?.attributes.vertAlign,
        header: cell.attributes.header === '1',
        paragraphs: subList ? children(subList, 'hp:p').map((p, index) => decodeParagraph(p, `${id}:r${actualRow}c${column}:p${index}`)) : []
      }
    })
  }))
  return { type: 'table', id, rowCount: num(node.attributes.rowCnt) || rows.length, columnCount: num(node.attributes.colCnt), width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined, pageBreak: node.attributes.pageBreak, repeatHeader: node.attributes.repeatHeader === '1', rows }
}

function decodeHeader(nodes: OrderedXmlNode[]) {
  const all = walkOrderedXml(nodes)
  const fonts: Record<string, string> = {}
  const hangul = all.find((node) => node.name === 'hh:fontface' && node.attributes.lang === 'HANGUL')
  hangul?.children.filter((node) => node.name === 'hh:font').forEach((font) => { fonts[font.attributes.id] = font.attributes.face })
  const charStyles: Record<string, ViewerCharStyle> = {}
  all.filter((node) => node.name === 'hh:charPr').forEach((style) => {
    const ref = child(style, 'hh:fontRef')?.attributes.hangul
    charStyles[style.attributes.id] = { id: style.attributes.id, height: num(style.attributes.height), color: style.attributes.textColor ?? '#000000', bold: Boolean(child(style, 'hh:bold')), fontId: ref, fontFamily: ref ? fonts[ref] : undefined }
  })
  const paraStyles: Record<string, ViewerParaStyle> = {}
  all.filter((node) => node.name === 'hh:paraPr').forEach((style) => {
    const marginNode = child(style, 'hh:margin')
    const getValue = (name: string) => num(child(marginNode ?? style, name)?.attributes.value)
    paraStyles[style.attributes.id] = { id: style.attributes.id, align: child(style, 'hh:align')?.attributes.horizontal, lineSpacing: num(child(style, 'hh:lineSpacing')?.attributes.value), margin: { left: getValue('hc:left'), right: getValue('hc:right'), top: getValue('hc:prev'), bottom: getValue('hc:next') } }
  })
  const border = (node?: OrderedXmlNode): ViewerBorder => ({
    type: node?.attributes.type ?? 'NONE',
    widthMm: Number.parseFloat(node?.attributes.width ?? '0') || 0,
    color: node?.attributes.color ?? '#000000'
  })
  const cellStyles: Record<string, ViewerCellStyle> = {}
  all.filter((node) => node.name === 'hh:borderFill').forEach((style) => {
    const fill = descendants(style, 'hc:winBrush')[0]
    cellStyles[style.attributes.id] = {
      id: style.attributes.id,
      backgroundColor: fill?.attributes.faceColor,
      left: border(child(style, 'hh:leftBorder')),
      right: border(child(style, 'hh:rightBorder')),
      top: border(child(style, 'hh:topBorder')),
      bottom: border(child(style, 'hh:bottomBorder'))
    }
  })
  return { fonts, charStyles, paraStyles, cellStyles }
}

export async function decodeViewerDocument(reader: HwpxPackageReader, knownIndex?: HwpxPackageIndex): Promise<ViewerDocument> {
  const index = knownIndex ?? await reader.index()
  const header = decodeHeader(await reader.readOrderedXml(index.headerPath))
  const sectionXml = await Promise.all(index.sectionPaths.map((path) => reader.readOrderedXml(path)))
  const pagePr = sectionXml.flatMap(walkOrderedXml).find((node) => node.name === 'hp:pagePr')
  const margin = pagePr ? child(pagePr, 'hp:margin') : undefined
  const sections = sectionXml.map((nodes, sectionIndex) => {
    const root = nodes.find((node) => node.name === 'hs:sec')
    return { id: `section-${sectionIndex}`, blocks: root ? children(root, 'hp:p').map((p, index) => decodeParagraph(p, `s${sectionIndex}:p${index}`)) : [] }
  })
  const resources = Object.fromEntries(await Promise.all(index.resourcePaths.map(async (path) => {
    const id = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
    const extension = path.split('.').pop()?.toLowerCase()
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension ?? 'png'}`
    return [id, { id, path, mime, data: (await reader.readBuffer(path)).toString('base64') }]
  })))
  return {
    page: { width: num(pagePr?.attributes.width), height: num(pagePr?.attributes.height), margin: box(margin) },
    ...header,
    resources,
    sections,
    diagnostics: []
  }
}
