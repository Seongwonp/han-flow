import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { collectObjectPlaceholders, OBJECT_PAGE_HEIGHT_RATIO } from '../../src/core/document/object_placeholder'
import { paragraphFootnotes } from '../../src/core/document/viewer_document'
import { footnoteAreaHeight, sectionFootnoteSettings } from '../../src/core/layout/footnote_layout'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { Content, ObjectPlaceholderView } from '../../src/renderer/src/App'
import type { ViewerImage } from '../../src/core/document/viewer_document'
import {
  createFootnoteFlowHwpx,
  createLongObjectHwpx,
  createFloatingObjectHwpx,
  createLongPictureHwpx,
  FOOTNOTE_FLOW_COUNT,
  LONG_OBJECT_TEXTS,
  LONG_PICTURE_SIZES
} from '../fixtures/public/create_synthetic_hwpx'

describe('쪽보다 큰 자리 표시와 많은 각주', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-page-fit-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('쪽 본문보다 높은 수식·글상자는 선언 크기를 같은 비율로 줄이고 원래 크기를 남긴다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createLongObjectHwpx(directory)))
    const bodyHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
    const limit = Math.floor(bodyHeight * OBJECT_PAGE_HEIGHT_RATIO)
    const placeholders = collectObjectPlaceholders(document)
    const equation = placeholders.find((item) => item.kind === 'equation')!
    expect(equation.size).toEqual({ width: Math.round(40000 * limit / 100000), height: limit })
    expect(equation.fitted).toEqual({ declared: { width: 40000, height: 100000 }, scale: limit / 100000 })
    const [longBox, cellBox] = placeholders.filter((item) => item.kind === 'text-box')
    expect(longBox.fitted?.declared.height).toBe(120000)
    expect(longBox.size?.height).toBe(limit)
    expect(longBox.paragraphs).toHaveLength(60)
    // 표 셀 안 작은 글상자는 줄이지 않는다.
    expect(cellBox.fitted).toBeUndefined()
    expect(cellBox.paragraphs?.[0].content[0]).toMatchObject({ text: LONG_OBJECT_TEXTS.boxInner })

    // 선언 높이를 줄였으므로 개체 문단도 쪽 본문을 넘지 않고, 측정 전 pagination도 개체 문단을 한 쪽씩 둔다.
    const blocks = document.sections[0].blocks
    expect(Math.max(...blocks.map((block) => block.layoutHeight))).toBeLessThanOrEqual(bodyHeight)
    expect(paginateViewerDocument(document).length).toBeGreaterThanOrEqual(2)

    const markup = renderToStaticMarkup(createElement(ObjectPlaceholderView, { item: equation, document }))
    expect(markup).toContain(`data-object-fitted="${equation.fitted!.scale.toFixed(3)}"`)
    expect(markup).toContain('수식 (축소)')
    expect(markup).toContain('원본 높이가 쪽보다 커서 줄여 표시합니다.')
  })

  test('쪽 본문보다 높은 그림도 자리 표시와 같은 한도로 너비·높이를 같은 비율로 줄이고, 원본 위치 그림은 배치 상자도 줄인다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createLongPictureHwpx(directory)))
    const bodyHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
    const limit = Math.floor(bodyHeight * OBJECT_PAGE_HEIGHT_RATIO)
    const blocks = document.sections[0].blocks
    const images = blocks.flatMap((block) => block.content).filter((item): item is ViewerImage => item.type === 'image')
    expect(images).toHaveLength(2)
    const [inline, positioned] = images
    const inlineScale = limit / LONG_PICTURE_SIZES.inline.height
    expect(inline.position).toBeUndefined()
    expect(inline).toMatchObject({
      width: Math.round(LONG_PICTURE_SIZES.inline.width * inlineScale),
      height: limit,
      fitted: { declared: LONG_PICTURE_SIZES.inline, scale: inlineScale }
    })
    // 가로세로 비율을 지킨다.
    expect(inline.width! / inline.height!).toBeCloseTo(LONG_PICTURE_SIZES.inline.width / LONG_PICTURE_SIZES.inline.height, 3)
    const positionedScale = limit / LONG_PICTURE_SIZES.positioned.height
    expect(positioned).toMatchObject({
      width: Math.round(LONG_PICTURE_SIZES.positioned.width * positionedScale),
      height: limit,
      fitted: { declared: LONG_PICTURE_SIZES.positioned, scale: positionedScale },
      position: { width: Math.round(LONG_PICTURE_SIZES.positioned.width * positionedScale), height: limit }
    })
    // 줄 배치(lineseg)에 남은 원래 높이 대신 줄인 높이로 측정 전 쪽 나눔을 한다.
    expect(Math.max(...blocks.map((block) => block.layoutHeight))).toBeLessThanOrEqual(bodyHeight)
    expect(blocks[1].layoutHeight).toBe(limit)

    const markup = renderToStaticMarkup(createElement(Content, { item: inline, document }))
    expect(markup).toContain(`data-object-fitted="${inlineScale.toFixed(3)}"`)

    // 한도 안의 그림·한도가 없는 문맥(머리말 등)은 그대로다.
    const small = (await decodeViewerDocument(await HwpxSourcePackage.open(createFloatingObjectHwpx(directory))))
      .sections[0].blocks.flatMap((block) => block.content).filter((item): item is ViewerImage => item.type === 'image')
    expect(small.length).toBeGreaterThan(0)
    expect(small.every((image) => image.fitted === undefined)).toBe(true)
  })

  test('각주 40개는 번호 표시가 놓인 쪽 아래에 놓이고 본문은 각주 영역만큼 줄어든다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createFootnoteFlowHwpx(directory)))
    const blocks = document.sections[0].blocks
    // 각주는 구역 끝 목록이 아니라 번호 표시에 든다.
    expect(blocks.some((block) => block.content[0]?.type === 'note-list')).toBe(false)
    const notes = blocks.flatMap(paragraphFootnotes)
    expect(notes).toHaveLength(FOOTNOTE_FLOW_COUNT)
    expect(notes.map((note) => note.marker)).toEqual(Array.from({ length: FOOTNOTE_FLOW_COUNT }, (_, index) => `${index + 1})`))

    const bodyHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
    const settings = sectionFootnoteSettings(document.sections[0].footnoteSettings)
    const pages = paginateViewerDocument(document, {
      // 화면 측정처럼 각주마다 2400 HWPUNIT(약 3줄), 본문 문단 1600을 준다. 각주를 모두 더하면(96000) 한 쪽보다 길다.
      blockHeights: Object.fromEntries(blocks.map((block) => [block.id, 1600])),
      tableRowHeights: {},
      noteMetrics: Object.fromEntries(notes.map((note) => [note.sourcePath, { height: 2400, paragraphTops: [0], breaks: [] }]))
    })
    expect(pages.length).toBeGreaterThanOrEqual(3)
    for (const page of pages) {
      const footnotes = page.footnotes?.[0] ?? []
      // 쪽 안 번호 표시와 쪽 아래 각주가 같은 순서로 하나씩 대응한다.
      expect(footnotes.map((footnote) => footnote.note)).toEqual(page.blocks.flatMap(paragraphFootnotes))
      expect(footnotes.every((footnote) => !footnote.continued && !footnote.continues)).toBe(true)
      const used = page.blocks.length * 1600 + footnoteAreaHeight(settings, footnotes.length, footnotes.reduce((sum, footnote) => sum + footnote.height, 0))
      expect(used).toBeLessThanOrEqual(bodyHeight)
    }
    expect(pages.flatMap((page) => page.footnotes?.[0] ?? [])).toHaveLength(FOOTNOTE_FLOW_COUNT)
  })
})
