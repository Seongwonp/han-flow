import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { parseHWPX } from '../core/parser/parser'
import { parseHWP } from '../core/parser/hwp_parser'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // macOS 네이티브 스타일 최적화
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 파일 열기 대화상자 핸들러
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Hancom Office Files', extensions: ['hwpx', 'hwp'] },
        { name: 'HWPX Files', extensions: ['hwpx'] },
        { name: 'HWP Files', extensions: ['hwp'] }
      ]
    })
    if (canceled) return null
    return filePaths[0]
  })

  // 문서 파싱 핸들러 (HWPX 및 HWP 지원)
  ipcMain.handle('hwpx:parse', async (_, filePath: string) => {
    try {
      if (filePath.toLowerCase().endsWith('.hwpx')) {
        return await parseHWPX(filePath)
      } else if (filePath.toLowerCase().endsWith('.hwp')) {
        return await parseHWP(filePath)
      }
      throw new Error('지원하지 않는 파일 형식입니다.')
    } catch (error) {
      console.error('Parsing error:', error)
      throw error
    }
  })

  createWindow()

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
