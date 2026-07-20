import { HwpxPackageIndex } from '../../src/core/parser/package_reader'
import { PROGRESSIVE_SECTION_BYTES, shouldLoadProgressively } from '../../src/core/parser/progressive_loading'

function index(sectionSizes: number[]): HwpxPackageIndex {
  const sectionPaths = sectionSizes.map((_, sectionIndex) => `Contents/section${sectionIndex}.xml`)
  return {
    mimetype: 'application/hwp+zip',
    headerPath: 'Contents/header.xml',
    sectionPaths,
    sectionSizes: Object.fromEntries(sectionPaths.map((path, sectionIndex) => [path, sectionSizes[sectionIndex]])),
    resourcePaths: []
  }
}

describe('점진 로딩 판정', () => {
  test('section 수가 많은 문서를 점진 로딩한다', () => {
    expect(shouldLoadProgressively(index(Array.from({ length: 20 }, () => 1000)))).toBe(true)
  })

  test('하나의 큰 section도 점진 로딩한다', () => {
    expect(shouldLoadProgressively(index([PROGRESSIVE_SECTION_BYTES]))).toBe(true)
  })

  test('작은 기준 문서는 기존 전체 로딩 경로를 유지한다', () => {
    expect(shouldLoadProgressively(index([1000, 2000, 3000]))).toBe(false)
  })
})
