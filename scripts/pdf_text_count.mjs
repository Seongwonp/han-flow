// 화면 DOM 글자 수와 PDF 추출 글자 수를 같은 규칙으로 센다.
// - UTF-16 code unit이 아니라 code point로 센다. `/\S/g`는 보충 평면 글자(U+10000 이상)를 2로 센다.
// - 비교 글자 수(pass 규칙)에서는 사설 영역(\p{Co}: U+E000–U+F8FF, U+F0000–U+10FFFD) 글자를 세지 않는다. 한컴 문자표
//   글머리처럼 글꼴에 glyph가 없으면 Chromium PDF는 .notdef glyph만 그리고 Unicode 대응을 남기지 않아 pdftotext로
//   추출되지 않는다. 화면과 PDF 모두 같은 빈 상자를 그리므로 글자 손실이 아니라 추출 한계다.
// - 다만 그 제외가 다른 손실을 가리지 않도록 {@link textCensus}로 공백 외 전체 글자(raw)·제외한 사설 영역 글자·ASCII
//   숫자를 따로 세어 verify_pdf 결과에 항상 남긴다. 숫자는 사설 영역이 아니므로 하나라도 빠지면 실패다.
// main의 E2E visual state(src/main/index.ts)도 같은 pattern을 쓴다.
export const COMPARABLE_CHARACTER_PATTERN = /[^\s\p{Co}]/gu
export const RAW_CHARACTER_PATTERN = /\S/gu
export const PRIVATE_USE_PATTERN = /\p{Co}/gu
export const ASCII_DIGIT_PATTERN = /[0-9]/g

const countMatches = (text, pattern) => (String(text).match(pattern) ?? []).length

export function comparableCharacterCount(text) {
  return countMatches(text, COMPARABLE_CHARACTER_PATTERN)
}

/** 한 페이지 글자의 비교 글자 수·공백 외 전체 글자 수·사설 영역 글자 수·ASCII 숫자 수(모두 code point 단위). */
export function textCensus(text) {
  return {
    comparable: countMatches(text, COMPARABLE_CHARACTER_PATTERN),
    raw: countMatches(text, RAW_CHARACTER_PATTERN),
    privateUse: countMatches(text, PRIVATE_USE_PATTERN),
    digits: countMatches(text, ASCII_DIGIT_PATTERN)
  }
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
 * 제외한 사설 영역 글자·ASCII 숫자를 화면(mount된 페이지 번호별)과 PDF(페이지 순서)로 나눠 보고하고, 숫자나 필수 문자열이
 * PDF에서 빠지면 실패로 만든다.
 */
export function pdfTextReport({ screenCensus = [], pdfCensus = [], pdfText = '', requiredText = [] }) {
  const digitLosses = lostDigitPages(screenCensus, pdfCensus)
  const missingText = missingRequiredText(pdfText, requiredText)
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
      missingRequiredPdfText: missingText
    },
    failures: [
      digitLosses.length
        ? `PDF에서 숫자가 빠짐: ${digitLosses.map(({ page, screen, pdf }) => `${page}페이지 화면 ${screen} / PDF ${pdf}`).join(', ')}`
        : undefined,
      missingText.length ? `PDF 텍스트에 필수 문자열이 없음: ${missingText.join(' | ')}` : undefined
    ].filter(Boolean)
  }
}
