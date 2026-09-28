import { cssFontFamilyName, normalizeFontName, resolveDocumentFonts } from '../../src/core/fonts/font_resolver'

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

  test('macOS는 기존 Apple 대체 순서를 유지한다', () => {
    const result = resolveDocumentFonts(
      ['함초롬바탕', '함초롬돋움'],
      ['AppleMyungjo', 'Apple SD Gothic Neo', 'Nanum Gothic', 'Malgun Gothic'],
      { platform: 'darwin' }
    )
    expect(result['함초롬바탕']).toEqual({ requested: '함초롬바탕', resolved: 'AppleMyungjo', substituted: true })
    expect(result['함초롬돋움']).toEqual({ requested: '함초롬돋움', resolved: 'Apple SD Gothic Neo', substituted: true })
  })

  describe('Windows', () => {
    const english = ['Arial', 'Segoe UI', 'Malgun Gothic', 'Batang', 'BatangChe', 'Gulim', 'Dotum', 'Nanum Gothic']
    const korean = ['"맑은 고딕"', '"바탕"', '"굴림"', '"돋움"', 'Segoe UI']

    test.each([
      ['영문 family', english, 'Malgun Gothic', 'Batang'],
      ['한글 family', korean, '맑은 고딕', '바탕']
    ])('%s 목록에서 함초롬체와 명조 계열을 맑은 고딕·바탕으로 대체한다', (_label, available, sans, serif) => {
      const result = resolveDocumentFonts(
        ['함초롬돋움', '함초롬바탕', '한양신명조', '휴먼명조', '신명조', '한컴돋움'],
        available,
        { platform: 'win32' }
      )
      expect(result['함초롬돋움']).toEqual({ requested: '함초롬돋움', resolved: sans, substituted: true })
      expect(result['한컴돋움'].resolved).toBe(sans)
      for (const font of ['함초롬바탕', '한양신명조', '휴먼명조', '신명조']) {
        expect(result[font]).toEqual({ requested: font, resolved: serif, substituted: true })
      }
    })

    test('한/영 family 이름 차이는 대체로 집계하지 않는다', () => {
      const english = resolveDocumentFonts(['바탕', '돋움', '굴림', '맑은 고딕'], ['Batang', 'Dotum', 'Gulim', 'Malgun Gothic'], { platform: 'win32' })
      expect(english).toEqual({
        바탕: { requested: '바탕', resolved: 'Batang', substituted: false },
        돋움: { requested: '돋움', resolved: 'Dotum', substituted: false },
        굴림: { requested: '굴림', resolved: 'Gulim', substituted: false },
        '맑은 고딕': { requested: '맑은 고딕', resolved: 'Malgun Gothic', substituted: false }
      })
      const korean = resolveDocumentFonts(['Batang', 'Gulim', 'Malgun Gothic'], ['바탕', '굴림', '맑은 고딕'], { platform: 'win32' })
      expect(korean['Batang']).toEqual({ requested: 'Batang', resolved: '바탕', substituted: false })
      expect(korean['Gulim']).toEqual({ requested: 'Gulim', resolved: '굴림', substituted: false })
      expect(korean['Malgun Gothic']).toEqual({ requested: 'Malgun Gothic', resolved: '맑은 고딕', substituted: false })
    })

    test('설치된 HCR 영문 family는 Windows에서도 같은 글꼴로 인식한다', () => {
      const result = resolveDocumentFonts(['함초롬바탕'], ['HCR Batang', 'Batang'], { platform: 'win32' })
      expect(result['함초롬바탕']).toEqual({ requested: '함초롬바탕', resolved: 'HCR Batang', substituted: false })
    })

    test('맑은 고딕이 없으면 설치된 Nanum/Noto로 내려간다', () => {
      const result = resolveDocumentFonts(['함초롬돋움'], ['NanumGothic', 'Noto Sans KR'], { platform: 'win32' })
      expect(result['함초롬돋움'].resolved).toBe('NanumGothic')
    })
  })

  test('Linux는 Noto를 Nanum보다 먼저 고른다', () => {
    const result = resolveDocumentFonts(['함초롬돋움', '함초롬바탕'], ['Nanum Gothic', 'Noto Sans CJK KR', 'Nanum Myeongjo', 'Noto Serif CJK KR'], { platform: 'linux' })
    expect(result['함초롬돋움'].resolved).toBe('Noto Sans CJK KR')
    expect(result['함초롬바탕'].resolved).toBe('Noto Serif CJK KR')
  })

  test.each(['win32', 'darwin', 'linux', undefined])('설치된 한글 글꼴이 없으면(%s) Apple 이름 대신 CSS generic을 돌려준다', (platform) => {
    const result = resolveDocumentFonts(['함초롬돋움', '함초롬바탕'], [], { platform })
    expect(result['함초롬돋움']).toEqual({ requested: '함초롬돋움', resolved: 'sans-serif', substituted: true })
    expect(result['함초롬바탕']).toEqual({ requested: '함초롬바탕', resolved: 'serif', substituted: true })
  })

  test('CSS generic family는 따옴표로 감싸지 않는다', () => {
    expect(cssFontFamilyName('serif')).toBe('serif')
    expect(cssFontFamilyName('맑은 고딕')).toBe('"맑은 고딕"')
  })
})
