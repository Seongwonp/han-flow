import { normalizeFontName, resolveDocumentFonts } from '../../src/core/fonts/font_resolver'

describe('문서 글꼴 해석', () => {
  test('font-list의 따옴표를 제거한다', () => {
    expect(normalizeFontName('"Apple SD Gothic Neo"')).toBe('Apple SD Gothic Neo')
  })

  test('설치된 글꼴은 그대로 사용한다', () => {
    expect(resolveDocumentFonts(['함초롬바탕'], ['"함초롬바탕"'])).toEqual({
      함초롬바탕: { requested: '함초롬바탕', resolved: '함초롬바탕', substituted: false }
    })
  })

  test('macOS가 돌려준 함초롬체 영문 family 이름을 같은 글꼴로 인식한다', () => {
    expect(resolveDocumentFonts(
      ['함초롬바탕', '함초롬돋움'],
      ['"HCR Batang"', '"HCR Dotum"']
    )).toEqual({
      함초롬바탕: { requested: '함초롬바탕', resolved: 'HCR Batang', substituted: false },
      함초롬돋움: { requested: '함초롬돋움', resolved: 'HCR Dotum', substituted: false }
    })
  })

  test('명조와 고딕 계열을 결정적으로 대체한다', () => {
    const result = resolveDocumentFonts(['휴먼명조', '한컴돋움'], ['AppleMyungjo', 'Apple SD Gothic Neo'])
    expect(result['휴먼명조'].resolved).toBe('AppleMyungjo')
    expect(result['한컴돋움'].resolved).toBe('Apple SD Gothic Neo')
    expect(result['휴먼명조'].substituted).toBe(true)
  })
})
