import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { outputProbe, safeError } from './hwp_probe_common.mjs'

const require = createRequire(import.meta.url)

function textCount(value) {
  return typeof value === 'string' ? value.replace(/\s/gu, '').length : 0
}

function summarizeParagraphs(paragraphs) {
  const result = { paragraphs: 0, tables: 0, cells: 0, images: 0, textCharacters: 0 }
  const visitParagraph = (paragraph) => {
    result.paragraphs += 1
    if (paragraph.marker) result.textCharacters += textCount(paragraph.marker)
    for (const item of paragraph.content ?? []) {
      if (item.type === 'text') result.textCharacters += textCount(item.text)
      if (item.type === 'image') result.images += 1
      if (item.type === 'table') {
        result.tables += 1
        for (const row of item.rows ?? []) {
          for (const cell of row.cells ?? []) {
            result.cells += 1
            cell.paragraphs?.forEach(visitParagraph)
          }
        }
      }
    }
  }
  paragraphs.forEach(visitParagraph)
  return result
}

function merge(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0
  return target
}

function summarizeDocument(document) {
  const total = { paragraphs: 0, tables: 0, cells: 0, images: 0, textCharacters: 0 }
  const sections = document.sections.map((section) => {
    const body = summarizeParagraphs(section.blocks)
    const headers = section.headers.reduce(
      (sum, control) => merge(sum, summarizeParagraphs(control.paragraphs)),
      { paragraphs: 0, tables: 0, cells: 0, images: 0, textCharacters: 0 }
    )
    const footers = section.footers.reduce(
      (sum, control) => merge(sum, summarizeParagraphs(control.paragraphs)),
      { paragraphs: 0, tables: 0, cells: 0, images: 0, textCharacters: 0 }
    )
    merge(total, body)
    merge(total, headers)
    merge(total, footers)
    return { body, headers, footers }
  })
  return {
    sectionCount: document.sections.length,
    resources: Object.keys(document.resources).length,
    total,
    sections
  }
}

async function loadBuiltDecoder() {
  const chunks = resolve(import.meta.dirname, '../../out/main/chunks')
  let files
  try {
    files = await readdir(chunks)
  } catch {
    throw new Error('먼저 npm run build를 실행해야 합니다.')
  }
  const decoder = files.find((file) => /^viewer_decoder-.*\.js$/.test(file))
  if (!decoder) throw new Error('build 결과에서 viewer decoder를 찾을 수 없습니다.')
  return require(resolve(chunks, decoder))
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) throw new Error('사용법: node scripts/probes/hwpx_reference_probe.mjs <document.hwpx>')
  const started = performance.now()
  const fileInfo = await stat(filePath)
  const bytes = await readFile(filePath)
  const { HwpxPackageReader, decodeViewerDocument } = await loadBuiltDecoder()
  const decodeStarted = performance.now()
  const reader = await HwpxPackageReader.open(filePath)
  const index = await reader.index()
  const document = await decodeViewerDocument(reader, index)
  const decodeMs = performance.now() - decodeStarted

  outputProbe('HAN_FLOW_HWPX_REFERENCE', {
    schemaVersion: 1,
    engine: 'han-flow-hwpx',
    input: {
      format: 'hwpx',
      sizeBytes: fileInfo.size,
      sha256Prefix: createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    },
    timings: { decodeMs, totalMs: performance.now() - started },
    result: { success: true, structure: summarizeDocument(document) }
  })
}

if (process.argv[1] && basename(process.argv[1]) === 'hwpx_reference_probe.mjs') {
  main().catch((error) => {
    outputProbe('HAN_FLOW_HWPX_REFERENCE', {
      schemaVersion: 1,
      engine: 'han-flow-hwpx',
      result: { success: false, error: safeError(error) }
    })
    process.exitCode = 1
  })
}

export { summarizeDocument, summarizeParagraphs }
