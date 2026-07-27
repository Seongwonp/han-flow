import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]
const appBinary = resolve(process.argv[3] ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const keepArtifacts = process.env.HAN_FLOW_KEEP_VERIFY_OUTPUT === '1'

if (!/\.(?:hwp|hwpx)$/iu.test(fixture ?? '')) {
  console.error('사용법: npm run verify:pdf -- <fixture.hwp|fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

async function run(command, arguments_, options = {}) {
  let standardOutput = ''
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (chunk) => { standardOutput += chunk.toString() })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} 종료 코드 ${code}: ${standardError.trim()}`))
    })
  })
  return { standardOutput, standardError }
}

const directory = await mkdtemp(join(tmpdir(), 'han-flow-pdf-verify-'))
const statePath = join(directory, 'visual-state.json')
const pdfPath = join(directory, 'document.pdf')
try {
  await run(appBinary, [], {
    env: {
      ...process.env,
      HAN_FLOW_E2E: '1',
      HAN_FLOW_VISUAL_TEST_FILE: resolve(fixture),
      HAN_FLOW_VISUAL_STATE_OUTPUT: statePath,
      HAN_FLOW_VISUAL_EXIT: '1',
      HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: process.env.HAN_FLOW_PDF_VERIFY_DELAY_MS ?? '6000',
      HAN_FLOW_PDF_EXPORT_PATH: pdfPath,
      HAN_FLOW_E2E_USER_DATA: join(directory, 'user-data')
    }
  })

  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const pdfBytes = (await stat(pdfPath)).size
  const { standardOutput: info } = await run('pdfinfo', [pdfPath])
  const pdfPages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)
  const pageSize = info.match(/^Page size:\s+(.+)$/m)?.[1]?.trim()
  const pdfVersion = info.match(/^PDF version:\s+(.+)$/m)?.[1]?.trim()
  const pdfTextCounts = []
  const pdfPageSizes = []
  for (let page = 1; page <= pdfPages; page += 1) {
    const { standardOutput: pageInfo } = await run('pdfinfo', ['-f', String(page), '-l', String(page), pdfPath])
    const match = pageInfo.match(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m)
      ?? pageInfo.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m)
    pdfPageSizes.push(match ? { widthPoints: Number(match[1]), heightPoints: Number(match[2]) } : null)
    const { standardOutput } = await run('pdftotext', ['-f', String(page), '-l', String(page), '-layout', pdfPath, '-'])
    pdfTextCounts.push((standardOutput.match(/\S/gu) ?? []).length)
  }

  const landscapePages = (state.pageSizes ?? [])
    .map((size, index) => size.width > size.height ? index + 1 : 0)
    .filter(Boolean)
  const renderPages = [...new Set([1, Math.ceil(pdfPages / 2), pdfPages, ...landscapePages])].filter((page) => page > 0)
  const renderedBytes = []
  for (const page of renderPages) {
    const prefix = join(directory, `page-${page}`)
    await run('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-png', '-r', '96', pdfPath, prefix])
    renderedBytes.push((await stat(`${prefix}.png`)).size)
  }

  const compareAllPages = state.totalPages <= 50 && state.mountedPages === state.totalPages
  const expectedPageSizes = (state.pageSizes ?? []).map(({ width, height }) => ({
    widthPoints: width * 72 / 96,
    heightPoints: height * 72 / 96
  }))
  const compareAllPageSizes = expectedPageSizes.length === pdfPages
  const pageSizeMismatches = compareAllPageSizes ? pdfPageSizes.flatMap((actual, index) => {
    const expected = expectedPageSizes[index]
    if (
      !actual ||
      !expected ||
      Math.abs(actual.widthPoints - expected.widthPoints) > 1.5 ||
      Math.abs(actual.heightPoints - expected.heightPoints) > 1.5
    ) return [index + 1]
    return []
  }) : []
  const screenTextTotal = state.pageTextCounts.reduce((sum, count) => sum + count, 0)
  const pdfTextTotal = pdfTextCounts.reduce((sum, count) => sum + count, 0)
  const hwpTextPreservation = screenTextTotal ? pdfTextTotal / screenTextTotal : 0
  const hwpLowTextPages = state.pageTextCounts.flatMap((screenCount, index) => {
    if (!screenCount || (pdfTextCounts[index] ?? 0) / screenCount >= 0.96) return []
    return [index + 1]
  })
  const failures = [
    state.errorVisible ? '화면에 사용자 오류가 표시됨' : undefined,
    state.documentLoading ? '백그라운드 문서 로딩이 끝나지 않음' : undefined,
    state.overflowPages.length ? `화면 overflow: ${state.overflowPages.join(', ')}` : undefined,
    state.totalPages === pdfPages ? undefined : `화면 ${state.totalPages}페이지 / PDF ${pdfPages}페이지`,
    pageSizeMismatches.length ? `PDF 용지 크기 불일치: ${pageSizeMismatches.join(', ')}페이지` : undefined,
    pdfBytes > 0 ? undefined : 'PDF 파일이 비어 있음',
    renderedBytes.every((bytes) => bytes > 0) ? undefined : 'PDF PNG 재렌더 실패',
    compareAllPages && state.documentFormat === 'hwpx' && JSON.stringify(state.pageTextCounts) !== JSON.stringify(pdfTextCounts)
      ? '화면과 PDF의 페이지별 글자 수가 다름'
      : undefined,
    compareAllPages && state.documentFormat === 'hwp' && hwpTextPreservation < 0.98
      ? `HWP PDF 텍스트 보존율 부족: ${(hwpTextPreservation * 100).toFixed(1)}%`
      : undefined,
    compareAllPages && state.documentFormat === 'hwp' && hwpLowTextPages.length
      ? `HWP PDF 페이지별 텍스트 보존율 부족: ${hwpLowTextPages.join(', ')}페이지`
      : undefined
  ].filter(Boolean)
  const result = {
    fixture: basename(fixture),
    passed: failures.length === 0,
    screenPages: state.totalPages,
    pdfPages,
    pageSize,
    pageSizes: pdfPageSizes,
    expectedPageSizes,
    pdfVersion,
    pdfBytes,
    comparedPageSizes: compareAllPageSizes,
    comparedPageText: compareAllPages,
    textPreservation: state.documentFormat === 'hwp' ? Number(hwpTextPreservation.toFixed(4)) : undefined,
    pageTextCounts: pdfTextCounts,
    renderedPages: renderPages,
    failures,
    artifacts: keepArtifacts ? directory : undefined
  }
  console.log('HAN_FLOW_PDF_VERIFY', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} finally {
  if (!keepArtifacts) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
