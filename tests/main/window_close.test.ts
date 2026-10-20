import {
  createRendererRequest,
  type GuardedIpc,
  type RendererRequestTarget
} from '../../src/main/ipc_guard'
import {
  EDITING_FLUSH_INPUT_CHANNEL,
  EDITING_INPUT_FLUSHED_CHANNEL,
  RENDERER_INPUT_FLUSH_TIMEOUT_MS,
  resolveWindowClose,
  type WindowCloseSteps
} from '../../src/main/window_close'

/** 검사를 통과한 메시지만 넘기는 등록기 대신 listener를 모아 두는 가짜. */
function fakeGuardedIpc() {
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>()
  const ipc: GuardedIpc = {
    handle: () => undefined,
    on: (channel, listener) => { listeners.set(channel, listener as never) }
  }
  const reply = (senderId: number, requestId: unknown) =>
    listeners.get(EDITING_INPUT_FLUSHED_CHANNEL)?.({ sender: { id: senderId } }, requestId)
  return { ipc, reply }
}

/** main 편집 session처럼 revision·저장 지점·복구 기록(디스크에 내린 revision)을 가진 가짜. */
class FakeSession {
  revision = 0
  savedRevision = 0
  journalOnDisk = 0
  pendingJournal = 0
  sessionId: string | undefined = 'session-1'
  stopped = false

  get dirty(): boolean {
    return this.revision !== this.savedRevision
  }

  commit(): void {
    this.revision += 1
    this.pendingJournal = this.revision
  }

  async flushJournal(): Promise<void> {
    this.journalOnDisk = this.pendingJournal
  }
}

/**
 * renderer처럼 `editing:flushInput`을 받으면 입력 칸에 남은 글자(있으면)를 commit하고 답하는 가짜 창.
 * `respond`가 false면 답하지 않는다(멈춘 renderer).
 */
class FakeRenderer implements RendererRequestTarget {
  pendingSyllable = false
  respond = true
  crashed = false
  destroyed = false
  readonly received: string[] = []

  constructor(
    readonly id: number,
    private readonly session: FakeSession,
    private readonly reply: (senderId: number, requestId: unknown) => void
  ) {}

  isDestroyed(): boolean { return this.destroyed }
  isCrashed(): boolean { return this.crashed }

  send(channel: string, requestId: unknown): void {
    this.received.push(channel)
    if (channel !== EDITING_FLUSH_INPUT_CHANNEL || !this.respond) return
    setTimeout(() => {
      if (this.pendingSyllable) {
        this.pendingSyllable = false
        this.session.commit()
      }
      this.reply(this.id, requestId)
    }, 5)
  }
}

function setup(options: { dirtyAction?: 'save' | 'discard' | 'cancel'; timeoutMs?: number } = {}) {
  const { ipc, reply } = fakeGuardedIpc()
  const warnings: string[] = []
  const flush = createRendererRequest(ipc, {
    requestChannel: EDITING_FLUSH_INPUT_CHANNEL,
    replyChannel: EDITING_INPUT_FLUSHED_CHANNEL,
    timeoutMs: options.timeoutMs ?? RENDERER_INPUT_FLUSH_TIMEOUT_MS,
    warn: (message) => warnings.push(message)
  })
  const session = new FakeSession()
  const renderer = new FakeRenderer(7, session, reply)
  const prompts: Array<{ revision: number; journalOnDisk: number }> = []
  const log: string[] = []
  const steps: WindowCloseSteps = {
    currentSessionId: () => session.sessionId,
    flushRendererInput: () => flush.request(renderer),
    isDirty: () => session.dirty,
    flushJournal: () => session.flushJournal(),
    resolveDirty: async () => {
      prompts.push({ revision: session.revision, journalOnDisk: session.journalOnDisk })
      const action = options.dirtyAction ?? 'save'
      if (action === 'cancel') return { outcome: 'cancelled' }
      if (action === 'save') session.savedRevision = session.revision
      return { outcome: action === 'save' ? 'saved' : 'discarded' }
    },
    windowDestroyed: () => renderer.destroyed,
    stopSession: async () => { session.stopped = true },
    log: (message) => log.push(message)
  }
  return { flush, session, renderer, prompts, log, warnings, steps, reply }
}

describe('창 닫기 전 남은 입력 반영', () => {
  test('깨끗한 문서에 친 마지막 음절이 renderer에만 있어도 반영한 뒤 저장 확인을 띄운다', async () => {
    const { session, renderer, prompts, steps } = setup()
    renderer.pendingSyllable = true
    // main은 아직 깨끗하다고 본다(예전에는 여기서 확인 없이 닫았다).
    expect(session.dirty).toBe(false)

    await expect(resolveWindowClose(steps)).resolves.toBe('close')

    expect(renderer.received).toEqual([EDITING_FLUSH_INPUT_CHANNEL])
    // 확인을 띄울 때 방금 반영한 commit이 session과 복구 기록(디스크)에 모두 있다.
    expect(prompts).toEqual([{ revision: 1, journalOnDisk: 1 }])
    expect(session.dirty).toBe(false)
    expect(session.stopped).toBe(true)
  })

  test('남은 입력도 없고 깨끗하면 확인 없이 session을 끝내고 닫는다', async () => {
    const { session, prompts, steps } = setup()
    await expect(resolveWindowClose(steps)).resolves.toBe('close')
    expect(prompts).toEqual([])
    expect(session.stopped).toBe(true)
  })

  test('확인에서 취소하면 session을 끝내지 않고 창을 남긴다', async () => {
    const { session, renderer, prompts, steps } = setup({ dirtyAction: 'cancel' })
    renderer.pendingSyllable = true
    await expect(resolveWindowClose(steps)).resolves.toBe('cancelled')
    expect(prompts).toHaveLength(1)
    expect(session.stopped).toBe(false)
    expect(session.dirty).toBe(true)
  })

  test('[저장하지 않음]이면 반영한 글자를 버리고 닫는다', async () => {
    const { session, renderer, prompts, steps } = setup({ dirtyAction: 'discard' })
    renderer.pendingSyllable = true
    await expect(resolveWindowClose(steps)).resolves.toBe('close')
    expect(prompts).toHaveLength(1)
    expect(session.stopped).toBe(true)
  })

  test('renderer가 시간 안에 답하지 않으면 지금 상태로 닫기 확인을 이어 가고 기록을 남긴다', async () => {
    const { session, renderer, prompts, steps, log, warnings, flush } = setup({ timeoutMs: 30 })
    renderer.respond = false
    session.commit()
    const started = Date.now()
    await expect(resolveWindowClose(steps)).resolves.toBe('close')
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    expect(prompts).toEqual([{ revision: 1, journalOnDisk: 1 }])
    expect(log.some((message) => message.includes('답하지 않아'))).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(flush.pendingCount).toBe(0)
  })

  test('renderer가 비정상 종료했으면 요청을 보내지 않고 지금 상태로 이어 간다', async () => {
    const { session, renderer, prompts, steps, log } = setup()
    renderer.crashed = true
    renderer.pendingSyllable = true
    await expect(resolveWindowClose(steps)).resolves.toBe('close')
    expect(renderer.received).toEqual([])
    expect(prompts).toEqual([])
    expect(session.stopped).toBe(true)
    expect(log.some((message) => message.includes('renderer가 없어'))).toBe(true)
  })

  test('답을 기다리는 중 renderer가 사라지면(cancel) 시간 초과를 기다리지 않는다', async () => {
    const { session, renderer, steps, flush } = setup({ timeoutMs: 60_000 })
    renderer.respond = false
    const decision = resolveWindowClose(steps)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(flush.pendingCount).toBe(1)
    flush.cancel(renderer.id)
    await expect(decision).resolves.toBe('close')
    expect(session.stopped).toBe(true)
  })

  test('반영을 기다리는 사이 session이 끝났으면 확인 없이 닫는다', async () => {
    const { session, renderer, prompts, steps } = setup()
    renderer.pendingSyllable = true
    const decision = resolveWindowClose({
      ...steps,
      currentSessionId: () => undefined
    })
    await expect(decision).resolves.toBe('close')
    expect(prompts).toEqual([])
    expect(session.stopped).toBe(true)
  })

  test('확인 중 창이 사라지면 session을 끝내지 않고 gone으로 끝난다', async () => {
    const { session, renderer, steps } = setup({ dirtyAction: 'discard' })
    renderer.pendingSyllable = true
    const decision = await resolveWindowClose({
      ...steps,
      windowDestroyed: () => true
    })
    expect(decision).toBe('gone')
    expect(session.stopped).toBe(false)
  })
})

describe('renderer 요청(createRendererRequest)', () => {
  test('요청을 보낸 바로 그 webContents가 같은 요청 id로 보낸 답만 받는다', async () => {
    const { flush, renderer, reply } = setup({ timeoutMs: 60_000 })
    renderer.respond = false
    let requestId: unknown
    renderer.send = (channel, id) => { renderer.received.push(channel); requestId = id }
    const outcome = flush.request(renderer)
    reply(99, requestId)
    reply(renderer.id, 'editing:flushInput:7:999')
    reply(renderer.id, 42)
    expect(flush.pendingCount).toBe(1)
    reply(renderer.id, requestId)
    await expect(outcome).resolves.toBe('replied')
    expect(flush.pendingCount).toBe(0)
  })

  test('보내기가 실패하거나 webContents가 이미 사라졌으면 unavailable이다', async () => {
    const { flush, renderer } = setup()
    renderer.send = () => { throw new Error('Object has been destroyed') }
    await expect(flush.request(renderer)).resolves.toBe('unavailable')
    renderer.destroyed = true
    await expect(flush.request(renderer)).resolves.toBe('unavailable')
    expect(flush.pendingCount).toBe(0)
  })
})
