import { ViewerDocument, ViewerParagraph, ViewerTable, ViewerTableRow } from '../document/viewer_document'
import { cellOccupiedHeight, findSplittableCell, ParagraphHeights, tableSupportsCellSplitting } from './cell_fragment'

export interface ViewerPage {
  blocks: ViewerParagraph[]
  sectionIndex: number
  sectionPageIndex: number
}

export interface LayoutMeasurements {
  blockHeights: Record<string, number>
  tableRowHeights: Record<string, number>
}

function declaredRowHeight(row: ViewerTableRow): number {
  return Math.max(...row.cells.map((cell) => Math.max(
    cell.height,
    cell.paragraphs.reduce((sum, paragraph) => sum + paragraph.layoutHeight, 0)
  )), 0)
}

function rowHeight(table: ViewerTable, row: ViewerTableRow, rowIndex: number, measurements?: LayoutMeasurements): number {
  if (row.fragmentHeight !== undefined && Number.isFinite(row.fragmentHeight)) return Math.max(row.fragmentHeight, 0)
  const sourceRow = row.cells[0]?.row ?? rowIndex
  return measurements?.tableRowHeights[`${table.id}:r${sourceRow}`] ?? declaredRowHeight(row)
}

function tableOf(block: ViewerParagraph): ViewerTable | undefined {
  return block.content.find((content): content is ViewerTable => content.type === 'table')
}

function splitRow(row: ViewerTableRow, cellIndex: number, headParagraphs: ViewerParagraph[], tailParagraphs: ViewerParagraph[], heights: ParagraphHeights): [ViewerTableRow, ViewerTableRow] {
  const headCells = row.cells.map((cell, index) => ({
    ...cell,
    paragraphs: index === cellIndex ? headParagraphs : cell.paragraphs,
    splitBottom: true
  }))
  const tailCells = row.cells.map((cell, index) => ({
    ...cell,
    paragraphs: index === cellIndex ? tailParagraphs : [],
    splitTop: true
  }))
  return [
    { cells: headCells, fragmentHeight: Math.max(...headCells.map((cell) => cellOccupiedHeight(cell, heights)), 0) },
    { cells: tailCells, fragmentHeight: Math.max(...tailCells.map((cell) => cellOccupiedHeight(cell, heights)), 0) }
  ]
}

function fragmentTableBlock(block: ViewerParagraph, firstCapacity: number, pageCapacity: number, measurements?: LayoutMeasurements): ViewerParagraph[] {
  const table = tableOf(block)
  if (!table || table.pageBreak !== 'CELL' || table.rows.length < 2) return [block]
  const heights = table.rows.map((row, index) => rowHeight(table, row, index, measurements))
  const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  const naturalBreakIndex = heights.findIndex((height, index) =>
    index > 0 &&
    heights[index - 1] > pageCapacity * 0.25 &&
    heights.slice(index).reduce((sum, value) => sum + value, 0) > pageCapacity * 0.25 &&
    height < heights[index - 1] * 0.5
  )
  if (measurements ? totalHeight <= firstCapacity : naturalBreakIndex < 0 && totalHeight <= pageCapacity) return [block]

  const fragments: ViewerParagraph[] = []
  const headerRows = table.repeatHeader ? table.rows.filter((row) => row.cells.some((cell) => cell.header)) : []
  const bodyRows = table.rows.filter((row) => !headerRows.includes(row))
  const allowsCellSplitting = Boolean(measurements && tableSupportsCellSplitting(table))
  let currentRows: ViewerTableRow[] = [...headerRows]
  let used = headerRows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
  let capacity = firstCapacity

  const flush = () => {
    if (!currentRows.length) return
    const fragmentIndex = fragments.length
    const rows = fragmentIndex > 0 ? [...headerRows, ...currentRows] : currentRows
    const fragmentHeight = rows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
    const fragmentTable: ViewerTable = { ...table, id: `${table.id}:fragment${fragmentIndex}`, rows, rowCount: rows.length, height: fragmentHeight }
    fragments.push({ ...block, id: `${block.id}:fragment${fragmentIndex}`, pageBreak: fragmentIndex > 0, layoutHeight: fragmentTable.height ?? 0, content: block.content.map((content) => content === table ? fragmentTable : content) })
    currentRows = []
    used = headerRows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
    capacity = pageCapacity
  }

  bodyRows.forEach((sourceRow, rowIndex) => {
    if (!measurements && rowIndex === naturalBreakIndex && currentRows.length) flush()
    let row = sourceRow
    while (true) {
      const height = rowHeight(table, row, table.rows.indexOf(sourceRow), measurements)
      if (used + height <= capacity) {
        currentRows.push(row)
        used += height
        break
      }

      const remaining = capacity - used
      const split = allowsCellSplitting && remaining > 0
        ? findSplittableCell(row, remaining, measurements!.blockHeights)
        : undefined
      if (split) {
        const [head, tail] = splitRow(row, split.cellIndex, split.head, split.tail, measurements!.blockHeights)
        currentRows.push(head)
        used += head.fragmentHeight ?? 0
        flush()
        row = tail
        continue
      }

      if (currentRows.length) {
        flush()
        continue
      }
      currentRows.push(row)
      used += height
      break
    }
  })
  flush()
  return fragments.length > 1 ? fragments : [block]
}

export function paginateDocument(document: ViewerDocument): ViewerParagraph[][] {
  return paginateViewerDocument(document).map((page) => page.blocks)
}

export function paginateViewerDocument(document: ViewerDocument, measurements?: LayoutMeasurements): ViewerPage[] {
  const pages: ViewerPage[] = []
  const availableHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
  let current: ViewerParagraph[] = []
  let usedHeight = 0
  let currentSectionIndex = 0
  let sectionPageIndex = 0
  let previousLayoutTop: number | undefined
  let previousBlockFragmented = false
  const flush = () => {
    if (current.length) {
      pages.push({ blocks: current, sectionIndex: currentSectionIndex, sectionPageIndex })
      sectionPageIndex += 1
    }
    current = []
    usedHeight = 0
  }

  document.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) flush()
    currentSectionIndex = sectionIndex
    sectionPageIndex = 0
    previousLayoutTop = undefined
    previousBlockFragmented = false
    section.blocks.forEach((originalBlock) => {
      const sourcePageRestart = Boolean(measurements && !previousBlockFragmented && current.length && originalBlock.layoutTop !== undefined && previousLayoutTop !== undefined && originalBlock.layoutTop < previousLayoutTop)
      if (originalBlock.pageBreak || sourcePageRestart) flush()
      const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight, availableHeight, measurements)
      fragments.forEach((block, fragmentIndex) => {
        const measuredHeight = measurements?.blockHeights[block.id]
        const height = measuredHeight ?? block.layoutHeight
        if (fragmentIndex > 0 || (current.length && height > 0 && usedHeight + height > availableHeight)) flush()
        current.push(block)
        usedHeight += height
      })
      previousBlockFragmented = fragments.length > 1
      if (originalBlock.layoutTop !== undefined) previousLayoutTop = originalBlock.layoutTop
    })
  })
  flush()
  return pages
}
