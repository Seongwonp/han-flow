import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const GENERATORS = new Set([
  'createSyntheticHwpx',
  'createCellFragmentHwpx',
  'createCompatibilityHwpx',
  'createTableColumnHwpx',
  'createListMarkerHwpx',
  'createMultiColumnHwpx',
  'createRoundTripHwpx',
  'createReportTocHwpx',
  'createHangingIndentHwpx',
  'createInvalidHwpx'
])

export const LICENSES = new Set(['KOGL-1', 'CC-BY-4.0', 'Apache-2.0', 'MIT', 'project-authored', 'other'])

const GENERATOR_KEYS = new Set(['id', 'category', 'source', 'generator', 'fileName', 'options', 'expected'])
const FILE_KEYS = new Set(['id', 'category', 'source', 'file', 'origin', 'sha256', 'personalData', 'expected'])
const ORIGIN_KEYS = new Set(['url', 'publisher', 'license', 'retrievedAt', 'producer'])

export const EXACT_METRICS = [
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

// 원본처럼 그리지 못해 자리 표시로 보여 주는 개체 종류(`src/core/document/viewer_document.ts`의 ViewerObjectKind).
export const PLACEHOLDER_KINDS = [
  'equation', 'chart', 'ole', 'text-box', 'shape', 'form-control', 'video',
  'footnote', 'endnote', 'memo', 'field', 'ruby', 'unknown'
]

export function fixtureSource(fixture) {
  return fixture.source ?? 'generator'
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isSafeFixturePath(file) {
  if (typeof file !== 'string' || !file || file.length > 200) return false
  if (file.includes('\\') || file.startsWith('/') || /^[A-Za-z]:/.test(file)) return false
  const segments = file.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..') && file.toLowerCase().endsWith('.hwpx')
}

export function resolveFileFixturePath(publicRoot, fixture) {
  if (!isSafeFixturePath(fixture.file)) throw new Error(`${fixture.id}: fixture 파일 경로가 올바르지 않습니다.`)
  const base = resolve(publicRoot)
  const path = resolve(base, fixture.file)
  if (!path.startsWith(`${base}${sep}`)) throw new Error(`${fixture.id}: fixture 파일이 공개 fixture 폴더 밖에 있습니다.`)
  return path
}

// file fixture의 byte SHA-256이 manifest와 다르면 decode 전에 실패 이유를 돌려준다.
export function checkFixtureIntegrity(fixture, bytes) {
  if (fixtureSource(fixture) !== 'file') return undefined
  const actual = sha256Hex(bytes)
  return actual === fixture.sha256 ? undefined : `sha256 불일치: manifest ${fixture.sha256}, 실제 ${actual}`
}

// generator fixture는 임시 폴더에 만들고 file fixture는 무결성을 확인한 공개 fixture 경로를 돌려준다.
export function prepareCorpusFixture(fixture, { generator, directory, publicRoot }) {
  if (fixtureSource(fixture) === 'file') {
    const path = resolveFileFixturePath(publicRoot, fixture)
    const failure = checkFixtureIntegrity(fixture, readFileSync(path))
    if (failure) throw new Error(`${fixture.id}: ${failure}`)
    return path
  }
  return generateCorpusFixture(generator, directory, fixture)
}

export function generateCorpusFixture(generator, directory, fixture) {
  if (fixtureSource(fixture) !== 'generator') throw new Error(`${fixture.id}: generator fixture가 아닙니다.`)
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
    const source = fixtureSource(fixture)
    if (source === 'generator') validateGeneratorFixture(fixture)
    else if (source === 'file') validateFileFixture(fixture)
    else throw new Error(`${fixture.id}: source는 generator 또는 file이어야 합니다.`)
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
    validatePlaceholderExpectation(fixture)
  }
  return manifest
}

function validatePlaceholderExpectation(fixture) {
  const value = fixture.expected.placeholders
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fixture.id}: placeholders 기대값은 종류별 개수 object여야 합니다.`)
  }
  for (const [kind, amount] of Object.entries(value)) {
    if (!PLACEHOLDER_KINDS.includes(kind)) throw new Error(`${fixture.id}: 알 수 없는 placeholders 종류입니다: ${kind}`)
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error(`${fixture.id}: placeholders.${kind} 기대값이 올바르지 않습니다.`)
  }
}

// 종류별 개수 object를 PLACEHOLDER_KINDS 순서의 비교 가능한 문자열로 만든다(0개 종류는 뺀다).
export function formatPlaceholderCounts(counts = {}) {
  return PLACEHOLDER_KINDS.filter((kind) => counts[kind]).map((kind) => `${kind}=${counts[kind]}`).join(',') || '없음'
}

function rejectUnknownKeys(fixture, object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`${fixture.id}: ${label}에 허용하지 않은 항목입니다: ${key}`)
  }
}

function validateGeneratorFixture(fixture) {
  rejectUnknownKeys(fixture, fixture, GENERATOR_KEYS, 'generator fixture')
  if (!GENERATORS.has(fixture.generator)) {
    throw new Error(`${fixture.id}: 허용하지 않은 fixture generator입니다.`)
  }
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200
}

function validateFileFixture(fixture) {
  rejectUnknownKeys(fixture, fixture, FILE_KEYS, 'file fixture')
  if (!isSafeFixturePath(fixture.file)) {
    throw new Error(`${fixture.id}: file은 공개 fixture 폴더 기준 상대 .hwpx 경로여야 하며 절대 경로와 ..를 허용하지 않습니다.`)
  }
  if (typeof fixture.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(fixture.sha256)) {
    throw new Error(`${fixture.id}: sha256은 소문자 64자리 hex여야 합니다.`)
  }
  if (fixture.personalData !== false) {
    throw new Error(`${fixture.id}: personalData는 false여야 합니다. 개인정보가 있는 파일은 공개 corpus에 넣을 수 없습니다.`)
  }
  const origin = fixture.origin
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) throw new Error(`${fixture.id}: origin이 없습니다.`)
  rejectUnknownKeys(fixture, origin, ORIGIN_KEYS, 'origin')
  if (typeof origin.url !== 'string' || !/^https?:\/\/\S+$/.test(origin.url)) {
    throw new Error(`${fixture.id}: origin.url이 올바르지 않습니다.`)
  }
  if (!isNonEmptyText(origin.publisher)) throw new Error(`${fixture.id}: origin.publisher가 비어 있습니다.`)
  if (!LICENSES.has(origin.license)) throw new Error(`${fixture.id}: 허용하지 않은 license입니다.`)
  if (!isIsoDate(origin.retrievedAt)) throw new Error(`${fixture.id}: origin.retrievedAt은 YYYY-MM-DD여야 합니다.`)
  if (!isNonEmptyText(origin.producer)) throw new Error(`${fixture.id}: origin.producer가 비어 있습니다.`)
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
    estimatedPages,
    placeholders: {}
  }
  const placeholderCounts = {}
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
        } else if (item.type === 'object-placeholder') {
          placeholderCounts[item.kind] = (placeholderCounts[item.kind] ?? 0) + 1
          if (item.paragraphs) visitPlaceholderParagraphs(item.paragraphs)
        } else if (item.type === 'note-list') {
          for (const note of item.notes) visitPlaceholderParagraphs(note.paragraphs)
        }
      }
    }
  }
  // 글상자·각주·메모 본문 안 문단은 본문 문단·글자 수에 넣지 않고 그 안의 자리 표시만 센다.
  const visitPlaceholderParagraphs = (paragraphs) => {
    for (const paragraph of paragraphs) {
      for (const item of paragraph.content) {
        if (item.type === 'object-placeholder') {
          placeholderCounts[item.kind] = (placeholderCounts[item.kind] ?? 0) + 1
          if (item.paragraphs) visitPlaceholderParagraphs(item.paragraphs)
        } else if (item.type === 'table') {
          for (const row of item.rows) for (const cell of row.cells) visitPlaceholderParagraphs(cell.paragraphs)
        }
      }
    }
  }
  for (const section of document.sections) {
    visitParagraphs(section.blocks)
    for (const header of section.headers) visitParagraphs(header.paragraphs)
    for (const footer of section.footers) visitParagraphs(footer.paragraphs)
  }
  summary.placeholders = Object.fromEntries(PLACEHOLDER_KINDS.filter((kind) => placeholderCounts[kind]).map((kind) => [kind, placeholderCounts[kind]]))
  return summary
}

export function evaluateCorpusFixture(fixture, observation) {
  const failures = []
  if (observation.integrityFailure) return [observation.integrityFailure]
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
  if (fixture.expected.placeholders !== undefined) {
    const expected = formatPlaceholderCounts(fixture.expected.placeholders)
    const actual = formatPlaceholderCounts(observation.metrics?.placeholders)
    if (expected !== actual) failures.push(`placeholders 기대 ${expected}, 실제 ${actual}`)
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
    const provenance = fixtureSource(fixture) === 'file'
      ? { license: fixture.origin.license, producer: fixture.origin.producer }
      : {}
    return {
      id: fixture.id,
      category: fixture.category,
      source: fixtureSource(fixture),
      ...provenance,
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
    fileFixtureCount: fixtures.filter((fixture) => fixture.source === 'file').length,
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
      estimatedPages: opened.reduce((sum, fixture) => sum + (fixture.metrics?.estimatedPages ?? 0), 0),
      placeholders: Object.fromEntries(PLACEHOLDER_KINDS.map((kind) => [
        kind,
        opened.reduce((sum, fixture) => sum + (fixture.metrics?.placeholders?.[kind] ?? 0), 0)
      ]).filter(([, amount]) => amount > 0))
    },
    passed: fixtures.every((fixture) => fixture.passed),
    fixtures
  }
}
