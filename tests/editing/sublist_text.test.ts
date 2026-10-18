import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { paragraphFootnotes, ViewerDocument, ViewerNote, ViewerNoteList } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { editingCapabilities, listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planMergeParagraph, planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { assertReplayableTransaction } from '../../src/core/editing/replay_guard'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { applyCharacterStyleCommand, applyParagraphStyleCommand } from '../../src/core/editing/style_patch'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { applyEditTransaction, EditTransaction } from '../../src/core/editing/transaction'
import { resolvePageDecorations } from '../../src/core/layout/page_decorations'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ViewerProjectionCache } from '../../src/core/parser/viewer_projection'
import { createEditScopeHwpx, createSyntheticHwpx, EDIT_SCOPE_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

function caret(textNodeId: string, offset = 0, focusOffset = offset): EditorSelection {
  return createEditorSelection(sectionPath, textNodeId, offset, focusOffset)
}

function typing(source: HwpxSourcePackage, textNodeId: string, offset: number, insert: string, timestamp = 1): EditTransaction {
  return {
    id: `type-${timestamp}`,
    baseRevision: source.revision,
    commands: [{ type: 'replace-text', sectionPath, textNodeId, from: offset, to: offset, insert }],
    selectionBefore: caret(textNodeId, offset),
    selectionAfter: caret(textNodeId, offset + insert.length),
    inputType: 'insertText',
    timestamp
  }
}

function anchorOf(source: HwpxSourcePackage, text: string) {
  const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === text)
  if (!anchor) throw new Error(`anchor 없음: ${text}`)
  return anchor
}

/** 쪽 아래에 그리는 각주(본문 번호 표시에 든 본문)와 구역 끝 미주 목록의 미주. 각주를 먼저 둔다. */
function documentNotes(document: ViewerDocument): ViewerNote[] {
  const blocks = document.sections[0].blocks
  return [
    ...blocks.flatMap(paragraphFootnotes),
    ...blocks.flatMap((block) => block.content.filter((item): item is ViewerNoteList => item.type === 'note-list')).flatMap((list) => list.notes)
  ]
}

/** edit-scope fixture의 section XML을 바꾼 사본. */
function withSection(directory: string, name: string, edit: (xml: string) => string): string {
  const source = new AdmZip(createEditScopeHwpx(directory, `${name}-base.hwpx`))
  const zip = new AdmZip(undefined, { noSort: true })
  for (const entry of source.getEntries()) {
    const data = entry.entryName === sectionPath ? Buffer.from(edit(entry.getData().toString('utf8'))) : entry.getData()
    const added = zip.addFile(entry.entryName, data)
    if (entry.entryName === 'mimetype') added.header.method = 0
  }
  const path = join(directory, `${name}.hwpx`)
  zip.writeZip(path)
  return path
}

describe('각주·미주 본문 글자 편집', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-note-text-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('쪽 아래 각주와 구역 끝 미주 본문에 anchor와 NOTE_TEXT context가 있고 글자 입력만 연다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory))
    const document = await decodeViewerDocument(source)
    const footnote = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteBody)
    const endnote = anchorOf(source, EDIT_SCOPE_TEXTS.endnoteBody)
    expect(documentNotes(document).map((note) => [note.kind, note.marker, note.paragraphs[0].content])).toEqual([
      ['footnote', '1)', [{ type: 'text', text: EDIT_SCOPE_TEXTS.footnoteBody, charStyleId: '0', sourceAnchor: { sectionPath, textNodeId: footnote.textNodeId } }]],
      ['endnote', '1)', [{ type: 'text', text: EDIT_SCOPE_TEXTS.endnoteBody, charStyleId: '0', sourceAnchor: { sectionPath, textNodeId: endnote.textNodeId } }]]
    ])
    const contexts = listEditingAnchorContexts(document).filter((context) => context.structure === 'NOTE_TEXT')
    expect(contexts.map((context) => context.textNodeId)).toEqual([footnote.textNodeId, endnote.textNodeId])
    expect(contexts[0].rangeScope).not.toBe(contexts[1].rangeScope)
    const capability = editingCapabilities(document, caret(footnote.textNodeId, 2))
    expect(capability.text).toEqual({ available: true })
    expect(capability.characterStyle).toEqual({ available: false, reason: 'SUBLIST_TEXT' })
    expect(capability.paragraphStyle).toEqual({ available: false, reason: 'SUBLIST_TEXT' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'SUBLIST_TEXT' })
    expect(capability.cellStyle.available).toBe(false)
    expect(capability.focus?.structureGate).toEqual({ split: 'SUBLIST_TEXT', mergePrevious: 'SUBLIST_TEXT', mergeNext: 'SUBLIST_TEXT' })
    // 본문과 각주를 함께 고른 선택은 서로 다른 구조다.
    const lead = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteLead)
    expect(editingCapabilities(document, {
      sectionPath, anchorTextNodeId: lead.textNodeId, anchorOffset: 0, focusTextNodeId: footnote.textNodeId, focusOffset: 1
    }).selection).toEqual({ available: false, reason: 'CROSS_STRUCTURE_SELECTION' })
  })

  test('각주 본문 입력은 hp:t만 고치고 번호(autoNum)·본문 위치 control은 byte 그대로이며 undo·redo가 정확하다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'note-edit.hwpx'))
    const original = source.readEntry(sectionPath).toString('utf8')
    const footnote = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteBody)
    const history = new HwpxEditHistory(source)
    history.commit(typing(source, footnote.textNodeId, 2, '을 고친'))
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toBe(original.replace(`<hp:t>${EDIT_SCOPE_TEXTS.footnoteBody}</hp:t>`, '<hp:t>각주을 고친 본문</hp:t>'))
    const projected = await decodeViewerDocument(history.package)
    const notes = documentNotes(projected)
    expect(notes.map((note) => [note.kind, note.marker, note.sourcePath])).toEqual(
      documentNotes(await decodeViewerDocument(source)).map((note) => [note.kind, note.marker, note.sourcePath])
    )
    expect(notes[0].paragraphs[0].content).toMatchObject([{ text: '각주을 고친 본문' }])
    // 본문 쪽 각주 번호 표시도 그대로다.
    const marker = projected.sections[0].blocks[1].content.find((item) => item.type === 'object-placeholder')
    expect(marker).toMatchObject({ kind: 'footnote', marker: '1)' })
    history.undo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(original)
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
  })

  test('각주·미주 문단은 문단 나눔·병합·글자/문단 모양을 편집 코어에서도 거부한다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'note-reject.hwpx'))
    const footnote = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteBody)
    expect(() => planSplitParagraph(source, caret(footnote.textNodeId, 1))).toThrow(HwpxEditConflictError)
    expect(() => planMergeParagraph(source, caret(footnote.textNodeId, 0), 'previous')).toThrow(HwpxEditConflictError)
    expect(() => applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: footnote.textNodeId, bold: true }))
      .toThrow(HwpxEditConflictError)
    expect(() => applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: footnote.textNodeId, align: 'CENTER' }))
      .toThrow(HwpxEditConflictError)
  })

  test('각주가 든 본문 문단의 여러 run 범위 치환은 사이의 각주 본문 글자를 지우지 않는다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'note-range.hwpx'))
    const original = source.readEntry(sectionPath).toString('utf8')
    const lead = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteLead)
    const footnote = anchorOf(source, EDIT_SCOPE_TEXTS.footnoteBody)
    // 각주 뒤 빈 <hp:t/>는 문서 순서로 각주 본문 hp:t 다음 anchor다.
    const trailing = listHwpxTextAnchors(source, sectionPath).find((anchor) => anchor.ordinal === footnote.ordinal + 1)!
    expect(trailing.text).toBe('')
    const selection: EditorSelection = { sectionPath, anchorTextNodeId: lead.textNodeId, anchorOffset: 2, focusTextNodeId: trailing.textNodeId, focusOffset: 0 }
    const plan = planReplaceSelection(source, selection, '바뀜')
    expect(plan.affectedTextNodeIds).toEqual([lead.textNodeId, trailing.textNodeId])
    const result = applyEditTransaction(source, {
      id: 'range', baseRevision: source.revision, commands: plan.commands, selectionBefore: selection, selectionAfter: plan.selectionAfter, inputType: 'insertText', timestamp: 1
    })
    const edited = result.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain(`<hp:t>각주바뀜</hp:t>`)
    expect(edited).toContain(`<hp:t>${EDIT_SCOPE_TEXTS.footnoteBody}</hp:t>`)
    expect(applyEditTransaction(result.package, result.inverse!).package.readEntry(sectionPath).toString('utf8')).toBe(original)
  })

  test('글자 칸 없는 각주 문단(자동 번호만)에 첫 글자를 넣으면 번호 control 뒤에 hp:t를 만든다', async () => {
    const path = withSection(directory, 'note-empty', (xml) => xml.replace(`<hp:t>${EDIT_SCOPE_TEXTS.footnoteBody}</hp:t>`, ''))
    const source = await HwpxSourcePackage.open(path)
    const original = source.readEntry(sectionPath).toString('utf8')
    const document = await decodeViewerDocument(source)
    const empty = listEditingAnchorContexts(document).find((context) => context.structure === 'NOTE_TEXT' && context.emptyParagraph)!
    expect(empty).toBeDefined()
    const result = applyEditTransaction(source, typing(source, empty.textNodeId, 0, '새 각주'))
    expect(result.package.readEntry(sectionPath).toString('utf8')).toContain('</hp:autoNum></hp:ctrl><hp:t>새 각주</hp:t></hp:run>')
    expect(result.selectionAfter.focusTextNodeId).toMatch(/#hp:t:\d+$/)
    expect(applyEditTransaction(result.package, result.inverse!).package.readEntry(sectionPath).toString('utf8')).toBe(original)
  })

  test('글상자 안 각주 본문처럼 읽기 전용 문단 안의 각주는 anchor를 붙이지 않는다', async () => {
    const path = withSection(directory, 'note-in-box', (xml) => xml.replace(
      `<hp:t>${EDIT_SCOPE_TEXTS.afterTable}</hp:t>`,
      `<hp:rect id="1"><hp:sz width="1000" height="1000"/><hp:drawText><hp:subList><hp:p><hp:run><hp:t>상자</hp:t><hp:ctrl><hp:footNote number="2"><hp:subList><hp:p><hp:run><hp:t>상자 각주</hp:t></hp:run></hp:p></hp:subList></hp:footNote></hp:ctrl></hp:run></hp:p></hp:subList></hp:drawText></hp:rect>`
    ))
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(path))
    const boxNote = documentNotes(document).find((note) => note.paragraphs[0]?.content.some((item) => item.type === 'text' && item.text === '상자 각주'))!
    expect(boxNote.paragraphs[0].content).toMatchObject([{ text: '상자 각주', sourceAnchor: undefined }])
    expect(listEditingAnchorContexts(document).filter((context) => context.structure === 'NOTE_TEXT')).toHaveLength(2)
  })
})

describe('머리말·꼬리말 글자 편집', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-header-text-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('글자만 든 머리말·꼬리말 문단에 HEADER_FOOTER_TEXT context를 열고 그림 문단·머리말 안 표는 읽기 전용으로 둔다', async () => {
    const source = await HwpxSourcePackage.open(createSyntheticHwpx(directory))
    const document = await decodeViewerDocument(source)
    const contexts = listEditingAnchorContexts(document).filter((context) => context.structure === 'HEADER_FOOTER_TEXT')
    // 공개 머리말·짝수 쪽 머리말·꼬리말 목록 두 문단·둘째 구역 머리말. 그림이 든 꼬리말 첫 문단은 빠진다.
    expect(contexts.map((context) => context.text)).toEqual(['공개 머리말', '짝수 쪽 머리말', '첫 항목', '둘째 항목', '둘째 구역 머리말'])
    expect(contexts.map((context) => context.sectionPath)).toEqual([sectionPath, sectionPath, sectionPath, sectionPath, 'Contents/section1.xml'])
    const capability = editingCapabilities(document, caret(contexts[0].textNodeId, 1))
    expect(capability.text).toEqual({ available: true })
    expect(capability.characterStyle).toEqual({ available: false, reason: 'SUBLIST_TEXT' })
    expect(capability.paragraphStyle).toEqual({ available: false, reason: 'SUBLIST_TEXT' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'SUBLIST_TEXT' })

    const tableHeader = withSection(directory, 'header-table', (xml) => xml.replace(
      `<hp:t>${EDIT_SCOPE_TEXTS.header}</hp:t>`,
      `<hp:tbl id="9" rowCnt="1" colCnt="1"><hp:sz width="1000" height="1000"/><hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="1000" height="1000"/><hp:subList><hp:p><hp:run><hp:t>머리말 표 글</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl>`
    ))
    const tableDocument = await decodeViewerDocument(await HwpxSourcePackage.open(tableHeader))
    expect(listEditingAnchorContexts(tableDocument).some((context) => context.text === '머리말 표 글')).toBe(false)
    expect(listEditingAnchorContexts(tableDocument).filter((context) => context.structure === 'HEADER_FOOTER_TEXT').map((context) => context.text))
      .toEqual([EDIT_SCOPE_TEXTS.footer])
  })

  test('머리말 입력은 그 section만 다시 해석하고, 같은 머리말을 쓰는 모든 쪽 decoration이 새 글자를 쓴다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'header-edit.hwpx'))
    const original = source.readEntry(sectionPath).toString('utf8')
    const header = anchorOf(source, EDIT_SCOPE_TEXTS.header)
    const { cache, result } = await ViewerProjectionCache.open(source)
    const applied = applyEditTransaction(source, typing(source, header.textNodeId, EDIT_SCOPE_TEXTS.header.length, ' 고침'))
    expect(applied.package.readEntry(sectionPath).toString('utf8')).toBe(
      original.replace(`<hp:t>${EDIT_SCOPE_TEXTS.header}</hp:t>`, `<hp:t>${EDIT_SCOPE_TEXTS.header} 고침</hp:t>`)
    )
    const updated = await cache.update(applied.package)
    expect(updated.patch).toBeDefined()
    expect(updated.decodedSections).toBe(1)
    const document = applyViewerDocumentPatch(result.document, updated.patch!)
    expect(document).toStrictEqual(await decodeViewerDocument(applied.package))
    const pages = paginateViewerDocument(document)
    expect(pages.length).toBe(2)
    const decorations = resolvePageDecorations(document, pages)
    expect(decorations.map((decoration) => decoration.header?.paragraphs[0].content)).toEqual([
      [expect.objectContaining({ text: `${EDIT_SCOPE_TEXTS.header} 고침`, sourceAnchor: { sectionPath, textNodeId: header.textNodeId } })],
      [expect.objectContaining({ text: `${EDIT_SCOPE_TEXTS.header} 고침`, sourceAnchor: { sectionPath, textNodeId: header.textNodeId } })]
    ])
    expect(applyEditTransaction(applied.package, applied.inverse!).package.readEntry(sectionPath).toString('utf8')).toBe(original)
  })

  test('머리말 문단 안 여러 run 범위 치환은 text command로 처리하고 문단을 넘는 범위·문단 나눔은 거부한다', async () => {
    const path = withSection(directory, 'header-runs', (xml) => xml.replace(
      `<hp:run charPrIDRef="0"><hp:t>${EDIT_SCOPE_TEXTS.header}</hp:t></hp:run>`,
      '<hp:run charPrIDRef="0"><hp:t>앞 run</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>뒤 run</hp:t></hp:run>'
    ))
    const source = await HwpxSourcePackage.open(path)
    const first = anchorOf(source, '앞 run')
    const second = anchorOf(source, '뒤 run')
    const selection: EditorSelection = { sectionPath, anchorTextNodeId: first.textNodeId, anchorOffset: 1, focusTextNodeId: second.textNodeId, focusOffset: 1 }
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, selection).text).toEqual({ available: true })
    const plan = planReplaceSelection(source, selection, '-')
    expect(plan.commands.map((command) => command.type)).toEqual(['replace-text', 'replace-text'])
    const edited = applyEditTransaction(source, {
      id: 'header-range', baseRevision: source.revision, commands: plan.commands, selectionBefore: selection, selectionAfter: plan.selectionAfter, inputType: 'insertText', timestamp: 1
    }).package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain('<hp:t>앞-</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t> run</hp:t>')
    // 머리말과 꼬리말을 가로지르는 범위는 문단 범위 계획이 거부한다.
    const footer = anchorOf(source, EDIT_SCOPE_TEXTS.footer)
    expect(() => planReplaceSelection(source, { ...selection, focusTextNodeId: footer.textNodeId, focusOffset: 1 }, '-')).toThrow(HwpxEditConflictError)
    expect(() => planSplitParagraph(source, caret(first.textNodeId, 1))).toThrow(HwpxEditConflictError)
  })

  test('복구 기록 replay 검사는 머리말·각주 글자 command를 받는다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'sublist-replay.hwpx'))
    for (const text of [EDIT_SCOPE_TEXTS.header, EDIT_SCOPE_TEXTS.footer, EDIT_SCOPE_TEXTS.footnoteBody, EDIT_SCOPE_TEXTS.endnoteBody]) {
      expect(() => assertReplayableTransaction(typing(source, anchorOf(source, text).textNodeId, 0, '가'), source)).not.toThrow()
    }
  })
})
