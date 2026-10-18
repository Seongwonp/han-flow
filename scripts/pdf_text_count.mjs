// 화면 DOM 글자 수와 PDF 추출 글자 수를 같은 규칙으로 센다.
// - UTF-16 code unit이 아니라 code point로 센다. `/\S/g`는 보충 평면 글자(U+10000 이상)를 2로 센다.
// - 비교 글자 수(pass 규칙)에서는 사설 영역(\p{Co}: U+E000–U+F8FF, U+F0000–U+10FFFD) 글자를 세지 않는다. 한컴 문자표
//   글머리처럼 글꼴에 glyph가 없으면 Chromium PDF는 .notdef glyph만 그리고 Unicode 대응을 남기지 않아 pdftotext로
//   추출되지 않는다. 화면과 PDF 모두 같은 빈 상자를 그리므로 글자 손실이 아니라 추출 한계다.
// - 다만 그 제외가 다른 손실을 가리지 않도록 {@link textCensus}로 공백 외 전체 글자(raw)·제외한 사설 영역 글자·ASCII
//   숫자를 따로 세어 verify_pdf 결과에 항상 남긴다. 숫자는 사설 영역이 아니므로 하나라도 빠지면 실패다.
// - 사설 영역 글자도 code point별로 화면과 PDF를 비교한다({@link privateUseLosses}). PDF에서 빠진 사설 영역 글자는
//   (1) 한컴·기호 글꼴 PUA 표시 대체 표(src/core/document/hancom_pua_display.ts)에 있고 PDF 같은 페이지에 그 대체 문자열이 있거나,
//   (2) 이유와 함께 허용 목록({@link PRIVATE_USE_LOSS_ALLOWLIST}·fixture manifest `expected.allowedPrivateUseLoss`)에 있을
//   때만 통과하고, 나머지는 실패다.
// main의 E2E visual state(src/main/index.ts)도 같은 pattern을 쓴다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const COMPARABLE_CHARACTER_PATTERN = /[^\s\p{Co}]/gu
export const RAW_CHARACTER_PATTERN = /\S/gu
export const PRIVATE_USE_PATTERN = /\p{Co}/gu
export const ASCII_DIGIT_PATTERN = /[0-9]/g

const countMatches = (text, pattern) => (String(text).match(pattern) ?? []).length

export function comparableCharacterCount(text) {
  return countMatches(text, COMPARABLE_CHARACTER_PATTERN)
}

/** `U+F028B` 모양 code point 이름. */
export function codePointLabel(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/** 사설 영역 글자별 수(`{ 'U+F028B': 2 }`, code point 순). */
export function privateUseCodePoints(text) {
  const counts = new Map()
  for (const character of String(text).match(PRIVATE_USE_PATTERN) ?? []) {
    const codePoint = character.codePointAt(0)
    counts.set(codePoint, (counts.get(codePoint) ?? 0) + 1)
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left - right).map(([codePoint, count]) => [codePointLabel(codePoint), count]))
}

/** 한 페이지 글자의 비교 글자 수·공백 외 전체 글자 수·사설 영역 글자 수·ASCII 숫자 수(모두 code point 단위). */
export function textCensus(text) {
  return {
    comparable: countMatches(text, COMPARABLE_CHARACTER_PATTERN),
    raw: countMatches(text, RAW_CHARACTER_PATTERN),
    privateUse: countMatches(text, PRIVATE_USE_PATTERN),
    digits: countMatches(text, ASCII_DIGIT_PATTERN),
    privateUseCodePoints: privateUseCodePoints(text)
  }
}

/**
 * 모든 문서에 적용하는, PDF에서 빠져도 되는 사설 영역 글자와 그 이유. 이유 없이 넣지 않는다. 문서별 예외는 fixture
 * manifest(`<fixture>.json`의 `expected.allowedPrivateUseLoss: [{ codePoint: 'U+F028B', reason }]`)에 둔다.
 *
 * U+F028B(한컴 원 숫자 ③ 자리)는 넣지 않았다. rhwp 상류 표(`src/renderer/hancom_pua.rs`)가 근거 문서에 리터럴 ③이 쓰여
 * 의미를 확인하지 못했다며 일부러 빼 두었고(⓪①②④…⑨만 있다), Han-Flow 표도 상류를 따른다. 실제 문서에서 빠지면
 * 실패로 드러나게 두고, 한/글 PDF로 의미를 확인한 문서는 manifest에 이유와 함께 허용한다.
 */
export const PRIVATE_USE_LOSS_ALLOWLIST = new Map([])

let displayMapCache
/**
 * 한컴 PUA·기호 글꼴(Wingdings) PUA 표시 대체 표(`src/core/document/hancom_pua_display.ts`의
 * `VERIFIED_HANCOM_PUA_DISPLAY`·`SYMBOL_FONT_PUA_DISPLAY`)를 읽는다. 검증 script는 TypeScript를 import하지 않으므로
 * 원본 파일의 `[0xf028a, '②']` 항목을 그대로 읽어 표가 두 벌로 갈라지지 않게 한다.
 * @returns Map<number, string>
 */
export function hancomPuaDisplayMap(root = resolve(import.meta.dirname, '..')) {
  if (displayMapCache && root === displayMapCache.root) return displayMapCache.map
  const source = readFileSync(resolve(root, 'src/core/document/hancom_pua_display.ts'), 'utf8')
  const map = new Map()
  for (const name of ['VERIFIED_HANCOM_PUA_DISPLAY', 'SYMBOL_FONT_PUA_DISPLAY']) {
    const start = source.indexOf(`const ${name}`)
    if (start < 0) throw new Error(`PUA 표시 대체 표를 찾지 못했습니다: ${name}`)
    const table = source.slice(start, source.indexOf('])', start))
    for (const match of table.matchAll(/\[0x([0-9a-f]+),\s*'([^']+)'\]/giu)) map.set(parseInt(match[1], 16), match[2])
  }
  if (!map.size) throw new Error('한컴 PUA 표시 대체 표를 읽지 못했습니다.')
  displayMapCache = { root, map }
  return map
}

/** `U+F028B`·`0xF028B`·숫자를 code point 숫자로. */
function parseCodePoint(value) {
  if (typeof value === 'number') return value
  const match = /^(?:U\+|0x)([0-9a-f]{4,6})$/iu.exec(String(value).trim())
  return match ? parseInt(match[1], 16) : NaN
}

/**
 * 허용 목록 항목(`[{ codePoint, reason }]`)을 Map으로. 이유가 비었거나 code point가 사설 영역이 아니면 오류다.
 * @returns Map<number, string>
 */
export function privateUseAllowlist(entries = []) {
  const allowlist = new Map(PRIVATE_USE_LOSS_ALLOWLIST)
  for (const entry of entries) {
    const codePoint = parseCodePoint(entry?.codePoint)
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : ''
    if (!Number.isInteger(codePoint) || !/\p{Co}/u.test(String.fromCodePoint(codePoint))) {
      throw new Error(`사설 영역 허용 항목의 code point가 올바르지 않습니다: ${entry?.codePoint}`)
    }
    if (!reason) throw new Error(`사설 영역 허용 항목에 이유가 없습니다: ${codePointLabel(codePoint)}`)
    allowlist.set(codePoint, reason)
  }
  return allowlist
}

/**
 * 화면(mount된 페이지)에 있던 사설 영역 글자 중 PDF 같은 페이지에서 빠진 것을 code point별로 판정한다.
 * - 표시 대체 표에 있는 글자는 PDF 같은 페이지에 대체 문자열이 빠진 수만큼 있으면 `display-map`으로 통과한다.
 * - 허용 목록에 있으면 `allowlist`(이유 포함)로 통과한다.
 * - 나머지는 `lost`(실패).
 * @returns `[{ page, codePoint, screen, pdf, missing, status, reason? }]`
 */
export function privateUseLosses(screenCensus, pdfCensus, pdfPageTexts = [], options = {}) {
  const displayMap = options.displayMap ?? new Map()
  const allowlist = options.allowlist ?? new Map(PRIVATE_USE_LOSS_ALLOWLIST)
  return screenCensus.flatMap((screen) => {
    const pdf = pdfCensus[screen.page - 1]?.privateUseCodePoints ?? {}
    const pageText = String(pdfPageTexts[screen.page - 1] ?? '').replace(/\s+/gu, '')
    const entries = Object.entries(screen.privateUseCodePoints ?? {}).sort(([left], [right]) => parseCodePoint(left) - parseCodePoint(right))
    return entries.flatMap(([label, count]) => {
      const missing = count - (pdf[label] ?? 0)
      if (missing <= 0) return []
      const codePoint = parseCodePoint(label)
      const entry = { page: screen.page, codePoint: label, screen: count, pdf: pdf[label] ?? 0, missing }
      const replacement = displayMap.get(codePoint)
      if (replacement && pageText.split(replacement.replace(/\s+/gu, '')).length - 1 >= missing) {
        return [{ ...entry, status: 'display-map', reason: `한컴 PUA 표시 대체(${replacement})로 추출` }]
      }
      if (allowlist.has(codePoint)) return [{ ...entry, status: 'allowlist', reason: allowlist.get(codePoint) }]
      return [{ ...entry, status: 'lost' }]
    })
  })
}

/**
 * 화면에 mount된 페이지의 census(`page`는 1부터 센 페이지 번호)와 PDF 페이지별 census를 비교해 ASCII 숫자가 줄어든
 * 페이지를 찾는다. PDF에 없는 페이지 번호는 숫자를 모두 잃은 것으로 본다.
 * @returns `[{ page, screen, pdf }]`
 */
export function lostDigitPages(screenCensus, pdfCensus) {
  return screenCensus.flatMap((screen) => {
    const pdfDigits = pdfCensus[screen.page - 1]?.digits ?? 0
    if (pdfDigits >= screen.digits) return []
    return [{ page: screen.page, screen: screen.digits, pdf: pdfDigits }]
  })
}

/** 공백을 무시하고 PDF 전체 글자에서 빠진 필수 문자열. */
export function missingRequiredText(pdfText, required = []) {
  const compact = String(pdfText).replace(/\s+/gu, '')
  return required.filter((text) => !compact.includes(String(text).replace(/\s+/gu, '')))
}

/**
 * verify_pdf 결과에 항상 남기는 글자 census와 그에 따른 실패 문구. pass 규칙(비교 글자 수)과 별도로 공백 외 전체 글자·
 * 제외한 사설 영역 글자·ASCII 숫자를 화면(mount된 페이지 번호별)과 PDF(페이지 순서)로 나눠 보고하고, 숫자나 필수 문자열,
 * 표시 대체 표·허용 목록 밖의 사설 영역 글자가 PDF에서 빠지면 실패로 만든다.
 */
export function pdfTextReport({
  screenCensus = [],
  pdfCensus = [],
  pdfText = '',
  pdfPageTexts = [],
  requiredText = [],
  displayMap,
  allowlist
}) {
  const digitLosses = lostDigitPages(screenCensus, pdfCensus)
  const missingText = missingRequiredText(pdfText, requiredText)
  const privateUse = privateUseLosses(screenCensus, pdfCensus, pdfPageTexts, { displayMap, allowlist })
  const lostPrivateUse = privateUse.filter((entry) => entry.status === 'lost')
  const screenSeries = (key) => Object.fromEntries(screenCensus.map((entry) => [entry.page, entry[key]]))
  const pdfSeries = (key) => pdfCensus.map((entry) => entry[key])
  const sum = (census, key) => census.reduce((total, entry) => total + entry[key], 0)
  return {
    fields: {
      screenPageRawCounts: screenSeries('raw'),
      pdfPageRawCounts: pdfSeries('raw'),
      screenPagePrivateUseCounts: screenSeries('privateUse'),
      pdfPagePrivateUseCounts: pdfSeries('privateUse'),
      screenPageDigitCounts: screenSeries('digits'),
      pdfPageDigitCounts: pdfSeries('digits'),
      excludedPrivateUse: { screen: sum(screenCensus, 'privateUse'), pdf: sum(pdfCensus, 'privateUse') },
      digits: { screen: sum(screenCensus, 'digits'), pdf: sum(pdfCensus, 'digits'), lostPages: digitLosses },
      requiredPdfText: requiredText,
      missingRequiredPdfText: missingText,
      // PDF에서 빠진 사설 영역 글자(code point별). status: display-map·allowlist(통과, 이유 포함)·lost(실패)
      privateUseLosses: privateUse
    },
    failures: [
      digitLosses.length
        ? `PDF에서 숫자가 빠짐: ${digitLosses.map(({ page, screen, pdf }) => `${page}페이지 화면 ${screen} / PDF ${pdf}`).join(', ')}`
        : undefined,
      missingText.length ? `PDF 텍스트에 필수 문자열이 없음: ${missingText.join(' | ')}` : undefined,
      lostPrivateUse.length
        ? `PDF에서 사설 영역 글자가 빠짐(표시 대체 표·허용 목록 밖): ${lostPrivateUse.map(({ page, codePoint, missing }) => `${page}페이지 ${codePoint} ${missing}개`).join(', ')}`
        : undefined
    ].filter(Boolean)
  }
}
