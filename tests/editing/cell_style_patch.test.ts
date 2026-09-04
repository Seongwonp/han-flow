import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyCellStyleCommand,
  applyRestoreCellStyleCommand
} from '../../src/core/editing/cell_style_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCompatibilityHwpx, createRoundTripHwpx, roundTripSentinels } from '../fixtures/public/create_synthetic_hwpx'

describe('HWPX 표 셀 모양 patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-cell-style-'))
  const fixture = createRoundTripHwpx(directory)
  const sectionPath = 'Contents/section0.xml'

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('기존 borderFill을 복제해 한 셀의 배경·사방 테두리만 바꾸고 inverse로 bytes를 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '긴 설명')!
    const originalHeader = source.readEntry('Contents/header.xml')
    const originalSection = source.readEntry(sectionPath)
    const result = applyCellStyleCommand(source, {
      type: 'apply-cell-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      backgroundColor: '#AABBCC',
      borderColor: '#112233',
      borderWidth: 0.4,
      borderType: 'SOLID'
    })

    expect(result.changed).toBe(true)
    expect(result.package.revision).toBe(2)
    expect(result.lossReport.modifiedEntries).toEqual(['Contents/header.xml', sectionPath])
    const header = result.package.readEntry('Contents/header.xml').toString('utf8')
    expect(header.match(/<hh:borderFill\b/g)).toHaveLength(2)
    expect(header).toContain('faceColor="#AABBCC"')
    expect(header.match(/width="0.4" color="#112233"/g)).toHaveLength(4)
    expect(header).toContain(roundTripSentinels.headerNode)
    const section = result.package.readEntry(sectionPath).toString('utf8')
    expect(section).toContain('<hp:tc borderFillIDRef="2" header="0"><hp:cellAddr colAddr="0" rowAddr="1"')
    expect(section).toContain(roundTripSentinels.sectionNode)

    const document = await decodeViewerDocument(result.package)
    expect(document.cellStyles['2']).toMatchObject({
      backgroundColor: '#AABBCC',
      left: { type: 'SOLID', widthMm: 0.4, color: '#112233' }
    })
    const restored = applyRestoreCellStyleCommand(result.package, result.inverse!)
    expect(restored.package.readEntry('Contents/header.xml')).toEqual(originalHeader)
    expect(restored.package.readEntry(sectionPath)).toEqual(originalSection)
    const redone = applyRestoreCellStyleCommand(restored.package, restored.inverse!)
    expect(redone.package.readEntry('Contents/header.xml')).toEqual(result.package.readEntry('Contents/header.xml'))
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('머리글 셀과 병합 셀은 source 계층에서 fail-closed한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const header = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === '공개 헤더')!
    expect(() => applyCellStyleCommand(source, {
      type: 'apply-cell-style', sectionPath, textNodeId: header.textNodeId, backgroundColor: '#FFFFFF'
    })).toThrow('머리글 또는 병합된 표 셀')

    const mergedFixture = createCompatibilityHwpx(directory, 'merged-cell-style.hwpx')
    const mergedSource = await HwpxSourcePackage.open(mergedFixture)
    const mergedAnchor = listHwpxTextAnchors(mergedSource, sectionPath).find((item) => item.text === 'R')!
    expect(() => applyCellStyleCommand(mergedSource, {
      type: 'apply-cell-style', sectionPath, textNodeId: mergedAnchor.textNodeId, borderWidth: 1
    })).toThrow('머리글 또는 병합된 표 셀')
  })
})
