import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { paragraphFootnotes, ViewerDocument } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { editingCapabilities, listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import {
  applyInsertFootnoteCommand,
  planDeleteEndnote,
  planDeleteFootnote,
  planInsertEndnote,
  planInsertFootnote
} from '../../src/core/editing/footnote_patch'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { createSaveLossPolicy } from '../../src/core/editing/loss_policy'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { assertReplayableTransaction } from '../../src/core/editing/replay_guard'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { applyEditTransaction, EditCommand, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ViewerProjectionCache } from '../../src/core/parser/viewer_projection'
import { createNoteEditHwpx, createSublistEditHwpx, NOTE_EDIT_TEXTS, SUBLIST_EDIT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

const section0 = 'Contents/section0.xml'
const section1 = 'Contents/section1.xml'

const caret = (textNodeId: string, offset = 0, focusOffset = offset, sectionPath = section0): EditorSelection =>
  createEditorSelection(sectionPath, textNodeId, offset, focusOffset)

function anchorOf(source: HwpxSourcePackage, text: string, sectionPath = section0) {
  const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === text)
  if (!anchor) throw new Error(`anchor 없음: ${text}`)
  return anchor
}

function transaction(source: HwpxSourcePackage, commands: EditCommand[], before: EditorSelection, after: EditorSelection, inputType = 'insertFootnote'): EditTransaction {
  return { id: `${inputType}-${commands.length}`, baseRevision: source.revision, commands, selectionBefore: before, selectionAfter: after, inputType, timestamp: 1 }
}

const xml = (source: HwpxSourcePackage, path = section0) => source.readEntry(path).toString('utf8')

function footnotes(document: ViewerDocument, sectionIndex = 0) {
  return document.sections[sectionIndex].blocks.flatMap(paragraphFootnotes)
}

const noteText = (paragraphs: { content: Array<{ type: string; text?: string }> }[]) =>
  paragraphs.map((paragraph) => paragraph.content.map((item) => item.type === 'text' ? item.text : '').join(''))

/** sublist 편집 fixture의 section XML을 바꾸거나 section을 더한 사본. */
function variant(directory: string, name: string, edit: (xml: string) => string, extraSection?: string): string {
  const source = new AdmZip(createSublistEditHwpx(directory, `${name}-base.hwpx`))
  const zip = new AdmZip(undefined, { noSort: true })
  for (const entry of source.getEntries()) {
    const data = entry.entryName === section0 ? Buffer.from(edit(entry.getData().toString('utf8'))) : entry.getData()
    const added = zip.addFile(entry.entryName, data)
    if (entry.entryName === 'mimetype') added.header.method = 0
  }
  if (extraSection) zip.addFile(section1, Buffer.from(extraSection))
  const path = join(directory, `${name}.hwpx`)
  zip.writeZip(path)
  return path
}

const AUTO_NUM = (number: number) =>
  `<hp:autoNum num="${number}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum>`

describe('각주 만들기·지우기', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-footnote-patch-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('뒤 문단 caret에 각주를 넣으면 hp:t를 나누고 다음 번호 각주를 만들며 빈 본문 caret으로 옮긴다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory))
    const original = xml(source)
    const lead = anchorOf(source, SUBLIST_EDIT_TEXTS.boxLead)
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, caret(lead.textNodeId, 3)).footnote).toEqual({ available: true })
    const plan = planInsertFootnote(source, caret(lead.textNodeId, 3))
    expect(plan.command).toEqual({ type: 'insert-footnote', sectionPath: section0, textNodeId: lead.textNodeId, offset: 3 })
    expect(plan.selectionAfter).toEqual(caret(`${section0}#hp:t:${lead.ordinal + 1}`, 0))
    const { cache, result: initial } = await ViewerProjectionCache.open(source)
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, [plan.command], caret(lead.textNodeId, 3), plan.selectionAfter))
    const inserted = xml(history.package)
    expect(inserted).toBe(original.replace(
      `<hp:t>${SUBLIST_EDIT_TEXTS.boxLead}</hp:t>`,
      '<hp:t>글상자</hp:t><hp:ctrl><hp:footNote number="2" suffixChar="41" instId="9302"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
      `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:ctrl>${AUTO_NUM(2)}</hp:ctrl><hp:t/></hp:run></hp:p></hp:subList></hp:footNote></hp:ctrl><hp:t>가 놓인 문단</hp:t>`
    ))
    const updated = await cache.update(history.package)
    const projected = applyViewerDocumentPatch(initial.document, updated.patch!)
    expect(projected).toStrictEqual(await decodeViewerDocument(history.package))
    expect(footnotes(projected).map((note) => [note.marker, noteText(note.paragraphs)])).toEqual([
      ['1)', [SUBLIST_EDIT_TEXTS.footnoteBody, SUBLIST_EDIT_TEXTS.footnoteSecond]],
      ['2)', ['']]
    ])
    // 새 각주 본문 빈 caret은 각주 지우기 대상인 NOTE_TEXT anchor다.
    const context = listEditingAnchorContexts(projected).find((candidate) => candidate.textNodeId === plan.selectionAfter.focusTextNodeId)!
    expect(context).toMatchObject({ structure: 'NOTE_TEXT', footnotePath: `${section0}#hp:footNote:1` })
    // 새 각주에 글자를 넣을 수 있다.
    history.commit({ ...transaction(history.package, [{ type: 'replace-text', sectionPath: section0, textNodeId: context.textNodeId, from: 0, to: 0, insert: '새 각주' }], plan.selectionAfter, caret(context.textNodeId, 4), 'insertText') })
    expect(xml(history.package)).toContain(`<hp:ctrl>${AUTO_NUM(2)}</hp:ctrl><hp:t>새 각주</hp:t>`)
    history.undo()
    history.undo()
    expect(xml(history.package)).toBe(original)
    history.redo()
    expect(xml(history.package)).toBe(inserted)
    expect(createSaveLossPolicy(history.package, ['note-structure'])).toMatchObject({ notices: ['PREVIEW_OMITTED', 'NOTE_STRUCTURE_CHANGED'], reviewRecommended: true })
  })

  test('앞 각주보다 먼저 넣으면 새 각주가 1번이고 뒤 각주의 number·autoNum 번호를 올리며 undo가 원래 bytes를 되살린다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'insert-first.hwpx'))
    const original = xml(source)
    const title = anchorOf(source, SUBLIST_EDIT_TEXTS.title)
    const plan = planInsertFootnote(source, caret(title.textNodeId, SUBLIST_EDIT_TEXTS.title.length))
    const result = applyEditTransaction(source, transaction(source, [plan.command], caret(title.textNodeId, SUBLIST_EDIT_TEXTS.title.length), plan.selectionAfter))
    const edited = xml(result.package)
    // 글자 끝에 넣으면 뒤 조각은 한/글처럼 빈 `<hp:t/>`이다.
    expect(edited).toContain(`<hp:t>${SUBLIST_EDIT_TEXTS.title}</hp:t><hp:ctrl><hp:footNote number="1" suffixChar="41" instId="9302">`)
    expect(edited).toContain('</hp:footNote></hp:ctrl><hp:t/></hp:run>')
    expect(edited).toContain(`<hp:footNote number="2" suffixChar="41" instId="9301">`)
    expect(edited).toContain(`<hp:ctrl>${AUTO_NUM(2)}</hp:ctrl><hp:t>${SUBLIST_EDIT_TEXTS.footnoteBody}</hp:t>`)
    const notes = footnotes(await decodeViewerDocument(result.package))
    expect(notes.map((note) => [note.marker, noteText(note.paragraphs)[0]])).toEqual([['1)', ''], ['2)', SUBLIST_EDIT_TEXTS.footnoteBody]])
    expect(xml(applyEditTransaction(result.package, result.inverse!).package)).toBe(original)
  })

  test('각주 본문 caret에서 각주를 지우면 각주 control만 지우고 뒤 번호를 내리며, caret은 번호 표시가 있던 자리로 간다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'delete.hwpx'))
    const title = anchorOf(source, SUBLIST_EDIT_TEXTS.title)
    // 먼저 앞에 각주를 하나 넣어 각주 두 개를 만든다.
    const insert = planInsertFootnote(source, caret(title.textNodeId, 2))
    const two = applyEditTransaction(source, transaction(source, [insert.command], caret(title.textNodeId, 2), insert.selectionAfter)).package
    const before = xml(two)
    const firstNote = listEditingAnchorContexts(await decodeViewerDocument(two)).find((context) => context.footnotePath === `${section0}#hp:footNote:0`)!
    const plan = planDeleteFootnote(two, caret(firstNote.textNodeId), `${section0}#hp:footNote:0`)
    expect(plan.command).toEqual({ type: 'delete-footnote', sectionPath: section0, textNodeId: firstNote.textNodeId, notePath: `${section0}#hp:footNote:0` })
    // caret은 번호 표시 앞 글자(제목 앞 두 글자) 끝이다.
    expect(plan.selectionAfter).toEqual(caret(title.textNodeId, 2))
    const result = applyEditTransaction(two, transaction(two, [plan.command], caret(firstNote.textNodeId), plan.selectionAfter, 'deleteFootnote'))
    const deleted = xml(result.package)
    expect(deleted).toContain(`<hp:t>하위</hp:t><hp:t> 목록 편집 시험 문서</hp:t>`)
    expect(deleted).toContain(`<hp:footNote number="1" suffixChar="41" instId="9301">`)
    expect(deleted).toContain(`<hp:ctrl>${AUTO_NUM(1)}</hp:ctrl><hp:t>${SUBLIST_EDIT_TEXTS.footnoteBody}</hp:t>`)
    expect(footnotes(await decodeViewerDocument(result.package)).map((note) => note.marker)).toEqual(['1)'])
    expect(xml(applyEditTransaction(result.package, result.inverse!).package)).toBe(before)
    assertReplayableTransaction(transaction(two, [plan.command], caret(firstNote.textNodeId), plan.selectionAfter, 'deleteFootnote'), two)
  })

  test('번호 표시를 품은 본문 범위를 지우면 글자 command 뒤에 각주 지우기 command가 붙고 undo가 각주와 글자를 되살린다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'range-delete.hwpx'))
    const original = xml(source)
    const lead = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteLead)
    const trailing = listHwpxTextAnchors(source, section0).find((anchor) => anchor.ordinal === lead.ordinal + 3)!
    expect(trailing.text).toBe('')
    const selection: EditorSelection = { sectionPath: section0, anchorTextNodeId: lead.textNodeId, anchorOffset: 5, focusTextNodeId: trailing.textNodeId, focusOffset: 0 }
    const plan = planReplaceSelection(source, selection, '')
    expect(plan.commands.map((command) => command.type)).toEqual(['replace-text', 'replace-text', 'delete-footnote'])
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, [...plan.commands], selection, plan.selectionAfter, 'deleteContentBackward'))
    const edited = xml(history.package)
    expect(edited).toContain('<hp:t>각주가 붙</hp:t><hp:t/></hp:run>')
    expect(edited).not.toContain('<hp:footNote')
    expect(footnotes(await decodeViewerDocument(history.package))).toEqual([])
    history.undo()
    expect(xml(history.package)).toBe(original)
    history.redo()
    expect(xml(history.package)).toBe(edited)
  })

  test('이어 매기기 번호는 뒤 구역 각주까지 올리고 내린다', async () => {
    const later = `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>둘째 구역</hp:t><hp:ctrl><hp:footNote number="2" suffixChar="41" instId="7"><hp:subList><hp:p id="0" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:ctrl>${AUTO_NUM(2)}</hp:ctrl><hp:t>둘째 구역 각주</hp:t></hp:run></hp:p></hp:subList></hp:footNote></hp:ctrl><hp:t/></hp:run></hp:p></hs:sec>`
    const source = await HwpxSourcePackage.open(variant(directory, 'continuous', (value) => value, later))
    const originals = [xml(source), xml(source, section1)]
    const lead = anchorOf(source, SUBLIST_EDIT_TEXTS.boxLead)
    const plan = planInsertFootnote(source, caret(lead.textNodeId, 1))
    const result = applyEditTransaction(source, transaction(source, [plan.command], caret(lead.textNodeId, 1), plan.selectionAfter))
    expect(result.lossReport.modifiedEntries).toEqual([section0, section1])
    expect(xml(result.package, section1)).toBe(originals[1].replace('<hp:footNote number="2"', '<hp:footNote number="3"').replace(AUTO_NUM(2), AUTO_NUM(3)))
    const document = await decodeViewerDocument(result.package)
    expect([...footnotes(document, 0), ...footnotes(document, 1)].map((note) => note.marker)).toEqual(['1)', '2)', '3)'])
    const undone = applyEditTransaction(result.package, result.inverse!).package
    expect([xml(undone), xml(undone, section1)]).toEqual(originals)

    // 새로 매기는 뒤 구역에서는 멈춘다.
    const restarting = later.replace('<hp:t>둘째 구역</hp:t>', '<hp:secPr><hp:footNotePr><hp:numbering type="ON_SECTION" newNum="1"/></hp:footNotePr></hp:secPr><hp:t>둘째 구역</hp:t>')
    const separate = await HwpxSourcePackage.open(variant(directory, 'on-section', (value) => value, restarting))
    const separateLead = anchorOf(separate, SUBLIST_EDIT_TEXTS.boxLead)
    const separatePlan = planInsertFootnote(separate, caret(separateLead.textNodeId, 1))
    const separateResult = applyEditTransaction(separate, transaction(separate, [separatePlan.command], caret(separateLead.textNodeId, 1), separatePlan.selectionAfter))
    expect(separateResult.lossReport.modifiedEntries).toEqual([section0])
  })

  test('머리말·꼬리말과 각주·메모 본문, 범위 선택에는 각주·미주를 넣지 않는다(글상자에는 넣는다)', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'scope.hwpx'))
    const document = await decodeViewerDocument(source)
    for (const [text, reason, message] of [
      [SUBLIST_EDIT_TEXTS.header, 'NOTE_IN_HEADER_FOOTER', '머리말·꼬리말에는'],
      [SUBLIST_EDIT_TEXTS.footer, 'NOTE_IN_HEADER_FOOTER', '머리말·꼬리말에는'],
      [SUBLIST_EDIT_TEXTS.footnoteBody, 'FOOTNOTE_POSITION', '본문·표 셀·글상자 문단'],
      [SUBLIST_EDIT_TEXTS.memo, 'FOOTNOTE_POSITION', '본문·표 셀·글상자 문단'],
      // 표가 든 글상자는 읽기 전용(anchor는 있지만 capability context가 없다)이고 코어도 거부한다.
      [SUBLIST_EDIT_TEXTS.objectBoxText, 'STALE_SELECTION', '본문·표 셀·글상자 문단']
    ] as const) {
      const anchor = anchorOf(source, text)
      const capabilities = editingCapabilities(document, caret(anchor.textNodeId, 1))
      expect(capabilities.footnote).toEqual({ available: false, reason })
      expect(capabilities.endnote).toEqual({ available: false, reason })
      expect(() => planInsertFootnote(source, caret(anchor.textNodeId, 1))).toThrow(message)
      expect(() => planInsertEndnote(source, caret(anchor.textNodeId, 1))).toThrow(message)
    }
    const box = anchorOf(source, SUBLIST_EDIT_TEXTS.textBox)
    expect(editingCapabilities(document, caret(box.textNodeId, 1)).footnote).toEqual({ available: true })
    const lead2 = anchorOf(source, SUBLIST_EDIT_TEXTS.boxLead)
    expect(editingCapabilities(document, caret(lead2.textNodeId, 1, 3)).footnote).toEqual({ available: false, reason: 'FOOTNOTE_POSITION' })
    expect(() => planInsertFootnote(source, caret(lead2.textNodeId, 1, 3))).toThrow('caret 위치에만')
  })

  test('미주를 넣으면 미주 모양 번호로 만들고 뒤 미주 번호를 올리며, 미주 본문 caret에서 지우면 번호를 내린다', async () => {
    const source = await HwpxSourcePackage.open(createNoteEditHwpx(directory, 'endnote.hwpx'))
    const original = xml(source)
    const title = anchorOf(source, NOTE_EDIT_TEXTS.title)
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, caret(title.textNodeId, 2)).endnote).toEqual({ available: true })
    const plan = planInsertEndnote(source, caret(title.textNodeId, 2))
    expect(plan.command).toEqual({ type: 'insert-endnote', sectionPath: section0, textNodeId: title.textNodeId, offset: 2 })
    const { cache, result: initial } = await ViewerProjectionCache.open(source)
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, [plan.command], caret(title.textNodeId, 2), plan.selectionAfter, 'insertEndnote'))
    const inserted = xml(history.package)
    const endnoteNum = (number: number) => `<hp:autoNum num="${number}" numType="ENDNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum>`
    expect(inserted).toContain('<hp:t>각주</hp:t><hp:ctrl><hp:endNote number="1" suffixChar="41" instId="9704">')
    expect(inserted).toContain(`<hp:ctrl>${endnoteNum(1)}</hp:ctrl><hp:t/></hp:run></hp:p></hp:subList></hp:endNote></hp:ctrl><hp:t> 미주 넣기 시험 문서</hp:t>`)
    // 기존 미주는 2번이 되고 각주 번호는 그대로다.
    expect(inserted).toContain('<hp:endNote number="2" suffixChar="41" instId="9702">')
    expect(inserted).toContain(`<hp:ctrl>${endnoteNum(2)}</hp:ctrl><hp:t>${NOTE_EDIT_TEXTS.endnoteBody}</hp:t>`)
    expect(inserted).toContain('<hp:footNote number="1" suffixChar="41" instId="9701">')
    // 증분 projection이 전체 해석과 같고, 구역 끝 미주 목록에 새 미주가 먼저 온다.
    const projected = applyViewerDocumentPatch(initial.document, (await cache.update(history.package)).patch!)
    expect(projected).toStrictEqual(await decodeViewerDocument(history.package))
    const endnotes = projected.sections[0].blocks.flatMap((block) => block.content.flatMap((item) => item.type === 'note-list' ? item.notes : []))
    expect(endnotes.map((note) => [note.marker, noteText(note.paragraphs)])).toEqual([['1)', ['']], ['2)', [NOTE_EDIT_TEXTS.endnoteBody]]])
    // 새 미주 본문 caret은 미주 지우기 대상이고 각주 지우기 대상이 아니다.
    const context = listEditingAnchorContexts(projected).find((candidate) => candidate.textNodeId === plan.selectionAfter.focusTextNodeId)!
    expect(context).toMatchObject({ structure: 'NOTE_TEXT', endnotePath: `${section0}#hp:endNote:0` })
    expect(context.footnotePath).toBeUndefined()
    // 기존 미주(둘째)를 지우면 새 미주만 남고, 실행 취소가 원래 bytes를 되살린다.
    const old = anchorOf(history.package, NOTE_EDIT_TEXTS.endnoteBody)
    const remove = planDeleteEndnote(history.package, caret(old.textNodeId, 1), `${section0}#hp:endNote:1`)
    expect(remove.command).toEqual({ type: 'delete-endnote', sectionPath: section0, textNodeId: old.textNodeId, notePath: `${section0}#hp:endNote:1` })
    assertReplayableTransaction(transaction(history.package, [remove.command], caret(old.textNodeId, 1), remove.selectionAfter, 'deleteEndnote'), history.package)
    history.setSelection(caret(old.textNodeId, 1))
    history.commit(transaction(history.package, [remove.command], caret(old.textNodeId, 1), remove.selectionAfter, 'deleteEndnote'))
    expect(xml(history.package)).not.toContain(NOTE_EDIT_TEXTS.endnoteBody)
    expect(xml(history.package).match(/<hp:endNote /g)).toHaveLength(1)
    history.undo()
    expect(xml(history.package)).toBe(inserted)
    history.undo()
    expect(xml(history.package)).toBe(original)
    history.redo()
    expect(xml(history.package)).toBe(inserted)
    // 각주 경로로 미주를 지우는 계획은 없다.
    expect(() => planDeleteFootnote(history.package, caret(old.textNodeId, 1), `${section0}#hp:endNote:1`)).toThrow('지울 각주를 찾을 수 없습니다')
  })

  test('표 셀·글상자 문단 caret에 각주를 넣으면 그 칸 hp:t를 나누고 문서 순서로 번호를 매긴다', async () => {
    const source = await HwpxSourcePackage.open(createNoteEditHwpx(directory, 'cell-box.hwpx'))
    const original = xml(source)
    const document = await decodeViewerDocument(source)
    const cell = anchorOf(source, NOTE_EDIT_TEXTS.cellRight)
    const box = anchorOf(source, NOTE_EDIT_TEXTS.textBox)
    expect(editingCapabilities(document, caret(cell.textNodeId, 2))).toMatchObject({ footnote: { available: true }, endnote: { available: true }, focus: { structure: 'TABLE_CELL_TEXT' } })
    expect(editingCapabilities(document, caret(box.textNodeId, 2))).toMatchObject({ footnote: { available: true }, endnote: { available: true }, focus: { structure: 'TEXT_BOX_TEXT' } })

    const history = new HwpxEditHistory(source)
    const cellPlan = planInsertFootnote(source, caret(cell.textNodeId, 2))
    history.commit(transaction(source, [cellPlan.command], caret(cell.textNodeId, 2), cellPlan.selectionAfter))
    const cellXml = xml(history.package)
    // 셀 문단 안에 각주가 들고, 문서 순서로 둘째(본문 각주 다음) 번호다. 둘째 쪽 각주는 3번이 된다.
    expect(cellXml).toContain('<hp:t>표 </hp:t><hp:ctrl><hp:footNote number="2" suffixChar="41" instId="9704">')
    expect(cellXml).toContain('</hp:footNote></hp:ctrl><hp:t>셀 오른쪽 글</hp:t></hp:run>')
    expect(cellXml).toContain('<hp:footNote number="3" suffixChar="41" instId="9703">')
    const afterCell = await decodeViewerDocument(history.package)
    const notes = afterCell.sections[0].blocks.flatMap(paragraphFootnotes)
    expect(notes.map((note) => [note.marker, noteText(note.paragraphs)[0]])).toEqual([
      ['1)', NOTE_EDIT_TEXTS.footnoteBody], ['2)', ''], ['3)', NOTE_EDIT_TEXTS.secondFootnote]
    ])
    const cellNote = listEditingAnchorContexts(afterCell).find((context) => context.textNodeId === cellPlan.selectionAfter.focusTextNodeId)!
    expect(cellNote).toMatchObject({ structure: 'NOTE_TEXT', footnotePath: `${section0}#hp:footNote:1` })
    // 셀 글자는 여전히 TABLE_CELL_TEXT로 고칠 수 있다.
    expect(listEditingAnchorContexts(afterCell).find((context) => context.text === '표 ')).toMatchObject({ structure: 'TABLE_CELL_TEXT' })

    // 글상자 caret에 각주: 글상자는 글자만 든 각주를 품어도 계속 편집할 수 있다.
    const boxNow = anchorOf(history.package, NOTE_EDIT_TEXTS.textBox)
    const boxPlan = planInsertFootnote(history.package, caret(boxNow.textNodeId, 3))
    history.setSelection(caret(boxNow.textNodeId, 3))
    history.commit(transaction(history.package, [boxPlan.command], caret(boxNow.textNodeId, 3), boxPlan.selectionAfter))
    const boxXml = xml(history.package)
    expect(boxXml).toContain('<hp:t>글상자</hp:t><hp:ctrl><hp:footNote number="3" suffixChar="41" instId="9705">')
    const afterBox = await decodeViewerDocument(history.package)
    const boxContexts = listEditingAnchorContexts(afterBox)
    expect(boxContexts.find((context) => context.text === '글상자')).toMatchObject({ structure: 'TEXT_BOX_TEXT' })
    expect(boxContexts.find((context) => context.textNodeId === boxPlan.selectionAfter.focusTextNodeId)).toMatchObject({ structure: 'NOTE_TEXT', footnotePath: `${section0}#hp:footNote:2` })
    expect(afterBox.sections[0].blocks.flatMap(paragraphFootnotes).map((note) => note.marker)).toEqual(['1)', '2)', '3)', '4)'])
    // 글상자 안 각주 본문에 입력하고, 그 각주를 지우고, 모두 되돌린다.
    const typed = transaction(history.package, [{ type: 'replace-text', sectionPath: section0, textNodeId: boxPlan.selectionAfter.focusTextNodeId, from: 0, to: 0, insert: '상자 각주' }], boxPlan.selectionAfter, caret(boxPlan.selectionAfter.focusTextNodeId, 5), 'insertText')
    history.commit(typed)
    expect(xml(history.package)).toContain('</hp:autoNum></hp:ctrl><hp:t>상자 각주</hp:t></hp:run>')
    const removeBox = planDeleteFootnote(history.package, caret(boxPlan.selectionAfter.focusTextNodeId, 1), `${section0}#hp:footNote:2`)
    history.setSelection(caret(boxPlan.selectionAfter.focusTextNodeId, 1))
    expect(removeBox.selectionAfter).toEqual(caret(boxNow.textNodeId, 3))
    history.commit(transaction(history.package, [removeBox.command], caret(boxPlan.selectionAfter.focusTextNodeId, 1), removeBox.selectionAfter, 'deleteFootnote'))
    expect(xml(history.package)).toContain(`<hp:t>글상자</hp:t><hp:t> 안 글</hp:t>`)
    expect(xml(history.package)).toContain('<hp:footNote number="3" suffixChar="41" instId="9703">')
    while (history.canUndo) history.undo()
    expect(xml(history.package)).toBe(original)
    while (history.canRedo) history.redo()
    expect(xml(history.package).match(/<hp:footNote /g)).toHaveLength(3)
  })

  test('번호 표시를 품은 표 셀 범위를 지우면 그 셀의 각주·미주를 함께 지운다', async () => {
    const source = await HwpxSourcePackage.open(createNoteEditHwpx(directory, 'cell-range.hwpx'))
    const cell = anchorOf(source, NOTE_EDIT_TEXTS.cellLeft)
    const withFootnote = applyEditTransaction(source, transaction(source, [planInsertFootnote(source, caret(cell.textNodeId, 2)).command], caret(cell.textNodeId, 2), caret(cell.textNodeId, 2))).package
    const left = anchorOf(withFootnote, '표 ')
    const withBoth = applyEditTransaction(withFootnote, transaction(withFootnote, [planInsertEndnote(withFootnote, caret(left.textNodeId, 1)).command], caret(left.textNodeId, 1), caret(left.textNodeId, 1))).package
    const start = anchorOf(withBoth, '표')
    const end = anchorOf(withBoth, '셀 왼쪽 글')
    const selection: EditorSelection = { sectionPath: section0, anchorTextNodeId: start.textNodeId, anchorOffset: 0, focusTextNodeId: end.textNodeId, focusOffset: 1 }
    const plan = planReplaceSelection(withBoth, selection, '')
    expect(plan.commands.map((command) => command.type)).toEqual(['replace-text', 'replace-text', 'replace-text', 'delete-footnote', 'delete-endnote'])
    const result = applyEditTransaction(withBoth, transaction(withBoth, [...plan.commands], selection, plan.selectionAfter, 'deleteContentBackward'))
    expect(xml(result.package).match(/<hp:footNote /g)).toHaveLength(2)
    expect(xml(result.package).match(/<hp:endNote /g)).toHaveLength(1)
    expect(xml(applyEditTransaction(result.package, result.inverse!).package)).toBe(xml(withBoth))
  })

  test('쪽마다 새로 매기는 각주 구역은 새 각주에 앞 각주 번호 + 1을 쓰고 다른 각주 번호는 그대로 둔다', async () => {
    const source = await HwpxSourcePackage.open(createNoteEditHwpx(directory, 'on-page.hwpx', { numbering: 'ON_PAGE' }))
    const original = xml(source)
    const lead = anchorOf(source, NOTE_EDIT_TEXTS.title)
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, caret(lead.textNodeId, 1)).footnote).toEqual({ available: true })
    const plan = planInsertFootnote(source, caret(lead.textNodeId, 1))
    const result = applyEditTransaction(source, transaction(source, [plan.command], caret(lead.textNodeId, 1), plan.selectionAfter))
    const edited = xml(result.package)
    // 앞 각주가 없으므로 시작 번호(1)다. 뒤 각주의 저장 번호(1·2)는 바꾸지 않는다(쪽 배치 뒤 viewer·한/글이 다시 매긴다).
    expect(edited).toContain('<hp:t>각</hp:t><hp:ctrl><hp:footNote number="1" suffixChar="41" instId="9704">')
    expect(edited).toContain('<hp:footNote number="1" suffixChar="41" instId="9701">')
    expect(edited).toContain('<hp:footNote number="2" suffixChar="41" instId="9703">')
    expect(result.inverse!.commands).toMatchObject([{ type: 'restore-footnote', numbers: [] }])
    expect(xml(applyEditTransaction(result.package, result.inverse!).package)).toBe(original)
    // 지우기도 다른 각주 번호를 바꾸지 않는다.
    const second = anchorOf(source, NOTE_EDIT_TEXTS.secondFootnote)
    const remove = planDeleteFootnote(source, caret(second.textNodeId, 1), `${section0}#hp:footNote:1`)
    const removed = applyEditTransaction(source, transaction(source, [remove.command], caret(second.textNodeId, 1), remove.selectionAfter, 'deleteFootnote'))
    expect(xml(removed.package)).toBe(original.replace(/<hp:ctrl><hp:footNote number="2"[\s\S]*?<\/hp:footNote><\/hp:ctrl>/, ''))
    expect(applyInsertFootnoteCommand(source, { type: 'insert-footnote', sectionPath: section0, textNodeId: lead.textNodeId, offset: 1 }).changed).toBe(true)
  })

  test('복구 기록 replay 검사는 각주·미주 command 모양을 확인하고 inverse 전용 restore-footnote는 받지 않는다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'replay.hwpx'))
    const lead = anchorOf(source, SUBLIST_EDIT_TEXTS.boxLead)
    const plan = planInsertFootnote(source, caret(lead.textNodeId, 1))
    const valid = transaction(source, [plan.command], caret(lead.textNodeId, 1), plan.selectionAfter)
    expect(() => assertReplayableTransaction(valid, source)).not.toThrow()
    const invalid: EditCommand[] = [
      { ...plan.command, offset: -1 },
      { ...plan.command, textNodeId: `${section0}#hp:p:3:empty` },
      { type: 'delete-footnote', sectionPath: section0, textNodeId: lead.textNodeId, notePath: `${section1}#hp:footNote:0` },
      { type: 'delete-footnote', sectionPath: section0, textNodeId: lead.textNodeId, notePath: `${section0}#hp:endNote:0` }
    ]
    invalid.push(
      { type: 'insert-endnote', sectionPath: section0, textNodeId: `${section0}#hp:p:3:empty`, offset: 0 },
      { type: 'delete-endnote', sectionPath: section0, textNodeId: lead.textNodeId, notePath: `${section0}#hp:footNote:0` },
      { type: 'delete-endnote', sectionPath: section0, textNodeId: lead.textNodeId, notePath: `${section0}#hp:endNote:x` }
    )
    for (const command of invalid) {
      expect(() => assertReplayableTransaction({ ...valid, commands: [command] }, source)).toThrow('각주·미주 command 형식')
    }
    expect(() => assertReplayableTransaction({ ...valid, commands: [{ type: 'insert-endnote', sectionPath: section0, textNodeId: lead.textNodeId, offset: 1 }] }, source)).not.toThrow()
    expect(() => assertReplayableTransaction({ ...valid, commands: [{ type: 'delete-endnote', sectionPath: section0, textNodeId: lead.textNodeId, notePath: `${section0}#hp:endNote:0` }] }, source)).not.toThrow()
    const result = applyEditTransaction(source, valid)
    expect(() => assertReplayableTransaction({ ...valid, commands: result.inverse!.commands }, source)).toThrow('편집이 만들지 않는 command')
  })
})
