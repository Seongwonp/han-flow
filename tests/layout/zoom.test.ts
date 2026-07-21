import { clampZoom, pinchZoom, stepZoom } from '../../src/core/layout/zoom'

describe('뷰어 확대/축소', () => {
  test('버튼과 단축키 확대 단계를 범위 안으로 제한한다', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(0.5, -1)).toBe(0.5)
    expect(stepZoom(2, 1)).toBe(2)
  })

  test('트랙패드 delta를 연속 zoom 값으로 바꾼다', () => {
    expect(pinchZoom(1, -10)).toBeGreaterThan(1)
    expect(pinchZoom(1, 10)).toBeLessThan(1)
    expect(clampZoom(10)).toBe(2)
  })
})
