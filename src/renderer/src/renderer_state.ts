import type { FixedPageDocument } from '../../core/document/fixed_page_document'
import type { ViewerDocument } from '../../core/document/viewer_document'
import type { EditingHistoryStatus } from '../../core/editing/editing_contract'
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
  layoutMeasurements: LayoutMeasurements | undefined
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

export class EditingImeTransientState {
  private composing = false
  private sequence = 0
  private session: RendererEditingSession | null = null
  private pending = 0

  get isComposing(): boolean {
    return this.composing
  }

  get currentSession(): RendererEditingSession | null {
    return this.session
  }

  get pendingCount(): number {
    return this.pending
  }

  synchronize(session: RendererEditingSession | null, pending: number): void {
    this.session = session
    this.pending = pending
  }

  setComposing(composing: boolean): void {
    this.composing = composing
  }

  nextTransactionId(prefix: string): string {
    return `${prefix}-${++this.sequence}`
  }

  reset(): void {
    this.composing = false
    this.sequence = 0
    this.session = null
    this.pending = 0
  }
}
