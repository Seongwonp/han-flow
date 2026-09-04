import type { RefObject } from 'react'
import type { ParagraphAlignment } from '../../core/editing/style_patch'
import type { RendererEditingSession } from './renderer_state'

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
}

export function ViewerToolbar(props: ViewerToolbarProps) {
  const {
    fileName,
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
    characterStyleAvailable,
    paragraphStyleAvailable,
    activeCellStyle,
    cellStyleAvailable,
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
    onExportPdf,
    onChooseFile,
    onSaveEditing,
    onUndoEditing,
    onRedoEditing,
    onCharacterStyle,
    onParagraphStyle,
    onCellStyle,
    onInsertTableRowAfter
  } = props
  const pending = Boolean(editingPending)

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
        {fixedDocument && !searchOpen && <button aria-label="검색" onClick={onSearchOpen}>⌕</button>}
        {canStartEditing && !editing && <button onClick={onStartEditing} disabled={documentLoading || loading}>편집</button>}
        {editing && <span className="viewer-editing-badge">HWPX 편집</span>}
        <button aria-label="축소" onClick={() => onZoomStep(-1)}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button aria-label="확대" onClick={() => onZoomStep(1)}>+</button>
        <button onClick={onExportPdf} disabled={!hasDocument || printing || documentLoading}>PDF</button>
        <button className="viewer-open" onClick={onChooseFile}>문서 열기</button>
      </div>
    </div>
    {editing && <div className="viewer-edit-ribbon" aria-label="HWPX 편집 리본">
      <div className="viewer-ribbon-tabs" role="tablist" aria-label="편집 메뉴">
        <button role="tab" aria-selected="true">홈</button>
      </div>
      <div className="viewer-ribbon-groups" role="toolbar" aria-label="홈 편집 도구">
        <div className="viewer-ribbon-group viewer-ribbon-file-group">
          <div className="viewer-ribbon-controls">
            <button aria-label="HWPX 변경본 저장" className="viewer-ribbon-save" onClick={onSaveEditing} disabled={!editing.isDirty || pending}><span className="viewer-ribbon-icon">⇩</span><span>다른 이름으로 저장</span></button>
          </div>
          <span className="viewer-ribbon-group-label">파일</span>
        </div>
        <div className="viewer-ribbon-group">
          <div className="viewer-ribbon-controls">
            <button aria-label="실행 취소" title="실행 취소 (⌘Z)" onMouseDown={(event) => event.preventDefault()} onClick={onUndoEditing} disabled={!editing.canUndo || pending}>↶</button>
            <button aria-label="다시 실행" title="다시 실행 (⇧⌘Z)" onMouseDown={(event) => event.preventDefault()} onClick={onRedoEditing} disabled={!editing.canRedo || pending}>↷</button>
          </div>
          <span className="viewer-ribbon-group-label">기록</span>
        </div>
        <div className="viewer-ribbon-group viewer-ribbon-font-group" title={characterStyleTitle}>
          <div className="viewer-ribbon-controls">
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
            <button aria-label="현재 텍스트 블록 굵게" title="굵게" aria-pressed={activeStyle?.bold ?? false} className="viewer-style-bold" onMouseDown={(event) => event.preventDefault()} onClick={() => onCharacterStyle({ bold: !(activeStyle?.bold ?? false) })} disabled={!characterStyleAvailable || pending}>B</button>
            <button aria-label="현재 텍스트 블록 기울임" title="기울임 (⌘I)" aria-pressed={activeStyle?.italic ?? false} className="viewer-style-italic" onMouseDown={(event) => event.preventDefault()} onClick={() => onCharacterStyle({ italic: !(activeStyle?.italic ?? false) })} disabled={!characterStyleAvailable || pending}>I</button>
            <button aria-label="현재 텍스트 블록 밑줄" title="밑줄 (⌘U)" aria-pressed={activeStyle?.underline ?? false} className="viewer-style-underline" onMouseDown={(event) => event.preventDefault()} onClick={() => onCharacterStyle({ underline: !(activeStyle?.underline ?? false) })} disabled={!characterStyleAvailable || pending}>U</button>
            <button aria-label="현재 텍스트 블록 취소선" title="취소선" aria-pressed={activeStyle?.strikeout ?? false} className="viewer-style-strikeout" onMouseDown={(event) => event.preventDefault()} onClick={() => onCharacterStyle({ strikeout: !(activeStyle?.strikeout ?? false) })} disabled={!characterStyleAvailable || pending}>S</button>
            <div className="viewer-style-size-control">
              <button aria-label="글자 크기 줄이기" title="글자 크기 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onCharacterStyle({ height: Math.max(500, activeStyle.height - 100) })} disabled={!characterStyleAvailable || !activeStyle || activeStyle.height <= 500 || pending}>A−</button>
              <span className="viewer-style-size" aria-label="현재 글자 크기">{activeStyle ? `${activeStyle.height / 100}pt` : '—'}</span>
              <button aria-label="글자 크기 늘리기" title="글자 크기 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onCharacterStyle({ height: Math.min(7200, activeStyle.height + 100) })} disabled={!characterStyleAvailable || !activeStyle || activeStyle.height >= 7200 || pending}>A+</button>
            </div>
            <label className="viewer-style-color-label" title="글자 색상">
              <input className="viewer-style-color" type="color" aria-label="글자 색상" value={activeStyle && /^#[0-9a-f]{6}$/i.test(activeStyle.color) ? activeStyle.color : '#000000'} onChange={(event) => onCharacterStyle({ color: event.target.value })} disabled={!characterStyleAvailable || pending} />
              <span>글자색</span>
            </label>
          </div>
          <span className="viewer-ribbon-group-label">글자 모양</span>
        </div>
        <div className="viewer-ribbon-group" title={paragraphStyleTitle}>
          <div className="viewer-ribbon-controls">
            {([['LEFT', '왼쪽 정렬', '⇤'], ['CENTER', '가운데 정렬', '↔'], ['RIGHT', '오른쪽 정렬', '⇥'], ['JUSTIFY', '양쪽 정렬', '☰']] as const).map(([align, label, icon]) => <button key={align} aria-label={label} title={label} aria-pressed={activeStyle?.align === align} onMouseDown={(event) => event.preventDefault()} onClick={() => onParagraphStyle({ align })} disabled={!paragraphStyleAvailable || pending}>{icon}</button>)}
          </div>
          <span className="viewer-ribbon-group-label">문단 정렬</span>
        </div>
        <div className="viewer-ribbon-group viewer-ribbon-spacing-group" title={paragraphStyleTitle}>
          <div className="viewer-ribbon-controls viewer-ribbon-spacing-controls">
            <div className="viewer-paragraph-metric"><span>줄 간격</span><button aria-label="줄 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ lineSpacing: Math.max(100, activeStyle.lineSpacing - 10) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.lineSpacing <= 100 || pending}>−</button><output aria-label="현재 줄 간격">{activeStyle ? `${activeStyle.lineSpacing}%` : '—'}</output><button aria-label="줄 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ lineSpacing: Math.min(300, activeStyle.lineSpacing + 10) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.lineSpacing >= 300 || pending}>＋</button></div>
            <div className="viewer-paragraph-metric"><span>첫 줄</span><button aria-label="첫 줄 내어쓰기" title="첫 줄 내어쓰기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ indent: Math.max(-7200, activeStyle.indent - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.indent <= -7200 || pending}>⇤</button><output aria-label="현재 첫 줄 들여쓰기">{activeStyle ? `${activeStyle.indent / 100}pt` : '—'}</output><button aria-label="첫 줄 들여쓰기" title="첫 줄 들여쓰기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ indent: Math.min(7200, activeStyle.indent + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.indent >= 7200 || pending}>⇥</button></div>
            <div className="viewer-paragraph-metric"><span>문단 앞</span><button aria-label="문단 앞 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ marginBefore: Math.max(0, activeStyle.marginBefore - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginBefore <= 0 || pending}>−</button><output aria-label="현재 문단 앞 간격">{activeStyle ? `${activeStyle.marginBefore / 100}pt` : '—'}</output><button aria-label="문단 앞 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ marginBefore: Math.min(7200, activeStyle.marginBefore + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginBefore >= 7200 || pending}>＋</button></div>
            <div className="viewer-paragraph-metric"><span>문단 뒤</span><button aria-label="문단 뒤 간격 줄이기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ marginAfter: Math.max(0, activeStyle.marginAfter - 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginAfter <= 0 || pending}>−</button><output aria-label="현재 문단 뒤 간격">{activeStyle ? `${activeStyle.marginAfter / 100}pt` : '—'}</output><button aria-label="문단 뒤 간격 늘리기" onMouseDown={(event) => event.preventDefault()} onClick={() => activeStyle && onParagraphStyle({ marginAfter: Math.min(7200, activeStyle.marginAfter + 100) })} disabled={!paragraphStyleAvailable || !activeStyle || activeStyle.marginAfter >= 7200 || pending}>＋</button></div>
          </div>
          <span className="viewer-ribbon-group-label">문단 간격</span>
        </div>
        <div className="viewer-ribbon-group viewer-ribbon-cell-group" title={cellStyleTitle}>
          <div className="viewer-ribbon-controls viewer-ribbon-cell-controls">
            <label className="viewer-style-color-label" title="셀 배경색">
              <input className="viewer-style-color" type="color" aria-label="셀 배경색" value={activeCellStyle?.backgroundColor ?? '#FFFFFF'} onChange={(event) => onCellStyle({ backgroundColor: event.target.value })} disabled={!cellStyleAvailable || pending} />
              <span>배경</span>
            </label>
            <label className="viewer-style-color-label" title="셀 테두리색">
              <input className="viewer-style-color" type="color" aria-label="셀 테두리색" value={activeCellStyle?.borderColor ?? '#000000'} onChange={(event) => onCellStyle({ borderColor: event.target.value, borderType: 'SOLID' })} disabled={!cellStyleAvailable || pending} />
              <span>선색</span>
            </label>
            <select aria-label="셀 테두리 두께" value={activeCellStyle?.borderWidth ?? 0.12} onChange={(event) => onCellStyle({ borderWidth: Number(event.target.value), borderType: 'SOLID' })} disabled={!cellStyleAvailable || pending}>
              {[0.12, 0.2, 0.4, 0.6, 1].map((width) => <option key={width} value={width}>{width}mm</option>)}
            </select>
            <button aria-label="셀 테두리 없음" title="사방 테두리 없음" onMouseDown={(event) => event.preventDefault()} onClick={() => onCellStyle({ borderType: 'NONE' })} disabled={!cellStyleAvailable || pending}>선 없음</button>
            <button aria-label="아래에 표 행 추가" title="현재 셀 아래에 빈 행 추가" onMouseDown={(event) => event.preventDefault()} onClick={onInsertTableRowAfter} disabled={!cellStyleAvailable || pending}>아래 행＋</button>
          </div>
          <span className="viewer-ribbon-group-label">표 셀 모양</span>
        </div>
      </div>
    </div>}
  </header>
}
