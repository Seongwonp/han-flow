import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ViewerColumnLayout,
  viewerColumnContentWidth,
  viewerColumnWidths,
  ViewerNote,
  ViewerObjectPlaceholder,
  ViewerParagraph,
  ViewerSection
} from '../../src/core/document/viewer_document'
import {
  balancedColumnStarts,
  columnMeasurementGroups,
  columnRects,
  columnSeparators,
  columnsRightToLeft,
  columnWidthKey
} from '../../src/core/layout/column_layout'
import { regionPageBands } from '../../src/core/layout/object_position'
import {
  LayoutMeasurements,
  pageColumnRegions,
  paginateViewerDocument,
  paginateViewerSection,
  paginateViewerSectionsIncremental,
  ViewerPage
} from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { columnGridTracks, ViewerColumnFlow } from '../../src/renderer/src/ViewerShell'
import { COLUMN_LAYOUT_EXPECTED, COLUMN_LAYOUT_PAGE, createColumnLayoutHwpx } from '../fixtures/public/create_synthetic_hwpx'

const layout = (overrides: Partial<ViewerColumnLayout> = {}): ViewerColumnLayout => ({
  type: 'NEWSPAPER',
  layout: 'LEFT',
  count: 2,
  sameSize: true,
  sameGap: 1000,
  columns: [],
  ...overrides
})

const block = (id: string, layoutHeight = 1000, extra: Partial<ViewerParagraph> = {}): ViewerParagraph => ({
  id, paraStyleId: '0', pageBreak: false, layoutHeight, content: [{ type: 'text', text: id, charStyleId: '0' }], ...extra
})

const section = (blocks: ViewerParagraph[], columnLayout?: ViewerColumnLayout): ViewerSection => ({
  id: 'section-0', blocks, headers: [], footers: [], ...(columnLayout ? { columnLayout } : {})
})

const PAGE = { width: 21000, height: 12000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } }
const BODY_WIDTH = 19000
const BODY_HEIGHT = 10000

/** 쪽마다 영역별·단별 block id. */
const layoutIds = (pages: ViewerPage[]) => pages.map((page) => pageColumnRegions(page).map((region) => region.columns.map((column) => column.map(({ id }) => id))))

describe('다단 단 배치 계산', () => {
  test('같은 너비 단은 공통 간격을 빼고 똑같이 나눈다', () => {
    expect(viewerColumnWidths(10000, layout({ count: 2, sameGap: 600 }))).toEqual({ widths: [4700, 4700], gaps: [600, 0] })
    expect(viewerColumnContentWidth(10000, layout({ count: 3, sameGap: 500 }))).toBeCloseTo(3000)
    // 단이 하나면 본문 폭 그대로다.
    expect(viewerColumnWidths(10000, layout({ count: 1 }))).toEqual({ widths: [10000], gaps: [0] })
    expect(viewerColumnWidths(10000, undefined)).toEqual({ widths: [10000], gaps: [0] })
  })

  test('서로 다른 너비(hp:colSz)는 비율 값을 본문 폭에 맞춰 늘린다', () => {
    // 한/글 원본(ext-hwpxlib-multi-column)의 비율 값: 합이 32768이고, 본문 폭 42520에서 첫 단 줄 폭(horzsize)은 8502다.
    const ratios = layout({ count: 3, sameSize: false, sameGap: 0, columns: [{ width: 6552, gap: 873 }, { width: 12234, gap: 873 }, { width: 12236, gap: 0 }] })
    const { widths, gaps } = viewerColumnWidths(42520, ratios)
    expect(Math.round(widths[0])).toBe(8502)
    expect(Math.round(widths[1])).toBe(15875)
    expect(widths.reduce((sum, width) => sum + width, 0) + gaps.reduce((sum, gap) => sum + gap, 0)).toBeCloseTo(42520)
    // 절대 값이 본문 폭과 같으면 그대로 쓴다. 마지막 단 뒤 간격은 없다.
    const absolute = layout({ sameSize: false, columns: [{ width: 6000, gap: 1000 }, { width: 12000, gap: 700 }] })
    expect(viewerColumnWidths(19000, absolute)).toEqual({ widths: [6000, 12000], gaps: [1000, 0] })
  })

  test('선언이 모자란 서로 다른 너비 단은 평균 너비로 채운다', () => {
    const partial = layout({ count: 3, sameSize: false, sameGap: 500, columns: [{ width: 4000, gap: 500 }] })
    const { widths, gaps } = viewerColumnWidths(13000, partial)
    expect(widths).toEqual([4000, 4000, 4000])
    expect(gaps).toEqual([500, 500, 0])
  })

  test('LEFT는 왼쪽부터, RIGHT는 오른쪽부터 단을 놓는다', () => {
    const left = columnRects(layout(), BODY_WIDTH)
    expect(left).toEqual([{ left: 0, width: 9000 }, { left: 10000, width: 9000 }])
    const right = columnRects(layout({ layout: 'RIGHT' }), BODY_WIDTH)
    expect(right).toEqual([{ left: 10000, width: 9000 }, { left: 0, width: 9000 }])
    expect(columnRects(undefined, BODY_WIDTH)).toEqual([{ left: 0, width: BODY_WIDTH }])
  })

  test('MIRROR는 홀수 쪽은 왼쪽부터, 짝수 쪽은 오른쪽부터 놓는다', () => {
    const mirror = layout({ layout: 'MIRROR' })
    expect(columnsRightToLeft(mirror, 1)).toBe(false)
    expect(columnsRightToLeft(mirror, 2)).toBe(true)
    expect(columnRects(mirror, BODY_WIDTH, 3)[0].left).toBe(0)
    expect(columnRects(mirror, BODY_WIDTH, 4)[0].left).toBe(10000)
  })

  test('서로 다른 너비 단을 오른쪽부터 놓으면 첫 단이 오른쪽 끝에 붙고 단 뒤 간격이 왼쪽으로 간다', () => {
    const unequal = layout({ layout: 'RIGHT', sameSize: false, columns: [{ width: 6000, gap: 1000 }, { width: 12000, gap: 0 }] })
    expect(columnRects(unequal, BODY_WIDTH)).toEqual([{ left: 13000, width: 6000 }, { left: 0, width: 12000 }])
    expect(columnRects({ ...unequal, layout: 'LEFT' }, BODY_WIDTH)).toEqual([{ left: 0, width: 6000 }, { left: 7000, width: 12000 }])
  })

  test('구분선은 이웃한 단 사이 간격 한가운데에 놓고 선 종류가 없으면 그리지 않는다', () => {
    const line = { type: 'SOLID', widthMm: 0.12, color: '#000000' }
    expect(columnSeparators(layout({ line }), BODY_WIDTH)).toEqual([{ x: 9500 }])
    expect(columnSeparators(layout({ line, layout: 'RIGHT' }), BODY_WIDTH)).toEqual([{ x: 9500 }])
    expect(columnSeparators(layout({ count: 3, sameGap: 500, line }), 10000)).toEqual([{ x: 3250 }, { x: 6750 }])
    const unequal = layout({ sameSize: false, line, columns: [{ width: 6000, gap: 1000 }, { width: 12000, gap: 0 }] })
    expect(columnSeparators(unequal, BODY_WIDTH)).toEqual([{ x: 6500 }])
    expect(columnSeparators(layout({ line: { ...line, type: 'NONE' } }), BODY_WIDTH)).toEqual([])
    expect(columnSeparators(layout(), BODY_WIDTH)).toEqual([])
  })

  test('배분은 가장 높은 단이 가장 낮아지게 순서대로 나눈다', () => {
    const heights = [1000, 1000, 1000, 1000, 1000, 1000]
    expect(balancedColumnStarts(6, 2, (_column, index) => heights[index])).toEqual([0, 3])
    expect(balancedColumnStarts(6, 3, (_column, index) => heights[index])).toEqual([0, 2, 4])
    // 큰 block 하나는 나누지 않는다.
    const uneven = [3000, 500, 500, 500, 500]
    expect(balancedColumnStarts(5, 2, (_column, index) => uneven[index])).toEqual([0, 1])
    // 넓은 둘째 단은 같은 문단이 낮아지므로 더 많이 받는다.
    expect(balancedColumnStarts(6, 2, (column) => column === 0 ? 2000 : 1000)).toEqual([0, 2])
    expect(balancedColumnStarts(0, 2, () => 1000)).toEqual([0, 0])
    expect(balancedColumnStarts(2, 3, () => 1000)).toEqual([0, 1, 2])
  })

  test('측정 묶음은 다단 정의마다 첫 단 너비로 재고 다른 너비 단을 한 번 더 잰다', () => {
    const unequal = layout({ sameSize: false, columns: [{ width: 6000, gap: 1000 }, { width: 12000, gap: 0 }] })
    const blocks = [block('a'), block('b', 1000, { columnLayout: unequal }), block('c'), block('d', 1000, { columnLayout: layout({ count: 1 }) })]
    const groups = columnMeasurementGroups(section(blocks), BODY_WIDTH)
    expect(groups.map((group) => ({ ids: group.blocks.map(({ id }) => id), width: group.width, extra: group.extraWidths }))).toEqual([
      { ids: ['a'], width: BODY_WIDTH, extra: [] },
      { ids: ['b', 'c'], width: 6000, extra: [12000] },
      { ids: ['d'], width: BODY_WIDTH, extra: [] }
    ])
    // 같은 너비 다단 하나면 묶음 하나다(측정 DOM이 이전과 같다).
    expect(columnMeasurementGroups(section(blocks.slice(0, 1), layout()), BODY_WIDTH)).toEqual([{ blocks: [blocks[0]], layout: layout(), width: 9000, extraWidths: [] }])
    expect(columnWidthKey(8501.9)).toBe('8502')
  })

  test('쪽 띠를 다단 영역 기준으로 옮기고 자른다', () => {
    const bands = [{ top: 0, bottom: 1000 }, { top: 3000, bottom: 5000 }]
    expect(regionPageBands(bands, 0, Infinity)).toEqual(bands)
    expect(regionPageBands(bands, 2000, 2000)).toEqual([{ top: 1000, bottom: 2000 }])
    expect(regionPageBands(bands, 6000, Infinity)).toBeUndefined()
    expect(regionPageBands(undefined, 0, Infinity)).toBeUndefined()
  })
})

describe('다단 pagination', () => {
  test('같은 너비 다단은 단을 채운 뒤 다음 쪽으로 가고 LEFT·RIGHT·MIRROR는 흐름 순서가 같다', () => {
    const blocks = Array.from({ length: 5 }, (_, index) => block(`p${index}`, 4000))
    for (const placement of ['LEFT', 'RIGHT', 'MIRROR']) {
      const pages = paginateViewerSection(section(blocks, layout({ layout: placement })), 0, BODY_HEIGHT, undefined, PAGE)
      expect(pages.map((page) => page.columns?.map((column) => column.map(({ id }) => id)))).toEqual([
        [['p0', 'p1'], ['p2', 'p3']],
        [['p4'], []]
      ])
      expect(pages[0].regions).toBeUndefined()
    }
  })

  test('단 나눔은 다음 단으로, 마지막 단의 단 나눔은 다음 쪽으로 간다', () => {
    const blocks = [block('a'), block('b', 1000, { columnBreak: true }), block('c', 1000, { columnBreak: true })]
    const pages = paginateViewerSection(section(blocks, layout()), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds(pages)).toEqual([[[['a'], ['b']]], [[['c'], []]]])
    // 한 단에서는 단 나눔을 무시한다(이전과 같다).
    expect(paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)).toHaveLength(1)
  })

  test('구역 중간 새 다단 정의는 같은 쪽 아래에 새 영역을 열고 앞 다단 영역 높이를 맞춘다', () => {
    const two = layout()
    const blocks = [
      block('title', 1000),
      block('m1', 1000, { columnLayout: two }), block('m2'), block('m3'), block('m4'), block('m5'), block('m6'),
      block('tail', 1000, { columnLayout: layout({ count: 1 }) })
    ]
    const pages = paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)
    expect(pages).toHaveLength(1)
    const [page] = pages
    expect(page.columns).toBeUndefined()
    expect(page.regions?.map((region) => ({ top: region.top, height: region.height, count: region.columnLayout?.count ?? 1 }))).toEqual([
      { top: 0, height: 1000, count: 1 },
      { top: 1000, height: 3000, count: 2 },
      { top: 4000, height: undefined, count: 1 }
    ])
    expect(layoutIds(pages)).toEqual([[[['title']], [['m1', 'm2', 'm3'], ['m4', 'm5', 'm6']], [['tail']]]])
    expect(page.blocks.map(({ id }) => id)).toEqual(blocks.map(({ id }) => id))
  })

  test('새 다단 정의가 쪽 나눔과 함께 오면 다음 쪽 위에서 영역을 시작한다', () => {
    const blocks = [block('a'), block('b', 1000, { pageBreak: true, columnLayout: layout() }), block('c', 1000, { columnBreak: true })]
    const pages = paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds(pages)).toEqual([[[['a']]], [[['b'], ['c']]]])
    expect(pages[1].columns).toHaveLength(2)
  })

  test('새 영역이 남은 높이에 들어가지 않으면 다음 쪽으로 넘기고 글을 잃지 않는다', () => {
    const blocks = [block('long', 9500), block('x', 1000, { columnLayout: layout() }), block('y', 1000)]
    const pages = paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)
    expect(pages.flatMap((page) => page.blocks.map(({ id }) => id))).toEqual(['long', 'x', 'y'])
    expect(pages).toHaveLength(2)
    // 다음 쪽에서는 쪽 위에서 시작한다.
    expect(pageColumnRegions(pages[1])[0].top).toBe(0)
  })

  test('단 나눔으로 단을 넘긴 영역은 새 영역이 와도 높이를 맞추지 않는다', () => {
    const blocks = [
      block('m1', 1000, { columnLayout: layout() }), block('m2'), block('m3'), block('m4', 1000, { columnBreak: true }),
      block('tail', 1000, { columnLayout: layout({ count: 1 }) })
    ]
    const [page] = paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds([page])).toEqual([[[['m1', 'm2', 'm3'], ['m4']], [['tail']]]])
    expect(page.regions?.[1].top).toBe(3000)
  })

  test('배분 다단은 구역 끝 쪽의 단 높이를 맞추고 일반 다단은 맞추지 않는다', () => {
    const blocks = Array.from({ length: 6 }, (_, index) => block(`b${index}`))
    const balanced = paginateViewerSection(section(blocks, layout({ type: 'BALANCED_NEWSPAPER', count: 3 })), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds(balanced)).toEqual([[[['b0', 'b1'], ['b2', 'b3'], ['b4', 'b5']]]])
    const newspaper = paginateViewerSection(section(blocks, layout({ count: 3 })), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds(newspaper)).toEqual([[[['b0', 'b1', 'b2', 'b3', 'b4', 'b5'], [], []]]])
    // 앞 쪽은 단을 다 채우고 마지막 쪽만 맞춘다.
    const many = Array.from({ length: 24 }, (_, index) => block(`m${index}`))
    const pages = paginateViewerSection(section(many, layout({ type: 'BALANCED_NEWSPAPER' })), 0, BODY_HEIGHT, undefined, PAGE)
    expect(pages.map((page) => page.columns?.map((column) => column.length))).toEqual([[10, 10], [2, 2]])
  })

  test('평행 다단은 마지막 단의 단 나눔에서 같은 쪽 가장 긴 단 아래에 새 줄을 시작한다', () => {
    const parallel = layout({ type: 'PARALLEL' })
    const blocks = [
      block('a1', 2000), block('b1', 1000, { columnBreak: true }),
      block('a2', 1000, { columnBreak: true }), block('b2', 1000, { columnBreak: true })
    ]
    const [page, ...rest] = paginateViewerSection(section(blocks, parallel), 0, BODY_HEIGHT, undefined, PAGE)
    expect(rest).toHaveLength(0)
    expect(layoutIds([page])).toEqual([[[['a1'], ['b1']], [['a2'], ['b2']]]])
    expect(page.regions?.map((region) => region.top)).toEqual([0, 2000])
  })

  test('서로 다른 너비 단은 그 단 너비로 잰 높이를 쓴다', () => {
    const unequal = layout({ sameSize: false, sameGap: 0, columns: [{ width: 6000, gap: 1000 }, { width: 12000, gap: 0 }] })
    const blocks = Array.from({ length: 12 }, (_, index) => block(`u${index}`))
    // 좁은 첫 단에서는 2000, 넓은 둘째 단에서는 1000.
    const measurements: LayoutMeasurements = {
      blockHeights: Object.fromEntries(blocks.map(({ id }) => [id, 2000])),
      tableRowHeights: {},
      columnHeights: { [columnWidthKey(12000)]: { blockHeights: Object.fromEntries(blocks.map(({ id }) => [id, 1000])), tableRowHeights: {} } }
    }
    const pages = paginateViewerSection(section(blocks, unequal), 0, BODY_HEIGHT, measurements, PAGE)
    expect(pages.map((page) => page.columns?.map((column) => column.length))).toEqual([[5, 7]])
    // 쪽 크기를 모르면 첫 단 높이만 쓴다.
    expect(paginateViewerSection(section(blocks, unequal), 0, BODY_HEIGHT, measurements).map((page) => page.columns?.map((column) => column.length))).toEqual([[5, 5], [2, 0]])
  })

  test('각주가 있는 다단 영역은 높이를 맞추지 않고 각주는 마지막 영역 단 아래에 둔다', () => {
    const note: ViewerNote = { kind: 'footnote', marker: '1)', sourcePath: 'Contents/section0.xml#hp:footNote:1', paragraphs: [block('n1:p0', 500)] }
    const marker: ViewerObjectPlaceholder = { type: 'object-placeholder', kind: 'footnote', element: 'hp:footNote', sourcePath: note.sourcePath, flow: 'marker', label: '각주', marker: note.marker, note }
    const blocks = [
      block('m1', 1000, { columnLayout: layout() }),
      { ...block('m2'), content: [...block('m2').content, marker] },
      block('m3'),
      block('tail', 1000, { columnLayout: layout({ count: 1 }) })
    ]
    const [page] = paginateViewerSection(section(blocks), 0, BODY_HEIGHT, undefined, PAGE)
    expect(layoutIds([page])).toEqual([[[['m1', 'm2', 'm3'], []], [['tail']]]])
    expect(page.footnotes).toHaveLength(1)
    expect(page.footnotes?.[0].map((footnote) => footnote.note.sourcePath)).toEqual([note.sourcePath])
  })

  test('측정값의 원본 줄 배치가 위로 되돌아가면 다음 단으로 간다', () => {
    const blocks = [block('a', 1000, { layoutTop: 0 }), block('b', 1000, { layoutTop: 1600 }), block('c', 1000, { layoutTop: 0 })]
    const measurements: LayoutMeasurements = { blockHeights: { a: 1000, b: 1000, c: 1000 }, tableRowHeights: {} }
    const pages = paginateViewerSection(section(blocks, layout({ type: 'BALANCED_NEWSPAPER' })), 0, BODY_HEIGHT, measurements, PAGE)
    // 원본 단 나눔을 따르므로 배분으로 다시 나누지 않는다.
    expect(layoutIds(pages)).toEqual([[[['a', 'b'], ['c']]]])
  })

  test('화면 높이가 커서 이미 다음 단으로 넘쳤으면 원본의 다음 단 시작을 그 단이 받는다', () => {
    // 원본은 단마다 4문단(줄 배치 0·1600·3200·4800)이지만 화면에서는 3문단만 들어간다.
    const blocks = Array.from({ length: 8 }, (_, index) => block(`s${index}`, 1600, { layoutTop: (index % 4) * 1600 }))
    const measurements: LayoutMeasurements = { blockHeights: Object.fromEntries(blocks.map(({ id }) => [id, 3000])), tableRowHeights: {} }
    const pages = paginateViewerSection(section(blocks, layout({ count: 3 })), 0, BODY_HEIGHT, measurements, PAGE)
    // 넘친 s3만 든 단을 만들지 않고 s3 뒤에 원본 둘째 단(s4~)을 잇는다.
    expect(layoutIds(pages)).toEqual([[[['s0', 's1', 's2'], ['s3', 's4', 's5'], ['s6', 's7']]]])
  })

  test('section별 증분 pagination은 다단 영역이 있어도 전체 pagination과 같다', () => {
    const sections = [
      section([block('a'), block('b', 1000, { columnLayout: layout() }), block('c'), block('d', 1000, { columnLayout: layout({ count: 1 }) })]),
      section(Array.from({ length: 4 }, (_, index) => block(`s1p${index}`)), layout({ type: 'BALANCED_NEWSPAPER' }))
    ]
    const document = { page: { ...PAGE, headerOffset: 0, footerOffset: 0 }, sections }
    const full = paginateViewerDocument({ ...document, fonts: {}, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {}, diagnostics: [] })
    const incremental = paginateViewerSectionsIncremental(document, () => undefined)
    expect(incremental.pages).toEqual(full)
    const next = paginateViewerSectionsIncremental(document, () => undefined, incremental.sections)
    expect(next.reused).toBe(2)
  })
})

describe('다단 decoder·렌더링', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-column-layout-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('hp:colSz·hp:colLine과 문단 안 새 다단 정의를 읽는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(createColumnLayoutHwpx(directory)))
    expect(document.sections.map((item) => item.columnLayout?.count)).toEqual([1, 2, 2, 3, 2])
    const middle = document.sections[0].blocks[1].columnLayout
    expect(middle).toEqual({
      type: 'NEWSPAPER', layout: 'LEFT', count: 2, sameSize: false, sameGap: 0,
      columns: [{ width: 9000, gap: 1500 }, { width: 16500, gap: 0 }],
      line: { type: 'SOLID', widthMm: 0.12, color: '#3355AA' }
    })
    expect(document.sections[0].blocks[7].columnLayout?.count).toBe(1)
    expect(document.sections[0].blocks.filter((item) => item.columnLayout)).toHaveLength(2)
    expect(document.sections[1].columnLayout).toMatchObject({ layout: 'RIGHT', line: { type: 'DASH', widthMm: 0.4, color: '#AA3333' } })
    const codes = document.diagnostics.map((item) => item.code)
    expect(codes).toContain('HWPX_PARALLEL_COLUMN_APPROXIMATED')
    expect(codes.filter((code) => code?.includes('COLUMN'))).toEqual(['HWPX_PARALLEL_COLUMN_APPROXIMATED'])
  })

  test('합성 다단 문서의 글이 기대한 쪽·영역·단에 놓인다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(createColumnLayoutHwpx(directory, 'pagination.hwpx')))
    const pages = paginateViewerDocument(document)
    expect(pages).toHaveLength(COLUMN_LAYOUT_EXPECTED.pages)
    const bodyWidth = COLUMN_LAYOUT_PAGE.width - COLUMN_LAYOUT_PAGE.margin * 2
    for (const expected of COLUMN_LAYOUT_EXPECTED.columns) {
      const page = pages[expected.page - 1]
      const region = pageColumnRegions(page)[expected.region]
      const text = (paragraph: ViewerParagraph) => paragraph.content.map((item) => item.type === 'text' ? item.text : '').join('')
      expect({ text: expected.text, found: region.columns[expected.column].some((paragraph) => text(paragraph) === expected.text) }).toEqual({ text: expected.text, found: true })
      const rect = columnRects(region.columnLayout, bodyWidth, expected.page)[expected.column]
      expect({ text: expected.text, left: COLUMN_LAYOUT_PAGE.margin + rect.left, width: rect.width }).toEqual({ text: expected.text, left: expected.left, width: expected.width })
    }
    for (const rule of COLUMN_LAYOUT_EXPECTED.rules) {
      const region = pageColumnRegions(pages[rule.page - 1])[rule.region]
      expect(columnSeparators(region.columnLayout, bodyWidth, rule.page).map(({ x }) => COLUMN_LAYOUT_PAGE.margin + x)).toEqual([rule.x])
    }
  })

  test('한/글 비율 단 너비 원본은 첫 단 줄 폭과 같은 너비로 놓는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(resolve(__dirname, '../fixtures/public/external/ext-hwpxlib-multi-column.hwpx')))
    const columnLayout = document.sections[0].columnLayout!
    const bodyWidth = document.page.width - document.page.margin.left - document.page.margin.right
    expect(columnRects(columnLayout, bodyWidth).map((rect) => Math.round(rect.width))).toEqual([8502, 15875, 15878])
    expect(document.diagnostics).toEqual([])
  })

  test('단 범위대로 grid track과 구분선을 그리고 DOM은 흐름 순서다', () => {
    expect(columnGridTracks([{ left: 210, width: 170 }, { left: 0, width: 170 }])).toEqual({ template: '170px 40px 170px', tracks: [3, 1] })
    expect(columnGridTracks([{ left: 0, width: 120 }, { left: 140, width: 220 }])).toEqual({ template: '120px 20px 220px', tracks: [1, 3] })
    const markup = renderToStaticMarkup(createElement(ViewerColumnFlow, {
      columns: [[createElement('p', { key: 'first' }, '첫 단')], [createElement('p', { key: 'second' }, '둘째 단')]],
      rects: [{ left: 210, width: 170 }, { left: 0, width: 170 }],
      rules: [{ x: 190, width: 1, style: 'dashed', color: '#AA3333' }],
      height: '100%'
    }))
    expect(markup).toContain('grid-template-columns:170px 40px 170px')
    expect(markup).toContain('grid-column:3')
    expect(markup).toContain('viewer-column-rule')
    expect(markup).toContain('border-left:1px dashed #AA3333')
    expect(markup).toContain('height:100%')
    expect(markup.indexOf('첫 단')).toBeLessThan(markup.indexOf('둘째 단'))
  })
})
