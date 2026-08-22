import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import {
  applyReplaceParagraphFragmentCommand,
  planMergeParagraph,
  planReplaceParagraphSelection,
  planSplitParagraph
} from '../../src/core/editing/paragraph_patch'
import { createEditorSelection } from '../../src/core/editing/selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('HWPX paragraph split', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-paragraph-split-'))
  const fixture = createRoundTripHwpx(directory)
  const sectionPath = 'Contents/section0.xml'

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  async function sourceWithEditableParagraph(): Promise<HwpxSourcePackage> {
    const source = await HwpxSourcePackage.open(fixture)
    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hs:sec>',
      '<hp:p id="10" paraPrIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0"><hp:t>앞 run</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>가나<hp:lineBreak/>다라</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>뒤 run</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hs:sec>'
    )
    return source.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
  }

  async function sourceWithAdjacentParagraphs(): Promise<HwpxSourcePackage> {
    const source = await sourceWithEditableParagraph()
    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hs:sec>',
      '<hp:p id="20" paraPrIDRef="1"><hp:run charPrIDRef="3"><hp:t>다음 앞</hp:t></hp:run><hp:run charPrIDRef="4"><hp:t>다음 뒤</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hs:sec>'
    )
    return source.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
  }

  async function sourceWithThreeParagraphs(): Promise<HwpxSourcePackage> {
    const source = await sourceWithAdjacentParagraphs()
    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hs:sec>',
      '<hp:p id="21" paraPrIDRef="2"><hp:run charPrIDRef="5"><hp:t>마지막 앞</hp:t></hp:run><hp:run charPrIDRef="6"><hp:t>마지막 뒤</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hs:sec>'
    )
    return source.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
  }

  test('선택 범위를 제거하며 여러 run 문단을 둘로 나누고 layout cache를 버린다', async () => {
    const source = await sourceWithEditableParagraph()
    const anchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '가나\n다라'
    )!
    const selection = createEditorSelection(sectionPath, anchor.textNodeId, 1, 4)
    const plan = planSplitParagraph(source, selection)
    const result = applyReplaceParagraphFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')

    expect(xml).toContain('<hp:p id="10" paraPrIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0"><hp:t>앞 run</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>가</hp:t></hp:run></hp:p>')
    expect(xml).toContain('<hp:p id="11" paraPrIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="1"><hp:t>라</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>뒤 run</hp:t></hp:run></hp:p>')
    expect(plan.command.replacementFragment).not.toContain('hp:linesegarray')
    expect(plan.selectionAfter).toEqual(
      createEditorSelection(sectionPath, `${sectionPath}#hp:t:${anchor.ordinal + 1}`, 0)
    )
    expect(listHwpxTextAnchors(result.package, sectionPath).find(
      (candidate) => candidate.textNodeId === plan.selectionAfter.focusTextNodeId
    )?.text).toBe('라')
  })

  test('split을 한 history 단위로 undo/redo하고 원문 section bytes를 복원한다', async () => {
    const source = await sourceWithEditableParagraph()
    const original = source.readEntry(sectionPath)
    const anchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '가나\n다라'
    )!
    const selection = createEditorSelection(sectionPath, anchor.textNodeId, 2)
    const plan = planSplitParagraph(source, selection)
    const transaction: EditTransaction = {
      id: 'split-paragraph',
      baseRevision: source.revision,
      commands: [plan.command],
      selectionBefore: selection,
      selectionAfter: plan.selectionAfter,
      inputType: 'insertParagraph',
      timestamp: 1
    }
    const history = new HwpxEditHistory(source)
    history.setSelection(selection)
    history.commit(transaction)

    expect(history.selection).toEqual(plan.selectionAfter)
    expect(history.undo()?.selection).toEqual(selection)
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    expect(history.redo()?.selection).toEqual(plan.selectionAfter)
    expect(history.package.readEntry(sectionPath)).not.toEqual(original)
  })

  test('제어가 섞인 run과 여러 run 선택은 fail-closed한다', async () => {
    const source = await sourceWithEditableParagraph()
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const first = anchors.find((candidate) => candidate.text === '앞 run')!
    const second = anchors.find((candidate) => candidate.text === '가나\n다라')!
    expect(() => planSplitParagraph(source, {
      sectionPath,
      anchorTextNodeId: first.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: second.textNodeId,
      focusOffset: 1
    })).toThrow('여러 run')

    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '<hp:t>앞 run</hp:t>',
      '<hp:ctrl/><hp:t>앞 run</hp:t>'
    )
    const complex = source.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
    const complexAnchor = listHwpxTextAnchors(complex, sectionPath).find(
      (candidate) => candidate.text === '앞 run'
    )!
    expect(() => planSplitParagraph(
      complex,
      createEditorSelection(sectionPath, complexAnchor.textNodeId, 1)
    )).toThrow('복합 run')
  })

  test('문단 시작 Backspace와 문단 끝 Delete가 같은 인접 문단 merge를 계획한다', async () => {
    const source = await sourceWithAdjacentParagraphs()
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const previousEnd = anchors.find((candidate) => candidate.text === '뒤 run')!
    const nextStart = anchors.find((candidate) => candidate.text === '다음 앞')!
    const backward = planMergeParagraph(
      source,
      createEditorSelection(sectionPath, nextStart.textNodeId, 0),
      'previous'
    )
    const forward = planMergeParagraph(
      source,
      createEditorSelection(sectionPath, previousEnd.textNodeId, previousEnd.text.length),
      'next'
    )

    expect(backward.command).toEqual(forward.command)
    const result = applyReplaceParagraphFragmentCommand(source, backward.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(backward.command.replacementFragment).not.toContain('hp:linesegarray')
    expect(xml).toContain(
      '<hp:p id="10" paraPrIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0"><hp:t>앞 run</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>가나<hp:lineBreak/>다라</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>뒤 run</hp:t></hp:run><hp:run charPrIDRef="3"><hp:t>다음 앞</hp:t></hp:run><hp:run charPrIDRef="4"><hp:t>다음 뒤</hp:t></hp:run></hp:p>'
    )
    expect(listHwpxTextAnchors(result.package, sectionPath).find(
      (candidate) => candidate.textNodeId === nextStart.textNodeId
    )?.text).toBe('다음 앞')
  })

  test('merge를 한 history 단위로 undo/redo하고 원문 bytes를 복원한다', async () => {
    const source = await sourceWithAdjacentParagraphs()
    const original = source.readEntry(sectionPath)
    const anchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '다음 앞'
    )!
    const selection = createEditorSelection(sectionPath, anchor.textNodeId, 0)
    const plan = planMergeParagraph(source, selection, 'previous')
    const history = new HwpxEditHistory(source)
    history.setSelection(selection)
    history.commit({
      id: 'merge-paragraph',
      baseRevision: source.revision,
      commands: [plan.command],
      selectionBefore: selection,
      selectionAfter: plan.selectionAfter,
      inputType: 'deleteContentBackward',
      timestamp: 1
    })

    expect(history.selection).toEqual(selection)
    expect(history.undo()?.selection).toEqual(selection)
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    expect(history.redo()?.selection).toEqual(selection)
    expect(history.package.readEntry(sectionPath)).not.toEqual(original)
  })

  test('문단 내부 caret과 중간 XML 요소가 있는 인접 문단 merge를 거부한다', async () => {
    const source = await sourceWithAdjacentParagraphs()
    const next = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '다음 앞'
    )!
    expect(() => planMergeParagraph(
      source,
      createEditorSelection(sectionPath, next.textNodeId, 1),
      'previous'
    )).toThrow('맨 앞')

    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hp:p><hp:p id="20"',
      '</hp:p><hfx:keep/><hp:p id="20"'
    )
    const separated = source.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
    const separatedNext = listHwpxTextAnchors(separated, sectionPath).find(
      (candidate) => candidate.text === '다음 앞'
    )!
    expect(() => planMergeParagraph(
      separated,
      createEditorSelection(sectionPath, separatedNext.textNodeId, 0),
      'previous'
    )).toThrow('보존해야 할 콘텐츠')
  })

  test('여러 문단 선택을 시작 문단 하나로 치환하고 양 끝 run 서식을 보존한다', async () => {
    const source = await sourceWithThreeParagraphs()
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const start = anchors.find((candidate) => candidate.text === '가나\n다라')!
    const end = anchors.find((candidate) => candidate.text === '마지막 앞')!
    const selection = {
      sectionPath,
      anchorTextNodeId: start.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: end.textNodeId,
      focusOffset: 2
    }
    const plan = planReplaceParagraphSelection(source, selection, '교체\n')
    const result = applyReplaceParagraphFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')

    expect(plan.command.replacementFragment).not.toContain('hp:linesegarray')
    expect(xml).toContain(
      '<hp:p id="10" paraPrIDRef="0" pageBreak="0" columnBreak="0"><hp:run charPrIDRef="0"><hp:t>앞 run</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>가교체<hp:lineBreak/></hp:t></hp:run><hp:run charPrIDRef="5"><hp:t>막 앞</hp:t></hp:run><hp:run charPrIDRef="6"><hp:t>마지막 뒤</hp:t></hp:run></hp:p>'
    )
    expect(xml).not.toContain('<hp:p id="20"')
    expect(xml).not.toContain('<hp:p id="21"')
    expect(plan.selectionAfter).toEqual(
      createEditorSelection(sectionPath, start.textNodeId, 4)
    )
    expect(plan.affectedTextNodeIds[0]).toBe(start.textNodeId)
    expect(plan.affectedTextNodeIds.at(-1)).toBe(end.textNodeId)
  })

  test('역방향 여러 문단 치환을 undo/redo하고 원문 bytes·selection을 복원한다', async () => {
    const source = await sourceWithThreeParagraphs()
    const original = source.readEntry(sectionPath)
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const start = anchors.find((candidate) => candidate.text === '가나\n다라')!
    const end = anchors.find((candidate) => candidate.text === '마지막 앞')!
    const backward = {
      sectionPath,
      anchorTextNodeId: end.textNodeId,
      anchorOffset: 2,
      focusTextNodeId: start.textNodeId,
      focusOffset: 1
    }
    const plan = planReplaceParagraphSelection(source, backward, '문단범위')
    const history = new HwpxEditHistory(source)
    history.setSelection(backward)
    history.commit({
      id: 'replace-paragraph-range',
      baseRevision: source.revision,
      commands: [plan.command],
      selectionBefore: backward,
      selectionAfter: plan.selectionAfter,
      inputType: 'insertText',
      timestamp: 1
    })

    expect(history.selection).toEqual(plan.selectionAfter)
    expect(history.undo()?.selection).toEqual(backward)
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    expect(history.redo()?.selection).toEqual(plan.selectionAfter)
  })
})
