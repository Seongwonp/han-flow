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

test('textCensus는 비교 글자와 별도로 공백 외 전체·사설 영역·ASCII 숫자를 센다', async () => {
  const { textCensus } = await import('../pdf_text_count.mjs')
  assert.deepEqual(textCensus(`${keycapMarker} 항목 12 ①\n3.5cm`), { comparable: 10, raw: 11, privateUse: 1, digits: 4 })
  assert.deepEqual(textCensus(''), { comparable: 0, raw: 0, privateUse: 0, digits: 0 })
  // 전각 숫자·원 숫자는 ASCII 숫자로 세지 않는다.
  assert.equal(textCensus('１②').digits, 0)
})

test('pdfTextReport는 사설 영역 제외 수·숫자 수를 항상 남기고 숫자나 필수 문자열이 빠지면 실패한다', async () => {
  const { pdfTextReport, textCensus } = await import('../pdf_text_count.mjs')
  const screenText = [`${keycapMarker} 1. 추진 배경`, '표 3 (2026)']
  const screenCensus = screenText.map((text, index) => ({ page: index + 1, ...textCensus(text) }))
  const passing = pdfTextReport({
    screenCensus,
    pdfCensus: [textCensus(' 1. 추진 배경'), textCensus('표 3 (2026)')],
    pdfText: ' 1. 추진 배경\n표 3 (2026)',
    requiredText: ['추진 배경', '(2026)']
  })
  assert.deepEqual(passing.failures, [])
  assert.deepEqual(passing.fields.screenPagePrivateUseCounts, { 1: 1, 2: 0 })
  assert.deepEqual(passing.fields.pdfPagePrivateUseCounts, [0, 0])
  assert.deepEqual(passing.fields.excludedPrivateUse, { screen: 1, pdf: 0 })
  assert.deepEqual(passing.fields.screenPageRawCounts, { 1: 7, 2: 8 })
  assert.deepEqual(passing.fields.pdfPageRawCounts, [6, 8])
  assert.deepEqual(passing.fields.screenPageDigitCounts, { 1: 1, 2: 5 })
  assert.deepEqual(passing.fields.pdfPageDigitCounts, [1, 5])
  assert.deepEqual(passing.fields.digits, { screen: 6, pdf: 6, lostPages: [] })
  assert.deepEqual(passing.fields.missingRequiredPdfText, [])

  // 비교 글자 수는 같아도(숫자 대신 다른 글자) 숫자가 빠지면 실패다. HWP 숫자 추출 회귀를 다시 숨기지 않는다.
  const failing = pdfTextReport({
    screenCensus,
    pdfCensus: [textCensus(' 1. 추진 배경'), textCensus('표 □ (□□□□)')],
    pdfText: ' 1. 추진 배경\n표 □ (□□□□)',
    requiredText: ['(2026)']
  })
  assert.deepEqual(failing.fields.digits.lostPages, [{ page: 2, screen: 5, pdf: 0 }])
  assert.deepEqual(failing.fields.missingRequiredPdfText, ['(2026)'])
  assert.equal(failing.failures.length, 2)
  assert.match(failing.failures[0], /2페이지 화면 5 \/ PDF 0/)
  // PDF에 없는 페이지는 숫자를 모두 잃은 것으로 본다.
  assert.deepEqual(pdfTextReport({ screenCensus: [{ page: 3, ...textCensus('7') }], pdfCensus: [] }).fields.digits.lostPages, [{ page: 3, screen: 1, pdf: 0 }])
})

test('main E2E visual state는 페이지 번호와 같은 규칙의 census를 남기고 verify_pdf가 결과에 싣는다', () => {
  const main = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
  for (const pattern of ['/\\\\S/gu', '/\\\\p{Co}/gu', '/[0-9]/g']) assert.ok(main.includes(`text.match(${pattern})`), pattern)
  assert.ok(main.includes('pageTextCensus'))
  const verify = readFileSync(resolve(root, 'scripts/verify_pdf.mjs'), 'utf8')
  assert.ok(verify.includes('...census.fields'))
  assert.ok(verify.includes('...census.failures'))
})
