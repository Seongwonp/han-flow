import { ViewerFootnoteSettings } from './viewer_document'

const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const HANGUL_SYLLABLES = '가나다라마바사아자차카타파하'
const HANGUL_JAMO = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'
const HANJA_DIGITS = '一二三四五六七八九十'

function roman(value: number): string {
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let rest = value
  let result = ''
  for (const [unit, text] of table) {
    while (rest >= unit) {
      result += text
      rest -= unit
    }
  }
  return result
}

/** 글자 목록을 돌려 쓰는 번호(가나다·ABC 등). 목록을 넘으면 한/글처럼 처음부터 되풀이한다. */
const cyclic = (characters: string, value: number) => [...characters][(value - 1) % [...characters].length]

/**
 * OWPML 번호 모양(`hp:autoNumFormat type`)으로 번호 하나를 쓴다. 모르는 모양은 아라비아 숫자로 쓴다.
 * `USER_CHAR`는 사용자 기호(`userChar`)를 번호 대신 쓴다.
 */
export function formatNoteNumber(type: string, value: number, userChar = ''): string {
  if (!(value >= 1)) return String(value)
  switch (type) {
    case 'CIRCLED_DIGIT': return value <= CIRCLED_DIGITS.length ? [...CIRCLED_DIGITS][value - 1] : String(value)
    case 'ROMAN_CAPITAL': return roman(value)
    case 'ROMAN_SMALL': return roman(value).toLowerCase()
    case 'LATIN_CAPITAL': return String.fromCharCode(65 + (value - 1) % 26)
    case 'LATIN_SMALL': return String.fromCharCode(97 + (value - 1) % 26)
    case 'HANGUL_SYLLABLE': return cyclic(HANGUL_SYLLABLES, value)
    case 'HANGUL_JAMO': return cyclic(HANGUL_JAMO, value)
    case 'HANJA_DIGIT': return value <= HANJA_DIGITS.length ? [...HANJA_DIGITS][value - 1] : String(value)
    case 'USER_CHAR': return userChar || String(value)
    default: return String(value)
  }
}

/** 구역 각주 모양으로 쓴 각주 번호 표시(앞·뒤 장식 문자 포함). 예: `1)`. */
export function footnoteMarker(settings: ViewerFootnoteSettings, value: number): string {
  return `${settings.format.prefixChar}${formatNoteNumber(settings.format.type, value, settings.format.userChar)}${settings.format.suffixChar}`
}
