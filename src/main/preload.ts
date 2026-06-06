import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  parseHWPX: (filePath: string) => ipcRenderer.invoke('hwpx:parse', filePath)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in d.ts)
  window.api = api
}
