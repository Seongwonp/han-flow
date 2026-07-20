import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  getFonts: () => ipcRenderer.invoke('system:getFonts'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: () => ipcRenderer.invoke('dialog:saveFile'),
  confirmSave: () => ipcRenderer.invoke('dialog:confirmSave'),
  askOpenMode: () => ipcRenderer.invoke('dialog:askOpenMode'),
  openNewWindow: () => ipcRenderer.invoke('window:openNew'),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  onOpenFile: (listener: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => listener(filePath)
    ipcRenderer.on('file:open', handler)
    return () => ipcRenderer.removeListener('file:open', handler)
  },
  parseHWPX: (filePath: string) => ipcRenderer.invoke('hwpx:parse', filePath),
  saveHWPX: (filePath: string, doc: any) => ipcRenderer.invoke('hwpx:save', { filePath, doc })
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
