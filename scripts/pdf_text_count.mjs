// 화면 DOM 글자 수와 PDF 추출 글자 수를 같은 규칙으로 센다.
// - UTF-16 code unit이 아니라 code point로 센다. `/\S/g`는 보충 평면 글자(U+10000 이상)를 2로 센다.
// - 사설 영역(\p{Co}: U+E000–U+F8FF, U+F0000–U+10FFFD) 글자는 세지 않는다. 한컴 문자표 글머리처럼
//   글꼴에 glyph가 없으면 Chromium PDF는 .notdef glyph만 그리고 Unicode 대응을 남기지 않아 pdftotext로
//   추출되지 않는다. 화면과 PDF 모두 같은 빈 상자를 그리므로 글자 손실이 아니라 추출 한계다.
// main의 E2E visual state(src/main/index.ts)도 같은 pattern을 쓴다.
export const COMPARABLE_CHARACTER_PATTERN = /[^\s\p{Co}]/gu

export function comparableCharacterCount(text) {
  return (String(text).match(COMPARABLE_CHARACTER_PATTERN) ?? []).length
}
