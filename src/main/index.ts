import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile } from 'fs/promises'
import { Worker } from 'worker_threads'
import { serializeToHWPX } from '../core/parser/serialization'
import { HwpxPackageReader } from '../core/parser/package_reader'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'
import { shouldLoadProgressively } from '../core/parser/progressive_loading'
import { HwpFileError, readHwpContainer } from './hwp_file'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const isE2E = process.env['HAN_FLOW_E2E'] === '1'
const testValue = (name: string): string | undefined => isDev || isE2E ? process.env[name] : undefined
const processStartedAt = Date.now()
const benchmarkFile = testValue('HAN_FLOW_BENCHMARK_FILE')
const benchmarkOutput = testValue('HAN_FLOW_BENCHMARK_OUTPUT')
const benchmarkRuns = Math.max(1, Number(testValue('HAN_FLOW_BENCHMARK_RUNS') ?? 1))
const benchmarkMeasurements: unknown[] = []
const benchmarkUserData = testValue('HAN_FLOW_BENCHMARK_USER_DATA')
const e2eUserData = testValue('HAN_FLOW_E2E_USER_DATA')
if (benchmarkUserData ?? e2eUserData) app.setPath('userData', (benchmarkUserData ?? e2eUserData)!)
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

function isHwpPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.hwp')
}

function isDocumentPath(filePath: string): boolean {
  return isHwpxPath(filePath) || isHwpPath(filePath)
}

function pathFromArguments(arguments_: string[]): string | undefined {
  return arguments_.find(isDocumentPath)
}

function captureVisualState(window: BrowserWindow): void {
  const capturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const stateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  const searchQuery = testValue('HAN_FLOW_VISUAL_SEARCH_QUERY')
  const exitWhenComplete = testValue('HAN_FLOW_VISUAL_EXIT') === '1'
  if (!capturePath && !stateOutput) return
  const captureDelayMs = Number(process.env['HAN_FLOW_VISUAL_CAPTURE_DELAY_MS'] ?? 2500)
  const readyTimeoutMs = Number(process.env['HAN_FLOW_VISUAL_READY_TIMEOUT_MS'] ?? 30_000)
  const startedAt = Date.now()
  let previousSignature = ''
  let stableSamples = 0
  let searchTriggered = !searchQuery
  let sampledPeakWorkingSetKb = 0
  const sampleMemory = () => {
    const workingSetKb = app.getAppMetrics()
      .reduce((sum, metric) => sum + metric.memory.workingSetSize, 0)
    sampledPeakWorkingSetKb = Math.max(sampledPeakWorkingSetKb, workingSetKb)
  }
  sampleMemory()
  const memoryInterval = setInterval(sampleMemory, 50)
  const captureWhenReady = async () => {
    const readiness = await window.webContents.executeJavaScript(`(() => {
      const pages = document.querySelector('.viewer-pages')
      const errorVisible = Boolean(document.querySelector('.viewer-error'))
      const mountedPages = Array.from(document.querySelectorAll('.viewer-page'))
      const fixedPagesReady = mountedPages.every((page) => !page.classList.contains('viewer-fixed-page') || page.dataset.pageReady === 'true')
      const searchStatus = document.querySelector('[data-searching]')
      return {
        ready: errorVisible || Boolean(pages && pages.dataset.documentLoading === 'false' && pages.dataset.layoutMeasured === 'true' && fixedPagesReady && (!${searchTriggered} || searchStatus?.dataset.searching === 'false')),
        signature: errorVisible ? 'error' : pages ? [pages.dataset.totalPages, mountedPages.length, mountedPages.filter((page) => page.dataset.pageReady === 'true').length, pages.dataset.documentLoading, pages.dataset.layoutMeasured, document.querySelectorAll('.viewer-fixed-page-search-hit').length, searchStatus?.dataset.searching].join(':') : 'empty'
      }
    })()`)
    stableSamples = readiness.ready && readiness.signature === previousSignature ? stableSamples + 1 : readiness.ready ? 1 : 0
    previousSignature = readiness.signature
    if (stableSamples < 3 && Date.now() - startedAt < readyTimeoutMs) {
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!searchTriggered && searchQuery) {
      searchTriggered = true
      stableSamples = 0
      previousSignature = ''
      await window.webContents.executeJavaScript(`(async () => {
        document.querySelector('[aria-label="검색"]')?.click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const input = document.querySelector('[aria-label="HWP 문서 검색"]')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, ${JSON.stringify(searchQuery)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (capturePath) {
      const image = await window.webContents.capturePage()
      await writeFile(capturePath, image.toPNG())
    }
    const visualState = await window.webContents.executeJavaScript(`({
      images: Array.from(document.querySelectorAll('.viewer-page img')).map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, srcLength: image.src.length })),
      totalPages: Number(document.querySelector('.viewer-pages')?.dataset.totalPages || 0),
      documentFormat: document.querySelector('.viewer-pages')?.dataset.documentFormat,
      mountedPages: document.querySelectorAll('.viewer-page').length,
      pageSizes: Array.from(document.querySelectorAll('.viewer-page')).map((page) => ({ width: page.clientWidth, height: page.clientHeight })),
      documentLoading: document.querySelector('.viewer-pages')?.dataset.documentLoading === 'true',
      pageTextCounts: Array.from(document.querySelectorAll('.viewer-page')).map((page) => Number(page.dataset.textCharacters || 0) || (page.innerText.match(/\\S/g) || []).length),
      overflowPages: Array.from(document.querySelectorAll('.viewer-page')).map((page) => page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1 ? Number(page.dataset.pageIndex) + 1 : 0).filter(Boolean),
      errorVisible: Boolean(document.querySelector('.viewer-error')),
      errorCode: document.querySelector('.viewer-error')?.dataset.errorCode || null,
      errorMessageLength: document.querySelector('.viewer-error')?.textContent?.trim().length || 0,
      search: {
        open: Boolean(document.querySelector('.viewer-search')),
        pages: Number(document.querySelector('[data-search-pages]')?.dataset.searchPages || 0),
        occurrences: Number(document.querySelector('[data-search-occurrences]')?.dataset.searchOccurrences || 0),
        highlights: document.querySelectorAll('.viewer-fixed-page-search-hit').length,
        activePages: document.querySelectorAll('.viewer-fixed-page-search-active').length
      },
      selectionCharacters: (() => {
        const run = document.querySelector('.viewer-fixed-page-text-run')
        const selection = window.getSelection()
        if (!run || !selection) return 0
        const range = document.createRange()
        range.selectNodeContents(run)
        selection.removeAllRanges()
        selection.addRange(range)
        const count = Array.from(selection.toString()).length
        selection.removeAllRanges()
        return count
      })(),
      accessibility: {
        documentPages: document.querySelectorAll('.viewer-fixed-page[role="document"][aria-label]').length,
        hiddenImages: document.querySelectorAll('.viewer-fixed-page-image[aria-hidden="true"]').length,
        labeledTextLayers: document.querySelectorAll('.viewer-fixed-page-text-layer[aria-label]').length
      },
      status: document.querySelector('.viewer-status')?.textContent,
      timing: document.querySelector('.viewer-status')?.getAttribute('title')
    })`)
    clearInterval(memoryInterval)
    sampleMemory()
    const processMetrics = app.getAppMetrics()
    visualState.memory = {
      processCount: processMetrics.length,
      currentWorkingSetKb: processMetrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
      sampledPeakWorkingSetKb,
      processPeakSumKb: processMetrics.reduce((sum, metric) => sum + metric.memory.peakWorkingSetSize, 0)
    }
    if (stateOutput) await writeFile(stateOutput, JSON.stringify(visualState, null, 2))
    console.log('Visual test state:', visualState)
    if (exitWhenComplete) app.quit()
  }
  setTimeout(() => void captureWhenReady(), captureDelayMs)
}

function deliverOpenPath(filePath: string, receivedAt = Date.now()): void {
  if (!isDocumentPath(filePath)) return
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
  const visualCapturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const visualStateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: visualCapturePath || visualStateOutput ? 1500 : 800,
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

  if (visualCapturePath || visualStateOutput) {
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
  const visualTestFile = testValue('HAN_FLOW_VISUAL_TEST_FILE')
  const pdfTestPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
  const openPath = benchmarkFile ?? visualTestFile ?? initialOpen?.filePath
  const openReceivedAt = benchmarkFile || visualTestFile ? processStartedAt : initialOpen?.receivedAt
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
  ipcMain.handle('benchmark:complete', async (_event, timing: unknown) => {
    if (!benchmarkFile || !benchmarkOutput) return false
    benchmarkMeasurements.push(timing)
    if (benchmarkMeasurements.length < benchmarkRuns) {
      setTimeout(() => deliverOpenPath(benchmarkFile), 25)
      return true
    }
    await writeFile(benchmarkOutput, JSON.stringify({ measurements: benchmarkMeasurements }, null, 2))
    app.quit()
    return true
  })
  ipcMain.handle('pdf:export', async (event, options: { width: number; height: number; preferCssPageSize?: boolean }) => {
    if (
      !options ||
      typeof options !== 'object' ||
      ![options.width, options.height].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 200) ||
      (options.preferCssPageSize !== undefined && typeof options.preferCssPageSize !== 'boolean')
    ) {
      throw new Error('PDF 용지 크기가 올바르지 않습니다.')
    }
    const testPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
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
      const printOptions: Electron.PrintToPDFOptions = {
        printBackground: true,
        preferCSSPageSize: options.preferCssPageSize === true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      }
      if (!printOptions.preferCSSPageSize) {
        printOptions.pageSize = { width: options.width, height: options.height }
      }
      const pdf = await event.sender.printToPDF(printOptions)
      await writeFile(targetPath, pdf)
      return targetPath
    } finally {
      if (!event.sender.isDestroyed()) event.sender.send('pdf:finish', requestId)
    }
  })

  // 시스템 폰트 목록 가져오기
  ipcMain.handle('system:getFonts', async () => {
    try {
      const { default: fontList } = await import('font-list')
      return await fontList.getFonts()
    } catch (error) {
      console.error('Font error:', error)
      return ['함초롬바탕', 'Pretendard', '나눔고딕', 'Apple SD Gothic Neo']
    }
  })

  ipcMain.handle('hwp:read', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !isHwpPath(filePath)) throw new Error('HWP 파일만 읽을 수 있습니다.')
    try {
      return { ok: true, ...(await readHwpContainer(filePath)) }
    } catch (error) {
      if (error instanceof HwpFileError) {
        return {
          ok: false,
          error: { code: error.code, message: error.message }
        }
      }
      throw error
    }
  })

  ipcMain.handle('resource:readRhwpWasm', async (_event, assetUrl: string) => {
    if (typeof assetUrl !== 'string' || !assetUrl.startsWith('file:')) {
      throw new Error('패키지 내부 WASM 경로만 읽을 수 있습니다.')
    }
    const filePath = resolve(fileURLToPath(assetUrl))
    const rendererRoot = resolve(join(__dirname, '../renderer'))
    const assetRelativePath = relative(rendererRoot, filePath)
    if (
      !assetRelativePath ||
      assetRelativePath.startsWith('..') ||
      isAbsolute(assetRelativePath) ||
      extname(filePath) !== '.wasm' ||
      !basename(filePath).startsWith('rhwp_bg')
    ) {
      throw new Error('허용되지 않은 WASM 경로입니다.')
    }
    return readFile(filePath)
  })

  // 파일 열기 대화상자 핸들러
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '문서 열기',
      properties: ['openFile'],
      filters: [
        { name: '한글 문서', extensions: ['hwp', 'hwpx'] }
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
      const { default: AdmZip } = await import('adm-zip')
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
