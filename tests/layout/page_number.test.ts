import { formatPageNumber, pageDecorationLayout, pageNumberAnchor, pageNumberPlacement, pageNumberPosition } from '../../src/core/layout/page_number'
import { viewerPageGeometry } from '../../src/core/parser/viewer_decoder'
import type { OrderedXmlNode } from '../../src/core/parser/ordered_xml'

const pageNumber = { position: 'BOTTOM_CENTER', formatType: 'DIGIT', sideChar: '-', start: 1, hiddenOnFirstPage: false }

const pagePr = (margin: Record<string, string>): OrderedXmlNode => ({
  name: 'hp:pagePr',
  attributes: { width: '59528', height: '84188' },
  children: [{ name: 'hp:margin', attributes: margin, children: [] }]
}) as unknown as OrderedXmlNode

describe('쪽 번호', () => {
  test('쪽 번호와 양옆 문자를 조합한다', () => {
    expect(formatPageNumber(pageNumber, 0)).toBe('- 1 -')
    expect(formatPageNumber(pageNumber, 7)).toBe('- 8 -')
  })

  test('첫 쪽 숨김과 위치 클래스 이름을 처리한다', () => {
    expect(formatPageNumber({ ...pageNumber, hiddenOnFirstPage: true }, 0)).toBeUndefined()
    expect(formatPageNumber({ ...pageNumber, position: 'NONE' }, 0)).toBeUndefined()
    expect(pageNumberPosition('BOTTOM_CENTER')).toBe('bottom-center')
  })

  test('위치 이름을 위·아래와 왼쪽·가운데·오른쪽으로, 안쪽·바깥쪽은 홀짝 쪽으로 정한다', () => {
    expect(pageNumberPlacement('BOTTOM_CENTER', 1)).toEqual({ vertical: 'bottom', horizontal: 'center' })
    expect(pageNumberPlacement('TOP_LEFT', 1)).toEqual({ vertical: 'top', horizontal: 'left' })
    expect(pageNumberPlacement('OUTSIDE_BOTTOM', 1)).toEqual({ vertical: 'bottom', horizontal: 'right' })
    expect(pageNumberPlacement('OUTSIDE_BOTTOM', 2)).toEqual({ vertical: 'bottom', horizontal: 'left' })
    expect(pageNumberPlacement('INSIDE_TOP', 3)).toEqual({ vertical: 'top', horizontal: 'left' })
    expect(pageNumberPlacement('INSIDE_TOP', 4)).toEqual({ vertical: 'top', horizontal: 'right' })
    expect(pageNumberPlacement('NONE', 1)).toBeUndefined()
  })
})

describe('쪽 본문·머리말·꼬리말 띠', () => {
  // 위쪽 2834·머리말 1417·아래쪽 1417·꼬리말 1417(실제 보도자료 양식과 같은 여백).
  const { page } = viewerPageGeometry(pagePr({ left: '5669', right: '5669', top: '2834', bottom: '1417', header: '1417', footer: '1417' }))

  test('decoder는 본문 여백을 위쪽 + 머리말, 아래쪽 + 꼬리말로 읽는다', () => {
    expect(page.margin).toEqual({ left: 5669, right: 5669, top: 2834 + 1417, bottom: 1417 + 1417 })
    expect(page.headerOffset).toBe(1417)
    expect(page.footerOffset).toBe(1417)
  })

  test('여백 합이 용지보다 크면 머리말·꼬리말 띠를 0으로 본다', () => {
    const broken = viewerPageGeometry(pagePr({ left: '0', right: '0', top: '40000', bottom: '40000', header: '5000', footer: '5000' })).page
    expect(broken.margin.top).toBe(40000)
    expect(broken.headerOffset).toBe(0)
  })

  test('머리말 띠는 위쪽 여백 아래, 꼬리말 띠는 본문 아래 끝에서 시작한다', () => {
    const layout = pageDecorationLayout(page)
    expect(layout.header).toEqual({ top: 2834, height: 1417 })
    expect(layout.footer).toEqual({ top: 84188 - 2834, height: 1417 })
    expect(layout.body).toEqual({ left: 5669, width: 59528 - 5669 * 2, top: 4251, bottom: 84188 - 2834 })
  })

  test('아래쪽 쪽 번호는 본문 밖 꼬리말 띠 아래 끝, 위쪽은 머리말 띠 위 끝에 맞춘다', () => {
    const bottom = pageNumberAnchor(page, { vertical: 'bottom', horizontal: 'center' })
    expect(bottom).toEqual({ y: 84188 - 1417, edge: 'bottom', x: 59528 / 2, align: 'center' })
    // 상자 아래 끝이 본문 아래 끝보다 아래(꼬리말 띠 안)라 본문 글과 겹치지 않는다.
    expect(bottom.y).toBeGreaterThan(pageDecorationLayout(page).body.bottom)
    expect(pageNumberAnchor(page, { vertical: 'top', horizontal: 'right' })).toEqual({ y: 2834, edge: 'top', x: 59528 - 5669, align: 'right' })
  })

  test('꼬리말·머리말 띠가 없으면 아래쪽·위쪽 여백 가운데에 둔다', () => {
    const { page: bare } = viewerPageGeometry(pagePr({ left: '5668', right: '4252', top: '5668', bottom: '4252', header: '0', footer: '0' }))
    expect(pageNumberAnchor(bare, { vertical: 'bottom', horizontal: 'left' })).toEqual({ y: 84188 - 2126, edge: 'middle', x: 5668, align: 'left' })
    expect(pageNumberAnchor(bare, { vertical: 'top', horizontal: 'left' })).toEqual({ y: 2834, edge: 'middle', x: 5668, align: 'left' })
  })
})
