import { ViewerContent, ViewerDocument, ViewerParagraph, ViewerTable, ViewerTableCell, ViewerText } from '../document/viewer_document'

export interface TableCellSelection {
  sectionPath: string
  textNodeId: string
  tableId: string
  sourceCellId: string
  row: number
  column: number
}

export type TableCellSelectionProjectionStatus = 'CURRENT' | 'CLEARED'

export interface TableCellSelectionProjection {
  selection?: TableCellSelection
  status: TableCellSelectionProjectionStatus
}

function firstAnchoredText(paragraphs: readonly ViewerParagraph[]): ViewerText | undefined {
  return paragraphs.flatMap((paragraph) => paragraph.content).find(
    (item): item is ViewerText => item.type === 'text' && Boolean(item.sourceAnchor)
  )
}

export function selectableMergedTableCell(
  table: ViewerTable,
  cell: ViewerTableCell
): TableCellSelection | undefined {
  const text = firstAnchoredText(cell.paragraphs)
  if (
    !cell.sourceCellId ||
    !text?.sourceAnchor ||
    cell.header ||
    cell.splitTop ||
    cell.splitBottom ||
    cell.rowSpan !== 1 ||
    cell.columnSpan <= 1
  ) return undefined
  return {
    sectionPath: text.sourceAnchor.sectionPath,
    textNodeId: text.sourceAnchor.textNodeId,
    tableId: table.id,
    sourceCellId: cell.sourceCellId,
    row: cell.row,
    column: cell.column
  }
}

function collectTableSelections(content: readonly ViewerContent[]): TableCellSelection[] {
  const selections: TableCellSelection[] = []
  for (const item of content) {
    if (item.type !== 'table') continue
    for (const row of item.rows) {
      for (const cell of row.cells) {
        const selection = selectableMergedTableCell(item, cell)
        if (selection) selections.push(selection)
        for (const paragraph of cell.paragraphs) {
          selections.push(...collectTableSelections(paragraph.content))
        }
      }
    }
  }
  return selections
}

export function listSelectableMergedTableCells(document: ViewerDocument): TableCellSelection[] {
  return document.sections.flatMap((section) => section.blocks.flatMap(
    (paragraph) => collectTableSelections(paragraph.content)
  ))
}

export function equalTableCellSelections(
  left: TableCellSelection | undefined,
  right: TableCellSelection | undefined
): boolean {
  return Boolean(
    left &&
    right &&
    left.sectionPath === right.sectionPath &&
    left.textNodeId === right.textNodeId &&
    left.tableId === right.tableId &&
    left.sourceCellId === right.sourceCellId &&
    left.row === right.row &&
    left.column === right.column
  )
}

export function reconcileTableCellSelection(
  document: ViewerDocument | null | undefined,
  selection: TableCellSelection | undefined
): TableCellSelectionProjection {
  if (!document || !selection) return { status: 'CLEARED' }
  const current = listSelectableMergedTableCells(document).find(
    (candidate) => equalTableCellSelections(candidate, selection)
  )
  return current
    ? { status: 'CURRENT', selection: current }
    : { status: 'CLEARED' }
}
