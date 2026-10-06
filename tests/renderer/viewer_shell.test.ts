import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { editingCapabilities } from '../../src/core/editing/editing_capability'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCompatibilityHwpx } from '../fixtures/public/create_synthetic_hwpx'
import {
  ViewerColumnFlow,
  ViewerPageStack,
  ViewerStage,
  ViewerStatusBar
} from '../../src/renderer/src/ViewerShell'
import { ViewerToolbar } from '../../src/renderer/src/ViewerToolbar'
import { editingRibbonState, ParagraphView, TableView, tableCellEditingMode } from '../../src/renderer/src/App'

const noop = () => undefined

const toolbarProps = {
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
  cellStyleAvailable: false,
  tableCellSelectionAvailable: false,
  documentFonts: [{ id: '0', family: 'HanFlow Test Sans' }],
  onSearchQueryChange: noop,
  onSearchStep: noop,
  onSearchClose: noop,
  onSearchOpen: noop,
  onStartEditing: noop,
  onZoomStep: noop,
  onZoomReset: noop,
  onOpenNewWindow: noop,
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
  onMergeTableCellRight: noop,
  onSplitTableCell: noop
}

describe('viewer shell components', () => {
  test('긴 파일 이름은 한 줄 말줄임 class와 전체 이름 tooltip으로 표시한다', () => {
    const longName = '2026년도 지식재산처 발명의 날 서포터스 발족식 개최 계획 및 홍보활동 추진 결과 보고서 최종본 수정 반영 검토 완료 배포용 사본.hwp'
    expect(Array.from(longName).length).toBeGreaterThanOrEqual(75)
    const markup = renderToStaticMarkup(createElement(ViewerToolbar, {
      ...toolbarProps,
      fileName: longName,
      editing: undefined,
      fixedDocument: true,
      canStartEditing: false
    }))
    const escaped = longName.replace(/&/g, '&amp;')
    expect(markup).toContain(`<span class="viewer-file-name" title="${escaped}">${escaped}</span>`)
    // 전체 이름을 다른 곳에 중복으로 펼치지 않는다(상단 막대 한 곳).
    expect(markup.split(escaped).length - 1).toBe(2)
  })

  test('상단 막대 CSS는 파일 이름만 줄이고 동작 버튼·리본 버튼은 줄바꿈하지 않는다', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/src/assets/main.css'), 'utf8')
    const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule('.viewer-file-name')).toEqual(expect.stringContaining('min-width: 0'))
    expect(rule('.viewer-file-name')).toEqual(expect.stringContaining('white-space: nowrap'))
    expect(rule('.viewer-file-name')).toEqual(expect.stringContaining('text-overflow: ellipsis'))
    expect(rule('.viewer-file-name')).toEqual(expect.stringContaining('overflow: hidden'))
    expect(rule('.viewer-title')).toEqual(expect.stringContaining('min-width: 0'))
    expect(rule('.viewer-actions')).toEqual(expect.stringContaining('flex: none'))
    expect(rule('.viewer-actions button, .viewer-empty button')).toEqual(expect.stringContaining('white-space: nowrap'))
    expect(rule('.viewer-ribbon-controls button')).toEqual(expect.stringContaining('white-space: nowrap'))
    expect(rule('.viewer-ribbon-tabs button')).toEqual(expect.stringContaining('white-space: nowrap'))
  })

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
      tableCellSelectionAvailable: true,
      activeCellStyle: { backgroundColor: '#EEEEEE', borderColor: '#000000', borderWidth: 0.12 },
      documentFonts: [{ id: '0', family: 'HanFlow Test Sans' }],
      onSearchQueryChange: noop,
      onSearchStep: noop,
      onSearchClose: noop,
      onSearchOpen: noop,
      onStartEditing: noop,
      onZoomStep: noop,
      onZoomReset: noop,
      onOpenNewWindow: noop,
  onZoomReset: noop,
  onOpenNewWindow: noop,
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
      onMergeTableCellRight: noop,
      onSplitTableCell: noop
    }))

    expect(markup).toContain('sample.hwpx')
    expect(markup).toContain('125%')
    expect(markup).toContain('aria-label="리본 메뉴"')
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
    expect(markup).toContain('aria-label="선택한 병합 표 셀 분할"')
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

  test('읽기 전용 병합 cell은 click selection target과 선택 outline을 표시한다', () => {
    const sectionPath = 'Contents/section0.xml'
    const table = {
      type: 'table' as const,
      id: 'table-0',
      rowCount: 1,
      columnCount: 2,
      width: 200,
      repeatHeader: false,
      rows: [{ cells: [{
        row: 0,
        column: 0,
        rowSpan: 1,
        columnSpan: 2,
        width: 200,
        height: 100,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        sourceCellId: 'table-0:r0c0',
        paragraphs: [{
          id: 'merged-p0',
          paraStyleId: '0',
          pageBreak: false,
          layoutHeight: 0,
          content: [{
            type: 'text' as const,
            text: '병합',
            charStyleId: '0',
            sourceAnchor: { sectionPath, textNodeId: `${sectionPath}#hp:t:0` }
          }]
        }]
      }] }]
    }
    const document = {
      page: {
        width: 1000,
        height: 1000,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        headerOffset: 0,
        footerOffset: 0
      },
      fonts: {},
      charStyles: {},
      paraStyles: {},
      cellStyles: {},
      resources: {},
      diagnostics: [],
      sections: []
    }
    const selection = {
      sectionPath,
      textNodeId: `${sectionPath}#hp:t:0`,
      tableId: 'table-0',
      sourceCellId: 'table-0:r0c0',
      row: 0,
      column: 0
    }
    // 병합 셀의 text 입력 surface는 useLayoutEffect를 쓰므로 server render 경고만 걸러 낸다.
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
      if (String(message).includes('useLayoutEffect does nothing on the server')) return
      throw new Error([message, ...rest].map(String).join(' '))
    })
    const markup = renderToStaticMarkup(createElement(TableView as any, {
      table,
      document,
      editing: {
        pending: false,
        tableCellSelection: selection,
        onTableCellSelectionChange: noop
      }
    }))
    consoleError.mockRestore()

    expect(markup).toContain('viewer-selectable-table-cell viewer-table-cell-selected')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('aria-label="병합 표 셀 1행 1열"')
    expect(markup).toContain('tabindex="0"')
    // 병합 셀도 text 전용 입력 surface를 받는다(구조 command는 capability가 막는다).
    expect(markup).toContain('aria-label="HWPX 표 셀 글자 편집"')
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

  test('동일 너비 다단을 순서와 간격이 있는 grid로 렌더링한다', () => {
    const markup = renderToStaticMarkup(createElement(ViewerColumnFlow, {
      gap: 8,
      columns: [
        [createElement('p', { key: 'left' }, '왼쪽')],
        [createElement('p', { key: 'right' }, '오른쪽')]
      ]
    }))

    expect(markup).toContain('viewer-column-flow')
    expect(markup).toContain('data-column-count="2"')
    expect(markup).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))')
    expect(markup).toContain('column-gap:8px')
    expect(markup.indexOf('왼쪽')).toBeLessThan(markup.indexOf('오른쪽'))
  })
  test.each([
    ['일반 셀', 'A'],
    ['병합 셀', 'R'],
    ['머리글 셀', 'H1']
  ])('%s caret이면 ribbon의 글자·문단 모양 control과 단축키 상태가 켜진다', async (_label, text) => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-ribbon-cell-'))
    try {
      const source = await HwpxSourcePackage.open(createCompatibilityHwpx(directory))
      const sectionPath = 'Contents/section0.xml'
      const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === text)!
      const document = await decodeViewerDocument(source)
      const capabilities = editingCapabilities(document, {
        sectionPath,
        anchorTextNodeId: anchor.textNodeId,
        anchorOffset: 0,
        focusTextNodeId: anchor.textNodeId,
        focusOffset: text.length
      })
      const ribbon = editingRibbonState(document, capabilities)
      expect(ribbon.characterStyleAvailable).toBe(true)
      expect(ribbon.paragraphStyleAvailable).toBe(true)
      expect(ribbon.activeStyle).toMatchObject({ bold: true, height: 500 })

      const markup = renderToStaticMarkup(createElement(ViewerToolbar, {
        ...toolbarProps,
        characterStyleAvailable: ribbon.characterStyleAvailable,
        paragraphStyleAvailable: ribbon.paragraphStyleAvailable,
        cellStyleAvailable: ribbon.cellStyleAvailable,
        activeStyle: ribbon.activeStyle,
        activeCellStyle: ribbon.activeCellStyle
      }))
      const control = (label: string): string => {
        const match = markup.match(new RegExp(`<(?:button|input|select)[^>]*aria-label="${label}"[^>]*>`))
        if (!match) throw new Error(`control 없음: ${label}`)
        return match[0]
      }
      for (const label of [
        '현재 텍스트 블록 굵게',
        '현재 텍스트 블록 기울임',
        '현재 텍스트 블록 밑줄',
        '글자 크기 늘리기',
        '글자 색상',
        '가운데 정렬',
        '줄 간격 늘리기',
        '첫 줄 들여쓰기',
        '문단 앞 간격 늘리기'
      ]) {
        expect(control(label)).not.toMatch(/\sdisabled=/)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('글자 칸 없는 빈 문단·셀은 합성 anchor 입력 surface를 받고 문단 구조·여러 문단 범위에서는 빠진다', async () => {
    const source = await HwpxSourcePackage.open(join(__dirname, '../fixtures/public/external/ext-hwpxlib-table-scores.hwpx'))
    const document = await decodeViewerDocument(source)
    const blocks = document.sections[0].blocks
    const empty = blocks.find((paragraph) =>
      paragraph.content.length === 1 &&
      paragraph.content[0].type === 'text' &&
      Boolean(paragraph.content[0].sourceAnchor?.textNodeId.endsWith(':empty'))
    )!
    const anchorId = empty.content[0].type === 'text' ? empty.content[0].sourceAnchor!.textNodeId : ''
    expect(anchorId).toMatch(/^Contents\/section0\.xml#hp:p:\d+:empty$/)
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
      if (String(message).includes('useLayoutEffect does nothing on the server')) return
      throw new Error([message, ...rest].map(String).join(' '))
    })
    const markup = renderToStaticMarkup(createElement(ParagraphView as any, {
      paragraph: empty,
      document,
      editing: {
        pending: false,
        allowMultipleRuns: true,
        allowParagraphRange: true,
        allowParagraphStructure: true,
        onCommit: noop,
        onComposingChange: noop,
        onSelectionChange: noop,
        onEditorSelectionChange: noop,
        onRangeCommit: noop,
        onSplitParagraph: noop,
        onMergeParagraph: noop,
        onParagraphStructureUnavailable: noop,
        onTableCellSelectionChange: noop
      }
    }))
    consoleError.mockRestore()
    expect(markup).toContain(`data-source-text-node-id="${anchorId}"`)
    // 여러 최상위 문단 범위(`:top-level`) 대신 문단 하나 scope를 쓴다.
    expect(markup).toContain(`data-editor-range-scope="Contents/section0.xml:paragraph:${empty.id}"`)

    const table = blocks.flatMap((paragraph) => paragraph.content).find((item) => item.type === 'table')
    const cells = table?.type === 'table' ? table.rows.flatMap((row) => row.cells) : []
    const emptyCell = cells.find((cell) => cell.paragraphs.some((paragraph) =>
      paragraph.content.some((item) => item.type === 'text' && Boolean(item.sourceAnchor?.textNodeId.endsWith(':empty')))
    ))!
    expect(emptyCell).toBeDefined()
    expect(tableCellEditingMode(emptyCell)).toBe('text')
  })
})
