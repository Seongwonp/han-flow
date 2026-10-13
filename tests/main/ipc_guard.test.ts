import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  createGuardedIpc,
  ipcSenderRejection,
  rendererUrlMatcher,
  UNTRUSTED_IPC_SENDER_MESSAGE,
  UntrustedIpcSenderError,
  type IpcSenderPolicy
} from '../../src/main/ipc_guard'

const RENDERER_FILE = '/opt/Han-Flow/resources/app.asar/out/renderer/index.html'
const RENDERER_URL = pathToFileURL(RENDERER_FILE).href

interface FakeFrame {
  url: string
  parent: FakeFrame | null
  frameTreeNodeId: number
}

interface FakeWebContents {
  id: number
  mainFrame: FakeFrame
}

function frame(url = RENDERER_URL, parent: FakeFrame | null = null, frameTreeNodeId = 1): FakeFrame {
  return { url, parent, frameTreeNodeId }
}

function webContents(id = 1, mainFrame = frame()): FakeWebContents {
  return { id, mainFrame }
}

/** Electron event와 같은 모양의 가짜 event. senderFrame만 다르게 줄 수 있다. */
function event(sender: FakeWebContents, senderFrame: FakeFrame | null | undefined = sender.mainFrame): never {
  return { sender, senderFrame } as never
}

function policy(trusted: FakeWebContents[], devServerUrl?: string): IpcSenderPolicy {
  return {
    isTrustedWebContents: (candidate) => trusted.includes(candidate as unknown as FakeWebContents),
    isTrustedUrl: rendererUrlMatcher({ rendererFile: RENDERER_FILE, devServerUrl, platform: 'linux' })
  }
}

/** ipcMain.handle·on 대신 등록된 listener를 모아 두는 가짜 등록기. */
function fakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    handlers,
    listeners,
    registrar: {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => handlers.set(channel, listener),
      on: (channel: string, listener: (...args: unknown[]) => void) => listeners.set(channel, listener)
    } as never
  }
}

describe('IPC 보낸 쪽 검사', () => {
  test('우리 창 main frame의 renderer 문서가 보낸 요청만 통과한다(query·hash는 무시)', () => {
    const window = webContents()
    expect(ipcSenderRejection(event(window), policy([window]))).toBeUndefined()
    const withQuery = webContents(2, frame(`${RENDERER_URL}?open=%2Ftmp%2Fa.hwpx&openReceivedAt=1#top`))
    expect(ipcSenderRejection(event(withQuery), policy([withQuery]))).toBeUndefined()
  })

  test('senderFrame이 없거나(사라진 frame) 하위 frame이면 거부한다', () => {
    const window = webContents()
    expect(ipcSenderRejection(event(window, null), policy([window]))).toBe('no-sender-frame')
    expect(ipcSenderRejection({ sender: window } as never, policy([window]))).toBe('no-sender-frame')
    const child = frame(RENDERER_URL, window.mainFrame, 2)
    expect(ipcSenderRejection(event(window, child), policy([window]))).toBe('not-main-frame')
    // 최상위처럼 보여도 그 webContents의 main frame이 아니면 받지 않는다.
    expect(ipcSenderRejection(event(window, frame(RENDERER_URL, null, 9)), policy([window]))).toBe('not-main-frame')
  })

  test('senderFrame 접근이 실패하면 거부한다', () => {
    const window = webContents()
    const throwing = { sender: window, get senderFrame(): never { throw new Error('disposed') } } as never
    expect(ipcSenderRejection(throwing, policy([window]))).toBe('no-sender-frame')
  })

  test('우리가 만든 창이 아닌 webContents는 거부한다', () => {
    const window = webContents()
    const other = webContents(7)
    expect(ipcSenderRejection(event(other), policy([window]))).toBe('untrusted-window')
  })

  test('renderer 원본이 아닌 URL은 거부한다', () => {
    for (const url of [
      'file:///tmp/evil.html',
      pathToFileURL('/opt/Han-Flow/resources/app.asar/out/renderer/other.html').href,
      pathToFileURL('/opt/Han-Flow/resources/app.asar/out/renderer/index.html/../../main/index.js').href,
      'file://remote-host/opt/Han-Flow/resources/app.asar/out/renderer/index.html',
      'https://example.com/',
      'http://localhost:5173/',
      'about:blank',
      'data:text/html,<p>x</p>',
      'not a url'
    ]) {
      const window = webContents(1, frame(url))
      expect([url, ipcSenderRejection(event(window), policy([window]))]).toEqual([url, 'untrusted-url'])
    }
  })

  test('개발 dev server를 쓰면 그 origin만 신뢰하고 file renderer는 받지 않는다', () => {
    const dev = 'http://localhost:5173/'
    const devWindow = webContents(1, frame('http://localhost:5173/?open=x'))
    expect(ipcSenderRejection(event(devWindow), policy([devWindow], dev))).toBeUndefined()
    for (const url of ['http://127.0.0.1:5173/', 'http://localhost:5174/', 'https://localhost:5173/', RENDERER_URL]) {
      const window = webContents(2, frame(url))
      expect(ipcSenderRejection(event(window), policy([window], dev))).toBe('untrusted-url')
    }
    expect(rendererUrlMatcher({ rendererFile: RENDERER_FILE, devServerUrl: 'not a url' })('http://localhost:5173/')).toBe(false)
  })

  test('대소문자를 구분하지 않는 OS에서는 경로 대소문자 차이를 같은 파일로 본다', () => {
    const matcher = rendererUrlMatcher({ rendererFile: RENDERER_FILE, platform: 'darwin' })
    expect(matcher(RENDERER_URL.replace('Han-Flow', 'han-flow'))).toBe(true)
    expect(rendererUrlMatcher({ rendererFile: RENDERER_FILE, platform: 'linux' })(RENDERER_URL.replace('Han-Flow', 'han-flow'))).toBe(false)
  })
})

describe('검사를 거치는 IPC 등록기', () => {
  test('handle은 통과한 요청만 처리하고, 거부한 요청은 오류로 끝내며 channel·이유마다 한 번만 경고한다', async () => {
    const ipc = fakeIpcMain()
    const warnings: string[] = []
    const window = webContents()
    const guarded = createGuardedIpc(ipc.registrar, policy([window]), (message) => warnings.push(message))
    const calls: unknown[][] = []
    guarded.handle('editing:undo', (_event, ...args) => {
      calls.push(args)
      return 'ok'
    })
    const handler = ipc.handlers.get('editing:undo')!
    await expect(Promise.resolve(handler(event(window), 'session-1'))).resolves.toBe('ok')
    expect(calls).toEqual([['session-1']])

    const foreign = webContents(9, frame('https://example.com/'))
    for (let index = 0; index < 3; index += 1) {
      let thrown: unknown
      try {
        handler(event(foreign), 'session-1')
      } catch (reason) {
        thrown = reason
      }
      expect(thrown).toBeInstanceOf(UntrustedIpcSenderError)
      expect(thrown).toMatchObject({ code: 'IPC_UNTRUSTED_SENDER', channel: 'editing:undo', reason: 'untrusted-window' })
      expect((thrown as Error).message).toBe(UNTRUSTED_IPC_SENDER_MESSAGE)
    }
    expect(() => handler(event(window, null))).toThrow(UntrustedIpcSenderError)
    expect(calls).toHaveLength(1)
    expect(warnings).toEqual([
      '신뢰할 수 없는 IPC 요청을 거부했습니다: editing:undo (untrusted-window)',
      '신뢰할 수 없는 IPC 요청을 거부했습니다: editing:undo (no-sender-frame)'
    ])
  })

  test('on은 거부한 메시지를 조용히 버린다', () => {
    const ipc = fakeIpcMain()
    const warnings: string[] = []
    const window = webContents()
    const guarded = createGuardedIpc(ipc.registrar, policy([window]), (message) => warnings.push(message))
    const received: unknown[] = []
    guarded.on('pdf:ready', (_event, requestId) => received.push(requestId))
    const listener = ipc.listeners.get('pdf:ready')!
    listener(event(window), 'a')
    listener(event(window, frame(RENDERER_URL, window.mainFrame, 3)), 'b')
    listener(event(window, frame(RENDERER_URL, window.mainFrame, 3)), 'c')
    expect(received).toEqual(['a'])
    expect(warnings).toEqual(['신뢰할 수 없는 IPC 요청을 거부했습니다: pdf:ready (not-main-frame)'])
  })

  // 새 handler가 검사를 빠뜨리지 않도록 main process 코드는 ipcMain에 직접 등록하지 않는다.
  test('src/main은 ipc_guard 밖에서 ipcMain·webContents.ipc에 직접 handler를 등록하지 않는다', () => {
    const directory = join(__dirname, '../../src/main')
    const offenders: string[] = []
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.ts') || name === 'ipc_guard.ts') continue
      const source = readFileSync(join(directory, name), 'utf8')
      if (/\bipcMain\s*\.\s*(handle|handleOnce|on|once|addListener|prependListener)\s*\(/.test(source)) offenders.push(name)
      if (/\.ipc\s*\.\s*(handle|handleOnce|on|once|addListener)\s*\(/.test(source)) offenders.push(name)
    }
    expect(offenders).toEqual([])
  })
})
