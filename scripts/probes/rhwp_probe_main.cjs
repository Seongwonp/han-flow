const { app, BrowserWindow, ipcMain } = require('electron')
const { resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const filePath = process.argv[2]
const RESULT_CHANNEL = 'han-flow:hwp-probe-result'

async function run() {
  if (!filePath) throw new Error('사용법: electron scripts/probes/rhwp_probe_main.cjs <document.hwp>')
  const common = await import(pathToFileURL(resolve(__dirname, 'hwp_probe_common.mjs')).href)
  const preflight = await common.inspectHwpContainer(filePath)

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: resolve(__dirname, 'rhwp_probe_preload.cjs'),
      additionalArguments: [`--han-flow-probe-file=${resolve(filePath)}`]
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

  ipcMain.once(RESULT_CHANNEL, (event, payload) => {
    if (event.sender !== window.webContents) return
    clearTimeout(timeout)
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
