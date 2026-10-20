import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ViewerDocument, ViewerObjectPlaceholder, ViewerParagraph, paragraphFootnotes } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { editingCapabilities, EditingStructure, listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planMergeParagraph, planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { assertReplayableTransaction } from '../../src/core/editing/replay_guard'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { applyCharacterStyleCommand, applyParagraphStyleCommand } from '../../src/core/editing/style_patch'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { applyEditTransaction, EditCommand, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ViewerProjectionCache } from '../../src/core/parser/viewer_projection'
import { createSublistEditHwpx, SUBLIST_EDIT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

const caret = (textNodeId: string, offset = 0, focusOffset = offset): EditorSelection =>
  createEditorSelection(sectionPath, textNodeId, offset, focusOffset)

function anchorOf(source: HwpxSourcePackage, text: string) {
  const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === text)
  if (!anchor) throw new Error(`anchor 없음: ${text}`)
  return anchor
}

function transaction(source: HwpxSourcePackage, commands: EditCommand[], before: EditorSelection, after: EditorSelection, inputType = 'insertText'): EditTransaction {
  return { id: `t-${commands.length}-${before.anchorOffset}`, baseRevision: source.revision, commands, selectionBefore: before, selectionAfter: after, inputType, timestamp: 1 }
}

function typing(source: HwpxSourcePackage, textNodeId: string, offset: number, insert: string): EditTransaction {
  return transaction(
    source,
    [{ type: 'replace-text', sectionPath, textNodeId, from: offset, to: offset, insert }],
    caret(textNodeId, offset),
    caret(textNodeId, offset + insert.length)
  )
}

const section = (source: HwpxSourcePackage) => source.readEntry(sectionPath).toString('utf8')

function placeholders(document: ViewerDocument): ViewerObjectPlaceholder[] {
  const found: ViewerObjectPlaceholder[] = []
  const visit = (paragraphs: readonly ViewerParagraph[]) => {
    for (const paragraph of paragraphs) {
      for (const item of paragraph.content) if (item.type === 'object-placeholder') found.push(item)
    }
  }
  visit(document.sections[0].blocks)
  return found
}

const paragraphTexts = (paragraphs: readonly ViewerParagraph[] | undefined) =>
  (paragraphs ?? []).map((paragraph) => paragraph.content.map((item) => item.type === 'text' ? item.text : '').join(''))

describe('글상자·메모 글자 편집', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-object-text-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('글자만 든 글상자·메모 문단에 TEXT_BOX_TEXT·MEMO_TEXT context를 열고 표가 든 글상자는 읽기 전용으로 둔다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory))
    const document = await decodeViewerDocument(source)
    const contexts = listEditingAnchorContexts(document)
    const textsOf = (structure: EditingStructure) => contexts.filter((context) => context.structure === structure).map((context) => context.text)
    expect(textsOf('TEXT_BOX_TEXT')).toEqual([SUBLIST_EDIT_TEXTS.textBox, SUBLIST_EDIT_TEXTS.textBoxSecond, SUBLIST_EDIT_TEXTS.inlineTextBox])
    expect(textsOf('MEMO_TEXT')).toEqual([SUBLIST_EDIT_TEXTS.memo])
    expect(textsOf('NOTE_TEXT')).toEqual([SUBLIST_EDIT_TEXTS.footnoteBody, SUBLIST_EDIT_TEXTS.footnoteSecond])
    expect(textsOf('HEADER_FOOTER_TEXT')).toEqual([SUBLIST_EDIT_TEXTS.header, SUBLIST_EDIT_TEXTS.footer])
    // 표가 든 글상자는 글상자 글과 표 셀 글 모두 anchor가 없다.
    expect(contexts.some((context) => context.text === SUBLIST_EDIT_TEXTS.objectBoxText || context.text === SUBLIST_EDIT_TEXTS.objectBoxCell)).toBe(false)
    const objectBox = placeholders(document).find((item) => paragraphTexts(item.paragraphs).includes(SUBLIST_EDIT_TEXTS.objectBoxText))!
    expect(objectBox.paragraphs![0].content).toMatchObject([{ text: SUBLIST_EDIT_TEXTS.objectBoxText, sourceAnchor: undefined }])

    // 글상자 문단마다 범위 scope가 따로다(문단을 넘는 범위 치환은 열지 않는다).
    const [first, second] = contexts.filter((context) => context.structure === 'TEXT_BOX_TEXT')
    expect(first.rangeScope).toBe(`${sectionPath}:text-box:${first.paragraphId}`)
    expect(first.rangeScope).not.toBe(second.rangeScope)
    const box = editingCapabilities(document, caret(first.textNodeId, 2))
    expect(box).toMatchObject({
      text: { available: true },
      characterStyle: { available: true },
      paragraphStyle: { available: true },
      paragraphStructure: { available: true },
      cellStyle: { available: false }
    })
    expect(editingCapabilities(document, {
      sectionPath, anchorTextNodeId: first.textNodeId, anchorOffset: 0, focusTextNodeId: second.textNodeId, focusOffset: 1
    }).selection).toEqual({ available: false, reason: 'CROSS_STRUCTURE_SELECTION' })
    const memo = contexts.find((context) => context.structure === 'MEMO_TEXT')!
    // 메모 본문은 글자와 글자·문단 모양을 받고(2026-10-20) 문단 나눔·병합은 막는다. 각주·미주는 넣지 않는다.
    expect(editingCapabilities(document, caret(memo.textNodeId, 1))).toMatchObject({
      text: { available: true },
      characterStyle: { available: true },
      paragraphStyle: { available: true },
      paragraphStructure: { available: false, reason: 'SUBLIST_TEXT' },
      footnote: { available: false, reason: 'FOOTNOTE_POSITION' },
      endnote: { available: false, reason: 'FOOTNOTE_POSITION' }
    })
    // 각주 둘째 문단은 글자만 든 문단이라 Enter를 받고, 번호가 든 첫 문단도(2026-10-20) Enter·병합 규칙에 든다.
    const secondNote = contexts.find((context) => context.text === SUBLIST_EDIT_TEXTS.footnoteSecond)!
    expect(secondNote.structureGate).toBeUndefined()
    expect(editingCapabilities(document, caret(secondNote.textNodeId, 1)).paragraphStructure).toEqual({ available: true })
    const firstNote = contexts.find((context) => context.text === SUBLIST_EDIT_TEXTS.footnoteBody)!
    expect(firstNote.structureGate).toBeUndefined()
    expect(editingCapabilities(document, caret(firstNote.textNodeId, 2)).paragraphStructure).toEqual({ available: true })
  })

  test('글상자 글 입력은 hp:t만 고치고 증분 projection이 전체 해석과 같으며 undo·redo가 정확하다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'box-text.hwpx'))
    const original = section(source)
    const box = anchorOf(source, SUBLIST_EDIT_TEXTS.textBox)
    const { cache, result } = await ViewerProjectionCache.open(source)
    const history = new HwpxEditHistory(source)
    history.commit(typing(source, box.textNodeId, 3, ' 고친'))
    const edited = section(history.package)
    expect(edited).toBe(original.replace(`<hp:t>${SUBLIST_EDIT_TEXTS.textBox}</hp:t>`, '<hp:t>글상자 고친 첫 문단</hp:t>'))
    const updated = await cache.update(history.package)
    expect(updated.decodedSections).toBe(1)
    const projected = applyViewerDocumentPatch(result.document, updated.patch!)
    expect(projected).toStrictEqual(await decodeViewerDocument(history.package))
    const textBox = placeholders(projected).find((item) => item.kind === 'text-box' && item.position)!
    expect(paragraphTexts(textBox.paragraphs)).toEqual(['글상자 고친 첫 문단', SUBLIST_EDIT_TEXTS.textBoxSecond])
    history.undo()
    expect(section(history.package)).toBe(original)
    history.redo()
    expect(section(history.package)).toBe(edited)
  })

  test('메모 본문 입력은 메모 hp:t만 고치고 메모 범위(fieldBegin·fieldEnd)는 byte 그대로다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'memo-text.hwpx'))
    const original = section(source)
    const memo = anchorOf(source, SUBLIST_EDIT_TEXTS.memo)
    const result = applyEditTransaction(source, typing(source, memo.textNodeId, SUBLIST_EDIT_TEXTS.memo.length, ' 고침'))
    expect(section(result.package)).toBe(original.replace(`<hp:t>${SUBLIST_EDIT_TEXTS.memo}</hp:t>`, `<hp:t>${SUBLIST_EDIT_TEXTS.memo} 고침</hp:t>`))
    const document = await decodeViewerDocument(result.package)
    expect(paragraphTexts(placeholders(document).find((item) => item.kind === 'memo')!.paragraphs)).toEqual([`${SUBLIST_EDIT_TEXTS.memo} 고침`])
    expect(section(applyEditTransaction(result.package, result.inverse!).package)).toBe(original)
    // 메모 본문 문단 나눔은 편집 코어에서도 거부한다(글자·문단 모양은 아래 메모 모양 test).
    expect(() => planSplitParagraph(source, caret(memo.textNodeId, 1))).toThrow(HwpxEditConflictError)
  })

  test('표가 든 글상자 글은 편집 코어도 글자·문단 모양과 문단 나눔을 거부한다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'object-box.hwpx'))
    const text = anchorOf(source, SUBLIST_EDIT_TEXTS.objectBoxText)
    expect(() => applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: text.textNodeId, bold: true }))
      .toThrow(HwpxEditConflictError)
    expect(() => applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: text.textNodeId, align: 'CENTER' }))
      .toThrow(HwpxEditConflictError)
    expect(() => planSplitParagraph(source, caret(text.textNodeId, 1))).toThrow(HwpxEditConflictError)
  })
})

describe('각주·머리말·글상자 글자·문단 모양과 문단 나눔', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-sublist-style-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('번호와 같은 run의 각주 글자에 굵게를 주면 번호 control을 원래 모양 run에 남기고 글자만 새 run으로 나눈다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'note-bold.hwpx'))
    const original = section(source)
    const note = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteBody)
    const autoNum = '<hp:ctrl><hp:autoNum num="1" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl>'
    const whole = applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: note.textNodeId, bold: true })
    expect(whole.changed).toBe(true)
    expect(section(whole.package)).toBe(original.replace(
      `<hp:run charPrIDRef="0">${autoNum}<hp:t>${SUBLIST_EDIT_TEXTS.footnoteBody}</hp:t></hp:run>`,
      `<hp:run charPrIDRef="0">${autoNum}</hp:run><hp:run charPrIDRef="1"><hp:t>${SUBLIST_EDIT_TEXTS.footnoteBody}</hp:t></hp:run>`
    ))
    const document = await decodeViewerDocument(whole.package)
    const notes = document.sections[0].blocks.flatMap(paragraphFootnotes)
    expect(notes.map((item) => item.marker)).toEqual(['1)'])
    expect(notes[0].paragraphs[0].content).toMatchObject([{ text: SUBLIST_EDIT_TEXTS.footnoteBody, charStyleId: '1' }])

    // 부분 선택: 번호 run + 왼쪽·선택·오른쪽 글자 run. 실행 취소·다시 실행이 원래 bytes를 되살린다.
    const history = new HwpxEditHistory(source)
    // 편집 엔진처럼 선택 뒤 selection은 가운데(선택) 조각 `hp:t`를 가리킨다.
    const middle = `${sectionPath}#hp:t:${note.ordinal + 1}`
    history.commit(transaction(source, [{ type: 'apply-character-style', sectionPath, textNodeId: note.textNodeId, bold: true, from: 2, to: 5 }], caret(note.textNodeId, 2, 5), caret(middle, 0, 3), 'formatBold'))
    const partial = section(history.package)
    expect(partial).toContain(`<hp:run charPrIDRef="0">${autoNum}</hp:run><hp:run charPrIDRef="0"><hp:t>번호</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>와 같</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>은 run의 각주</hp:t></hp:run>`)
    history.undo()
    expect(section(history.package)).toBe(original)
    history.redo()
    expect(section(history.package)).toBe(partial)
    history.undo()
    // 문단 모양(가운데 정렬)은 각주 문단의 paraPrIDRef만 바꾼다.
    const align = applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: note.textNodeId, align: 'CENTER' })
    expect(section(align.package)).toBe(original.replace(
      `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${autoNum}`,
      `<hp:p id="0" paraPrIDRef="4" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${autoNum}`
    ))
  })

  test('머리말·글상자 글자 모양과 문단 모양은 그 문단의 run·문단 reference만 바꾸고 undo가 원래 bytes를 되살린다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'header-style.hwpx'))
    const original = section(source)
    for (const text of [SUBLIST_EDIT_TEXTS.header, SUBLIST_EDIT_TEXTS.textBox, SUBLIST_EDIT_TEXTS.inlineTextBox]) {
      const anchor = anchorOf(source, text)
      const history = new HwpxEditHistory(source)
      const selection = caret(anchor.textNodeId, 0, text.length)
      history.commit(transaction(source, [
        { type: 'apply-character-style', sectionPath, textNodeId: anchor.textNodeId, italic: true, height: 1200 },
        { type: 'apply-paragraph-style', sectionPath, textNodeId: anchor.textNodeId, align: 'RIGHT', lineSpacing: 180 }
      ], selection, selection, 'formatItalic'))
      const edited = section(history.package)
      expect(edited).toContain(`<hp:run charPrIDRef="1"><hp:t>${text}</hp:t></hp:run>`)
      const document = await decodeViewerDocument(history.package)
      const context = listEditingAnchorContexts(document).find((candidate) => candidate.text === text)!
      expect(document.charStyles[context.charStyleId]).toMatchObject({ italic: true, height: 1200 })
      expect(document.paraStyles[context.paraStyleId]).toMatchObject({ align: 'RIGHT', lineSpacing: 180 })
      history.undo()
      expect(section(history.package)).toBe(original)
    }
  })

  test('Enter·경계 병합은 머리말·글상자·각주 둘째 문단에서 같은 subList 안 문단을 나누고 합친다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'sublist-split.hwpx'))
    const original = section(source)
    // 글상자 첫 문단을 나눈다: 새 문단 id는 section의 가장 큰 문단 id + 1이고, 줄 배치 cache는 쓰지 않는다.
    const box = anchorOf(source, SUBLIST_EDIT_TEXTS.textBox)
    const split = planSplitParagraph(source, caret(box.textNodeId, 3))
    assertReplayableTransaction(transaction(source, [split.command], caret(box.textNodeId, 3), split.selectionAfter, 'insertParagraph'), source)
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, [split.command], caret(box.textNodeId, 3), split.selectionAfter, 'insertParagraph'))
    const splitXml = section(history.package)
    expect(splitXml).toContain(`<hp:p id="20" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>글상자</hp:t></hp:run></hp:p><hp:p id="43" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t> 첫 문단</hp:t></hp:run></hp:p>`)
    const document = await decodeViewerDocument(history.package)
    const textBox = placeholders(document).find((item) => item.kind === 'text-box' && item.position && paragraphTexts(item.paragraphs).includes('글상자'))!
    expect(paragraphTexts(textBox.paragraphs)).toEqual(['글상자', ' 첫 문단', SUBLIST_EDIT_TEXTS.textBoxSecond])
    expect(history.selection?.focusTextNodeId).toBe(split.selectionAfter.focusTextNodeId)
    history.undo()
    expect(section(history.package)).toBe(original)

    // 머리말은 문단이 하나라 병합할 앞 문단이 없다. 나누면 머리말 문단이 둘이 된다.
    const header = anchorOf(source, SUBLIST_EDIT_TEXTS.header)
    const headerSplit = applyEditTransaction(source, transaction(source, [planSplitParagraph(source, caret(header.textNodeId, 2)).command], caret(header.textNodeId, 2), caret(header.textNodeId, 2), 'insertParagraph'))
    const headerDocument = await decodeViewerDocument(headerSplit.package)
    expect(headerDocument.sections[0].headers[0].paragraphs.map((paragraph) => paragraph.content.map((item) => item.type === 'text' ? item.text : '').join('')))
      .toEqual(['하위', ' 목록 머리말'])
    expect(section(applyEditTransaction(headerSplit.package, headerSplit.inverse!).package)).toBe(original)
    expect(() => planMergeParagraph(source, caret(header.textNodeId, 0), 'previous')).toThrow('병합할 인접 문단이 없습니다.')

    // 글상자 두 문단 병합(첫 문단 끝 Delete).
    const merge = planMergeParagraph(source, caret(box.textNodeId, SUBLIST_EDIT_TEXTS.textBox.length), 'next')
    const merged = applyEditTransaction(source, transaction(source, [merge.command], caret(box.textNodeId, SUBLIST_EDIT_TEXTS.textBox.length), merge.selectionAfter, 'deleteContentForward'))
    const mergedBox = placeholders(await decodeViewerDocument(merged.package)).find((item) => item.kind === 'text-box' && item.position && paragraphTexts(item.paragraphs).some((text) => text.startsWith('글상자')))!
    expect(paragraphTexts(mergedBox.paragraphs)).toEqual([`${SUBLIST_EDIT_TEXTS.textBox}${SUBLIST_EDIT_TEXTS.textBoxSecond}`])
    expect(section(applyEditTransaction(merged.package, merged.inverse!).package)).toBe(original)

    // 각주 둘째 문단을 나눈다.
    const secondNote = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteSecond)
    const noteSplit = planSplitParagraph(source, caret(secondNote.textNodeId, 2))
    const noteResult = applyEditTransaction(source, transaction(source, [noteSplit.command], caret(secondNote.textNodeId, 2), noteSplit.selectionAfter, 'insertParagraph'))
    const notes = (await decodeViewerDocument(noteResult.package)).sections[0].blocks.flatMap(paragraphFootnotes)
    expect(paragraphTexts(notes[0].paragraphs)).toEqual([SUBLIST_EDIT_TEXTS.footnoteBody, '각주', ' 둘째 문단'])
    // 둘째 문단 맨 앞 Backspace는 번호가 든 첫 문단에 합친다(번호 control은 첫 문단 첫 run 맨 앞에 그대로 남는다).
    const autoNum = '<hp:ctrl><hp:autoNum num="1" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl>'
    const noteMerge = planMergeParagraph(source, caret(secondNote.textNodeId, 0), 'previous')
    assertReplayableTransaction(transaction(source, [noteMerge.command], caret(secondNote.textNodeId, 0), noteMerge.selectionAfter, 'deleteContentBackward'), source)
    const mergedNote = applyEditTransaction(source, transaction(source, [noteMerge.command], caret(secondNote.textNodeId, 0), noteMerge.selectionAfter, 'deleteContentBackward'))
    expect(section(mergedNote.package)).toContain(`<hp:run charPrIDRef="0">${autoNum}<hp:t>${SUBLIST_EDIT_TEXTS.footnoteBody}</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t>${SUBLIST_EDIT_TEXTS.footnoteSecond}</hp:t></hp:run>`)
    const mergedNotes = (await decodeViewerDocument(mergedNote.package)).sections[0].blocks.flatMap(paragraphFootnotes)
    expect(mergedNotes.map((note) => note.marker)).toEqual(['1)'])
    expect(paragraphTexts(mergedNotes[0].paragraphs)).toEqual([`${SUBLIST_EDIT_TEXTS.footnoteBody}${SUBLIST_EDIT_TEXTS.footnoteSecond}`])
    expect(section(applyEditTransaction(mergedNote.package, mergedNote.inverse!).package)).toBe(original)
  })

  test('번호가 든 각주 첫 문단의 Enter는 번호 control을 앞 문단에 남기고 뒤 글자만 새 문단으로 옮긴다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'number-split.hwpx'))
    const original = section(source)
    const autoNum = '<hp:ctrl><hp:autoNum num="1" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl>'
    const note = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteBody)
    for (const offset of [0, 3, SUBLIST_EDIT_TEXTS.footnoteBody.length]) {
      const plan = planSplitParagraph(source, caret(note.textNodeId, offset))
      expect(plan.selectionAfter.focusTextNodeId).toBe(`${sectionPath}#hp:t:${note.ordinal + 1}`)
      const before = SUBLIST_EDIT_TEXTS.footnoteBody.slice(0, offset)
      const after = SUBLIST_EDIT_TEXTS.footnoteBody.slice(offset)
      const text = (value: string) => `<hp:t>${value}</hp:t>`
      // 복구 기록 replay 검사: 번호 control 원문이 바꾸기 전 fragment에 있으므로 받는다.
      const split = transaction(source, [plan.command], caret(note.textNodeId, offset), plan.selectionAfter, 'insertParagraph')
      assertReplayableTransaction(split, source)
      const history = new HwpxEditHistory(source)
      history.commit(split)
      const edited = section(history.package)
      expect(edited).toContain(`<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${autoNum}${text(before)}</hp:run></hp:p>` +
        `<hp:p id="43" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${text(after)}</hp:run></hp:p>`)
      const notes = (await decodeViewerDocument(history.package)).sections[0].blocks.flatMap(paragraphFootnotes)
      expect(notes.map((item) => item.marker)).toEqual(['1)'])
      expect(paragraphTexts(notes[0].paragraphs)).toEqual([before, after, SUBLIST_EDIT_TEXTS.footnoteSecond])
      history.undo()
      expect(section(history.package)).toBe(original)
      history.redo()
      expect(section(history.package)).toBe(edited)
    }
    // 번호 control을 새로 들이는(바꾸기 전 fragment에 없는) 문단 fragment는 replay 검사가 거부한다.
    const second = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteSecond)
    const forged = planSplitParagraph(source, caret(second.textNodeId, 1))
    const injected = { ...forged.command, replacementFragment: forged.command.replacementFragment.replace('<hp:run charPrIDRef="0"><hp:t>', `<hp:run charPrIDRef="0">${autoNum.replace('num="1"', 'num="7"')}<hp:t>`) }
    expect(() => assertReplayableTransaction(transaction(source, [injected], caret(second.textNodeId, 1), forged.selectionAfter, 'insertParagraph'), source))
      .toThrow('복구 기록의 문단 fragment')
    // 번호가 든 첫 문단 맨 앞 Backspace는 병합할 앞 문단이 없다.
    expect(() => planMergeParagraph(source, caret(note.textNodeId, 0), 'previous')).toThrow('병합할 인접 문단이 없습니다.')
  })

  test('복구 기록 replay 검사는 각주 첫 문단을 가리키는 fragment의 번호 control 하나만 받는다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'number-guard.hwpx'))
    const autoNum = '<hp:ctrl><hp:autoNum num="1" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl>'
    const note = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteBody)
    const plan = planSplitParagraph(source, caret(note.textNodeId, 3))
    const legit = transaction(source, [plan.command], caret(note.textNodeId, 3), plan.selectionAfter, 'insertParagraph')
    expect(() => assertReplayableTransaction(legit, source)).not.toThrow()
    expect(() => assertReplayableTransaction(legit, source, 5)).not.toThrow()
    // 번호 control이 든 문단 fragment는 version 4까지의 기록에 없었다.
    expect(() => assertReplayableTransaction(legit, source, 4)).toThrow('복구 기록의 문단 fragment')
    // 문서 없이는 각주 첫 문단인지 알 수 없으므로 받지 않는다.
    expect(() => assertReplayableTransaction(legit, undefined)).toThrow('복구 기록의 문단 fragment')

    // 번호 control을 둘로 늘린 fragment.
    const duplicated = { ...plan.command, replacementFragment: plan.command.replacementFragment.replace(autoNum, autoNum + autoNum) }
    expect(duplicated.replacementFragment).not.toBe(plan.command.replacementFragment)
    expect(() => assertReplayableTransaction({ ...legit, commands: [duplicated] }, source)).toThrow('복구 기록의 문단 fragment')

    // 각주를 품은 본문 문단을 가리켜 그 각주의 번호 control을 본문 문단 run으로 옮기는 fragment(원문은 바꾸기 전 fragment에 있다).
    const lead = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteLead)
    const xmlText = section(source)
    const start = xmlText.lastIndexOf('<hp:p ', xmlText.indexOf(`<hp:t>${SUBLIST_EDIT_TEXTS.footnoteLead}</hp:t>`))
    const end = xmlText.indexOf('</hp:p>', xmlText.indexOf('</hp:footNote>')) + '</hp:p>'.length
    const bodyParagraph = xmlText.slice(start, end)
    expect(bodyParagraph).toContain(autoNum)
    const moved: EditCommand = {
      type: 'replace-paragraph-fragment',
      sectionPath,
      textNodeId: lead.textNodeId,
      expectedFragment: bodyParagraph,
      replacementFragment: `<hp:p id="2" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">${autoNum}<hp:t>${SUBLIST_EDIT_TEXTS.footnoteLead}</hp:t></hp:run></hp:p>`
    }
    expect(() => assertReplayableTransaction({ ...legit, commands: [moved] }, source)).toThrow('복구 기록의 문단 fragment')

    // 각주 둘째 문단을 가리키며 첫 문단 번호 control을 복제한 fragment.
    const second = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteSecond)
    const secondSplit = planSplitParagraph(source, caret(second.textNodeId, 1))
    const copied = {
      ...secondSplit.command,
      expectedFragment: secondSplit.command.expectedFragment + autoNum,
      replacementFragment: secondSplit.command.replacementFragment.replace('<hp:run charPrIDRef="0"><hp:t>', `<hp:run charPrIDRef="0">${autoNum}<hp:t>`)
    }
    expect(() => assertReplayableTransaction({ ...legit, commands: [copied] }, source)).toThrow('복구 기록의 문단 fragment')

    // 미주 번호 종류(ENDNOTE)로 바꾼 control은 각주 첫 문단에서도 받지 않는다.
    const endnoteNum = autoNum.replace('FOOTNOTE', 'ENDNOTE')
    const retyped = {
      ...plan.command,
      expectedFragment: plan.command.expectedFragment + endnoteNum,
      replacementFragment: plan.command.replacementFragment.replace(autoNum, endnoteNum)
    }
    expect(() => assertReplayableTransaction({ ...legit, commands: [retyped] }, source)).toThrow('복구 기록의 문단 fragment')
  })

  test('메모 본문 글자·문단 모양은 메모 문단의 run·문단 reference만 바꾸고 메모 범위는 byte 그대로다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'memo-style.hwpx'))
    const original = section(source)
    const memo = anchorOf(source, SUBLIST_EDIT_TEXTS.memo)
    const history = new HwpxEditHistory(source)
    const selection = caret(memo.textNodeId, 0, 2)
    const middle = `${sectionPath}#hp:t:${memo.ordinal}`
    const styleTransaction = transaction(source, [
      { type: 'apply-character-style', sectionPath, textNodeId: memo.textNodeId, bold: true, from: 0, to: 2 },
      { type: 'apply-paragraph-style', sectionPath, textNodeId: memo.textNodeId, align: 'CENTER' }
    ], selection, caret(middle, 0, 2), 'formatBold')
    assertReplayableTransaction(styleTransaction, source)
    history.commit(styleTransaction)
    const edited = section(history.package)
    expect(edited).toContain(`<hp:run charPrIDRef="1"><hp:t>메모</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t> 본문</hp:t></hp:run>`)
    expect(edited).toContain(`<hp:p id="0" paraPrIDRef="4" styleIDRef="0"`)
    // 메모 범위(fieldBegin 속성·fieldEnd)는 그대로다.
    expect(edited.slice(edited.indexOf('<hp:ctrl><hp:fieldBegin'), edited.indexOf('<hp:subList', edited.indexOf('<hp:ctrl><hp:fieldBegin'))))
      .toBe(original.slice(original.indexOf('<hp:ctrl><hp:fieldBegin'), original.indexOf('<hp:subList', original.indexOf('<hp:ctrl><hp:fieldBegin'))))
    expect(edited).toContain('<hp:ctrl><hp:fieldEnd beginIDRef="9401" fieldid="9402"/></hp:ctrl>')
    const document = await decodeViewerDocument(history.package)
    const memoItem = placeholders(document).find((item) => item.kind === 'memo')!
    expect(memoItem.paragraphs![0].content).toMatchObject([{ text: '메모', charStyleId: '1' }, { text: ' 본문', charStyleId: '0' }])
    expect(document.paraStyles[memoItem.paragraphs![0].paraStyleId]).toMatchObject({ align: 'CENTER' })
    // 나뉜 메모 run에도 계속 입력할 수 있다(MEMO_TEXT context, 같은 메모 범위 scope).
    const contexts = listEditingAnchorContexts(document).filter((context) => context.structure === 'MEMO_TEXT')
    expect(contexts.map((context) => context.text)).toEqual(['메모', ' 본문'])
    expect(new Set(contexts.map((context) => context.rangeScope)).size).toBe(1)
    history.undo()
    expect(section(history.package)).toBe(original)
    history.redo()
    expect(section(history.package)).toBe(edited)
  })

  test('복구 기록 replay 검사는 글상자·메모 글자, subList 글자·문단 모양 command를 받는다', async () => {
    const source = await HwpxSourcePackage.open(createSublistEditHwpx(directory, 'sublist-replay.hwpx'))
    for (const text of [SUBLIST_EDIT_TEXTS.textBox, SUBLIST_EDIT_TEXTS.inlineTextBox, SUBLIST_EDIT_TEXTS.memo]) {
      expect(() => assertReplayableTransaction(typing(source, anchorOf(source, text).textNodeId, 0, '가'), source)).not.toThrow()
    }
    const note = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteBody)
    const selection = caret(note.textNodeId, 0, 2)
    expect(() => assertReplayableTransaction(transaction(source, [
      { type: 'apply-character-style', sectionPath, textNodeId: note.textNodeId, bold: true, from: 0, to: 2 },
      { type: 'apply-paragraph-style', sectionPath, textNodeId: note.textNodeId, align: 'CENTER' }
    ], selection, selection, 'formatBold'), source)).not.toThrow()
  })
})
