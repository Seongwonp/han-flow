import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ViewerDocument, ViewerImage, ViewerObjectPlaceholder, ViewerParagraph } from '../../src/core/document/viewer_document'
import { hwpUnitToCssPx } from '../../src/core/layout/hwp_unit'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { Content, ObjectFrame, PageObjectLayer, paragraphLineHeight, ParagraphView, PictureView } from '../../src/renderer/src/App'
import { arrowHead, ShapeView, strokeDashArray } from '../../src/renderer/src/ShapeView'
import { createShapeHwpx, SHAPE_FIXTURE_EXPECTED, SHAPE_LINE_SPACINGS } from '../fixtures/public/create_synthetic_hwpx'

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

describe('도형 SVG renderer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-shape-view-'))
  let document: ViewerDocument
  let shapes: ViewerObjectPlaceholder[]
  let images: ViewerImage[]
  beforeAll(async () => {
    document = await decodeViewerDocument(await HwpxPackageReader.open(createShapeHwpx(directory)))
    const content = document.sections[0].blocks.flatMap((block) => block.content)
    shapes = content.filter((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder' && item.kind === 'shape')
    images = content.filter((item): item is ViewerImage => item.type === 'image')
  })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))
  const shapeAt = (element: string, x: number) => shapes.find((item) => item.element === element && item.position?.horzOffset === x)!

  test('호는 path와 끝 화살표, 부채꼴은 선형 그러데이션, 활꼴은 무늬로 채운다', () => {
    const arc = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:arc', 8000) }))
    expect(arc).toContain('data-shape-element="hp:arc"')
    expect(arc).toMatch(/<path d="M0 0 C[^"]+ 8000 6000" fill="none"/u)
    expect(arc).toContain('data-arrow="ARROW"')
    const pie = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:arc', 20000) }))
    expect(pie).toContain('<linearGradient')
    expect(pie).toContain('rotate(90 0.5 0.5)')
    expect(pie).toMatch(/fill="url\(#hf[A-Za-z0-9_-]+f\)"/u)
    const chord = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:arc', 30000) }))
    expect(chord).toContain('<pattern')
    expect(chord).toContain('data-hatch-style="CROSS"')
  })

  test('곡선은 점선, 연결선은 끝 화살표, 묶음은 안쪽 도형마다 path를 그린다', () => {
    const curve = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:curve', 40000) }))
    expect(curve).toContain('stroke-dasharray=')
    expect(curve).not.toContain('data-arrow')
    const connector = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:connectLine', 8000) }))
    expect(connector.match(/data-arrow="/gu)).toHaveLength(1)
    const group = renderQuietly(createElement(ShapeView, { item: shapeAt('hp:container', 22000) }))
    expect(group.match(/data-shape-part="/gu)).toHaveLength(SHAPE_FIXTURE_EXPECTED.shapes[5].parts.length)
    expect(group).toContain('<radialGradient')
    expect(group.match(/data-arrow="ARROW"/gu)).toHaveLength(1)
  })

  test('줄 안 도형은 선언 크기 상자에 SVG로 그린다(자리 표시 상자 없이)', () => {
    const inline = shapes.find((item) => item.element === 'hp:arc' && !item.position)!
    const markup = renderQuietly(createElement(Content, { item: inline, document }))
    expect(markup).toContain('viewer-shape-inline')
    expect(markup).toContain(`width:${hwpUnitToCssPx(3000)}px`)
    expect(markup).toContain('<svg')
    expect(markup).not.toContain('viewer-object-label')
  })

  test('점선 배열과 화살표 모양', () => {
    expect(strokeDashArray('SOLID', 57)).toBeUndefined()
    expect(strokeDashArray('DASH', 100)).toBe('400 200')
    const head = renderQuietly(createElement('svg', null, arrowHead('FILLED_DIAMOND', { x: 100, y: 0 }, { x: 0, y: 0 }, { width: 40, length: 60 }, '#000000', 50)))
    expect(head).toContain('M130 0 L100 20 L70 0 L100 -20 Z')
    expect(renderQuietly(createElement('svg', null, arrowHead('EMPTY_CIRCLE', { x: 0, y: 0 }, { x: -1, y: 0 }, { width: 40, length: 40 }, '#000000', 50)))).toContain('fill="#FFFFFF"')
  })

  test('자른 그림은 그림 자리를 넘치는 부분을 숨기고 보이는 부분이 상자를 채우게 늘인다', () => {
    const markup = renderQuietly(createElement(PictureView, { item: images[0], resource: document.resources[images[0].resourceId!], positioned: true }))
    expect(markup).toContain('class="viewer-image-crop viewer-image viewer-image-positioned"')
    expect(markup).toContain('left:-50%;top:0%;width:200%;height:200%')
  })

  test('그림 회전 안 함은 테두리 틀만 돌리고 그림은 돌리지 않는다', () => {
    const markup = renderQuietly(createElement(PictureView, { item: images[1], resource: document.resources[images[1].resourceId!], positioned: true }))
    expect(markup).toContain('data-rotate-image="0"')
    expect(markup).toMatch(/class="viewer-image-border" style="[^"]*transform:rotate\(30deg\)/u)
    expect(markup).not.toMatch(/<img[^>]*rotate\(30deg\)/u)
  })

  test('겹침 허용 안 함 사각형은 앞 사각형 아래로 밀어 그린다', () => {
    const frame: ObjectFrame = {
      page: document.page,
      columnLeft: document.page.margin.left,
      columnWidth: document.page.width - document.page.margin.left - document.page.margin.right,
      pageNumber: 1
    }
    const blocks = document.sections[0].blocks.filter((block) => block.content.some((item) => item.type === 'object-placeholder' && item.element === 'hp:rect'))
    const markup = renderQuietly(createElement(PageObjectLayer, { blocks, frameOf: () => frame, document }))
    const { first, second, nudge } = SHAPE_FIXTURE_EXPECTED.overlap
    expect(markup).toContain(`top:${hwpUnitToCssPx(first.y)}px`)
    expect(markup).toContain(`top:${hwpUnitToCssPx(second.y)}px`)
    expect(markup).toContain(`data-object-nudged="${nudge}"`)
  })
})

describe('줄 간격 종류 renderer', () => {
  test('종류마다 CSS 줄 높이와 빈 줄 높이·줄 간격 몫', () => {
    expect(paragraphLineHeight(undefined)).toMatchObject({ lineHeight: 1.5, minHeight: '1.5em', leading: '0.5em' })
    expect(paragraphLineHeight({ id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 160 })).toMatchObject({ lineHeight: 1.6, leading: '0.6em' })
    const px = hwpUnitToCssPx(2400)
    expect(paragraphLineHeight({ id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 2400, lineSpacingType: 'FIXED' })).toEqual({
      lineHeight: `${px}px`, minHeight: `${px}px`, leading: `max(0px, calc(${px}px - 1em))`, label: 'FIXED 2400'
    })
    const gap = paragraphLineHeight({ id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 1200, lineSpacingType: 'BETWEEN_LINES' })
    expect(gap).toMatchObject({ lineHeight: `calc(1em + ${hwpUnitToCssPx(1200)}px)`, spanLineHeight: `calc(1em + ${hwpUnitToCssPx(1200)}px)` })
    expect(paragraphLineHeight({ id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 }, lineSpacing: 2000, lineSpacingType: 'AT_LEAST' }).spanLineHeight).toBe('max(1em, 26.667px)')
  })

  test('여백만 지정 문단은 글자 run마다 줄 높이를 주고 문단에 줄 간격 종류를 표시한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-line-spacing-view-'))
    try {
      const document = await decodeViewerDocument(await HwpxPackageReader.open(createShapeHwpx(directory)))
      const between = SHAPE_LINE_SPACINGS.find((item) => item.type === 'BETWEEN_LINES')!
      const paragraph = document.sections[0].blocks.find((block: ViewerParagraph) => block.paraStyleId === String(between.id))!
      const markup = renderQuietly(createElement(ParagraphView, { paragraph, document }))
      expect(markup).toContain(`data-line-spacing="BETWEEN_LINES ${between.value}"`)
      expect(markup).toMatch(new RegExp(`<span style="[^"]*line-height:calc\\(1em \\+ ${hwpUnitToCssPx(between.value)}px\\)`, 'u'))
      const fixed = document.sections[0].blocks.find((block: ViewerParagraph) => block.paraStyleId === '20')!
      expect(renderQuietly(createElement(ParagraphView, { paragraph: fixed, document }))).toContain(`line-height:${hwpUnitToCssPx(2400)}px`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
