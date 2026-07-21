import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { Worker } from 'worker_threads'
import { serializeToHWPX } from '../core/parser/serialization'
import AdmZip from 'adm-zip'
import fontList from 'font-list'
import { HwpxPackageReader } from '../core/parser/package_reader'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'
import { shouldLoadProgressively } from '../core/parser/progressive_loading'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const processStartedAt = Date.now()
let mainWindow: BrowserWindow | null = null
let pendingOpen: { filePath: string; receivedAt: number } | null = null
const decodeWorkers = new Map<number, Worker>()
const activeLoadIds = new Map<number, string>()

function stopDecodeWorker(senderId: number): void {
  const worker = decodeWorkers.get(senderId)
  if (worker) void worker.terminate()
  decodeWorkers.delete(senderId)
}

function decodeInWorker(senderId: number, filePath: string, sectionPaths?: string[]): Promise<{ document: Awaited<ReturnType<typeof decodeViewerDocument>>; decodeMs: number }> {
  stopDecodeWorker(senderId)
  const worker = new Worker(join(__dirname, 'decoder_worker.js'))
  decodeWorkers.set(senderId, worker)
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => { if (decodeWorkers.get(senderId) === worker) decodeWorkers.delete(senderId) }
    worker.once('message', (result: { document?: Awaited<ReturnType<typeof decodeViewerDocument>>; decodeMs?: number; error?: string }) => {
      settled = true
      cleanup()
      void worker.terminate()
      if (result.error || !result.document) reject(new Error(result.error ?? 'worker 디코딩 결과가 없습니다.'))
      else resolve({ document: result.document, decodeMs: result.decodeMs ?? 0 })
    })
    worker.once('error', (error) => { settled = true; cleanup(); reject(error) })
    worker.once('exit', (code) => {
      cleanup()
      if (!settled && code !== 0) reject(new Error(`worker가 종료되었습니다: ${code}`))
    })
    worker.postMessage({ filePath, sectionPaths })
  })
}

function isHwpxPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.hwpx')
}

function pathFromArguments(arguments_: string[]): string | undefined {
  return arguments_.find(isHwpxPath)
}

function captureVisualState(window: BrowserWindow): void {
  const capturePath = isDev ? process.env['HAN_FLOW_VISUAL_CAPTURE_PATH'] : undefined
  if (!capturePath) return
  const captureDelayMs = Number(process.env['HAN_FLOW_VISUAL_CAPTURE_DELAY_MS'] ?? 2500)
  setTimeout(async () => {
    const image = await window.webContents.capturePage()
    await writeFile(capturePath, image.toPNG())
    const visualState = await window.webContents.executeJavaScript(`({ images: Array.from(document.images).map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, srcLength: image.src.length })), renderedPages: document.querySelectorAll('.viewer-page').length, status: document.querySelector('.viewer-status')?.textContent, timing: document.querySelector('.viewer-status')?.getAttribute('title') })`)
    console.log('Visual test state:', visualState)
  }, captureDelayMs)
}

function deliverOpenPath(filePath: string, receivedAt = Date.now()): void {
  if (!isHwpxPath(filePath)) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpen = { filePath, receivedAt }
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('file:open', { filePath, receivedAt })
  captureVisualState(mainWindow)
}

function createWindow(initialOpen?: { filePath: string; receivedAt: number }): void {
  const visualCapturePath = isDev ? process.env['HAN_FLOW_VISUAL_CAPTURE_PATH'] : undefined
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: visualCapturePath ? 1500 : 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // macOS 네이티브 스타일 최적화
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (visualCapturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow) captureVisualState(mainWindow)
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const visualTestFile = isDev ? process.env['HAN_FLOW_VISUAL_TEST_FILE'] : undefined
  const pdfTestPath = isDev ? process.env['HAN_FLOW_PDF_EXPORT_PATH'] : undefined
  const openPath = visualTestFile ?? initialOpen?.filePath
  const openReceivedAt = visualTestFile ? processStartedAt : initialOpen?.receivedAt
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (openPath) rendererUrl.searchParams.set('open', openPath)
    if (openReceivedAt) rendererUrl.searchParams.set('openReceivedAt', String(openReceivedAt))
    if (pdfTestPath) rendererUrl.searchParams.set('exportPdf', '1')
    mainWindow.loadURL(rendererUrl.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), openPath ? { query: { open: openPath, openReceivedAt: String(openReceivedAt), exportPdf: pdfTestPath ? '1' : '0' } } : undefined)
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, arguments_) => {
    const filePath = pathFromArguments(arguments_)
    if (filePath) deliverOpenPath(filePath)
    else if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    deliverOpenPath(filePath)
  })
}

app.whenReady().then(() => {
  ipcMain.handle('pdf:export', async (event, pageSize: { width: number; height: number }) => {
    if (![pageSize.width, pageSize.height].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 200)) {
      throw new Error('PDF 용지 크기가 올바르지 않습니다.')
    }
    const testPath = isDev ? process.env['HAN_FLOW_PDF_EXPORT_PATH'] : undefined
    const targetPath = testPath ?? (await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined, {
      title: 'PDF로 내보내기',
      defaultPath: '문서.pdf',
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }]
    })).filePath
    if (!targetPath) return null

    const requestId = `${Date.now()}`
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ipcMain.removeListener('pdf:ready', ready); reject(new Error('PDF 렌더링 준비 시간이 초과되었습니다.')) }, 30_000)
        const ready = (readyEvent: Electron.IpcMainEvent, readyId: string) => {
          if (readyEvent.sender !== event.sender || readyId !== requestId) return
          clearTimeout(timeout)
          ipcMain.removeListener('pdf:ready', ready)
          resolve()
        }
        ipcMain.on('pdf:ready', ready)
        event.sender.send('pdf:prepare', requestId)
      })
      const pdf = await event.sender.printToPDF({
        printBackground: true,
        preferCSSPageSize: false,
        pageSize,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
      await writeFile(targetPath, pdf)
      return targetPath
    } finally {
      if (!event.sender.isDestroyed()) event.sender.send('pdf:finish', requestId)
    }
  })

  // 시스템 폰트 목록 가져오기
  ipcMain.handle('system:getFonts', async () => {
    try {
      return await fontList.getFonts()
    } catch (error) {
      console.error('Font error:', error)
      return ['함초롬바탕', 'Pretendard', '나눔고딕', 'Apple SD Gothic Neo']
    }
  })

  // 파일 열기 대화상자 핸들러
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '문서 열기',
      properties: ['openFile'],
      filters: [
        { name: 'HWPX 문서', extensions: ['hwpx'] }
      ]
    })
    if (canceled) return null
    return filePaths[0]
  })

  // 저장 확인 대화상자
  ipcMain.handle('dialog:confirmSave', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      title: '변경 사항 저장',
      message: '문서의 변경 내용을 저장하시겠습니까?',
      detail: '저장하지 않으면 변경 내용이 유실됩니다.'
    })
    return response // 0: Save, 1: Don't Save, 2: Cancel
  })

  // 새 창에서 열기 대화상자
  ipcMain.handle('dialog:askOpenMode', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['현재 창에서 열기', '새 창에서 열기', '취소'],
      defaultId: 1,
      title: '열기 방식 선택',
      message: '파일을 어떻게 여시겠습니까?'
    })
    return response // 0: Current, 1: New, 2: Cancel
  })

  // 새 창 띄우기
  ipcMain.handle('window:openNew', async () => {
    createWindow()
    return true
  })

  // 파일 저장 대화상자 핸들러
  ipcMain.handle('dialog:saveFile', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '문서 저장',
      defaultPath: '제목_없음.hwpx',
      filters: [
        { name: 'HWPX Files', extensions: ['hwpx'] }
      ]
    })
    if (canceled) return null
    return filePath
  })

  // 이미지 열기 대화상자
  ipcMain.handle('dialog:openImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '이미지 삽입',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }
      ]
    })
    if (canceled) return null
    
    const filePath = filePaths[0]
    const fs = require('fs')
    const buffer = fs.readFileSync(filePath)
    const ext = filePath.split('.').pop()
    return {
      path: filePath,
      data: buffer.toString('base64'),
      ext: ext
    }
  })

  // v1은 HWPX 읽기 전용 파싱만 지원한다.
  ipcMain.handle('hwpx:parse', async (event, { filePath, loadId }: { filePath: string; loadId: string }) => {
    try {
      if (!isHwpxPath(filePath)) throw new Error('HWPX 파일만 열 수 있습니다.')
      const senderId = event.sender.id
      activeLoadIds.set(senderId, loadId)
      stopDecodeWorker(senderId)
      const startedAt = performance.now()
      const reader = await HwpxPackageReader.open(filePath)
      const packageOpenedAt = performance.now()
      const index = await reader.index()
      const packageIndexedAt = performance.now()
      const progressive = shouldLoadProgressively(index)
      const firstResult = progressive
        ? await decodeInWorker(senderId, filePath, [index.sectionPaths[0]])
        : { document: await decodeViewerDocument(reader, index), decodeMs: performance.now() - packageIndexedAt }
      const document = firstResult.document
      const decodedAt = performance.now()
      if (progressive && activeLoadIds.get(senderId) === loadId) {
        setImmediate(async () => {
          try {
            const complete = await decodeInWorker(senderId, filePath)
            if (activeLoadIds.get(senderId) === loadId && !event.sender.isDestroyed()) {
              event.sender.send('hwpx:complete', { loadId, document: complete.document, decodeMs: complete.decodeMs })
            }
          } catch (error) {
            if (activeLoadIds.get(senderId) === loadId && !event.sender.isDestroyed()) {
              event.sender.send('hwpx:error', { loadId, message: error instanceof Error ? error.message : String(error) })
            }
          }
        })
      }
      return {
        loadId,
        document,
        timings: {
          packageOpenMs: packageOpenedAt - startedAt,
          packageIndexMs: packageIndexedAt - packageOpenedAt,
          decodeMs: firstResult.decodeMs,
          mainTotalMs: decodedAt - startedAt
        },
        sectionCount: index.sectionPaths.length,
        complete: !progressive
      }
    } catch (error) {
      console.error('Parsing error:', error)
      throw error
    }
  })

  // 문서 저장 핸들러
  ipcMain.handle('hwpx:save', async (_, { filePath, doc }: { filePath: string, doc: any }) => {
    try {
      const xmlFiles = serializeToHWPX(doc)
      const zip = new AdmZip()

      // HWPX 필수 파일들 추가 (mimetype은 압축 없이 저장하는 것이 정석이나 AdmZip의 기본 방식으로 처리)
      zip.addFile('mimetype', Buffer.from('application/ovf+xml'));
      
      for (const [path, content] of Object.entries(xmlFiles)) {
        zip.addFile(path, Buffer.from(content));
      }

      // 실제 파일 저장
      zip.writeZip(filePath);
      return true
    } catch (error) {
      console.error('Save error:', error)
      throw error
    }
  })

  const commandLinePath = pathFromArguments(process.argv)
  createWindow(pendingOpen ?? (commandLinePath ? { filePath: commandLinePath, receivedAt: processStartedAt } : undefined))
  pendingOpen = null

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
