import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  historyInputDirection,
  interceptHistoryInput,
  rendererPlatform,
  resolveShortcut,
  shortcutLabel,
  shortcutModifierPressed
} from '../../src/renderer/src/keyboard_shortcuts'
import { ViewerToolbar } from '../../src/renderer/src/ViewerToolbar'

const key = (
  value: string,
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}
) => ({ key: value, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers })

/** globalThis.api·navigator를 잠시 바꿔 rendererPlatform()의 입력을 고정한다. */
function withPlatform(values: { api?: string; navigator?: string }, run: () => void): void {
  const scope = globalThis as Record<string, unknown>
  const saved = ['api', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(scope, name)] as const)
  try {
    Object.defineProperty(scope, 'api', {
      value: values.api === undefined ? undefined : { platform: values.api },
      configurable: true,
      writable: true
    })
    Object.defineProperty(scope, 'navigator', {
      value: values.navigator === undefined ? undefined : { platform: values.navigator },
      configurable: true,
      writable: true
    })
    run()
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(scope, name, descriptor)
      else delete scope[name]
    }
  }
}

describe('keyboard shortcuts', () => {
  test('win32·linux는 Ctrl을 modifier로 쓰고 Win(meta)·AltGr(Ctrl+Alt) 조합은 무시한다', () => {
    for (const platform of ['win32', 'linux']) {
      expect(resolveShortcut(key('b', { ctrlKey: true }), platform)).toBe('bold')
      expect(resolveShortcut(key('i', { ctrlKey: true }), platform)).toBe('italic')
      expect(resolveShortcut(key('u', { ctrlKey: true }), platform)).toBe('underline')
      expect(resolveShortcut(key('s', { ctrlKey: true }), platform)).toBe('save')
      expect(resolveShortcut(key('z', { ctrlKey: true }), platform)).toBe('undo')
      expect(resolveShortcut(key('Z', { ctrlKey: true, shiftKey: true }), platform)).toBe('redo')
      expect(resolveShortcut(key('y', { ctrlKey: true }), platform)).toBe('redo')
      expect(resolveShortcut(key('f', { ctrlKey: true }), platform)).toBe('search')
      expect(resolveShortcut(key('=', { ctrlKey: true }), platform)).toBe('zoomIn')
      expect(resolveShortcut(key('+', { ctrlKey: true, shiftKey: true }), platform)).toBe('zoomIn')
      expect(resolveShortcut(key('-', { ctrlKey: true }), platform)).toBe('zoomOut')
      expect(resolveShortcut(key('0', { ctrlKey: true }), platform)).toBe('zoomReset')
      expect(resolveShortcut(key('z', { metaKey: true }), platform)).toBeUndefined()
      expect(resolveShortcut(key('z', { ctrlKey: true, metaKey: true }), platform)).toBeUndefined()
      expect(resolveShortcut(key('0', { ctrlKey: true, altKey: true }), platform)).toBeUndefined()
      expect(resolveShortcut(key('z'), platform)).toBeUndefined()
    }
  })

  test('darwin은 기존대로 ⌘만 modifier로 쓰고 Ctrl 조합과 Ctrl+Y는 무시한다', () => {
    expect(resolveShortcut(key('b', { metaKey: true }), 'darwin')).toBe('bold')
    expect(resolveShortcut(key('z', { metaKey: true }), 'darwin')).toBe('undo')
    expect(resolveShortcut(key('Z', { metaKey: true, shiftKey: true }), 'darwin')).toBe('redo')
    expect(resolveShortcut(key('f', { metaKey: true }), 'darwin')).toBe('search')
    expect(resolveShortcut(key('=', { metaKey: true }), 'darwin')).toBe('zoomIn')
    expect(resolveShortcut(key('y', { metaKey: true }), 'darwin')).toBeUndefined()
    expect(resolveShortcut(key('b', { ctrlKey: true }), 'darwin')).toBeUndefined()
    expect(resolveShortcut(key('z', { ctrlKey: true }), 'darwin')).toBeUndefined()
    expect(shortcutModifierPressed(key('z', { metaKey: true, altKey: true }), 'darwin')).toBe(true)
  })

  test('platform별 단축키 표기와 ribbon tooltip', () => {
    expect(shortcutLabel('Z', 'darwin')).toBe('⌘Z')
    expect(shortcutLabel('Z', 'darwin', { shift: true })).toBe('⇧⌘Z')
    expect(shortcutLabel('Z', 'win32')).toBe('Ctrl+Z')
    expect(shortcutLabel('Z', 'win32', { shift: true })).toBe('Ctrl+Shift+Z')

    const render = (shortcutPlatform: string) => renderToStaticMarkup(createElement(ViewerToolbar, {
      fileName: 'sample.hwpx',
      shortcutPlatform,
      editing: { sessionId: 'session', revision: 1, savedRevision: 1, canUndo: true, canRedo: true, isDirty: false },
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
      characterStyleAvailable: true,
      paragraphStyleAvailable: true,
      cellStyleAvailable: false,
      tableCellSelectionAvailable: false,
      documentFonts: [],
      onSearchQueryChange: () => undefined,
      onSearchStep: () => undefined,
      onSearchClose: () => undefined,
      onSearchOpen: () => undefined,
      onStartEditing: () => undefined,
      onZoomStep: () => undefined,
      onZoomReset: () => undefined,
      onOpenNewWindow: () => undefined,
      onExportPdf: () => undefined,
      onChooseFile: () => undefined,
      onSaveEditing: () => undefined,
      onUndoEditing: () => undefined,
      onRedoEditing: () => undefined,
      onCharacterStyle: () => undefined,
      onParagraphStyle: () => undefined,
      onCellStyle: () => undefined,
      onInsertTableRowAfter: () => undefined,
      onDeleteTableRow: () => undefined,
      onInsertTableColumnAfter: () => undefined,
      onDeleteTableColumn: () => undefined,
      onMergeTableCellRight: () => undefined,
      onSplitTableCell: () => undefined
    }))
    const windows = render('win32')
    expect(windows).toContain('title="실행 취소 (Ctrl+Z)"')
    expect(windows).toContain('title="다시 실행 (Ctrl+Shift+Z)"')
    expect(windows).toContain('title="기울임 (Ctrl+I)"')
    expect(windows).toContain('title="밑줄 (Ctrl+U)"')
    expect(windows).not.toContain('⌘')
    const mac = render('darwin')
    expect(mac).toContain('title="실행 취소 (⌘Z)"')
    expect(mac).toContain('title="다시 실행 (⇧⌘Z)"')
    expect(mac).not.toContain('Ctrl+')

    // shortcutPlatform을 넘기지 않으면 키 처리와 같은 rendererPlatform() 규칙을 따른다.
    withPlatform({ navigator: 'Win32' }, () => {
      const fallback = render(undefined as unknown as string)
      expect(fallback).toContain('title="실행 취소 (Ctrl+Z)"')
      expect(resolveShortcut(key('z', { ctrlKey: true }), rendererPlatform())).toBe('undo')
    })
    withPlatform({ navigator: 'MacIntel' }, () => {
      expect(render(undefined as unknown as string)).toContain('title="실행 취소 (⌘Z)"')
    })
  })

  test('rendererPlatform은 preload platform을 우선하고 없으면 Mac navigator만 darwin으로 본다', () => {
    withPlatform({ api: 'win32', navigator: 'MacIntel' }, () => expect(rendererPlatform()).toBe('win32'))
    withPlatform({ api: 'darwin', navigator: 'Win32' }, () => expect(rendererPlatform()).toBe('darwin'))
    withPlatform({ navigator: 'MacIntel' }, () => expect(rendererPlatform()).toBe('darwin'))
    withPlatform({ navigator: 'Win32' }, () => expect(rendererPlatform()).toBe(''))
    withPlatform({ navigator: 'Linux x86_64' }, () => expect(rendererPlatform()).toBe(''))
    withPlatform({}, () => expect(rendererPlatform()).toBe(''))
  })
})

describe('native history input', () => {
  const inputEvent = (inputType: string) => ({ inputType, preventDefault: jest.fn() })

  test('historyUndo·historyRedo는 기본 동작을 막고 앱 history로 보낸다', () => {
    const onHistory = jest.fn()
    const undo = inputEvent('historyUndo')
    expect(interceptHistoryInput(undo, false, onHistory)).toBe(true)
    expect(undo.preventDefault).toHaveBeenCalledTimes(1)
    const redo = inputEvent('historyRedo')
    expect(interceptHistoryInput(redo, false, onHistory)).toBe(true)
    expect(redo.preventDefault).toHaveBeenCalledTimes(1)
    expect(onHistory.mock.calls).toEqual([['undo'], ['redo']])
  })

  test('IME 조합 중에는 기본 undo를 막기만 하고 앱 undo를 실행하지 않는다', () => {
    const onHistory = jest.fn()
    const undo = inputEvent('historyUndo')
    expect(interceptHistoryInput(undo, true, onHistory)).toBe(true)
    expect(undo.preventDefault).toHaveBeenCalledTimes(1)
    expect(onHistory).not.toHaveBeenCalled()
  })

  test('callback이 없어도 기본 undo는 막는다', () => {
    const undo = inputEvent('historyUndo')
    expect(interceptHistoryInput(undo, false, undefined)).toBe(true)
    expect(undo.preventDefault).toHaveBeenCalledTimes(1)
  })

  test('일반 입력은 건드리지 않는다', () => {
    const onHistory = jest.fn()
    for (const inputType of ['insertText', 'insertCompositionText', 'deleteContentBackward', 'insertParagraph']) {
      const event = inputEvent(inputType)
      expect(historyInputDirection(inputType)).toBeUndefined()
      expect(interceptHistoryInput(event, false, onHistory)).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    expect(onHistory).not.toHaveBeenCalled()
  })
})
