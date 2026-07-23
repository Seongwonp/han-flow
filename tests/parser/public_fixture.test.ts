import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { paginateDocument } from '../../src/core/layout/pagination'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { resolvePageDecorations } from '../../src/core/layout/page_decorations'
import { formatPageNumber } from '../../src/core/layout/page_number'
import { walkOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCellFragmentHwpx, createCompatibilityHwpx, createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('공개 synthetic HWPX 회귀 fixture', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-fixture-'))
  const fixture = createSyntheticHwpx(directory)
  const cellFragmentFixture = createCellFragmentHwpx(directory)
  const compatibilityFixture = createCompatibilityHwpx(directory)

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('section 순서와 그림·텍스트 혼합 순서를 보존한다', async () => {
    const reader = await HwpxPackageReader.open(fixture)
    const index = await reader.index()
    expect(index).toMatchObject({
      mimetype: 'application/hwp+zip',
      headerPath: 'Contents/header.xml',
      sectionPaths: ['Contents/section0.xml', 'Contents/section1.xml'],
      resourcePaths: ['BinData/image1.png']
    })
    expect(Object.keys(index.sectionSizes)).toEqual(index.sectionPaths)
    const section = walkOrderedXml(await reader.readOrderedXml('Contents/section1.xml'))
    const run = section.find((node) => node.name === 'hp:run')
    expect(run?.children.map((node) => node.name)).toEqual(['hp:secPr', 'hp:header', 'hp:pic', 'hp:t'])
  })

  test('스타일·표·이미지를 해석하고 표를 반복 헤더와 함께 나눈다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    expect(document.page).toEqual({ width: 10000, height: 10000, margin: { left: 1000, right: 1000, top: 1000, bottom: 1000 }, headerOffset: 300, footerOffset: 300 })
    expect(document.sections[0].pageNumber).toEqual({ position: 'BOTTOM_CENTER', formatType: 'DIGIT', sideChar: '-', start: undefined, hiddenOnFirstPage: false })
    expect(document.sections[0].headers[0].paragraphs[0].content).toContainEqual({ type: 'text', text: '공개 머리말', charStyleId: '0' })
    expect(document.sections[0].footers[0].paragraphs[0].content).toContainEqual({ type: 'text', text: '공개 꼬리말', charStyleId: '0' })
    expect(document.sections[0].footers[0].paragraphs[0].content).toContainEqual({ type: 'image', resourceId: 'image1', width: 200, height: 200 })
    expect(document.sections[0].footers[0].paragraphs.map((paragraph) => paragraph.marker)).toEqual(['-', '1.', '2.'])
    expect(document.charStyles['0']).toMatchObject({ fontFamily: 'HanFlow Test Sans', bold: true, color: '#123456' })
    expect(document.paraStyles['3']).toMatchObject({
      lineSpacing: 130,
      margin: { left: 120, right: 240, top: 360, bottom: 480 }
    })
    expect(document.resources.image1).toMatchObject({ path: 'BinData/image1.png', mime: 'image/png' })
    const sourceTable = document.sections[0].blocks[0].content.find((content) => content.type === 'table')
    expect(sourceTable?.type === 'table' ? sourceTable.rows[0].cells[0].sourceCellId : undefined).toBe('s0:p0:tbl0:r0c0')

    const pages = paginateDocument(document)
    expect(pages).toHaveLength(3)
    const fragments = pages.flat().filter((block) => block.id.includes(':fragment'))
    expect(fragments).toHaveLength(2)
    const firstTable = fragments[0].content.find((content) => content.type === 'table')
    const secondTable = fragments[1].content.find((content) => content.type === 'table')
    expect(firstTable?.type === 'table' ? firstTable.rows[0].cells[0].header : false).toBe(true)
    expect(secondTable?.type === 'table' ? secondTable.rows[0].cells[0].header : false).toBe(true)

    const viewerPages = paginateViewerDocument(document)
    const decorations = resolvePageDecorations(document, viewerPages)
    expect(decorations.map((decoration) => decoration.pageNumber ? formatPageNumber(decoration.pageNumber, decoration.pageNumberIndex) : undefined)).toEqual(['- 1 -', '- 2 -', '5'])
    expect(decorations.map((decoration) => decoration.header?.paragraphs[0].content[0])).toEqual([
      { type: 'text', text: '공개 머리말', charStyleId: '0' },
      { type: 'text', text: '짝수 쪽 머리말', charStyleId: '0' },
      { type: 'text', text: '둘째 구역 머리말', charStyleId: '0' }
    ])
    expect(decorations.every((decoration) => decoration.footer?.id === '2')).toBe(true)
  })

  test('15문단 장문 셀 fixture를 continuation 행으로 나누고 뒤쪽 표를 밀지 않는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(cellFragmentFixture))
    const sourceTable = document.sections[0].blocks[0].content.find((content) => content.type === 'table')
    expect(sourceTable?.type).toBe('table')
    if (!sourceTable || sourceTable.type !== 'table') throw new Error('공개 장문 표가 없습니다.')
    const sourceParagraphs = sourceTable.rows[1].cells[0].paragraphs
    expect(sourceParagraphs).toHaveLength(15)

    const tableId = sourceTable.id
    const paragraphHeights = Object.fromEntries(sourceParagraphs.map((paragraph) => [paragraph.id, 2000]))
    const measurements = {
      blockHeights: {
        ...paragraphHeights,
        [document.sections[0].blocks[0].id]: 32200,
        [document.sections[0].blocks[1].id]: 2000
      },
      tableRowHeights: {
        [`${tableId}:r0`]: 2000,
        [`${tableId}:r1`]: 30200
      }
    }
    const pages = paginateViewerDocument(document, measurements)
    expect(pages).toHaveLength(2)

    const fragmentTables = pages.flatMap((page) => page.blocks)
      .flatMap((block) => block.content)
      .filter((content) => content.type === 'table' && content.id.startsWith(`${tableId}:fragment`))
    expect(fragmentTables).toHaveLength(2)
    const head = fragmentTables[0].rows[1].cells[0]
    const tail = fragmentTables[1].rows[1].cells[0]
    expect(head.paragraphs).toHaveLength(8)
    expect(tail.paragraphs).toHaveLength(7)
    expect(head.splitBottom).toBe(true)
    expect(head.splitTop).toBeUndefined()
    expect(tail.splitTop).toBe(true)
    expect(tail.splitBottom).toBeUndefined()
    expect([...head.paragraphs, ...tail.paragraphs].map(({ id }) => id)).toEqual(sourceParagraphs.map(({ id }) => id))
    expect(fragmentTables.every((table) => table.rows[0].cells[0].header)).toBe(true)
    expect(pages[1].blocks.some((block) => block.id === document.sections[0].blocks[1].id)).toBe(true)

    const unmeasuredPages = paginateViewerDocument(document)
    expect(unmeasuredPages).toHaveLength(3)
    expect(unmeasuredPages.flatMap((page) => page.blocks).flatMap((block) => block.content)
      .filter((content) => content.type === 'table')
      .flatMap((table) => table.rows)
      .flatMap((row) => row.cells)
      .some((cell) => cell.splitTop || cell.splitBottom)).toBe(false)
  })

  test('다중 이미지 resource와 rowSpan 표를 보존한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(compatibilityFixture))
    expect(Object.keys(document.resources)).toHaveLength(12)
    expect(document.sections[0].blocks[0].content.filter((content) => content.type === 'image')).toHaveLength(12)
    const table = document.sections[0].blocks[1].content.find((content) => content.type === 'table')
    expect(table?.type).toBe('table')
    if (!table || table.type !== 'table') throw new Error('공개 병합 표가 없습니다.')
    expect(table.rows).toHaveLength(3)
    expect(table.rows[1].cells[0]).toMatchObject({ row: 1, column: 0, rowSpan: 2, columnSpan: 1 })
    expect(table.rows[2].cells[0]).toMatchObject({ row: 2, column: 1, rowSpan: 1, columnSpan: 1 })
  })
})
