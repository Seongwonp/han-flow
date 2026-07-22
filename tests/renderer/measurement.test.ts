import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import { ParagraphView } from '../../src/renderer/src/App'

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
})
