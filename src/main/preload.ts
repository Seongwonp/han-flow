import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // 필요한 경우 여기에 IPC 통신 함수 추가
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
