import { ViewerDocument, ViewerNoteList, ViewerObjectPlaceholder, ViewerParagraph } from '../../src/core/document/viewer_document'
import {
  collectObjectPlaceholders,
  countObjectPlaceholders,
  formatObjectPlaceholderCounts,
  objectPlaceholderNotice,
  sanitizeObjectPlaceholderCounts
} from '../../src/core/document/object_placeholder'
import { listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { parseOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxReadablePackage } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'

const SECTION = 'Contents/section0.xml'
const NS = 'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"'
const HEADER = '<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:refList>' +
  '<hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000"/></hh:charProperties>' +
  '<hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="LEFT"/></hh:paraPr></hh:paraProperties>' +
  '</hh:refList></hh:head>'
const PAGE = '<hp:secPr><hp:pagePr width="10000" height="10000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="0" footer="0"/></hp:pagePr></hp:secPr>'

/** 메모리 안 HWPX: header.xml과 section0.xml 하나. 문단 XML 조각을 그대로 section에 넣는다. */
function packageOf(paragraphs: string): HwpxReadablePackage {
  const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}>` +
    `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${PAGE}</hp:run></hp:p>${paragraphs}</hs:sec>`
  return {
    index: async () => ({ mimetype: 'application/hwp+zip', headerPath: 'Contents/header.xml', sectionPaths: [SECTION], sectionSizes: {}, resourcePaths: [] }),
    readOrderedXml: async (path) => parseOrderedXml(path === SECTION ? section : HEADER),
    readBuffer: async () => Buffer.alloc(0)
  }
}

const paragraph = (runChildren: string, lineHeight = 1000) =>
  `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${runChildren}</hp:run>` +
  `<hp:linesegarray><hp:lineseg vertpos="0" vertsize="${lineHeight}"/></hp:linesegarray></hp:p>`
const inlinePos = '<hp:pos treatAsChar="1"/>'
const drawText = (text: string) =>
  `<hp:drawText><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:textMargin left="283" right="283" top="283" bottom="283"/></hp:drawText>`

async function decode(paragraphs: string): Promise<ViewerDocument> {
  return decodeViewerDocument(packageOf(paragraphs))
}

function placeholders(document: ViewerDocument): ViewerObjectPlaceholder[] {
  return collectObjectPlaceholders(document)
}

describe('원본 개체 자리 표시 decoder', () => {
  test('수식은 hp:script를 대체 글로, 선언 크기와 글자처럼 취급 흐름을 남긴다', async () => {
    const document = await decode(paragraph(
      `<hp:t>앞</hp:t><hp:equation><hp:sz width="3825" height="3311"/>${inlinePos}<hp:shapeComment>수식입니다.</hp:shapeComment><hp:script>{a} over {b}</hp:script></hp:equation><hp:t>뒤</hp:t>`
    ))
    const content = document.sections[0].blocks[1].content
    expect(content.map((item) => item.type)).toEqual(['text', 'object-placeholder', 'text'])
    expect(content[1]).toEqual({
      type: 'object-placeholder',
      kind: 'equation',
      element: 'hp:equation',
      sourcePath: `${SECTION}#hp:equation:0`,
      flow: 'inline',
      size: { width: 3825, height: 3311 },
      label: '수식',
      fallbackText: '{a} over {b}'
    })
    expect(document.diagnostics).toEqual([expect.objectContaining({ source: SECTION, code: 'HWPX_OBJECT_PLACEHOLDER_EQUATION' })])
  })

  test('자리 표시는 같은 문단 글자 run의 편집 가능 여부를 바꾸지 않는다', async () => {
    const document = await decode(paragraph(`<hp:t>앞</hp:t><hp:equation><hp:sz width="10" height="10"/>${inlinePos}<hp:script>x</hp:script></hp:equation><hp:t>뒤</hp:t>`))
    const contexts = listEditingAnchorContexts(document).filter((context) => context.paragraphId === 's0:p1')
    expect(contexts.map((context) => context.text)).toEqual(['앞', '뒤'])
  })

  test('글상자 글은 읽기 전용 문단으로 되살리고, 글 없는 도형은 도형 자리 표시로 둔다', async () => {
    const document = await decode(
      paragraph(`<hp:rect textWrap="SQUARE"><hp:curSz width="0" height="0"/>${drawText('상자 글')}<hp:sz width="8000" height="3000"/>${inlinePos}</hp:rect><hp:t/>`) +
      paragraph('<hp:ellipse textWrap="IN_FRONT_OF_TEXT"><hp:curSz width="0" height="3165"/><hp:sz width="8000" height="3000"/><hp:pos treatAsChar="0"/></hp:ellipse><hp:t/>') +
      paragraph('<hp:line textWrap="TOP_AND_BOTTOM"><hp:curSz width="4000" height="0"/><hp:sz width="4000" height="1"/><hp:pos treatAsChar="0"/></hp:line>')
    )
    const [box, ellipse, line] = placeholders(document)
    expect(box).toMatchObject({ kind: 'text-box', label: '글상자', flow: 'inline', size: { width: 8000, height: 3000 } })
    expect(box.paragraphs).toHaveLength(1)
    expect(box.paragraphs![0].content).toEqual([{ type: 'text', text: '상자 글', charStyleId: '0', sourceAnchor: undefined }])
    // 글 앞 개체는 본문 자리를 차지하지 않는다.
    expect(ellipse).toMatchObject({ kind: 'shape', label: '도형', flow: 'floating', size: { width: 8000, height: 3000 } })
    expect(line).toMatchObject({ kind: 'shape', flow: 'block', size: { width: 4000, height: 1 } })
    // 글상자 안 hp:t는 편집 anchor가 없다(읽기 전용).
    expect(listEditingAnchorContexts(document).some((context) => context.text === '상자 글')).toBe(false)
  })

  test('묶음 개체는 안쪽 도형의 글을 순서대로 모은다', async () => {
    const document = await decode(paragraph(
      `<hp:container textWrap="IN_FRONT_OF_TEXT"><hp:sz width="9000" height="2000"/><hp:pos treatAsChar="0"/><hp:rect>${drawText('하나')}</hp:rect><hp:ellipse/><hp:rect>${drawText('둘')}</hp:rect></hp:container>`
    ))
    const [container] = placeholders(document)
    expect(container).toMatchObject({ kind: 'text-box', element: 'hp:container', flow: 'floating' })
    expect(container.paragraphs!.map((item) => item.content.map((content) => content.type === 'text' ? content.text : '').join(''))).toEqual(['하나', '둘'])
  })

  test('OLE·동영상·글맵시·양식 컨트롤·덧말·글자 겹치기를 종류별로 표시한다', async () => {
    const document = await decode(paragraph(
      `<hp:ole textWrap="SQUARE"><hp:sz width="14176" height="14176"/><hp:pos treatAsChar="0"/><hp:shapeComment>OLE 개체입니다.</hp:shapeComment></hp:ole>` +
      `<hp:video textWrap="SQUARE"><hp:sz width="22500" height="15000"/><hp:pos treatAsChar="0"/></hp:video>` +
      `<hp:textart text="첫 줄␍␊둘째 줄"><hp:curSz width="40500" height="16000"/><hp:sz width="40500" height="16000"/>${inlinePos}</hp:textart>` +
      `<hp:btn caption="명령 단추1"><hp:sz width="7087" height="1984"/>${inlinePos}</hp:btn>` +
      `<hp:edit name="Edit1"><hp:text>1234</hp:text><hp:sz width="7087" height="1984"/>${inlinePos}</hp:edit>` +
      `<hp:comboBox name="ComboBox1" selectedValue=""><hp:sz width="9921" height="1984"/>${inlinePos}</hp:comboBox>` +
      '<hp:dutmal posType="BOTTOM"><hp:mainText>본말</hp:mainText><hp:subText>덧말</hp:subText></hp:dutmal>' +
      '<hp:compose composeText="AO"/>'
    ))
    expect(placeholders(document).map(({ kind, label, flow, fallbackText, ruby }) => ({ kind, label, flow, fallbackText, ruby }))).toEqual([
      { kind: 'ole', label: 'OLE 개체', flow: 'block', fallbackText: 'OLE 개체입니다.', ruby: undefined },
      { kind: 'video', label: '동영상', flow: 'block', fallbackText: undefined, ruby: undefined },
      { kind: 'shape', label: '글맵시', flow: 'inline', fallbackText: '첫 줄\n둘째 줄', ruby: undefined },
      { kind: 'form-control', label: '양식 컨트롤', flow: 'inline', fallbackText: '명령 단추1', ruby: undefined },
      { kind: 'form-control', label: '양식 컨트롤', flow: 'inline', fallbackText: '1234', ruby: undefined },
      { kind: 'form-control', label: '양식 컨트롤', flow: 'inline', fallbackText: 'ComboBox1', ruby: undefined },
      { kind: 'ruby', label: '덧말', flow: 'marker', fallbackText: '본말', ruby: { text: '덧말', position: 'bottom' } },
      { kind: 'unknown', label: '글자 겹치기', flow: 'marker', fallbackText: 'AO', ruby: undefined }
    ])
    expect(document.diagnostics.map((item) => item.code)).toEqual([
      'HWPX_OBJECT_PLACEHOLDER_OLE',
      'HWPX_OBJECT_PLACEHOLDER_SHAPE',
      'HWPX_OBJECT_PLACEHOLDER_FORM_CONTROL',
      'HWPX_OBJECT_PLACEHOLDER_VIDEO',
      'HWPX_OBJECT_PLACEHOLDER_RUBY',
      'HWPX_OBJECT_PLACEHOLDER_UNKNOWN'
    ])
  })

  test('hp:switch의 차트는 차트로, 그 밖에는 hp:default 내용을 읽는다', async () => {
    const document = await decode(paragraph(
      '<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"><hp:chart chartIDRef="Chart/chart1.xml"><hp:sz width="0" height="0"/>' + inlinePos + '</hp:chart></hp:case>' +
      '<hp:default><hp:ole><hp:sz width="20000" height="12000"/>' + inlinePos + '</hp:ole></hp:default></hp:switch>' +
      '<hp:switch><hp:case hp:required-namespace="urn:future"><hp:future/></hp:case><hp:default><hp:t>대체 글</hp:t></hp:default></hp:switch>'
    ))
    const content = document.sections[0].blocks[1].content
    // 시험 쪽 본문(높이 8000)의 85%를 넘는 OLE 대체 크기는 같은 비율로 줄이고 원래 선언 크기를 남긴다.
    expect(content[0]).toMatchObject({
      kind: 'chart', label: '차트', flow: 'inline', size: { width: 11333, height: 6800 },
      fitted: { declared: { width: 20000, height: 12000 }, scale: 6800 / 12000 }
    })
    expect(content[1]).toMatchObject({ type: 'text', text: '대체 글' })
    expect(content).toHaveLength(2)
  })

  test('각주·미주는 본문에 번호를, 구역 끝 목록에 본문을 둔다', async () => {
    const note = (name: string, number: number, text: string) =>
      `<hp:ctrl><${name} number="${number}" suffixChar="41"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">` +
      `<hp:ctrl><hp:autoNum num="${number}"><hp:autoNumFormat type="DIGIT" suffixChar=")"/></hp:autoNum></hp:ctrl><hp:t>${text}</hp:t></hp:run>` +
      `<hp:linesegarray><hp:lineseg vertpos="0" vertsize="900"/></hp:linesegarray></hp:p></hp:subList></${name}></hp:ctrl>`
    const document = await decode(paragraph(`<hp:t>본문</hp:t>${note('hp:footNote', 1, '각주 본문')}${note('hp:endNote', 1, '미주 본문')}<hp:t/>`))
    const blocks = document.sections[0].blocks
    expect(blocks[1].content.filter((item) => item.type === 'object-placeholder')).toEqual([
      { type: 'object-placeholder', kind: 'footnote', element: 'hp:footNote', sourcePath: `${SECTION}#hp:footNote:0`, flow: 'marker', label: '각주', marker: '1)' },
      { type: 'object-placeholder', kind: 'endnote', element: 'hp:endNote', sourcePath: `${SECTION}#hp:endNote:0`, flow: 'marker', label: '미주', marker: '1)' }
    ])
    // 쪽 사이에서 나눌 수 있게 각주·미주 문단마다 block 하나씩 둔다.
    const noteBlocks = blocks.slice(-2)
    expect(noteBlocks.map((block) => block.id)).toEqual(['s0:notes', 's0:notes:1'])
    expect(noteBlocks.every((block) => block.layoutHeight > 0)).toBe(true)
    const lists = noteBlocks.map((block) => block.content[0] as ViewerNoteList)
    expect(lists.map((list) => [list.continuesKind, list.continuesNote])).toEqual([[undefined, undefined], ['footnote', undefined]])
    expect(lists.flatMap((list) => list.notes).map((item) => [item.kind, item.marker, item.paragraphs[0].content.find((content) => content.type === 'text')])).toEqual([
      ['footnote', '1)', { type: 'text', text: '각주 본문', charStyleId: '0', sourceAnchor: undefined }],
      ['endnote', '1)', { type: 'text', text: '미주 본문', charStyleId: '0', sourceAnchor: undefined }]
    ])
    expect(countObjectPlaceholders(document)).toEqual({ footnote: 1, endnote: 1 })
  })

  test('메모는 내용을 가진 표시로, 누름틀 필드는 본문 글이 보이므로 표시하지 않는다', async () => {
    const document = await decode(paragraph(
      '<hp:ctrl><hp:fieldBegin type="MEMO"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>메모 1</hp:t></hp:run></hp:p></hp:subList></hp:fieldBegin></hp:ctrl>' +
      '<hp:t>메모가 붙는 글</hp:t><hp:ctrl><hp:fieldEnd/></hp:ctrl>' +
      '<hp:ctrl><hp:fieldBegin type="CLICK_HERE" name="누름"/></hp:ctrl><hp:t>누름</hp:t><hp:ctrl><hp:fieldEnd/></hp:ctrl>'
    ))
    expect(placeholders(document)).toEqual([expect.objectContaining({ kind: 'memo', label: '메모', flow: 'marker', sourcePath: `${SECTION}#hp:fieldBegin:0` })])
    expect(placeholders(document)[0].paragraphs![0].content[0]).toMatchObject({ text: '메모 1', sourceAnchor: undefined })
  })

  test('모르는 run 자식은 알 수 없는 개체로 표시하고 머리말·구역 정의 같은 control은 표시하지 않는다', async () => {
    const document = await decode(paragraph(
      '<hp:mystery><hp:sz width="1000" height="500"/></hp:mystery><hp:header><hp:subList/></hp:header><hp:colPr colCount="1"/><hp:t>글</hp:t>'
    ))
    expect(placeholders(document)).toEqual([expect.objectContaining({ kind: 'unknown', element: 'hp:mystery', fallbackText: 'hp:mystery', size: { width: 1000, height: 500 } })])
  })

  test('표 셀 안 개체도 자리 표시로 세고, 문단 높이는 자리 차지 개체 크기를 반영한다', async () => {
    const document = await decode(
      '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="1" colCnt="1"><hp:sz width="8000" height="1000"/><hp:tr><hp:tc><hp:subList>' +
      `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:equation><hp:sz width="100" height="100"/>${inlinePos}<hp:script>y</hp:script></hp:equation></hp:run></hp:p>` +
      '</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="8000" height="1000"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>' +
      paragraph('<hp:ole textWrap="TOP_AND_BOTTOM"><hp:sz width="5000" height="6000"/><hp:pos treatAsChar="0"/></hp:ole>', 1000) +
      paragraph('<hp:ole textWrap="TOP_AND_BOTTOM"><hp:sz width="5000" height="6000"/><hp:pos treatAsChar="0"/></hp:ole>', 1000)
    )
    expect(countObjectPlaceholders(document)).toEqual({ equation: 1, ole: 2 })
    const blocks = document.sections[0].blocks
    expect(blocks[2].layoutHeight).toBe(6000)
    // 본문 높이 8000 안에 6000 두 개는 들어가지 않으므로 다음 쪽으로 넘어간다.
    expect(paginateViewerDocument(document).map((page) => page.blocks.map((block) => block.id))).toEqual([
      ['s0:p0', 's0:p1', 's0:p2'], ['s0:p3']
    ])
  })
})

describe('자리 표시 요약', () => {
  const section = (content: ViewerParagraph['content']) => ({
    sections: [{ id: 's', headers: [], footers: [], blocks: [{ id: 'p', paraStyleId: '0', pageBreak: false, layoutHeight: 0, content }] }]
  })
  const item = (kind: ViewerObjectPlaceholder['kind']): ViewerObjectPlaceholder => ({
    type: 'object-placeholder', kind, element: 'hp:x', sourcePath: '#hp:x:0', flow: 'inline', label: kind
  })

  test('종류별 개수를 정해진 순서로 세고 한국어로 요약한다', () => {
    const counts = countObjectPlaceholders(section([item('text-box'), item('equation'), item('equation')]))
    expect(Object.keys(counts)).toEqual(['equation', 'text-box'])
    expect(formatObjectPlaceholderCounts(counts)).toBe('수식 2, 글상자 1')
    expect(objectPlaceholderNotice(counts)).toBe('이 문서에는 화면에 완전히 표시되지 않는 개체가 3개 있습니다 (수식 2, 글상자 1)')
    expect(objectPlaceholderNotice({})).toBeUndefined()
  })

  test('IPC로 받은 개수는 알려진 종류의 양의 정수만 남긴다', () => {
    expect(sanitizeObjectPlaceholderCounts({ equation: 2, memo: 0, shape: -1, chart: 1.5, ole: '3', bogus: 4 })).toEqual({ equation: 2 })
    expect(sanitizeObjectPlaceholderCounts(null)).toEqual({})
    expect(sanitizeObjectPlaceholderCounts([1])).toEqual({})
  })
})
