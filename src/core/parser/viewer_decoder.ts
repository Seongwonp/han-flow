import { ViewerBorder, ViewerCellStyle, ViewerCharStyle, ViewerContent, ViewerDocument, ViewerHeaderFooter, ViewerImage, ViewerPageNumber, ViewerParagraph, ViewerParaStyle, ViewerTable, ViewerTableCell } from '../document/viewer_document'
import { OrderedXmlNode, walkOrderedXml } from './ordered_xml'
import { HwpxPackageIndex, HwpxReadablePackage } from './package_reader'
import { ImageResourceBudget } from './resource_budget'

const num = (value?: string): number => Number(value ?? 0)
const children = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => node.children.filter((child) => child.name === name)
const child = (node: OrderedXmlNode, name: string): OrderedXmlNode | undefined => children(node, name)[0]
const descendants = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => walkOrderedXml(node.children).filter((item) => item.name === name)

function styleChild(node: OrderedXmlNode, name: string): OrderedXmlNode | undefined {
  const direct = child(node, name)
  if (direct) return direct
  const switchNode = child(node, 'hp:switch')
  const branch = child(switchNode ?? node, 'hp:case') ?? child(switchNode ?? node, 'hp:default')
  return branch ? descendants(branch, name)[0] : undefined
}
const textOf = (node: OrderedXmlNode): string => walkOrderedXml(node.children).filter((item) => item.name === '#text').map((item) => item.text ?? '').join('')
const inlineTextOf = (node: OrderedXmlNode): string => node.children.map((item) => {
  if (item.name === '#text') return item.text ?? ''
  if (item.name === 'hp:lineBreak') return '\n'
  if (item.name === 'hp:tab') return '\t'
  return textOf(item)
}).join('')
const isEditableInlineText = (node: OrderedXmlNode): boolean => node.children.every(
  (item) => item.name === '#text' || item.name === 'hp:lineBreak' || item.name === 'hp:tab'
)
const box = (node?: OrderedXmlNode) => ({ top: num(node?.attributes.top), right: num(node?.attributes.right), bottom: num(node?.attributes.bottom), left: num(node?.attributes.left) })

export interface ViewerDecodeOptions {
  sectionPaths?: string[]
  resourcePaths?: string[]
}

function decodeParagraph(node: OrderedXmlNode, id: string, sectionPath?: string): ViewerParagraph {
  const content: ViewerContent[] = []
  children(node, 'hp:run').forEach((run) => {
    const charStyleId = run.attributes.charPrIDRef ?? '0'
    run.children.forEach((item) => {
      if (item.name === 'hp:t') {
        content.push({
          type: 'text',
          text: inlineTextOf(item),
          charStyleId,
          sourceAnchor:
            sectionPath !== undefined &&
            item.sourceOrdinal !== undefined &&
            isEditableInlineText(item)
              ? {
                  sectionPath,
                  textNodeId: `${sectionPath}#hp:t:${item.sourceOrdinal}`
                }
              : undefined
        })
      }
      if (item.name === 'hp:tbl') content.push(decodeTable(item, `${id}:tbl${content.length}`, sectionPath))
      if (item.name === 'hp:pic') content.push(decodeImage(item))
      if (item.name === 'hp:tab') content.push({ type: 'text', text: '\t', charStyleId })
      if (item.name === 'hp:lineBreak') content.push({ type: 'text', text: '\n', charStyleId })
    })
  })
  const lineSegments = children(child(node, 'hp:linesegarray') ?? node, 'hp:lineseg')
  const starts = lineSegments.map((segment) => num(segment.attributes.vertpos))
  const ends = lineSegments.map((segment) => num(segment.attributes.vertpos) + num(segment.attributes.vertsize))
  const layoutHeight = lineSegments.length ? Math.max(...ends) - Math.min(...starts) : 0
  const layoutTop = lineSegments.length ? Math.min(...starts) : undefined
  return { id, paraStyleId: node.attributes.paraPrIDRef ?? '0', pageBreak: node.attributes.pageBreak === '1', layoutTop, layoutHeight, content }
}

function decodeImage(node: OrderedXmlNode): ViewerImage {
  const resource = descendants(node, 'hc:img')[0]
  const size = descendants(node, 'hp:curSz')[0] ?? child(node, 'hp:sz')
  return { type: 'image', resourceId: resource?.attributes.binaryItemIDRef, width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined }
}

function decodeTable(node: OrderedXmlNode, id: string, sectionPath?: string): ViewerTable {
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
        sourceCellId: `${id}:r${actualRow}c${column}`,
        paragraphs: subList
          ? children(subList, 'hp:p').map((p, index) =>
              decodeParagraph(p, `${id}:r${actualRow}c${column}:p${index}`, sectionPath)
            )
          : []
      }
    })
  }))
  return { type: 'table', id, rowCount: num(node.attributes.rowCnt) || rows.length, columnCount: num(node.attributes.colCnt), width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined, pageBreak: node.attributes.pageBreak, repeatHeader: node.attributes.repeatHeader === '1', rows }
}

function decodePageNumber(nodes: OrderedXmlNode[]): ViewerPageNumber | undefined {
  const all = walkOrderedXml(nodes)
  const pageNum = all.find((node) => node.name === 'hp:pageNum')
  if (!pageNum) return undefined
  const startNum = all.find((node) => node.name === 'hp:startNum')
  const visibility = all.find((node) => node.name === 'hp:visibility')
  const start = num(startNum?.attributes.page)
  return {
    position: pageNum.attributes.pos ?? 'BOTTOM_CENTER',
    formatType: pageNum.attributes.formatType ?? 'DIGIT',
    sideChar: pageNum.attributes.sideChar ?? '',
    start: start > 0 ? start : undefined,
    hiddenOnFirstPage: visibility?.attributes.hideFirstPageNum === '1'
  }
}

function decodeHeaderFooters(
  nodes: OrderedXmlNode[],
  name: 'hp:header' | 'hp:footer',
  sectionIndex: number,
  sectionPath: string
): ViewerHeaderFooter[] {
  return walkOrderedXml(nodes).filter((node) => node.name === name).map((node, controlIndex) => {
    const subList = child(node, 'hp:subList')
    const kind = name === 'hp:header' ? 'header' : 'footer'
    return {
      id: node.attributes.id ?? `s${sectionIndex}:${kind}${controlIndex}`,
      applyPageType: node.attributes.applyPageType ?? 'BOTH',
      paragraphs: subList
        ? children(subList, 'hp:p').map((paragraph, index) =>
            decodeParagraph(paragraph, `s${sectionIndex}:${kind}${controlIndex}:p${index}`, sectionPath)
          )
        : []
    }
  })
}

function decodeHeader(nodes: OrderedXmlNode[]) {
  const all = walkOrderedXml(nodes)
  const fonts: Record<string, string> = {}
  const hangul = all.find((node) => node.name === 'hh:fontface' && node.attributes.lang === 'HANGUL')
  hangul?.children.filter((node) => node.name === 'hh:font').forEach((font) => { fonts[font.attributes.id] = font.attributes.face })
  const charStyles: Record<string, ViewerCharStyle> = {}
  all.filter((node) => node.name === 'hh:charPr').forEach((style) => {
    const ref = child(style, 'hh:fontRef')?.attributes.hangul
    const underline = child(style, 'hh:underline')
    const strikeout = child(style, 'hh:strikeout')
    charStyles[style.attributes.id] = {
      id: style.attributes.id,
      height: num(style.attributes.height),
      color: style.attributes.textColor ?? '#000000',
      bold: Boolean(child(style, 'hh:bold')),
      italic: Boolean(child(style, 'hh:italic')),
      underline: Boolean(underline && underline.attributes.type !== 'NONE'),
      strikeout: Boolean(strikeout && strikeout.attributes.shape !== 'NONE'),
      fontId: ref,
      fontFamily: ref ? fonts[ref] : undefined
    }
  })
  const paraStyles: Record<string, ViewerParaStyle> = {}
  const bullets = Object.fromEntries(all.filter((node) => node.name === 'hh:bullet').map((node) => [node.attributes.id, node.attributes.char ?? '•']))
  const numberings = Object.fromEntries(all.filter((node) => node.name === 'hh:numbering').map((node) => [node.attributes.id, children(node, 'hh:paraHead').map((head) => ({ pattern: textOf(head), format: head.attributes.numFormat ?? 'DIGIT' }))]))
  all.filter((node) => node.name === 'hh:paraPr').forEach((style) => {
    const marginNode = styleChild(style, 'hh:margin')
    const getValue = (name: string) => num(child(marginNode ?? style, name)?.attributes.value)
    const heading = child(style, 'hh:heading')
    const level = num(heading?.attributes.level)
    const idRef = heading?.attributes.idRef ?? '0'
    const numbering = numberings[idRef]?.[level]
    paraStyles[style.attributes.id] = {
      id: style.attributes.id,
      align: child(style, 'hh:align')?.attributes.horizontal,
      lineSpacing: num(styleChild(style, 'hh:lineSpacing')?.attributes.value),
      indent: getValue('hc:intent'),
      margin: { left: getValue('hc:left'), right: getValue('hc:right'), top: getValue('hc:prev'), bottom: getValue('hc:next') },
      heading: heading ? { type: heading.attributes.type ?? 'NONE', idRef, level, bullet: bullets[idRef], numberPattern: numbering?.pattern, numberFormat: numbering?.format } : undefined
    }
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

function applyParagraphMarkers(paragraphs: ViewerParagraph[], paraStyles: Record<string, ViewerParaStyle>): ViewerParagraph[] {
  const counters: Record<string, number> = {}
  return paragraphs.map((paragraph) => {
    const heading = paraStyles[paragraph.paraStyleId]?.heading
    let marker: string | undefined
    if (heading?.type === 'BULLET') marker = heading.bullet
    if (heading?.type === 'NUMBER') {
      const key = `${heading.idRef}:${heading.level}`
      counters[key] = (counters[key] ?? 0) + 1
      const token = `^${heading.level + 1}`
      marker = heading.numberPattern?.replace(token, String(counters[key])) || `${counters[key]}.`
    }
    const content = paragraph.content.map((item) => item.type === 'table' ? {
      ...item,
      rows: item.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, paragraphs: applyParagraphMarkers(cell.paragraphs, paraStyles) })) }))
    } : item)
    return { ...paragraph, marker, content }
  })
}

export async function decodeViewerDocument(reader: HwpxReadablePackage, knownIndex?: HwpxPackageIndex, options: ViewerDecodeOptions = {}): Promise<ViewerDocument> {
  const index = knownIndex ?? await reader.index()
  const sectionPaths = options.sectionPaths ?? index.sectionPaths
  const resourcePaths = options.resourcePaths ?? index.resourcePaths
  const header = decodeHeader(await reader.readOrderedXml(index.headerPath))
  const sectionXml = await Promise.all(sectionPaths.map(async (path) => ({ path, nodes: await reader.readOrderedXml(path) })))
  const sectionNodes = sectionXml.flatMap(({ nodes }) => walkOrderedXml(nodes))
  const pagePr = sectionNodes.find((node) => node.name === 'hp:pagePr')
  const margin = pagePr ? child(pagePr, 'hp:margin') : undefined
  const sections = sectionXml.map(({ path, nodes }) => {
    const sectionIndex = Number(path.match(/section(\d+)\.xml$/)?.[1] ?? 0)
    const root = nodes.find((node) => node.name === 'hs:sec')
    return {
      id: `section-${sectionIndex}`,
      blocks: root
        ? applyParagraphMarkers(
            children(root, 'hp:p').map((p, index) => decodeParagraph(p, `s${sectionIndex}:p${index}`, path)),
            header.paraStyles
          )
        : [],
      pageNumber: decodePageNumber(nodes),
      headers: decodeHeaderFooters(nodes, 'hp:header', sectionIndex, path).map((control) => ({
        ...control,
        paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
      })),
      footers: decodeHeaderFooters(nodes, 'hp:footer', sectionIndex, path).map((control) => ({
        ...control,
        paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
      }))
    }
  })
  const imageBudget = new ImageResourceBudget()
  const resourceEntries: Array<[string, { id: string; path: string; mime: string; data: string }]> = []
  for (const path of resourcePaths) {
    const id = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
    const extension = path.split('.').pop()?.toLowerCase()
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension ?? 'png'}`
    const bytes = await reader.readBuffer(path)
    imageBudget.add(path, bytes)
    resourceEntries.push([id, { id, path, mime, data: bytes.toString('base64') }])
  }
  const resources = Object.fromEntries(resourceEntries)
  return {
    page: { width: num(pagePr?.attributes.width), height: num(pagePr?.attributes.height), margin: box(margin), headerOffset: num(margin?.attributes.header), footerOffset: num(margin?.attributes.footer) },
    ...header,
    resources,
    sections,
    diagnostics: []
  }
}
