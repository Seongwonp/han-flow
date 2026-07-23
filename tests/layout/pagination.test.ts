import { existsSync } from 'fs'
import { resolve } from 'path'
import { paginateDocument, paginateViewerDocument } from '../../src/core/layout/pagination'
import { ViewerDocument, ViewerParagraph, ViewerTableRow } from '../../src/core/document/viewer_document'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'

const fixture = resolve(__dirname, '../fixtures/private/m1-weekly.hwpx')
const privateTest = existsSync(fixture) ? test : test.skip

describe('AIDA block pagination', () => {
  privateTest('페이지 경계 표를 행 단위로 나눠 8페이지를 구성한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const pages = paginateDocument(document)
    expect(pages).toHaveLength(8)
    expect(pages.every((page) => page.length > 0)).toBe(true)
    const fragments = pages.flat().filter((block) => block.id.includes(':fragment'))
    expect(fragments).toHaveLength(2)
  })

  test('실측 행이 페이지에 맞으면 경험적 분할 대신 원본 좌표 경계를 사용한다', () => {
    const row = (index: number, height: number, header = false): ViewerTableRow => ({ cells: [{
      row: index, column: 0, rowSpan: 1, columnSpan: 1, width: 6000, height,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }, header, paragraphs: []
    }] })
    const tableBlock: ViewerParagraph = {
      id: 'table-block', paraStyleId: '0', pageBreak: false, layoutTop: 100, layoutHeight: 7500,
      content: [{ type: 'table', id: 'table', rowCount: 4, columnCount: 1, pageBreak: 'CELL', repeatHeader: true, rows: [row(0, 1000, true), row(1, 3000), row(2, 500), row(3, 3000)] }]
    }
    const nextBlock: ViewerParagraph = { id: 'next', paraStyleId: '0', pageBreak: false, layoutTop: 0, layoutHeight: 500, content: [] }
    const document = {
      page: { width: 10000, height: 10000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 },
      fonts: {}, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {}, diagnostics: [],
      sections: [{ id: 'section', blocks: [tableBlock, nextBlock], headers: [], footers: [] }]
    } satisfies ViewerDocument
    const measurements = {
      blockHeights: { 'table-block': 7500, next: 500 },
      tableRowHeights: { 'table:r0': 1000, 'table:r1': 3000, 'table:r2': 500, 'table:r3': 3000 }
    }

    expect(paginateViewerDocument(document, measurements).map((page) => page.blocks.map((block) => block.id))).toEqual([
      ['table-block'], ['next']
    ])
  })

  test('부분 행은 원본 DOM 실측값보다 명시한 fragment 높이를 우선한다', () => {
    const row = (index: number): ViewerTableRow => ({
      fragmentHeight: 2000,
      cells: [{
        row: index, column: 0, rowSpan: 1, columnSpan: 1, width: 6000, height: 7000,
        margin: { top: 0, right: 0, bottom: 0, left: 0 }, header: false, paragraphs: []
      }]
    })
    const tableBlock: ViewerParagraph = {
      id: 'fragment-block', paraStyleId: '0', pageBreak: false, layoutHeight: 4000,
      content: [{ type: 'table', id: 'fragment-table', rowCount: 2, columnCount: 1, pageBreak: 'CELL', repeatHeader: false, rows: [row(0), row(1)] }]
    }
    const document = {
      page: { width: 10000, height: 10000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 },
      fonts: {}, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {}, diagnostics: [],
      sections: [{ id: 'section', blocks: [tableBlock], headers: [], footers: [] }]
    } satisfies ViewerDocument
    const measurements = {
      blockHeights: { 'fragment-block': 4000 },
      tableRowHeights: { 'fragment-table:r0': 7000, 'fragment-table:r1': 7000 }
    }

    expect(paginateViewerDocument(document, measurements)[0].blocks.map(({ id }) => id)).toEqual(['fragment-block'])
  })
})
