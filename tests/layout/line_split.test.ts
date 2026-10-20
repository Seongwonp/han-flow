import type { ViewerColumnLayout, ViewerParagraph, ViewerSection } from '../../src/core/document/viewer_document'
import {
  balanceUnits,
  chooseLineBreak,
  joinBalanceUnits,
  LayoutMeasurements,
  lineSplitBlock,
  pageColumnRegions,
  paginateViewerSection,
  paginateViewerSectionsIncremental,
  ParagraphLineBreak,
  ViewerPage
} from '../../src/core/layout/pagination'

const LINE = 1000
const BODY = 10000

/** 글자 하나가 한 줄인 문단(`lines`줄, 줄 높이 1000). */
const paragraph = (id: string, lines: number, extra: Partial<ViewerParagraph> = {}): ViewerParagraph => ({
  id, paraStyleId: '0', pageBreak: false, layoutHeight: lines * LINE,
  content: [{ type: 'text', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, lines), charStyleId: '0', sourceAnchor: { sectionPath: 's', textNodeId: `s#hp:t:${id}` } }],
  ...extra
})
const breaksOf = (lines: number): ParagraphLineBreak[] => Array.from({ length: lines - 1 }, (_, index) => ({ y: (index + 1) * LINE, position: { content: 0, offset: index + 1 } }))
const section = (blocks: ViewerParagraph[], columnLayout?: ViewerColumnLayout): ViewerSection => ({ id: 's', blocks, headers: [], footers: [], ...(columnLayout ? { columnLayout } : {}) })
const measure = (blocks: ViewerParagraph[]): LayoutMeasurements => ({
  blockHeights: Object.fromEntries(blocks.map((block) => [block.id, block.layoutHeight])),
  tableRowHeights: {},
  lineBreaks: Object.fromEntries(blocks.filter((block) => block.layoutHeight > LINE).map((block) => [block.id, breaksOf(block.layoutHeight / LINE)]))
})
const textOf = (block: ViewerParagraph) => block.content.map((item) => item.type === 'text' ? item.text : '').join('')
const pagesText = (pages: ViewerPage[]) => pages.map((page) => page.blocks.map((block) => `${block.lineSplit?.source.id ?? block.id}:${textOf(block)}`))

describe('줄 경계 고르기', () => {
  const breaks = breaksOf(6)
  test('남은 높이 안의 가장 늦은 경계를 고르고 외톨이줄 보호면 앞·뒤에 두 줄씩 남긴다', () => {
    expect(chooseLineBreak(breaks, -1, 3500, 1)).toBe(2)
    expect(chooseLineBreak(breaks, -1, 5500, 1)).toBe(4)
    expect(chooseLineBreak(breaks, -1, 5500, 2)).toBe(3)
    expect(chooseLineBreak(breaks, -1, 1500, 2)).toBeUndefined()
    expect(chooseLineBreak(breaks, 2, 2000, 1)).toBe(4)
  })

  test('조각은 경계 글자 위치로 자르고 편집 anchor를 지운다', () => {
    const source = paragraph('p', 6)
    const head = lineSplitBlock(source, breaks, -1, 2, 6000)
    expect(textOf(head)).toBe('ABC')
    expect(head.layoutHeight).toBe(3000)
    expect(head.lineSplit).toEqual({ part: 'head', source, continues: true, from: -1, to: 2, clipHeight: 3000 })
    expect(head.content[0]).not.toHaveProperty('sourceAnchor')
    const rest = lineSplitBlock(source, breaks, 2, 5, 6000)
    expect(textOf(rest)).toBe('DEF')
    expect(rest.lineSplit).toMatchObject({ part: 'rest', continues: false })
    expect(rest.id).toBe('p@line3')
  })
})

describe('본문 줄 단위 쪽 나눔', () => {
  test('쪽 아래에 다 들어가지 않는 문단은 남은 줄만큼 이 쪽에 두고 나머지를 다음 쪽 처음에 잇는다', () => {
    const blocks = [paragraph('a', 7), paragraph('b', 6)]
    const pages = paginateViewerSection(section(blocks), 0, BODY, measure(blocks))
    expect(pagesText(pages)).toEqual([['a:ABCDEFG', 'b:ABC'], ['b:DEF']])
    expect(pages[0].blocks[1].lineSplit?.part).toBe('head')
    expect(pages[1].blocks[0].lineSplit?.part).toBe('rest')
  })

  test('한 쪽보다 긴 문단은 여러 쪽에 걸쳐 나누고 글자를 잃지 않는다', () => {
    const blocks = [paragraph('a', 25)]
    const pages = paginateViewerSection(section(blocks), 0, BODY, measure(blocks))
    expect(pages.map((page) => page.blocks.map(textOf).join(''))).toEqual(['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXY'])
  })

  test('외톨이줄 보호는 앞 조각과 남은 줄을 두 줄 이상으로 두고, 문단 보호는 나누지 않는다', () => {
    const widow = [paragraph('a', 9), paragraph('b', 3, { breakSetting: { widowOrphan: true } })]
    expect(pagesText(paginateViewerSection(section(widow), 0, BODY, measure(widow)))).toEqual([['a:ABCDEFGHI'], ['b:ABC']])
    const orphan = [paragraph('a', 8), paragraph('b', 4, { breakSetting: { widowOrphan: true } })]
    expect(pagesText(paginateViewerSection(section(orphan), 0, BODY, measure(orphan)))).toEqual([['a:ABCDEFGH', 'b:AB'], ['b:CD']])
    const keep = [paragraph('a', 8), paragraph('b', 4, { breakSetting: { keepLines: true } })]
    expect(pagesText(paginateViewerSection(section(keep), 0, BODY, measure(keep)))).toEqual([['a:ABCDEFGH'], ['b:ABCD']])
  })

  test('다음 문단과 함께·문단 앞 쪽 나눔을 따른다', () => {
    const together = [paragraph('a', 7), paragraph('b', 2, { breakSetting: { keepWithNext: true } }), paragraph('c', 3, { breakSetting: { keepLines: true } })]
    expect(pagesText(paginateViewerSection(section(together), 0, BODY, measure(together)))).toEqual([['a:ABCDEFG'], ['b:AB', 'c:ABC']])
    const before = [paragraph('a', 2), paragraph('b', 2, { breakSetting: { pageBreakBefore: true } })]
    expect(pagesText(paginateViewerSection(section(before), 0, BODY, measure(before)))).toEqual([['a:AB'], ['b:AB']])
  })

  test('줄 경계를 아직 재지 않은 문단은 나누려 한 문단만 측정을 요청하고, 잰 뒤 다시 나눈다', () => {
    const blocks = [paragraph('a', 7), paragraph('b', 6), paragraph('c', 1)]
    const heightsOnly: LayoutMeasurements = { blockHeights: measure(blocks).blockHeights, tableRowHeights: {} }
    const document = { page: { width: 10000, height: BODY + 2000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 }, sections: [section(blocks)] }
    const first = paginateViewerSectionsIncremental(document, () => heightsOnly)
    expect(first.sections[0].wantedLineBreaks).toEqual(['b'])
    expect(pagesText(first.pages)).toEqual([['a:ABCDEFG'], ['b:ABCDEF', 'c:A']])
    const withBreaks = { ...heightsOnly, lineBreaks: { b: breaksOf(6) } }
    const second = paginateViewerSectionsIncremental(document, () => withBreaks, first.sections)
    expect(second.sections[0].wantedLineBreaks).toBeUndefined()
    expect(pagesText(second.pages)).toEqual([['a:ABCDEFG', 'b:ABC'], ['b:DEF', 'c:A']])
  })

  test('측정 전(줄 경계 없음)에는 문단 단위로 넘긴다', () => {
    const blocks = [paragraph('a', 7), paragraph('b', 6)]
    const pages = paginateViewerSection(section(blocks), 0, BODY, { blockHeights: {}, tableRowHeights: {} })
    expect(pagesText(pages)).toEqual([['a:ABCDEFG'], ['b:ABCDEF']])
  })

  test('한/글이 쪽 사이에서 나눈 문단(뒤 줄 세로 위치가 되돌아감)은 새 쪽을 강제하지 않는다', () => {
    const blocks = [
      paragraph('a', 7, { layoutTop: 0 }),
      paragraph('b', 6, { layoutTop: 7000, layoutLastTop: 2000 }),
      paragraph('c', 1, { layoutTop: 3000 })
    ]
    expect(pagesText(paginateViewerSection(section(blocks), 0, BODY, measure(blocks)))).toEqual([['a:ABCDEFG', 'b:ABC'], ['b:DEF', 'c:A']])
  })
})

describe('배분 다단 줄 단위 높이 맞춤', () => {
  const balanced: ViewerColumnLayout = { type: 'BALANCED_NEWSPAPER', layout: 'LEFT', count: 2, sameSize: true, sameGap: 1000, columns: [] }
  const columnsOf = (page: ViewerPage) => pageColumnRegions(page)[0].columns.map((column) => column.map(textOf).join('|'))

  test('긴 문단 하나도 두 단에 줄 단위로 나눠 높이를 맞춘다', () => {
    const blocks = [paragraph('a', 6)]
    const pages = paginateViewerSection(section(blocks, balanced), 0, BODY, measure(blocks))
    expect(columnsOf(pages[0])).toEqual(['ABC', 'DEF'])
  })

  test('외톨이줄 보호 문단은 처음·끝 두 줄을 떼지 않는다', () => {
    const blocks = [paragraph('a', 1), paragraph('b', 4, { breakSetting: { widowOrphan: true } })]
    const pages = paginateViewerSection(section(blocks, balanced), 0, BODY, measure(blocks))
    expect(columnsOf(pages[0])).toEqual(['A|AB', 'CD'])
  })

  test('배분 단위를 되돌리면 같은 문단의 이어진 줄은 한 조각, 전체면 원본 문단이다', () => {
    const source = paragraph('a', 4)
    const lineBreaks = { a: breaksOf(4) }
    const units = balanceUnits([source], lineBreaks, (block) => block.layoutHeight)
    expect(units.map((unit) => unit.height)).toEqual([1000, 1000, 1000, 1000])
    expect(joinBalanceUnits(units, lineBreaks)).toEqual([source])
    const [head] = joinBalanceUnits(units.slice(0, 2), lineBreaks)
    expect(textOf(head)).toBe('AB')
    expect(joinBalanceUnits(units.slice(2), lineBreaks)[0].lineSplit).toMatchObject({ part: 'rest', from: 1, to: 3 })
  })
})
