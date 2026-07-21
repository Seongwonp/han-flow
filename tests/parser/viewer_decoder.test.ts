import { existsSync } from 'fs'
import { resolve } from 'path'
import { ViewerTable } from '../../src/core/document/viewer_document'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'

const fixture = resolve(__dirname, '../fixtures/private/m1-weekly.hwpx')
const privateTest = existsSync(fixture) ? test : test.skip

describe('AIDA ViewerDocument decoder', () => {
  privateTest('페이지와 스타일을 해석한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    expect(document.page).toEqual({
      width: 59528,
      height: 84188,
      headerOffset: 2835,
      footerOffset: 2835,
      margin: { left: 5500, right: 5669, top: 2835, bottom: 2835 }
    })
    expect(Object.keys(document.charStyles)).toHaveLength(89)
    expect(document.charStyles['2']).toMatchObject({ height: 1500, bold: true, fontFamily: '휴먼명조' })
    expect(Object.keys(document.paraStyles).length).toBeGreaterThan(60)
  })

  privateTest('첫 section의 병합 표 구조를 보존한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    expect(document.sections.map((section) => section.blocks.length)).toEqual([11, 1, 20])
    const tables = document.sections[0].blocks.flatMap((paragraph) => paragraph.content.filter((item): item is ViewerTable => item.type === 'table'))
    expect(tables).toHaveLength(7)
    expect(tables[1]).toMatchObject({ rowCount: 13, columnCount: 11, width: 47895, height: 62243 })
    expect(tables[1].rows[0].cells.map((cell) => [cell.column, cell.columnSpan, cell.rowSpan])).toEqual([
      [0, 2, 1], [2, 6, 1], [8, 3, 1]
    ])
    expect(tables[1].rows[4].cells[0]).toMatchObject({ row: 4, column: 0, columnSpan: 2, rowSpan: 3, width: 8675, height: 8847, verticalAlign: 'CENTER' })
  })

  privateTest('동일 입력에서 결정적 ID를 만든다', async () => {
    const readerA = await HwpxPackageReader.open(fixture)
    const readerB = await HwpxPackageReader.open(fixture)
    const [a, b] = await Promise.all([decodeViewerDocument(readerA), decodeViewerDocument(readerB)])
    expect(a.sections.map((section) => section.blocks.map((block) => block.id))).toEqual(b.sections.map((section) => section.blocks.map((block) => block.id)))
  })

  privateTest('이미지 resource와 셀 테두리·배경색을 연결한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    expect(Object.keys(document.resources)).toEqual(['image1', 'image2'])
    expect(document.resources.image1).toMatchObject({ path: 'BinData/image1.png', mime: 'image/png' })
    expect(document.resources.image1.data.length).toBeGreaterThan(1000)
    expect(document.cellStyles).toHaveProperty('25', {
      id: '25', backgroundColor: '#D9D9D9',
      left: { type: 'SOLID', widthMm: 0.4, color: '#000000' },
      right: { type: 'SOLID', widthMm: 0.12, color: '#000000' },
      top: { type: 'SOLID', widthMm: 0.4, color: '#000000' },
      bottom: { type: 'SOLID', widthMm: 0.12, color: '#000000' }
    })
  })
})
