export interface OpenPathRequest {
  filePath: string
  receivedAt: number
}

export type OpenPathDecision =
  | { action: 'deliver'; windowId: number; request: OpenPathRequest }
  | { action: 'create'; request: OpenPathRequest }
  | { action: 'wait' }

/**
 * OS가 넘긴 문서 경로(open-file, second-instance, 명령줄)를 어느 창이 받을지 정한다.
 *
 * - 포커스된 창이 있으면 그 창, 없으면 가장 최근에 만든 창이 받는다.
 * - 창이 하나도 없으면 새 창을 만들어 연다.
 * - app이 아직 준비되지 않았거나 받을 창의 renderer가 아직 load 중이면 보류했다가
 *   준비되는 즉시 다시 전달한다. 보류는 마지막 요청 하나만 유지한다.
 *
 * Electron에 의존하지 않도록 창은 webContents id로만 다룬다.
 */
export class OpenPathRouter {
  /** 삽입 순서가 곧 창 생성 순서다. 값은 renderer load 완료 여부. */
  private readonly windows = new Map<number, boolean>()
  private pending: OpenPathRequest | null = null
  private appReady = false

  setAppReady(): void {
    this.appReady = true
  }

  addWindow(windowId: number): void {
    this.windows.set(windowId, false)
  }

  markReady(windowId: number): void {
    if (this.windows.has(windowId)) this.windows.set(windowId, true)
  }

  removeWindow(windowId: number): void {
    this.windows.delete(windowId)
  }

  get windowCount(): number {
    return this.windows.size
  }

  get pendingRequest(): OpenPathRequest | null {
    return this.pending
  }

  /** 포커스된 창, 없으면 가장 최근에 만든 창. */
  preferredWindowId(focusedWindowId: number | null | undefined): number | undefined {
    if (focusedWindowId !== null && focusedWindowId !== undefined && this.windows.has(focusedWindowId)) {
      return focusedWindowId
    }
    let latest: number | undefined
    for (const windowId of this.windows.keys()) latest = windowId
    return latest
  }

  /** 새 경로 요청의 처리 방식을 정한다. 'wait'이면 요청을 보류해 둔다. */
  route(request: OpenPathRequest, focusedWindowId: number | null | undefined): OpenPathDecision {
    const decision = this.decide(request, focusedWindowId)
    if (decision.action === 'wait') this.pending = request
    else this.pending = null
    return decision
  }

  /** 보류한 요청이 있고 이제 전달·창 생성이 가능하면 그 결정을 돌려주고 보류를 비운다. */
  flush(focusedWindowId: number | null | undefined): OpenPathDecision {
    if (!this.pending) return { action: 'wait' }
    const decision = this.decide(this.pending, focusedWindowId)
    if (decision.action !== 'wait') this.pending = null
    return decision
  }

  /** 첫 창을 만들 때 보류한 요청을 그 창의 초기 문서로 넘긴다. */
  takePending(): OpenPathRequest | null {
    const request = this.pending
    this.pending = null
    return request
  }

  private decide(
    request: OpenPathRequest,
    focusedWindowId: number | null | undefined
  ): OpenPathDecision {
    if (!this.appReady) return { action: 'wait' }
    const windowId = this.preferredWindowId(focusedWindowId)
    if (windowId === undefined) return { action: 'create', request }
    if (!this.windows.get(windowId)) return { action: 'wait' }
    return { action: 'deliver', windowId, request }
  }
}
