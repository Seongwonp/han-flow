const DEFAULT_PAGE = {
  width: 59528,
  height: 84188,
  margin: { top: 5669, right: 5669, bottom: 5669, left: 5669 },
  headerOffset: 0,
  footerOffset: 0
}
const DEFAULT_CHAR_STYLE_ID = 'kordoc-char-default'
const DEFAULT_PARA_STYLE_ID = 'kordoc-para-default'
const DEFAULT_CELL_STYLE_ID = 'kordoc-cell-default'
const ZERO_SPACING = { top: 0, right: 0, bottom: 0, left: 0 }
const EMPTY_BORDER = { type: 'NONE', widthMm: 0, color: '#000000' }

function textCharacters(value) {
  return typeof value === 'string' ? value.replace(/\s/gu, '').length : 0
}

function styleKey(style = {}) {
  return JSON.stringify({
    bold: Boolean(style.bold),
    fontName: style.fontName ?? null,
    fontSize: style.fontSize ?? null
  })
}

function hwpUnitFontHeight(fontSize) {
  return Number.isFinite(fontSize) && fontSize > 0 ? Math.round(fontSize * 100) : 1000
}

function createAdapterState() {
  return {
    paragraphIndex: 0,
    tableIndex: 0,
    resourceIndex: 0,
    resourceIds: new Map(),
    charStyleIndex: 0,
    charStyleIds: new Map(),
    diagnostics: new Set(),
    fonts: {},
    charStyles: {
      [DEFAULT_CHAR_STYLE_ID]: {
        id: DEFAULT_CHAR_STYLE_ID,
        height: 1000,
        color: '#000000',
        bold: false
      }
    },
    resources: {}
  }
}

function resolveCharStyle(state, style = {}) {
  const key = styleKey(style)
  if (key === styleKey()) return DEFAULT_CHAR_STYLE_ID
  const known = state.charStyleIds.get(key)
  if (known) return known

  const id = `kordoc-char-${++state.charStyleIndex}`
  const fontId = style.fontName ? `kordoc-font-${state.charStyleIndex}` : undefined
  if (fontId) state.fonts[fontId] = style.fontName
  state.charStyles[id] = {
    id,
    height: hwpUnitFontHeight(style.fontSize),
    color: '#000000',
    bold: Boolean(style.bold),
    fontId,
    fontFamily: style.fontName
  }
  state.charStyleIds.set(key, id)
  return id
}

function textContent(block, state) {
  if (block.spans?.length) {
    return block.spans.map((span) => ({
      type: 'text',
      text: span.text ?? '',
      charStyleId: resolveCharStyle(state, { ...block.style, ...span })
    }))
  }
  return [{
    type: 'text',
    text: block.text ?? '',
    charStyleId: resolveCharStyle(state, block.style)
  }]
}

function imageContent(block, state) {
  if (!block.imageData?.data || !block.imageData?.mimeType) {
    state.diagnostics.add('이미지 block에 binary 또는 MIME 정보가 없어 placeholder로 남겼습니다.')
    return { type: 'image' }
  }

  const data = Buffer.from(block.imageData.data)
  const resourceKey = `${block.imageData.mimeType}:${createHash('sha256').update(data).digest('hex')}`
  const knownResourceId = state.resourceIds.get(resourceKey)
  if (knownResourceId) return { type: 'image', resourceId: knownResourceId }

  const resourceId = `kordoc-resource-${++state.resourceIndex}`
  state.resources[resourceId] = {
    id: resourceId,
    path: block.imageData.filename ?? resourceId,
    mime: block.imageData.mimeType,
    data: data.toString('base64')
  }
  state.resourceIds.set(resourceKey, resourceId)
  return { type: 'image', resourceId }
}

function paragraphFromContent(content, state, block = {}) {
  const id = `kordoc-paragraph-${++state.paragraphIndex}`
  return {
    id,
    paraStyleId: DEFAULT_PARA_STYLE_ID,
    pageBreak: false,
    layoutHeight: 0,
    marker: block.type === 'list' && block.listType === 'unordered' ? '•' : undefined,
    content
  }
}

function tableOriginCells(table) {
  const occupied = new Set()
  const origins = []

  for (let row = 0; row < table.rows; row += 1) {
    for (let column = 0; column < table.cols; column += 1) {
      const cell = table.cells?.[row]?.[column]
      if (!cell || occupied.has(`${row}:${column}`)) continue

      const rowSpan = Math.max(1, cell.rowSpan ?? 1)
      const columnSpan = Math.max(1, cell.colSpan ?? 1)
      origins.push({ row, column, rowSpan, columnSpan, cell })
      for (let coveredRow = row; coveredRow < Math.min(table.rows, row + rowSpan); coveredRow += 1) {
        for (
          let coveredColumn = column;
          coveredColumn < Math.min(table.cols, column + columnSpan);
          coveredColumn += 1
        ) {
          if (coveredRow !== row || coveredColumn !== column) {
            occupied.add(`${coveredRow}:${coveredColumn}`)
          }
        }
      }
    }
  }
  return origins
}

function blocksToParagraphs(blocks, state) {
  return (blocks ?? []).flatMap((block) => blockToParagraphs(block, state))
}

function cellParagraphs(cell, state) {
  if (cell.blocks?.length) return blocksToParagraphs(cell.blocks, state)
  return [paragraphFromContent(textContent({ type: 'paragraph', text: cell.text ?? '' }, state), state)]
}

function tableContent(block, state) {
  const source = block.table
  const tableId = `kordoc-table-${++state.tableIndex}`
  const contentWidth = DEFAULT_PAGE.width - DEFAULT_PAGE.margin.left - DEFAULT_PAGE.margin.right
  const columnWidth = source.cols > 0 ? Math.floor(contentWidth / source.cols) : contentWidth
  const rows = Array.from({ length: source.rows }, () => ({ cells: [] }))

  for (const origin of tableOriginCells(source)) {
    rows[origin.row].cells.push({
      row: origin.row,
      column: origin.column,
      rowSpan: origin.rowSpan,
      columnSpan: origin.columnSpan,
      width: columnWidth * origin.columnSpan,
      height: 0,
      margin: { ...ZERO_SPACING },
      borderFillId: DEFAULT_CELL_STYLE_ID,
      header: Boolean(origin.cell.isHeader),
      paragraphs: cellParagraphs(origin.cell, state)
    })
  }

  return {
    type: 'table',
    id: tableId,
    rowCount: source.rows,
    columnCount: source.cols,
    width: contentWidth,
    height: 0,
    repeatHeader: Boolean(source.hasHeader),
    rows
  }
}

function blockToParagraphs(block, state) {
  if (block.type === 'table' && block.table) {
    return [paragraphFromContent([tableContent(block, state)], state, block)]
  }
  if (block.type === 'image') {
    return [paragraphFromContent([imageContent(block, state)], state, block)]
  }

  const paragraph = paragraphFromContent(textContent(block, state), state, block)
  return [paragraph, ...blocksToParagraphs(block.children, state)]
}

function sectionNumber(block) {
  return Number.isInteger(block.pageNumber) && block.pageNumber > 0 ? block.pageNumber : 1
}

export function buildKordocViewerDocument(blocks) {
  const state = createAdapterState()
  const grouped = new Map()
  for (const block of blocks ?? []) {
    const number = sectionNumber(block)
    if (!grouped.has(number)) grouped.set(number, [])
    grouped.get(number).push(block)
    if (!Number.isInteger(block.pageNumber) || block.pageNumber < 1) {
      state.diagnostics.add('section tag가 없는 top-level block을 첫 구역으로 보냈습니다.')
    }
  }

  const sections = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([number, sectionBlocks]) => ({
      id: `kordoc-section-${number}`,
      blocks: blocksToParagraphs(sectionBlocks, state),
      headers: [],
      footers: []
    }))

  state.diagnostics.add('Kordoc IR에 용지·여백 정보가 없어 A4 placeholder를 사용했습니다.')
  state.diagnostics.add('문단 정렬·간격과 표 크기·테두리·배경 정보는 Kordoc IR에서 복원할 수 없습니다.')
  state.diagnostics.add('머리말·꼬리말·쪽 번호 정보는 Kordoc IR에서 복원할 수 없습니다.')

  return {
    page: DEFAULT_PAGE,
    fonts: state.fonts,
    charStyles: state.charStyles,
    paraStyles: {
      [DEFAULT_PARA_STYLE_ID]: {
        id: DEFAULT_PARA_STYLE_ID,
        margin: { ...ZERO_SPACING }
      }
    },
    cellStyles: {
      [DEFAULT_CELL_STYLE_ID]: {
        id: DEFAULT_CELL_STYLE_ID,
        left: { ...EMPTY_BORDER },
        right: { ...EMPTY_BORDER },
        top: { ...EMPTY_BORDER },
        bottom: { ...EMPTY_BORDER }
      }
    },
    resources: state.resources,
    sections,
    diagnostics: [...state.diagnostics].map((message) => ({
      source: 'kordoc-viewer-adapter-probe',
      message
    }))
  }
}

export function summarizeKordocViewerDocument(document) {
  const summary = {
    sections: document.sections.length,
    paragraphs: 0,
    tables: 0,
    cells: 0,
    images: 0,
    resources: Object.keys(document.resources).length,
    textCharacters: 0,
    diagnostics: document.diagnostics.length
  }

  const visitParagraph = (paragraph) => {
    summary.paragraphs += 1
    for (const content of paragraph.content) {
      if (content.type === 'text') {
        summary.textCharacters += textCharacters(content.text)
      } else if (content.type === 'image') {
        summary.images += 1
      } else if (content.type === 'table') {
        summary.tables += 1
        for (const row of content.rows) {
          for (const cell of row.cells) {
            summary.cells += 1
            cell.paragraphs.forEach(visitParagraph)
          }
        }
      }
    }
  }

  document.sections.forEach((section) => section.blocks.forEach(visitParagraph))
  return summary
}

export function adapterCapability(blocks, document) {
  const topLevel = blocks?.length ?? 0
  const tagged = (blocks ?? []).filter((block) => Number.isInteger(block.pageNumber) && block.pageNumber > 0).length
  return {
    status: 'semantic-only',
    sectionTagCoverage: topLevel > 0 ? tagged / topLevel : 1,
    pageGeometry: false,
    paragraphGeometry: false,
    tableGeometry: false,
    borderAndFill: false,
    headerFooterAndPageNumber: false,
    structure: summarizeKordocViewerDocument(document)
  }
}

export { tableOriginCells }
import { createHash } from 'node:crypto'
