import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCorpusReport,
  evaluateCorpusFixture,
  validateCorpusManifest
} from '../corpus/public_corpus.mjs'

const fixture = {
  id: 'baseline',
  category: 'document-baseline',
  generator: 'createSyntheticHwpx',
  options: { fileName: 'baseline.hwpx' },
  expected: { outcome: 'opened', sections: 2, tables: 1, cells: 4, resources: 1, estimatedPages: 3 }
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
    metrics: { sections: 2, tables: 1, cells: 4, resources: 1, estimatedPages: 3 }
  }])
  assert.equal(report.passed, true)
  assert.deepEqual(report.totals, {
    sizeBytes: 100,
    sections: 2,
    tables: 1,
    cells: 4,
    resources: 1,
    estimatedPages: 3
  })
  assert.equal(JSON.stringify(report).includes('본문'), false)
})
