import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  checkFixtureIntegrity,
  fixtureSource,
  generateCorpusFixture,
  resolveFileFixturePath,
  summarizeViewerDocument
} from './public_corpus.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const AdmZip = require('adm-zip')

export const repositoryRoot = resolve(import.meta.dirname, '../..')
export const publicFixtureRoot = resolve(repositoryRoot, 'tests/fixtures/public')
const generatorPath = resolve(publicFixtureRoot, 'create_synthetic_hwpx.ts')
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  esModuleInterop: true
}

let core

// 저장소 기준 상대 경로의 TypeScript module을 CommonJS로 transpile해 불러온다.
export function loadTypeScriptModule(relativePath) {
  if (!require.extensions['.ts']) {
    require.extensions['.ts'] = (module, fileName) => {
      const source = readFileSync(fileName, 'utf8')
      module._compile(ts.transpileModule(source, { compilerOptions, fileName }).outputText, fileName)
    }
  }
  return require(resolve(repositoryRoot, relativePath))
}

function loadCore() {
  if (core) return core
  core = {
    HwpxSourcePackage: loadTypeScriptModule('src/core/parser/source_package.ts').HwpxSourcePackage,
    decodeViewerDocument: loadTypeScriptModule('src/core/parser/viewer_decoder.ts').decodeViewerDocument,
    paginateViewerDocument: loadTypeScriptModule('src/core/layout/pagination.ts').paginateViewerDocument
  }
  return core
}

export function loadGenerator() {
  const javascript = ts.transpileModule(readFileSync(generatorPath, 'utf8'), { compilerOptions }).outputText
  const loaded = { exports: {} }
  const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', javascript)
  execute(createRequire(generatorPath), loaded, loaded.exports, generatorPath, dirname(generatorPath))
  return loaded.exports
}

// ZIP timestamp를 제외하고 entry 이름·내용만으로 계산하는 결정적 content hash
export function contentSha256(bytes) {
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

export async function decodeHwpxMetrics(path) {
  const { HwpxSourcePackage, decodeViewerDocument, paginateViewerDocument } = loadCore()
  const sourcePackage = await HwpxSourcePackage.open(path)
  const document = await decodeViewerDocument(sourcePackage)
  return summarizeViewerDocument(document, paginateViewerDocument(document).length)
}

export async function observeHwpxPath(id, path, bytes) {
  let hash
  try {
    hash = contentSha256(bytes)
  } catch {
    hash = undefined
  }
  const base = { id, contentSha256: hash, sizeBytes: bytes.length }
  try {
    return { ...base, outcome: 'opened', metrics: await decodeHwpxMetrics(path) }
  } catch (error) {
    return {
      ...base,
      outcome: 'rejected',
      errorCode: 'HWPX_IMPORT_FAILED',
      errorType: error instanceof Error ? error.name : 'UnknownError'
    }
  }
}

// file fixture는 decode 전에 manifest sha256을 확인하고, 불일치나 누락은 개별 fixture 실패로 기록한다.
export async function observeCorpusFixture(fixture, { generator, directory, publicRoot = publicFixtureRoot }) {
  if (fixtureSource(fixture) === 'file') {
    let path
    let bytes
    try {
      path = resolveFileFixturePath(publicRoot, fixture)
      bytes = await readFile(path)
    } catch {
      return { id: fixture.id, outcome: 'integrity-failed', integrityFailure: 'fixture 파일을 읽을 수 없습니다.' }
    }
    const integrityFailure = checkFixtureIntegrity(fixture, bytes)
    if (integrityFailure) {
      return { id: fixture.id, outcome: 'integrity-failed', sizeBytes: bytes.length, integrityFailure }
    }
    return observeHwpxPath(fixture.id, path, bytes)
  }
  const path = generateCorpusFixture(generator, directory, fixture)
  return observeHwpxPath(fixture.id, path, await readFile(path))
}
