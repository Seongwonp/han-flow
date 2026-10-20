import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import { PageNumberView, ParagraphView, paragraphStrutCss } from '../../src/renderer/src/App'
import { hwpUnitToCssPx } from '../../src/core/layout/hwp_unit'

// 서버 렌더에서 나는 useLayoutEffect 경고만 조용히 하고 그 밖의 오류는 test를 실패시킨다.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    throw new Error([message, ...rest].map(String).join(' '))
  })
})
afterAll(() => jest.restoreAllMocks())

const text = (value: string, charStyleId: string) => ({ type: 'text' as const, text: value, charStyleId })
const paragraph = (content: ViewerParagraph['content']): ViewerParagraph => ({ id: 'p', paraStyleId: '0', pageBreak: false, layoutHeight: 1000, content })

const document: ViewerDocument = {
  page: { width: 59528, height: 84188, margin: { top: 4251, right: 5669, bottom: 2834, left: 5669 }, headerOffset: 1417, footerOffset: 1417 },
  fonts: {},
  charStyles: {
    small: { id: 'small', height: 500, color: '#000000', bold: false, italic: false, underline: false, strikeout: false },
    body: { id: 'body', height: 1000, color: '#000000', bold: false, italic: false, underline: false, strikeout: false },
    large: { id: 'large', height: 1400, color: '#000000', bold: false, italic: false, underline: false, strikeout: false }
  },
  paraStyles: { '0': { id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 160 } },
  cellStyles: {}, resources: {}, diagnostics: [], sections: []
} as unknown as ViewerDocument

describe('쪽 번호 자리', () => {
  test('아래 가운데 쪽 번호는 본문 아래 꼬리말 띠 아래 끝에 맞춰 본문과 겹치지 않는다', () => {
    const markup = renderToStaticMarkup(createElement(PageNumberView, {
      page: document.page,
      pageNumber: { position: 'BOTTOM_CENTER', formatType: 'DIGIT', sideChar: '-', start: 1, hiddenOnFirstPage: false },
      pageNumberIndex: 0,
      text: '- 1 -'
    }))
    expect(markup).toContain(`left:${hwpUnitToCssPx(59528 / 2)}px`)
    expect(markup).toContain(`top:${hwpUnitToCssPx(84188 - 1417)}px`)
    expect(markup).toContain('translate(-50%, -100%)')
    expect(markup).toContain('data-page-number-position="BOTTOM_CENTER"')
  })

  test('바깥쪽 위 쪽 번호는 짝수 쪽에서 본문 왼쪽, 머리말 띠 위 끝에 둔다', () => {
    const markup = renderToStaticMarkup(createElement(PageNumberView, {
      page: document.page,
      pageNumber: { position: 'OUTSIDE_TOP', formatType: 'DIGIT', sideChar: '', start: 1, hiddenOnFirstPage: false },
      pageNumberIndex: 1,
      text: '2'
    }))
    expect(markup).toContain(`left:${hwpUnitToCssPx(5669)}px;top:${hwpUnitToCssPx(4251 - 1417)}px`)
    expect(markup).toContain('translate(0, 0)')
  })
})

describe('문단 줄 높이 바탕 글자', () => {
  test('문단 요소 글자 크기는 가장 작은 글자 run이라 기본 글자 크기가 줄 높이를 키우지 않는다', () => {
    expect(paragraphStrutCss(paragraph([text('큰 글', 'large'), text('본문', 'body')]), document)).toEqual(expect.objectContaining({ fontSize: '10pt' }))
    expect(paragraphStrutCss(paragraph([]), document)).toBeUndefined()
  })

  test('빈 문단은 그 글자 크기의 한 줄(줄 간격 포함)을 차지한다', () => {
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: paragraph([text('', 'small')]), document }))
    expect(markup).toContain('font-size:5pt')
    expect(markup).toContain('min-height:1.6em')
  })

  test('표 셀 첫 줄 위·마지막 줄 아래의 반 줄 간격을 뺀다', () => {
    const both = renderToStaticMarkup(createElement(ParagraphView, { paragraph: paragraph([text('셀', 'body')]), document, cellEdges: { first: true, last: true } }))
    expect(both).toContain('margin-top:calc(0px - 0.3em)')
    expect(both).toContain('margin-bottom:calc(0px - 0.3em)')
    const middle = renderToStaticMarkup(createElement(ParagraphView, { paragraph: paragraph([text('셀', 'body')]), document, cellEdges: { first: false, last: false } }))
    expect(middle).toContain('margin-top:0')
    expect(middle).not.toContain('calc(')
  })
})

describe('줄 단위로 나눈 문단 조각', () => {
  const noop = () => undefined
  const editing = {
    pending: false, allowMultipleRuns: true, allowParagraphRange: true, allowParagraphStructure: true,
    onCommit: noop, onComposingChange: noop, onSelectionChange: noop, onEditorSelectionChange: noop, onRangeCommit: noop,
    onSplitParagraph: noop, onMergeParagraph: noop, onParagraphStructureUnavailable: noop, onTableCellSelectionChange: noop
  }
  const justifyDocument = { ...document, paraStyles: { '0': { id: '0', margin: { top: 300, right: 0, bottom: 300, left: 0 }, lineSpacing: 160, align: 'JUSTIFY', indent: 600 } } } as unknown as ViewerDocument
  const source: ViewerParagraph = {
    id: 's0:p1', paraStyleId: '0', pageBreak: false, layoutHeight: 3200,
    content: [{ type: 'text', text: '앞줄뒷줄', charStyleId: 'body', sourceAnchor: { sectionPath: 'Contents/section0.xml', textNodeId: 'Contents/section0.xml#hp:t:3' } }]
  }
  const head: ViewerParagraph = {
    ...source, id: 's0:p1@line0', layoutHeight: 1600, content: [{ type: 'text', text: '앞줄', charStyleId: 'body' }],
    lineSplit: { part: 'head', source, continues: true, from: -1, to: 0, clipHeight: 1600 }
  }
  const rest: ViewerParagraph = {
    ...source, id: 's0:p1@line1', layoutHeight: 1600, content: [{ type: 'text', text: '뒷줄', charStyleId: 'body' }],
    lineSplit: { part: 'rest', source, continues: false, from: 0, to: 1 }
  }

  test('보기·PDF는 조각 글자만 그리고, 앞 조각은 마지막 줄도 양쪽 맞춤·아래 간격 없음, 뒤 조각은 들여쓰기·위 간격 없음이다', () => {
    const headMarkup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: head, document: justifyDocument }))
    expect(headMarkup).toContain('>앞줄<')
    expect(headMarkup).not.toContain('뒷줄')
    expect(headMarkup).toContain('margin-bottom:0;')
    expect(headMarkup).toContain('text-align-last:justify')
    expect(headMarkup).toContain('data-line-split="head-continues"')
    const restMarkup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: rest, document: justifyDocument }))
    expect(restMarkup).toContain('margin-top:0;')
    expect(restMarkup).toContain('text-indent:0;')
    expect(restMarkup).not.toContain('text-align-last')
  })

  test('편집 중 앞 조각은 원본 문단 전체를 조각 높이로 잘라 입력 칸 하나로 두고, 뒤 조각은 읽기 전용이다', () => {
    const headMarkup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: head, document: justifyDocument, editing }))
    expect(headMarkup).toContain('class="viewer-paragraph viewer-line-split-clip" data-line-split-source="s0:p1"')
    expect(headMarkup).toMatch(new RegExp(`height:${hwpUnitToCssPx(1600)}px;box-sizing:border-box;overflow:hidden`))
    expect(headMarkup).toContain(`margin-top:${hwpUnitToCssPx(300)}px`)
    // 원본 문단의 입력 칸(글자는 입력 칸이 mount 뒤 채운다).
    expect(headMarkup).toContain('role="textbox"')
    expect(headMarkup).toContain('data-source-text-node-id="Contents/section0.xml#hp:t:3"')
    const restMarkup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: rest, document: justifyDocument, editing }))
    expect(restMarkup).toContain('뒷줄')
    expect(restMarkup).not.toContain('role="textbox"')
  })
})
