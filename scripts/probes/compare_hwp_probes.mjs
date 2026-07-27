import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { outputProbe } from './hwp_probe_common.mjs'

const filePath = process.argv[2]
const hwpxFlag = process.argv.indexOf('--hwpx')
const hwpxPath = hwpxFlag >= 0 ? process.argv[hwpxFlag + 1] : undefined
const pdfFlag = process.argv.indexOf('--pdf')
const pdfPath = pdfFlag >= 0 ? process.argv[pdfFlag + 1] : undefined
if (!filePath) {
  console.error('사용법: npm run probe:hwp -- <document.hwp> [--hwpx <reference.hwpx>] [--pdf <reference.pdf>]')
  process.exit(1)
}

const activeChildren = new Set()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of activeChildren) child.kill('SIGTERM')
    process.exitCode = 130
  })
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let finished = false
    const finish = (code, fallback) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      activeChildren.delete(child)
      const prefixes = ['HAN_FLOW_HWP_PROBE ', 'HAN_FLOW_HWPX_REFERENCE ']
      const line = stdout.split('\n').find((value) => prefixes.some((prefix) => value.startsWith(prefix)))
      let payload
      try {
        const prefix = line ? prefixes.find((value) => line.startsWith(value)) : undefined
        payload = line && prefix ? JSON.parse(line.slice(prefix.length)) : null
      } catch {
        payload = null
      }
      resolvePromise({
        code,
        payload: payload ?? fallback ?? {
          schemaVersion: 1,
          success: false,
          error: { code: 'INVALID_PROBE_OUTPUT', message: '후보가 유효한 진단 JSON을 반환하지 않았습니다.' },
          stderrLength: stderr.trim().length
        }
      })
    }
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(1, {
        schemaVersion: 1,
        success: false,
        error: { code: 'TIMEOUT', message: '후보 probe 실행 시간이 초과되었습니다.' }
      })
    }, 60_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', () => finish(1))
    child.once('exit', (code) => finish(code))
  })
}

const root = resolve(import.meta.dirname, '../..')
const electron = resolve(root, 'node_modules/.bin/electron')
const [kordoc, rhwp, hwpx] = await Promise.all([
  run(process.execPath, [resolve(import.meta.dirname, 'kordoc_probe.mjs'), filePath]),
  run(electron, [resolve(import.meta.dirname, 'rhwp_probe_main.cjs'), filePath, ...(pdfPath ? [pdfPath] : [])]),
  hwpxPath
    ? run(process.execPath, [resolve(import.meta.dirname, 'hwpx_reference_probe.mjs'), hwpxPath])
    : Promise.resolve({ code: 0, payload: null })
])

const results = [kordoc.payload, rhwp.payload, hwpx.payload].filter(Boolean)
const kordocResult = kordoc.payload.result
const kordocAdapter = kordocResult?.adapter?.structure
const rhwpResult = rhwp.payload.result
const rhwpReference = rhwpResult?.referencePdf
const reference = hwpx.payload?.result?.structure
const referenceTotal = reference?.total
outputProbe('HAN_FLOW_HWP_BAKEOFF', {
  schemaVersion: 1,
  completed: results.every((result) => result.result?.success === true),
  observations: {
    kordocSectionCount: kordocResult?.sectionCount ?? null,
    kordocTextCharacters: kordocResult?.structure?.textCharacters ?? null,
    kordocAdapterSections: kordocAdapter?.sections ?? null,
    kordocAdapterParagraphs: kordocAdapter?.paragraphs ?? null,
    kordocAdapterTables: kordocAdapter?.tables ?? null,
    kordocAdapterCells: kordocAdapter?.cells ?? null,
    kordocAdapterImages: kordocAdapter?.images ?? null,
    kordocAdapterResources: kordocAdapter?.resources ?? null,
    kordocAdapterTextCharacters: kordocAdapter?.textCharacters ?? null,
    rhwpPageCount: rhwpResult?.pageCount ?? null,
    rhwpSectionCount: rhwpResult?.sectionCount ?? null,
    rhwpPageSectionIndexes: rhwpResult?.pageInfos?.map((page) => page?.sectionIndex ?? null) ?? null,
    rhwpTextCharacters: rhwpResult?.pageTextCounts?.reduce((sum, count) => sum + count, 0) ?? null,
    rhwpImageElements: rhwpResult?.imageElements ?? null,
    referencePdfPageCount: rhwpReference?.referencePageCount ?? null,
    rhwpReferenceCharacterDelta: rhwpReference?.characterDelta ?? null,
    rhwpReferenceEditDistance: rhwpReference?.editDistance ?? null,
    rhwpReferenceSimilarity: rhwpReference?.similarity ?? null,
    rhwpReferenceCharacterBag: rhwpReference?.characterBag ?? null,
    rhwpReferencePageGroups: rhwpReference?.groups?.map((group) => ({
      reference: group.reference,
      candidate: group.candidate,
      referenceCharacters: group.referenceCharacters,
      candidateCharacters: group.candidateCharacters,
      characterDelta: group.characterDelta,
      characterBag: group.characterBag,
      editDistance: group.edit.distance,
      similarity: group.edit.similarity
    })) ?? null,
    referenceSectionCount: reference?.sectionCount ?? null,
    referenceTables: referenceTotal?.tables ?? null,
    referenceImages: referenceTotal?.images ?? null,
    referenceResources: reference?.resources ?? null,
    referenceTextCharacters: referenceTotal?.textCharacters ?? null,
    kordocTableDelta: referenceTotal ? kordocResult?.structure?.tables - referenceTotal.tables : null,
    kordocImageDelta: referenceTotal ? kordocResult?.structure?.imageBlocks - referenceTotal.images : null,
    kordocTextDelta: referenceTotal ? kordocResult?.structure?.textCharacters - referenceTotal.textCharacters : null,
    kordocAdapterParagraphDelta: referenceTotal ? kordocAdapter?.paragraphs - referenceTotal.paragraphs : null,
    kordocAdapterTableDelta: referenceTotal ? kordocAdapter?.tables - referenceTotal.tables : null,
    kordocAdapterCellDelta: referenceTotal ? kordocAdapter?.cells - referenceTotal.cells : null,
    kordocAdapterImageDelta: referenceTotal ? kordocAdapter?.images - referenceTotal.images : null,
    kordocAdapterResourceDelta: reference ? kordocAdapter?.resources - reference.resources : null,
    kordocAdapterTextDelta: referenceTotal ? kordocAdapter?.textCharacters - referenceTotal.textCharacters : null
  },
  results
})
if (kordoc.code !== 0 || rhwp.code !== 0 || hwpx.code !== 0) process.exitCode = 1
