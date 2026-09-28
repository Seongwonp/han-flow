import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createCorpusReport,
  evaluateCorpusFixture,
  sha256Hex,
  validateCorpusManifest
} from '../corpus/public_corpus.mjs'
import { loadGenerator, observeCorpusFixture } from '../corpus/corpus_runtime.mjs'
import {
  linkHwpManifest,
  linkHwpxManifest,
  validateFixtureCatalog
} from '../corpus/fixture_catalog.mjs'

const fixture = {
  id: 'baseline',
  category: 'document-baseline',
  generator: 'createSyntheticHwpx',
  options: { fileName: 'baseline.hwpx' },
  expected: { outcome: 'opened', sections: 2, tables: 1, cells: 4, resources: 1, estimatedPages: 3 }
}

const fileFixture = {
  id: 'gov-form',
  category: 'official-form',
  source: 'file',
  file: 'external/gov-form.hwpx',
  origin: {
    url: 'https://www.example.go.kr/board/1',
    publisher: '예시 부처',
    license: 'KOGL-1',
    retrievedAt: '2026-09-28',
    producer: 'Hancom Office 2024 Windows'
  },
  sha256: 'a'.repeat(64),
  personalData: false,
  expected: { outcome: 'opened', sections: 2 }
}

function manifestOf(...fixtures) {
  return { schemaVersion: 1, suite: 'test', fixtures }
}

const catalogFixture = {
  id: 'baseline',
  format: 'hwpx',
  category: 'document-baseline',
  pipelines: ['hwpx-core', 'hwpx-production']
}

test('public corpus manifest는 중복 ID와 허용하지 않은 generator를 거부한다', () => {
  assert.throws(() => validateCorpusManifest({
    schemaVersion: 1,
    suite: 'test',
    fixtures: [fixture, { ...fixture }]
  }), /중복 corpus fixture id/)
  assert.throws(() => validateCorpusManifest({
    schemaVersion: 1,
    suite: 'test',
    fixtures: [{ ...fixture, generator: 'arbitraryCode' }]
  }), /허용하지 않은 fixture generator/)
})

test('public corpus 판정은 exact metric과 minimum page 차이를 모두 보고한다', () => {
  assert.deepEqual(evaluateCorpusFixture(fixture, {
    outcome: 'opened',
    metrics: { sections: 2, tables: 1, cells: 3, resources: 1, estimatedPages: 3 }
  }), ['cells 기대 4, 실제 3'])
  assert.deepEqual(evaluateCorpusFixture({
    ...fixture,
    expected: { outcome: 'opened', minimumEstimatedPages: 50 }
  }, {
    outcome: 'opened',
    metrics: { estimatedPages: 49 }
  }), ['estimatedPages 최소 50, 실제 49'])
})

test('public corpus report는 본문 없이 합계와 fixture별 실패를 결정적으로 만든다', () => {
  const manifest = validateCorpusManifest({ schemaVersion: 1, suite: 'test', fixtures: [fixture] })
  const report = createCorpusReport(manifest, [{
    id: 'baseline',
    outcome: 'opened',
    contentSha256: 'abc',
    sizeBytes: 100,
    metrics: {
      sections: 2,
      tables: 1,
      cells: 4,
      resources: 1,
      markedParagraphs: 4,
      bulletParagraphs: 2,
      numberedParagraphs: 2,
      diagnostics: 0,
      multiColumnSections: 0,
      declaredColumns: 0,
      estimatedPages: 3
    }
  }])
  assert.equal(report.passed, true)
  assert.deepEqual(report.totals, {
    sizeBytes: 100,
    sections: 2,
    tables: 1,
    cells: 4,
    resources: 1,
    markedParagraphs: 4,
    bulletParagraphs: 2,
    numberedParagraphs: 2,
    diagnostics: 0,
    multiColumnSections: 0,
    declaredColumns: 0,
    estimatedPages: 3
  })
  assert.equal(JSON.stringify(report).includes('본문'), false)
})

test('fixture catalog는 형식과 호환되지 않는 pipeline과 중복 ID를 거부한다', () => {
  assert.throws(() => validateFixtureCatalog({
    schemaVersion: 1,
    suite: 'test',
    fixtures: [catalogFixture, { ...catalogFixture }]
  }), /중복 fixture catalog id/)
  assert.throws(() => validateFixtureCatalog({
    schemaVersion: 1,
    suite: 'test',
    fixtures: [{ ...catalogFixture, pipelines: ['hwp-production'] }]
  }), /형식과 호환되지 않습니다/)
})

test('HWPX manifest와 production matrix는 catalog의 같은 fixture ID를 공유한다', () => {
  const catalog = validateFixtureCatalog({ schemaVersion: 1, suite: 'test', fixtures: [catalogFixture] })
  const manifest = validateCorpusManifest({ schemaVersion: 1, suite: 'test', fixtures: [fixture] })
  const linked = linkHwpxManifest(catalog, manifest)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].id, fixture.id)
  assert.equal(linked[0].manifest, fixture)
  assert.throws(() => linkHwpxManifest(catalog, {
    ...manifest,
    fixtures: [{ ...fixture, category: 'different-category' }]
  }), /category가 catalog와 다릅니다/)
})

test('고정 HWP manifest는 catalog ID와 파일명을 함께 검증한다', () => {
  const hwpFixture = {
    id: 'synthetic-layout',
    format: 'hwp',
    category: 'layout-and-rendering',
    pipelines: ['hwp-production']
  }
  const catalog = validateFixtureCatalog({ schemaVersion: 1, suite: 'test', fixtures: [hwpFixture] })
  assert.equal(linkHwpManifest(catalog, {
    catalogId: 'synthetic-layout',
    fixture: 'synthetic-layout.hwp'
  }), hwpFixture)
  assert.throws(() => linkHwpManifest(catalog, {
    catalogId: 'synthetic-layout',
    fixture: 'renamed.hwp'
  }), /파일명이 catalog ID와 다릅니다/)
})

test('public corpus manifest는 source: file 항목과 source 없는 generator 항목을 함께 받는다', () => {
  const manifest = validateCorpusManifest(manifestOf(fixture, { ...fixture, id: 'explicit', source: 'generator' }, fileFixture))
  assert.equal(manifest.fixtures.length, 3)
  for (const license of ['KOGL-1', 'CC-BY-4.0', 'Apache-2.0', 'MIT', 'project-authored', 'other']) {
    validateCorpusManifest(manifestOf({ ...fileFixture, origin: { ...fileFixture.origin, license } }))
  }
})

test('file fixture는 license·sha256·personalData·경로 계약을 어기면 거부한다', () => {
  const reject = (override, pattern) => assert.throws(
    () => validateCorpusManifest(manifestOf({ ...fileFixture, ...override })),
    pattern
  )
  const { license: _license, ...withoutLicense } = fileFixture.origin
  reject({ origin: withoutLicense }, /허용하지 않은 license/)
  reject({ origin: { ...fileFixture.origin, license: 'KOGL-2' } }, /허용하지 않은 license/)
  reject({ sha256: undefined }, /sha256/)
  reject({ sha256: 'A'.repeat(64) }, /sha256/)
  reject({ sha256: 'abc' }, /sha256/)
  reject({ personalData: undefined }, /personalData는 false/)
  reject({ personalData: true }, /personalData는 false/)
  reject({ personalData: 'false' }, /personalData는 false/)
  reject({ personalData: 0 }, /personalData는 false/)
  for (const file of ['/etc/x.hwpx', 'C:/x.hwpx', 'external/../../x.hwpx', '../x.hwpx', 'external\\x.hwpx', 'external/x.txt', 'external//x.hwpx']) {
    reject({ file }, /file은 공개 fixture 폴더 기준 상대/)
  }
  reject({ origin: { ...fileFixture.origin, retrievedAt: '2026-02-30' } }, /retrievedAt/)
  reject({ origin: { ...fileFixture.origin, url: 'ftp://x' } }, /origin.url/)
  reject({ origin: undefined }, /origin이 없습니다/)
  reject({ generator: 'createSyntheticHwpx' }, /허용하지 않은 항목입니다: generator/)
  reject({ source: 'url' }, /source는 generator 또는 file/)
  assert.throws(
    () => validateCorpusManifest(manifestOf({ ...fixture, sha256: 'a'.repeat(64) })),
    /허용하지 않은 항목입니다: sha256/
  )
})

test('catalog external provenance는 manifest source: file 항목과만 대응한다', () => {
  const externalCatalog = { id: 'gov-form', format: 'hwpx', category: 'official-form', provenance: 'external', pipelines: ['hwpx-core'] }
  const catalog = validateFixtureCatalog({ schemaVersion: 1, suite: 'test', fixtures: [catalogFixture, externalCatalog] })
  assert.equal(linkHwpxManifest(catalog, manifestOf(fixture, fileFixture)).length, 1)
  assert.throws(() => linkHwpxManifest(
    validateFixtureCatalog({ schemaVersion: 1, suite: 'test', fixtures: [catalogFixture, { ...externalCatalog, provenance: undefined }] }),
    manifestOf(fixture, fileFixture)
  ), /서로 대응하지 않습니다/)
  assert.throws(() => linkHwpxManifest(
    validateFixtureCatalog({ schemaVersion: 1, suite: 'test', fixtures: [{ ...catalogFixture, provenance: 'external' }] }),
    manifestOf(fixture)
  ), /서로 대응하지 않습니다/)
  assert.throws(() => validateFixtureCatalog({
    schemaVersion: 1, suite: 'test', fixtures: [{ ...externalCatalog, provenance: 'real' }]
  }), /provenance는 synthetic 또는 external/)
  assert.throws(() => validateFixtureCatalog({
    schemaVersion: 1, suite: 'test', fixtures: [{ id: 'x', format: 'hwp', category: 'c', provenance: 'external', pipelines: ['hwp-production'] }]
  }), /external fixture는 hwpx-core/)
})

test('file fixture는 sha256이 맞으면 decode하고 다르면 decode 전에 실패한다', async () => {
  const publicRoot = await mkdtemp(join(tmpdir(), 'han-flow-file-fixture-'))
  try {
    await mkdir(join(publicRoot, 'external'))
    const generator = loadGenerator()
    const path = generator.createSyntheticHwpx(join(publicRoot, 'external'), { fileName: 'gov-form.hwpx' })
    const bytes = await readFile(path)
    const matching = { ...fileFixture, sha256: sha256Hex(bytes), expected: { outcome: 'opened', sections: 2, tables: 1, cells: 4 } }
    const mismatching = { ...matching, id: 'tampered', sha256: 'b'.repeat(64) }
    const missing = { ...matching, id: 'missing', file: 'external/missing.hwpx' }
    const manifest = validateCorpusManifest(manifestOf(matching, mismatching, missing))
    const observations = []
    for (const candidate of manifest.fixtures) {
      observations.push(await observeCorpusFixture(candidate, { generator, directory: publicRoot, publicRoot }))
    }
    const report = createCorpusReport(manifest, observations)
    const [opened, tampered, absent] = report.fixtures
    assert.equal(opened.passed, true)
    assert.equal(opened.source, 'file')
    assert.equal(opened.license, 'KOGL-1')
    assert.equal(opened.metrics.sections, 2)
    assert.equal(tampered.passed, false)
    assert.equal(tampered.outcome, 'integrity-failed')
    assert.equal(tampered.metrics, undefined)
    assert.match(tampered.failures[0], new RegExp(`^sha256 불일치: manifest b{64}, 실제 ${matching.sha256}$`))
    assert.deepEqual(absent.failures, ['fixture 파일을 읽을 수 없습니다.'])
    assert.equal(report.fileFixtureCount, 3)
    assert.equal(report.passed, false)
    const serialized = JSON.stringify(report)
    assert.equal(serialized.includes('example.go.kr'), false)
    assert.equal(serialized.includes(publicRoot), false)
  } finally {
    await rm(publicRoot, { recursive: true, force: true })
  }
})
