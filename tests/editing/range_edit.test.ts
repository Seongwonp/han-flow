import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { EditorSelection } from '../../src/core/editing/selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('multi-run range replacement', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-range-edit-'))
  const fixture = createRoundTripHwpx(directory)
  const sectionPath = 'Contents/section0.xml'

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('여러 run 선택을 첫·중간·마지막 text command로 계획한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const start = anchors.findIndex((anchor) => anchor.text.length >= 2)
    const end = start + 2
    const selection: EditorSelection = {
      sectionPath,
      anchorTextNodeId: anchors[start].textNodeId,
      anchorOffset: 1,
      focusTextNodeId: anchors[end].textNodeId,
      focusOffset: Math.min(1, anchors[end].text.length)
    }
    const plan = planReplaceSelection(source, selection, '교체')

    expect(plan.commands).toHaveLength(3)
    expect(plan.commands[0]).toMatchObject({
      textNodeId: anchors[start].textNodeId,
      from: 1,
      to: anchors[start].text.length,
      insert: '교체'
    })
    expect(plan.commands[1]).toMatchObject({
      textNodeId: anchors[start + 1].textNodeId,
      from: 0,
      to: anchors[start + 1].text.length,
      insert: ''
    })
    expect(plan.commands[2]).toMatchObject({
      textNodeId: anchors[end].textNodeId,
      from: 0,
      to: Math.min(1, anchors[end].text.length),
      insert: ''
    })
    expect(plan.selectionAfter).toMatchObject({
      anchorTextNodeId: anchors[start].textNodeId,
      anchorOffset: 3,
      focusTextNodeId: anchors[start].textNodeId,
      focusOffset: 3
    })
  })

  test('역방향 여러 run에 여러 줄 plain text를 붙이고 undo 선택을 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, sectionPath).filter((anchor) => anchor.text.length >= 2)
    const first = anchors[0]
    const last = anchors[1]
    const backward: EditorSelection = {
      sectionPath,
      anchorTextNodeId: last.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: first.textNodeId,
      focusOffset: 1
    }
    const plan = planReplaceSelection(source, backward, '범위\n붙여넣기')
    const transaction: EditTransaction = {
      id: 'replace-range',
      baseRevision: source.revision,
      commands: plan.commands,
      selectionBefore: backward,
      selectionAfter: plan.selectionAfter,
      inputType: 'insertText',
      timestamp: 1
    }
    const history = new HwpxEditHistory(source)
    history.commit(transaction)

    expect(history.stats().undoEntries).toBe(1)
    expect(history.selection).toEqual(plan.selectionAfter)
    expect(history.package.readEntry(sectionPath).toString('utf8')).toContain(
      '범위<hp:lineBreak/>붙여넣기'
    )
    expect(history.undo()?.selection).toEqual(backward)
    expect(history.redo()?.selection).toEqual(plan.selectionAfter)
  })
})
