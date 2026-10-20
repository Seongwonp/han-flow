import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ViewerDocument, ViewerImage, ViewerObjectPlaceholder, ViewerObjectPosition, ViewerParagraph, ViewerTable, ViewerTableRow } from '../../src/core/document/viewer_document'
import { contentPlacement } from '../../src/core/layout/object_position'
import { paginateViewerDocument, paginateViewerSection, paginateViewerSectionsIncremental } from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument, signedHwpUnit } from '../../src/core/parser/viewer_decoder'
import { createFloatingObjectHwpx, FLOATING_OBJECT_EXPECTED, FLOATING_OBJECT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

// 쪽 10000×10000, 여백 1000 → 쪽 본문 8000×8000.
const page = { width: 10000, height: 10000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 }
const bodyHeight = 8000

function position(overrides: Partial<ViewerObjectPosition> = {}): ViewerObjectPosition {
  return {
    wrap: 'TOP_AND_BOTTOM',
    textFlow: 'BOTH_SIDES',
    vertRelTo: 'PAGE',
    horzRelTo: 'PAGE',
    vertAlign: 'TOP',
    horzAlign: 'LEFT',
    vertOffset: 0,
    horzOffset: 0,
    flowWithText: true,
    allowOverlap: false,
    zOrder: 0,
    width: 4000,
    height: 3000,
    outMargin: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides
  }
}

const image = (pos?: ViewerObjectPosition): ViewerImage => ({ type: 'image', resourceId: 'image1', width: 4000, height: 3000, ...(pos ? { position: pos } : {}) })
const block = (id: string, extra: ViewerParagraph['content'] = [], pageBreak = false): ViewerParagraph => ({
  id,
  paraStyleId: '0',
  pageBreak,
  layoutHeight: 1000,
  content: [{ type: 'text', text: id, charStyleId: '0' }, ...extra]
})

function documentOf(blocks: ViewerParagraph[], columns = false): ViewerDocument {
  return {
    page,
    fonts: {},
    charStyles: {},
    paraStyles: {},
    cellStyles: {},
    resources: {},
    diagnostics: [],
    sections: [{
      id: 's0',
      blocks,
      headers: [],
      footers: [],
      ...(columns ? { columnLayout: { type: 'NEWSPAPER', layout: 'LEFT', count: 2, sameSize: true, sameGap: 0, columns: [] } } : {})
    }]
  }
}

const heights = (blocks: ViewerParagraph[], value = 1000) => ({ blockHeights: Object.fromEntries(blocks.map((item) => [item.id, value])), tableRowHeights: {} })
const ids = (document: ViewerDocument, blocks: ViewerParagraph[], value?: number) =>
  paginateViewerDocument(document, heights(blocks, value)).map((item) => item.blocks.map((paragraph) => paragraph.id))

describe('용지·쪽 기준 자리 차지 개체의 본문 띠(pagination)', () => {
  test('쪽 아래 자리 차지 그림이 놓인 쪽은 본문이 그림 높이만큼 줄어든다', () => {
    const blocks = Array.from({ length: 8 }, (_, index) => block(`p${index}`, index === 1 ? [image(position({ vertAlign: 'BOTTOM' }))] : []))
    const pages = paginateViewerDocument(documentOf(blocks), heights(blocks))
    // 띠 3000 → 본문 8000 가운데 5000만 글에 쓴다.
    expect(pages.map((item) => item.blocks.map((paragraph) => paragraph.id))).toEqual([
      ['p0', 'p1', 'p2', 'p3', 'p4'],
      ['p5', 'p6', 'p7']
    ])
    expect(pages[0].bands).toEqual([{ top: 5000, bottom: 8000 }])
    expect(pages[1].bands).toBeUndefined()
  })

  test('쪽 위 자리 차지 표는 바깥 여백까지 띠를 비우고 쪽 사이에서 나누지 않는다', () => {
    const row = (index: number): ViewerTableRow => ({ cells: [{ row: index, column: 0, rowSpan: 1, columnSpan: 1, width: 4000, height: 1000, margin: { top: 0, right: 0, bottom: 0, left: 0 }, header: false, paragraphs: [] }] })
    const table: ViewerTable = {
      type: 'table', id: 't', rowCount: 3, columnCount: 1, width: 4000, height: 3000, pageBreak: 'CELL', repeatHeader: false,
      rows: [row(0), row(1), row(2)],
      position: position({ outMargin: { top: 0, right: 0, bottom: 500, left: 0 } })
    }
    const blocks = [block('p0'), block('p1', [table]), ...Array.from({ length: 6 }, (_, index) => block(`q${index}`))]
    const document = documentOf(blocks)
    const pages = paginateViewerDocument(document, { ...heights(blocks), tableRowHeights: { 't:r0': 1000, 't:r1': 1000, 't:r2': 1000 } })
    // 띠 3500(표 3000 + 아래 바깥 여백 500) → 본문 4500에 1000짜리 block 4개.
    expect(pages.map((item) => item.blocks.map((paragraph) => paragraph.id))).toEqual([
      ['p0', 'p1', 'q0', 'q1'],
      ['q2', 'q3', 'q4', 'q5']
    ])
    expect(pages[0].bands).toEqual([{ top: 0, bottom: 3500 }])
    expect(pages.flatMap((item) => item.blocks).some((paragraph) => paragraph.id.includes(':fragment'))).toBe(false)
  })

  test('block과 띠가 함께 들어가지 않으면 block을 다음 쪽으로 넘기고 띠도 그 쪽에 둔다', () => {
    const blocks = [...Array.from({ length: 6 }, (_, index) => block(`p${index}`)), block('anchor', [image(position({ vertAlign: 'BOTTOM' }))]), block('after')]
    const pages = paginateViewerDocument(documentOf(blocks), heights(blocks))
    expect(pages.map((item) => item.blocks.map((paragraph) => paragraph.id))).toEqual([
      ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      ['anchor', 'after']
    ])
    expect(pages[0].bands).toBeUndefined()
    expect(pages[1].bands).toEqual([{ top: 5000, bottom: 8000 }])
  })

  test('겹치는 띠는 한 번만 빼고, 띠는 같은 쪽의 다음 단에도 적용된다', () => {
    const blocks = [
      block('a', [image(position()), image(position({ vertOffset: 1000 }))]),
      ...Array.from({ length: 6 }, (_, index) => block(`b${index}`))
    ]
    const document = documentOf(blocks, true)
    const [first] = paginateViewerDocument(document, heights(blocks))
    // 띠 [0, 4000] → 단마다 4000만 쓴다: 첫 단 a·b0·b1·b2, 둘째 단 b3·b4·b5·…
    expect(first.bands).toEqual([{ top: 0, bottom: 4000 }])
    expect(first.columns?.map((column) => column.map((paragraph) => paragraph.id))).toEqual([['a', 'b0', 'b1', 'b2'], ['b3', 'b4', 'b5']])
  })

  test('글 앞·뒤 개체와 문단 기준 개체는 쪽 본문 띠를 만들지 않는다', () => {
    const extras = [
      image(position({ wrap: 'BEHIND_TEXT' })),
      image(position({ wrap: 'IN_FRONT_OF_TEXT', vertRelTo: 'PAPER' })),
      image(position({ vertRelTo: 'PARA' })),
      image(position({ vertRelTo: 'PARA', wrap: 'SQUARE' }))
    ]
    const blocks = [block('p0', extras), ...Array.from({ length: 9 }, (_, index) => block(`p${index + 1}`))]
    const pages = paginateViewerDocument(documentOf(blocks), heights(blocks))
    expect(pages.map((item) => item.blocks.length)).toEqual([8, 2])
    expect(pages.every((item) => item.bands === undefined)).toBe(true)
  })

  test('쪽 크기를 모르면(이전 호출 방식) 띠를 계산하지 않는다', () => {
    const blocks = [block('p0', [image(position())]), ...Array.from({ length: 8 }, (_, index) => block(`p${index + 1}`))]
    expect(paginateViewerSection(documentOf(blocks).sections[0], 0, bodyHeight, heights(blocks)).map((item) => item.blocks.length)).toEqual([8, 1])
    expect(ids(documentOf(blocks), blocks)).toEqual([['p0', 'p1', 'p2', 'p3', 'p4'], ['p5', 'p6', 'p7', 'p8']])
  })

  test('한 단 구역의 쪽 기준 글 옆 배치 그림은 개체 옆 남은 폭으로 글을 흘려 띠 높이를 다 비우지 않는다', () => {
    // 쪽 본문 오른쪽 끝, 위에서 3000 아래 그림 4000×3000 → 띠 [3000, 6000], 글은 왼쪽 4000 폭(비율 0.5 × 안전 계수)으로 흐른다.
    const square = position({ wrap: 'SQUARE', horzAlign: 'RIGHT', vertOffset: 3000 })
    const blocks = Array.from({ length: 10 }, (_, index) => block(`p${index}`, index === 0 ? [image(square)] : []))
    const pages = paginateViewerDocument(documentOf(blocks), heights(blocks))
    expect(pages[0].bands).toEqual([{ top: 3000, bottom: 6000, wrap: { float: 'right', width: 4000 } }])
    expect(pages[0].blocks.map((paragraph) => paragraph.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'])
    // 같은 그림을 자리 차지로 두면 띠 높이 3000을 다 비운다.
    const topAndBottom = Array.from({ length: 10 }, (_, index) => block(`p${index}`, index === 0 ? [image({ ...square, wrap: 'TOP_AND_BOTTOM' })] : []))
    expect(paginateViewerDocument(documentOf(topAndBottom), heights(topAndBottom))[0].blocks).toHaveLength(5)
    // 다단 구역은 글 옆 배치도 띠 폭 전체를 비운다.
    const columns = paginateViewerDocument(documentOf(blocks, true), heights(blocks))
    expect(columns[0].bands).toEqual([{ top: 3000, bottom: 6000 }])
  })

  test('한 단 구역에서 띠 옆에 들어가지 않는 표 문단은 띠 아래로 간다', () => {
    const square = position({ wrap: 'SQUARE', horzAlign: 'RIGHT', vertOffset: 3000 })
    const row = (index: number): ViewerTableRow => ({ cells: [{ row: index, column: 0, rowSpan: 1, columnSpan: 1, width: 8000, height: 1000, margin: { top: 0, right: 0, bottom: 0, left: 0 }, header: false, paragraphs: [] }] })
    const table: ViewerTable = { type: 'table', id: 't', rowCount: 2, columnCount: 1, width: 8000, height: 2000, pageBreak: 'NONE', repeatHeader: false, rows: [row(0), row(1)] }
    const tableBlock: ViewerParagraph = { id: 'tb', paraStyleId: '0', pageBreak: false, layoutHeight: 2000, content: [table] }
    const blocks = [block('p0', [image(square)]), block('p1'), tableBlock, block('p2'), block('p3'), block('p4')]
    const pages = paginateViewerDocument(documentOf(blocks), { ...heights(blocks), blockHeights: { ...heights(blocks).blockHeights, tb: 2000 } })
    // p0·p1 [0, 2000], 표는 [2000, 4000]이 띠와 겹쳐 띠 아래 [6000, 8000]로 간다. 남은 글은 다음 쪽.
    expect(pages.map((item) => item.blocks.map((paragraph) => paragraph.id))).toEqual([['p0', 'p1', 'tb'], ['p2', 'p3', 'p4']])
  })

  test('증분 pagination은 쪽 크기·여백이 같으면 쪽을 다시 쓰고 바뀌면 다시 나눈다', () => {
    const blocks = [block('p0', [image(position())]), ...Array.from({ length: 8 }, (_, index) => block(`p${index + 1}`))]
    const document = documentOf(blocks)
    const measurements = heights(blocks)
    const first = paginateViewerSectionsIncremental(document, () => measurements)
    const same = paginateViewerSectionsIncremental({ ...document, page: { ...page } }, () => measurements, first.sections)
    expect(same.reused).toBe(1)
    const moved = paginateViewerSectionsIncremental({ ...document, page: { ...page, margin: { ...page.margin, left: 1500 } } }, () => measurements, first.sections)
    expect(moved.reused).toBe(0)
    expect(moved.pages).toEqual(first.pages)
  })
})

describe('글자처럼 취급하지 않는 개체 decode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-floating-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('32비트 부호 없는 음수 offset을 부호 있는 값으로 읽는다', () => {
    expect(signedHwpUnit('4294964867')).toBe(-2429)
    expect(signedHwpUnit('417')).toBe(417)
    expect(signedHwpUnit(undefined)).toBe(0)
  })

  test('합성 문서의 글상자·그림·표·도형 위치와 배치 방식을 읽는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(createFloatingObjectHwpx(directory)))
    const items = document.sections[0].blocks.flatMap((paragraph) => paragraph.content)
    const textBox = items.find((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder' && item.paragraphs?.[0]?.content.some((content) => content.type === 'text' && content.text === FLOATING_OBJECT_TEXTS.textBoxInner) === true)!
    expect(textBox.kind).toBe('text-box')
    expect(textBox.position).toMatchObject({ wrap: 'IN_FRONT_OF_TEXT', vertRelTo: 'PAPER', horzRelTo: 'PAPER', vertOffset: 40000, horzOffset: 30000, width: 20000, height: 6000 })
    expect(textBox.shape).toEqual({ stroke: { color: '#1F4E79', width: 57, style: 'SOLID' }, fill: '#EAF1FB', textMargin: { top: 283, right: 283, bottom: 283, left: 283 }, textVerticalAlign: 'CENTER' })
    expect(contentPlacement(textBox)).toBe('page')

    const images = items.filter((item): item is ViewerImage => item.type === 'image')
    expect(images.map((item) => [item.position?.wrap, contentPlacement(item)])).toEqual([
      ['TOP_AND_BOTTOM', 'page'],
      ['SQUARE', 'wrap']
    ])
    expect(images[0].position).toMatchObject({ vertAlign: 'BOTTOM', horzAlign: 'RIGHT', width: FLOATING_OBJECT_EXPECTED.picture.width, height: FLOATING_OBJECT_EXPECTED.picture.height, outMargin: { top: 283, right: 283, bottom: 283, left: 283 } })

    const table = items.find((item): item is ViewerTable => item.type === 'table')!
    expect(table.position).toMatchObject({ wrap: 'TOP_AND_BOTTOM', vertRelTo: 'PAGE', horzAlign: 'CENTER', width: 30000, height: 3000 })
    // 쪽 기준 표가 든 문단은 표 높이를 문단 흐름 높이에 넣지 않는다.
    const tableParagraph = document.sections[0].blocks.find((paragraph) => paragraph.content.includes(table))!
    expect(tableParagraph.layoutHeight).toBe(1000)
    expect(tableParagraph.pageBreak).toBe(true)

    const behind = items.find((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder' && item.position?.wrap === 'BEHIND_TEXT')!
    expect(behind).toMatchObject({ kind: 'shape', element: 'hp:rect', shape: { fill: '#F2F2F2' } })
  })

  test('도형 위치 크기는 한/글 쪽 배치 크기(hp:sz)를 쓰고 선 꼭짓점은 그 크기로 늘린다', async () => {
    const { parseOrderedXml } = await import('../../src/core/parser/ordered_xml')
    const section = '<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">' +
      '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="5669" right="5669" top="2834" bottom="1417" header="1417" footer="1417"/></hp:pagePr></hp:secPr>' +
      '<hp:rect id="1" zOrder="3" textWrap="TOP_AND_BOTTOM"><hp:orgSz width="48150" height="3825"/><hp:curSz width="47772" height="3729"/><hp:lineShape color="#000000" width="33" style="NONE"/><hp:drawText><hp:subList vertAlign="CENTER"><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>상자</hp:t></hp:run></hp:p></hp:subList></hp:drawText><hp:sz width="47772" height="2646"/><hp:pos treatAsChar="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="4294964867" horzOffset="417"/></hp:rect>' +
      '<hp:line id="2" zOrder="11" textWrap="IN_FRONT_OF_TEXT"><hp:orgSz width="100" height="100"/><hp:curSz width="48740" height="0"/><hp:lineShape color="#000000" width="425" style="SLIM_THICK"/><hc:startPt x="0" y="0"/><hc:endPt x="100" y="100"/><hp:sz width="48740" height="1"/><hp:pos treatAsChar="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="10315" horzOffset="5624"/></hp:line>' +
      '</hp:run></hp:p></hs:sec>'
    const header = '<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>'
    const document = await decodeViewerDocument({
      index: async () => ({ mimetype: 'application/hwp+zip', headerPath: 'Contents/header.xml', sectionPaths: ['Contents/section0.xml'], sectionSizes: {}, resourcePaths: [] }),
      readOrderedXml: async (path) => parseOrderedXml(path === 'Contents/section0.xml' ? section : header),
      readBuffer: async () => Buffer.alloc(0)
    })
    const [rect, line] = document.sections[0].blocks[0].content as ViewerObjectPlaceholder[]
    expect(rect.size).toEqual({ width: 47772, height: 3729 })
    expect(rect.position).toMatchObject({ width: 47772, height: 2646, vertOffset: -2429, horzOffset: 417 })
    expect(rect.shape?.stroke).toBeUndefined()
    expect(contentPlacement(rect)).toBe('band')
    expect(line.position).toMatchObject({ width: 48740, height: 1, vertRelTo: 'PAPER' })
    expect(line.shape).toEqual({ stroke: { color: '#000000', width: 425, style: 'SLIM_THICK' }, points: [{ x: 0, y: 0 }, { x: 48740, y: 1 }] })
  })
})
