import {
  FixedPagePrintReadiness,
  isFixedPagePrintReady
} from '../../src/renderer/src/pdf_print_readiness'

function state(overrides: Partial<FixedPagePrintReadiness> = {}): FixedPagePrintReadiness {
  return {
    expectedPages: 7,
    pageCount: 7,
    readyPages: 7,
    imageCount: 7,
    decodedImages: 7,
    ...overrides
  }
}

test('모든 HWP 인쇄 페이지와 이미지가 준비된 뒤에만 PDF 출력을 허용한다', () => {
  expect(isFixedPagePrintReady(state())).toBe(true)
  expect(isFixedPagePrintReady(state({ pageCount: 6 }))).toBe(false)
  expect(isFixedPagePrintReady(state({ readyPages: 6 }))).toBe(false)
  expect(isFixedPagePrintReady(state({ imageCount: 6 }))).toBe(false)
  expect(isFixedPagePrintReady(state({ decodedImages: 6 }))).toBe(false)
})

test('빈 문서는 HWP PDF 준비 완료로 취급하지 않는다', () => {
  expect(isFixedPagePrintReady(state({
    expectedPages: 0,
    pageCount: 0,
    readyPages: 0,
    imageCount: 0,
    decodedImages: 0
  }))).toBe(false)
})
