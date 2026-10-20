import { ViewerParagraph, ViewerTable, ViewerTableCell, ViewerTableRow } from '../document/viewer_document'

export type ParagraphHeights = Readonly<Record<string, number>>

export interface CellParagraphSplit {
  head: ViewerParagraph[]
  tail: ViewerParagraph[]
  headHeight: number
  tailHeight: number
}

export interface SplittableCellResult extends CellParagraphSplit {
  cellIndex: number
}

function paragraphHeight(paragraph: ViewerParagraph, heights: ParagraphHeights): number {
  const measured = heights[paragraph.id]
  const value = Number.isFinite(measured) ? measured : paragraph.layoutHeight
  return Math.max(Number.isFinite(value) ? value : 0, 0)
}

export function cellContentHeight(cell: ViewerTableCell, heights: ParagraphHeights): number {
  return cell.paragraphs.reduce((sum, paragraph) => sum + paragraphHeight(paragraph, heights), 0)
}

export function cellOccupiedHeight(cell: ViewerTableCell, heights: ParagraphHeights): number {
  return (cell.splitTop ? 0 : cell.margin.top) +
    cellContentHeight(cell, heights) +
    (cell.splitBottom ? 0 : cell.margin.bottom)
}

export function splitCellParagraphs(cell: ViewerTableCell, capacity: number, heights: ParagraphHeights): CellParagraphSplit | undefined {
  const top = cell.splitTop ? 0 : cell.margin.top
  const bottom = cell.splitBottom ? 0 : cell.margin.bottom
  if (!Number.isFinite(capacity) || capacity <= top || cell.paragraphs.length < 2) return undefined
  const contentCapacity = capacity - top
  const head: ViewerParagraph[] = []
  let used = 0

  for (const paragraph of cell.paragraphs) {
    const height = paragraphHeight(paragraph, heights)
    if (head.length && used + height > contentCapacity) break
    if (!head.length && height > contentCapacity) return undefined
    head.push(paragraph)
    used += height
  }

  if (head.length === cell.paragraphs.length) return undefined
  const tail = cell.paragraphs.slice(head.length)
  return {
    head,
    tail,
    headHeight: top + used,
    tailHeight: tail.reduce((sum, paragraph) => sum + paragraphHeight(paragraph, heights), 0) + bottom
  }
}

export function findSplittableCell(row: ViewerTableRow, capacity: number, heights: ParagraphHeights, coveredByRowSpan = false): SplittableCellResult | undefined {
  if (coveredByRowSpan || row.cells.some((cell) => cell.rowSpan > 1)) return undefined
  const overflowing = row.cells
    .map((cell, cellIndex) => ({ cell, cellIndex, height: cellOccupiedHeight(cell, heights) }))
    .filter(({ height }) => height > capacity)
  if (overflowing.length !== 1) return undefined
  const [{ cell, cellIndex }] = overflowing
  const split = splitCellParagraphs(cell, capacity, heights)
  return split ? { cellIndex, ...split } : undefined
}

export function tableSupportsCellSplitting(table: ViewerTable): boolean {
  return table.rows.every((row) => row.cells.every((cell) => cell.rowSpan === 1))
}

export function preservesParagraphOrder(original: readonly ViewerParagraph[], split: CellParagraphSplit): boolean {
  const combined = [...split.head, ...split.tail]
  return combined.length === original.length && combined.every((paragraph, index) => paragraph === original[index])
}

/**
 * 셀을 그릴 때 쓰는 최소 높이(HWPUNIT, 셀 안쪽 여백·테두리 포함). 한/글처럼 선언 높이(`hp:cellSz height`)보다 내용이 짧으면 선언
 * 높이로 그리고 길면 내용만큼 늘어난다. 쪽을 넘어 나뉜 조각 셀(`splitTop`·`splitBottom`)은 내용 높이만 쓴다(`fragmentHeight`).
 * 한 쪽 본문보다 높은 선언 높이는 쪽 본문 높이(`limit`)로 줄인다. 내용이 짧은 행이 한 쪽보다 높아 넘치지 않게 하려는 것이다.
 */
/**
 * 쪽 본문보다 높게 선언한 셀을 줄일 때 쪽 본문(되풀이 머리글 뺀 높이)에 곱하는 비율. 줄인 행과 함께 같은 쪽에 놓이는 표 테두리와
 * 표만 든 문단의 표 아래 줄 간격이 쪽 아래로 넘치지 않게 조금 남긴다.
 */
export const CELL_HEIGHT_PAGE_RATIO = 0.9

/**
 * 셀 최소 높이 한도: 쪽 본문 높이에서 쪽마다 되풀이되는 머리글 행(`repeatHeader`)의 선언 높이를 뺀 값의 `CELL_HEIGHT_PAGE_RATIO`.
 * 되풀이 머리글과 줄인 행이 함께 다음 쪽에 놓여도 넘치지 않게 한다.
 */
export function cellHeightLimit(table: Pick<ViewerTable, 'repeatHeader' | 'rows'>, pageBodyHeight: number | undefined): number | undefined {
  if (pageBodyHeight === undefined) return undefined
  const header = table.repeatHeader
    ? table.rows.filter((row) => row.cells.some((cell) => cell.header)).reduce((sum, row) => sum + Math.max(...row.cells.map((cell) => cell.height), 0), 0)
    : 0
  const available = header > 0 && header < pageBodyHeight ? pageBodyHeight - header : pageBodyHeight
  return Math.floor(available * CELL_HEIGHT_PAGE_RATIO)
}

export function cellMinimumHeight(cell: Pick<ViewerTableCell, 'height' | 'splitTop' | 'splitBottom'>, limit?: number): number | undefined {
  if (cell.splitTop || cell.splitBottom || !(cell.height > 0)) return undefined
  return limit !== undefined && limit > 0 ? Math.min(cell.height, limit) : cell.height
}
