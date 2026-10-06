import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { paragraphIndentBox } from '../../src/core/layout/paragraph_indent'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ParagraphView } from '../../src/renderer/src/App'
import { createHangingIndentHwpx } from '../fixtures/public/create_synthetic_hwpx'

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
})
