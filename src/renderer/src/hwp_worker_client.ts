import {
  HwpWorkerOperation,
  HwpWorkerRequest,
  HwpWorkerResponse
} from './hwp_worker_protocol'

export type HwpWorkerErrorCode =
  | 'HWP_CANCELLED'
  | 'HWP_TIMEOUT'
  | 'HWP_WORKER_CRASHED'
  | 'HWP_WORKER_FAILED'

export class HwpWorkerError extends Error {
  constructor(
    public readonly code: HwpWorkerErrorCode | string,
    message: string
  ) {
    super(message)
    this.name = 'HwpWorkerError'
  }
}

interface WorkerLike {
  onmessage: ((event: MessageEvent<HwpWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: HwpWorkerRequest, transfer?: Transferable[]): void
  terminate(): void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: HwpWorkerError) => void
  timeout: ReturnType<typeof setTimeout>
}

export type HwpWorkerFactory = () => WorkerLike

export class HwpWorkerClient {
  private worker: WorkerLike | null = null
  private sequence = 0
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly createWorker: HwpWorkerFactory) {}

  start(): void {
    this.stop(new HwpWorkerError('HWP_CANCELLED', '새 문서를 열어 이전 HWP 작업을 취소했습니다.'))
    const worker = this.createWorker()
    worker.onmessage = (event) => this.receive(event.data)
    worker.onerror = (event) => {
      this.stop(new HwpWorkerError(
        'HWP_WORKER_CRASHED',
        event.message || 'HWP 처리 Worker가 비정상 종료되었습니다.'
      ))
    }
    this.worker = worker
  }

  request<T>(
    operation: HwpWorkerOperation,
    payload: unknown,
    timeoutMs: number,
    transfer: Transferable[] = []
  ): Promise<T> {
    const worker = this.worker
    if (!worker) {
      return Promise.reject(new HwpWorkerError(
        'HWP_WORKER_FAILED',
        'HWP 처리 Worker가 준비되지 않았습니다.'
      ))
    }
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop(new HwpWorkerError(
          'HWP_TIMEOUT',
          `HWP ${operation} 작업이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`
        ))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      })
      try {
        worker.postMessage({ id, operation, payload }, transfer)
      } catch (reason) {
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(new HwpWorkerError(
          'HWP_WORKER_FAILED',
          reason instanceof Error ? reason.message : String(reason)
        ))
      }
    })
  }

  stop(reason = new HwpWorkerError('HWP_CANCELLED', 'HWP 작업을 취소했습니다.')): void {
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(reason)
    }
    this.pending.clear()
  }

  private receive(response: HwpWorkerResponse): void {
    if (!response || typeof response.id !== 'number') return
    const request = this.pending.get(response.id)
    if (!request) return
    clearTimeout(request.timeout)
    this.pending.delete(response.id)
    if (response.ok) request.resolve(response.result)
    else request.reject(new HwpWorkerError(
      response.error?.code || 'HWP_WORKER_FAILED',
      response.error?.message || 'HWP Worker 작업에 실패했습니다.'
    ))
  }
}
