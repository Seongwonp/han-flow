const { app, BrowserWindow, ipcMain } = require('electron')
const { writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')
const CFB = require('cfb')

const outputPath = process.argv[2]
const RESULT_CHANNEL = 'han-flow:generate-public-hwp'
const HWP_VERSION_5_0_3_2 = 0x05000302

function withPublicHwpVersion(bytes) {
  const container = CFB.read(bytes, { type: 'buffer' })
  const fileHeader = CFB.find(container, 'FileHeader')
  if (!fileHeader?.content || fileHeader.content.length < 40) {
    throw new Error('생성 결과에 유효한 HWP FileHeader가 없습니다.')
  }
  fileHeader.content.writeUInt32LE(HWP_VERSION_5_0_3_2, 32)
  return Buffer.from(CFB.write(container, { type: 'buffer' }))
}

async function run() {
  if (!outputPath) {
    throw new Error(
      '사용법: electron scripts/fixtures/generate_public_hwp_main.cjs <output.hwp>'
    )
  }

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: resolve(__dirname, 'generate_public_hwp_preload.cjs')
    }
  })

  const timeout = setTimeout(() => {
    console.error('공개 HWP fixture 생성 시간이 초과되었습니다.')
    app.exit(1)
  }, 60_000)

  ipcMain.once(RESULT_CHANNEL, async (event, payload) => {
    if (event.sender !== window.webContents) return
    clearTimeout(timeout)
    if (!payload?.success) {
      console.error(payload?.error ?? '공개 HWP fixture 생성에 실패했습니다.')
      app.exit(1)
      return
    }

    const bytes = withPublicHwpVersion(Buffer.from(payload.base64, 'base64'))
    await writeFile(resolve(outputPath), bytes)
    console.log('HAN_FLOW_PUBLIC_HWP_GENERATED', JSON.stringify({
      output: resolve(outputPath),
      sizeBytes: bytes.length,
      hwpVersion: '5.0.3.2',
      ...payload.diagnostics
    }))
    app.exit(0)
  })

  await window.loadFile(resolve(__dirname, 'generate_public_hwp.html'))
}

app.whenReady().then(run).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  app.exit(1)
})
