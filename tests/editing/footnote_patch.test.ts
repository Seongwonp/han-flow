import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { paragraphFootnotes, ViewerDocument } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { editingCapabilities, listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import { applyInsertFootnoteCommand, planDeleteFootnote, planInsertFootnote } from '../../src/core/editing/footnote_patch'
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
import { createSublistEditHwpx, SUBLIST_EDIT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

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

  test('쪽마다 새로 매기는 각주 번호와 본문 밖 위치·범위 선택에는 각주를 넣지 않는다', async () => {
    const onPage = await HwpxSourcePackage.open(variant(directory, 'on-page', (value) => value.replace(
      '<hp:margin left="5669" right="5669" top="5669" bottom="5669" header="2835" footer="2835"/></hp:pagePr>',
      '<hp:margin left="5669" right="5669" top="5669" bottom="5669" header="2835" footer="2835"/></hp:pagePr><hp:footNotePr><hp:numbering type="ON_PAGE" newNum="1"/></hp:footNotePr>'
    )))
    const lead = anchorOf(onPage, SUBLIST_EDIT_TEXTS.boxLead)
    expect(() => planInsertFootnote(onPage, caret(lead.textNodeId, 1))).toThrow('쪽마다 새로 매기는 각주 번호')
    expect(() => applyInsertFootnoteCommand(onPage, { type: 'insert-footnote', sectionPath: section0, textNodeId: lead.textNodeId, offset: 1 })).toThrow(HwpxEditConflictError)

    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'scope.hwpx'))
    const document = await decodeViewerDocument(source)
    for (const text of [SUBLIST_EDIT_TEXTS.header, SUBLIST_EDIT_TEXTS.textBox, SUBLIST_EDIT_TEXTS.footnoteBody, SUBLIST_EDIT_TEXTS.memo]) {
      const anchor = anchorOf(source, text)
      expect(editingCapabilities(document, caret(anchor.textNodeId, 1)).footnote).toEqual({ available: false, reason: 'FOOTNOTE_POSITION' })
      expect(() => planInsertFootnote(source, caret(anchor.textNodeId, 1))).toThrow(HwpxEditConflictError)
    }
    const lead2 = anchorOf(source, SUBLIST_EDIT_TEXTS.boxLead)
    expect(editingCapabilities(document, caret(lead2.textNodeId, 1, 3)).footnote).toEqual({ available: false, reason: 'FOOTNOTE_POSITION' })
    expect(() => planInsertFootnote(source, caret(lead2.textNodeId, 1, 3))).toThrow('caret 위치에만')
  })

  test('복구 기록 replay 검사는 각주 command 모양을 확인하고 inverse 전용 restore-footnote는 받지 않는다', async () => {
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
    for (const command of invalid) {
      expect(() => assertReplayableTransaction({ ...valid, commands: [command] }, source)).toThrow('각주 command 형식')
    }
    const result = applyEditTransaction(source, valid)
    expect(() => assertReplayableTransaction({ ...valid, commands: result.inverse!.commands }, source)).toThrow('편집이 만들지 않는 command')
  })
})
