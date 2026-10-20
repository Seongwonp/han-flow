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
    expect(editingCapabilities(document, caret(memo.textNodeId, 1))).toMatchObject({
      text: { available: true },
      characterStyle: { available: false, reason: 'SUBLIST_TEXT' },
      paragraphStyle: { available: false, reason: 'SUBLIST_TEXT' },
      paragraphStructure: { available: false, reason: 'SUBLIST_TEXT' }
    })
    // 각주 둘째 문단은 글자만 든 문단이라 Enter를 받고, 번호가 든 첫 문단과는 병합하지 않는다.
    const secondNote = contexts.find((context) => context.text === SUBLIST_EDIT_TEXTS.footnoteSecond)!
    expect(secondNote.structureGate).toEqual({ mergePrevious: 'PARAGRAPH_HAS_OBJECT' })
    expect(editingCapabilities(document, caret(secondNote.textNodeId, 1)).paragraphStructure).toEqual({ available: true })
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
    // 메모 본문은 글자 모양·문단 모양·문단 나눔을 편집 코어에서도 거부한다.
    expect(() => applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: memo.textNodeId, bold: true }))
      .toThrow(HwpxEditConflictError)
    expect(() => applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: memo.textNodeId, align: 'CENTER' }))
      .toThrow(HwpxEditConflictError)
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

    // 각주 둘째 문단은 나눌 수 있지만 번호가 든 첫 문단과는 병합하지 않는다.
    const secondNote = anchorOf(source, SUBLIST_EDIT_TEXTS.footnoteSecond)
    const noteSplit = planSplitParagraph(source, caret(secondNote.textNodeId, 2))
    const noteResult = applyEditTransaction(source, transaction(source, [noteSplit.command], caret(secondNote.textNodeId, 2), noteSplit.selectionAfter, 'insertParagraph'))
    const notes = (await decodeViewerDocument(noteResult.package)).sections[0].blocks.flatMap(paragraphFootnotes)
    expect(paragraphTexts(notes[0].paragraphs)).toEqual([SUBLIST_EDIT_TEXTS.footnoteBody, '각주', ' 둘째 문단'])
    expect(() => planMergeParagraph(source, caret(secondNote.textNodeId, 0), 'previous')).toThrow(HwpxEditConflictError)
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
