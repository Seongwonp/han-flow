import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import {
  EditingAnchorContext,
  editingCapabilities,
  listEditingAnchorContexts
} from '../../src/core/editing/editing_capability'
import {
  emptyParagraphAnchorId,
  isEmptyParagraphAnchorId,
  parseEmptyParagraphAnchorId
} from '../../src/core/editing/empty_paragraph_anchor'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import {
  applyCharacterStyleCommand,
  applyParagraphStyleCommand,
  applyRestoreStyleCommand,
  RestoreStyleCommand
} from '../../src/core/editing/style_patch'
import {
  applyReplaceTextCommand,
  HwpxEditConflictError,
  listHwpxEmptyParagraphAnchors,
  listHwpxTextAnchors,
  resolveHwpxCaretAnchor
} from '../../src/core/editing/text_patch'
import { applyEditTransaction, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { EditingSessionManager } from '../../src/main/editing_session'
import { projectedSessionManager } from '../main/projected_session_manager'
import { writeEditingWorkerShim } from '../main/ts_worker_shim'

const sectionPath = 'Contents/section0.xml'
const external = (name: string) => join(__dirname, '../fixtures/public/external', `${name}.hwpx`)

function caret(textNodeId: string, offset = 0): EditorSelection {
  return createEditorSelection(sectionPath, textNodeId, offset)
}

function typing(source: HwpxSourcePackage, id: string, textNodeId: string, offset: number, insert: string, timestamp = 1): EditTransaction {
  return {
    id,
    baseRevision: source.revision,
    commands: [{ type: 'replace-text', sectionPath, textNodeId, from: offset, to: offset, insert }],
    selectionBefore: caret(textNodeId, offset),
    selectionAfter: caret(textNodeId, offset + insert.length),
    inputType: 'insertText',
    timestamp
  }
}

function emptyContexts(document: ViewerDocument): EditingAnchorContext[] {
  return listEditingAnchorContexts(document).filter((context) => context.emptyParagraph)
}

function paragraphOf(document: ViewerDocument, textNodeId: string): ViewerParagraph | undefined {
  let found: ViewerParagraph | undefined
  const visit = (paragraph: ViewerParagraph): void => {
    for (const item of paragraph.content) {
      if (item.type === 'text' && item.sourceAnchor?.textNodeId === textNodeId) found = paragraph
      if (item.type === 'table') item.rows.forEach((row) => row.cells.forEach((cell) => cell.paragraphs.forEach(visit)))
    }
  }
  document.sections.forEach((section) => section.blocks.forEach(visit))
  return found
}

/** 원문에서 합성 anchor 문단(paragraphOrdinal번째 `<hp:p`)의 원문 조각. */
function paragraphXml(xml: string, textNodeId: string): string {
  const ordinal = parseEmptyParagraphAnchorId(textNodeId)!.paragraphOrdinal
  let index = -1
  for (let count = 0; count <= ordinal; count += 1) index = xml.indexOf('<hp:p ', index + 1)
  const selfClose = xml.indexOf('/>', index)
  const open = xml.indexOf('>', index)
  if (selfClose >= 0 && selfClose < open) return xml.slice(index, selfClose + 2)
  return xml.slice(index, xml.indexOf('</hp:p>', index) + '</hp:p>'.length)
}

describe('글자 칸이 없는 빈 문단·셀 입력', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-empty-paragraph-'))

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('합성 anchor id는 hp:t anchor와 겹치지 않는 고정 형식이다', () => {
    const id = emptyParagraphAnchorId(sectionPath, 12)
    expect(id).toBe('Contents/section0.xml#hp:p:12:empty')
    expect(parseEmptyParagraphAnchorId(id)).toEqual({ sectionPath, paragraphOrdinal: 12 })
    expect(isEmptyParagraphAnchorId(`${sectionPath}#hp:t:12`)).toBe(false)
    expect(isEmptyParagraphAnchorId(`${sectionPath}#hp:p:012:empty`)).toBe(false)
    expect(isEmptyParagraphAnchorId(`${sectionPath}#hp:p:12`)).toBe(false)
  })

  test('최상위 빈 문단(<hp:run/>)에 입력하면 그 run에 hp:t를 만들고 selection을 새 anchor로 옮기며 undo·redo가 bytes를 그대로 되돌린다', async () => {
    const source = await HwpxSourcePackage.open(external('ext-hwpxlib-para-heads'))
    const original = source.readEntry(sectionPath)
    const document = await decodeViewerDocument(source)
    const target = emptyContexts(document).find((context) => context.structure === 'TOP_LEVEL_TEXT')!
    expect(paragraphXml(original.toString('utf8'), target.textNodeId)).toContain('<hp:run charPrIDRef="0"/><hp:linesegarray>')
    const capability = editingCapabilities(document, caret(target.textNodeId))
    expect(capability.text).toEqual({ available: true })
    expect(capability.paragraphStyle).toEqual({ available: true })
    expect(capability.characterStyle).toEqual({ available: false, reason: 'EMPTY_PARAGRAPH' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'EMPTY_PARAGRAPH' })
    expect(capability.focus?.rangeScope).toBe(`${sectionPath}:empty-paragraph:${target.paragraphId}`)

    const history = new HwpxEditHistory(source)
    const first = history.commit(typing(source, 'type-1', target.textNodeId, 0, '가'))
    const moved = history.selection!
    expect(moved.anchorTextNodeId).toMatch(/#hp:t:\d+$/)
    expect(moved).toEqual(first.selectionAfter)
    expect(moved).toMatchObject({ anchorOffset: 1, focusOffset: 1 })
    expect(resolveHwpxCaretAnchor(history.package, sectionPath, target.textNodeId)).toBeUndefined()
    expect(resolveHwpxCaretAnchor(history.package, sectionPath, moved.focusTextNodeId)).toMatchObject({ text: '가' })

    history.commit(typing(history.package, 'type-2', moved.focusTextNodeId, 1, '나', 2))
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain('<hp:run charPrIDRef="0"><hp:t>가나</hp:t></hp:run><hp:linesegarray>')
    expect(edited.length).toBe(original.toString('utf8').length + '<hp:t>가나</hp:t></hp:run>'.length - 1)
    // 두 글자는 한 번의 실행 취소로 묶인다.
    expect(history.stats().undoEntries).toBe(1)
    const projected = await decodeViewerDocument(history.package)
    expect(paragraphOf(projected, moved.focusTextNodeId)?.content).toMatchObject([{ type: 'text', text: '가나', charStyleId: '0' }])
    expect(emptyContexts(projected).map((context) => context.textNodeId)).not.toContain(target.textNodeId)

    const undone = history.undo()!
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    expect(undone.selection).toEqual(caret(target.textNodeId))
    expect(emptyContexts(await decodeViewerDocument(history.package)).map((context) => context.textNodeId)).toContain(target.textNodeId)
    const redone = history.redo()!
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
    expect(redone.selection).toEqual({ ...moved, anchorOffset: 2, focusOffset: 2 })
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
  })

  test.each([
    ['run이 없는 자기 닫힘 문단(<hp:p/>)', 'ext-pyhwpx-fill-image', /^<hp:p [^>]*\/>$/, '<hp:run charPrIDRef="0"><hp:t>셀 입력</hp:t></hp:run></hp:p>'],
    ['빈 run(<hp:run/>) 문단', 'ext-hwpxlib-table-scores', /<hp:run charPrIDRef="0"\/>/, '<hp:run charPrIDRef="0"><hp:t>셀 입력</hp:t></hp:run>']
  ])('빈 표 셀 — %s에 입력하고 exact undo·redo한다', async (_label, fixture, originalShape, expected) => {
    const source = await HwpxSourcePackage.open(external(fixture))
    const original = source.readEntry(sectionPath)
    const document = await decodeViewerDocument(source)
    const target = emptyContexts(document).find((context) => context.structure === 'TABLE_CELL_TEXT')!
    expect(target).toBeDefined()
    expect(paragraphXml(original.toString('utf8'), target.textNodeId)).toMatch(originalShape)
    const capability = editingCapabilities(document, caret(target.textNodeId))
    expect(capability.text.available).toBe(true)
    expect(capability.cellStyle.available).toBe(false)
    expect(target.cellStructureEditable).toBe(false)

    const history = new HwpxEditHistory(source)
    history.commit(typing(source, 'cell', target.textNodeId, 0, '셀 입력'))
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain(expected)
    const selection = history.selection!
    const projected = await decodeViewerDocument(history.package)
    expect(editingCapabilities(projected, selection).text.available).toBe(true)
    expect(editingCapabilities(projected, selection).focus).toMatchObject({ structure: 'TABLE_CELL_TEXT', text: '셀 입력' })

    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
  })

  test('구역 첫 문단(hp:secPr·hp:ctrl만 든 run)은 한/글처럼 같은 run의 control 뒤에 hp:t를 넣는다', async () => {
    const source = await HwpxSourcePackage.open(external('ext-pyhwpx-list-bullet-l2'))
    const original = source.readEntry(sectionPath)
    const anchors = listHwpxEmptyParagraphAnchors(source, sectionPath)
    const first = anchors.find((anchor) => anchor.paragraphOrdinal === 0)!
    expect(first.textNodeId).toBe(emptyParagraphAnchorId(sectionPath, 0))
    const before = paragraphXml(original.toString('utf8'), first.textNodeId)
    expect(before).toMatch(/<hp:run charPrIDRef="0"><hp:secPr[\s\S]*<\/hp:ctrl><\/hp:run><\/hp:p>$/)

    const document = await decodeViewerDocument(source)
    expect(document.sections[0].blocks[0].content).toEqual([
      { type: 'text', text: '', charStyleId: '0', sourceAnchor: { sectionPath, textNodeId: first.textNodeId } }
    ])
    const result = applyEditTransaction(source, typing(source, 'first', first.textNodeId, 0, '첫 줄'))
    const after = paragraphXml(result.package.readEntry(sectionPath).toString('utf8'), first.textNodeId)
    expect(after).toBe(before.replace('</hp:ctrl></hp:run></hp:p>', '</hp:ctrl><hp:t>첫 줄</hp:t></hp:run></hp:p>'))
    // 페이지 설정(hp:secPr)은 그대로 decode되고 첫 문단에 글자가 보인다.
    const projected = await decodeViewerDocument(result.package)
    expect(projected.page).toEqual(document.page)
    expect(projected.sections[0].blocks[0].content).toMatchObject([{ type: 'text', text: '첫 줄' }])
    expect(result.selectionAfter.focusTextNodeId).toBe(`${sectionPath}#hp:t:0`)
    // 뒤 문단의 hp:t ordinal은 하나씩 밀린다.
    expect(listHwpxTextAnchors(result.package, sectionPath).map((anchor) => anchor.text).slice(0, 2)).toEqual(['첫 줄', '목록 항목 1'])

    const undo = applyEditTransaction(result.package, result.inverse!)
    expect(undo.package.readEntry(sectionPath)).toEqual(original)
    expect(undo.selectionAfter).toEqual(caret(first.textNodeId))
    const redo = applyEditTransaction(undo.package, undo.inverse!)
    expect(redo.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('공백으로 들여 쓴 문단·style 글자 모양·entity와 줄바꿈 입력도 원래 bytes로 되돌린다', async () => {
    const path = join(directory, 'pretty.hwpx')
    const zip = new AdmZip(external('ext-pyhwpx-fill-image'))
    const xml = zip.readAsText(sectionPath)
    const pretty = xml.replace(
      '</hs:sec>',
      '<hp:p id="7" paraPrIDRef="0" styleIDRef="0">\n  <hp:run charPrIDRef="0">\n    <hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>\n  </hp:run>\n  <hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray>\n</hp:p>' +
      '<hp:p id="8" paraPrIDRef="0" styleIDRef="0">\n  <hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray>\n</hp:p></hs:sec>'
    )
    zip.updateFile(sectionPath, Buffer.from(pretty))
    zip.writeZip(path)
    const source = await HwpxSourcePackage.open(path)
    const anchors = listHwpxEmptyParagraphAnchors(source, sectionPath)
    const [controls, bare] = anchors.slice(-2)
    for (const [anchor, insert, expected] of [
      [controls, 'a&b\tc', '</hp:ctrl><hp:t>a&amp;b&#9;c</hp:t>\n  </hp:run>'],
      [bare, '줄\n바꿈', '<hp:p id="8" paraPrIDRef="0" styleIDRef="0">\n  <hp:run charPrIDRef="0"><hp:t>줄<hp:lineBreak/>바꿈</hp:t></hp:run><hp:linesegarray>']
    ] as const) {
      const result = applyEditTransaction(source, typing(source, 'pretty', anchor.textNodeId, 0, insert))
      expect(result.package.readEntry(sectionPath).toString('utf8')).toContain(expected)
      const undo = applyEditTransaction(result.package, result.inverse!)
      expect(undo.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
      const redo = applyEditTransaction(undo.package, undo.inverse!)
      expect(redo.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
    }
  })

  test('범위 입력 계획·문단 모양은 빈 문단 anchor를 받고 글자 모양·잘못된 범위는 거부한다', async () => {
    const source = await HwpxSourcePackage.open(external('ext-pyhwpx-paragraph-margins'))
    const target = listHwpxEmptyParagraphAnchors(source, sectionPath).find((anchor) => anchor.paragraphOrdinal > 0)!
    const plan = planReplaceSelection(source, caret(target.textNodeId), '붙여넣기')
    expect(plan.commands).toEqual([
      { type: 'replace-text', sectionPath, textNodeId: target.textNodeId, from: 0, to: 0, insert: '붙여넣기' }
    ])
    const applied = applyEditTransaction(source, {
      id: 'paste',
      baseRevision: source.revision,
      commands: plan.commands,
      selectionBefore: caret(target.textNodeId),
      selectionAfter: plan.selectionAfter,
      timestamp: 1
    })
    expect(applied.selectionAfter.focusOffset).toBe(4)
    expect(resolveHwpxCaretAnchor(applied.package, sectionPath, applied.selectionAfter.focusTextNodeId)?.text).toBe('붙여넣기')

    const styled = applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style',
      sectionPath,
      textNodeId: target.textNodeId,
      align: 'RIGHT'
    })
    expect(styled.changed).toBe(true)
    const projected = await decodeViewerDocument(styled.package)
    expect(projected.paraStyles[paragraphOf(projected, target.textNodeId)!.paraStyleId]?.align).toBe('RIGHT')
    expect(applyRestoreStyleCommand(styled.package, styled.inverse as RestoreStyleCommand).package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))

    expect(() => applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: target.textNodeId,
      bold: true
    })).toThrow('빈 문단은 글자를 입력한 뒤')
    expect(() => applyReplaceTextCommand(source, {
      type: 'replace-text',
      revision: source.revision,
      sectionPath,
      textNodeId: target.textNodeId,
      from: 0,
      to: 1,
      insert: 'x'
    })).toThrow(HwpxEditConflictError)
    expect(() => applyReplaceTextCommand(source, {
      type: 'replace-text',
      revision: source.revision,
      sectionPath,
      textNodeId: emptyParagraphAnchorId(sectionPath, 99_999),
      from: 0,
      to: 0,
      insert: 'x'
    })).toThrow('text anchor를 찾을 수 없습니다')
    // 빈 입력은 bytes를 바꾸지 않는다.
    expect(applyReplaceTextCommand(source, {
      type: 'replace-text',
      revision: source.revision,
      sectionPath,
      textNodeId: target.textNodeId,
      from: 0,
      to: 0,
      insert: ''
    }).package).toBe(source)
  })

  test('세션 입력을 Save As한 뒤 HwpxSourcePackage·decodeViewerDocument로 다시 열면 글자가 그 자리에 있다', async () => {
    const fixture = external('ext-hwpxlib-table-scores')
    const source = await HwpxSourcePackage.open(fixture)
    const document = await decodeViewerDocument(source)
    const body = emptyContexts(document).find((context) => context.structure === 'TOP_LEVEL_TEXT')!
    const cell = emptyContexts(document).find((context) => context.structure === 'TABLE_CELL_TEXT')!
    const rawManager = new EditingSessionManager(() => 'empty-paragraph-session', {
      workerPath: writeEditingWorkerShim(directory)
    })
    const manager = projectedSessionManager(rawManager)
    const started = await manager.start(41, fixture)
    const commit = (textNodeId: string, insert: string, timestamp: number) => manager.commit(41, {
      sessionId: started.sessionId,
      transactionId: `empty-${timestamp}`,
      sectionPath,
      textNodeId,
      from: 0,
      to: 0,
      insert,
      selectionBefore: caret(textNodeId),
      selectionAfter: caret(textNodeId, insert.length),
      inputType: 'insertText',
      timestamp
    })
    const typedCell = await commit(cell.textNodeId, '점수', 1)
    expect(typedCell.selection?.focusTextNodeId).toMatch(/#hp:t:\d+$/)
    expect(editingCapabilities(typedCell.document, typedCell.selection).focus?.text).toBe('점수')
    // 셀 입력으로 hp:t ordinal은 밀렸지만 본문 빈 문단 id(hp:p 순서)는 그대로다.
    const typedBody = await commit(body.textNodeId, '본문', 2_000)
    expect(editingCapabilities(typedBody.document, typedBody.selection).focus?.text).toBe('본문')

    const saved = join(directory, 'empty-paragraph-saved.hwpx')
    await manager.saveAs(41, started.sessionId, saved)
    const reopened = await HwpxSourcePackage.open(saved)
    const decoded = await decodeViewerDocument(reopened)
    const texts = listEditingAnchorContexts(decoded).map((context) => [context.structure, context.text])
    expect(texts).toContainEqual(['TOP_LEVEL_TEXT', '본문'])
    expect(texts).toContainEqual(['TABLE_CELL_TEXT', '점수'])
    expect(emptyContexts(decoded).length).toBe(emptyContexts(document).length - 2)
    // 다른 entry는 원본 bytes 그대로다.
    for (const entry of source.listEntries()) {
      if (entry.path !== sectionPath) expect(reopened.readEntry(entry.path)).toEqual(source.readEntry(entry.path))
    }
    await manager.dispose()
  })
})
