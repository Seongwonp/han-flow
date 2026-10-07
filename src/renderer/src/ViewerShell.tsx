import type { ReactNode, RefObject, UIEventHandler, WheelEventHandler } from 'react'
import type { RendererEditingSession } from './renderer_state'
import {
  ObjectPlaceholderCounts,
  objectPlaceholderDetailLines,
  objectPlaceholderNotice,
  totalObjectPlaceholders
} from '../../core/document/object_placeholder'

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

interface ViewerColumnFlowProps {
  gap: number
  columns: ReactNode[][]
}

export function ViewerColumnFlow({ gap, columns }: ViewerColumnFlowProps) {
  return <div
    className="viewer-column-flow"
    data-column-count={columns.length}
    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`, columnGap: gap }}
  >
    {columns.map((column, index) => <div className="viewer-column" data-column-index={index} key={index}>
      {column}
    </div>)}
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
  /** 원본처럼 그리지 못해 자리 표시로 보여 주는 개체 수. 0이면 표시하지 않는다. */
  objectPlaceholderCount?: number
  onShowObjectPlaceholders?: () => void
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
    pdfStatus,
    objectPlaceholderCount,
    onShowObjectPlaceholders
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
    {Boolean(objectPlaceholderCount) && <button
      type="button"
      className="viewer-status-link viewer-status-warn"
      title="화면에 완전히 표시되지 않는 개체 자세히 보기"
      onClick={onShowObjectPlaceholders}
    >표시 못 한 개체 {objectPlaceholderCount}</button>}
  </footer>
}

interface ObjectPlaceholderBannerProps {
  counts: ObjectPlaceholderCounts
  expanded: boolean
  onToggleDetails: () => void
  onDismiss: () => void
}

/** 문서에 자리 표시 개체가 있을 때 본문 위에 띄우는 닫을 수 있는 안내. 인쇄·PDF에는 나오지 않는다. */
export function ObjectPlaceholderBanner({ counts, expanded, onToggleDetails, onDismiss }: ObjectPlaceholderBannerProps) {
  const notice = objectPlaceholderNotice(counts)
  if (!notice || !totalObjectPlaceholders(counts)) return null
  return <>
    <div className="viewer-object-banner" role="status" data-object-placeholder-total={totalObjectPlaceholders(counts)}>
      <span className="viewer-object-banner-text" title={notice}>{notice}</span>
      <button type="button" aria-expanded={expanded} onClick={onToggleDetails}>{expanded ? '접기' : '자세히'}</button>
      <button type="button" aria-label="안내 닫기" title="안내 닫기" onClick={onDismiss}>닫기</button>
    </div>
    {expanded && <ul className="viewer-object-banner-details">
      {objectPlaceholderDetailLines(counts).map((line) => <li key={line}>{line}</li>)}
      <li>원본 개체는 HWPX로 저장할 때 그대로 보존합니다. PDF에는 화면과 같은 자리 표시로 나옵니다.</li>
    </ul>}
  </>
}
