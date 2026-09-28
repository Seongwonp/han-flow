import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCorpusReport, validateCorpusManifest } from './corpus/public_corpus.mjs'
import { linkHwpManifest, linkHwpxManifest, validateFixtureCatalog } from './corpus/fixture_catalog.mjs'
import { loadGenerator, observeCorpusFixture, publicFixtureRoot } from './corpus/corpus_runtime.mjs'

const manifestPath = resolve(publicFixtureRoot, 'hwpx_corpus_manifest.json')
const catalogPath = resolve(publicFixtureRoot, 'fixture_catalog.json')
const hwpManifestPath = resolve(publicFixtureRoot, 'synthetic-layout.hwp.json')
const outputArgument = process.argv.indexOf('--output')
const outputPath = outputArgument >= 0 && process.argv[outputArgument + 1]
  ? resolve(process.argv[outputArgument + 1])
  : undefined

const manifest = validateCorpusManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
const catalog = validateFixtureCatalog(JSON.parse(await readFile(catalogPath, 'utf8')))
linkHwpxManifest(catalog, manifest)
linkHwpManifest(catalog, JSON.parse(await readFile(hwpManifestPath, 'utf8')))
const generator = loadGenerator()
const directory = await mkdtemp(join(tmpdir(), 'han-flow-public-corpus-'))

try {
  const observations = []
  for (const fixture of manifest.fixtures) {
    observations.push(await observeCorpusFixture(fixture, { generator, directory, publicRoot: publicFixtureRoot }))
  }
  const report = createCorpusReport(manifest, observations)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) await writeFile(outputPath, serialized)
  console.log('HAN_FLOW_PUBLIC_CORPUS', JSON.stringify(report))
  if (!report.passed) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
