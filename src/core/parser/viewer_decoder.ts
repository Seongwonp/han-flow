import { supportsViewerColumnFlow, ViewerBorder, ViewerCellStyle, ViewerCharStyle, ViewerColumnLayout, ViewerContent, ViewerDiagnostic, ViewerDocument, ViewerHeaderFooter, ViewerImage, ViewerPageNumber, ViewerParagraph, ViewerParaStyle, ViewerTable, ViewerTableCell } from '../document/viewer_document'
import { OrderedXmlNode, walkOrderedXml } from './ordered_xml'
import {
  EMPTY_PARAGRAPH_BLOCKING_CONTROLS,
  EMPTY_PARAGRAPH_RUN_CONTROLS,
  emptyParagraphAnchorId
} from '../editing/empty_paragraph_anchor'
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
/**
 * 문단 모양 `hh:margin` 값의 배율.
 * 한/글은 HwpUnitChar namespace를 아는 reader용 `hp:switch/hp:case`에는 실제 HWPUNIT을, 그 밖의 직접
 * `hh:margin`(한/글 2018 이전 저장본)과 `hp:default`에는 같은 값의 2배를 적는다(예: case 1752 / default 3504).
 * 한/글 저장본의 `hp:lineseg`도 왼쪽 여백 6000을 `horzpos` 3000으로, 문단 앞 간격 1000을 줄 간격 500으로 배치한다.
 */
export function paragraphMarginScale(paraPr: OrderedXmlNode, margin: OrderedXmlNode | undefined): number {
  if (!margin) return 1
  const switchNode = child(paraPr, 'hp:switch')
  const caseNode = switchNode ? child(switchNode, 'hp:case') : undefined
  return caseNode && descendants(caseNode, 'hh:margin')[0] === margin ? 1 : 0.5
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

/** 문단 style id → 글자 모양 id(`hh:style`의 `charPrIDRef`). run이 없는 빈 문단의 첫 글자 모양에 쓴다. */
export type ParagraphStyleCharacterIds = Readonly<Record<string, string>>

const isWhitespaceNode = (node: OrderedXmlNode): boolean => node.name === '#text' && /^[ \t\r\n]*$/.test(node.text ?? '')

/**
 * `hp:t`가 없는 빈 문단의 합성 caret 글자 모양. 빈 문단이 아니면 undefined.
 * 편집 코어(`text_patch.ts`의 `emptyParagraphTarget`)와 같은 규칙이다: 문단 자식은 `hp:run`·`hp:linesegarray`·공백,
 * run 자식은 `hp:secPr`·`hp:ctrl`(필드 시작·끝 제외)·공백뿐이어야 하고, 글자는 자식 element가 없는 마지막 run 또는 마지막
 * run에 들어간다. run이 없으면 문단 style의 `charPrIDRef`를 쓰고, style이 없으면 빈 문단으로 보지 않는다.
 */
export function emptyParagraphCaret(
  node: OrderedXmlNode,
  styleCharacterIds: ParagraphStyleCharacterIds
): { charStyleId: string } | undefined {
  if (node.name !== 'hp:p') return undefined
  if (!node.children.every((item) => item.name === 'hp:run' || item.name === 'hp:linesegarray' || isWhitespaceNode(item))) {
    return undefined
  }
  const runs = children(node, 'hp:run')
  const controlsOnly = runs.every((run) => run.children.every((item) =>
    isWhitespaceNode(item) ||
    (EMPTY_PARAGRAPH_RUN_CONTROLS.has(item.name) &&
      !(item.name === 'hp:ctrl' && walkOrderedXml(item.children).some((nested) => EMPTY_PARAGRAPH_BLOCKING_CONTROLS.has(nested.name))))
  ))
  if (!controlsOnly) return undefined
  if (runs.length) {
    const plain = runs.filter((run) => run.children.every((item) => item.name === '#text'))
    const run = plain[plain.length - 1] ?? runs[runs.length - 1]
    return { charStyleId: run.attributes.charPrIDRef ?? '0' }
  }
  const charStyleId = styleCharacterIds[node.attributes.styleIDRef ?? '0']
  return charStyleId === undefined ? undefined : { charStyleId }
}

function decodeParagraph(
  node: OrderedXmlNode,
  id: string,
  sectionPath: string | undefined,
  styleCharacterIds: ParagraphStyleCharacterIds
): ViewerParagraph {
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
      if (item.name === 'hp:tbl') content.push(decodeTable(item, `${id}:tbl${content.length}`, sectionPath, styleCharacterIds))
      if (item.name === 'hp:pic') content.push(decodeImage(item))
      if (item.name === 'hp:tab') content.push({ type: 'text', text: '\t', charStyleId })
      if (item.name === 'hp:lineBreak') content.push({ type: 'text', text: '\n', charStyleId })
    })
  })
  // 빈 문단에는 첫 입력을 받을 빈 text와 합성 anchor를 둔다(`empty_paragraph_anchor.ts`).
  const emptyCaret = sectionPath !== undefined && node.sourceParagraphOrdinal !== undefined
    ? emptyParagraphCaret(node, styleCharacterIds)
    : undefined
  if (emptyCaret) {
    content.push({
      type: 'text',
      text: '',
      charStyleId: emptyCaret.charStyleId,
      sourceAnchor: { sectionPath: sectionPath!, textNodeId: emptyParagraphAnchorId(sectionPath!, node.sourceParagraphOrdinal!) }
    })
  }
  const lineSegments = children(child(node, 'hp:linesegarray') ?? node, 'hp:lineseg')
  const starts = lineSegments.map((segment) => num(segment.attributes.vertpos))
  const ends = lineSegments.map((segment) => num(segment.attributes.vertpos) + num(segment.attributes.vertsize))
  const measuredLayoutHeight = lineSegments.length ? Math.max(...ends) - Math.min(...starts) : 0
  const tableLayoutHeight = content.reduce(
    (maximum, item) => item.type === 'table' ? Math.max(maximum, item.height ?? 0) : maximum,
    0
  )
  const layoutHeight = Math.max(measuredLayoutHeight, tableLayoutHeight)
  const layoutTop = lineSegments.length ? Math.min(...starts) : undefined
  return {
    id,
    paraStyleId: node.attributes.paraPrIDRef ?? '0',
    pageBreak: node.attributes.pageBreak === '1',
    ...(node.attributes.columnBreak === '1' ? { columnBreak: true } : {}),
    layoutTop,
    layoutHeight,
    content
  }
}

function decodeImage(node: OrderedXmlNode): ViewerImage {
  const resource = descendants(node, 'hc:img')[0]
  const size = descendants(node, 'hp:curSz')[0] ?? child(node, 'hp:sz')
  return { type: 'image', resourceId: resource?.attributes.binaryItemIDRef, width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined }
}

function decodeTable(
  node: OrderedXmlNode,
  id: string,
  sectionPath: string | undefined,
  styleCharacterIds: ParagraphStyleCharacterIds
): ViewerTable {
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
              decodeParagraph(p, `${id}:r${actualRow}c${column}:p${index}`, sectionPath, styleCharacterIds)
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

function decodeColumnLayout(
  nodes: OrderedXmlNode[],
  source: string
): { columnLayout?: ViewerColumnLayout; diagnostics: ViewerDiagnostic[] } {
  const findColumnNode = (items: OrderedXmlNode[]): OrderedXmlNode | undefined => {
    for (const item of items) {
      if (item.name === 'hp:header' || item.name === 'hp:footer' || item.name === 'hp:subList') continue
      if (item.name === 'hp:colPr') return item
      const nested = findColumnNode(item.children)
      if (nested) return nested
    }
    return undefined
  }
  const columnNode = findColumnNode(nodes)
  if (!columnNode) return { diagnostics: [] }

  const count = num(columnNode.attributes.colCount)
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
    return {
      diagnostics: [{
        source,
        code: 'HWPX_INVALID_COLUMN_LAYOUT',
        message: `다단 개수(${columnNode.attributes.colCount ?? '없음'})가 유효 범위(1~16)를 벗어나 단일 본문 흐름으로 표시합니다.`
      }]
    }
  }

  const columnLayout: ViewerColumnLayout = {
    type: columnNode.attributes.type ?? 'NEWSPAPER',
    layout: columnNode.attributes.layout ?? 'LEFT',
    count,
    sameSize: columnNode.attributes.sameSz === '1',
    sameGap: num(columnNode.attributes.sameGap),
    columns: children(columnNode, 'hp:col').map((column) => ({
      width: num(column.attributes.width),
      gap: num(column.attributes.gap)
    }))
  }
  const diagnostics: ViewerDiagnostic[] = []
  if (count > 1 && !supportsViewerColumnFlow(columnLayout)) {
    diagnostics.push({
      source,
      code: 'HWPX_MULTI_COLUMN_LAYOUT_FALLBACK',
      message: `다단 ${count}단 속성은 보존했지만 현재 단별 흐름 조판은 지원하지 않아 단일 본문 흐름으로 표시합니다.`
    })
  }
  if (count > 1 && !columnLayout.sameSize && columnLayout.columns.length !== count) {
    diagnostics.push({
      source,
      code: 'HWPX_COLUMN_DEFINITION_INCOMPLETE',
      message: `서로 다른 너비의 다단 정의가 ${count}개 중 ${columnLayout.columns.length}개만 있어 원본 단 너비를 완전히 복원할 수 없습니다.`
    })
  }
  return { columnLayout, diagnostics }
}

function decodeHeaderFooters(
  nodes: OrderedXmlNode[],
  name: 'hp:header' | 'hp:footer',
  sectionIndex: number,
  sectionPath: string,
  styleCharacterIds: ParagraphStyleCharacterIds
): ViewerHeaderFooter[] {
  return walkOrderedXml(nodes).filter((node) => node.name === name).map((node, controlIndex) => {
    const subList = child(node, 'hp:subList')
    const kind = name === 'hp:header' ? 'header' : 'footer'
    return {
      id: node.attributes.id ?? `s${sectionIndex}:${kind}${controlIndex}`,
      applyPageType: node.attributes.applyPageType ?? 'BOTH',
      paragraphs: subList
        ? children(subList, 'hp:p').map((paragraph, index) =>
            decodeParagraph(paragraph, `s${sectionIndex}:${kind}${controlIndex}:p${index}`, sectionPath, styleCharacterIds)
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
    // HwpUnitChar `hp:case` 밖(직접 `hh:margin`, `hp:default`)의 문단 여백·들여쓰기는 HWPUNIT의 2배로 저장된다.
    const marginScale = paragraphMarginScale(style, marginNode)
    const getValue = (name: string) => Math.round(num(child(marginNode ?? style, name)?.attributes.value) * marginScale)
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
      tabPrId: style.attributes.tabPrIDRef,
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
  const styleCharacterIds: Record<string, string> = {}
  all.filter((node) => node.name === 'hh:style').forEach((style) => {
    const { id, charPrIDRef } = style.attributes
    if (id !== undefined && charPrIDRef !== undefined && !(id in styleCharacterIds)) styleCharacterIds[id] = charPrIDRef
  })
  return { fonts, charStyles, paraStyles, cellStyles, styleCharacterIds }
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
  const { styleCharacterIds, ...header } = decodeHeader(await reader.readOrderedXml(index.headerPath))
  const sectionXml = await Promise.all(sectionPaths.map(async (path) => ({ path, nodes: await reader.readOrderedXml(path) })))
  const sectionNodes = sectionXml.flatMap(({ nodes }) => walkOrderedXml(nodes))
  const pagePr = sectionNodes.find((node) => node.name === 'hp:pagePr')
  const margin = pagePr ? child(pagePr, 'hp:margin') : undefined
  const columnResults = sectionXml.map(({ path, nodes }) => decodeColumnLayout(nodes, path))
  const sections = sectionXml.map(({ path, nodes }, position) => {
    const sectionIndex = Number(path.match(/section(\d+)\.xml$/)?.[1] ?? 0)
    const root = nodes.find((node) => node.name === 'hs:sec')
    return {
      id: `section-${sectionIndex}`,
      blocks: root
        ? applyParagraphMarkers(
            children(root, 'hp:p').map((p, index) => decodeParagraph(p, `s${sectionIndex}:p${index}`, path, styleCharacterIds)),
            header.paraStyles
          )
        : [],
      pageNumber: decodePageNumber(nodes),
      columnLayout: columnResults[position].columnLayout,
      headers: decodeHeaderFooters(nodes, 'hp:header', sectionIndex, path, styleCharacterIds).map((control) => ({
        ...control,
        paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
      })),
      footers: decodeHeaderFooters(nodes, 'hp:footer', sectionIndex, path, styleCharacterIds).map((control) => ({
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
    diagnostics: columnResults.flatMap(({ diagnostics }) => diagnostics)
  }
}
