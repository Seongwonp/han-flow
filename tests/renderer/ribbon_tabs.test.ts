import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerToolbar } from '../../src/renderer/src/ViewerToolbar'
import {
  initialRibbonTab,
  isRibbonTab,
  RIBBON_TABS,
  ribbonTabAfterEditingChange,
  ribbonTabFromKey
} from '../../src/renderer/src/ribbon_tabs'

const noop = () => undefined

const baseProps = {
  fileName: 'sample.hwpx',
  shortcutPlatform: 'win32',
  editing: null,
  editingPending: 0,
  documentLoading: false,
  loading: false,
  hasDocument: true,
  printing: false,
  fixedDocument: false,
  canStartEditing: true,
  zoom: 1,
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
  documentFonts: [],
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

const editingSession = {
  sessionId: 'session',
  revision: 2,
  savedRevision: 1,
  canUndo: true,
  canRedo: false,
  isDirty: true
}

function render(overrides: Partial<Parameters<typeof ViewerToolbar>[0]> = {}): string {
  return renderToStaticMarkup(createElement(ViewerToolbar, { ...baseProps, ...overrides }))
}

function tabs(markup: string): Array<{ label: string; selected: boolean; controls: string; id: string; tabIndex: string; context?: string }> {
  return Array.from(markup.matchAll(/<button([^>]*role="tab"[^>]*)>([^<]*)/gu)).map(([, attributes, label]) => ({
    label,
    selected: /aria-selected="true"/u.test(attributes),
    controls: attributes.match(/aria-controls="([^"]+)"/u)?.[1] ?? '',
    id: attributes.match(/id="([^"]+)"/u)?.[1] ?? '',
    tabIndex: attributes.match(/tabindex="([^"]+)"/u)?.[1] ?? '',
    context: attributes.match(/data-context="([^"]+)"/u)?.[1]
  }))
}

function panels(markup: string): Array<{ id: string; labelledBy: string; hidden: boolean; body: string }> {
  return Array.from(markup.matchAll(/<div class="viewer-ribbon-panel"([^>]*)>([\s\S]*?)(?=<div class="viewer-ribbon-panel"|<\/div><\/header>)/gu)).map(([, attributes, body]) => ({
    id: attributes.match(/id="([^"]+)"/u)?.[1] ?? '',
    labelledBy: attributes.match(/aria-labelledby="([^"]+)"/u)?.[1] ?? '',
    hidden: /\shidden=""/u.test(attributes),
    body
  }))
}

function panelFor(markup: string, tab: string): string {
  const owner = tabs(markup).find((candidate) => candidate.label === tab)
  const panel = panels(markup).find((candidate) => candidate.id === owner?.controls)
  if (!panel) throw new Error(`탭 panel 없음: ${tab}`)
  return panel.body
}

function groupLabels(body: string): string[] {
  return Array.from(body.matchAll(/class="viewer-ribbon-group-label"[^>]*>([^<]+)</gu)).map(([, label]) => label)
}

function control(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<(?:button|input|select)[^>]*aria-label="${label}"[^>]*>`, 'u'))
  if (!match) throw new Error(`control 없음: ${label}`)
  return match[0]
}

describe('리본 탭 상태', () => {
  test('탭 순서는 파일·편집·서식·표·보기', () => {
    expect(RIBBON_TABS).toEqual(['파일', '편집', '서식', '표', '보기'])
    expect(isRibbonTab('서식')).toBe(true)
    expect(isRibbonTab('홈')).toBe(false)
  })

  test('기본 탭은 편집 중이면 서식, 아니면 파일', () => {
    expect(initialRibbonTab(true)).toBe('서식')
    expect(initialRibbonTab(false)).toBe('파일')
  })

  test('편집 시작에는 서식으로 옮기고, 편집 종료 때 편집 전용 탭이면 파일로 돌아간다', () => {
    expect(ribbonTabAfterEditingChange('파일', false, true)).toBe('서식')
    expect(ribbonTabAfterEditingChange('보기', false, true)).toBe('서식')
    expect(ribbonTabAfterEditingChange('표', true, false)).toBe('파일')
    expect(ribbonTabAfterEditingChange('서식', true, false)).toBe('파일')
    expect(ribbonTabAfterEditingChange('보기', true, false)).toBe('보기')
    // 편집 상태가 그대로면 사용자가 고른 탭을 유지한다.
    expect(ribbonTabAfterEditingChange('표', true, true)).toBe('표')
    expect(ribbonTabAfterEditingChange('편집', false, false)).toBe('편집')
  })

  test('←/→는 순환하고 Home/End는 끝으로 가며 다른 키는 무시한다', () => {
    expect(ribbonTabFromKey('파일', 'ArrowRight')).toBe('편집')
    expect(ribbonTabFromKey('보기', 'ArrowRight')).toBe('파일')
    expect(ribbonTabFromKey('파일', 'ArrowLeft')).toBe('보기')
    expect(ribbonTabFromKey('표', 'ArrowLeft')).toBe('서식')
    expect(ribbonTabFromKey('표', 'Home')).toBe('파일')
    expect(ribbonTabFromKey('편집', 'End')).toBe('보기')
    expect(ribbonTabFromKey('편집', 'Enter')).toBeUndefined()
    expect(ribbonTabFromKey('편집', 'ArrowDown')).toBeUndefined()
  })
})

describe('리본 탭 markup', () => {
  test('tablist·tab·tabpanel이 서로 id로 연결되고 선택한 panel만 보인다', () => {
    const markup = render({ editing: editingSession, characterStyleAvailable: true, paragraphStyleAvailable: true })
    expect(markup).toContain('role="tablist"')
    const tabList = tabs(markup)
    expect(tabList.map(({ label }) => label)).toEqual(['파일', '편집', '서식', '표', '보기'])
    expect(tabList.filter(({ selected }) => selected).map(({ label }) => label)).toEqual(['서식'])
    expect(tabList.map(({ tabIndex }) => tabIndex)).toEqual(['-1', '-1', '0', '-1', '-1'])
    const panelList = panels(markup)
    expect(panelList).toHaveLength(5)
    for (const tab of tabList) {
      const panel = panelList.find(({ id }) => id === tab.controls)
      expect(panel?.labelledBy).toBe(tab.id)
      expect(panel?.hidden).toBe(!tab.selected)
    }
    expect(markup).not.toContain('>홈<')
  })

  test('탭마다 지금 있는 control만 담는다', () => {
    const markup = render({ editing: editingSession, fixedDocument: false })
    expect(groupLabels(panelFor(markup, '파일'))).toEqual(['문서', '저장', '내보내기'])
    for (const label of ['문서 열기', '새 창', 'HWPX 변경본 저장', 'PDF로 내보내기']) {
      expect(panelFor(markup, '파일')).toContain(`aria-label="${label}"`)
    }
    expect(groupLabels(panelFor(markup, '편집'))).toEqual(['기록'])
    expect(groupLabels(panelFor(markup, '서식'))).toEqual(['글자 모양', '문단 정렬', '문단 간격'])
    expect(groupLabels(panelFor(markup, '표'))).toEqual(['표 셀 모양', '표 구조'])
    expect(panelFor(markup, '표')).toContain('aria-label="오른쪽 표 셀과 병합"')
    expect(groupLabels(panelFor(markup, '보기'))).toEqual(['확대/축소'])
    for (const label of ['축소', '확대', '100%로 보기']) {
      expect(panelFor(markup, '보기')).toContain(`aria-label="${label}"`)
    }
    // 확대/축소·열기·PDF는 상단 줄에서 리본으로 옮겼다.
    const mainRow = markup.slice(0, markup.indexOf('viewer-edit-ribbon'))
    expect(mainRow).not.toContain('aria-label="확대"')
    expect(mainRow).not.toContain('PDF')
  })

  test('HWP fixed-page 문서는 편집 탭에 찾기를 둔다', () => {
    const markup = render({ fixedDocument: true, canStartEditing: false })
    expect(groupLabels(panelFor(markup, '편집'))).toEqual(['기록', '찾기'])
    expect(control(markup, '검색')).toContain('title="찾기 (Ctrl+F)"')
    expect(panelFor(markup, '서식')).toContain('HWP 문서는 읽기 전용입니다.')
  })

  test('보기 모드 기본 탭은 파일이고 서식·표 control은 꺼져 있다', () => {
    const markup = render({ characterStyleAvailable: true, paragraphStyleAvailable: true, cellStyleAvailable: true })
    expect(tabs(markup).find(({ selected }) => selected)?.label).toBe('파일')
    expect(control(markup, 'HWPX 편집 시작')).not.toMatch(/\sdisabled=/u)
    for (const label of ['현재 텍스트 블록 굵게', '가운데 정렬', '셀 배경색', '아래에 표 행 추가', '실행 취소', 'HWPX 변경본 저장']) {
      expect(control(markup, label)).toMatch(/\sdisabled=/u)
    }
    expect(control(markup, '문서 열기')).not.toMatch(/\sdisabled=/u)
    expect(control(markup, 'PDF로 내보내기')).not.toMatch(/\sdisabled=/u)
    expect(panelFor(markup, '표')).toContain('편집 시작을 누르면 사용할 수 있습니다.')
  })

  test('표 안에 caret이 있으면 탭을 바꾸지 않고 표 탭에 표시만 한다', () => {
    const outside = render({ editing: editingSession })
    expect(tabs(outside).find(({ label }) => label === '표')?.context).toBeUndefined()
    expect(outside).not.toContain('viewer-ribbon-tab-badge')
    expect(panelFor(outside, '표')).toContain('표 셀 안에 커서를 두면 사용할 수 있습니다.')

    const inside = render({ editing: editingSession, cellStyleAvailable: true })
    expect(tabs(inside).find(({ selected }) => selected)?.label).toBe('서식')
    expect(tabs(inside).find(({ label }) => label === '표')?.context).toBe('table')
    expect(inside).toContain('viewer-ribbon-tab-badge')
    expect(inside).toContain('title="커서가 표 안에 있습니다"')
    expect(control(inside, '아래에 표 행 추가')).not.toMatch(/\sdisabled=/u)

    // 표 탭을 이미 보고 있으면 점 표시는 하지 않는다.
    const onTableTab = render({ editing: editingSession, cellStyleAvailable: true, defaultRibbonTab: '표' })
    expect(onTableTab).not.toContain('viewer-ribbon-tab-badge')
  })

  test('보기 탭 확대/축소는 단축키 표기와 현재 배율을 보인다', () => {
    const markup = render({ zoom: 1.5, defaultRibbonTab: '보기' })
    expect(tabs(markup).find(({ selected }) => selected)?.label).toBe('보기')
    expect(control(markup, '확대')).toContain('title="확대 (Ctrl++)"')
    expect(control(markup, '축소')).toContain('title="축소 (Ctrl+-)"')
    expect(control(markup, '100%로 보기')).toContain('title="원래 크기 (Ctrl+0)"')
    expect(markup).toContain('150%')
    expect(control(render({ zoom: 1 }), '100%로 보기')).toMatch(/\sdisabled=/u)
  })
})
