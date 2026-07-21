import { formatPageNumber, pageNumberPosition } from '../../src/core/layout/page_number'

const pageNumber = { position: 'BOTTOM_CENTER', formatType: 'DIGIT', sideChar: '-', start: 1, hiddenOnFirstPage: false }

describe('쪽 번호', () => {
  test('쪽 번호와 양옆 문자를 조합한다', () => {
    expect(formatPageNumber(pageNumber, 0)).toBe('- 1 -')
    expect(formatPageNumber(pageNumber, 7)).toBe('- 8 -')
  })

  test('첫 쪽 숨김과 위치 클래스 이름을 처리한다', () => {
    expect(formatPageNumber({ ...pageNumber, hiddenOnFirstPage: true }, 0)).toBeUndefined()
    expect(pageNumberPosition('BOTTOM_CENTER')).toBe('bottom-center')
  })
})
