import type { FixedPageDocument } from '../../core/document/fixed_page_document'
import type { ViewerDocument, ViewerSection } from '../../core/document/viewer_document'
import type { EditingHistoryStatus } from '../../core/editing/editing_contract'
import { isSyntheticCaretAnchorId } from '../../core/editing/empty_paragraph_anchor'
import type { EditorSelection } from '../../core/editing/transaction'
import type { TableCellSelection } from '../../core/editing/table_cell_selection'
import type { FontResolution } from '../../core/fonts/font_resolver'
import type { LayoutMeasurements } from '../../core/layout/pagination'
import type {
  FixedPageSearchResult,
  RenderedRhwpFixedPage
} from './rhwp_fixed_page_adapter'

export interface ViewerLoadTiming {
  format: 'hwp' | 'hwpx'
  requestStartedAt: number
  openReceivedAt: number
  requestToModelMs: number
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
  wasmInitMs?: number
  pageInfoMs?: number
  firstPaintMs?: number
  openToFirstPaintMs?: number
}

/**
 * 화면 측정값. section마다 그 측정에 쓴 section object와 함께 둔다. 측정에 쓴 style 묶음 표지(`styles`,
 * `MeasurementStylesTracker`)가 같으면 편집 뒤에는 object가 바뀐 section만 다시 재고, 나머지 section의 측정 object는 그대로 써서
 * section별 pagination cache가 맞게 한다. style definition을 바꾼 편집도 그 id를 쓰는 section만 새 object라 표지가 그대로다.
 */
export interface DocumentLayoutMeasurements {
  styles: object
  sections: Array<{ section: ViewerSection; measurements: LayoutMeasurements } | undefined>
}

export interface RendererDocumentState {
  document: ViewerDocument | null
  fixedDocument: FixedPageDocument | null
  fileName: string
  openedPath: string | null
  error: string | null
  errorCode: string | null
  loading: boolean
  fontResolutions: Record<string, FontResolution>
  loadTiming: ViewerLoadTiming | null
  sectionProgress: { loaded: number; total: number } | null
  backgroundError: string | null
}

export interface RendererViewerState {
  zoom: number
  overflowPages: number[]
  printing: boolean
  pdfStatus: string | null
  visibleRange: { start: number; end: number; topSpacer: number; bottomSpacer: number }
  fixedPrintPages: RenderedRhwpFixedPage[] | null
  fixedFirstPageReady: boolean
  fixedFollowingPagesEnabled: boolean
  searchOpen: boolean
  searchQuery: string
  searchResults: FixedPageSearchResult[]
  activeSearchResult: number
  searching: boolean
  layoutMeasurements: DocumentLayoutMeasurements | undefined
}

export type RendererEditingSession = EditingHistoryStatus & { sessionId: string }

export interface RendererEditingState {
  session: RendererEditingSession | null
  selection: EditorSelection | undefined
  tableCellSelection: TableCellSelection | undefined
  pending: number
  status: string | null
  selectionNotice: string | null
}

export const initialDocumentState: RendererDocumentState = {
  document: null,
  fixedDocument: null,
  fileName: '문서를 열어 주세요',
  openedPath: null,
  error: null,
  errorCode: null,
  loading: false,
  fontResolutions: {},
  loadTiming: null,
  sectionProgress: null,
  backgroundError: null
}

export const initialViewerState: RendererViewerState = {
  zoom: 1,
  overflowPages: [],
  printing: false,
  pdfStatus: null,
  visibleRange: { start: 0, end: 12, topSpacer: 0, bottomSpacer: 0 },
  fixedPrintPages: null,
  fixedFirstPageReady: false,
  fixedFollowingPagesEnabled: false,
  searchOpen: false,
  searchQuery: '',
  searchResults: [],
  activeSearchResult: 0,
  searching: false,
  layoutMeasurements: undefined
}

export const initialEditingState: RendererEditingState = {
  session: null,
  selection: undefined,
  tableCellSelection: undefined,
  pending: 0,
  status: null,
  selectionNotice: null
}

export type SliceUpdate<T> = T | ((current: T) => T)

type SetFieldAction<State> = {
  [Key in keyof State]: {
    type: 'set'
    key: Key
    update: SliceUpdate<State[Key]>
  }
}[keyof State]

export type SliceAction<State> = SetFieldAction<State> | { type: 'reset' }

function reduceSlice<State>(
  state: State,
  action: SliceAction<State>,
  initialState: State
): State {
  if (action.type === 'reset') return initialState
  const current = state[action.key]
  const next = typeof action.update === 'function'
    ? (action.update as (value: typeof current) => typeof current)(current)
    : action.update
  return Object.is(current, next) ? state : { ...state, [action.key]: next }
}

export function documentStateReducer(
  state: RendererDocumentState,
  action: SliceAction<RendererDocumentState>
): RendererDocumentState {
  return reduceSlice(state, action, initialDocumentState)
}

export function viewerStateReducer(
  state: RendererViewerState,
  action: SliceAction<RendererViewerState>
): RendererViewerState {
  return reduceSlice(state, action, initialViewerState)
}

export function editingStateReducer(
  state: RendererEditingState,
  action: SliceAction<RendererEditingState>
): RendererEditingState {
  return reduceSlice(state, action, initialEditingState)
}

/**
 * 입력 칸 하나가 아직 편집 코어로 보내지 않은 글자를 내보내는 손잡이. 한글 조합은 compositionend 뒤에도 잠깐(음절 묶음)
 * 입력 칸에 머문다. `flush`는 그 글자를 바로 commit 요청으로 보내고(조합 중이면 조합을 끝낸 글자로), `composing`은 IME가
 * 아직 조합 중인지 알린다.
 */
export interface EditingInputFlusher {
  flush(): void
  composing(): boolean
}

export class EditingImeTransientState {
  private composing = false
  private sequence = 0
  private session: RendererEditingSession | null = null
  private pending = 0
  private readonly flushers = new Set<EditingInputFlusher>()
  private inFlight = 0
  private idleWaiters: Array<() => void> = []
  private commandChain: Promise<void> = Promise.resolve()
  private queuedCommands = 0
  private generation = 0

  /** 입력 칸에 아직 보내지 않은 글자(조합 중이거나 음절 묶음 대기)가 있으면 true. */
  get isComposing(): boolean {
    return this.composing
  }

  /** IME가 지금 조합 중인 입력 칸이 있으면 true(음절 묶음 대기만 남은 경우는 false). */
  get isImeComposing(): boolean {
    for (const flusher of this.flushers) if (flusher.composing()) return true
    return false
  }

  get currentSession(): RendererEditingSession | null {
    return this.session
  }

  get pendingCount(): number {
    return this.pending
  }

  /** 응답을 기다리는 글자 입력 commit 요청 수. */
  get inFlightInputCount(): number {
    return this.inFlight
  }

  /** 보내지 않은 글자나 응답을 기다리는 글자 commit이 있으면 true. 실행 취소·저장 버튼은 이때도 눌러 둘 수 있다. */
  get hasPendingInput(): boolean {
    return this.composing || this.inFlight > 0
  }

  synchronize(session: RendererEditingSession | null, pending: number): void {
    this.session = session
    this.pending = pending
  }

  /**
   * 편집 결과의 history 상태를 React가 다시 그리기 전에 바로 반영한다. 입력 반영을 기다린 command(저장·문서 열기)가
   * 방금 끝난 commit의 dirty 상태를 읽어야 한다.
   */
  noteHistory(status: EditingHistoryStatus): void {
    if (!this.session) return
    this.session = {
      sessionId: this.session.sessionId,
      revision: status.revision,
      savedRevision: status.savedRevision,
      canUndo: status.canUndo,
      canRedo: status.canRedo,
      isDirty: status.isDirty
    }
  }

  setComposing(composing: boolean): void {
    this.composing = composing
  }

  nextTransactionId(prefix: string): string {
    return `${prefix}-${++this.sequence}`
  }

  registerInputFlusher(flusher: EditingInputFlusher): () => void {
    this.flushers.add(flusher)
    return () => {
      this.flushers.delete(flusher)
    }
  }

  /** 글자 입력 commit 요청을 응답까지 센다. {@link settleInput}이 이 요청이 끝나기를 기다린다. */
  trackInput<T>(request: Promise<T>): Promise<T> {
    this.inFlight += 1
    const generation = this.generation
    const done = () => {
      if (generation !== this.generation) return
      this.inFlight = Math.max(0, this.inFlight - 1)
      if (this.inFlight === 0) this.wakeIdleWaiters()
    }
    return request.then(
      (value) => { done(); return value },
      (reason: unknown) => { done(); throw reason }
    )
  }

  /** 차례를 기다리거나 도는 편집 command가 없으면 true. */
  get commandsIdle(): boolean {
    return this.queuedCommands === 0
  }

  /** 모든 입력 칸의 대기 글자를 지금 commit 요청으로 보낸다(응답은 기다리지 않는다). */
  flushInput(): void {
    for (const flusher of Array.from(this.flushers)) flusher.flush()
  }

  /** 모든 입력 칸의 대기 글자를 commit 요청으로 보내고, 응답을 기다리는 글자 commit이 모두 끝날 때까지 기다린다. */
  async settleInput(): Promise<boolean> {
    let waited = false
    this.flushInput()
    while (this.inFlight > 0) {
      waited = true
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve))
    }
    return waited
  }

  /**
   * 편집 command(실행 취소·다시 실행·모양·표·각주·저장 등)를 차례대로 실행한다. 각 command는 먼저 입력 칸의 대기 글자를
   * 보내고 그 commit이 끝난 뒤에 돈다. 그래서 입력 직후 누른 command가 무시되거나 마지막 글자보다 먼저 처리되지 않는다.
   * 편집 상태가 reset되면 아직 돌지 않은 command는 버린다. `task`는 대기 글자를 보냈거나 기다렸으면 true를 받는다.
   */
  runAfterInput(task: (waitedForInput: boolean) => Promise<void> | void): Promise<void> {
    const generation = this.generation
    this.queuedCommands += 1
    const run = this.commandChain.then(async () => {
      if (generation !== this.generation) return
      const hadPending = this.hasPendingInput
      const waited = await this.settleInput()
      if (generation !== this.generation) return
      await task(hadPending || waited)
    }).finally(() => {
      if (generation === this.generation) this.queuedCommands = Math.max(0, this.queuedCommands - 1)
    })
    this.commandChain = run.catch(() => undefined)
    return run
  }

  /**
   * 입력 흐름 안의 편집(Enter 문단 나눔·경계 Backspace 병합·여러 문단 범위 입력)을 보낸다. 앞선 command가 없으면 남은 글자
   * commit을 먼저 보내고 곧바로 보낸다(main 창 queue가 받은 순서대로 처리하므로 기다리지 않아도 글자 commit 뒤에 돈다). 그래서
   * 이어 치는 글자보다 늦게 가지 않는다. 앞선 command가 있거나 `needsSettledInput`이면(빈 문단 첫 입력처럼 commit 결과의
   * caret이 필요하면) {@link runAfterInput}으로 차례를 지킨다.
   */
  runTypingCommand(task: (waitedForInput: boolean) => Promise<void> | void, needsSettledInput = false): Promise<void> {
    if (this.commandsIdle && !(needsSettledInput && this.hasPendingInput)) {
      this.flushInput()
      // 응답까지 글자 입력처럼 센다. 뒤이어 누른 command는 이 편집이 끝난 뒤에 돈다.
      return this.trackInput(Promise.resolve().then(() => task(false)))
    }
    return this.runAfterInput(task)
  }

  private wakeIdleWaiters(): void {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  reset(): void {
    this.composing = false
    this.sequence = 0
    this.session = null
    this.pending = 0
    this.generation += 1
    this.inFlight = 0
    this.queuedCommands = 0
    this.wakeIdleWaiters()
  }
}

/**
 * main의 남은 입력 반영 요청(창 닫기·앱 종료 전, `editing:flushInput`)에 답한다. 입력 칸의 대기 글자(음절 묶음·조합 중 글자)를
 * commit 요청으로 보내고, 그 commit과 앞서 줄 선 편집 command가 모두 끝난 뒤({@link EditingImeTransientState.runAfterInput})
 * `reply`를 부른다. main은 답을 받은 뒤 dirty를 다시 보고 저장 확인을 띄운다. 반영이 실패해도 답한다(main은 그때 상태로 이어 간다).
 */
export async function answerInputFlushRequest(
  transient: Pick<EditingImeTransientState, 'runAfterInput'>,
  reply: () => void,
  log: (reason: unknown) => void = (reason) => console.warn('닫기 전 입력 반영 실패:', reason)
): Promise<void> {
  try {
    await transient.runAfterInput(() => undefined)
  } catch (reason) {
    log(reason)
  } finally {
    reply()
  }
}

/**
 * 입력 반영을 기다린 뒤 보낼 편집 command(문단 나눔·병합, 글자·문단 모양, 각주 등)의 selection.
 *
 * command를 누른 때의 selection(`requested`)을 기본으로 쓴다. 다만 그 selection이 caret이고, 방금 기다린 글자 commit의 결과
 * caret(`latest`)이 같은 입력 칸이거나 `requested`가 빈 문단·표 앞뒤 합성 anchor였으면 결과 caret을 쓴다. 조합 입력 중에는
 * caret 변경을 알리지 않아 `requested`가 입력 전 자리일 수 있고, 합성 anchor는 첫 입력 commit이 새 `hp:t`로 옮기기 때문이다.
 * 범위 selection은 이미 화면 글자(남은 입력 포함) 기준 offset이므로 그대로 둔다. Enter·Backspace처럼 키를 누른 때 화면
 * caret을 읽은 command는 `followSameSurface: false`로 합성 anchor일 때만 결과 caret을 쓴다(그 사이 이어 친 글자의 caret을 따라가지 않는다).
 */
export function selectionAfterInput(
  requested: EditorSelection,
  latest: EditorSelection | undefined,
  waitedForInput: boolean,
  options: { followSameSurface?: boolean } = {}
): EditorSelection {
  if (!waitedForInput || !latest || latest.sectionPath !== requested.sectionPath) return requested
  const collapsed = (selection: EditorSelection) =>
    selection.anchorTextNodeId === selection.focusTextNodeId && selection.anchorOffset === selection.focusOffset
  if (!collapsed(requested) || !collapsed(latest)) return requested
  if (isSyntheticCaretAnchorId(requested.focusTextNodeId)) return latest
  return (options.followSameSurface ?? true) && latest.focusTextNodeId === requested.focusTextNodeId ? latest : requested
}
