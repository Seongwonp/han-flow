import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { ParagraphAlignment } from '../../core/editing/style_patch'
import type { RendererEditingSession } from './renderer_state'
import { rendererPlatform, shortcutLabel } from './keyboard_shortcuts'
import {
  initialRibbonTab,
  RIBBON_TABS,
  ribbonTabAfterEditingChange,
  ribbonTabFromKey,
  type RibbonTab
} from './ribbon_tabs'

export interface RibbonStyleState {
  bold: boolean
  italic: boolean
  underline: boolean
  strikeout: boolean
  height: number
  color: string
  fontId?: string
  fontFamily?: string
  align: ParagraphAlignment
  lineSpacing: number
  indent: number
  marginBefore: number
  marginAfter: number
}

export interface RibbonCellStyleState {
  backgroundColor: string
  borderColor: string
  borderWidth: number
}

interface ViewerToolbarProps {
  fileName: string
  /** 처음 선택할 리본 탭. 생략하면 편집 중이면 `서식`, 아니면 `파일`. */
  defaultRibbonTab?: RibbonTab
  /** Electron `process.platform`. 생략하면 macOS 표기(⌘)를 쓴다. */
  shortcutPlatform?: string
  editing: RendererEditingSession | null
  editingPending: number
  documentLoading: boolean
  loading: boolean
  hasDocument: boolean
  printing: boolean
  fixedDocument: boolean
  canStartEditing: boolean
  zoom: number
  searchOpen: boolean
  searchQuery: string
  searching: boolean
  searchPageCount: number
  searchOccurrences: number
  searchInputRef: RefObject<HTMLInputElement>
  activeStyle?: RibbonStyleState
  characterStyleAvailable: boolean
  paragraphStyleAvailable: boolean
  activeCellStyle?: RibbonCellStyleState
  cellStyleAvailable: boolean
  tableCellSelectionAvailable: boolean
  cellStyleTitle?: string
  characterStyleTitle?: string
  paragraphStyleTitle?: string
  documentFonts: Array<{ id: string; family: string }>
  onSearchQueryChange: (query: string) => void
  onSearchStep: (direction: number) => void
  onSearchClose: () => void
  onSearchOpen: () => void
  onStartEditing: () => void
  onZoomStep: (direction: -1 | 1) => void
  onZoomReset: () => void
  onOpenNewWindow: () => void
  onExportPdf: () => void
  onChooseFile: () => void
  onSaveEditing: () => void
  onUndoEditing: () => void
  onRedoEditing: () => void
  onCharacterStyle: (style: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strikeout?: boolean
    height?: number
    color?: string
    fontId?: string
  }) => void
  onParagraphStyle: (style: {
    align?: ParagraphAlignment
    lineSpacing?: number
    indent?: number
    marginBefore?: number
    marginAfter?: number
  }) => void
  onCellStyle: (style: {
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
    borderType?: 'NONE' | 'SOLID'
  }) => void
  onInsertTableRowAfter: () => void
  onDeleteTableRow: () => void
  onInsertTableColumnAfter: () => void
  onDeleteTableColumn: () => void
  onMergeTableCellRight: () => void
  onSplitTableCell: () => void
}

export function ViewerToolbar(props: ViewerToolbarProps) {
  const {
    fileName,
    defaultRibbonTab,
    shortcutPlatform = rendererPlatform(),
    editing,
    editingPending,
    documentLoading,
    loading,
    hasDocument,
    printing,
    fixedDocument,
    canStartEditing,
    zoom,
    searchOpen,
    searchQuery,
    searching,
    searchPageCount,
    searchOccurrences,
    searchInputRef,
    activeStyle,
    characterStyleAvailable: characterStyleState,
    paragraphStyleAvailable: paragraphStyleState,
    activeCellStyle,
    cellStyleAvailable: cellStyleState,
    tableCellSelectionAvailable: tableCellSelectionState,
    cellStyleTitle,
    characterStyleTitle,
    paragraphStyleTitle,
    documentFonts,
    onSearchQueryChange,
    onSearchStep,
    onSearchClose,
    onSearchOpen,
    onStartEditing,
    onZoomStep,
    onZoomReset,
    onOpenNewWindow,
    onExportPdf,
    onChooseFile,
    onSaveEditing,
    onUndoEditing,
    onRedoEditing,
    onCharacterStyle,
    onParagraphStyle,
    onCellStyle,
    onInsertTableRowAfter,
    onDeleteTableRow,
    onInsertTableColumnAfter,
    onDeleteTableColumn,
    onMergeTableCellRight,
    onSplitTableCell
  } = props
  const pending = Boolean(editingPending)
  const isEditing = Boolean(editing)
  // 편집 중이 아니면 서식·표 control은 모두 끈다.
  const characterStyleAvailable = isEditing && characterStyleState
  const paragraphStyleAvailable = isEditing && paragraphStyleState
  const cellStyleAvailable = isEditing && cellStyleState
  const tableCellSelectionAvailable = isEditing && tableCellSelectionState
  // caret이 표 안에 있으면 탭은 그대로 두고 `표` 탭에만 표시한다.
  const tableContextActive = cellStyleAvailable || tableCellSelectionAvailable

  // 선택한 탭은 이 창의 renderer state로만 기억한다. 편집 시작·종료 때만 기본 탭으로 옮긴다.
  const [selectedTab, setSelectedTab] = useState<RibbonTab>(() => defaultRibbonTab ?? initialRibbonTab(isEditing))
  const [previousEditing, setPreviousEditing] = useState(isEditing)
  if (previousEditing !== isEditing) {
    setPreviousEditing(isEditing)
    setSelectedTab((current) => ribbonTabAfterEditingChange(current, previousEditing, isEditing))
  }
  const idPrefix = useId()
  const tabRefs = useRef<Partial<Record<RibbonTab, HTMLButtonElement | null>>>({})
  const tabId = (tab: RibbonTab) => `${idPrefix}-tab-${RIBBON_TABS.indexOf(tab)}`
  const panelId = (tab: RibbonTab) => `${idPrefix}-panel-${RIBBON_TABS.indexOf(tab)}`
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = ribbonTabFromKey(selectedTab, event.key)
    if (!next) return
    event.preventDefault()
    setSelectedTab(next)
    tabRefs.current[next]?.focus()
  }
  // 리본 control을 눌러도 문서 caret·선택이 편집 surface에 남도록 focus 이동을 막는다.
  const keepCaret = (event: { preventDefault(): void }) => event.preventDefault()
  const editingHint = fixedDocument
    ? 'HWP 문서는 읽기 전용입니다.'
    : canStartEditing
      ? '편집 시작을 누르면 사용할 수 있습니다.'
      : 'HWPX 문서를 열고 편집을 시작하면 사용할 수 있습니다.'

  const group = (label: string, children: ReactNode, options: { className?: string; controlsClassName?: string; title?: string } = {}) =>
    <div className={`viewer-ribbon-group${options.className ? ` ${options.className}` : ''}`} title={options.title} role="group" aria-label={label}>
      <div className={`viewer-ribbon-controls${options.controlsClassName ? ` ${options.controlsClassName}` : ''}`}>{children}</div>
      <span className="viewer-ribbon-group-label" aria-hidden="true">{label}</span>
    </div>

  const panels: Record<RibbonTab, ReactNode> = {
    파일: <>
      {group('문서', <>
        <button aria-label="문서 열기" title="문서 열기" className="viewer-ribbon-wide" onClick={onChooseFile}><span className="viewer-ribbon-icon" aria-hidden="true">📂</span><span>열기</span></button>
        <button aria-label="새 창" title="새 창 열기" className="viewer-ribbon-wide" onClick={onOpenNewWindow}><span className="viewer-ribbon-icon" aria-hidden="true">❐</span><span>새 창</span></button>
      </>)}
      {group('저장', <button aria-label="HWPX 변경본 저장" title={`다른 이름으로 저장 (${shortcutLabel('S', shortcutPlatform)})`} className="viewer-ribbon-save" onMouseDown={keepCaret} onClick={onSaveEditing} disabled={!editing?.isDirty || pending}><span className="viewer-ribbon-icon" aria-hidden="true">⇩</span><span>다른 이름으로 저장</span></button>, { className: 'viewer-ribbon-file-group' })}
      {group('내보내기', <button aria-label="PDF로 내보내기" title="PDF로 내보내기" className="viewer-ribbon-wide" onClick={onExportPdf} disabled={!hasDocument || printing || documentLoading}><span className="viewer-ribbon-icon" aria-hidden="true">⎙</span><span>PDF로 내보내기</span></button>)}
    </>,
    편집: <>
      {group('기록', <>
        <button aria-label="실행 취소" title={`실행 취소 (${shortcutLabel('Z', shortcutPlatform)})`} onMouseDown={keepCaret} onClick={onUndoEditing} disabled={!editing?.canUndo || pending}>↶</button>
        <button aria-label="다시 실행" title={`다시 실행 (${shortcutLabel('Z', shortcutPlatform, { shift: true })})`} onMouseDown={keepCaret} onClick={onRedoEditing} disabled={!editing?.canRedo || pending}>↷</button>
      </>)}
      {fixedDocument && group('찾기', <button aria-label="검색" title={`찾기 (${shortcutLabel('F', shortcutPlatform)})`} className="viewer-ribbon-wide" onClick={onSearchOpen} disabled={searchOpen}><span className="viewer-ribbon-icon" aria-hidden="true">⌕</span><span>찾기</span></button>)}
    </>,
    서식: <>
      {group('글자 모양', <>
        <select
          aria-label="문서 글꼴"
          title="문서에 포함된 한글 글꼴"
          value={activeStyle?.fontId ?? ''}
          onChange={(event) => onCharacterStyle({ fontId: event.target.value })}
          disabled={!characterStyleAvailable || !activeStyle || !documentFonts.length || pending}
        >
          {!activeStyle?.fontId && <option value="">글꼴 선택</option>}
          {documentFonts.map((font) => <option key={font.id} value={font.id}>{font.family}</option>)}
        </select>
        <button aria-label="현재 텍스트 블록 굵게" title="굵게" aria-pressed={activeStyle?.bold ?? false} className="viewer-style-bold" onMouseDown={keepCaret} onClick={() => onCharacterStyle({ bold: !(activeStyle?.bold ?? false) })} disabled={!characterStyleAvailable || pending}>B</button>
        <button aria-label="현재 텍스트 블록 기울임" title={`기울임 (${shortcutLabel('I', shortcutPlatform)})`} aria-pressed={activeStyle?.italic ?? false} className="viewer-style-italic" onMouseDown={keepCaret} onClick={() => onCharacterStyle({ italic: !(activeStyle?.italic ?? false) })} disabled={!characterStyleAvailable || pending}>I</button>
        <button aria-label="현재 텍스트 블록 밑줄" title={`밑줄 (${shortcutLabel('U', shortcutPlatform)})`} aria-pressed={activeStyle?.underline ?? false} className="viewer-style-underline" onMouseDown={keepCaret} onClick={() => onCharacterStyle({ underline: !(activeStyle?.underline ?? false) })} disabled={!characterStyleAvailable || pending}>U</button>
        <button aria-label="현재 텍스트 블록 취소선" title="취소선" aria-pressed={activeStyle?.strikeout ?? false} className="viewer-style-strikeout" onMouseDown={keepCaret} onClick={() => onCharacterStyle({ strikeout: !(activeStyle?.strikeout ?? false) })} disabled={!characterStyleAvailable || pending}>S</button>
        <div className="viewer-style-size-control">
          <button aria-label="글자 크기 줄이기" title="글자 크기 줄이기" onMouseDown={keepCaret} onClick={() => activeStyle && onCharacterStyle({ height: Math.max(500, activeStyle.height - 100) })} disabled={!characterStyleAvailable || !activeStyle || activeStyle.height <= 500 || pending}>A−</button>
          <span className="viewer-style-size" aria-label="현재 글자 크기">{activeStyle && characterStyleAvailable ? `${activeStyle.height / 100}pt` : '—'}</span>
          <button aria-label="글자 크기 늘리기" title="글자 크기 늘리기" onMouseDown={keepCaret} onClick={() => activeStyle && onCharacterStyle({ height: Math.min(7200, activeStyle.height + 100) })} disabled={!characterStyleAvailable || !activeStyle || activeStyle.height >= 7200 || pending}>A+</button>
        </div>
        <label className="viewer-style-color-label" title="글자 색상">
          <input className="viewer-style-color" type="color" aria-label="글자 색상" value={activeStyle && /^#[0-9a-f]{6}$/i.test(activeStyle.color) ? activeStyle.color : '#000000'} onChange={(event) => onCharacterStyle({ color: event.target.value })} disabled={!characterStyleAvailable || pending} />
          <span>글자색</span>
        </label>
      </>, { className: 'viewer-ribbon-font-group', title: characterStyleTitle })}
      {group('문단 정렬', ([['LEFT', '왼쪽 정렬', '⇤'], ['CENTER', '가운데 정렬', '↔'], ['RIGHT', '오른쪽 정렬', '⇥'], ['JUSTIFY', '양쪽 정렬', '☰']] as const).map(([align, label, icon]) => <button key={align} aria-label={label} title={label} aria-pressed={paragraphStyleAvailable && activeStyle?.align === align} onMouseDown={keepCaret} onClick={() => onParagraphStyle({ align })} disabled={!paragraphStyleAvailable || pending}>{icon}</button>), { title: paragraphStyleTitle })}
      {group('문단 간격', <>
        <div className="viewer-paragraph-metric"><span>줄 간격</span><button aria-label="줄 간격 줄이기" title="줄 간격 줄이기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ lineSpacing: Math.max(100, activeStyle.lineSpacing - 10) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.lineSpacing <= 100 || pending}>−</button><output aria-label="현재 줄 간격">{activeStyle && paragraphStyleAvailable ? `${activeStyle.lineSpacing}%` : '—'}</output><button aria-label="줄 간격 늘리기" title="줄 간격 늘리기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ lineSpacing: Math.min(300, activeStyle.lineSpacing + 10) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.lineSpacing >= 300 || pending}>＋</button></div>
        <div className="viewer-paragraph-metric"><span>첫 줄</span><button aria-label="첫 줄 내어쓰기" title="첫 줄 내어쓰기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ indent: Math.max(-7200, activeStyle.indent - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.indent <= -7200 || pending}>⇤</button><output aria-label="현재 첫 줄 들여쓰기">{activeStyle && paragraphStyleAvailable ? `${activeStyle.indent / 100}pt` : '—'}</output><button aria-label="첫 줄 들여쓰기" title="첫 줄 들여쓰기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ indent: Math.min(7200, activeStyle.indent + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.indent >= 7200 || pending}>⇥</button></div>
        <div className="viewer-paragraph-metric"><span>문단 앞</span><button aria-label="문단 앞 간격 줄이기" title="문단 앞 간격 줄이기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ marginBefore: Math.max(0, activeStyle.marginBefore - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginBefore <= 0 || pending}>−</button><output aria-label="현재 문단 앞 간격">{activeStyle && paragraphStyleAvailable ? `${activeStyle.marginBefore / 100}pt` : '—'}</output><button aria-label="문단 앞 간격 늘리기" title="문단 앞 간격 늘리기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ marginBefore: Math.min(7200, activeStyle.marginBefore + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginBefore >= 7200 || pending}>＋</button></div>
        <div className="viewer-paragraph-metric"><span>문단 뒤</span><button aria-label="문단 뒤 간격 줄이기" title="문단 뒤 간격 줄이기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ marginAfter: Math.max(0, activeStyle.marginAfter - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginAfter <= 0 || pending}>−</button><output aria-label="현재 문단 뒤 간격">{activeStyle && paragraphStyleAvailable ? `${activeStyle.marginAfter / 100}pt` : '—'}</output><button aria-label="문단 뒤 간격 늘리기" title="문단 뒤 간격 늘리기" onMouseDown={keepCaret} onClick={() => activeStyle && onParagraphStyle({ marginAfter: Math.min(7200, activeStyle.marginAfter + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginAfter >= 7200 || pending}>＋</button></div>
      </>, { className: 'viewer-ribbon-spacing-group', controlsClassName: 'viewer-ribbon-spacing-controls', title: paragraphStyleTitle })}
      {!isEditing && <p className="viewer-ribbon-hint">{editingHint}</p>}
    </>,
    표: <>
      {group('표 셀 모양', <>
        <label className="viewer-style-color-label" title="셀 배경색">
          <input className="viewer-style-color" type="color" aria-label="셀 배경색" value={activeCellStyle?.backgroundColor ?? '#FFFFFF'} onChange={(event) => onCellStyle({ backgroundColor: event.target.value })} disabled={!cellStyleAvailable || pending} />
          <span>배경</span>
        </label>
        <label className="viewer-style-color-label" title="셀 테두리색">
          <input className="viewer-style-color" type="color" aria-label="셀 테두리색" value={activeCellStyle?.borderColor ?? '#000000'} onChange={(event) => onCellStyle({ borderColor: event.target.value, borderType: 'SOLID' })} disabled={!cellStyleAvailable || pending} />
          <span>선색</span>
        </label>
        <select aria-label="셀 테두리 두께" title="셀 테두리 두께" value={activeCellStyle?.borderWidth ?? 0.12} onChange={(event) => onCellStyle({ borderWidth: Number(event.target.value), borderType: 'SOLID' })} disabled={!cellStyleAvailable || pending}>
          {[0.12, 0.2, 0.4, 0.6, 1].map((width) => <option key={width} value={width}>{width}mm</option>)}
        </select>
        <button aria-label="셀 테두리 없음" title="사방 테두리 없음" onMouseDown={keepCaret} onClick={() => onCellStyle({ borderType: 'NONE' })} disabled={!cellStyleAvailable || pending}>선 없음</button>
      </>, { className: 'viewer-ribbon-cell-group', controlsClassName: 'viewer-ribbon-cell-controls', title: cellStyleTitle })}
      {group('표 구조', <>
        <button aria-label="아래에 표 행 추가" title="현재 셀 아래에 빈 행 추가" onMouseDown={keepCaret} onClick={onInsertTableRowAfter} disabled={!cellStyleAvailable || pending}>아래 행＋</button>
        <button aria-label="현재 표 행 삭제" title="현재 셀이 있는 body 행 삭제" onMouseDown={keepCaret} onClick={onDeleteTableRow} disabled={!cellStyleAvailable || pending}>현재 행−</button>
        <button aria-label="오른쪽에 표 열 추가" title="현재 열 오른쪽에 빈 열 추가" onMouseDown={keepCaret} onClick={onInsertTableColumnAfter} disabled={!cellStyleAvailable || pending}>오른쪽 열＋</button>
        <button aria-label="현재 표 열 삭제" title="현재 셀이 있는 열 삭제" onMouseDown={keepCaret} onClick={onDeleteTableColumn} disabled={!cellStyleAvailable || pending}>현재 열−</button>
        <button aria-label="오른쪽 표 셀과 병합" title="현재 셀을 바로 오른쪽 셀과 병합" onMouseDown={keepCaret} onClick={onMergeTableCellRight} disabled={!cellStyleAvailable || pending}>오른쪽 병합</button>
        <button aria-label="선택한 병합 표 셀 분할" title="선택한 1×2 병합 셀을 두 셀로 분할" onMouseDown={keepCaret} onClick={onSplitTableCell} disabled={!tableCellSelectionAvailable || pending}>병합 셀 분할</button>
      </>, { className: 'viewer-ribbon-cell-group', controlsClassName: 'viewer-ribbon-cell-controls', title: cellStyleTitle })}
      {!isEditing
        ? <p className="viewer-ribbon-hint">{editingHint}</p>
        : !tableContextActive && <p className="viewer-ribbon-hint">표 셀 안에 커서를 두면 사용할 수 있습니다.</p>}
    </>,
    보기: <>
      {group('확대/축소', <>
        <button aria-label="축소" title={`축소 (${shortcutLabel('-', shortcutPlatform)})`} onClick={() => onZoomStep(-1)}>−</button>
        <output className="viewer-ribbon-zoom" aria-label="현재 배율">{Math.round(zoom * 100)}%</output>
        <button aria-label="확대" title={`확대 (${shortcutLabel('+', shortcutPlatform)})`} onClick={() => onZoomStep(1)}>+</button>
        <button aria-label="100%로 보기" title={`원래 크기 (${shortcutLabel('0', shortcutPlatform)})`} onClick={onZoomReset} disabled={zoom === 1}>100%</button>
      </>)}
    </>
  }

  return <header className={`viewer-toolbar${editing ? ' viewer-toolbar-editing' : ''}`}>
    <div className="viewer-toolbar-main">
      <div className="viewer-title"><span className="viewer-mark">한</span><span>{fileName}</span></div>
      <div className="viewer-actions">
        {searchOpen && <div className="viewer-search" role="search">
          <input
            ref={searchInputRef}
            aria-label="HWP 문서 검색"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onSearchStep(event.shiftKey ? -1 : 1)
              }
            }}
            placeholder="문서 검색"
          />
          <span
            aria-live="polite"
            data-searching={searching}
            data-search-pages={searchPageCount}
            data-search-occurrences={searchOccurrences}
          >{searching ? '검색 중…' : searchQuery.trim() ? `${searchPageCount}쪽 · ${searchOccurrences}건` : ''}</span>
          <button aria-label="이전 검색 결과" onClick={() => onSearchStep(-1)} disabled={!searchPageCount}>↑</button>
          <button aria-label="다음 검색 결과" onClick={() => onSearchStep(1)} disabled={!searchPageCount}>↓</button>
          <button aria-label="검색 닫기" onClick={onSearchClose}>×</button>
        </div>}
        {canStartEditing && !editing && <button className="viewer-start-editing" aria-label="HWPX 편집 시작" onClick={onStartEditing} disabled={documentLoading || loading}>편집 시작</button>}
        {editing && <span className="viewer-editing-badge">HWPX 편집</span>}
      </div>
    </div>
    <div className="viewer-edit-ribbon" aria-label="리본 메뉴">
      <div className="viewer-ribbon-tabs" role="tablist" aria-label="리본 메뉴">
        {RIBBON_TABS.map((tab) => {
          const selected = tab === selectedTab
          const marked = tab === '표' && tableContextActive && !selected
          return <button
            key={tab}
            ref={(element) => { tabRefs.current[tab] = element }}
            id={tabId(tab)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={panelId(tab)}
            tabIndex={selected ? 0 : -1}
            data-context={tab === '표' && tableContextActive ? 'table' : undefined}
            title={tab === '표' && tableContextActive ? '커서가 표 안에 있습니다' : undefined}
            onMouseDown={keepCaret}
            onClick={() => setSelectedTab(tab)}
            onKeyDown={onTabKeyDown}
          >{tab}{marked && <span className="viewer-ribbon-tab-badge" aria-hidden="true" />}</button>
        })}
      </div>
      {RIBBON_TABS.map((tab) => <div
        key={tab}
        className="viewer-ribbon-panel"
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        hidden={tab !== selectedTab}
      >
        <div className="viewer-ribbon-groups" role="toolbar" aria-label={`${tab} 도구`}>{panels[tab]}</div>
      </div>)}
    </div>
  </header>
}
