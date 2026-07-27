import {
  HwpWorkerClient,
  HwpWorkerError
} from '../../src/renderer/src/hwp_worker_client'
import {
  HwpWorkerRequest,
  HwpWorkerResponse
} from '../../src/renderer/src/hwp_worker_protocol'

class FakeWorker {
  onmessage: ((event: MessageEvent<HwpWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  sent: HwpWorkerRequest[] = []
  terminated = false

  postMessage(message: HwpWorkerRequest): void {
    this.sent.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(response: HwpWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<HwpWorkerResponse>)
  }
}

test('HWP Worker 응답을 같은 요청에만 연결한다', async () => {
  const worker = new FakeWorker()
  const client = new HwpWorkerClient(() => worker)
  client.start()
  const result = client.request<string>('render-page', { index: 0 }, 1_000)
  const [{ id }] = worker.sent
  worker.respond({ id: id + 1, ok: true, result: 'stale' })
  worker.respond({ id, ok: true, result: '<svg />' })
  await expect(result).resolves.toBe('<svg />')
})

test('HWP Worker가 분류한 오류 code와 사용자 메시지를 보존한다', async () => {
  const worker = new FakeWorker()
  const client = new HwpWorkerClient(() => worker)
  client.start()
  const result = client.request('open', {}, 1_000)
  const [{ id }] = worker.sent
  worker.respond({
    id,
    ok: false,
    error: { code: 'HWP_PARSE_FAILED', message: '손상된 HWP 문서입니다.' }
  })
  await expect(result).rejects.toMatchObject<HwpWorkerError>({
    code: 'HWP_PARSE_FAILED',
    message: '손상된 HWP 문서입니다.'
  })
})

test('새 Worker를 시작하면 진행 중인 HWP 작업과 기존 Worker를 취소한다', async () => {
  const first = new FakeWorker()
  const workers = [first, new FakeWorker()]
  const client = new HwpWorkerClient(() => workers.shift()!)
  client.start()
  const pending = client.request('open', {}, 1_000)
  client.start()
  await expect(pending).rejects.toMatchObject<HwpWorkerError>({ code: 'HWP_CANCELLED' })
  expect(first.terminated).toBe(true)
  expect(workers).toHaveLength(0)
})

test('HWP 작업이 제한 시간을 넘으면 Worker를 강제 종료한다', async () => {
  jest.useFakeTimers()
  const worker = new FakeWorker()
  const client = new HwpWorkerClient(() => worker)
  client.start()
  const pending = client.request('open', {}, 250)
  jest.advanceTimersByTime(250)
  await expect(pending).rejects.toMatchObject<HwpWorkerError>({ code: 'HWP_TIMEOUT' })
  expect(worker.terminated).toBe(true)
  jest.useRealTimers()
})
