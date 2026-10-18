import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerNoteList } from '../../src/core/document/viewer_document'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { FootnoteAreaView, NoteListView, ParagraphView, sublistParagraphEditing } from '../../src/renderer/src/App'
import { sectionFootnoteSettings } from '../../src/core/layout/footnote_layout'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { createEditScopeHwpx } from '../fixtures/public/create_synthetic_hwpx'

const noop = () => undefined

function pageEditing(extra: Record<string, unknown> = {}) {
  return {
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
    onTableCellSelectionChange: noop,
    ...extra
  }
}

/** 입력 surface는 useLayoutEffect를 쓰므로 server render 경고만 걸러 낸다. */
function render(element: ReturnType<typeof createElement>): string {
  const consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    throw new Error([message, ...rest].map(String).join(' '))
  })
  try {
    return renderToStaticMarkup(element)
  } finally {
    consoleError.mockRestore()
  }
}

const count = (markup: string, text: string) => markup.split(text).length - 1

describe('편집 범위 확장 화면', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-edit-scope-view-'))
  let document: ViewerDocument
  beforeAll(async () => {
    document = await decodeViewerDocument(await HwpxSourcePackage.open(createEditScopeHwpx(directory)))
  })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('표만 든 본문 문단은 편집 중 표 앞·뒤 caret 입력 칸과 셀 입력 칸을 함께 그린다', () => {
    const paragraph = document.sections[0].blocks[2]
    const markup = render(createElement(ParagraphView, { paragraph, document, editing: pageEditing({ allowTableParagraph: true }) as any }))
    expect(count(markup, 'aria-label="HWPX 표 앞뒤 글자 편집"')).toBe(2)
    expect(markup).toContain('viewer-table-caret viewer-table-caret-before')
    expect(markup).toContain('viewer-table-caret viewer-table-caret-after')
    expect(markup).toContain('data-source-text-node-id="Contents/section0.xml#hp:p:5:table-before"')
    // 표 앞·뒤 칸은 서로 다른 범위 scope를 쓴다.
    expect(markup).toContain('data-editor-range-scope="Contents/section0.xml:table-paragraph:s0:p2:0"')
    expect(markup).toContain('data-editor-range-scope="Contents/section0.xml:table-paragraph:s0:p2:1"')
    expect(count(markup, 'aria-label="HWPX 표 셀 편집"')).toBe(2)
    // 표 앞 caret은 표보다 먼저 나온다.
    expect(markup.indexOf('viewer-table-caret-before')).toBeLessThan(markup.indexOf('<table'))
    expect(markup.indexOf('viewer-table-caret-after')).toBeGreaterThan(markup.indexOf('</table>'))
  })

  test('표 문단 편집을 주지 않는 곳(측정·보기)에서는 표 앞·뒤 caret 입력 칸을 그리지 않는다', () => {
    const paragraph = document.sections[0].blocks[2]
    expect(render(createElement(ParagraphView, { paragraph, document, editing: pageEditing() as any }))).not.toContain('HWPX 표 앞뒤 글자 편집')
    expect(render(createElement(ParagraphView, { paragraph, document }))).not.toContain('viewer-editable-text')
    expect(render(createElement(ParagraphView, { paragraph, document, measurable: true, editing: pageEditing({ allowTableParagraph: true }) as any })))
      .not.toContain('viewer-editable-text')
  })

  test('쪽 아래 각주 영역과 구역 끝 미주 목록은 편집 중 본문 문단에 입력 칸을 하나씩 둔다', () => {
    const pages = paginateViewerDocument(document)
    // 각주는 번호 표시가 든 첫 쪽 아래에 있다.
    expect(pages.map((page) => page.footnotes?.[0]?.length ?? 0)).toEqual([1, 0])
    const settings = sectionFootnoteSettings(document.sections[0].footnoteSettings)
    const footnotes = render(createElement(FootnoteAreaView, { footnotes: pages[0].footnotes![0], settings, columnWidth: 48190, document, editing: pageEditing({ allowTableParagraph: true }) as any }))
    expect(count(footnotes, 'aria-label="HWPX 각주·미주 편집"')).toBe(1)
    expect(footnotes).toContain('data-note-kind="footnote"')
    expect(footnotes).toContain('data-editor-range-scope="Contents/section0.xml:note:')
    const lists = document.sections[0].blocks
      .flatMap((block) => block.content.filter((item): item is ViewerNoteList => item.type === 'note-list'))
    const markup = lists.map((item) => render(createElement(NoteListView, { item, document, editing: pageEditing({ allowTableParagraph: true }) as any }))).join('')
    expect(count(markup, 'aria-label="HWPX 각주·미주 편집"')).toBe(1)
    expect(markup).toContain('data-note-kind="endnote"')
    expect(lists.map((item) => render(createElement(NoteListView, { item, document }))).join('')).not.toContain('viewer-editable-text')
    expect(render(createElement(FootnoteAreaView, { footnotes: pages[0].footnotes![0], settings, columnWidth: 48190, document }))).not.toContain('viewer-editable-text')
  })

  test('머리말 편집 props는 active 쪽에만 selection 복원을 넘기고 문단 구조를 막는다', () => {
    const selection = { sectionPath: 'Contents/section0.xml', anchorTextNodeId: 'x', anchorOffset: 0, focusTextNodeId: 'x', focusOffset: 0 }
    const base = pageEditing({ allowTableParagraph: true, desiredSelection: selection }) as any
    const active = sublistParagraphEditing(base, 'HEADER_FOOTER_TEXT', 'HWPX 머리말 편집', selection)!
    const inactive = sublistParagraphEditing(base, 'HEADER_FOOTER_TEXT', 'HWPX 머리말 편집', undefined)!
    expect(active.desiredSelection).toBe(selection)
    expect(inactive.desiredSelection).toBeUndefined()
    expect(active).toMatchObject({ allowParagraphStructure: false, allowTableParagraph: false, allowParagraphRange: false })
    expect(active.structureGate).toEqual({ split: 'SUBLIST_TEXT', mergePrevious: 'SUBLIST_TEXT', mergeNext: 'SUBLIST_TEXT' })
    expect(sublistParagraphEditing(undefined, 'HEADER_FOOTER_TEXT', 'x', undefined)).toBeUndefined()
    const header = document.sections[0].headers[0].paragraphs[0]
    const markup = render(createElement(ParagraphView, { paragraph: header, document, editing: active }))
    expect(markup).toContain('aria-label="HWPX 머리말 편집"')
    expect(markup).toContain('data-editor-range-scope="Contents/section0.xml:header-footer:s0:header0:p0"')
  })
})
