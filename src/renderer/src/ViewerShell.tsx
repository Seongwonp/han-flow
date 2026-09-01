import type { ReactNode, RefObject, UIEventHandler, WheelEventHandler } from 'react'
import type { RendererEditingSession } from './renderer_state'

interface ViewerStageProps {
  stageRef: RefObject<HTMLElement>
  loading: boolean
  error: string | null
  errorCode: string | null
  hasDocument: boolean
  onChooseFile: () => void
  onWheel: WheelEventHandler<HTMLElement>
  onScroll: UIEventHandler<HTMLElement>
  children?: ReactNode
}

export function ViewerStage({
  stageRef,
  loading,
  error,
  errorCode,
  hasDocument,
  onChooseFile,
  onWheel,
  onScroll,
  children
}: ViewerStageProps) {
  return <section ref={stageRef} className="viewer-stage" onWheel={onWheel} onScroll={onScroll}>
    {loading && <div className="viewer-empty">문서를 해석하는 중…</div>}
    {error && <div className="viewer-empty viewer-error" data-error-code={errorCode ?? undefined}>{error}<button onClick={onChooseFile}>다른 파일 열기</button></div>}
    {!loading && !error && !hasDocument && <div className="viewer-empty"><div className="viewer-drop-icon">한</div><h1>HWP 또는 HWPX를 여기에 놓으세요</h1><p>읽기 전용으로 안전하게 엽니다.</p><button onClick={onChooseFile}>파일 선택</button></div>}
    {children}
  </section>
}

interface ViewerPageStackProps {
  stackRef?: RefObject<HTMLDivElement>
  kind: 'hwp' | 'hwpx'
  totalPages: number
  documentLoading: boolean
  layoutMeasured: boolean
  zoom: number
  virtualized: boolean
  editing?: boolean
  topSpacer: number
  bottomSpacer: number
  children: ReactNode
}

export function ViewerPageStack({
  stackRef,
  kind,
  totalPages,
  documentLoading,
  layoutMeasured,
  zoom,
  virtualized,
  editing,
  topSpacer,
  bottomSpacer,
  children
}: ViewerPageStackProps) {
  const className = [
    'viewer-pages',
    kind === 'hwp' && 'viewer-fixed-pages',
    editing && 'viewer-editing-host',
    virtualized && 'viewer-pages-virtualized'
  ].filter(Boolean).join(' ')

  return <div
    ref={stackRef}
    className={className}
    data-document-format={kind}
    data-total-pages={totalPages}
    data-document-loading={documentLoading}
    data-layout-measured={layoutMeasured}
    style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
  >
    {virtualized && <div className="viewer-page-spacer" style={{ height: topSpacer }} />}
    {children}
    {virtualized && <div className="viewer-page-spacer" style={{ height: bottomSpacer }} />}
  </div>
}

interface ViewerStatusBarProps {
  hasDocument: boolean
  title: string
  pageCount: number
  formatLabel: string
  editing: RendererEditingSession | null
  editingStatusText: string | null
  editingStatusClass: string
  editingSelectionNotice: string | null
  progress?: { loaded: number; total: number } | null
  backgroundError: string | null
  hasEffectiveDocument: boolean
  substitutionCount: number
  overflowPages: number[]
  virtualized: boolean
  openTiming?: string
  openTimingSlow?: boolean
  pdfStatus: string | null
}

export function ViewerStatusBar(props: ViewerStatusBarProps) {
  if (!props.hasDocument) return null
  const {
    title,
    pageCount,
    formatLabel,
    editing,
    editingStatusText,
    editingStatusClass,
    editingSelectionNotice,
    progress,
    backgroundError,
    hasEffectiveDocument,
    substitutionCount,
    overflowPages,
    virtualized,
    openTiming,
    openTimingSlow,
    pdfStatus
  } = props

  return <footer className="viewer-status" title={title}>
    <span>{pageCount}페이지</span>
    <span>{formatLabel}</span>
    {editing && <span title="현재 package mutation revision과 마지막 저장 revision">편집 r{editing.revision} · 저장 r{editing.savedRevision}</span>}
    {editingStatusText && <span className={editingStatusClass}>{editingStatusText}</span>}
    {editingSelectionNotice && <span className="viewer-status-warn">{editingSelectionNotice}</span>}
    {progress && progress.loaded < progress.total && !backgroundError && <span>불러오는 중 {progress.loaded}/{progress.total}</span>}
    {backgroundError && <span className="viewer-status-error">나머지 페이지 오류</span>}
    {hasEffectiveDocument && <span className={substitutionCount ? 'viewer-status-warn' : ''}>글꼴 대체 {substitutionCount}</span>}
    <span className={overflowPages.length ? 'viewer-status-error' : ''}>{virtualized ? '보이는 페이지 넘침' : '페이지 넘침'} {overflowPages.length}{overflowPages.length ? ` (${overflowPages.join(', ')})` : ''}</span>
    {openTiming && <span className={openTimingSlow ? 'viewer-status-error' : ''}>열기 {openTiming}</span>}
    {pdfStatus && <span className={pdfStatus.startsWith('PDF 오류') ? 'viewer-status-error' : ''}>{pdfStatus}</span>}
  </footer>
}
