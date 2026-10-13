import { resolve } from 'path'
import { fileURLToPath } from 'url'
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'

/*
 * IPC 보낸 쪽 검사. renderer가 보낸 모든 `ipcMain.handle`·`ipcMain.on` 요청은 처리 전에 다음을 확인한다.
 *
 * - `event.senderFrame`이 있고(이미 사라졌거나 navigation으로 바뀐 frame은 null), 최상위 frame(`parent === null`)이며
 *   보낸 webContents의 main frame 자체다. iframe·하위 frame이 보낸 요청은 받지 않는다.
 * - 보낸 webContents가 main이 만든 Han-Flow 창의 것이다(`isTrustedWebContents`).
 * - frame URL이 renderer 원본이다. 패키지·빌드 앱은 `out/renderer/index.html` file URL(query·hash는 무시하고 경로만
 *   비교한다. 초기 문서 경로를 query로 넘긴다), 개발 빌드에서 `ELECTRON_RENDERER_URL`을 쓸 때는 그 dev server origin.
 *
 * 통과하지 못한 handle 요청은 오류를 던지고, on 메시지는 무시한다. 같은 channel·이유는 한 번만 경고를 남긴다.
 * 등록은 {@link createGuardedIpc}로만 한다(`tests/main/ipc_guard.test.ts`가 src/main에서 직접 등록하는 곳이 없는지 확인한다).
 */

export interface RendererOrigin {
  /** 패키지·빌드 renderer 진입 HTML의 절대 경로 */
  rendererFile: string
  /** 개발 빌드 dev server URL(`ELECTRON_RENDERER_URL`). 있으면 이 origin만 신뢰한다. */
  devServerUrl?: string
  /** 경로 대소문자 구분 여부 판단용. 기본값은 현재 process.platform. */
  platform?: NodeJS.Platform
}

export interface IpcSenderPolicy {
  isTrustedWebContents(webContents: WebContents): boolean
  isTrustedUrl(url: string): boolean
}

export type IpcSenderRejection =
  | 'no-sender-frame'
  | 'not-main-frame'
  | 'untrusted-window'
  | 'untrusted-url'

export const UNTRUSTED_IPC_SENDER_MESSAGE = '신뢰할 수 없는 화면에서 보낸 요청입니다.'

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** renderer 원본 URL인지 확인하는 함수를 만든다. */
export function rendererUrlMatcher(origin: RendererOrigin): (url: string) => boolean {
  const platform = origin.platform ?? process.platform
  if (origin.devServerUrl) {
    let devOrigin: string
    try {
      devOrigin = new URL(origin.devServerUrl).origin
    } catch {
      return () => false
    }
    return (url) => {
      try {
        const parsed = new URL(url)
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === devOrigin
      } catch {
        return false
      }
    }
  }
  return (url) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'file:' || (parsed.host !== '' && parsed.host !== 'localhost')) return false
      parsed.search = ''
      parsed.hash = ''
      return samePath(fileURLToPath(parsed), origin.rendererFile, platform)
    } catch {
      return false
    }
  }
}

function senderFrameOf(event: IpcMainEvent | IpcMainInvokeEvent): WebFrameMain | null {
  try {
    // frame이 이미 사라졌으면 null이다. 접근 자체가 실패하는 경우도 신뢰하지 않는다.
    return event.senderFrame ?? null
  } catch {
    return null
  }
}

function isMainFrame(frame: WebFrameMain, webContents: WebContents): boolean {
  if (frame.parent !== null) return false
  let mainFrame: WebFrameMain | undefined
  try {
    mainFrame = webContents.mainFrame
  } catch {
    return false
  }
  return frame === mainFrame || (mainFrame !== undefined && frame.frameTreeNodeId === mainFrame.frameTreeNodeId)
}

/** 보낸 쪽이 신뢰하는 창의 최상위 renderer 문서인지. 아니면 거부 이유를 돌려준다. */
export function ipcSenderRejection(
  event: IpcMainEvent | IpcMainInvokeEvent,
  policy: IpcSenderPolicy
): IpcSenderRejection | undefined {
  const frame = senderFrameOf(event)
  if (!frame) return 'no-sender-frame'
  const webContents = event.sender
  if (!webContents || !isMainFrame(frame, webContents)) return 'not-main-frame'
  if (!policy.isTrustedWebContents(webContents)) return 'untrusted-window'
  let url: string
  try {
    url = frame.url
  } catch {
    return 'untrusted-url'
  }
  if (!policy.isTrustedUrl(url)) return 'untrusted-url'
  return undefined
}

export class UntrustedIpcSenderError extends Error {
  readonly code = 'IPC_UNTRUSTED_SENDER'

  constructor(readonly channel: string, readonly reason: IpcSenderRejection) {
    super(UNTRUSTED_IPC_SENDER_MESSAGE)
    this.name = 'UntrustedIpcSenderError'
  }
}

export interface GuardedIpc {
  /** 검사를 통과한 요청만 `listener`로 넘긴다. 통과하지 못하면 UntrustedIpcSenderError로 거절한다. */
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
  ): void
  /** 검사를 통과한 메시지만 `listener`로 넘긴다. 통과하지 못한 메시지는 버린다. */
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void
}

type IpcRegistrar = Pick<IpcMain, 'handle' | 'on'>

export function createGuardedIpc(
  ipc: IpcRegistrar,
  policy: IpcSenderPolicy,
  warn: (message: string) => void = (message) => console.warn(message)
): GuardedIpc {
  const reported = new Set<string>()
  const reject = (channel: string, reason: IpcSenderRejection): void => {
    const key = `${channel}\u0000${reason}`
    if (reported.has(key)) return
    reported.add(key)
    warn(`신뢰할 수 없는 IPC 요청을 거부했습니다: ${channel} (${reason})`)
  }
  return {
    handle(channel, listener) {
      ipc.handle(channel, (event, ...args) => {
        const reason = ipcSenderRejection(event, policy)
        if (reason) {
          reject(channel, reason)
          throw new UntrustedIpcSenderError(channel, reason)
        }
        return listener(event, ...args)
      })
    },
    on(channel, listener) {
      ipc.on(channel, (event, ...args) => {
        const reason = ipcSenderRejection(event, policy)
        if (reason) {
          reject(channel, reason)
          return
        }
        listener(event, ...args)
      })
    }
  }
}
