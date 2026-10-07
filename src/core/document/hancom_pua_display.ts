/**
 * 한컴 전용 사설 영역(PUA) 기호의 화면 표시 대체 표.
 *
 * 출처: rhwp `src/renderer/hancom_pua.rs`(https://github.com/edwardkim/rhwp, commit `1a76570e`, v0.8.7)의
 * `VERIFIED_HANCOM_PUA_DISPLAY`. Copyright (c) 2025-2026 Edward Kim, MIT License. 각 항목은 rhwp가 실제 문서와
 * 한/글 PDF를 대조해 의미를 확인한 것만 담았고, 인접 code point를 같은 기호군으로 추정하지 않는다(표에 없는 PUA는 그대로).
 * 고지는 THIRD_PARTY_NOTICES.md에 있다.
 *
 * 화면(viewer)에 그리는 글자에만 쓴다. 원문 XML·편집 source·편집 입력 surface·저장 bytes는 원래 code point를 유지한다.
 * 공개 글꼴에는 한컴 PUA glyph가 없어 빈 상자(.notdef)로 그려지고 PDF에서도 글자로 추출되지 않으므로, 의미가 확인된
 * 기호만 표준 Unicode로 바꿔 보이고 추출되게 한다.
 */
const VERIFIED_HANCOM_PUA_DISPLAY: ReadonlyMap<number, string> = new Map([
  [0xf0090, '✺'],
  [0xf012b, '(인)'],
  [0xf0288, '⓪'],
  [0xf0289, '①'],
  [0xf028a, '②'],
  [0xf028c, '④'],
  [0xf028d, '⑤'],
  [0xf028e, '⑥'],
  [0xf028f, '⑦'],
  [0xf0290, '⑧'],
  [0xf0291, '⑨'],
  [0xf02ec, '◇'],
  [0xf02fb, '▸'],
  [0xf02fc, '►'],
  [0xf031c, '■'],
  [0xf03a0, '↵'],
  [0xf03a7, '⊟'],
  [0xf03a8, '⊞'],
  [0xf03c5, '□'],
  [0xf03da, '□'],
  [0xf03ef, '한'],
  [0xf03f0, '글'],
  [0xf03f1, '과'],
  [0xf03f2, '컴'],
  [0xf03f3, '퓨'],
  [0xf03f4, '터'],
  [0xf03ff, '□'],
  [0xf0806, '┌'],
  [0xf0807, '┬'],
  [0xf0808, '┐'],
  [0xf080c, '└'],
  [0xf080e, '┘'],
  [0xf0810, '│'],
  [0xf081c, '┈'],
  [0xf0832, '═'],
  [0xf0848, '━']
])

/** 표에 있는 한컴 PUA 기호의 표시 대체 문자열. 없으면 undefined. */
export function hancomPuaDisplay(codePoint: number): string | undefined {
  return VERIFIED_HANCOM_PUA_DISPLAY.get(codePoint)
}

/** 화면 표시용 글자. 표에 있는 한컴 PUA 기호만 바꾸고 나머지(다른 PUA 포함)는 그대로 둔다. */
export function hancomPuaDisplayText(text: string): string {
  // 표의 기호는 모두 보충 사설 영역(U+F0000 이상)이라 surrogate가 없으면 그대로 돌려준다.
  if (!/[\u{F0000}-\u{FFFFD}]/u.test(text)) return text
  let result = ''
  for (const character of text) {
    result += hancomPuaDisplay(character.codePointAt(0)!) ?? character
  }
  return result
}
