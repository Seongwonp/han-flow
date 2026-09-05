import { ViewerDocument, ViewerParagraph, ViewerTable } from '../../src/core/document/viewer_document'
import {
  listSelectableMergedTableCells,
  reconcileTableCellSelection,
  selectableMergedTableCell
} from '../../src/core/editing/table_cell_selection'

const sectionPath = 'Contents/section0.xml'
const paragraph = (id: string, ordinal: number): ViewerParagraph => ({
  id,
  paraStyleId: '0',
  pageBreak: false,
  layoutHeight: 0,
  content: [{
    type: 'text',
    text: id,
    charStyleId: '0',
    sourceAnchor: { sectionPath, textNodeId: `${sectionPath}#hp:t:${ordinal}` }
  }]
})
const table: ViewerTable = {
  type: 'table',
  id: 'table-0',
  rowCount: 1,
  columnCount: 3,
  repeatHeader: false,
  rows: [{ cells: [
    {
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
      width: 200,
      height: 100,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      sourceCellId: 'table-0:r0c0',
      paragraphs: [paragraph('merged', 0)]
    },
    {
      row: 0,
      column: 2,
      rowSpan: 1,
      columnSpan: 1,
      width: 100,
      height: 100,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      sourceCellId: 'table-0:r0c2',
      paragraphs: [paragraph('plain', 1)]
    }
  ] }]
}
const document: ViewerDocument = {
  page: {
    width: 1000,
    height: 1000,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    headerOffset: 0,
    footerOffset: 0
  },
  fonts: {},
  charStyles: {},
  paraStyles: {},
  cellStyles: {},
  resources: {},
  diagnostics: [],
  sections: [{
    id: 'section-0',
    headers: [],
    footers: [],
    blocks: [{
      id: 'host',
      paraStyleId: '0',
      pageBreak: false,
      layoutHeight: 0,
      content: [table]
    }]
  }]
}

describe('병합 표 cell selection', () => {
  test('읽기 전용 병합 body cell만 안정적인 source target으로 만든다', () => {
    const merged = selectableMergedTableCell(table, table.rows[0].cells[0])
    expect(merged).toEqual({
      sectionPath,
      textNodeId: `${sectionPath}#hp:t:0`,
      tableId: 'table-0',
      sourceCellId: 'table-0:r0c0',
      row: 0,
      column: 0
    })
    expect(selectableMergedTableCell(table, table.rows[0].cells[1])).toBeUndefined()
    expect(listSelectableMergedTableCells(document)).toEqual([merged])
  })

  test('같은 projection은 유지하고 span·문서가 바뀌면 stale selection을 해제한다', () => {
    const selection = listSelectableMergedTableCells(document)[0]
    expect(reconcileTableCellSelection(document, selection)).toEqual({
      status: 'CURRENT',
      selection
    })
    const unmerged: ViewerDocument = JSON.parse(JSON.stringify(document))
    const unmergedTable = unmerged.sections[0].blocks[0].content[0]
    if (unmergedTable.type !== 'table') throw new Error('표 fixture가 없습니다.')
    unmergedTable.rows[0].cells[0].columnSpan = 1
    expect(reconcileTableCellSelection(unmerged, selection)).toEqual({ status: 'CLEARED' })
    expect(reconcileTableCellSelection(null, selection)).toEqual({ status: 'CLEARED' })
  })

  test('머리글·rowSpan·continuation과 anchor 없는 cell은 선택하지 않는다', () => {
    const base = table.rows[0].cells[0]
    expect(selectableMergedTableCell(table, { ...base, header: true })).toBeUndefined()
    expect(selectableMergedTableCell(table, { ...base, rowSpan: 2 })).toBeUndefined()
    expect(selectableMergedTableCell(table, { ...base, splitTop: true })).toBeUndefined()
    expect(selectableMergedTableCell(table, {
      ...base,
      paragraphs: [{ ...base.paragraphs[0], content: [] }]
    })).toBeUndefined()
  })
})
