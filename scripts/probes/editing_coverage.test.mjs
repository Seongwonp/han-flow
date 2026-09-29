import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadGenerator, publicFixtureRoot } from '../corpus/corpus_runtime.mjs'
import { prepareCorpusFixture } from '../corpus/public_corpus.mjs'
import {
  aggregateCoverage,
  measureEditingCoverage,
  normalizeRejection
} from '../corpus/editing_coverage.mjs'

const AdmZip = createRequire(import.meta.url)('adm-zip')

async function manifestFixture(id) {
  const manifest = JSON.parse(await readFile(join(publicFixtureRoot, 'hwpx_corpus_manifest.json'), 'utf8'))
  return manifest.fixtures.find((fixture) => fixture.id === id)
}

function sectionTexts(path) {
  return new AdmZip(path).getEntries()
    .filter((entry) => /^Contents\/section\d+\.xml$/.test(entry.entryName))
    .flatMap((entry) => [...entry.getData().toString('utf8').matchAll(/<hp:t>([^<]+)<\/hp:t>/g)].map((match) => match[1]))
    .filter((text) => text.trim().length >= 2)
}

const COUNT_KEYS = [
  'textRuns', 'anchored', 'textEditable', 'charStyleEditable', 'paragraphs', 'paraStyleEditable',
  'tableCells', 'tableCellsEditable', 'tableCellStyleEditable', 'tables', 'tableStructureEditable',
  'characters', 'editableCharacters'
]
const pick = (metrics) => Object.fromEntries(COUNT_KEYS.map((key) => [key, metrics[key]]))

test('편집 coverage는 합성 fixture 2종의 개수와 거부 사유를 정확히 센다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'han-flow-editing-coverage-test-'))
  try {
    const generator = loadGenerator()
    const options = { generator, directory, publicRoot: publicFixtureRoot }
    const baselinePath = prepareCorpusFixture(await manifestFixture('baseline'), options)
    const listPath = prepareCorpusFixture(await manifestFixture('list-markers'), options)
    const baseline = await measureEditingCoverage(baselinePath)
    const list = await measureEditingCoverage(listPath)

    // 머리글 셀(4자)은 text만 편집할 수 있다: 셀 text는 열리지만 셀 style·표 구조 대상은 아니다.
    assert.deepEqual(pick(baseline), {
      textRuns: 11,
      anchored: 11,
      textEditable: 4,
      charStyleEditable: 0,
      paragraphs: 12,
      paraStyleEditable: 0,
      tableCells: 4,
      tableCellsEditable: 4,
      tableCellStyleEditable: 3,
      tables: 1,
      tableStructureEditable: 1,
      characters: 52,
      editableCharacters: 15
    })
    assert.deepEqual(baseline.byContainer.headerFooter, { textRuns: 6, textEditable: 0 })
    assert.deepEqual(baseline.rejectionReasons.text, {
      NOT_LISTED_HEADER_FOOTER: 6,
      NOT_LISTED_PARAGRAPH_HAS_IMAGE: 1
    })
    assert.deepEqual(baseline.rejectionReasons.charStyle, { 'capability: TABLE_CELL_STRUCTURE': 4 })
    assert.deepEqual(baseline.nonEditableCharactersByReason, {
      NOT_LISTED_HEADER_FOOTER: 30,
      NOT_LISTED_PARAGRAPH_HAS_IMAGE: 7
    })

    assert.deepEqual(pick(list), {
      textRuns: 5,
      anchored: 5,
      textEditable: 5,
      charStyleEditable: 4,
      paragraphs: 5,
      paraStyleEditable: 5,
      tableCells: 0,
      tableCellsEditable: 0,
      tableCellStyleEditable: 0,
      tables: 0,
      tableStructureEditable: 0,
      characters: 32,
      editableCharacters: 32
    })
    assert.deepEqual(list.rejectionReasons.charStyle, {
      'style_patch: 복합 run은 아직 style을 편집할 수 없습니다.': 1
    })

    const total = aggregateCoverage([baseline, list])
    assert.equal(total.textRuns, 16)
    assert.equal(total.ratios.characterWeighted, Math.round((47 / 84) * 10000) / 10000)

    const serialized = JSON.stringify({ baseline, list, total })
    const texts = [...sectionTexts(baselinePath), ...sectionTexts(listPath)]
    assert.ok(texts.length >= 10)
    for (const text of texts) assert.ok(!serialized.includes(text), '보고서에 hp:t 본문이 들어가면 안 됩니다.')
    assert.ok(!serialized.includes(directory))
    assert.ok(!serialized.includes('Contents/section'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('거부 사유는 가변 anchor·tag 정보를 버리고 첫 문장만 남긴다', () => {
  assert.equal(
    normalizeRejection('text_patch', new Error('text anchor를 찾을 수 없습니다: Contents/section0.xml#hp:t:3')),
    'text_patch: text anchor를 찾을 수 없습니다'
  )
  assert.equal(
    normalizeRejection('table_patch', new Error('직사각형 표에만 행을 추가할 수 있습니다. 추가 설명')),
    'table_patch: 직사각형 표에만 행을 추가할 수 있습니다.'
  )
})
