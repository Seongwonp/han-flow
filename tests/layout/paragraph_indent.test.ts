import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { paragraphIndentBox } from '../../src/core/layout/paragraph_indent'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import type { ViewerTable } from '../../src/core/document/viewer_document'
import { ParagraphView, TableView } from '../../src/renderer/src/App'
import { createHangingIndentHwpx, PRESS_HEADER_CELL_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

describe('문단 들여쓰기·내어쓰기 CSS box', () => {
  test('양수 intent는 첫 줄만 들인다', () => {
    expect(paragraphIndentBox({ left: 1000 }, 500)).toEqual({ marginLeft: 1000, paddingLeft: 0, textIndent: 500 })
    expect(paragraphIndentBox({}, undefined)).toEqual({ marginLeft: 0, paddingLeft: 0, textIndent: 0 })
  })

  test('음수 intent는 첫 줄을 왼쪽 여백에 두고 둘째 줄부터 들인다', () => {
    const box = paragraphIndentBox({ left: 0 }, -15232)
    expect(box).toEqual({ marginLeft: 0, paddingLeft: 15232, textIndent: -15232 })
    // 첫 줄 시작 = 왼쪽 여백, 둘째 줄 시작 = 왼쪽 여백 + |intent|
    expect(box.marginLeft + box.paddingLeft + box.textIndent).toBe(0)
    expect(box.marginLeft + box.paddingLeft).toBe(15232)
    const bullet = paragraphIndentBox({ left: 1406, right: 458 }, -4214)
    expect(bullet.marginLeft + bullet.paddingLeft + bullet.textIndent).toBe(1406)
    expect(bullet.marginLeft + bullet.paddingLeft).toBe(5620)
  })

  test('칸 안쪽 폭을 알면 내어쓰기 폭을 남는 줄 폭 이하로 줄인다', () => {
    // 보도자료 머리 표의 `배포` 셀: 안쪽 폭 3251 - 2×510 = 2231, 내어쓰기 2321
    expect(paragraphIndentBox({ left: 0, right: 0 }, -2321, 2231)).toEqual({ marginLeft: 0, paddingLeft: 2231, textIndent: -2231 })
    expect(paragraphIndentBox({ left: 300, right: 200 }, -1000, 5000)).toEqual({ marginLeft: 300, paddingLeft: 1000, textIndent: -1000 })
    expect(paragraphIndentBox({ left: 3000, right: 0 }, -1000, 2000)).toEqual({ marginLeft: 3000, paddingLeft: 0, textIndent: 0 })
  })
})

describe('내어쓰기 fixture 렌더', () => {
  let directory: string
  let fixture: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'han-flow-hanging-indent-'))
    fixture = createHangingIndentHwpx(directory)
  })

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('음수 intent 문단의 첫 줄이 글상자 왼쪽 밖으로 나가지 않는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const blocks = document.sections[0].blocks
    const indents = blocks.map((paragraph) => document.paraStyles[paragraph.paraStyleId]?.indent ?? 0)
    // 직접 `hh:margin` 값은 HWPUNIT의 2배로 저장되므로 절반이 실제 내어쓰기 폭이다.
    expect(indents.filter((indent) => indent < 0)).toEqual([-1310, -7616, -7616, -9352, -2107])
    expect(document.paraStyles['9'].margin).toMatchObject({ left: 703, right: 229 })
    for (const paragraph of blocks) {
      const markup = renderToStaticMarkup(createElement(ParagraphView, { paragraph, document }))
      const style = markup.match(/style="([^"]*)"/)?.[1] ?? ''
      const px = (name: string) => Number(style.match(new RegExp(`(?:^|;)${name}:(-?[\\d.]+)px`))?.[1] ?? 0)
      // 첫 줄 시작 위치(margin + padding + text-indent)는 문단 왼쪽 여백보다 왼쪽일 수 없다.
      expect(px('margin-left') + px('padding-left') + px('text-indent')).toBeGreaterThanOrEqual(px('margin-left') - 0.001)
      expect(px('margin-left') + px('padding-left') + px('text-indent')).toBeGreaterThanOrEqual(0)
    }
  })

  test('좁은 표 셀의 내어쓰기는 셀 안쪽 폭을 넘지 않아 이웃 셀로 번지지 않는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const table = document.sections[0].blocks
      .flatMap((paragraph) => paragraph.content)
      .find((item): item is ViewerTable => item.type === 'table' && item.columnCount === 4)
    if (!table) throw new Error('보도자료 머리 표가 없습니다.')
    const cells = table.rows[0].cells
    expect(cells.map((cell) => cell.paragraphs[0].content.map((item) => item.type === 'text' ? item.text : '').join(''))).toEqual([...PRESS_HEADER_CELL_TEXTS])
    const narrow = cells[2]
    expect(document.paraStyles[narrow.paragraphs[0].paraStyleId].indent).toBe(-2321)
    const markup = renderToStaticMarkup(createElement(TableView, { table, document }))
    const cellMarkup = markup.split('<td').slice(1)
    const style = cellMarkup[2].match(/<div[^>]*style="([^"]*)"/)?.[1] ?? ''
    const px = (name: string) => Number(style.match(new RegExp(`(?:^|;)${name}:(-?[\\d.]+)px`))?.[1] ?? 0)
    const innerPx = (narrow.width - narrow.margin.left - narrow.margin.right) * 96 / 7200
    // 첫 줄은 셀 안쪽 왼쪽에서 시작하고, 첫 줄 폭(padding-left)은 셀 안쪽 폭을 넘지 않는다.
    expect(px('margin-left') + px('padding-left') + px('text-indent')).toBeCloseTo(0, 5)
    expect(px('padding-left')).toBeLessThanOrEqual(innerPx + 0.001)
  })
})
