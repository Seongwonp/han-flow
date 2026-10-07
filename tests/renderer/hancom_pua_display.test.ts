import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hancomPuaDisplay, hancomPuaDisplayText } from '../../src/core/document/hancom_pua_display'
import { applyReplaceTextCommand, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ParagraphView } from '../../src/renderer/src/App'
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
    // BMP 사설 영역(Wingdings 글머리 등)은 표 대상이 아니다.
    expect(hancomPuaDisplayText(' 항목')).toBe(' 항목')
    expect(hancomPuaDisplayText('평범한 글 123')).toBe('평범한 글 123')
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
