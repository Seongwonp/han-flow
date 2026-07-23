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
