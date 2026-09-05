import { contextBridge, ipcRenderer } from 'electron'
import type {
  EditingCharacterStyleRequest,
  EditingCellStyleRequest,
  EditingCommitRequest,
  EditingDeleteTableRowRequest,
  EditingDeleteTableColumnRequest,
  EditingInsertTableColumnRequest,
  EditingMergeParagraphRequest,
  EditingInsertTableRowRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingStartRequest
} from '../core/editing/editing_contract'
import { EditingIpcResult, unwrapEditingIpcResult } from '../core/editing/editing_error'

const invokeEditing = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).then((result: EditingIpcResult<T>) =>
    unwrapEditingIpcResult(result)
  )

// Custom APIs for renderer
const api = {
  getFonts: () => ipcRenderer.invoke('system:getFonts'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
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
    ipcRenderer.on('document:complete', handler)
    return () => ipcRenderer.removeListener('document:complete', handler)
  },
  onDocumentError: (listener: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on('document:error', handler)
    return () => ipcRenderer.removeListener('document:error', handler)
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
  importDocument: (request: { filePath: string; loadId: string }) => ipcRenderer.invoke('document:import', request),
  startEditing: (request: EditingStartRequest) => invokeEditing('editing:start', request),
  commitEditing: (request: EditingCommitRequest) => invokeEditing('editing:commit', request),
  commitRangeEditing: (request: EditingRangeCommitRequest) =>
    invokeEditing('editing:commitRange', request),
  splitParagraphEditing: (request: EditingSplitParagraphRequest) =>
    invokeEditing('editing:splitParagraph', request),
  mergeParagraphEditing: (request: EditingMergeParagraphRequest) =>
    invokeEditing('editing:mergeParagraph', request),
  applyCharacterStyle: (request: EditingCharacterStyleRequest) =>
    invokeEditing('editing:applyCharacterStyle', request),
  applyParagraphStyle: (request: EditingParagraphStyleRequest) =>
    invokeEditing('editing:applyParagraphStyle', request),
  applyCellStyle: (request: EditingCellStyleRequest) =>
    invokeEditing('editing:applyCellStyle', request),
  insertTableRowAfter: (request: EditingInsertTableRowRequest) =>
    invokeEditing('editing:insertTableRowAfter', request),
  deleteTableRow: (request: EditingDeleteTableRowRequest) =>
    invokeEditing('editing:deleteTableRow', request),
  insertTableColumnAfter: (request: EditingInsertTableColumnRequest) =>
    invokeEditing('editing:insertTableColumnAfter', request),
  deleteTableColumn: (request: EditingDeleteTableColumnRequest) =>
    invokeEditing('editing:deleteTableColumn', request),
  undoEditing: (sessionId: string) => invokeEditing('editing:undo', sessionId),
  redoEditing: (sessionId: string) => invokeEditing('editing:redo', sessionId),
  refreshEditing: (sessionId: string) => invokeEditing('editing:refresh', sessionId),
  saveEditingAs: (sessionId: string) => invokeEditing('editing:saveAsDialog', sessionId),
  resolveDirtyEditing: (sessionId: string) => invokeEditing('editing:resolveDirty', sessionId),
  stopEditing: () => invokeEditing('editing:stop'),
  readRhwpWasm: (assetUrl: string) => ipcRenderer.invoke('resource:readRhwpWasm', assetUrl)
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
