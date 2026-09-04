import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyReplaceTableFragmentCommand,
  planInsertTableRowAfter
} from '../../src/core/editing/table_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCompatibilityHwpx, createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

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
})
