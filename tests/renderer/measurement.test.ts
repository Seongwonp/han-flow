import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import { cellFragmentKey, fixedPagePrintCss, FixedPageTextLayer, isEditableTableCell, ParagraphView } from '../../src/renderer/src/App'

const nestedParagraph: ViewerParagraph = {
  id: 'table:r0c0:p0', paraStyleId: '0', pageBreak: false, layoutHeight: 1000,
  content: [{ type: 'text', text: '측정', charStyleId: '0' }]
}

const topParagraph: ViewerParagraph = {
  id: 'top', paraStyleId: '0', pageBreak: false, layoutHeight: 2000,
  content: [{
    type: 'table', id: 'table', rowCount: 1, columnCount: 1, width: 6000, pageBreak: 'CELL', repeatHeader: false,
    rows: [{ cells: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, width: 6000, height: 2000, margin: { top: 0, right: 0, bottom: 0, left: 0 }, header: false, paragraphs: [nestedParagraph] }] }]
  }]
}

const document: ViewerDocument = {
  page: { width: 10000, height: 10000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 },
  fonts: {}, charStyles: { '0': { id: '0', height: 1000, color: '#000000', bold: false } },
  paraStyles: { '0': { id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
  cellStyles: {}, resources: {}, diagnostics: [], sections: []
}

describe('DOM 측정 마커', () => {
  test('표 셀 너비 안의 문단까지 측정 ID를 전달한다', () => {
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: topParagraph, document, measurable: true }))
    expect(markup).toContain('data-measure-block-id="top"')
    expect(markup).toContain('data-measure-row-id="table:r0"')
    expect(markup).toContain('data-measure-block-id="table:r0c0:p0"')
    expect(markup).toContain('width:80px')
  })

  test('일반 렌더에는 측정 마커를 노출하지 않는다', () => {
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: topParagraph, document }))
    expect(markup).not.toContain('data-measure-block-id')
    expect(markup).not.toContain('data-measure-row-id')
  })

  test('일반 body cell만 편집 대상으로 허용하고 반복·병합·fragment cell은 차단한다', () => {
    const table = topParagraph.content[0]
    if (table.type !== 'table') throw new Error('테스트 표가 없습니다.')
    const cell = table.rows[0].cells[0]
    expect(isEditableTableCell(cell)).toBe(true)
    expect(isEditableTableCell(cell, true)).toBe(false)
    for (const blocked of [
      { header: true },
      { rowSpan: 2 },
      { columnSpan: 2 },
      { splitTop: true },
      { splitBottom: true }
    ]) {
      expect(isEditableTableCell({ ...cell, ...blocked })).toBe(false)
    }
  })

  test('이어지는 셀 조각은 잘린 경계와 padding, 최소 높이를 제거한다', () => {
    const table = topParagraph.content[0]
    if (table.type !== 'table') throw new Error('테스트 표가 없습니다.')
    const fragment: ViewerParagraph = {
      ...topParagraph,
      content: [{
        ...table,
        rows: [{ cells: [{ ...table.rows[0].cells[0], splitTop: true, splitBottom: true }] }]
      }]
    }
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: fragment, document }))
    expect(markup).toContain('vertical-align:top')
    expect(markup).toContain('padding-top:0')
    expect(markup).toContain('padding-bottom:0')
    expect(markup).toContain('border-top:none')
    expect(markup).toContain('border-bottom:none')
    expect(markup).not.toContain('min-height:')
  })

  test('head와 tail 조각은 바깥 경계만 유지한다', () => {
    const table = topParagraph.content[0]
    if (table.type !== 'table') throw new Error('테스트 표가 없습니다.')
    const border = { type: 'SOLID', widthMm: 0.12, color: '#000000' }
    const styledDocument: ViewerDocument = { ...document, cellStyles: { '1': { id: '1', left: border, right: border, top: border, bottom: border } } }
    const renderCell = (splitTop: boolean, splitBottom: boolean) => renderToStaticMarkup(createElement(ParagraphView, {
      document: styledDocument,
      paragraph: { ...topParagraph, content: [{ ...table, rows: [{ cells: [{ ...table.rows[0].cells[0], margin: { top: 75, right: 75, bottom: 150, left: 75 }, borderFillId: '1', splitTop, splitBottom }] }] }] }
    }))
    const head = renderCell(false, true)
    expect(head).toContain('border-top:0.12mm solid #000000')
    expect(head).toContain('border-bottom:none')
    expect(head).toContain('padding-top:1px')
    expect(head).toContain('padding-bottom:0')
    const tail = renderCell(true, false)
    expect(tail).toContain('border-top:none')
    expect(tail).toContain('border-bottom:0.12mm solid #000000')
    expect(tail).toContain('padding-top:0')
    expect(tail).toContain('padding-bottom:2px')
  })

  test('셀 fragment key는 네 상태를 모두 구분한다', () => {
    const table = topParagraph.content[0]
    if (table.type !== 'table') throw new Error('테스트 표가 없습니다.')
    const source = { ...table.rows[0].cells[0], sourceCellId: 'source' }
    const keys = [
      cellFragmentKey('table', source),
      cellFragmentKey('table', { ...source, splitTop: true }),
      cellFragmentKey('table', { ...source, splitBottom: true }),
      cellFragmentKey('table', { ...source, splitTop: true, splitBottom: true })
    ]
    expect(new Set(keys).size).toBe(4)
  })
})

describe('fixed-page text layer', () => {
  test('텍스트를 HTML로 해석하지 않고 좌표와 검색 강조를 보존한다', () => {
    const markup = renderToStaticMarkup(createElement(FixedPageTextLayer, {
      layout: {
        runs: [{
          text: '<한글 검색>', x: 10, y: 20, width: 90, height: 14,
          fontFamily: '함초롬바탕', fontSize: 12, ratio: 1
        }],
        text: '<한글 검색>',
        nonWhitespaceCharacters: 6
      },
      searchQuery: '검색'
    }))
    expect(markup).toContain('left:10px')
    expect(markup).toContain('&lt;한글 ')
    expect(markup).toContain('<mark class="viewer-fixed-page-search-hit">검색</mark>')
    expect(markup).not.toContain('<한글')
  })

  test('각 fixed page에 고유한 인쇄 용지 크기를 만든다', () => {
    const css = fixedPagePrintCss([
      { index: 0, sectionIndex: 0, width: 793, height: 1122 },
      { index: 1, sectionIndex: 1, width: 1122, height: 793 }
    ])
    expect(css).toContain('@page han-flow-fixed-page-0 { size: 793px 1122px; margin: 0; }')
    expect(css).toContain('@page han-flow-fixed-page-1 { size: 1122px 793px; margin: 0; }')
    expect(css).toContain('[data-page-index="1"] { page: han-flow-fixed-page-1; }')
  })
})
