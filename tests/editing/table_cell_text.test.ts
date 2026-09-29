import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { editingCapabilities } from '../../src/core/editing/editing_capability'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditorSelection, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCompatibilityHwpx } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

// images-rowspan fixture의 merged-table: 머리글 행(H1, H2)과 rowSpan=2 병합 셀(R)이 있다.
// 머리글 H2는 한/글처럼 빈 자기 닫힘 `<hp:t/>`로 바꿔 빈 입력 칸도 함께 확인한다.
function createFixture(directory: string): string {
  const path = createCompatibilityHwpx(directory, 'table-cell-text.hwpx')
  const zip = new AdmZip(path)
  const section = zip.readAsText(sectionPath)
  expect(section).toContain('<hp:t>H2</hp:t>')
  zip.updateFile(sectionPath, Buffer.from(section.replace('<hp:t>H2</hp:t>', '<hp:t/>')))
  zip.writeZip(path)
  return path
}

function caret(textNodeId: string, offset: number): EditorSelection {
  return { sectionPath, anchorTextNodeId: textNodeId, anchorOffset: offset, focusTextNodeId: textNodeId, focusOffset: offset }
}

function typing(source: HwpxSourcePackage, id: string, textNodeId: string, offset: number, insert: string): EditTransaction {
  return {
    id,
    baseRevision: source.revision,
    commands: [{ type: 'replace-text', sectionPath, textNodeId, from: offset, to: offset, insert }],
    selectionBefore: caret(textNodeId, offset),
    selectionAfter: caret(textNodeId, offset + insert.length),
    inputType: 'insertText',
    timestamp: 1
  }
}

describe('병합·머리글 표 셀 text 편집', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-cell-text-'))
  const fixture = createFixture(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  async function open() {
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const anchor = (text: string) => anchors.find((candidate) => candidate.text === text)!
    return { source, original: source.readEntry(sectionPath), anchor, emptyHeader: anchors.find((a) => a.text === '')! }
  }

  test.each([
    ['병합 셀', 'R', '<hp:t>R 병합</hp:t>'],
    ['머리글 셀', 'H1', '<hp:t>H1 병합</hp:t>']
  ])('%s에 입력한 text가 XML에 들어가고 undo는 원본 bytes를 복원한다', async (_label, text, expected) => {
    const { source, original, anchor } = await open()
    const target = anchor(text)
    const document = await decodeViewerDocument(source)
    const capability = editingCapabilities(document, caret(target.textNodeId, text.length))
    expect(capability.text.available).toBe(true)
    expect(capability.cellStyle).toEqual({ available: false, reason: 'TABLE_CELL_STRUCTURE' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'TABLE_CELL_STRUCTURE' })

    const history = new HwpxEditHistory(source)
    history.commit(typing(source, 'type', target.textNodeId, text.length, ' 병합'))
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain(expected)
    expect(edited.length).toBe(original.toString('utf8').length + ' 병합'.length)

    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
  })

  test('빈 <hp:t/> 머리글 셀에 이어 입력하고 undo 한 번으로 원래 자기 닫힘 tag를 복원한다', async () => {
    const { source, original, emptyHeader } = await open()
    expect(original.toString('utf8')).toContain('<hp:t/>')
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, caret(emptyHeader.textNodeId, 0)).text.available).toBe(true)

    const history = new HwpxEditHistory(source)
    history.commit(typing(source, 'type-1', emptyHeader.textNodeId, 0, '머'))
    history.commit(typing(history.package, 'type-2', emptyHeader.textNodeId, 1, '리'))
    const edited = history.package.readEntry(sectionPath).toString('utf8')
    expect(edited).toContain('<hp:t>머리</hp:t>')
    expect(edited).not.toContain('<hp:t/>')
    expect(history.stats().undoEntries).toBe(1)

    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(edited)
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
  })

  test('같은 hp:t 안 범위 치환도 병합 셀에서 적용되고 undo된다', async () => {
    const { source, original, anchor } = await open()
    const target = anchor('R')
    const selection = { ...caret(target.textNodeId, 0), focusOffset: 1 }
    const plan = planReplaceSelection(source, selection, '행 병합')
    const history = new HwpxEditHistory(source)
    history.commit({
      id: 'replace',
      baseRevision: source.revision,
      commands: plan.commands,
      selectionBefore: selection,
      selectionAfter: plan.selectionAfter,
      inputType: 'insertReplacementText',
      timestamp: 1
    })
    expect(history.package.readEntry(sectionPath).toString('utf8')).toContain('<hp:t>행 병합</hp:t>')
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(original)
  })

  test('병합·머리글 셀에서 문단 나눔 patch는 계속 거부한다', async () => {
    const { source, anchor, emptyHeader } = await open()
    for (const textNodeId of [anchor('R').textNodeId, anchor('H1').textNodeId, emptyHeader.textNodeId]) {
      expect(() => planSplitParagraph(source, caret(textNodeId, 0))).toThrow(
        '병합되지 않은 일반 표 body cell 문단만 구조를 편집할 수 있습니다.'
      )
    }
  })
})
