const GENERATORS = new Set([
  'createSyntheticHwpx',
  'createCellFragmentHwpx',
  'createCompatibilityHwpx',
  'createTableColumnHwpx',
  'createListMarkerHwpx',
  'createMultiColumnHwpx',
  'createRoundTripHwpx',
  'createInvalidHwpx'
])

const EXACT_METRICS = [
  'sections',
  'tables',
  'cells',
  'resources',
  'markedParagraphs',
  'bulletParagraphs',
  'numberedParagraphs',
  'diagnostics',
  'multiColumnSections',
  'declaredColumns',
  'estimatedPages'
]

export function generateCorpusFixture(generator, directory, fixture) {
  const create = generator[fixture.generator]
  if (typeof create !== 'function') throw new Error(`${fixture.id}: fixture generator를 찾을 수 없습니다.`)
  if (fixture.options) return create(directory, fixture.options)
  return create(directory, fixture.fileName)
}

export function validateCorpusManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('corpus manifest는 object여야 합니다.')
  if (manifest.schemaVersion !== 1) throw new Error('지원하지 않는 corpus manifest schemaVersion입니다.')
  if (typeof manifest.suite !== 'string' || !manifest.suite.trim()) throw new Error('corpus suite가 비어 있습니다.')
  if (!Array.isArray(manifest.fixtures) || !manifest.fixtures.length) throw new Error('corpus fixture가 없습니다.')
  const ids = new Set()
  for (const fixture of manifest.fixtures) {
    if (!fixture || typeof fixture !== 'object') throw new Error('corpus fixture 항목이 올바르지 않습니다.')
    if (typeof fixture.id !== 'string' || !/^[a-z0-9-]+$/.test(fixture.id)) {
      throw new Error('corpus fixture id는 소문자·숫자·하이픈만 사용할 수 있습니다.')
    }
    if (ids.has(fixture.id)) throw new Error(`중복 corpus fixture id입니다: ${fixture.id}`)
    ids.add(fixture.id)
    if (typeof fixture.category !== 'string' || !fixture.category.trim()) {
      throw new Error(`${fixture.id}: category가 비어 있습니다.`)
    }
    if (!GENERATORS.has(fixture.generator)) {
      throw new Error(`${fixture.id}: 허용하지 않은 fixture generator입니다.`)
    }
    if (!fixture.expected || !['opened', 'rejected'].includes(fixture.expected.outcome)) {
      throw new Error(`${fixture.id}: expected outcome이 올바르지 않습니다.`)
    }
    if (fixture.expected.outcome === 'rejected' && typeof fixture.expected.errorCode !== 'string') {
      throw new Error(`${fixture.id}: 거부 fixture의 errorCode가 없습니다.`)
    }
    for (const metric of [...EXACT_METRICS, 'minimumEstimatedPages']) {
      const value = fixture.expected[metric]
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`${fixture.id}: ${metric} 기대값이 올바르지 않습니다.`)
      }
    }
  }
  return manifest
}

export function summarizeViewerDocument(document, estimatedPages) {
  const summary = {
    sections: document.sections.length,
    paragraphs: 0,
    tables: 0,
    cells: 0,
    resources: Object.keys(document.resources).length,
    markedParagraphs: 0,
    bulletParagraphs: 0,
    numberedParagraphs: 0,
    nonWhitespaceCharacters: 0,
    diagnostics: document.diagnostics.length,
    multiColumnSections: document.sections.filter((section) => (section.columnLayout?.count ?? 1) > 1).length,
    declaredColumns: document.sections.reduce((sum, section) => sum + (section.columnLayout?.count ?? 0), 0),
    estimatedPages
  }
  const visitParagraphs = (paragraphs) => {
    for (const paragraph of paragraphs) {
      summary.paragraphs += 1
      const headingType = document.paraStyles[paragraph.paraStyleId]?.heading?.type
      if (paragraph.marker !== undefined) summary.markedParagraphs += 1
      if (headingType === 'BULLET') summary.bulletParagraphs += 1
      if (headingType === 'NUMBER') summary.numberedParagraphs += 1
      for (const item of paragraph.content) {
        if (item.type === 'text') {
          summary.nonWhitespaceCharacters += (item.text.match(/\S/gu) ?? []).length
        } else if (item.type === 'table') {
          summary.tables += 1
          for (const row of item.rows) {
            summary.cells += row.cells.length
            for (const cell of row.cells) visitParagraphs(cell.paragraphs)
          }
        }
      }
    }
  }
  for (const section of document.sections) {
    visitParagraphs(section.blocks)
    for (const header of section.headers) visitParagraphs(header.paragraphs)
    for (const footer of section.footers) visitParagraphs(footer.paragraphs)
  }
  return summary
}

export function evaluateCorpusFixture(fixture, observation) {
  const failures = []
  if (observation.outcome !== fixture.expected.outcome) {
    failures.push(`outcome 기대 ${fixture.expected.outcome}, 실제 ${observation.outcome}`)
    return failures
  }
  if (fixture.expected.outcome === 'rejected') {
    if (observation.errorCode !== fixture.expected.errorCode) {
      failures.push(`errorCode 기대 ${fixture.expected.errorCode}, 실제 ${observation.errorCode ?? '없음'}`)
    }
    return failures
  }
  for (const metric of EXACT_METRICS) {
    if (fixture.expected[metric] !== undefined && observation.metrics?.[metric] !== fixture.expected[metric]) {
      failures.push(`${metric} 기대 ${fixture.expected[metric]}, 실제 ${observation.metrics?.[metric] ?? '없음'}`)
    }
  }
  if (
    fixture.expected.minimumEstimatedPages !== undefined &&
    (observation.metrics?.estimatedPages ?? -1) < fixture.expected.minimumEstimatedPages
  ) {
    failures.push(`estimatedPages 최소 ${fixture.expected.minimumEstimatedPages}, 실제 ${observation.metrics?.estimatedPages ?? '없음'}`)
  }
  return failures
}

export function createCorpusReport(manifest, observations) {
  const fixtures = manifest.fixtures.map((fixture) => {
    const observation = observations.find((candidate) => candidate.id === fixture.id)
    const failures = observation ? evaluateCorpusFixture(fixture, observation) : ['관찰 결과가 없습니다.']
    return {
      id: fixture.id,
      category: fixture.category,
      outcome: observation?.outcome ?? 'missing',
      contentSha256: observation?.contentSha256,
      sizeBytes: observation?.sizeBytes,
      metrics: observation?.metrics,
      errorCode: observation?.errorCode,
      passed: failures.length === 0,
      failures
    }
  })
  const opened = fixtures.filter((fixture) => fixture.outcome === 'opened')
  return {
    schemaVersion: 1,
    suite: manifest.suite,
    fixtureCount: fixtures.length,
    passedCount: fixtures.filter((fixture) => fixture.passed).length,
    rejectedCount: fixtures.filter((fixture) => fixture.outcome === 'rejected').length,
    totals: {
      sizeBytes: fixtures.reduce((sum, fixture) => sum + (fixture.sizeBytes ?? 0), 0),
      sections: opened.reduce((sum, fixture) => sum + (fixture.metrics?.sections ?? 0), 0),
      tables: opened.reduce((sum, fixture) => sum + (fixture.metrics?.tables ?? 0), 0),
      cells: opened.reduce((sum, fixture) => sum + (fixture.metrics?.cells ?? 0), 0),
      resources: opened.reduce((sum, fixture) => sum + (fixture.metrics?.resources ?? 0), 0),
      markedParagraphs: opened.reduce((sum, fixture) => sum + (fixture.metrics?.markedParagraphs ?? 0), 0),
      bulletParagraphs: opened.reduce((sum, fixture) => sum + (fixture.metrics?.bulletParagraphs ?? 0), 0),
      numberedParagraphs: opened.reduce((sum, fixture) => sum + (fixture.metrics?.numberedParagraphs ?? 0), 0),
      diagnostics: opened.reduce((sum, fixture) => sum + (fixture.metrics?.diagnostics ?? 0), 0),
      multiColumnSections: opened.reduce((sum, fixture) => sum + (fixture.metrics?.multiColumnSections ?? 0), 0),
      declaredColumns: opened.reduce((sum, fixture) => sum + (fixture.metrics?.declaredColumns ?? 0), 0),
      estimatedPages: opened.reduce((sum, fixture) => sum + (fixture.metrics?.estimatedPages ?? 0), 0)
    },
    passed: fixtures.every((fixture) => fixture.passed),
    fixtures
  }
}
