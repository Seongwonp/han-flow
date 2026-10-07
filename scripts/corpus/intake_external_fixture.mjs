// 실제 한/글 HWPX를 external fixture로 들여와 manifest와 catalog 항목을 한 번에 추가한다.
// 사용: npm run corpus:intake -- <path> --id <id> --category <cat> --url <url> --publisher <p>
//        --license <L> --producer <p> --no-personal-data [--retrieved-at YYYY-MM-DD]
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { EXACT_METRICS, LICENSES, sha256Hex, validateCorpusManifest } from './public_corpus.mjs'
import { linkHwpxManifest, validateFixtureCatalog } from './fixture_catalog.mjs'
import { observeHwpxPath, publicFixtureRoot } from './corpus_runtime.mjs'

const usage = [
  '사용: npm run corpus:intake -- <file.hwpx> --id <id> --category <category> --url <url>',
  '       --publisher <publisher> --license <license> --producer <producer> --no-personal-data',
  '       [--retrieved-at YYYY-MM-DD]',
  `license: ${[...LICENSES].join(', ')}`
].join('\n')

function fail(message) {
  console.error(`intake 실패: ${message}\n\n${usage}`)
  process.exit(1)
}

function today() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// 기존 JSON의 수기 서식을 유지하도록 마지막 fixtures 배열 끝에 새 항목만 삽입한다.
function appendFixture(text, entry) {
  const closing = text.lastIndexOf('\n  ]')
  if (closing < 0) throw new Error('fixtures 배열 끝을 찾지 못했습니다.')
  const serialized = JSON.stringify(entry, null, 2)
    .replace(/\[\s*("[^"]*"(?:,\s*"[^"]*")*)\s*\]/g, (_, items) => `[${items.split(/,\s*/).join(', ')}]`)
    .split('\n').map((line) => `    ${line}`).join('\n')
  return `${text.slice(0, closing)},\n${serialized}${text.slice(closing)}`
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      category: { type: 'string' },
      url: { type: 'string' },
      publisher: { type: 'string' },
      license: { type: 'string' },
      producer: { type: 'string' },
      'retrieved-at': { type: 'string' },
      'no-personal-data': { type: 'boolean' }
    }
  })
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
const { values, positionals } = parsed
if (positionals.length !== 1) fail('HWPX 파일 경로 하나가 필요합니다.')
for (const name of ['id', 'category', 'url', 'publisher', 'license', 'producer']) {
  if (!values[name]) fail(`--${name}가 필요합니다.`)
}
if (!values['no-personal-data']) {
  fail('개인정보(이름·연락처·주민번호·서명 등)가 없음을 확인했다면 --no-personal-data를 붙이세요.')
}

const sourcePath = resolve(positionals[0])
if (!sourcePath.toLowerCase().endsWith('.hwpx')) fail('.hwpx 파일만 받을 수 있습니다.')
if (!existsSync(sourcePath)) fail(`파일이 없습니다: ${basename(sourcePath)}`)

const manifestPath = resolve(publicFixtureRoot, 'hwpx_corpus_manifest.json')
const catalogPath = resolve(publicFixtureRoot, 'fixture_catalog.json')
const relativeFile = `external/${values.id}.hwpx`
const targetPath = resolve(publicFixtureRoot, relativeFile)
if (existsSync(targetPath)) fail(`${relativeFile}이 이미 있습니다.`)

const bytes = await readFile(sourcePath)
const observation = await observeHwpxPath(values.id, sourcePath, bytes)
const expected = { outcome: observation.outcome }
if (observation.outcome === 'opened') {
  for (const metric of EXACT_METRICS) expected[metric] = observation.metrics[metric]
  // 원본 개체 자리 표시 종류별 개수도 고정한다(verify:corpus가 exact 비교, 개체가 없으면 빈 object).
  expected.placeholders = observation.metrics.placeholders ?? {}
} else {
  expected.errorCode = observation.errorCode
}

const manifestEntry = {
  id: values.id,
  category: values.category,
  source: 'file',
  file: relativeFile,
  origin: {
    url: values.url,
    publisher: values.publisher,
    license: values.license,
    retrievedAt: values['retrieved-at'] ?? today(),
    producer: values.producer
  },
  sha256: sha256Hex(bytes),
  personalData: false,
  expected
}
const catalogEntry = {
  id: values.id,
  format: 'hwpx',
  category: values.category,
  provenance: 'external',
  pipelines: ['hwpx-core']
}

const manifestText = appendFixture(await readFile(manifestPath, 'utf8'), manifestEntry)
const catalogText = appendFixture(await readFile(catalogPath, 'utf8'), catalogEntry)
try {
  const manifest = validateCorpusManifest(JSON.parse(manifestText))
  linkHwpxManifest(validateFixtureCatalog(JSON.parse(catalogText)), manifest)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

// 파일 복사가 끝난 뒤 manifest·catalog를 임시 파일 rename으로 교체한다.
await copyFile(sourcePath, targetPath)
await writeFile(`${manifestPath}.intake`, manifestText)
await writeFile(`${catalogPath}.intake`, catalogText)
await rename(`${manifestPath}.intake`, manifestPath)
await rename(`${catalogPath}.intake`, catalogPath)

console.log(`추가됨: ${relativeFile}`)
console.log(`sha256: ${manifestEntry.sha256}`)
console.log(`expected: ${JSON.stringify(expected)}`)
if (observation.outcome !== 'opened') {
  console.warn('경고: 현재 decoder가 이 파일을 열지 못해 rejected로 기록했습니다. 원인을 조사해 최소 generator로 축소하세요.')
}
