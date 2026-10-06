/**
 * `<hh:strikeout shape>` 값 중 실제로 선을 그리는 값.
 *
 * 한/글 HWPX 내보내기는 취소선이 없는 글자 모양에도 `shape="3D"`를 기본값으로 쓰는 경우가 있고,
 * 한/글 뷰어는 이를 취소선으로 그리지 않는다. 그래서 OWPML 선 종류 중 실제 선 13종만 취소선으로
 * 인정하고 `NONE`, `3D`와 알 수 없는 값은 취소선 없음으로 본다(rhwp `is_real_strike_shape`와 같은 기준).
 */
const RENDERED_STRIKE_SHAPES = new Set([
  'SOLID',
  'DASH',
  'DOT',
  'DASH_DOT',
  'DASH_DOT_DOT',
  'LONG_DASH',
  'CIRCLE',
  'DOUBLE_SLIM',
  'SLIM_THICK',
  'THICK_SLIM',
  'SLIM_THICK_SLIM',
  'WAVE',
  'DOUBLE_WAVE'
])

export function isRenderedStrikeShape(shape: string | undefined): boolean {
  return shape !== undefined && RENDERED_STRIKE_SHAPES.has(shape)
}
