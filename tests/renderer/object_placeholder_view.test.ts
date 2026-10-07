import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerObjectPlaceholder, ViewerParagraph } from '../../src/core/document/viewer_document'
import { countObjectPlaceholders } from '../../src/core/document/object_placeholder'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { isEditableTextParagraph, NoteListView, ObjectPlaceholderView, ParagraphView } from '../../src/renderer/src/App'
import { ObjectPlaceholderBanner, ViewerStatusBar } from '../../src/renderer/src/ViewerShell'
import { pdfObjectPlaceholderConfirmation } from '../../src/main/pdf_export_warning'

const noop = () => undefined
const external = (name: string) => join(__dirname, '../fixtures/public/external', name)
const open = async (name: string) => decodeViewerDocument(await HwpxSourcePackage.open(external(name)))

const editingProps = {
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

function renderQuietly(element: Parameters<typeof renderToStaticMarkup>[0]): string {
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

function findParagraph(document: ViewerDocument, predicate: (paragraph: ViewerParagraph) => boolean): ViewerParagraph {
  const paragraph = document.sections[0].blocks.find(predicate)
  if (!paragraph) throw new Error('문단을 찾지 못했습니다.')
  return paragraph
}

const hasKind = (kind: ViewerObjectPlaceholder['kind']) => (paragraph: ViewerParagraph) =>
  paragraph.content.some((item) => item.type === 'object-placeholder' && item.kind === kind)

describe('원본 개체 자리 표시 renderer', () => {
  test('수식은 선언 크기의 테두리 상자에 "수식" 이름과 script를 보여 준다', async () => {
    const document = await open('ext-hwpxlib-equation.hwpx')
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: findParagraph(document, hasKind('equation')), document }))
    expect(markup).toContain('class="viewer-object-placeholder viewer-object-inline"')
    expect(markup).toContain('data-object-kind="equation"')
    expect(markup).toContain('data-source-path="Contents/section0.xml#hp:equation:0"')
    expect(markup).toContain('<span class="viewer-object-label">수식</span>')
    expect(markup).toContain('<span class="viewer-object-fallback viewer-object-script">{&quot;123&quot;} over {123 sqrt {3466}} sum _{34} ^{12}</span>')
    expect(markup).toMatch(/style="min-width:51px;min-height:44\.\d+px"/)
    expect(markup).toContain('contenteditable="false"')
  })

  test('글상자는 되살린 글을 상자 안 읽기 전용 문단으로 그린다', async () => {
    const document = await open('ext-pyhwpx-text-box-fields.hwpx')
    const paragraph = findParagraph(document, hasKind('text-box'))
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph, document }))
    expect(markup).toContain('<span class="viewer-object-label">글상자</span>')
    expect(markup).toContain('<span class="viewer-object-body"><div class="viewer-paragraph"')
    expect(markup).toContain('원래 글')
    expect(markup).not.toContain('data-source-text-node-id')
  })

  test('편집 중에도 자리 표시는 글자 입력 surface 사이 제자리에 읽기 전용으로 남는다', async () => {
    const document = await open('ext-pyhwpx-text-box-fields.hwpx')
    const paragraph = findParagraph(document, hasKind('text-box'))
    expect(isEditableTextParagraph(paragraph, true)).toBe(true)
    const markup = renderQuietly(createElement(ParagraphView as any, { paragraph, document, editing: editingProps }))
    const placeholderAt = markup.indexOf('data-object-kind="text-box"')
    const surfaceAt = markup.indexOf('data-source-text-node-id=')
    expect(placeholderAt).toBeGreaterThanOrEqual(0)
    expect(surfaceAt).toBeGreaterThan(placeholderAt)
  })

  test('각주 번호는 위 첨자로, 각주·미주 본문은 구역 끝 목록으로 그린다', async () => {
    const document = await open('ext-pyhwpx-foot-endnotes.hwpx')
    const blocks = document.sections[0].blocks
    const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph: findParagraph(document, hasKind('footnote')), document }))
    expect(markup).toContain('<sup data-object-kind="footnote"')
    expect(markup).toContain('class="viewer-note-marker" title="각주 1)">1)</sup>')
    const list = blocks[blocks.length - 1].content[0]
    expect(list.type).toBe('note-list')
    const notes = renderToStaticMarkup(createElement(NoteListView, { item: list as any, document }))
    expect(notes).toContain('<div class="viewer-note-heading">각주</div>')
    expect(notes).toContain('<div class="viewer-note-heading">미주</div>')
    expect(notes).toContain('각주 본문')
    expect(notes).toContain('미주 본문')
  })

  test('메모와 덧말은 줄 안 표시로 그린다', async () => {
    const memos = await open('ext-pyhwpx-memos.hwpx')
    const memo = renderToStaticMarkup(createElement(ParagraphView, { paragraph: findParagraph(memos, hasKind('memo')), document: memos }))
    expect(memo).toContain('class="viewer-object-placeholder viewer-object-marker"')
    expect(memo).toContain('<span class="viewer-object-label">메모</span><span class="viewer-object-fallback">메모 1</span>')
    const dutmal = await open('ext-hwpxlib-dutmal.hwpx')
    const ruby = renderToStaticMarkup(createElement(ParagraphView, { paragraph: findParagraph(dutmal, hasKind('ruby')), document: dutmal }))
    expect(ruby).toContain('class="viewer-ruby viewer-ruby-top" title="덧말">테스트_본말<rt>테스트_닷말</rt></ruby>')
  })

  test('글 앞 개체는 자리를 차지하지 않는 작은 표시로 그린다', () => {
    const document = { charStyles: {}, paraStyles: {}, resources: {} } as unknown as ViewerDocument
    const markup = renderToStaticMarkup(createElement(ObjectPlaceholderView, {
      item: { type: 'object-placeholder', kind: 'shape', element: 'hp:line', sourcePath: 'Contents/section0.xml#hp:line:0', flow: 'floating', size: { width: 48740, height: 1 }, label: '도형' },
      document
    }))
    expect(markup).toContain('class="viewer-object-placeholder viewer-object-floating"')
    expect(markup).not.toContain('min-height')
  })
})

describe('자리 표시 문서 안내', () => {
  test('배너는 종류별 개수와 자세히·닫기 버튼을 보여 주고 펼치면 설명을 나열한다', () => {
    const counts = { equation: 2, 'text-box': 1 }
    const collapsed = renderToStaticMarkup(createElement(ObjectPlaceholderBanner, { counts, expanded: false, onToggleDetails: noop, onDismiss: noop }))
    expect(collapsed).toContain('이 문서에는 화면에 완전히 표시되지 않는 개체가 3개 있습니다 (수식 2, 글상자 1)')
    expect(collapsed).toContain('aria-expanded="false">자세히</button>')
    expect(collapsed).toContain('>닫기</button>')
    expect(collapsed).not.toContain('viewer-object-banner-details')
    const expanded = renderToStaticMarkup(createElement(ObjectPlaceholderBanner, { counts, expanded: true, onToggleDetails: noop, onDismiss: noop }))
    expect(expanded).toContain('<li>수식 2개 — 수식 원문(script)을 상자 안에 글자로 보여 줍니다.</li>')
    expect(expanded).toContain('<li>글상자 1개 — 글상자 안 글은 보여 주지만 위치·모양은 원본과 다릅니다.</li>')
    expect(renderToStaticMarkup(createElement(ObjectPlaceholderBanner, { counts: {}, expanded: false, onToggleDetails: noop, onDismiss: noop }))).toBe('')
  })

  test('상태 막대는 자리 표시 개수를 경고 버튼으로 보여 준다', () => {
    const props = {
      hasDocument: true, title: '', pageCount: 1, formatLabel: 'HWPX', editing: null, editingStatusText: null,
      editingStatusClass: '', editingSelectionNotice: null, backgroundError: null, hasEffectiveDocument: true,
      substitutionCount: 0, overflowPages: [], virtualized: false, pdfStatus: null
    }
    expect(renderToStaticMarkup(createElement(ViewerStatusBar, { ...props, objectPlaceholderCount: 3, onShowObjectPlaceholders: noop })))
      .toContain('class="viewer-status-link viewer-status-warn" title="화면에 완전히 표시되지 않는 개체 자세히 보기">표시 못 한 개체 3</button>')
    expect(renderToStaticMarkup(createElement(ViewerStatusBar, { ...props, objectPlaceholderCount: 0 }))).not.toContain('표시 못 한 개체')
  })

  test('PDF 확인 대화상자는 종류별 개수를 나열하고 자리 표시가 없으면 묻지 않는다', async () => {
    const document = await open('ext-pyhwpx-text-box-fields.hwpx')
    const options = pdfObjectPlaceholderConfirmation(countObjectPlaceholders(document))
    expect(options).toMatchObject({
      type: 'warning',
      buttons: ['그래도 내보내기', '취소'],
      defaultId: 0,
      cancelId: 1,
      message: 'PDF에 원본과 다르게 나올 수 있는 개체가 있습니다.'
    })
    expect(options!.detail).toContain('화면에 완전히 표시되지 않는 개체 5개(글상자 5)')
    expect(pdfObjectPlaceholderConfirmation({})).toBeUndefined()
    expect(pdfObjectPlaceholderConfirmation({ equation: -1, nope: 3 })).toBeUndefined()
    expect(pdfObjectPlaceholderConfirmation('equation')).toBeUndefined()
  })
})
