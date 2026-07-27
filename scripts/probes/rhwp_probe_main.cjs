const { app, BrowserWindow, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const { mkdir } = require('node:fs/promises')
const { promisify } = require('node:util')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const filePath = process.argv[2]
const pdfPath = process.argv[3]
const visualDirectory = process.env.HAN_FLOW_HWP_PROBE_VISUAL_DIR
const visualPages = process.env.HAN_FLOW_HWP_PROBE_VISUAL_PAGES
const RESULT_CHANNEL = 'han-flow:hwp-probe-result'
const execFileAsync = promisify(execFile)

async function referencePdfPages() {
  if (!pdfPath) return null
  const { stdout } = await execFileAsync(
    'pdftotext',
    ['-enc', 'UTF-8', '-layout', resolve(pdfPath), '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const pages = stdout.split('\f')
  if (pages.at(-1)?.trim() === '') pages.pop()
  return pages
}

async function run() {
  if (!filePath) {
    throw new Error(
      '사용법: electron scripts/probes/rhwp_probe_main.cjs <document.hwp> [reference.pdf]'
    )
  }
  const common = await import(pathToFileURL(resolve(__dirname, 'hwp_probe_common.mjs')).href)
  const textAlignment = await import(pathToFileURL(resolve(__dirname, 'text_alignment.mjs')).href)
  const preflight = await common.inspectHwpContainer(filePath)
  const referencePagesPromise = referencePdfPages()

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: resolve(__dirname, 'rhwp_probe_preload.cjs'),
      additionalArguments: [
        `--han-flow-probe-file=${resolve(filePath)}`,
        ...(visualPages ? [`--han-flow-probe-capture-pages=${visualPages}`] : [])
      ]
    }
  })

  const timeout = setTimeout(() => {
    common.outputProbe('HAN_FLOW_HWP_PROBE', {
      schemaVersion: 1,
      engine: 'rhwp',
      success: false,
      error: { code: 'TIMEOUT', message: 'rhwp probe 실행 시간이 초과되었습니다.' }
    })
    app.exit(1)
  }, 60_000)

  ipcMain.once(RESULT_CHANNEL, async (event, payload) => {
    if (event.sender !== window.webContents) return
    clearTimeout(timeout)
    const candidatePages = payload.privatePageTexts ?? []
    const privateSvgPages = payload.privateSvgPages ?? []
    delete payload.privatePageTexts
    delete payload.privateSvgPages
    try {
      const referencePages = await referencePagesPromise
      if (referencePages) {
        payload.result.referencePdf = textAlignment.alignTextPages(referencePages, candidatePages)
      }
      if (visualDirectory && privateSvgPages.length) {
        const sharp = require('sharp')
        const directory = resolve(visualDirectory)
        await mkdir(directory, { recursive: true })
        for (const visual of privateSvgPages) {
          await sharp(Buffer.from(visual.svg)).png().toFile(resolve(directory, `rhwp-page-${visual.page}.png`))
        }
        payload.result.capturedVisualPages = privateSvgPages.map((visual) => visual.page)
      }
    } catch {
      payload.result.success = false
      payload.result.error = {
        code: 'PDF_REFERENCE_FAILED',
        message: '기준 PDF의 privacy-safe text 정렬에 실패했습니다.'
      }
    }
    common.outputProbe('HAN_FLOW_HWP_PROBE', {
      ...payload,
      input: preflight.input,
      container: preflight.container
    })
    app.exit(payload.result?.success ? 0 : 1)
  })

  await window.loadFile(resolve(__dirname, 'rhwp_probe.html'))
}

app.whenReady().then(run).catch(async (error) => {
  const common = await import(pathToFileURL(resolve(__dirname, 'hwp_probe_common.mjs')).href)
  common.outputProbe('HAN_FLOW_HWP_PROBE', {
    schemaVersion: 1,
    engine: 'rhwp',
    success: false,
    error: common.safeError(error)
  })
  app.exit(1)
})
