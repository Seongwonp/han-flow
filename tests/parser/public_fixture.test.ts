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
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('공개 synthetic HWPX 회귀 fixture', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-fixture-'))
  const fixture = createSyntheticHwpx(directory)

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
    expect(document.charStyles['0']).toMatchObject({ fontFamily: 'HanFlow Test Sans', bold: true, color: '#123456' })
    expect(document.resources.image1).toMatchObject({ path: 'BinData/image1.png', mime: 'image/png' })

    const pages = paginateDocument(document)
    expect(pages).toHaveLength(3)
    const fragments = pages.flat().filter((block) => block.id.includes(':fragment'))
    expect(fragments).toHaveLength(2)
    const secondTable = fragments[1].content.find((content) => content.type === 'table')
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
})
