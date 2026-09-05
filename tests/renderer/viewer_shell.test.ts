import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ViewerPageStack,
  ViewerStage,
  ViewerStatusBar
} from '../../src/renderer/src/ViewerShell'
import { ViewerToolbar } from '../../src/renderer/src/ViewerToolbar'

const noop = () => undefined

describe('viewer shell components', () => {
  test('toolbar는 보기 action과 편집 ribbon 상태를 props로만 표시한다', () => {
    const markup = renderToStaticMarkup(createElement(ViewerToolbar, {
      fileName: 'sample.hwpx',
      editing: {
        sessionId: 'session',
        revision: 3,
        savedRevision: 2,
        canUndo: true,
        canRedo: false,
        isDirty: true
      },
      editingPending: 0,
      documentLoading: false,
      loading: false,
      hasDocument: true,
      printing: false,
      fixedDocument: false,
      canStartEditing: true,
      zoom: 1.25,
      searchOpen: false,
      searchQuery: '',
      searching: false,
      searchPageCount: 0,
      searchOccurrences: 0,
      searchInputRef: createRef<HTMLInputElement>(),
      characterStyleAvailable: false,
      paragraphStyleAvailable: false,
      cellStyleAvailable: true,
      activeCellStyle: { backgroundColor: '#EEEEEE', borderColor: '#000000', borderWidth: 0.12 },
      documentFonts: [{ id: '0', family: 'HanFlow Test Sans' }],
      onSearchQueryChange: noop,
      onSearchStep: noop,
      onSearchClose: noop,
      onSearchOpen: noop,
      onStartEditing: noop,
      onZoomStep: noop,
      onExportPdf: noop,
      onChooseFile: noop,
      onSaveEditing: noop,
      onUndoEditing: noop,
      onRedoEditing: noop,
      onCharacterStyle: noop,
      onParagraphStyle: noop,
      onCellStyle: noop,
      onInsertTableRowAfter: noop,
      onDeleteTableRow: noop,
      onInsertTableColumnAfter: noop,
      onDeleteTableColumn: noop,
      onMergeTableCellRight: noop
    }))

    expect(markup).toContain('sample.hwpx')
    expect(markup).toContain('125%')
    expect(markup).toContain('aria-label="HWPX 편집 리본"')
    expect(markup).toContain('aria-label="HWPX 변경본 저장"')
    expect(markup).toContain('aria-label="문서 글꼴"')
    expect(markup).toContain('HanFlow Test Sans')
    expect(markup).toContain('aria-label="다시 실행"')
    expect(markup).toContain('aria-label="셀 배경색"')
    expect(markup).toContain('aria-label="셀 테두리 두께"')
    expect(markup).toContain('aria-label="아래에 표 행 추가"')
    expect(markup).toContain('aria-label="현재 표 행 삭제"')
    expect(markup).toContain('aria-label="오른쪽에 표 열 추가"')
    expect(markup).toContain('aria-label="현재 표 열 삭제"')
    expect(markup).toContain('aria-label="오른쪽 표 셀과 병합"')
  })

  test('stage는 빈 화면·오류·문서 children 경계를 소유한다', () => {
    const empty = renderToStaticMarkup(createElement(ViewerStage, {
      stageRef: createRef<HTMLElement>(),
      loading: false,
      error: null,
      errorCode: null,
      hasDocument: false,
      onChooseFile: noop,
      onWheel: noop,
      onScroll: noop
    }))
    const loaded = renderToStaticMarkup(createElement(ViewerStage, {
      stageRef: createRef<HTMLElement>(),
      loading: false,
      error: null,
      errorCode: null,
      hasDocument: true,
      onChooseFile: noop,
      onWheel: noop,
      onScroll: noop
    }, createElement('div', { 'data-page-stack': true }, 'pages')))

    expect(empty).toContain('HWP 또는 HWPX를 여기에 놓으세요')
    expect(loaded).toContain('data-page-stack="true"')
    expect(loaded).not.toContain('viewer-empty')
  })

  test('status bar는 revision·경고·진행률을 독립적으로 조합한다', () => {
    const markup = renderToStaticMarkup(createElement(ViewerStatusBar, {
      hasDocument: true,
      title: '열기 진단',
      pageCount: 3,
      formatLabel: 'HWPX',
      editing: {
        sessionId: 'session',
        revision: 4,
        savedRevision: 3,
        canUndo: true,
        canRedo: false,
        isDirty: true
      },
      editingStatusText: '편집 중 · 저장 안 됨',
      editingStatusClass: 'viewer-status-warn',
      editingSelectionNotice: null,
      progress: { loaded: 1, total: 3 },
      backgroundError: null,
      hasEffectiveDocument: true,
      substitutionCount: 1,
      overflowPages: [],
      virtualized: false,
      openTiming: '800ms',
      openTimingSlow: false,
      pdfStatus: null
    }))

    expect(markup).toContain('편집 r4 · 저장 r3')
    expect(markup).toContain('불러오는 중 1/3')
    expect(markup).toContain('글꼴 대체 1')
    expect(markup).toContain('열기 800ms')
  })

  test('page stack은 format metadata와 virtualization spacer를 공통으로 렌더링한다', () => {
    const markup = renderToStaticMarkup(createElement(ViewerPageStack, {
      kind: 'hwpx',
      totalPages: 80,
      documentLoading: false,
      layoutMeasured: true,
      zoom: 1.5,
      virtualized: true,
      editing: true,
      topSpacer: 120,
      bottomSpacer: 240
    }, createElement('article', { className: 'viewer-page' }, 'page')))

    expect(markup).toContain('viewer-editing-host')
    expect(markup).toContain('viewer-pages-virtualized')
    expect(markup).toContain('data-document-format="hwpx"')
    expect(markup).toContain('data-total-pages="80"')
    expect(markup.match(/viewer-page-spacer/g)).toHaveLength(2)
    expect(markup).toContain('scale(1.5)')
  })
})
