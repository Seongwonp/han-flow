import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { HwpxEditHistory } from '../../src/core/editing/history'
import { createEditorSelection, type EditorSelection } from '../../src/core/editing/selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { EditingEngine } from '../../src/main/editing_engine'
import {
  createRecoveryJournalHeader,
  decodeRecoveryJournal,
  encodeRecoveryRecord,
  RECOVERY_JOURNAL_VERSION
} from '../../src/main/recovery_journal'
import { createNoteEditHwpx, createSublistEditHwpx, NOTE_EDIT_TEXTS, SUBLIST_EDIT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

// 글상자·메모 글자, 각주 글자 모양, 글상자 문단 나눔, 각주 만들기·지우기(version 4), 미주 만들기·지우기, 표 셀·글상자 안 각주,
// 번호 문단 Enter, 메모 글자 모양, 쪽마다 매기는 각주(version 5)를 편집 엔진으로 한 뒤 복구 기록을 bytes로 되읽어 새 엔진에서
// replay하면 live 편집과 같은 bytes·revision이고, 실행 취소를 끝까지 하면 원본 bytes로 돌아오는지 본다.

const sectionPath = 'Contents/section0.xml'

function historyOf(engine: EditingEngine): HwpxEditHistory {
  return (engine as unknown as { history: HwpxEditHistory }).history
}

describe('subList·각주 편집의 복구 기록', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-recovery-sublist-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('글상자·메모·각주 편집을 지금 형식 기록으로 replay하면 같은 문서이고 실행 취소로 원본에 돌아온다', async () => {
    const source = createSublistEditHwpx(directory)
    const original = await HwpxSourcePackage.open(source)
    const { engine } = await EditingEngine.open(source)
    const current = () => historyOf(engine).package
    const anchor = (text: string) => {
      const found = listHwpxTextAnchors(current(), sectionPath).find((candidate) => candidate.text === text)
      if (!found) throw new Error(`anchor 없음: ${text}`)
      return found
    }
    let timestamp = 1
    const base = () => ({ sessionId: 'sublist', transactionId: `t${timestamp}`, timestamp: (timestamp += 2_000) })
    const caret = (textNodeId: string, offset: number, focusOffset = offset): EditorSelection =>
      createEditorSelection(sectionPath, textNodeId, offset, focusOffset)
    const type = async (text: string, offset: number, insert: string) => {
      const target = anchor(text)
      await engine.commit({
        ...base(), sectionPath, textNodeId: target.textNodeId, from: offset, to: offset, insert,
        selectionBefore: caret(target.textNodeId, offset), selectionAfter: caret(target.textNodeId, offset + insert.length), inputType: 'insertText'
      })
    }
    await type(SUBLIST_EDIT_TEXTS.textBox, 0, '가')
    await type(SUBLIST_EDIT_TEXTS.memo, 0, '나')
    const note = anchor(SUBLIST_EDIT_TEXTS.footnoteBody)
    await engine.applyCharacterStyle({ ...base(), sectionPath, textNodeId: note.textNodeId, selection: caret(note.textNodeId, 0, 2), bold: true })
    const box = anchor(`가${SUBLIST_EDIT_TEXTS.textBox}`)
    await engine.splitParagraph({ ...base(), selectionBefore: caret(box.textNodeId, 3) })
    const title = anchor(SUBLIST_EDIT_TEXTS.title)
    const inserted = await engine.insertFootnote({ ...base(), selectionBefore: caret(title.textNodeId, 2) })
    const noteCaret = inserted.selection!
    await engine.commit({
      ...base(), sectionPath, textNodeId: noteCaret.focusTextNodeId, from: 0, to: 0, insert: '새 각주',
      selectionBefore: noteCaret, selectionAfter: caret(noteCaret.focusTextNodeId, 4), inputType: 'insertText'
    })
    // 원래 각주(이제 둘째 각주)를 그 본문 caret에서 지운다. 굵게로 나뉜 첫 조각이 '번호'다.
    const oldNote = anchor('번호')
    await engine.deleteFootnote({ ...base(), selectionBefore: caret(oldNote.textNodeId, 1), notePath: `${sectionPath}#hp:footNote:1` })
    const live = current().readEntry(sectionPath).toString('utf8')
    expect(live).toContain('<hp:t>새 각주</hp:t>')
    expect(live).not.toContain('와 같은 run의 각주')

    const entries = engine.takeJournal()
    expect(entries.filter((entry) => entry.type === 'commit').flatMap((entry) => entry.type === 'commit' ? entry.transaction.commands.map((command) => command.type) : []))
      .toEqual(['replace-text', 'replace-text', 'apply-character-style', 'replace-paragraph-fragment', 'insert-footnote', 'replace-text', 'delete-footnote'])
    const header = createRecoveryJournalHeader(source, { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }, 'test')
    const decoded = decodeRecoveryJournal(Buffer.concat([encodeRecoveryRecord(header), ...entries.map(encodeRecoveryRecord)]))
    expect(decoded.header.version).toBe(RECOVERY_JOURNAL_VERSION)
    expect(RECOVERY_JOURNAL_VERSION).toBe(5)
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(replayed.status()).toMatchObject({ revision: engine.status().revision, isDirty: true })
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(current().readEntry(sectionPath))).toBe(true)
    expect(historyOf(replayed).package.readEntry('Contents/header.xml').equals(current().readEntry('Contents/header.xml'))).toBe(true)
    while (replayed.status().canUndo) await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
    expect(historyOf(replayed).package.readEntry('Contents/header.xml').equals(original.readEntry('Contents/header.xml'))).toBe(true)
  })

  test.each([['CONTINUOUS'], ['ON_PAGE']] as const)('미주·표 셀·글상자 각주·번호 문단 Enter·메모 모양을 version 5 기록으로 replay한다(각주 번호 %s)', async (numbering) => {
    const source = createNoteEditHwpx(directory, `note-edit-${numbering}.hwpx`, { numbering })
    const original = await HwpxSourcePackage.open(source)
    const { engine } = await EditingEngine.open(source)
    const current = () => historyOf(engine).package
    const anchor = (text: string) => {
      const found = listHwpxTextAnchors(current(), sectionPath).find((candidate) => candidate.text === text)
      if (!found) throw new Error(`anchor 없음: ${text}`)
      return found
    }
    let timestamp = 1
    const base = () => ({ sessionId: 'notes', transactionId: `n${timestamp}`, timestamp: (timestamp += 2_000) })
    const caret = (textNodeId: string, offset: number, focusOffset = offset): EditorSelection =>
      createEditorSelection(sectionPath, textNodeId, offset, focusOffset)
    const typeAt = async (selection: EditorSelection, insert: string) => {
      await engine.commit({
        ...base(), sectionPath, textNodeId: selection.focusTextNodeId, from: selection.focusOffset, to: selection.focusOffset, insert,
        selectionBefore: selection, selectionAfter: caret(selection.focusTextNodeId, selection.focusOffset + insert.length), inputType: 'insertText'
      })
    }
    // 본문 caret에 미주, 표 셀·글상자 caret에 각주를 넣고 새 본문에 입력한다.
    const endnote = await engine.insertFootnote({ ...base(), noteKind: 'endnote', selectionBefore: caret(anchor(NOTE_EDIT_TEXTS.title).textNodeId, 2) })
    await typeAt(endnote.selection!, '새 미주')
    const cell = await engine.insertFootnote({ ...base(), selectionBefore: caret(anchor(NOTE_EDIT_TEXTS.cellLeft).textNodeId, 3) })
    await typeAt(cell.selection!, '셀 각주')
    const box = await engine.insertFootnote({ ...base(), selectionBefore: caret(anchor(NOTE_EDIT_TEXTS.textBox).textNodeId, 3) })
    await typeAt(box.selection!, '상자 각주')
    // 새 미주 첫 문단(번호가 든 문단)을 가운데에서 나눈다.
    await engine.splitParagraph({ ...base(), selectionBefore: caret(anchor('새 미주').textNodeId, 1) })
    // 기존 미주를 그 본문 caret에서 지운다(새 미주가 앞이라 둘째 미주).
    await engine.deleteFootnote({ ...base(), selectionBefore: caret(anchor(NOTE_EDIT_TEXTS.endnoteBody).textNodeId, 1), notePath: `${sectionPath}#hp:endNote:1` })
    // 머리말 caret에는 각주·미주를 넣지 않는다.
    await expect(engine.insertFootnote({ ...base(), selectionBefore: caret(anchor(NOTE_EDIT_TEXTS.header).textNodeId, 1) }))
      .rejects.toThrow('머리말·꼬리말에는 각주·미주를 넣을 수 없습니다.')
    const live = current().readEntry(sectionPath).toString('utf8')
    expect(live.match(/<hp:footNote /g)).toHaveLength(4)
    expect(live.match(/<hp:endNote /g)).toHaveLength(1)
    expect(live).toContain('<hp:t>셀 각주</hp:t>')
    expect(live).toContain('<hp:t>상자 각주</hp:t>')
    expect(live).toContain('numType="ENDNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl><hp:t>새</hp:t></hp:run></hp:p>')
    expect(live).not.toContain(NOTE_EDIT_TEXTS.endnoteBody)

    const entries = engine.takeJournal()
    expect(entries.filter((entry) => entry.type === 'commit').flatMap((entry) => entry.type === 'commit' ? entry.transaction.commands.map((command) => command.type) : []))
      .toEqual(['insert-endnote', 'replace-text', 'insert-footnote', 'replace-text', 'insert-footnote', 'replace-text', 'replace-paragraph-fragment', 'delete-endnote'])
    const header = createRecoveryJournalHeader(source, { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }, 'test')
    const decoded = decodeRecoveryJournal(Buffer.concat([encodeRecoveryRecord(header), ...entries.map(encodeRecoveryRecord)]))
    expect(decoded.header.version).toBe(5)
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(replayed.status()).toMatchObject({ revision: engine.status().revision, isDirty: true })
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(current().readEntry(sectionPath))).toBe(true)
    while (replayed.status().canUndo) await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
    // 같은 기록을 version 4 header로 읽으면 미주 command 때문에 구조 오류다.
    expect(() => decodeRecoveryJournal(Buffer.concat([encodeRecoveryRecord({ ...header, version: 4 }), ...entries.map(encodeRecoveryRecord)])))
      .toThrow(expect.objectContaining({ reason: 'malformed' }))
  })

  test('메모 본문 글자·문단 모양을 기록으로 replay한다', async () => {
    const source = createSublistEditHwpx(directory, 'memo-style.hwpx')
    const original = await HwpxSourcePackage.open(source)
    const { engine } = await EditingEngine.open(source)
    const memo = listHwpxTextAnchors(historyOf(engine).package, sectionPath).find((candidate) => candidate.text === SUBLIST_EDIT_TEXTS.memo)!
    const selection = createEditorSelection(sectionPath, memo.textNodeId, 0, 2)
    await engine.applyCharacterStyle({ sessionId: 'memo', transactionId: 'm1', timestamp: 1, sectionPath, textNodeId: memo.textNodeId, selection, bold: true })
    await engine.applyParagraphStyle({ sessionId: 'memo', transactionId: 'm2', timestamp: 5_000, sectionPath, textNodeId: memo.textNodeId, selection: createEditorSelection(sectionPath, memo.textNodeId, 0), align: 'CENTER' })
    const header = createRecoveryJournalHeader(source, { size: 1, mtimeMs: 1, sha256: 'a'.repeat(64) }, 'test')
    const decoded = decodeRecoveryJournal(Buffer.concat([encodeRecoveryRecord(header), ...engine.takeJournal().map(encodeRecoveryRecord)]))
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(historyOf(engine).package.readEntry(sectionPath))).toBe(true)
    expect(historyOf(replayed).package.readEntry(sectionPath).toString('utf8')).toContain('<hp:run charPrIDRef="1"><hp:t>메모</hp:t></hp:run>')
    while (replayed.status().canUndo) await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
  })
})
