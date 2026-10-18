/**
 * 한컴 전용 사설 영역(PUA) 기호의 화면 표시 대체 표.
 *
 * 출처: rhwp `src/renderer/hancom_pua.rs`(https://github.com/edwardkim/rhwp, commit `1a76570e`, v0.8.7)의
 * `VERIFIED_HANCOM_PUA_DISPLAY`. Copyright (c) 2025-2026 Edward Kim, MIT License. 각 항목은 rhwp가 실제 문서와
 * 한/글 PDF를 대조해 의미를 확인한 것만 담았고, 인접 code point를 같은 기호군으로 추정하지 않는다(표에 없는 PUA는 그대로).
 * 고지는 THIRD_PARTY_NOTICES.md에 있다.
 *
 * 화면(viewer)에 그리는 글자에만 쓴다. 원문 XML·편집 source·편집 입력 surface·저장 bytes는 원래 code point를 유지한다.
 * 기호 글꼴(Wingdings) PUA 표는 아래 `SYMBOL_FONT_PUA_DISPLAY`에 따로 있다.
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

/**
 * 기호 글꼴(Wingdings) 사설 영역 글자의 화면 표시 대체 표. HWP는 Wingdings 같은 기호 글꼴 글자를 `U+F000 + 글꼴 code`
 * (U+F020–U+F0FF)로 저장한다. 공개 글꼴에는 이 code point의 glyph가 없어 빈 상자로 그려지고 PDF에서 추출되지 않는다.
 *
 * 출처: rhwp `src/renderer/layout/paragraph_layout.rs`(https://github.com/edwardkim/rhwp)의 `map_pua_bullet_char`
 * 기본 PUA(U+F020–U+F0FF) 분기. Copyright (c) 2025-2026 Edward Kim, MIT License(고지는 THIRD_PARTY_NOTICES.md).
 * Han-Flow가 HWP 쪽 SVG에 쓰는 `@rhwp/core` 0.7.19(tag `v0.7.19`)와 위 commit `1a76570e`의 이 분기는 48개 항목이
 * 같다. rhwp는 HWP 쪽 SVG를 그릴 때 이 표로 글자를 바꾸므로(쪽 글자 위치표 `getPageTextLayout`은 원래 code point),
 * HWP 쪽 글자 층(선택·검색·PDF와 비교하는 화면 글자)도 같은 표로 바꿔야 화면에 그린 기호와 같아진다. rhwp는 Wingdings 글꼴 표
 * (alanwood.net Wingdings 표)를 기준으로 하고 `U+F0E8`(➔)처럼 한/글 PDF로 대조한 항목이 있다. 몇 항목은 모양이 가장 가까운
 * 표준 기호로 근사했다(rhwp 주석의 "근사값": 그림자 진 원·사각형, 굵은 원, 투표 상자). 글꼴 칸(Symbol·Wingdings)을
 * 구분하지 않으므로 Symbol 글꼴의 그리스 문자 같은 같은 code point도 이 표로 바뀐다(rhwp가 그리는 것과 같다).
 */
const SYMBOL_FONT_PUA_DISPLAY: ReadonlyMap<number, string> = new Map([
  [0xf022, '✂'], // BLACK SCISSORS
  [0xf036, '⌛'], // HOURGLASS
  [0xf045, '☜'], // WHITE LEFT POINTING INDEX
  [0xf046, '☞'], // WHITE RIGHT POINTING INDEX
  [0xf047, '☝'], // WHITE UP POINTING INDEX
  [0xf048, '☟'], // WHITE DOWN POINTING INDEX
  [0xf04a, '☺'], // WHITE SMILING FACE
  [0xf04e, '☠'], // SKULL AND CROSSBONES
  [0xf052, '☼'], // WHITE SUN WITH RAYS
  [0xf054, '❄'], // SNOWFLAKE
  [0xf058, '✠'], // MALTESE CROSS
  [0xf059, '✡'], // STAR OF DAVID
  [0xf06c, '●'], // BLACK CIRCLE
  [0xf06d, '●'], // BLACK CIRCLE
  [0xf06e, '■'], // BLACK SQUARE
  [0xf06f, '□'], // WHITE SQUARE
  [0xf070, '□'], // WHITE SQUARE
  [0xf071, '□'], // WHITE SQUARE
  [0xf072, '□'], // WHITE SQUARE
  [0xf073, '⬧'], // BLACK MEDIUM LOZENGE
  [0xf074, '⧫'], // BLACK LOZENGE
  [0xf075, '◆'], // BLACK DIAMOND
  [0xf076, '❖'], // BLACK DIAMOND MINUS WHITE X
  [0xf077, '⬥'], // BLACK MEDIUM DIAMOND
  [0xf09e, '·'], // MIDDLE DOT
  [0xf09f, '•'], // BULLET
  [0xf0a0, '·'], // MIDDLE DOT
  [0xf0a1, '⚪'], // MEDIUM WHITE CIRCLE
  [0xf0a2, '○'], // WHITE CIRCLE
  [0xf0a3, '○'], // WHITE CIRCLE
  [0xf0a4, '◉'], // FISHEYE
  [0xf0a5, '◎'], // BULLSEYE
  [0xf0a7, '▪'], // BLACK SMALL SQUARE
  [0xf0a8, '◻'], // WHITE MEDIUM SQUARE
  [0xf0aa, '✦'], // BLACK FOUR POINTED STAR
  [0xf0ab, '★'], // BLACK STAR
  [0xf0ac, '✶'], // SIX POINTED BLACK STAR
  [0xf0ad, '✴'], // EIGHT POINTED BLACK STAR
  [0xf0ae, '✹'], // TWELVE POINTED BLACK STAR
  [0xf0e8, '➔'], // HEAVY WIDE-HEADED RIGHTWARDS ARROW
  [0xf0ef, '⇦'], // LEFTWARDS WHITE ARROW
  [0xf0f0, '⇨'], // RIGHTWARDS WHITE ARROW
  [0xf0f1, '⇧'], // UPWARDS WHITE ARROW
  [0xf0f2, '⇩'], // DOWNWARDS WHITE ARROW
  [0xf0fb, '✗'], // BALLOT X
  [0xf0fc, '✔'], // HEAVY CHECK MARK
  [0xf0fd, '☒'], // BALLOT BOX WITH X
  [0xf0fe, '☑'], // BALLOT BOX WITH CHECK
])

/** 표에 있는 한컴 PUA 기호·기호 글꼴 PUA 글자의 표시 대체 문자열. 없으면 undefined. */
export function hancomPuaDisplay(codePoint: number): string | undefined {
  return VERIFIED_HANCOM_PUA_DISPLAY.get(codePoint) ?? SYMBOL_FONT_PUA_DISPLAY.get(codePoint)
}

/**
 * 기호 글꼴 PUA 글자(U+F020–U+F0FF)만 바꾼 글자. 바뀐 글자는 모두 기본 평면 한 글자라 글자 offset이 그대로다.
 * HWP 쪽 글자 층에 쓴다(한컴 PUA 표는 rhwp 0.7.19가 그리는 것과 다를 수 있어 쓰지 않는다).
 */
export function symbolFontPuaDisplayText(text: string): string {
  if (!/[\uF020-\uF0FF]/u.test(text)) return text
  let result = ''
  for (const character of text) {
    result += SYMBOL_FONT_PUA_DISPLAY.get(character.codePointAt(0)!) ?? character
  }
  return result
}

/** 화면 표시용 글자. 표에 있는 한컴 PUA 기호·기호 글꼴 PUA 글자만 바꾸고 나머지(다른 PUA 포함)는 그대로 둔다. */
export function hancomPuaDisplayText(text: string): string {
  // 한컴 표의 기호는 모두 보충 사설 영역(U+F0000 이상), 기호 글꼴 표는 U+F020–U+F0FF라 둘 다 없으면 그대로 돌려준다.
  if (!/[\u{F0000}-\u{FFFFD}\uF020-\uF0FF]/u.test(text)) return text
  let result = ''
  for (const character of text) {
    result += hancomPuaDisplay(character.codePointAt(0)!) ?? character
  }
  return result
}
