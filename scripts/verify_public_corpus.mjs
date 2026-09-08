import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  createCorpusReport,
  summarizeViewerDocument,
  validateCorpusManifest
} from './corpus/public_corpus.mjs'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const ts = require('typescript')
const AdmZip = require('adm-zip')
const generatorPath = resolve(root, 'tests/fixtures/public/create_synthetic_hwpx.ts')
const manifestPath = resolve(root, 'tests/fixtures/public/hwpx_corpus_manifest.json')
const outputArgument = process.argv.indexOf('--output')
const outputPath = outputArgument >= 0 && process.argv[outputArgument + 1]
  ? resolve(process.argv[outputArgument + 1])
  : undefined

function registerTypeScriptLoader() {
  require.extensions['.ts'] = (module, fileName) => {
    const source = require('node:fs').readFileSync(fileName, 'utf8')
    const javascript = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true
      },
      fileName
    }).outputText
    module._compile(javascript, fileName)
  }
}

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

function generateFixture(generator, directory, fixture) {
  const create = generator[fixture.generator]
  if (fixture.options) return create(directory, fixture.options)
  return create(directory, fixture.fileName)
}

function contentSha256(bytes) {
  const digest = createHash('sha256')
  const entries = new AdmZip(bytes).getEntries().sort((left, right) => left.entryName.localeCompare(right.entryName))
  for (const entry of entries) {
    const name = Buffer.from(entry.entryName, 'utf8')
    const content = entry.isDirectory ? Buffer.alloc(0) : entry.getData()
    const lengths = Buffer.alloc(8)
    lengths.writeUInt32BE(name.length, 0)
    lengths.writeUInt32BE(content.length, 4)
    digest.update(lengths).update(name).update(content)
  }
  return digest.digest('hex')
}

registerTypeScriptLoader()
const { HwpxSourcePackage } = require(resolve(root, 'src/core/parser/source_package.ts'))
const { decodeViewerDocument } = require(resolve(root, 'src/core/parser/viewer_decoder.ts'))
const { paginateViewerDocument } = require(resolve(root, 'src/core/layout/pagination.ts'))
const manifest = validateCorpusManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
const generator = loadGenerator()
const directory = await mkdtemp(join(tmpdir(), 'han-flow-public-corpus-'))

try {
  const observations = []
  for (const fixture of manifest.fixtures) {
    const fixturePath = generateFixture(generator, directory, fixture)
    const bytes = await readFile(fixturePath)
    const base = { id: fixture.id, contentSha256: contentSha256(bytes), sizeBytes: bytes.length }
    try {
      const sourcePackage = await HwpxSourcePackage.open(fixturePath)
      const document = await decodeViewerDocument(sourcePackage)
      const estimatedPages = paginateViewerDocument(document).length
      observations.push({
        ...base,
        outcome: 'opened',
        metrics: summarizeViewerDocument(document, estimatedPages)
      })
    } catch (error) {
      observations.push({
        ...base,
        outcome: 'rejected',
        errorCode: 'HWPX_IMPORT_FAILED',
        errorType: error instanceof Error ? error.name : 'UnknownError'
      })
    }
  }
  const report = createCorpusReport(manifest, observations)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) await writeFile(outputPath, serialized)
  console.log('HAN_FLOW_PUBLIC_CORPUS', JSON.stringify(report))
  if (!report.passed) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
