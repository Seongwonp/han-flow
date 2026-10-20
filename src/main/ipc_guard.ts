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

/** main이 renderer에 보내고 답을 기다리는 요청의 결과. */
export type RendererRequestOutcome = 'replied' | 'timeout' | 'unavailable'

/** 요청을 받을 renderer(BrowserWindow.webContents와 같은 모양). */
export interface RendererRequestTarget {
  readonly id: number
  isDestroyed(): boolean
  isCrashed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export interface RendererRequest {
  /**
   * `target`에 요청을 보내고 답(`replied`)·시간 초과(`timeout`)·renderer 없음(`unavailable`) 가운데 하나로 끝난다.
   * 거절하지 않는다. renderer가 이미 사라졌거나 비정상 종료했으면 보내지 않고 바로 `unavailable`이다.
   */
  request(target: RendererRequestTarget): Promise<RendererRequestOutcome>
  /** 그 renderer에 보낸 요청을 모두 `unavailable`로 끝낸다(renderer 비정상 종료·창 소멸). */
  cancel(webContentsId: number): void
  /** 답을 기다리는 요청 수 */
  readonly pendingCount: number
}

export interface RendererRequestOptions {
  /** main → renderer 요청 channel. 인자는 요청 id 하나다. */
  requestChannel: string
  /** renderer → main 답 channel. 인자는 받은 요청 id 하나다. 검사를 통과한 보낸 쪽만 받는다. */
  replyChannel: string
  timeoutMs: number
  warn?: (message: string) => void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * main이 renderer에 묻고 답을 기다리는 요청. 답은 {@link GuardedIpc.on}으로 받으므로 신뢰하지 않는 frame의 답은 버리고,
 * 요청을 보낸 바로 그 webContents가 보낸 같은 요청 id의 답만 받는다. 답이 `timeoutMs` 안에 오지 않으면(멈춘 renderer)
 * `timeout`으로 끝내고 경고를 남긴다.
 */
export function createRendererRequest(ipc: GuardedIpc, options: RendererRequestOptions): RendererRequest {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const pending = new Map<string, {
    webContentsId: number
    timer: unknown
    finish: (outcome: RendererRequestOutcome) => void
  }>()
  let sequence = 0

  const settle = (requestId: string, outcome: RendererRequestOutcome): void => {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    clearTimer(entry.timer)
    entry.finish(outcome)
  }

  ipc.on(options.replyChannel, (event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    const entry = pending.get(requestId)
    if (!entry || event.sender?.id !== entry.webContentsId) return
    settle(requestId, 'replied')
  })

  return {
    request(target) {
      let unavailable = false
      try {
        unavailable = target.isDestroyed() || target.isCrashed()
      } catch {
        unavailable = true
      }
      if (unavailable) return Promise.resolve('unavailable')
      const requestId = `${options.requestChannel}:${target.id}:${++sequence}`
      return new Promise<RendererRequestOutcome>((resolvePromise) => {
        const timer = setTimer(() => {
          warn(`renderer가 ${options.timeoutMs}ms 안에 답하지 않았습니다: ${options.requestChannel}`)
          settle(requestId, 'timeout')
        }, options.timeoutMs)
        pending.set(requestId, { webContentsId: target.id, timer, finish: resolvePromise })
        try {
          target.send(options.requestChannel, requestId)
        } catch {
          settle(requestId, 'unavailable')
        }
      })
    },
    cancel(webContentsId) {
      for (const [requestId, entry] of Array.from(pending)) {
        if (entry.webContentsId === webContentsId) settle(requestId, 'unavailable')
      }
    },
    get pendingCount() {
      return pending.size
    }
  }
}
