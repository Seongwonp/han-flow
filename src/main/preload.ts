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
  onOpenFile: (listener: (payload: { filePath: string; receivedAt: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { filePath: string; receivedAt: number }) => listener(payload)
    ipcRenderer.on('file:open', handler)
    return () => ipcRenderer.removeListener('file:open', handler)
  },
  onDocumentComplete: (listener: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('hwpx:complete', handler)
    return () => ipcRenderer.removeListener('hwpx:complete', handler)
  },
  onDocumentError: (listener: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('hwpx:error', handler)
    return () => ipcRenderer.removeListener('hwpx:error', handler)
  },
  onPreparePdf: (listener: (requestId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => listener(requestId)
    ipcRenderer.on('pdf:prepare', handler)
    return () => ipcRenderer.removeListener('pdf:prepare', handler)
  },
  onFinishPdf: (listener: (requestId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, requestId: string) => listener(requestId)
    ipcRenderer.on('pdf:finish', handler)
    return () => ipcRenderer.removeListener('pdf:finish', handler)
  },
  pdfReady: (requestId: string) => ipcRenderer.send('pdf:ready', requestId),
  exportPdf: (options: { width: number; height: number; preferCssPageSize?: boolean }) => ipcRenderer.invoke('pdf:export', options),
  reportBenchmark: (timing: unknown) => ipcRenderer.invoke('benchmark:complete', timing),
  readHwp: (filePath: string) => ipcRenderer.invoke('hwp:read', filePath),
  readRhwpWasm: (assetUrl: string) => ipcRenderer.invoke('resource:readRhwpWasm', assetUrl),
  parseHWPX: (filePath: string, loadId: string) => ipcRenderer.invoke('hwpx:parse', { filePath, loadId }),
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
