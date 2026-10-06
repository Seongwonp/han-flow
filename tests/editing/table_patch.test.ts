import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyReplaceTableFragmentCommand,
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planMergeTableCellRight,
  planSplitTableCell,
  planInsertTableRowAfter
} from '../../src/core/editing/table_patch'
import { createEditorSelection } from '../../src/core/editing/selection'
import { listSelectableMergedTableCells } from '../../src/core/editing/table_cell_selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import {
  createCompatibilityHwpx,
  createRoundTripHwpx,
  createTableColumnHwpx
} from '../fixtures/public/create_synthetic_hwpx'
import {
  attributeInsideValue,
  cdataWithMarkup,
  cdataWithQuote,
  entityAttribute,
  mergedCellWithTrailingLineSegments,
  SPLIT_RIGHT_CELL
} from './table_divergence_repros'

const sectionPath = 'Contents/section0.xml'

describe('HWPX 표 행 patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-row-'))
  const fixture = createRoundTripHwpx(directory)

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('선택한 body 행 아래에 빈 행을 추가하고 뒤쪽 주소와 inverse bytes를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '긴 설명')!
    const selection = {
      sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 2,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 2
    }
    const original = source.readEntry(sectionPath)
    const plan = planInsertTableRowAfter(source, selection)
    expect(plan.selectionAfter).toEqual(selection)
    const result = applyReplaceTableFragmentCommand(source, plan.command)

    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain('<hp:tbl id="public-table" rowCnt="5" colCnt="1"')
    expect(xml).toContain('<hp:sz width="6000" height="11500"')
    expect(xml).toContain('<hp:cellAddr colAddr="0" rowAddr="2"')
    expect(xml).toContain('<hp:cellAddr colAddr="0" rowAddr="4"')
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    expect(table).toMatchObject({ type: 'table', rowCount: 5, height: 11500 })
    expect(document.sections[0].blocks[0].layoutHeight).toBe(11500)
    if (!table || table.type !== 'table') throw new Error('추가한 표 projection이 없습니다.')
    expect(table.rows[2].cells[0].paragraphs[0].content[0]).toMatchObject({ text: '' })
    expect(table.rows[3].cells[0].paragraphs[0].content[0]).toMatchObject({ text: '다음 제목' })

    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(original)
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('병합·rowSpan 표와 반복 머리글 셀 기준 요청은 fail-closed한다', async () => {
    const mergedPath = createCompatibilityHwpx(directory, 'row-span-table.hwpx')
    const merged = await HwpxSourcePackage.open(mergedPath)
    const mergedAnchor = listHwpxTextAnchors(merged, sectionPath).find((item) => item.text === 'A')!
    expect(() => planInsertTableRowAfter(merged, {
      sectionPath,
      anchorTextNodeId: mergedAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: mergedAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('병합·span')

    const source = await HwpxSourcePackage.open(fixture)
    const header = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '공개 헤더')!
    expect(() => planInsertTableRowAfter(source, {
      sectionPath,
      anchorTextNodeId: header.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: header.textNodeId,
      focusOffset: 0
    })).toThrow('반복 머리글 행')
  })

  test('현재 body 행을 삭제하고 다음 행으로 selection을 옮기며 마지막 body 행은 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const current = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '긴 설명')!
    const next = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '다음 제목')!
    const selection = {
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 2,
      focusTextNodeId: current.textNodeId,
      focusOffset: 2
    }
    const plan = planDeleteTableRow(source, selection)
    expect(plan.selectionAfter).toEqual({
      sectionPath,
      anchorTextNodeId: `${sectionPath}#hp:t:${next.ordinal - 1}`,
      anchorOffset: 0,
      focusTextNodeId: `${sectionPath}#hp:t:${next.ordinal - 1}`,
      focusOffset: 0
    })
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain('<hp:tbl id="public-table" rowCnt="3" colCnt="1"')
    expect(xml).toContain('<hp:sz width="6000" height="5500"')
    expect(xml).not.toContain('긴 설명')
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    expect(table).toMatchObject({ type: 'table', rowCount: 3, height: 5500 })
    if (!table || table.type !== 'table') throw new Error('삭제한 표 projection이 없습니다.')
    expect(table.rows[1].cells[0].paragraphs[0].content[0]).toMatchObject({ text: '다음 제목' })

    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))

    const nextAnchor = listHwpxTextAnchors(result.package, sectionPath).find((item) => item.text === '다음 제목')!
    const secondPlan = planDeleteTableRow(result.package, {
      sectionPath,
      anchorTextNodeId: nextAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: nextAnchor.textNodeId,
      focusOffset: 0
    })
    const second = applyReplaceTableFragmentCommand(result.package, secondPlan.command)
    const lastBody = listHwpxTextAnchors(second.package, sectionPath).find((item) => item.text === '다음 본문')!
    expect(() => planDeleteTableRow(second.package, {
      sectionPath,
      anchorTextNodeId: lastBody.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: lastBody.textNodeId,
      focusOffset: 0
    })).toThrow('하나 이상의 body 행')
  })
})

describe('HWPX 표 열 patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-column-'))
  const fixture = createTableColumnHwpx(directory)

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('선택 열 오른쪽에 빈 열을 추가하고 너비·주소·selection·inverse를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'A2')!
    const selection = {
      sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 2
    }
    const plan = planInsertTableColumnAfter(source, selection)
    expect(plan.selectionAfter).toEqual({
      ...selection,
      anchorTextNodeId: `${sectionPath}#hp:t:${anchor.ordinal + 1}`,
      focusTextNodeId: `${sectionPath}#hp:t:${anchor.ordinal + 1}`
    })
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain('<hp:tbl id="column-table" rowCnt="3" colCnt="4"')
    expect(xml).toContain('<hp:sz width="8000" height="6000"')
    expect(xml.match(/colAddr="2"/g)).toHaveLength(3)
    expect(xml.match(/colAddr="3"/g)).toHaveLength(3)
    expect(xml).toContain('<hp:p id="123" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t>')
    expect(xml).toContain('<hp:p id="125" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t>')

    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    expect(table).toMatchObject({ type: 'table', columnCount: 4, width: 8000 })
    if (!table || table.type !== 'table') throw new Error('추가한 표 projection이 없습니다.')
    expect(table.rows.map((row) => row.cells.map((cell) => cell.paragraphs[0].content[0]))).toEqual([
      [expect.objectContaining({ text: 'H1' }), expect.objectContaining({ text: 'H2' }), expect.objectContaining({ text: '' }), expect.objectContaining({ text: 'H3' })],
      [expect.objectContaining({ text: 'A1' }), expect.objectContaining({ text: 'A2' }), expect.objectContaining({ text: '' }), expect.objectContaining({ text: 'A3' })],
      [expect.objectContaining({ text: 'B1' }), expect.objectContaining({ text: 'B2' }), expect.objectContaining({ text: '' }), expect.objectContaining({ text: 'B3' })]
    ])

    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('병합 구조와 행마다 너비가 다른 열은 fail-closed한다', async () => {
    const mergedPath = createCompatibilityHwpx(directory, 'merged-column.hwpx')
    const merged = await HwpxSourcePackage.open(mergedPath)
    const mergedAnchor = listHwpxTextAnchors(merged, sectionPath).find((item) => item.text === 'A')!
    expect(() => planInsertTableColumnAfter(merged, {
      sectionPath,
      anchorTextNodeId: mergedAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: mergedAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('병합·span')

    const source = await HwpxSourcePackage.open(fixture)
    const uneven = source.withEntry(sectionPath, Buffer.from(
      source.readEntry(sectionPath).toString('utf8').replace(
        '<hp:cellSz width="2000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="121"',
        '<hp:cellSz width="1900" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="121"'
      )
    ))
    const unevenAnchor = listHwpxTextAnchors(uneven, sectionPath).find((item) => item.text === 'A2')!
    expect(() => planInsertTableColumnAfter(uneven, {
      sectionPath,
      anchorTextNodeId: unevenAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: unevenAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('행마다 너비가 다른 열')
  })

  test('마지막 열 뒤에도 추가하고 반복 머리글 셀 기준 요청은 차단한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const last = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'B3')!
    const selection = {
      sectionPath,
      anchorTextNodeId: last.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: last.textNodeId,
      focusOffset: 1
    }
    const plan = planInsertTableColumnAfter(source, selection)
    expect(plan.selectionAfter.anchorTextNodeId).toBe(`${sectionPath}#hp:t:${last.ordinal + 2}`)
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    if (!table || table.type !== 'table') throw new Error('마지막에 추가한 표 projection이 없습니다.')
    expect(table.rows[2].cells.map((cell) => cell.paragraphs[0].content[0])).toEqual([
      expect.objectContaining({ text: 'B1' }),
      expect.objectContaining({ text: 'B2' }),
      expect.objectContaining({ text: 'B3' }),
      expect.objectContaining({ text: '' })
    ])

    const header = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'H2')!
    expect(() => planInsertTableColumnAfter(source, {
      sectionPath,
      anchorTextNodeId: header.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: header.textNodeId,
      focusOffset: 0
    })).toThrow('반복 머리글 행')
  })

  test('중간 열을 삭제하고 오른쪽 셀로 selection을 옮기며 inverse bytes를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const current = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'A2')!
    const selection = {
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: current.textNodeId,
      focusOffset: 1
    }
    const plan = planDeleteTableColumn(source, selection)
    expect(plan.selectionAfter).toEqual({
      sectionPath,
      anchorTextNodeId: `${sectionPath}#hp:t:3`,
      anchorOffset: 0,
      focusTextNodeId: `${sectionPath}#hp:t:3`,
      focusOffset: 0
    })
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain('<hp:tbl id="column-table" rowCnt="3" colCnt="2"')
    expect(xml).toContain('<hp:sz width="4000" height="6000"')
    expect(xml.match(/colAddr="0"/g)).toHaveLength(3)
    expect(xml.match(/colAddr="1"/g)).toHaveLength(3)
    expect(xml).not.toContain('H2')
    expect(xml).not.toContain('A2')
    expect(xml).not.toContain('B2')
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    expect(table).toMatchObject({ type: 'table', columnCount: 2, width: 4000 })
    if (!table || table.type !== 'table') throw new Error('삭제한 표 projection이 없습니다.')
    expect(table.rows.map((row) => row.cells.map((cell) => cell.paragraphs[0].content[0]))).toEqual([
      [expect.objectContaining({ text: 'H1' }), expect.objectContaining({ text: 'H3' })],
      [expect.objectContaining({ text: 'A1' }), expect.objectContaining({ text: 'A3' })],
      [expect.objectContaining({ text: 'B1' }), expect.objectContaining({ text: 'B3' })]
    ])

    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('마지막 열 삭제는 왼쪽 셀로 이동하고 하나뿐인 열과 불균일 너비는 차단한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const last = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'B3')!
    const lastPlan = planDeleteTableColumn(source, {
      sectionPath,
      anchorTextNodeId: last.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: last.textNodeId,
      focusOffset: 1
    })
    expect(lastPlan.selectionAfter.anchorTextNodeId).toBe(`${sectionPath}#hp:t:5`)
    const lastResult = applyReplaceTableFragmentCommand(source, lastPlan.command)
    expect(listHwpxTextAnchors(lastResult.package, sectionPath).find((item) => item.ordinal === 5)?.text).toBe('B2')

    const singlePath = createRoundTripHwpx(directory, 'single-column.hwpx')
    const single = await HwpxSourcePackage.open(singlePath)
    const singleAnchor = listHwpxTextAnchors(single, sectionPath).find((item) => item.text === '긴 설명')!
    expect(() => planDeleteTableColumn(single, {
      sectionPath,
      anchorTextNodeId: singleAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: singleAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('하나 이상의 열')

    const uneven = source.withEntry(sectionPath, Buffer.from(
      source.readEntry(sectionPath).toString('utf8').replace(
        '<hp:cellSz width="2000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="121"',
        '<hp:cellSz width="1900" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="121"'
      )
    ))
    const unevenAnchor = listHwpxTextAnchors(uneven, sectionPath).find((item) => item.text === 'A2')!
    expect(() => planDeleteTableColumn(uneven, {
      sectionPath,
      anchorTextNodeId: unevenAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: unevenAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('행마다 너비가 다른 열')

    const mergedPath = createCompatibilityHwpx(directory, 'delete-merged-column.hwpx')
    const merged = await HwpxSourcePackage.open(mergedPath)
    const mergedAnchor = listHwpxTextAnchors(merged, sectionPath).find((item) => item.text === 'A')!
    expect(() => planDeleteTableColumn(merged, {
      sectionPath,
      anchorTextNodeId: mergedAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: mergedAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('병합·span')
  })
})

describe('HWPX 표 셀 병합 patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-cell-merge-'))
  const fixture = createTableColumnHwpx(directory, 'merge-table-cell.hwpx')

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('현재 cell과 오른쪽 cell을 병합하고 문단·논리 열·inverse bytes를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const current = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'A1')!
    const selection = {
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: current.textNodeId,
      focusOffset: 1
    }
    const plan = planMergeTableCellRight(source, selection)
    expect(plan.selectionAfter).toEqual({
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: current.textNodeId,
      focusOffset: 0
    })
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain('<hp:tbl id="column-table" rowCnt="3" colCnt="3"')
    expect(xml).toContain('<hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="2" rowSpan="1"/><hp:cellSz width="4000" height="2000"/>')
    expect(xml).toContain('<hp:t>A1</hp:t></hp:run></hp:p><hp:p id="111" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>A2</hp:t>')
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    expect(table).toMatchObject({ type: 'table', columnCount: 3, width: 6000 })
    if (!table || table.type !== 'table') throw new Error('병합한 표 projection이 없습니다.')
    expect(table.rows[1].cells).toHaveLength(2)
    expect(table.rows[1].cells[0]).toMatchObject({ column: 0, columnSpan: 2, width: 4000 })
    expect(table.rows[1].cells[0].paragraphs.map((paragraph) => paragraph.content[0])).toEqual([
      expect.objectContaining({ text: 'A1' }),
      expect.objectContaining({ text: 'A2' })
    ])
    expect(table.rows[1].cells[0].paragraphs.every((paragraph) => paragraph.layoutHeight === 0)).toBe(true)
    expect(table.rows[1].cells[1]).toMatchObject({ column: 2, columnSpan: 1, width: 2000 })

    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('마지막·머리글·다른 모양 cell과 기존 병합 표는 fail-closed한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const request = (text: string) => {
      const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === text)!
      return {
        sectionPath,
        anchorTextNodeId: anchor.textNodeId,
        anchorOffset: 0,
        focusTextNodeId: anchor.textNodeId,
        focusOffset: 0
      }
    }
    expect(() => planMergeTableCellRight(source, request('A3'))).toThrow('오른쪽에 병합할')
    expect(() => planMergeTableCellRight(source, request('H1'))).toThrow('반복 머리글 행')

    const differentStyle = source.withEntry(sectionPath, Buffer.from(
      source.readEntry(sectionPath).toString('utf8').replace(
        '<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="1" rowAddr="1"',
        '<hp:tc borderFillIDRef="2" header="0"><hp:cellAddr colAddr="1" rowAddr="1"'
      )
    ))
    const differentAnchor = listHwpxTextAnchors(differentStyle, sectionPath).find((item) => item.text === 'A1')!
    expect(() => planMergeTableCellRight(differentStyle, {
      sectionPath,
      anchorTextNodeId: differentAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: differentAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('모양 속성이 다른')

    const mergedPath = createCompatibilityHwpx(directory, 'already-merged-table.hwpx')
    const merged = await HwpxSourcePackage.open(mergedPath)
    const mergedAnchor = listHwpxTextAnchors(merged, sectionPath).find((item) => item.text === 'A')!
    expect(() => planMergeTableCellRight(merged, {
      sectionPath,
      anchorTextNodeId: mergedAnchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: mergedAnchor.textNodeId,
      focusOffset: 0
    })).toThrow('병합·span')
  })

  test('선택한 수평 1×2 병합 셀을 원래 열 너비로 분할하고 inverse bytes를 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const current = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'A1')!
    const merged = applyReplaceTableFragmentCommand(source, planMergeTableCellRight(source, {
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: current.textNodeId,
      focusOffset: 0
    }).command)
    const mergedDocument = await decodeViewerDocument(merged.package)
    const cellSelection = listSelectableMergedTableCells(mergedDocument)[0]
    expect(cellSelection).toBeDefined()

    const plan = planSplitTableCell(merged.package, cellSelection)
    expect(plan.selectionAfter).toEqual({
      sectionPath,
      anchorTextNodeId: cellSelection.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: cellSelection.textNodeId,
      focusOffset: 0
    })
    const split = applyReplaceTableFragmentCommand(merged.package, plan.command)
    const document = await decodeViewerDocument(split.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    if (!table || table.type !== 'table') throw new Error('분할한 표 projection이 없습니다.')
    expect(table).toMatchObject({ columnCount: 3, width: 6000 })
    expect(table.rows[1].cells).toHaveLength(3)
    expect(table.rows[1].cells[0]).toMatchObject({ column: 0, columnSpan: 1, width: 2000 })
    expect(table.rows[1].cells[0].paragraphs.map((paragraph) => paragraph.content[0])).toEqual([
      expect.objectContaining({ text: 'A1' }),
      expect.objectContaining({ text: 'A2' })
    ])
    expect(table.rows[1].cells[1]).toMatchObject({ column: 1, columnSpan: 1, width: 2000 })
    expect(table.rows[1].cells[1].paragraphs).toHaveLength(1)
    expect(table.rows[1].cells[1].paragraphs[0].content[0]).toMatchObject({ text: '' })
    expect(table.rows[1].cells[2]).toMatchObject({ column: 2, columnSpan: 1, width: 2000 })
    expect(table.rows[1].cells[2].paragraphs[0].content[0]).toMatchObject({ text: 'A3' })

    const restored = applyReplaceTableFragmentCommand(split.package, split.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(merged.package.readEntry(sectionPath))
    const redone = applyReplaceTableFragmentCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry(sectionPath)).toEqual(split.package.readEntry(sectionPath))
  })

  test('stale 주소와 일관되지 않은 대응 열 너비는 분할을 fail-closed한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const current = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'A1')!
    const merged = applyReplaceTableFragmentCommand(source, planMergeTableCellRight(source, {
      sectionPath,
      anchorTextNodeId: current.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: current.textNodeId,
      focusOffset: 0
    }).command)
    const selection = listSelectableMergedTableCells(await decodeViewerDocument(merged.package))[0]
    expect(() => planSplitTableCell(merged.package, { ...selection, column: 1 })).toThrow(
      '주소가 source와 일치하지 않습니다'
    )

    const inconsistent = merged.package.withEntry(sectionPath, Buffer.from(
      merged.package.readEntry(sectionPath).toString('utf8').replace(
        '<hp:cellAddr colAddr="0" rowAddr="2"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="2000"',
        '<hp:cellAddr colAddr="0" rowAddr="2"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="1900"'
      )
    ))
    expect(() => planSplitTableCell(inconsistent, selection)).toThrow('일관된 분할 열 너비')
  })
})

describe('HWPX 표 구조 command 원문 처리(전환 전 문자열 경로의 잠재 버그 재현)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-repro-'))
  const fixture = createTableColumnHwpx(directory, 'table-repro.hwpx')

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  async function variant(transform: (xml: string) => string): Promise<HwpxSourcePackage> {
    const source = await HwpxSourcePackage.open(fixture)
    return source.withEntry(sectionPath, Buffer.from(transform(source.readEntry(sectionPath).toString('utf8'))))
  }

  function caretAt(source: HwpxSourcePackage, text: string) {
    const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === text)!
    return createEditorSelection(sectionPath, anchor.textNodeId, 0)
  }

  function insertRowBelow(source: HwpxSourcePackage, text: string): string {
    const result = applyReplaceTableFragmentCommand(source, planInsertTableRowAfter(source, caretAt(source, text)).command)
    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
    return result.package.readEntry(sectionPath).toString('utf8')
  }

  test('CDATA 안의 `>`·가짜 hp:t·따옴표를 markup으로 읽지 않고 선택한 셀 아래에 행을 추가한다', async () => {
    // 전환 전: CDATA를 일반 `<!` tag로 읽어 첫 `>`에서 끝내고 안의 `<hp:t>`를 element로 세어 anchor가 한 칸 앞 셀(H3,
    // 반복 머리글)을 가리켜 "반복 머리글 행을 기준으로 행을 추가할 수 없습니다."로 거부했다.
    const withMarkup = await variant(cdataWithMarkup)
    const xml = insertRowBelow(withMarkup, 'A1')
    expect(xml).toContain('<![CDATA[a><hp:t>x</hp:t>]]>')
    expect(xml).toContain('rowCnt="4"')
    expect(xml).toContain('<hp:cellAddr colAddr="0" rowAddr="2"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="2000" height="2000"/><hp:cellMargin left="100" right="100" top="100" bottom="100"/><hp:subList vertAlign="CENTER"><hp:p id="123" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t></hp:t>')
    // 전환 전: 짝 없는 작은따옴표 뒤를 따옴표 안으로 읽어 "끝나지 않은 XML tag가 있습니다."로 거부했다.
    const withQuote = await variant(cdataWithQuote)
    expect(insertRowBelow(withQuote, 'A1')).toContain("<![CDATA[it's]]>")
  })

  test('다른 attribute 값 안의 같은 이름을 읽거나 고치지 않는다', async () => {
    // 전환 전: 정규식 setAttribute가 첫 일치(note 값 안)를 고쳐 `note=" rowAddr='3'" … rowAddr="2"`를 썼다(행 주소 중복).
    const xml = insertRowBelow(await variant(attributeInsideValue), 'A1')
    expect(xml).toContain(`<hp:cellAddr note=" rowAddr='2'" colAddr="0" rowAddr="3"/>`)
  })

  test('문자 참조로 쓴 주소 attribute를 해석해 검사하고 새 값으로 쓴다', async () => {
    // 전환 전: `rowAddr="&#50;"`를 숫자로 읽지 못해 "병합·span 또는 불연속 주소…"로 거부했다.
    const xml = insertRowBelow(await variant(entityAttribute), 'A1')
    expect(xml).toContain('<hp:cellAddr colAddr="0" rowAddr="3"/>')
  })

  test('뒤 문단에 줄 배치 정보가 있는 병합 셀도 올바른 XML로 분할한다', async () => {
    // 전환 전: 지울 문단과 그 안의 hp:linesegarray를 같은 원문 offset으로 따로 지워 범위가 겹쳤고, 복제한 오른쪽 셀이
    // `</hp:subList></hp:tc>` 없이 끝나는 잘못된 XML이 되었다.
    const source = await variant(mergedCellWithTrailingLineSegments)
    const selection = listSelectableMergedTableCells(await decodeViewerDocument(source))[0]
    expect(selection).toMatchObject({ row: 1, column: 0 })
    const plan = planSplitTableCell(source, selection)
    expect(plan.command.replacementFragment).toContain(SPLIT_RIGHT_CELL)
    const result = applyReplaceTableFragmentCommand(source, plan.command)
    const document = await decodeViewerDocument(result.package)
    const table = document.sections[0].blocks[0].content.find((item) => item.type === 'table')
    if (!table || table.type !== 'table') throw new Error('분할한 표 projection이 없습니다.')
    expect(table.rows[1].cells.map((cell) => [cell.column, cell.columnSpan, cell.width])).toEqual([
      [0, 1, 2000],
      [1, 1, 2000],
      [2, 1, 2000]
    ])
    const restored = applyReplaceTableFragmentCommand(result.package, result.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(source.readEntry(sectionPath))
  })

  test('손대지 않은 셀의 entity 표기와 공백은 그대로 두고 복제한 셀만 비운다', async () => {
    const source = await variant((xml) => xml
      .replace('<hp:t>A2</hp:t>', '<hp:t>&#x41;&apos;2&#13;</hp:t>')
      .replace('<hp:t>B2</hp:t>', '<hp:t>B&#50;</hp:t>'))
    const xml = insertRowBelow(source, 'A1')
    expect(xml).toContain('<hp:t>&#x41;&apos;2&#13;</hp:t>')
    expect(xml).toContain('<hp:t>B&#50;</hp:t>')
    expect(xml).toContain('</hp:tr>\n    <hp:tr><hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="3"/>')
  })

  test('올바른 XML이 아닌 교체 fragment는 적용하지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const plan = planInsertTableRowAfter(source, caretAt(source, 'A1'))
    expect(() => applyReplaceTableFragmentCommand(source, {
      ...plan.command,
      replacementFragment: '<hp:tbl><hp:tr>'
    })).toThrow('표 fragment가 올바른 XML이 아니어서')
  })
})
