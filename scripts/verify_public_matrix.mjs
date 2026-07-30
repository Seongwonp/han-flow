import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const appBinary = resolve(process.argv[2] ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const generatorPath = resolve('tests/fixtures/public/create_synthetic_hwpx.ts')

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
    const arguments_ = [resolve('scripts/verify_app.mjs'), fixture, appBinary]
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
  const { createCellFragmentHwpx, createCompatibilityHwpx, createInvalidHwpx, createSyntheticHwpx } = loadGenerator()
  const fixtures = [
    {
      name: 'baseline',
      path: createSyntheticHwpx(directory, { fileName: 'baseline.hwpx' }),
      delayMs: 500,
      environment: {
        HAN_FLOW_VERIFY_EDIT_TEXT: '셀검증',
        HAN_FLOW_VERIFY_EDIT_MODE: 'range',
        HAN_FLOW_VERIFY_EDIT_CELL: '1',
        HAN_FLOW_VERIFY_EDIT_SAVE: '1'
      }
    },
    {
      name: 'cell-continuation',
      path: createCellFragmentHwpx(directory, 'cell-continuation.hwpx'),
      delayMs: 500
    },
    {
      name: 'images-rowspan',
      path: createCompatibilityHwpx(directory, 'images-rowspan.hwpx'),
      delayMs: 500
    },
    {
      name: 'large-progressive',
      path: createSyntheticHwpx(directory, {
        fileName: 'large-progressive.hwpx',
        sectionCount: 80,
        paragraphsPerExtraSection: 250,
        imageBytes: 5 * 1024 * 1024
      }),
      delayMs: 500
    },
    {
      name: 'invalid-package',
      path: createInvalidHwpx(directory, 'invalid-package.hwpx'),
      delayMs: 500,
      expectedError: true
    }
  ]
  const results = []
  for (const fixture of fixtures) {
    results.push({
      name: fixture.name,
      ...await verify(fixture.path, fixture.delayMs, fixture.expectedError, fixture.environment)
    })
  }

  const continuation = results.find(({ name }) => name === 'cell-continuation')
  const compatibility = results.find(({ name }) => name === 'images-rowspan')
  const large = results.find(({ name }) => name === 'large-progressive')
  const invalid = results.find(({ name }) => name === 'invalid-package')
  const failures = [
    ...results.filter(({ passed }) => !passed).map(({ name }) => `${name}: verify 실패`),
    continuation?.totalPages === 2 ? undefined : 'cell-continuation: 2페이지가 아님',
    compatibility?.imageCount === 12 ? undefined : 'images-rowspan: 이미지 12개가 decode되지 않음',
    large && large.totalPages > 50 ? undefined : 'large-progressive: 50페이지를 넘지 않음',
    large && large.mountedPages < large.totalPages ? undefined : 'large-progressive: page virtualization이 적용되지 않음',
    invalid?.expectedError && invalid.passed ? undefined : 'invalid-package: 오류 안내 검증 실패'
  ].filter(Boolean)
  const summary = {
    passed: failures.length === 0,
    fixtures: results.map(({ name, totalPages, mountedPages, imageCount, overflowPages }) => ({
      name, totalPages, mountedPages, imageCount, overflowPages
    })),
    failures
  }
  console.log('HAN_FLOW_PUBLIC_MATRIX', JSON.stringify(summary))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
