import { ViewerParagraph, ViewerTableCell, ViewerTableRow } from '../../src/core/document/viewer_document'
import { findSplittableCell, preservesParagraphOrder, splitCellParagraphs } from '../../src/core/layout/cell_fragment'

const paragraph = (id: string, layoutHeight: number): ViewerParagraph => ({
  id, paraStyleId: '0', pageBreak: false, layoutHeight, content: []
})

const cell = (paragraphs: ViewerParagraph[], overrides: Partial<ViewerTableCell> = {}): ViewerTableCell => ({
  row: 0, column: 0, rowSpan: 1, columnSpan: 1, width: 6000, height: 9000,
  margin: { top: 100, right: 100, bottom: 200, left: 100 }, header: false, paragraphs,
  ...overrides
})

describe('표 셀 문단 분할', () => {
  const paragraphs = [paragraph('p0', 1000), paragraph('p1', 1200), paragraph('p2', 1400), paragraph('p3', 1600)]
  const heights = { p0: 900, p1: 1100, p2: 1300, p3: 1500 }

  test('측정 높이와 셀 위 padding으로 head를 채우고 순서를 보존한다', () => {
    const split = splitCellParagraphs(cell(paragraphs), 2200, heights)
    expect(split).toBeDefined()
    expect(split?.head.map(({ id }) => id)).toEqual(['p0', 'p1'])
    expect(split?.tail.map(({ id }) => id)).toEqual(['p2', 'p3'])
    expect(split).toMatchObject({ headHeight: 2100, tailHeight: 3000 })
    expect(preservesParagraphOrder(paragraphs, split!)).toBe(true)
  })

  test('첫 문단이 들어가지 않거나 모든 문단이 들어가면 분할하지 않는다', () => {
    expect(splitCellParagraphs(cell(paragraphs), 900, heights)).toBeUndefined()
    expect(splitCellParagraphs(cell(paragraphs), 6000, heights)).toBeUndefined()
  })

  test('측정값이 없거나 유효하지 않으면 선언 높이를 안전하게 사용한다', () => {
    const split = splitCellParagraphs(cell(paragraphs), 2400, { p0: Number.NaN })
    expect(split?.head.map(({ id }) => id)).toEqual(['p0', 'p1'])
  })

  test('행에서 넘치는 셀이 정확히 하나일 때만 선택한다', () => {
    const short = cell([paragraph('short', 500)], { column: 1 })
    const row: ViewerTableRow = { cells: [cell(paragraphs), short] }
    const result = findSplittableCell(row, 2500, heights)
    expect(result?.cellIndex).toBe(0)
    expect(result && preservesParagraphOrder(paragraphs, result)).toBe(true)

    const twoTall: ViewerTableRow = { cells: [cell(paragraphs), cell(paragraphs, { column: 1 })] }
    expect(findSplittableCell(twoTall, 2500, heights)).toBeUndefined()
  })

  test('rowSpan 참여 행과 위쪽 rowSpan에 덮인 행은 fallback한다', () => {
    expect(findSplittableCell({ cells: [cell(paragraphs, { rowSpan: 2 })] }, 2500, heights)).toBeUndefined()
    expect(findSplittableCell({ cells: [cell(paragraphs)] }, 2500, heights, true)).toBeUndefined()
  })

  test('하나의 초대형 문단은 쪼개지 않고 overflow 판단에 맡긴다', () => {
    const huge = cell([paragraph('huge', 10000)])
    expect(findSplittableCell({ cells: [huge] }, 2500, {})).toBeUndefined()
  })
})
