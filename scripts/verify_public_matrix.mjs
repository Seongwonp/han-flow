import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { generateCorpusFixture, validateCorpusManifest } from './corpus/public_corpus.mjs'
import { linkHwpxManifest, validateFixtureCatalog } from './corpus/fixture_catalog.mjs'
import { defaultAppBinary } from './app_binary.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = resolve(import.meta.dirname, '..')
const appBinary = process.argv[2] ? resolve(process.argv[2]) : defaultAppBinary(root)
const generatorPath = resolve(root, 'tests/fixtures/public/create_synthetic_hwpx.ts')
const manifestPath = resolve(root, 'tests/fixtures/public/hwpx_corpus_manifest.json')
const catalogPath = resolve(root, 'tests/fixtures/public/fixture_catalog.json')

function loadGenerator() {
  const source = require('node:fs').readFileSync(generatorPath, 'utf8')
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText
  const loaded = { exports: {} }
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', javascript)
  execute(createRequire(generatorPath), loaded, loaded.exports, generatorPath, dirname(generatorPath))
  return loaded.exports
}

async function verify(fixture, delayMs, expectedError = false, environment = {}) {
  let standardOutput = ''
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const arguments_ = [resolve(root, 'scripts/verify_app.mjs'), fixture, appBinary]
    if (expectedError) arguments_.push('--expect-error')
    const child = spawn(process.execPath, arguments_, {
      env: { ...process.env, HAN_FLOW_VERIFY_DELAY_MS: String(delayMs), ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => { standardOutput += chunk.toString() })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`fixture 검증 실패(${code}): ${standardError.trim() || standardOutput.trim()}`))
    })
  })
  const resultLine = standardOutput.split('\n').find((line) => line.startsWith('HAN_FLOW_APP_VERIFY '))
  if (!resultLine) throw new Error(`검증 결과를 찾지 못했습니다. ${standardError.trim()}`)
  return JSON.parse(resultLine.slice('HAN_FLOW_APP_VERIFY '.length))
}

async function verifyPdf(fixture) {
  let standardOutput = ''
  let standardError = ''
  const exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/verify_pdf.mjs'), fixture, appBinary], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => { standardOutput += chunk.toString() })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    child.once('error', reject)
    child.once('exit', resolvePromise)
  })
  const resultLine = standardOutput.split('\n').find((line) => line.startsWith('HAN_FLOW_PDF_VERIFY '))
  if (!resultLine) throw new Error(`PDF 검증 결과를 찾지 못했습니다(${exitCode}). ${standardError.trim()}`)
  return JSON.parse(resultLine.slice('HAN_FLOW_PDF_VERIFY '.length))
}

// 화면과 PDF의 페이지별 글자 수를 비교할 production fixture.
// report-toc: 목차 번호(`1.`)와 사설 영역 글머리, hanging-indent: 내어쓰기 첫 줄이 용지 밖으로 잘리던 문단.
const PDF_FIXTURE_IDS = new Set(['report-toc', 'hanging-indent'])

const directory = await mkdtemp(join(tmpdir(), 'han-flow-public-matrix-'))
try {
  const generator = loadGenerator()
  const manifest = validateCorpusManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const catalog = validateFixtureCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
  const productionFixtures = linkHwpxManifest(catalog, manifest)
  const productionOptions = {
    baseline: {
      environment: {
        HAN_FLOW_VERIFY_EDIT_TEXT: '셀검증',
        HAN_FLOW_VERIFY_EDIT_MODE: 'range',
        HAN_FLOW_VERIFY_EDIT_CELL: '1',
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      }
    },
    // 구역 첫 문단이 글자 칸 없는 빈 문단이라 기본 문단 편집 E2E가 #hp:p:0:empty → #hp:t:0 전환을 거친다.
    'hanging-indent': {
      environment: {
        HAN_FLOW_VERIFY_EDIT_TEXT: '시험',
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      }
    },
    'invalid-package': {
      expectedError: true
    }
  }
  const fixtures = productionFixtures.map((fixture) => ({
    id: fixture.id,
    // production matrix는 catalog가 synthetic generator fixture만 허용한다(external은 hwpx-core 전용).
    path: generateCorpusFixture(generator, directory, fixture.manifest),
    delayMs: 500,
    ...productionOptions[fixture.id]
  }))
  const results = []
  for (const fixture of fixtures) {
    results.push({
      fixtureId: fixture.id,
      name: fixture.id,
      ...await verify(fixture.path, fixture.delayMs, fixture.expectedError, fixture.environment)
    })
  }

  const pdfResults = []
  for (const fixture of fixtures.filter(({ id }) => PDF_FIXTURE_IDS.has(id))) {
    pdfResults.push({ fixtureId: fixture.id, ...await verifyPdf(fixture.path) })
  }

  const continuation = results.find(({ fixtureId }) => fixtureId === 'cell-continuation')
  const compatibility = results.find(({ fixtureId }) => fixtureId === 'images-rowspan')
  const multiColumn = results.find(({ fixtureId }) => fixtureId === 'multi-column-layout')
  const large = results.find(({ fixtureId }) => fixtureId === 'large-progressive')
  const invalid = results.find(({ fixtureId }) => fixtureId === 'invalid-package')
  const reportToc = results.find(({ fixtureId }) => fixtureId === 'report-toc')
  const hangingIndent = results.find(({ fixtureId }) => fixtureId === 'hanging-indent')
  const failures = [
    ...results.filter(({ passed }) => !passed).map(({ fixtureId }) => `${fixtureId}: verify 실패`),
    ...pdfResults.filter(({ passed }) => !passed).map(({ fixtureId, failures: pdfFailures }) => `${fixtureId}: PDF 검증 실패(${pdfFailures.join(', ')})`),
    reportToc?.totalPages === 3 ? undefined : 'report-toc: 표지·목차·본문 3페이지가 아님',
    hangingIndent?.editingProbe?.anchorTransition?.to?.endsWith('#hp:t:0') ? undefined : 'hanging-indent: 빈 문단 합성 anchor 편집 전환이 검증되지 않음',
    hangingIndent?.outsidePageTextPages?.length === 0 ? undefined : `hanging-indent: 용지 밖으로 나간 글자(${hangingIndent?.outsidePageTextPages?.join(', ')})`,
    hangingIndent?.cellOverflowTexts?.length === 0 ? undefined : `hanging-indent: 표 셀 밖으로 나간 글자(${hangingIndent?.cellOverflowTexts?.join(', ')})`,
    continuation?.totalPages === 2 ? undefined : 'cell-continuation: 2페이지가 아님',
    compatibility?.imageCount === 12 ? undefined : 'images-rowspan: 이미지 12개가 decode되지 않음',
    multiColumn?.totalPages > 0 ? undefined : 'multi-column-layout: 페이지가 생성되지 않음',
    multiColumn?.columnCounts?.length === multiColumn?.totalPages && multiColumn.columnCounts.every((count) => count === 2)
      ? undefined
      : 'multi-column-layout: 각 페이지의 2단 DOM이 생성되지 않음',
    multiColumn?.columnTextCounts?.[0]?.length === 2 && multiColumn.columnTextCounts[0].every((count) => count > 0)
      ? undefined
      : 'multi-column-layout: 첫 페이지 양쪽 단의 본문이 비어 있음',
    large && large.totalPages > 50 ? undefined : 'large-progressive: 50페이지를 넘지 않음',
    large && large.mountedPages < large.totalPages ? undefined : 'large-progressive: page virtualization이 적용되지 않음',
    invalid?.expectedError && invalid.passed ? undefined : 'invalid-package: 오류 안내 검증 실패'
  ].filter(Boolean)
  const summary = {
    passed: failures.length === 0,
    fixtures: results.map(({ fixtureId, name, totalPages, mountedPages, imageCount, overflowPages, columnCounts, columnTextCounts }) => ({
      fixtureId, name, totalPages, mountedPages, imageCount, overflowPages, columnCounts, columnTextCounts
    })),
    pdf: pdfResults.map(({ fixtureId, passed, screenPageTextCounts, pageTextCounts, pdfTitle }) => ({
      fixtureId, passed, screenPageTextCounts, pdfPageTextCounts: pageTextCounts, pdfTitle
    })),
    failures
  }
  console.log('HAN_FLOW_PUBLIC_MATRIX', JSON.stringify(summary))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
