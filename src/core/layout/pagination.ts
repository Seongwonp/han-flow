import { ViewerDocument, ViewerParagraph, ViewerTable, ViewerTableRow } from '../document/viewer_document'

export interface ViewerPage {
  blocks: ViewerParagraph[]
  sectionIndex: number
  sectionPageIndex: number
}

function rowHeight(row: ViewerTableRow): number {
  return Math.max(...row.cells.map((cell) => Math.max(
    cell.height,
    cell.paragraphs.reduce((sum, paragraph) => sum + paragraph.layoutHeight, 0)
  )), 0)
}

function tableOf(block: ViewerParagraph): ViewerTable | undefined {
  return block.content.find((content): content is ViewerTable => content.type === 'table')
}

function fragmentTableBlock(block: ViewerParagraph, firstCapacity: number, pageCapacity: number): ViewerParagraph[] {
  const table = tableOf(block)
  if (!table || table.pageBreak !== 'CELL' || table.rows.length < 2) return [block]
  const heights = table.rows.map(rowHeight)
  const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  const naturalBreakIndex = heights.findIndex((height, index) =>
    index > 0 &&
    heights[index - 1] > pageCapacity * 0.25 &&
    heights.slice(index).reduce((sum, value) => sum + value, 0) > pageCapacity * 0.25 &&
    height < heights[index - 1] * 0.5
  )
  if (naturalBreakIndex < 0 && totalHeight <= pageCapacity) return [block]

  const fragments: ViewerParagraph[] = []
  const headerRows = table.repeatHeader ? table.rows.filter((row) => row.cells.some((cell) => cell.header)) : []
  const bodyRows = table.rows.filter((row) => !headerRows.includes(row))
  let currentRows: ViewerTableRow[] = [...headerRows]
  let used = headerRows.reduce((sum, row) => sum + rowHeight(row), 0)
  let capacity = firstCapacity

  const flush = () => {
    if (!currentRows.length) return
    const fragmentIndex = fragments.length
    const rows = fragmentIndex > 0 ? [...headerRows, ...currentRows] : currentRows
    const fragmentTable: ViewerTable = { ...table, id: `${table.id}:fragment${fragmentIndex}`, rows, rowCount: rows.length, height: rows.reduce((sum, row) => sum + rowHeight(row), 0) }
    fragments.push({ ...block, id: `${block.id}:fragment${fragmentIndex}`, pageBreak: fragmentIndex > 0, layoutHeight: fragmentTable.height ?? 0, content: block.content.map((content) => content === table ? fragmentTable : content) })
    currentRows = []
    used = headerRows.reduce((sum, row) => sum + rowHeight(row), 0)
    capacity = pageCapacity
  }

  bodyRows.forEach((row, rowIndex) => {
    if (rowIndex === naturalBreakIndex && currentRows.length) flush()
    const height = rowHeight(row)
    if (currentRows.length && used + height > capacity) flush()
    currentRows.push(row)
    used += height
  })
  flush()
  return fragments.length > 1 ? fragments : [block]
}

export function paginateDocument(document: ViewerDocument): ViewerParagraph[][] {
  return paginateViewerDocument(document).map((page) => page.blocks)
}

export function paginateViewerDocument(document: ViewerDocument): ViewerPage[] {
  const pages: ViewerPage[] = []
  const availableHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
  let current: ViewerParagraph[] = []
  let usedHeight = 0
  let currentSectionIndex = 0
  let sectionPageIndex = 0
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
    section.blocks.forEach((originalBlock) => {
      if (originalBlock.pageBreak) flush()
      const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight, availableHeight)
      fragments.forEach((block, fragmentIndex) => {
        if (fragmentIndex > 0 || (current.length && block.layoutHeight > 0 && usedHeight + block.layoutHeight > availableHeight)) flush()
        current.push(block)
        usedHeight += block.layoutHeight
      })
    })
  })
  flush()
  return pages
}
