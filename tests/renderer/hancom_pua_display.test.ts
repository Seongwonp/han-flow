import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hancomPuaDisplay, hancomPuaDisplayText, symbolFontPuaDisplayText } from '../../src/core/document/hancom_pua_display'
import { applyReplaceTextCommand, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { FixedPageTextLayer, ParagraphView } from '../../src/renderer/src/App'
import { parseRhwpTextLayout } from '../../src/renderer/src/rhwp_text_layout'
import { createReportTocHwpx, REPORT_TOC_PUA_MARKER } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

describe('한컴 PUA 기호 화면 표시 대체', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-pua-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('검증된 기호만 바꾸고 표에 없는 PUA·일반 글자는 그대로 둔다', () => {
    expect(hancomPuaDisplay(0xf03da)).toBe('□')
    expect(hancomPuaDisplayText(`${REPORT_TOC_PUA_MARKER} 둘째 수준 항목`)).toBe('□ 둘째 수준 항목')
    expect(hancomPuaDisplayText(String.fromCodePoint(0xf012b))).toBe('(인)')
    // rhwp 표와 같이 인접 code point를 추정하지 않는다.
    expect(hancomPuaDisplayText(String.fromCodePoint(0xf03e0))).toBe(String.fromCodePoint(0xf03e0))
    expect(hancomPuaDisplayText('평범한 글 123')).toBe('평범한 글 123')
  })

  test('기호 글꼴(Wingdings) PUA 글자는 rhwp가 SVG에 그리는 표준 기호로 바꾼다', () => {
    // rhwp `map_pua_bullet_char` 기본 PUA 분기와 같은 48개 항목(@rhwp/core 0.7.19가 HWP 쪽 SVG에 그리는 글자).
    const mapped = Array.from({ length: 0xe0 }, (_, offset) => 0xf020 + offset).filter((codePoint) => hancomPuaDisplay(codePoint))
    expect(mapped).toHaveLength(48)
    expect(hancomPuaDisplayText('\uf06c 항목')).toBe('● 항목')
    expect(hancomPuaDisplayText('\uf0e8 다음')).toBe('➔ 다음')
    expect(hancomPuaDisplayText('\uf0fc\uf09f\uf0a7')).toBe('✔•▪')
    expect(symbolFontPuaDisplayText('\uf0e8\uf0b7')).toBe('➔\uf0b7')
    // 표에 없는 기호 글꼴 code point·범위 밖 BMP 사설 영역은 그대로다.
    expect(hancomPuaDisplayText('\uf0b7\uf020\uf100')).toBe('\uf0b7\uf020\uf100')
    // 기호 글꼴 표만 쓰는 HWP 글자 층은 한컴 PUA 표를 쓰지 않는다(rhwp 0.7.19가 그리는 것과 다를 수 있다).
    expect(symbolFontPuaDisplayText(String.fromCodePoint(0xf03da))).toBe(String.fromCodePoint(0xf03da))
    // 바꾼 글자는 모두 기본 평면 한 글자라 글자 offset이 그대로다.
    for (const codePoint of mapped) expect(hancomPuaDisplayText(String.fromCodePoint(codePoint))).toHaveLength(1)
  })

  test('HWP 쪽 글자 층은 rhwp가 SVG에 그린 기호와 같은 글자를 둔다', () => {
    // rhwp 글자 위치표는 원래 code point(U+F0E8)이고 SVG에는 ➔를 그린다.
    const layout = parseRhwpTextLayout(JSON.stringify({
      runs: [{ text: '\uf0e8', x: 0, y: 0, w: 8, h: 16, fontSize: 16, ratio: 1 }, { text: '다음 \uf0b7', x: 8, y: 0, w: 40, h: 16, fontSize: 16 }]
    }), 0)
    expect(layout.runs.map((run) => run.text)).toEqual(['➔', '다음 \uf0b7'])
    expect(layout.text).toBe('➔다음 \uf0b7')
    // 바꾼 기호는 비교 글자로 센다(표에 없는 사설 영역 글자는 그대로 세지 않는다).
    expect(layout.nonWhitespaceCharacters).toBe(3)
    const markup = renderToStaticMarkup(createElement(FixedPageTextLayer, { layout, searchQuery: '' }))
    expect(markup).toContain('➔')
    expect(markup).not.toContain('\uf0e8')
  })

  test('보기 화면에는 표준 글자로 그리고 문서 모델·원문·저장 bytes는 원래 code point를 유지한다', async () => {
    const source = await HwpxSourcePackage.open(createReportTocHwpx(directory))
    const document = await decodeViewerDocument(source)
    const paragraph = document.sections[0].blocks.find((block) =>
      block.content.some((item) => item.type === 'text' && item.text.includes(REPORT_TOC_PUA_MARKER)))!
    const markup = renderToStaticMarkup(createElement(ParagraphView as any, { paragraph, document }))
    expect(markup).toContain('□ 둘째 수준 항목')
    expect(markup).not.toContain(REPORT_TOC_PUA_MARKER)

    const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text.includes(REPORT_TOC_PUA_MARKER))!
    expect(anchor.text.startsWith(REPORT_TOC_PUA_MARKER)).toBe(true)
    const edited = applyReplaceTextCommand(source, {
      type: 'replace-text',
      revision: source.revision,
      sectionPath,
      textNodeId: anchor.textNodeId,
      from: anchor.text.length,
      to: anchor.text.length,
      insert: '!'
    })
    const section = edited.package.readEntry(sectionPath).toString('utf8')
    expect(section).toContain(`${REPORT_TOC_PUA_MARKER} 둘째 수준 항목!`)
    expect(section).not.toContain('□')
  })
})
