import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ViewerDocument, ViewerObjectPosition, ViewerParagraph } from '../../src/core/document/viewer_document'
import type { OrderedXmlNode } from '../../src/core/parser/ordered_xml'
import { objectTransform } from '../../src/core/parser/viewer_decoder'
import { objectTransformCss, objectZIndex, PageObjectLayer } from '../../src/renderer/src/App'

// 서버 렌더에서 나는 useLayoutEffect 경고만 조용히 하고 그 밖의 오류는 test를 실패시킨다.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
    if (String(message).includes('useLayoutEffect does nothing on the server')) return
    throw new Error([message, ...rest].map(String).join(' '))
  })
})
afterAll(() => jest.restoreAllMocks())

const node = (children: Array<[string, Record<string, string>]>): OrderedXmlNode => ({
  name: 'hp:rect',
  attributes: {},
  children: children.map(([name, attributes]) => ({ name, attributes, children: [] }))
})

const position = (overrides: Partial<ViewerObjectPosition> = {}): ViewerObjectPosition => ({
  wrap: 'IN_FRONT_OF_TEXT', textFlow: 'BOTH_SIDES', vertRelTo: 'PAPER', horzRelTo: 'PAPER', vertAlign: 'TOP', horzAlign: 'LEFT',
  vertOffset: 1000, horzOffset: 1000, flowWithText: false, allowOverlap: true, zOrder: 0, width: 4000, height: 2000,
  outMargin: { top: 0, right: 0, bottom: 0, left: 0 }, ...overrides
})

describe('개체 회전·대칭', () => {
  test('hp:rotationInfo·hp:flip을 시계 방향 각도와 상자 비율 회전 중심으로 읽는다', () => {
    expect(objectTransform(node([['hp:curSz', { width: '4000', height: '2000' }], ['hp:rotationInfo', { angle: '30', centerX: '2000', centerY: '1000' }]])))
      .toEqual({ rotation: 30, flipHorizontal: false, flipVertical: false, originX: 0.5, originY: 0.5 })
    expect(objectTransform(node([['hp:sz', { width: '4000', height: '2000' }], ['hp:rotationInfo', { angle: '270', centerX: '1000', centerY: '0' }], ['hp:flip', { horizontal: '1', vertical: '0' }]])))
      .toEqual({ rotation: -90, flipHorizontal: true, flipVertical: false, originX: 0.25, originY: 0 })
    // 상자 밖 회전 중심은 가운데로 본다.
    expect(objectTransform(node([['hp:curSz', { width: '4000', height: '2000' }], ['hp:rotationInfo', { angle: '45', centerX: '90000', centerY: '-5' }]]))?.originX).toBe(0.5)
    expect(objectTransform(node([['hp:rotationInfo', { angle: '0' }], ['hp:flip', { horizontal: '0', vertical: '0' }]]))).toBeUndefined()
    expect(objectTransform(node([['hp:rotationInfo', { angle: '360' }]]))).toBeUndefined()
  })

  test('CSS transform은 대칭 뒤 회전 중심으로 돌린다', () => {
    expect(objectTransformCss({ rotation: 30, flipHorizontal: true, flipVertical: true, originX: 0.5, originY: 0.25 }))
      .toEqual({ transform: 'rotate(30deg) scaleX(-1) scaleY(-1)', transformOrigin: '50% 25%' })
    expect(objectTransformCss(undefined)).toBeUndefined()
  })

  test('쪽 layer는 돌린 개체를 감싼 상자 안에서 돌리고 자리 상자는 그대로 둔다', () => {
    const document = {
      page: { width: 20000, height: 20000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 },
      fonts: {}, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {}, diagnostics: [], sections: []
    } as unknown as ViewerDocument
    const paragraph: ViewerParagraph = {
      id: 'p', paraStyleId: '0', pageBreak: false, layoutHeight: 0,
      content: [{
        type: 'object-placeholder', kind: 'shape', element: 'hp:rect', sourcePath: 's#hp:rect:0', flow: 'floating', label: '도형',
        size: { width: 4000, height: 2000 }, position: position({ zOrder: 7 }),
        transform: { rotation: 90, flipHorizontal: false, flipVertical: false, originX: 0.5, originY: 0.5 },
        shape: { stroke: { color: '#000000', width: 33, style: 'SOLID' } }
      }]
    }
    const frame = { page: document.page, columnLeft: 1000, columnWidth: 18000, pageNumber: 1 }
    const markup = renderToStaticMarkup(createElement(PageObjectLayer, { blocks: [paragraph], frameOf: () => frame, document }))
    expect(markup).toMatch(/data-object-placement="page"[^>]*z-index:8/)
    expect(markup).toContain('class="viewer-object-transform" data-object-rotation="90" style="width:100%;height:100%;transform:rotate(90deg);transform-origin:50% 50%"')
  })
})

describe('개체 쌓임 순서', () => {
  const item = (overrides: Partial<ViewerObjectPosition>) => ({ type: 'image' as const, position: position(overrides) })

  test('글 앞 개체는 zOrder가 클수록 위, 글 뒤 개체는 모두 본문 글 아래에서 zOrder 순서다', () => {
    expect(objectZIndex(item({ zOrder: 3 }))).toBeGreaterThan(objectZIndex(item({ zOrder: 2 })))
    expect(objectZIndex(item({ zOrder: 0 }))).toBe(1)
    const behindLow = objectZIndex(item({ wrap: 'BEHIND_TEXT', zOrder: 1 }))
    const behindHigh = objectZIndex(item({ wrap: 'BEHIND_TEXT', zOrder: 5 }))
    expect(behindHigh).toBeGreaterThan(behindLow)
    expect(behindHigh).toBeLessThan(0)
    // 범위를 넘는 zOrder는 끝값으로 모아 편집 UI(z-index 10001)보다 아래에 둔다.
    expect(objectZIndex(item({ zOrder: 1_000_000 }))).toBeLessThan(10001)
    expect(objectZIndex(item({ wrap: 'BEHIND_TEXT', zOrder: 1_000_000 }))).toBeLessThan(0)
  })
})
