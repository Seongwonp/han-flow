import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MathElement } from '../../src/core/document/equation_script'
import { collectObjectPlaceholders, countIncompleteObjectPlaceholders, countObjectPlaceholders, objectPlaceholderNotice } from '../../src/core/document/object_placeholder'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ObjectPlaceholderView } from '../../src/renderer/src/App'
import { renderMathNode } from '../../src/renderer/src/EquationView'
import {
  createEquationHwpx,
  EQUATION_FIXTURE_BLOCK_SCRIPT,
  EQUATION_FIXTURE_FALLBACKS,
  EQUATION_FIXTURE_SCRIPTS
} from '../fixtures/public/create_synthetic_hwpx'

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

describe('수식 MathML renderer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-equation-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('MathML 나무는 알려진 tag·속성만 그리고 색은 style로 바꾼다', () => {
    const tree = {
      tag: 'math',
      children: [
        { tag: 'mrow', attrs: { 'data-eq-color': '#c00000', onclick: 'alert(1)' }, children: [{ tag: 'mi', attrs: { class: 'eq-it', mathvariant: 'normal' }, children: ['x'] }] },
        { tag: 'mrow', attrs: { 'data-eq-color': 'red;background:url(x)' }, children: ['<'] },
        { tag: 'script', children: ['alert(1)'] },
        { tag: 'foreignObject', children: ['y'] }
      ]
    } as unknown as MathElement
    expect(renderToStaticMarkup(createElement('span', null, renderMathNode(tree)))).toBe(
      '<span><math class="viewer-equation-math"><mrow style="color:#c00000"><mi class="eq-it" mathvariant="normal">x</mi></mrow><mrow>&lt;</mrow></math></span>'
    )
  })

  test('합성 수식 문서: 해석한 수식은 MathML로 그리고, 그리지 못한 수식만 안내 배너 개수에 넣는다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createEquationHwpx(directory)))
    const equations = collectObjectPlaceholders(document).filter((item) => item.kind === 'equation')
    expect(equations.map((item) => item.fallbackText)).toEqual([...EQUATION_FIXTURE_SCRIPTS.map((item) => item.script), EQUATION_FIXTURE_BLOCK_SCRIPT])
    expect(equations.filter((item) => !item.equation)).toHaveLength(EQUATION_FIXTURE_FALLBACKS)
    expect(countObjectPlaceholders(document)).toEqual({ equation: equations.length })
    expect(countIncompleteObjectPlaceholders(document)).toEqual({ equation: EQUATION_FIXTURE_FALLBACKS })
    expect(objectPlaceholderNotice(countIncompleteObjectPlaceholders(document))).toBe('이 문서에는 화면에 완전히 표시되지 않는 개체가 1개 있습니다 (수식 1)')

    const colored = equations.find((item) => item.equation?.color === '#C00000')!
    expect(colored.equation).toMatchObject({ baseUnit: 1200, baseLine: 80 })
    const markup = renderQuietly(createElement(ObjectPlaceholderView, { item: colored, document }))
    // 상자는 선언 크기(10000×1400 HWPUNIT), 기준선 80%: 상자 아래 20%를 본문 기준선 아래에 둔다.
    expect(markup).toContain('style="color:#C00000;font-size:12pt;width:133.33333333333334px;height:18.666666666666668px;vertical-align:-3.73px"')
    expect(markup).toContain('<mi mathvariant="normal">α</mi>')
    expect(markup).toContain('<mo stretchy="false">≠</mo>')

    // 원본 위치(자리 차지) 수식은 PositionedObjectBody가 준 상자를 채운다.
    const block = equations.find((item) => item.fallbackText === EQUATION_FIXTURE_BLOCK_SCRIPT)!
    expect(block.position).toBeDefined()
    const positioned = renderQuietly(createElement(ObjectPlaceholderView, { item: block, document, positioned: true }))
    expect(positioned).toContain('class="viewer-equation viewer-object-block viewer-equation-fit"')
    expect(positioned).toContain('width:100%;height:100%')

    const fallback = equations.find((item) => !item.equation)!
    expect(renderQuietly(createElement(ObjectPlaceholderView, { item: fallback, document }))).toContain('<span class="viewer-object-fallback viewer-object-script">longdiv {3} {12} {4}</span>')
  })
})
