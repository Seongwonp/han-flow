import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { collectObjectPlaceholders, OBJECT_PAGE_HEIGHT_RATIO } from '../../src/core/document/object_placeholder'
import { ViewerNoteList } from '../../src/core/document/viewer_document'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { NoteListView, ObjectPlaceholderView } from '../../src/renderer/src/App'
import {
  createFootnoteFlowHwpx,
  createLongObjectHwpx,
  FOOTNOTE_FLOW_COUNT,
  LONG_OBJECT_TEXTS
} from '../fixtures/public/create_synthetic_hwpx'

describe('쪽보다 큰 자리 표시와 긴 각주 목록', () => {
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

  test('각주 40개 목록은 각주마다 block이 되어 pagination이 각주 사이에서 쪽을 나눈다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createFootnoteFlowHwpx(directory)))
    const blocks = document.sections[0].blocks
    const noteBlocks = blocks.filter((block) => block.content[0]?.type === 'note-list')
    expect(noteBlocks).toHaveLength(FOOTNOTE_FLOW_COUNT)
    expect(noteBlocks.map((block) => block.id)).toEqual(
      Array.from({ length: FOOTNOTE_FLOW_COUNT }, (_, index) => index ? `s0:notes:${index}` : 's0:notes')
    )
    const lists = noteBlocks.map((block) => block.content[0] as ViewerNoteList)
    expect(lists[0].continuesKind).toBeUndefined()
    expect(lists.slice(1).every((list) => list.continuesKind === 'footnote')).toBe(true)
    expect(lists.map((list) => list.notes[0].marker)).toEqual(Array.from({ length: FOOTNOTE_FLOW_COUNT }, (_, index) => `${index + 1})`))

    const bodyHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
    const pages = paginateViewerDocument(document, {
      // 화면 측정처럼 각주마다 2400 HWPUNIT(약 3줄), 본문 문단 1600을 준다. 각주 목록 전체(96000)는 한 쪽보다 길다.
      blockHeights: Object.fromEntries(blocks.map((block) => [block.id, noteBlocks.includes(block) ? 2400 : 1600])),
      tableRowHeights: {}
    })
    const notePages = pages.filter((page) => page.blocks.some((block) => noteBlocks.includes(block)))
    expect(notePages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) {
      const used = page.blocks.reduce((sum, block) => sum + (noteBlocks.includes(block) ? 2400 : 1600), 0)
      expect(used).toBeLessThanOrEqual(bodyHeight)
    }

    // 이어지는 block은 구분선과 같은 종류 제목을 다시 그리지 않는다.
    const first = renderToStaticMarkup(createElement(NoteListView, { item: lists[0], document }))
    const next = renderToStaticMarkup(createElement(NoteListView, { item: lists[1], document }))
    expect(first).toContain('<div class="viewer-note-heading">각주</div>')
    expect(next).not.toContain('viewer-note-heading')
    expect(next).toContain('viewer-note-list viewer-note-list-continued')
    expect(next).toContain('<span class="viewer-note-number">2)</span>')
  })
})
