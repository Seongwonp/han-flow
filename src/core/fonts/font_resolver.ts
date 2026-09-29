export interface FontResolution {
  requested: string
  resolved: string
  substituted: boolean
}

/** 해석 결과가 설치 글꼴이 아닐 때 쓰는 CSS generic family. 따옴표 없이 CSS에 넣어야 한다. */
export type GenericFontFamily = 'serif' | 'sans-serif'

export interface FontResolveOptions {
  /** Electron `process.platform` 값. core가 전역 `process`를 읽지 않도록 호출자가 넘긴다. */
  platform?: string
}

const SERIF_PATTERN = /(명조|바탕|궁서|serif|myeongjo|myungjo|batang|gungsuh)/i
const GENERIC_FAMILIES = new Set<string>(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])

/**
 * 같은 글꼴의 다른 family 이름. 한 그룹 안의 이름끼리는 대체로 집계하지 않는다.
 * Windows `font-list`는 시스템 locale에 따라 영문(Malgun Gothic) 또는 한글(맑은 고딕) family를 돌려준다.
 */
const FONT_NAME_GROUPS: string[][] = [
  ['함초롬바탕', 'HCR Batang', 'HANBatang'],
  ['함초롬돋움', 'HCR Dotum', 'HANDotum'],
  ['맑은 고딕', 'Malgun Gothic'],
  ['바탕', 'Batang'],
  ['바탕체', 'BatangChe'],
  ['돋움', 'Dotum'],
  ['돋움체', 'DotumChe'],
  ['굴림', 'Gulim'],
  ['굴림체', 'GulimChe'],
  ['궁서', 'Gungsuh'],
  ['궁서체', 'GungsuhChe'],
  ['나눔고딕', 'Nanum Gothic', 'NanumGothic'],
  ['나눔명조', 'Nanum Myeongjo', 'NanumMyeongjo'],
  ['Apple SD Gothic Neo', 'Apple SD 산돌고딕 Neo'],
  ['AppleMyungjo', '애플명조']
]

const FONT_ALIASES: Map<string, string[]> = new Map(FONT_NAME_GROUPS.flatMap((group) =>
  group.map((name) => [name.toLocaleLowerCase(), group] as [string, string[]])))

/**
 * 운영체제별 대체 체인. 앞에 올수록 해당 OS에서 먼저 찾는 글꼴이다.
 * Windows에서 모든 설치본에 보장되는 한글 글꼴은 맑은 고딕뿐이고, 바탕은 한국어 보조 글꼴이 있을 때만
 * 쓰이며 없으면 다음 후보와 CSS generic으로 넘어간다.
 */
const PLATFORM_FALLBACKS: Record<'darwin' | 'win32' | 'linux', Record<GenericFontFamily, string[]>> = {
  darwin: {
    serif: ['AppleMyungjo', 'Nanum Myeongjo', 'Noto Serif CJK KR', 'Noto Serif KR'],
    'sans-serif': ['Apple SD Gothic Neo', 'Nanum Gothic', 'Noto Sans CJK KR', 'Noto Sans KR']
  },
  win32: {
    serif: ['바탕', 'Nanum Myeongjo', 'Noto Serif CJK KR', 'Noto Serif KR'],
    'sans-serif': ['맑은 고딕', 'Nanum Gothic', 'Noto Sans CJK KR', 'Noto Sans KR']
  },
  linux: {
    serif: ['Noto Serif CJK KR', 'Noto Serif KR', 'Nanum Myeongjo'],
    'sans-serif': ['Noto Sans CJK KR', 'Noto Sans KR', 'Nanum Gothic']
  }
}

function fallbackChain(platform: string | undefined, generic: GenericFontFamily): string[] {
  const primary = platform && platform in PLATFORM_FALLBACKS
    ? PLATFORM_FALLBACKS[platform as keyof typeof PLATFORM_FALLBACKS][generic]
    : []
  // 다른 OS의 글꼴이 설치된 경우(예: Linux에 맑은 고딕)에도 실제 설치 글꼴을 우선한다.
  const rest = Object.values(PLATFORM_FALLBACKS).flatMap((chains) => chains[generic])
  return [...new Set([...primary, ...rest])]
}

export function normalizeFontName(name: string): string {
  return name.trim().replace(/^['"]|['"]$/g, '')
}

export function isGenericFontFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLocaleLowerCase())
}

/** CSS `font-family` 값에 넣을 한 항목. generic family는 따옴표로 감싸면 일반 이름으로 취급되므로 그대로 둔다. */
export function cssFontFamilyName(name: string): string {
  return isGenericFontFamily(name) ? name : `"${name.replace(/"/g, '\\"')}"`
}

/** 문서 글꼴 뒤에 붙이는 운영체제 공통 한글 UI 글꼴 스택. */
export const KOREAN_SANS_STACK = '"Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", sans-serif'

export function resolveDocumentFonts(
  requestedFonts: string[],
  availableFonts: string[],
  options: FontResolveOptions = {}
): Record<string, FontResolution> {
  const available = new Map(availableFonts.map(normalizeFontName).map((name) => [name.toLocaleLowerCase(), name]))
  const findInstalled = (name: string): string | undefined => {
    const exact = available.get(name.toLocaleLowerCase())
    if (exact) return exact
    return FONT_ALIASES.get(name.toLocaleLowerCase())?.map((alias) => available.get(alias.toLocaleLowerCase())).find(Boolean)
  }
  return Object.fromEntries([...new Set(requestedFonts.filter(Boolean))].map((requested) => {
    const normalized = normalizeFontName(requested)
    const same = findInstalled(normalized)
    const generic: GenericFontFamily = SERIF_PATTERN.test(normalized) ? 'serif' : 'sans-serif'
    const resolved = same
      ?? fallbackChain(options.platform, generic).map(findInstalled).find(Boolean)
      ?? generic
    return [requested, { requested, resolved, substituted: !same }]
  }))
}
