import {
  applyExtractableTextDefaults,
  EXTRACTABLE_GLYPH_STYLE
} from '../../src/renderer/src/svg_text_extraction'

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

function fakeRoot(attributes: Record<string, string> = {}) {
  const values = new Map(Object.entries(attributes))
  const element = {
    hasAttribute: (name: string) => values.has(name),
    hasAttributeNS: (namespace: string | null, localName: string) =>
      namespace === XML_NAMESPACE && values.has(`xml:${localName}`),
    getAttribute: (name: string) => values.get(name) ?? null,
    setAttribute: (name: string, value: string) => { values.set(name, value) },
    setAttributeNS: (namespace: string | null, qualifiedName: string, value: string) => {
      expect(namespace).toBe(XML_NAMESPACE)
      values.set(qualifiedName, value)
    }
  }
  return { element: element as unknown as Element, values }
}

describe('HWP 페이지 SVG의 PDF 추출용 글자 기본값', () => {
  test('locl 대체 glyph를 끄고 언어가 없으면 ko를 선언한다', () => {
    const { element, values } = fakeRoot()
    applyExtractableTextDefaults(element)
    expect(EXTRACTABLE_GLYPH_STYLE).toBe('font-feature-settings: "locl" 0')
    expect(values.get('style')).toBe(EXTRACTABLE_GLYPH_STYLE)
    expect(values.get('xml:lang')).toBe('ko')
  })

  test('기존 style 뒤에 붙인다', () => {
    const { element, values } = fakeRoot({ style: 'background: white;' })
    applyExtractableTextDefaults(element)
    expect(values.get('style')).toBe(`background: white; ${EXTRACTABLE_GLYPH_STYLE}`)
  })

  test.each([
    [{ 'xml:lang': 'en' }],
    [{ lang: 'ja' }]
  ])('SVG가 선언한 언어는 바꾸지 않는다: %p', (attributes) => {
    const { element, values } = fakeRoot(attributes)
    applyExtractableTextDefaults(element)
    expect(values.get('xml:lang')).toBe(attributes['xml:lang' as keyof typeof attributes])
    expect(values.get('lang')).toBe(attributes['lang' as keyof typeof attributes])
    expect(values.get('style')).toBe(EXTRACTABLE_GLYPH_STYLE)
  })
})
