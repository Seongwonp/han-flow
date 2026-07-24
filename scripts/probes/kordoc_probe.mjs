import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { inspectHwpContainer, outputProbe, probeEnvelope, safeError } from './hwp_probe_common.mjs'

function countText(value) {
  return typeof value === 'string' ? value.replace(/\s/gu, '').length : 0
}

function summarizeBlocks(blocks) {
  const summary = {
    blocks: 0,
    paragraphs: 0,
    headings: 0,
    lists: 0,
    tables: 0,
    cells: 0,
    imageBlocks: 0,
    styledBlocks: 0,
    spans: 0,
    textCharacters: 0
  }

  const visit = (block) => {
    summary.blocks += 1
    if (block.style) summary.styledBlocks += 1
    if (block.spans) summary.spans += block.spans.length

    if (block.type === 'table' && block.table) {
      summary.tables += 1
      for (const row of block.table.cells ?? []) {
        for (const cell of row) {
          if (!cell) continue
          summary.cells += 1
          if (cell.blocks?.length) cell.blocks.forEach(visit)
          else summary.textCharacters += countText(cell.text)
        }
      }
      return
    }

    if (block.type === 'image') summary.imageBlocks += 1
    else if (block.type === 'heading') summary.headings += 1
    else if (block.type === 'list') summary.lists += 1
    else if (block.type === 'paragraph') summary.paragraphs += 1

    summary.textCharacters += countText(block.text)
    block.children?.forEach(visit)
  }

  blocks.forEach(visit)
  return summary
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) throw new Error('사용법: node scripts/probes/kordoc_probe.mjs <document.hwp>')

  const preflightStarted = performance.now()
  const preflight = await inspectHwpContainer(filePath)
  const preflightMs = performance.now() - preflightStarted
  const { parseHwp, VERSION } = await import('kordoc')
  const input = preflight.bytes.buffer.slice(
    preflight.bytes.byteOffset,
    preflight.bytes.byteOffset + preflight.bytes.byteLength
  )

  const parseStarted = performance.now()
  const parsed = await parseHwp(input)
  const parseMs = performance.now() - parseStarted
  if (!parsed.success) {
    outputProbe('HAN_FLOW_HWP_PROBE', probeEnvelope(
      'kordoc',
      VERSION ?? '4.2.7',
      preflight,
      { success: false, errorCode: parsed.error?.code ?? 'PARSE_ERROR' },
      { preflightMs, parseMs, totalMs: performance.now() - preflightStarted }
    ))
    process.exitCode = 1
    return
  }

  outputProbe('HAN_FLOW_HWP_PROBE', probeEnvelope(
    'kordoc',
    VERSION ?? '4.2.7',
    preflight,
    {
      success: true,
      sectionCount: parsed.pageCount ?? parsed.metadata?.pageCount ?? null,
      structure: summarizeBlocks(parsed.blocks ?? []),
      extractedImages: parsed.images?.length ?? 0,
      warningCodes: [...new Set((parsed.warnings ?? []).map((warning) => warning.code))].sort()
    },
    { preflightMs, parseMs, totalMs: performance.now() - preflightStarted }
  ))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    outputProbe('HAN_FLOW_HWP_PROBE', {
      schemaVersion: 1,
      engine: 'kordoc',
      success: false,
      error: safeError(error)
    })
    process.exitCode = 1
  })
}

export { summarizeBlocks }
