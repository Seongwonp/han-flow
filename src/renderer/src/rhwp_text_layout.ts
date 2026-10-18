import type { FixedPageTextLayout, FixedPageTextRun } from '../../core/document/fixed_page_document'
import { symbolFontPuaDisplayText } from '../../core/document/hancom_pua_display'

/*
 * rhwp 쪽 글자 위치표(`getPageTextLayout` JSON)를 검사해 HWP 쪽 투명 글자 층(선택·검색·복사·PDF 비교 글자 수)으로 바꾼다.
 */

const MAX_TEXT_RUNS_PER_PAGE = 100_000
const MAX_TEXT_CHARACTERS_PER_PAGE = 5_000_000
const MAX_TEXT_COORDINATE = 1_000_000
const MAX_FONT_SIZE = 10_000
const MAX_TEXT_LAYOUT_CHARACTERS = 50_000_000

interface RhwpTextLayout {
  runs?: unknown[]
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseTextRun(value: unknown): FixedPageTextRun | null {
  if (!value || typeof value !== 'object') return null
  const run = value as Record<string, unknown>
  if (typeof run.text !== 'string' || run.text.length > 1_000_000) return null
  const x = finite(run.x, Number.NaN)
  const y = finite(run.y, Number.NaN)
  const width = finite(run.w, Number.NaN)
  const height = finite(run.h, Number.NaN)
  const fontSize = finite(run.fontSize, 12)
  if (![x, y, width, height, fontSize].every(Number.isFinite)) return null
  if (
    [x, y, width, height].some((number) => Math.abs(number) > MAX_TEXT_COORDINATE) ||
    fontSize < 0 ||
    fontSize > MAX_FONT_SIZE
  ) return null
  return {
    // rhwp는 SVG에 기호 글꼴 PUA 글자를 표준 기호로 바꿔 그리지만 글자 위치표는 원래 code point다. 화면에 그린 기호·PDF
    // 글자와 맞도록 같은 표로 바꾼다(모두 기본 평면 한 글자라 글자 offset·폭은 그대로).
    text: symbolFontPuaDisplayText(run.text),
    x,
    y,
    width: Math.max(width, 0),
    height: Math.max(height, 0),
    fontFamily: typeof run.fontFamily === 'string' && run.fontFamily.length <= 200
      ? run.fontFamily
      : undefined,
    fontSize: Math.max(fontSize, 1),
    ratio: Math.min(Math.max(finite(run.ratio, 1), 0.1), 10)
  }
}

/** worker가 돌려준 쪽 글자 위치표. 크기·좌표 범위를 넘으면 오류이고, 모양이 맞지 않는 run은 버린다. */
export function parseRhwpTextLayout(serialized: unknown, index: number): FixedPageTextLayout {
  if (typeof serialized !== 'string' || serialized.length > MAX_TEXT_LAYOUT_CHARACTERS) {
    throw new Error(`${index + 1}페이지의 텍스트 레이아웃 크기가 허용 범위를 넘었습니다.`)
  }
  const value = JSON.parse(serialized) as RhwpTextLayout
  if (!Array.isArray(value.runs) || value.runs.length > MAX_TEXT_RUNS_PER_PAGE) {
    throw new Error(`${index + 1}페이지의 텍스트 레이아웃이 올바르지 않습니다.`)
  }
  const runs: FixedPageTextRun[] = []
  let characterCount = 0
  for (const rawRun of value.runs) {
    const run = parseTextRun(rawRun)
    if (!run) continue
    characterCount += run.text.length
    if (characterCount > MAX_TEXT_CHARACTERS_PER_PAGE) {
      throw new Error(`${index + 1}페이지의 텍스트가 허용 범위를 넘었습니다.`)
    }
    runs.push(run)
  }
  const text = runs.map((run) => run.text).join('')
  return {
    runs,
    text,
    // PDF 비교 규칙(scripts/pdf_text_count.mjs)과 같이 공백·사설 영역 글자는 세지 않는다.
    nonWhitespaceCharacters: Array.from(text.normalize('NFC').replace(/[\s\p{Co}]/gu, '')).length
  }
}
