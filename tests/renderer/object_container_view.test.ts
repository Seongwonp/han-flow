import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ViewerDocument, ViewerObjectPlaceholder, ViewerParagraph, ViewerTable, ViewerTableCell } from '../../src/core/document/viewer_document'
import { hwpUnitToCssPx } from '../../src/core/layout/hwp_unit'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { containerObjectFrame, HeaderFooterView, ObjectFrame, PageBandSpacers, PageObjectLayer, ParagraphView, TableView } from '../../src/renderer/src/App'
import { createObjectLayoutHwpx, OBJECT_LAYOUT_EXPECTED, OBJECT_LAYOUT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

function renderQuietly(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  const consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    throw new Error([message, ...rest].map(String).join(' '))
  })
  try {
    return renderToStaticMarkup(element)
  } finally {
    consoleError.mockRestore()
  }
}

const px = (value: number) => `${hwpUnitToCssPx(value)}px`

describe('표 선언 높이·칸 안 원본 위치 개체·쪽 기준 글 옆 배치 renderer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-object-layout-'))
  let document: ViewerDocument
  let frame: ObjectFrame
  beforeAll(async () => {
    document = await decodeViewerDocument(await HwpxPackageReader.open(createObjectLayoutHwpx(directory)))
    frame = {
      page: document.page,
      columnLeft: document.page.margin.left,
      columnWidth: document.page.width - document.page.margin.left - document.page.margin.right,
      pageNumber: 1
    }
  })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  const items = () => document.sections[0].blocks.flatMap((paragraph) => paragraph.content)
  const table = () => items().find((item): item is ViewerTable => item.type === 'table')!

  test('표 칸은 선언 높이(안쪽 여백·테두리 포함)를 행 최소 높이로 쓰고, 나뉜 조각 칸은 내용 높이만 쓴다', () => {
    const markup = renderQuietly(createElement(TableView, { table: table(), document }))
    expect(markup).toContain(`height:${px(12000)};box-sizing:border-box`)
    const cell = table().rows[0].cells[1]
    const split: ViewerTable = { ...table(), rows: [{ cells: [{ ...cell, splitBottom: true }] }] }
    expect(renderQuietly(createElement(TableView, { table: split, document }))).not.toContain('box-sizing:border-box')
    // 한 쪽 본문보다 높은 선언 높이는 쪽 본문 높이의 90%로 줄인다(테두리·표 아래 줄 간격 자리).
    const bodyHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
    const tall: ViewerTable = { ...table(), rows: [{ cells: [{ ...cell, height: bodyHeight * 2 }] }] }
    expect(renderQuietly(createElement(TableView, { table: tall, document }))).toContain(`height:${px(Math.floor(bodyHeight * 0.9))};box-sizing:border-box`)
  })

  test('셀 안 쪽 기준 그림은 셀을 용지로 보고 셀 안쪽 여백 안 오른쪽 아래 끝에 그리고 셀 글 흐름에서 띠를 비운다', () => {
    const markup = renderQuietly(createElement(TableView, { table: table(), document }))
    const expected = OBJECT_LAYOUT_EXPECTED.cellPicture
    expect(markup).toContain('position:relative')
    expect(markup).toMatch(/data-object-placement="page" data-object-wrap="TOP_AND_BOTTOM" data-object-container="cell"/)
    expect(markup).toContain(`left:${px(expected.x - OBJECT_LAYOUT_EXPECTED.table.x)};top:${px(expected.y - OBJECT_LAYOUT_EXPECTED.table.y)}`)
    // 셀 안쪽 여백 안(높이 11000)의 아래 2000 띠 → 폭 전체 float.
    expect(markup).toContain(`float:left;clear:left;width:100%;height:${px(2000)}`)
    expect(markup.indexOf('data-object-container="cell"')).toBeLessThan(markup.indexOf(OBJECT_LAYOUT_TEXTS.firstCell))
  })

  test('셀 안 문단 기준 글 옆 그림은 셀 문단 안 float로 그린다', () => {
    const cell = table().rows[0].cells[1]
    const picture = { ...(items().find((item) => item.type === 'image' && item.position?.wrap === 'SQUARE') as Extract<ViewerParagraph['content'][number], { type: 'image' }>) }
    picture.position = { ...picture.position!, vertRelTo: 'PARA', horzRelTo: 'PARA', horzAlign: 'LEFT', vertOffset: 0, width: 3000, height: 2000 }
    const withPicture: ViewerTableCell = { ...cell, paragraphs: [{ ...cell.paragraphs[0], content: [picture, ...cell.paragraphs[0].content] }] }
    const markup = renderQuietly(createElement(TableView, { table: { ...table(), rows: [{ cells: [withPicture] }] }, document }))
    expect(markup).toMatch(/data-object-placement="wrap" data-object-wrap="SQUARE" style="[^"]*float:left/)
    expect(markup).toContain('display:flow-root')
  })

  test('글상자 안 쪽 기준 그림은 글상자 글 영역 왼쪽 위에서 잰 원본 위치에 그린다', () => {
    const textBox = items().find((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder' && item.kind === 'text-box')!
    const paragraph = document.sections[0].blocks.find((block) => block.content.includes(textBox))!
    const markup = renderQuietly(createElement(PageObjectLayer, { blocks: [paragraph], frameOf: () => frame, document }))
    expect(markup).toContain('data-object-container="text-box"')
    expect(markup).toContain(`left:${px(1000)};top:${px(1000)}`)
    expect(markup).toContain(OBJECT_LAYOUT_TEXTS.textBox)
    expect(containerObjectFrame(20000, 10000)).toMatchObject({ columnLeft: 0, columnWidth: 20000, page: { width: 20000, height: 10000 } })
  })

  test('머리말 안 용지 기준 그림은 쪽 위 원본 위치에 그리고 머리말 문단에서는 뺀다', () => {
    const header = document.sections[0].headers[0]
    const markup = renderQuietly(createElement(HeaderFooterView, { control: header, kind: 'header', document, offset: document.page.headerOffset, objectFrame: frame }))
    expect(markup).toContain('data-object-container="header"')
    expect(markup).toContain(`left:${px(OBJECT_LAYOUT_EXPECTED.header.x)};top:${px(OBJECT_LAYOUT_EXPECTED.header.y)}`)
    // 쪽 위치가 없으면(예전 호출) 줄 흐름 안에 그대로 둔다.
    const inline = renderQuietly(createElement(HeaderFooterView, { control: header, kind: 'header', document, offset: document.page.headerOffset }))
    expect(inline).not.toContain('data-object-placement')
    expect(inline).toContain('class="viewer-image"')
  })

  test('쪽 기준 글 옆 그림은 그림 쪽만 비우는 float를 두어 본문 글이 왼쪽으로 흐른다', () => {
    const pages = paginateViewerDocument(document)
    const expected = OBJECT_LAYOUT_EXPECTED.squarePicture
    const bodyWidth = frame.columnWidth
    const band = pages[0].bands?.find((item) => item.wrap)
    expect(band).toEqual({ top: expected.y - document.page.margin.top, bottom: expected.y - document.page.margin.top + expected.height, wrap: { float: 'right', width: 59528 - 5669 - expected.x } })
    const spacers = renderQuietly(createElement(PageBandSpacers, { bands: pages[0].bands, bodyHeight: document.page.height - document.page.margin.top - document.page.margin.bottom }))
    expect(spacers).toContain(`data-band-wrap="right" style="float:right;clear:both;width:${px(band!.wrap!.width)};height:${px(expected.height)}"`)
    expect(band!.wrap!.width).toBeLessThan(bodyWidth / 2)
    const paragraph = document.sections[0].blocks.find((block) => block.content.some((item) => item.type === 'image' && item.position?.wrap === 'SQUARE'))!
    const inParagraph = renderQuietly(createElement(ParagraphView, { paragraph, document, objectFrame: frame }))
    expect(inParagraph).not.toContain('data-object-placement')
  })
})
