import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import {
  applyReplaceParagraphFragmentCommand,
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
})
