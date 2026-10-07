import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { hwpxSourceObjectCensus, placeholderShortfalls, sourceObjectCensus } from '../source_object_census.mjs'

const root = resolve(import.meta.dirname, '../..')
const section = (body) => `<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run>${body}</hp:run></hp:p></hs:sec>`
const nonZero = (counts) => Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0))

test('원문 개체를 decoder 자리 표시와 같은 종류로 센다', () => {
  const counts = sourceObjectCensus([section([
    '<hp:equation><hp:script>a</hp:script></hp:equation>',
    // 차트와 OLE 대체 그림이 든 switch는 차트 하나다.
    '<hp:switch><hp:case hp:required-namespace="chart"><hp:chart/></hp:case><hp:default><hp:ole/></hp:default></hp:switch>',
    // 차트가 없는 switch는 default 하나만 본다.
    '<hp:switch><hp:case hp:required-namespace="x"><hp:video/></hp:case><hp:default><hp:ole/></hp:default></hp:switch>',
    '<hp:rect><hp:drawText><hp:subList><hp:p><hp:run><hp:t>글</hp:t><hp:equation/></hp:run></hp:p></hp:subList></hp:drawText></hp:rect>',
    '<hp:ellipse/>',
    '<hp:container><hp:rect/><hp:line/></hp:container>',
    '<hp:textart text="글맵시"/>',
    '<hp:btn/><hp:checkBtn/>',
    '<hp:ctrl><hp:footNote><hp:subList/></hp:footNote><hp:endNote><hp:subList/></hp:endNote></hp:ctrl>',
    '<hp:ctrl><hp:fieldBegin type="MEMO"><hp:subList/></hp:fieldBegin><hp:fieldBegin type="CLICK_HERE"/></hp:ctrl>',
    '<hp:dutmal><hp:mainText>본</hp:mainText></hp:dutmal>'
  ].join(''))])
  assert.deepEqual(nonZero(counts), {
    equation: 2, chart: 1, ole: 1, 'text-box': 1, shape: 3, 'form-control': 2, footnote: 1, endnote: 1, memo: 1, ruby: 1
  })
})

test('공개 external fixture의 원문 census는 corpus manifest 자리 표시 기대값과 같다', async () => {
  const { readFileSync } = await import('node:fs')
  const manifest = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/public/hwpx_corpus_manifest.json'), 'utf8'))
  const kinds = new Set()
  for (const fixture of manifest.fixtures.filter((entry) => entry.source === 'file' && entry.expected.outcome === 'opened')) {
    const counts = nonZero(hwpxSourceObjectCensus(resolve(root, 'tests/fixtures/public', fixture.file)))
    assert.deepEqual(counts, fixture.expected.placeholders ?? {}, fixture.id)
    Object.keys(counts).forEach((kind) => kinds.add(kind))
  }
  for (const kind of ['equation', 'text-box', 'footnote', 'endnote', 'memo', 'form-control', 'ole']) assert.ok(kinds.has(kind), kind)
})

test('원문을 읽지 못하면 예외를 던지고 종류별 부족분을 찾는다', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-census-'))
  try {
    const broken = join(directory, 'broken.hwpx')
    writeFileSync(broken, 'not a zip')
    assert.throws(() => hwpxSourceObjectCensus(broken))
    assert.throws(() => hwpxSourceObjectCensus(join(directory, 'missing.hwpx')))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  assert.deepEqual(placeholderShortfalls({ equation: 2, ole: 1, memo: 0 }, { equation: 2, 'text-box': 4 }), [{ kind: 'ole', source: 1, screen: 0 }])
  assert.deepEqual(placeholderShortfalls({ equation: 1 }, { equation: 3 }), [])
})

test('verify_app은 원문 검사 실패와 종류별 부족을 실패로 만든다', async () => {
  const { readFileSync } = await import('node:fs')
  const verify = readFileSync(resolve(root, 'scripts/verify_app.mjs'), 'utf8')
  assert.ok(verify.includes('원본 개체 검사 실패'))
  assert.ok(verify.includes('placeholderShortfalls(source.counts, state.placeholderCounts)'))
  assert.ok(!verify.includes('catch {\n    return undefined'))
})
