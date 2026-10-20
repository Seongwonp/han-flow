import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ViewerDocument, ViewerParagraph } from '../../src/core/document/viewer_document'
import { hwpUnitToCssPx } from '../../src/core/layout/hwp_unit'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ObjectFrame, PageBandSpacers, PageObjectLayer, ParagraphView } from '../../src/renderer/src/App'
import { createFloatingObjectHwpx, FLOATING_OBJECT_EXPECTED, FLOATING_OBJECT_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

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

describe('원본 위치 개체 renderer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-positioned-view-'))
  let document: ViewerDocument
  let frame: ObjectFrame
  beforeAll(async () => {
    document = await decodeViewerDocument(await HwpxPackageReader.open(createFloatingObjectHwpx(directory)))
    frame = {
      page: document.page,
      columnLeft: document.page.margin.left,
      columnWidth: document.page.width - document.page.margin.left - document.page.margin.right,
      pageNumber: 1
    }
  })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  const blockWith = (predicate: (paragraph: ViewerParagraph) => boolean) => {
    const paragraph = document.sections[0].blocks.find(predicate)
    if (!paragraph) throw new Error('문단을 찾지 못했습니다.')
    return paragraph
  }
  const textOf = (paragraph: ViewerParagraph) => paragraph.content.map((item) => item.type === 'text' ? item.text : '').join('')

  test('쪽 위치가 없으면(표 셀·글상자 안처럼) 개체를 줄 흐름 안에 그대로 그린다', () => {
    const paragraph = blockWith((item) => item.content.some((content) => content.type === 'image' && content.position?.wrap === 'SQUARE'))
    const markup = renderQuietly(createElement(ParagraphView, { paragraph, document }))
    expect(markup).not.toContain('data-object-placement')
    expect(markup).toContain('class="viewer-image"')
  })

  test('문단 기준 글 옆 그림은 문단 앞에 float로 두고 문단은 float를 품는다', () => {
    const paragraph = blockWith((item) => item.content.some((content) => content.type === 'image' && content.position?.wrap === 'SQUARE'))
    const markup = renderQuietly(createElement(ParagraphView, { paragraph, document, objectFrame: frame }))
    expect(markup).toContain('display:flow-root')
    // 단 오른쪽 맞춤 → 오른쪽 float, 문단 오른쪽 끝에 붙는다.
    expect(markup).toMatch(/data-object-placement="wrap" data-object-wrap="SQUARE" style="[^"]*float:right/)
    expect(markup).toMatch(/float:right;[^"]*margin-right:0"/)
    expect(markup.indexOf('data-object-placement="wrap"')).toBeLessThan(markup.indexOf(FLOATING_OBJECT_TEXTS.body(2)))
  })

  test('문단 기준 자리 차지 글상자는 단 가운데 흐름 안 블록으로 두고 글을 아래로 민다', () => {
    const paragraph = blockWith((item) => item.content.some((content) => content.type === 'object-placeholder' && content.position?.vertRelTo === 'PARA'))
    const markup = renderQuietly(createElement(ParagraphView, { paragraph, document, objectFrame: frame }))
    expect(markup).toMatch(/data-object-placement="band"[^>]*margin-left:/)
    expect(markup).toContain(`margin-left:${px((48190 - 24000) / 2)}`)
    expect(markup).toContain(`padding-top:${px(300)}`)
    expect(markup).toContain('class="viewer-text-box"')
    expect(markup).toContain(FLOATING_OBJECT_TEXTS.bandBoxInner)
    expect(markup.indexOf(FLOATING_OBJECT_TEXTS.bandBoxInner)).toBeLessThan(markup.indexOf(FLOATING_OBJECT_TEXTS.body(4)))
  })

  test('용지·쪽 기준 개체는 문단에서 빼고 쪽 layer에 원본 위치로 그린다', () => {
    const paragraph = blockWith((item) => textOf(item).startsWith(FLOATING_OBJECT_TEXTS.body(0)))
    const inParagraph = renderQuietly(createElement(ParagraphView, { paragraph, document, objectFrame: frame }))
    expect(inParagraph).not.toContain(FLOATING_OBJECT_TEXTS.textBoxInner)
    const layer = renderQuietly(createElement(PageObjectLayer, { blocks: [paragraph], frameOf: () => frame, document }))
    const expected = FLOATING_OBJECT_EXPECTED.textBox
    expect(layer).toContain('data-object-placement="page" data-object-wrap="IN_FRONT_OF_TEXT"')
    expect(layer).toContain(`left:${px(expected.x)};top:${px(expected.y)}`)
    // 원본 쌓임 순서(zOrder 9501)대로 글 위에 둔다.
    expect(layer).toContain('z-index:9502;pointer-events:none')
    expect(layer).toContain(FLOATING_OBJECT_TEXTS.textBoxInner)
  })

  test('글 뒤 도형은 본문 글 아래(음수 z-index)에 원본 선·면 색으로 그린다', () => {
    const paragraph = blockWith((item) => item.content.some((content) => content.type === 'object-placeholder' && content.position?.wrap === 'BEHIND_TEXT'))
    const layer = renderQuietly(createElement(PageObjectLayer, { blocks: [paragraph], frameOf: () => frame, document }))
    expect(layer).toContain('z-index:-9999')
    expect(layer).toContain('data-object-kind="shape"')
    expect(layer).toContain('fill="#F2F2F2"')
    expect(layer).toContain('stroke="#999999"')
  })

  test('쪽 위 자리 차지 표는 쪽 layer에서 편집 가능한 표로 그리고 본문 앞에 띠 높이 빈 블록을 둔다', () => {
    const pages = paginateViewerDocument(document)
    const tablePage = pages.find((page) => page.blocks.some((block) => block.content.some((item) => item.type === 'table')))!
    expect(tablePage.bands).toEqual([{ top: 0, bottom: 3000 + 567 }])
    const layer = renderQuietly(createElement(PageObjectLayer, { blocks: tablePage.blocks, frameOf: () => frame, document }))
    expect(layer).toContain(`left:${px(FLOATING_OBJECT_EXPECTED.table.x)};top:${px(FLOATING_OBJECT_EXPECTED.table.y)}`)
    expect(layer).toContain('class="viewer-table"')
    expect(layer).not.toContain('pointer-events:none')
    const spacers = renderQuietly(createElement(PageBandSpacers, { bands: tablePage.bands, bodyHeight: 84188 - 5669 - 4252 }))
    expect(spacers).toBe(`<div class="viewer-float-band-spacer" aria-hidden="true" style="height:${px(3567)}"></div>`)
  })

  test('가운데 띠는 폭 0 float로 띠 위까지 내려간 뒤 폭 전체 float로 비운다', () => {
    const spacers = renderQuietly(createElement(PageBandSpacers, { bands: [{ top: 1000, bottom: 4000 }, { top: 7000, bottom: 8000 }], bodyHeight: 10000 }))
    expect(spacers).toBe([
      `<div class="viewer-float-band-spacer" aria-hidden="true" style="float:left;clear:left;width:0;height:${px(1000)}"></div>`,
      `<div class="viewer-float-band-spacer" aria-hidden="true" style="float:left;clear:left;width:100%;height:${px(3000)}"></div>`,
      `<div class="viewer-float-band-spacer" aria-hidden="true" style="float:left;clear:left;width:0;height:${px(3000)}"></div>`,
      `<div class="viewer-float-band-spacer" aria-hidden="true" style="float:left;clear:left;width:100%;height:${px(1000)}"></div>`
    ].join(''))
    expect(renderQuietly(createElement(PageBandSpacers, { bands: undefined, bodyHeight: 10000 }))).toBe('')
  })
})
