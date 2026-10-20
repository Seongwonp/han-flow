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
import { createSublistEditHwpx, SUBLIST_EDIT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

// 글상자·메모 글자, 각주 글자 모양, 글상자 문단 나눔, 각주 만들기·지우기를 편집 엔진으로 한 뒤 복구 기록(version 4)을 bytes로
// 되읽어 새 엔진에서 replay하면 live 편집과 같은 bytes·revision이고, 실행 취소를 끝까지 하면 원본 bytes로 돌아오는지 본다.

const sectionPath = 'Contents/section0.xml'

function historyOf(engine: EditingEngine): HwpxEditHistory {
  return (engine as unknown as { history: HwpxEditHistory }).history
}

describe('subList·각주 편집의 복구 기록', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-recovery-sublist-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('글상자·메모·각주 편집을 version 4 기록으로 replay하면 같은 문서이고 실행 취소로 원본에 돌아온다', async () => {
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
    expect(RECOVERY_JOURNAL_VERSION).toBe(4)
    const replayed = (await EditingEngine.open(source)).engine
    await replayed.replay(decoded.entries)
    expect(replayed.status()).toMatchObject({ revision: engine.status().revision, isDirty: true })
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(current().readEntry(sectionPath))).toBe(true)
    expect(historyOf(replayed).package.readEntry('Contents/header.xml').equals(current().readEntry('Contents/header.xml'))).toBe(true)
    while (replayed.status().canUndo) await replayed.undo()
    expect(historyOf(replayed).package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
    expect(historyOf(replayed).package.readEntry('Contents/header.xml').equals(original.readEntry('Contents/header.xml'))).toBe(true)
  })
})
