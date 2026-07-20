export interface FontResolution {
  requested: string
  resolved: string
  substituted: boolean
}

const SERIF_PATTERN = /(명조|바탕|serif|myeongjo|batang)/i
const SERIF_FALLBACKS = ['AppleMyungjo', 'Nanum Myeongjo', 'Noto Serif CJK KR']
const SANS_FALLBACKS = ['Apple SD Gothic Neo', 'Nanum Gothic', 'Noto Sans CJK KR']

export function normalizeFontName(name: string): string {
  return name.trim().replace(/^['"]|['"]$/g, '')
}

export function resolveDocumentFonts(requestedFonts: string[], availableFonts: string[]): Record<string, FontResolution> {
  const available = new Map(availableFonts.map(normalizeFontName).map((name) => [name.toLocaleLowerCase(), name]))
  return Object.fromEntries([...new Set(requestedFonts.filter(Boolean))].map((requested) => {
    const exact = available.get(normalizeFontName(requested).toLocaleLowerCase())
    const fallbacks = SERIF_PATTERN.test(requested) ? SERIF_FALLBACKS : SANS_FALLBACKS
    const fallback = fallbacks.map((name) => available.get(name.toLocaleLowerCase())).find(Boolean)
      ?? fallbacks[0]
    const resolved = exact ?? fallback
    return [requested, { requested, resolved, substituted: !exact }]
  }))
}
