import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCorpusReport,
  evaluateCorpusFixture,
  validateCorpusManifest
} from '../corpus/public_corpus.mjs'
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
