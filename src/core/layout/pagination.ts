import { supportsViewerColumnFlow, ViewerColumnLayout, ViewerDocument, ViewerParagraph, ViewerSection, ViewerTable, ViewerTableRow } from '../document/viewer_document'
import { cellOccupiedHeight, findSplittableCell, ParagraphHeights, tableSupportsCellSplitting } from './cell_fragment'

export interface ViewerPage {
  blocks: ViewerParagraph[]
  columns?: ViewerParagraph[][]
  columnLayout?: ViewerColumnLayout
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

/** @internal section pagination 동치 test가 이전 문서 단위 pagination을 재현할 때 쓴다. */
export function fragmentTableBlock(block: ViewerParagraph, firstCapacity: number, pageCapacity: number, measurements?: LayoutMeasurements): ViewerParagraph[] {
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
  const availableHeight = pageBodyHeight(document)
  return document.sections.flatMap((section, sectionIndex) =>
    paginateViewerSection(section, sectionIndex, availableHeight, measurements)
  )
}

/** pagination이 쓰는 쪽 본문 높이(HWPUNIT). */
export function pageBodyHeight(document: Pick<ViewerDocument, 'page'>): number {
  return document.page.height - document.page.margin.top - document.page.margin.bottom
}

/**
 * section 하나를 쪽으로 나눈다. section은 언제나 새 쪽에서 시작하고(앞 section의 남은 쪽을 먼저 내보낸다) 다단 상태·
 * 원본 줄 배치 위치도 section마다 처음부터 센다. 그래서 문서 pagination은 section별 결과를 이어 붙인 것과 같고,
 * 편집으로 section 하나만 바뀌면 그 section만 다시 나누면 된다(`paginateViewerSectionsIncremental`).
 */
export function paginateViewerSection(
  section: ViewerSection,
  sectionIndex: number,
  availableHeight: number,
  measurements?: LayoutMeasurements
): ViewerPage[] {
  const pages: ViewerPage[] = []
  const activeColumnLayout = supportsViewerColumnFlow(section.columnLayout) ? section.columnLayout : undefined
  const columnCount = activeColumnLayout?.count ?? 1
  let currentColumns: ViewerParagraph[][] = [[]]
  let columnIndex = 0
  let usedHeight = 0
  let sectionPageIndex = 0
  let previousLayoutTop: number | undefined
  let previousBlockFragmented = false
  const currentColumn = () => currentColumns[columnIndex]
  const resetPage = () => {
    currentColumns = Array.from({ length: columnCount }, () => [])
    columnIndex = 0
    usedHeight = 0
  }
  const flush = () => {
    const blocks = currentColumns.flat()
    if (blocks.length) {
      pages.push({
        blocks,
        ...(activeColumnLayout ? {
          columns: currentColumns.map((column) => [...column]),
          columnLayout: activeColumnLayout
        } : {}),
        sectionIndex,
        sectionPageIndex
      })
      sectionPageIndex += 1
    }
    resetPage()
  }
  const advanceFlow = () => {
    if (columnIndex + 1 < columnCount) {
      columnIndex += 1
      usedHeight = 0
    } else {
      flush()
    }
    previousLayoutTop = undefined
  }

  resetPage()
  section.blocks.forEach((originalBlock) => {
    const sourceFlowRestart = Boolean(measurements && !previousBlockFragmented && currentColumn().length && originalBlock.layoutTop !== undefined && previousLayoutTop !== undefined && originalBlock.layoutTop < previousLayoutTop)
    if (originalBlock.pageBreak) flush()
    else if ((originalBlock.columnBreak || sourceFlowRestart) && activeColumnLayout) advanceFlow()
    else if (sourceFlowRestart) flush()
    const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight, availableHeight, measurements)
    fragments.forEach((block, fragmentIndex) => {
      const measuredHeight = measurements?.blockHeights[block.id]
      const height = measuredHeight ?? block.layoutHeight
      if (fragmentIndex > 0 || (currentColumn().length && height > 0 && usedHeight + height > availableHeight)) advanceFlow()
      currentColumn().push(block)
      usedHeight += height
    })
    previousBlockFragmented = fragments.length > 1
    if (originalBlock.layoutTop !== undefined) previousLayoutTop = originalBlock.layoutTop
  })
  flush()
  return pages
}

/** section 하나의 pagination 결과와 그 입력. 입력 object가 모두 같으면 다음 pagination에서 그대로 쓴다. */
export interface SectionPagination {
  section: ViewerSection
  sectionIndex: number
  availableHeight: number
  measurements?: LayoutMeasurements
  pages: ViewerPage[]
}

/**
 * section별 측정값으로 문서를 나누되, 앞 결과(`previous`)에서 section·위치·쪽 높이·측정 object가 모두 같은 section은 다시
 * 나누지 않고 쪽 object를 그대로 쓴다. 결과는 같은 입력의 `paginateViewerSection`을 이어 붙인 것과 같다.
 */
export function paginateViewerSectionsIncremental(
  document: Pick<ViewerDocument, 'page' | 'sections'>,
  measurementsOf: (sectionIndex: number) => LayoutMeasurements | undefined,
  previous: readonly SectionPagination[] = []
): { pages: ViewerPage[]; sections: SectionPagination[]; reused: number } {
  const availableHeight = pageBodyHeight(document)
  let reused = 0
  const sections = document.sections.map((section, sectionIndex): SectionPagination => {
    const measurements = measurementsOf(sectionIndex)
    const cached = previous[sectionIndex]
    if (
      cached &&
      cached.section === section &&
      cached.sectionIndex === sectionIndex &&
      cached.availableHeight === availableHeight &&
      cached.measurements === measurements
    ) {
      reused += 1
      return cached
    }
    return {
      section,
      sectionIndex,
      availableHeight,
      measurements,
      pages: paginateViewerSection(section, sectionIndex, availableHeight, measurements)
    }
  })
  return { pages: sections.flatMap((section) => section.pages), sections, reused }
}
