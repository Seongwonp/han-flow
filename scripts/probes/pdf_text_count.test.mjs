import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { COMPARABLE_CHARACTER_PATTERN, comparableCharacterCount } from '../pdf_text_count.mjs'

const root = resolve(import.meta.dirname, '../..')
const keycapMarker = String.fromCodePoint(0xf03da)

test('화면·PDF 글자 수는 공백을 빼고 code point 단위로 센다', () => {
  assert.equal(comparableCharacterCount('목    차\n1.\t추진 배경'), 8)
  // 보충 평면 글자는 UTF-16 code unit 2개지만 1글자다.
  assert.equal(comparableCharacterCount('𝐀𠀀'), 2)
  assert.equal('𝐀𠀀'.match(/\S/g).length, 4)
})

test('글꼴 glyph가 없으면 PDF에서 추출되지 않는 사설 영역 글자는 양쪽 모두 세지 않는다', () => {
  const screen = `${keycapMarker} 둘째 수준 항목`
  const pdfExtraction = ' 둘째 수준 항목'
  assert.equal(comparableCharacterCount(screen), comparableCharacterCount(pdfExtraction))
  assert.equal(comparableCharacterCount('가'), 1)
  // 예전 규칙(/\S/g)은 같은 줄에서 화면 쪽만 2글자 더 셌다.
  assert.equal(screen.match(/\S/g).length - pdfExtraction.match(/\S/g).length, 2)
})

test('main E2E visual state와 HWP fixed-page 글자 수도 같은 규칙을 쓴다', () => {
  const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
  assert.ok(main.includes(`page.innerText.match(/${COMPARABLE_CHARACTER_PATTERN.source.replaceAll('\\', '\\\\')}/gu)`))
  const adapter = readFileSync(resolve(root, 'src/renderer/src/rhwp_fixed_page_adapter.ts'), 'utf8')
  assert.ok(adapter.includes(".replace(/[\\s\\p{Co}]/gu, '')"))
})
