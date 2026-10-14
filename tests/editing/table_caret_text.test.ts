import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import { editingCapabilities, listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import {
  isSyntheticCaretAnchorId,
  isTableCaretAnchorId,
  parseTableCaretAnchorId,
  tableCaretAnchorId
} from '../../src/core/editing/empty_paragraph_anchor'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { assertReplayableTransaction } from '../../src/core/editing/replay_guard'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { applyCharacterStyleCommand, applyParagraphStyleCommand } from '../../src/core/editing/style_patch'
import { parseSourceTree } from '../../src/core/editing/source_tree'
import { tableCaretTarget } from '../../src/core/editing/table_caret'
import {
  HwpxEditConflictError,
  listHwpxTableCaretAnchors,
  listHwpxTextAnchors,
  resolveHwpxCaretAnchor
} from '../../src/core/editing/text_patch'
import { applyEditTransaction, EditTransaction } from '../../src/core/editing/transaction'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCellFragmentHwpx, createEditScopeHwpx, EDIT_SCOPE_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

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

function paragraphWith(document: ViewerDocument, textNodeId: string): ViewerParagraph | undefined {
  return document.sections[0].blocks.find((paragraph) =>
    paragraph.content.some((item) => item.type === 'text' && item.sourceAnchor?.textNodeId === textNodeId)
  )
}

describe('표만 든 문단의 표 앞·뒤 글자 입력', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-caret-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('합성 anchor id는 빈 문단·hp:t anchor와 겹치지 않는 고정 형식이다', () => {
    const id = tableCaretAnchorId(sectionPath, 4, 'before')
    expect(id).toBe('Contents/section0.xml#hp:p:4:table-before')
    expect(parseTableCaretAnchorId(tableCaretAnchorId(sectionPath, 4, 'after'))).toEqual({ sectionPath, paragraphOrdinal: 4, side: 'after' })
    expect(isTableCaretAnchorId(`${sectionPath}#hp:p:4:empty`)).toBe(false)
    expect(isTableCaretAnchorId(`${sectionPath}#hp:p:04:table-before`)).toBe(false)
    expect(isTableCaretAnchorId(`${sectionPath}#hp:p:4:table-middle`)).toBe(false)
    expect(isSyntheticCaretAnchorId(id)).toBe(true)
    expect(isSyntheticCaretAnchorId(`${sectionPath}#hp:t:4`)).toBe(false)
  })

  test.each([
    ['표만 든 run', '<hp:p><hp:run><hp:tbl/></hp:run><hp:linesegarray/></hp:p>', { before: true, after: true }],
    ['표 뒤 빈 hp:t', '<hp:p><hp:run><hp:tbl/><hp:t/></hp:run></hp:p>', { before: true, after: false }],
    ['표 앞 글자', '<hp:p><hp:run><hp:t>앞</hp:t><hp:tbl/></hp:run></hp:p>', { before: false, after: true }],
    ['구역 정의·머리말 control 뒤 표', '<hp:p><hp:run><hp:secPr/><hp:ctrl><hp:header/></hp:ctrl><hp:header/><hp:tbl/></hp:run></hp:p>', { before: true, after: true }],
    ['다른 run의 표 뒤 글자', '<hp:p><hp:run><hp:tbl/></hp:run><hp:run><hp:t>뒤</hp:t></hp:run></hp:p>', { before: true, after: false }]
  ])('규칙: %s', (_label, xml, expected) => {
    const tree = parseSourceTree(xml)
    const access = {
      elementName: (node: (typeof tree.children)[number]) => node.kind === 'element' ? node.name : undefined,
      children: (node: (typeof tree.children)[number]) => node.kind === 'element' ? node.children : [],
      isBlank: () => true
    }
    expect(tableCaretTarget(tree.children[0], access)).toMatchObject(expected)
  })

  test.each([
    ['표 두 개', '<hp:p><hp:run><hp:tbl/><hp:tbl/></hp:run></hp:p>'],
    ['그림', '<hp:p><hp:run><hp:tbl/><hp:pic/></hp:run></hp:p>'],
    ['각주 control', '<hp:p><hp:run><hp:tbl/><hp:ctrl><hp:footNote/></hp:ctrl></hp:run></hp:p>'],
    ['필드 control', '<hp:p><hp:run><hp:ctrl><hp:fieldBegin/></hp:ctrl><hp:tbl/></hp:run></hp:p>'],
    ['문단 직속 표', '<hp:p><hp:tbl/></hp:p>'],
    ['표 없음', '<hp:p><hp:run><hp:t>글</hp:t></hp:run></hp:p>']
  ])('규칙: %s는 표 anchor 문단이 아니다', (_label, xml) => {
    const tree = parseSourceTree(xml)
    const access = {
      elementName: (node: (typeof tree.children)[number]) => node.kind === 'element' ? node.name : undefined,
      children: (node: (typeof tree.children)[number]) => node.kind === 'element' ? node.children : [],
      isBlank: () => true
    }
    expect(tableCaretTarget(tree.children[0], access)).toBeUndefined()
  })

  test('표만 든 문단에 표 앞·뒤 caret을, 표 뒤 빈 hp:t 문단에는 표 앞 caret만 연다(셀 문단에는 열지 않는다)', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory))
    const anchors = listHwpxTableCaretAnchors(source, sectionPath)
    expect(anchors.map((anchor) => [anchor.paragraphOrdinal, anchor.tableSide])).toEqual([
      [5, 'before'], [5, 'after'], [8, 'before']
    ])
    expect(anchors.every((anchor) => anchor.charStyleId === '0' && anchor.text === '')).toBe(true)
    const document = await decodeViewerDocument(source)
    const tableParagraph = paragraphWith(document, anchors[0].textNodeId)!
    expect(tableParagraph.content.map((item) => item.type === 'text' ? `text:${item.sourceAnchor?.textNodeId.split('#')[1]}` : item.type)).toEqual([
      'text:hp:p:5:table-before', 'table', 'text:hp:p:5:table-after'
    ])
    // 표 id는 합성 caret을 빼고 센 위치라 caret 유무와 관계없이 같다.
    expect(tableParagraph.content[1]).toMatchObject({ type: 'table', id: 's0:p2:tbl0' })

    const contexts = listEditingAnchorContexts(document).filter((context) => context.tableParagraph)
    expect(contexts.map((context) => [context.textNodeId.split('#')[1], context.tableCaret ?? false, context.structure])).toEqual([
      ['hp:p:5:table-before', true, 'TOP_LEVEL_TEXT'],
      ['hp:p:5:table-after', true, 'TOP_LEVEL_TEXT'],
      ['hp:p:8:table-before', true, 'TOP_LEVEL_TEXT'],
      [expect.stringMatching(/^hp:t:\d+$/), false, 'TOP_LEVEL_TEXT']
    ])
    // 표 앞·뒤 글자는 서로 다른 범위 scope라 표를 사이에 둔 범위 선택을 만들지 않는다.
    expect(new Set(contexts.slice(0, 2).map((context) => context.rangeScope)).size).toBe(2)
    const capability = editingCapabilities(document, caret(anchors[0].textNodeId))
    expect(capability.text).toEqual({ available: true })
    expect(capability.characterStyle).toEqual({ available: false, reason: 'TABLE_PARAGRAPH' })
    expect(capability.paragraphStyle).toEqual({ available: false, reason: 'TABLE_PARAGRAPH' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'TABLE_PARAGRAPH' })
    expect(capability.cellStyle.available).toBe(false)
    // 표 셀 글자는 그대로 표 셀 context다.
    const cell = listHwpxTextAnchors(source, sectionPath).find((anchor) => anchor.text === EDIT_SCOPE_TEXTS.tableCell(0, 0))!
    expect(editingCapabilities(document, caret(cell.textNodeId)).focus?.structure).toBe('TABLE_CELL_TEXT')
  })

  test.each(['before', 'after'] as const)('표 %s caret 입력은 표 run 안에 hp:t를 만들고 selection을 옮기며 undo·redo가 bytes를 되돌린다', async (side) => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, `scope-${side}.hwpx`))
    const original = source.readEntry(sectionPath)
    const target = tableCaretAnchorId(sectionPath, 5, side)
    expect(resolveHwpxCaretAnchor(source, sectionPath, target)).toMatchObject({ text: '', emptyParagraph: true, tableSide: side })
    const history = new HwpxEditHistory(source)
    const first = history.commit(typing(source, 'type-1', target, 0, '표'))
    const moved = history.selection!
    expect(moved.focusTextNodeId).toMatch(/#hp:t:\d+$/)
    expect(moved).toEqual(first.selectionAfter)
    history.commit(typing(history.package, 'type-2', moved.focusTextNodeId, 1, ' 설명', 2))
    expect(history.stats().undoEntries).toBe(1)
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain(side === 'before'
      ? '<hp:run charPrIDRef="0"><hp:t>표 설명</hp:t><hp:tbl id="scope-table"'
      : '</hp:tr></hp:tbl><hp:t>표 설명</hp:t></hp:run><hp:linesegarray><hp:lineseg vertpos="3200"')
    expect(edited.length).toBe(original.toString('utf8').length + '<hp:t>표 설명</hp:t>'.length)

    const projected = await decodeViewerDocument(history.package)
    const paragraph = paragraphWith(projected, moved.focusTextNodeId)!
    const shape = paragraph.content.map((item) => item.type === 'text' ? (item.text || item.sourceAnchor!.textNodeId.split(':').pop()) : item.type)
    expect(shape).toEqual(side === 'before' ? ['표 설명', 'table', 'table-after'] : ['table-before', 'table', '표 설명'])
    // 새 글자는 일반 anchor로 입력을 이어 받고 문단 모양은 바꿀 수 있지만 글자 모양·문단 나눔은 막는다.
    const capability = editingCapabilities(projected, caret(moved.focusTextNodeId, 4))
    expect(capability.focus).toMatchObject({ tableParagraph: true, text: '표 설명' })
    expect(capability.focus?.tableCaret).toBeUndefined()
    expect(capability.paragraphStyle).toEqual({ available: true })
    expect(capability.characterStyle).toEqual({ available: false, reason: 'TABLE_PARAGRAPH' })
    expect(() => planSplitParagraph(history.package, caret(moved.focusTextNodeId, 1))).toThrow(HwpxEditConflictError)

    const undone = history.undo()!
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    expect(undone.selection).toEqual(caret(target))
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
  })

  test('표 뒤 빈 <hp:t/>는 일반 anchor로 펼쳐 쓰고, 문단 모양은 표 문단에 적용된다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'scope-trailing.hwpx'))
    const original = source.readEntry(sectionPath)
    const document = await decodeViewerDocument(source)
    const trailing = listEditingAnchorContexts(document).find((context) => context.tableParagraph && !context.tableCaret)!
    const result = applyEditTransaction(source, typing(source, 'trailing', trailing.textNodeId, 0, '뒤'))
    expect(result.package.readEntry(sectionPath).toString('utf8')).toContain('</hp:tbl><hp:t>뒤</hp:t></hp:run>')
    expect(applyEditTransaction(result.package, result.inverse!).package.readEntry(sectionPath)).toEqual(original)
    const styled = applyParagraphStyleCommand(result.package, { type: 'apply-paragraph-style', sectionPath, textNodeId: trailing.textNodeId, align: 'CENTER' })
    expect(styled.changed).toBe(true)
    expect(() => applyCharacterStyleCommand(result.package, { type: 'apply-character-style', sectionPath, textNodeId: trailing.textNodeId, bold: true }))
      .toThrow(HwpxEditConflictError)
  })

  test('표 앞·뒤 caret은 0 위치 caret만 받고 글자·문단 모양·문단 나눔을 거부한다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'scope-reject.hwpx'))
    const target = tableCaretAnchorId(sectionPath, 5, 'after')
    expect(() => applyEditTransaction(source, { ...typing(source, 'bad', target, 0, '가'), selectionBefore: caret(target, 1) }))
      .toThrow(HwpxEditConflictError)
    expect(() => applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: target, bold: true }))
      .toThrow(HwpxEditConflictError)
    expect(() => applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: target, align: 'CENTER' }))
      .toThrow(HwpxEditConflictError)
    expect(() => planSplitParagraph(source, caret(target))).toThrow(HwpxEditConflictError)
    // 이미 글자가 있는 쪽(표 뒤 <hp:t/>)이나 없는 문단의 합성 id는 찾지 못한다.
    expect(resolveHwpxCaretAnchor(source, sectionPath, tableCaretAnchorId(sectionPath, 8, 'after'))).toBeUndefined()
    expect(resolveHwpxCaretAnchor(source, sectionPath, tableCaretAnchorId(sectionPath, 0, 'before'))).toBeUndefined()
    // range 계획은 첫 입력 command 하나를 만든다.
    expect(planReplaceSelection(source, caret(target), '가').commands).toEqual([
      { type: 'replace-text', sectionPath, textNodeId: target, from: 0, to: 0, insert: '가' }
    ])
  })

  test('복구 기록 replay 검사는 표 앞·뒤 anchor 글자 command를 받고 실행 취소 전용 option·다른 section anchor는 거부한다', async () => {
    const source = await HwpxSourcePackage.open(createEditScopeHwpx(directory, 'scope-replay.hwpx'))
    const target = tableCaretAnchorId(sectionPath, 5, 'before')
    const transaction = typing(source, 'replay', target, 0, '가')
    expect(() => assertReplayableTransaction(transaction, source)).not.toThrow()
    const command = transaction.commands[0] as Extract<EditTransaction['commands'][number], { type: 'replace-text' }>
    for (const forged of [
      { ...command, removeCreatedText: {} },
      { ...command, insertSource: '가' },
      { ...command, restoreSelfClosingTag: '<hp:t/>' },
      { ...command, textNodeId: 'Contents/section1.xml#hp:p:5:table-before' },
      { ...command, textNodeId: `${sectionPath}#hp:p:5:table-middle` },
      { ...command, from: 2, to: 1 }
    ]) {
      expect(() => assertReplayableTransaction({ ...transaction, commands: [forged] }, source)).toThrow(HwpxEditConflictError)
    }
  })

  test('쪽을 넘는 표의 조각은 표 앞 글자를 첫 조각에만, 표 뒤 글자를 마지막 조각에만 둔다', async () => {
    const source = await HwpxSourcePackage.open(createCellFragmentHwpx(directory))
    const document = await decodeViewerDocument(source)
    const pages = paginateViewerDocument(document)
    const fragments = pages.flatMap((page) => page.blocks).filter((block) => block.id.startsWith('s0:p0:fragment'))
    expect(fragments.length).toBeGreaterThan(1)
    const carets = fragments.map((block) => block.content.filter((item) => item.type === 'text').map((item) => item.type === 'text' ? item.sourceAnchor?.textNodeId.split(':').pop() : ''))
    expect(carets[0]).toEqual(['table-before'])
    expect(carets[carets.length - 1]).toEqual(['table-after'])
    expect(carets.slice(1, -1).every((items) => items.length === 0)).toBe(true)
  })
})
