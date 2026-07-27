import {
  fixedPageOffsets,
  fixedPageVirtualRange
} from '../../src/core/layout/fixed_page_virtualization'
import { FixedPageDescriptor } from '../../src/core/document/fixed_page_document'

const pages = Array.from({ length: 100 }, (_, index): FixedPageDescriptor => ({
  index,
  sectionIndex: index < 50 ? 0 : 1,
  width: index === 50 ? 1122 : 794,
  height: index === 50 ? 794 : 1122
}))

test('세로·가로 용지가 섞인 fixed-page 누적 위치를 계산한다', () => {
  const offsets = fixedPageOffsets(pages.slice(49, 52))
  expect(offsets).toEqual([0, 1146, 1964, 3110])
})

test('현재 viewport 주변 페이지만 overscan해 mount한다', () => {
  const offsets = fixedPageOffsets(pages)
  const target = 50
  const range = fixedPageVirtualRange(pages, offsets[target] * 1.25, 900, 1.25)
  expect(range.start).toBe(48)
  expect(range.end).toBe(53)
  expect(range.topSpacer).toBe(offsets[48])
  expect(range.bottomSpacer).toBe(offsets[pages.length] - offsets[53])
})
