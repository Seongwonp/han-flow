import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { generateCorpusFixture, validateCorpusManifest } from './corpus/public_corpus.mjs'
import { linkHwpxManifest, validateFixtureCatalog } from './corpus/fixture_catalog.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = resolve(import.meta.dirname, '..')
const defaultAppBinary = process.platform === 'win32'
  ? resolve(root, 'release/win-unpacked/Han-Flow.exe')
  : resolve(root, 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const appBinary = resolve(process.argv[2] ?? defaultAppBinary)
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
    'invalid-package': {
      expectedError: true
    }
  }
  const fixtures = productionFixtures.map((fixture) => ({
    id: fixture.id,
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

  const continuation = results.find(({ fixtureId }) => fixtureId === 'cell-continuation')
  const compatibility = results.find(({ fixtureId }) => fixtureId === 'images-rowspan')
  const large = results.find(({ fixtureId }) => fixtureId === 'large-progressive')
  const invalid = results.find(({ fixtureId }) => fixtureId === 'invalid-package')
  const failures = [
    ...results.filter(({ passed }) => !passed).map(({ fixtureId }) => `${fixtureId}: verify 실패`),
    continuation?.totalPages === 2 ? undefined : 'cell-continuation: 2페이지가 아님',
    compatibility?.imageCount === 12 ? undefined : 'images-rowspan: 이미지 12개가 decode되지 않음',
    large && large.totalPages > 50 ? undefined : 'large-progressive: 50페이지를 넘지 않음',
    large && large.mountedPages < large.totalPages ? undefined : 'large-progressive: page virtualization이 적용되지 않음',
    invalid?.expectedError && invalid.passed ? undefined : 'invalid-package: 오류 안내 검증 실패'
  ].filter(Boolean)
  const summary = {
    passed: failures.length === 0,
    fixtures: results.map(({ fixtureId, name, totalPages, mountedPages, imageCount, overflowPages }) => ({
      fixtureId, name, totalPages, mountedPages, imageCount, overflowPages
    })),
    failures
  }
  console.log('HAN_FLOW_PUBLIC_MATRIX', JSON.stringify(summary))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
