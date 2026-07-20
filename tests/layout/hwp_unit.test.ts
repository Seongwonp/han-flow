import { hwpUnitToCssPx, hwpUnitToMm } from '../../src/core/layout/hwp_unit'

describe('HWPUNIT 변환', () => {
  test('7200 HWPUNIT는 1인치다', () => {
    expect(hwpUnitToMm(7200)).toBeCloseTo(25.4, 8)
    expect(hwpUnitToCssPx(7200)).toBeCloseTo(96, 8)
  })

  test('A4 크기를 올바르게 변환한다', () => {
    expect(hwpUnitToMm(59528)).toBeCloseTo(210, 0)
    expect(hwpUnitToMm(84188)).toBeCloseTo(297, 0)
  })
})
