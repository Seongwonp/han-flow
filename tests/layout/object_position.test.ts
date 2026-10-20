import {
  blockBandFlowKind,
  blockObjectBands,
  contentOutOfFlow,
  flowBlockEnd,
  PAGE_WRAP_FLOW_SAFETY,
  HorizontalFrame,
  mergePageBands,
  objectPlacement,
  objectX,
  objectY,
  pageBandLayout,
  pageBandsHeight,
  PageFrame,
  pageObjectBand,
  paragraphObjectOffset,
  tableInFlow,
  WRAP_MIN_TEXT_WIDTH,
  wrapTextSide
} from '../../src/core/layout/object_position'
import type { ViewerObjectPosition, ViewerParagraph, ViewerTable } from '../../src/core/document/viewer_document'

// A4(59528×84188), 여백 왼쪽 5000·오른쪽 4000·위 6000·아래 3000 → 쪽 본문 50528×75188.
const page: PageFrame = { width: 59528, height: 84188, margin: { top: 6000, right: 4000, bottom: 3000, left: 5000 } }
const bodyHeight = 84188 - 6000 - 3000
// 두 단 가운데 오른쪽 단(왼쪽 30000, 폭 24528)과 왼쪽 여백 1000·오른쪽 여백 500인 문단.
const frame: HorizontalFrame = { columnLeft: 30000, columnWidth: 24528, paraLeft: 31000, paraWidth: 23028 }

function position(overrides: Partial<ViewerObjectPosition> = {}): ViewerObjectPosition {
  return {
    wrap: 'TOP_AND_BOTTOM',
    textFlow: 'BOTH_SIDES',
    vertRelTo: 'PARA',
    horzRelTo: 'PARA',
    vertAlign: 'TOP',
    horzAlign: 'LEFT',
    vertOffset: 0,
    horzOffset: 0,
    flowWithText: false,
    allowOverlap: false,
    zOrder: 0,
    width: 10000,
    height: 4000,
    outMargin: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides
  }
}

describe('원본 위치 개체 배치 방식', () => {
  test('문단 기준 배치는 자리 차지·글 옆·글 앞뒤로 나누고 용지·쪽 기준은 쪽 layer에 둔다', () => {
    expect(objectPlacement(undefined)).toBeUndefined()
    expect(objectPlacement(position())).toBe('band')
    for (const wrap of ['SQUARE', 'TIGHT', 'THROUGH'] as const) expect(objectPlacement(position({ wrap }))).toBe('wrap')
    for (const wrap of ['BEHIND_TEXT', 'IN_FRONT_OF_TEXT'] as const) expect(objectPlacement(position({ wrap }))).toBe('overlay')
    for (const vertRelTo of ['PAPER', 'PAGE'] as const) {
      for (const wrap of ['TOP_AND_BOTTOM', 'SQUARE', 'BEHIND_TEXT', 'IN_FRONT_OF_TEXT'] as const) {
        expect(objectPlacement(position({ vertRelTo, wrap }))).toBe('page')
      }
    }
  })

  test('흐름 밖 개체는 문단 높이에 들지 않고, 흐름 안(자리 차지) 표만 쪽 사이에서 나눈다', () => {
    const table = (pos?: ViewerObjectPosition): ViewerTable => ({ type: 'table', id: 't', rowCount: 0, columnCount: 0, repeatHeader: false, rows: [], ...(pos ? { position: pos } : {}) })
    expect(tableInFlow(table())).toBe(true)
    expect(tableInFlow(table(position()))).toBe(true)
    expect(tableInFlow(table(position({ wrap: 'SQUARE' })))).toBe(false)
    expect(tableInFlow(table(position({ vertRelTo: 'PAGE' })))).toBe(false)
    expect(contentOutOfFlow(table(position({ vertRelTo: 'PAPER' })))).toBe(true)
    expect(contentOutOfFlow(table(position({ wrap: 'BEHIND_TEXT' })))).toBe(true)
    expect(contentOutOfFlow(table(position({ wrap: 'SQUARE' })))).toBe(false)
    expect(contentOutOfFlow({ type: 'text', text: '', charStyleId: '0' })).toBe(false)
  })
})

describe('가로 위치(horzRelTo × horzAlign)', () => {
  const x = (overrides: Partial<ViewerObjectPosition>, pageNumber = 1) => objectX(position(overrides), page, frame, pageNumber)

  test('용지·쪽·단·문단 기준 왼쪽 맞춤은 기준 왼쪽 끝에서 offset만큼 오른쪽이다', () => {
    expect(x({ horzRelTo: 'PAPER', horzOffset: 3613 })).toBe(3613)
    expect(x({ horzRelTo: 'PAGE', horzOffset: 100 })).toBe(5100)
    expect(x({ horzRelTo: 'COLUMN', horzOffset: 100 })).toBe(30100)
    expect(x({ horzRelTo: 'PARA', horzOffset: 417 })).toBe(31417)
  })

  test('가운데 맞춤은 기준 폭 가운데에 놓고 offset만큼 오른쪽으로 민다', () => {
    expect(x({ horzRelTo: 'PAPER', horzAlign: 'CENTER' })).toBe((59528 - 10000) / 2)
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'CENTER' })).toBe(5000 + (50528 - 10000) / 2)
    expect(x({ horzRelTo: 'COLUMN', horzAlign: 'CENTER', horzOffset: 141 })).toBe(30000 + (24528 - 10000) / 2 + 141)
    expect(x({ horzRelTo: 'PARA', horzAlign: 'CENTER' })).toBe(31000 + (23028 - 10000) / 2)
  })

  test('오른쪽 맞춤은 기준 오른쪽 끝에서 offset만큼 왼쪽이다', () => {
    expect(x({ horzRelTo: 'PAPER', horzAlign: 'RIGHT', horzOffset: 1000 })).toBe(59528 - 10000 - 1000)
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'RIGHT' })).toBe(5000 + 50528 - 10000)
    expect(x({ horzRelTo: 'COLUMN', horzAlign: 'RIGHT' })).toBe(30000 + 24528 - 10000)
    expect(x({ horzRelTo: 'PARA', horzAlign: 'RIGHT', horzOffset: 28 })).toBe(31000 + 23028 - 10000 - 28)
  })

  test('안쪽·바깥쪽 맞춤은 홀수 쪽에서 왼쪽·오른쪽, 짝수 쪽에서 반대다', () => {
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'INSIDE' }, 1)).toBe(5000)
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'INSIDE' }, 2)).toBe(5000 + 50528 - 10000)
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'OUTSIDE' }, 3)).toBe(5000 + 50528 - 10000)
    expect(x({ horzRelTo: 'PAGE', horzAlign: 'OUTSIDE' }, 4)).toBe(5000)
  })

  test('용지 밖으로 나가는 위치는 용지 안으로 옮긴다', () => {
    expect(x({ horzRelTo: 'PAPER', horzOffset: -2000 })).toBe(0)
    expect(x({ horzRelTo: 'PAPER', horzOffset: 55000 })).toBe(59528 - 10000)
    expect(objectX(position({ horzRelTo: 'PAPER', width: 70000 }), page, frame)).toBe(0)
  })
})

describe('세로 위치(vertRelTo × vertAlign)', () => {
  const y = (overrides: Partial<ViewerObjectPosition>, paraTop?: number) => objectY(position(overrides), page, paraTop)

  test('용지·쪽 기준 위·가운데·아래 맞춤과 offset', () => {
    expect(y({ vertRelTo: 'PAPER', vertOffset: 69695 })).toBe(69695)
    expect(y({ vertRelTo: 'PAPER', vertAlign: 'CENTER', vertOffset: 100 })).toBe((84188 - 4000) / 2 + 100)
    expect(y({ vertRelTo: 'PAPER', vertAlign: 'BOTTOM', vertOffset: 500 })).toBe(84188 - 4000 - 500)
    expect(y({ vertRelTo: 'PAGE' })).toBe(6000)
    expect(y({ vertRelTo: 'PAGE', vertAlign: 'CENTER' })).toBe(6000 + (bodyHeight - 4000) / 2)
    expect(y({ vertRelTo: 'PAGE', vertAlign: 'BOTTOM', vertOffset: 14474 })).toBe(6000 + bodyHeight - 4000 - 14474)
  })

  test('안쪽·바깥쪽 세로 맞춤은 위·아래로 본다', () => {
    expect(y({ vertRelTo: 'PAGE', vertAlign: 'INSIDE' })).toBe(6000)
    expect(y({ vertRelTo: 'PAGE', vertAlign: 'OUTSIDE' })).toBe(6000 + bodyHeight - 4000)
  })

  test('문단 기준은 문단 위 끝에서 offset만큼 아래이고 음수 offset은 흐름 밖 개체만 문단 위로 올린다', () => {
    expect(y({ vertOffset: 1 }, 20000)).toBe(20001)
    expect(y({ vertOffset: -2429 }, 20000)).toBe(17571)
    expect(paragraphObjectOffset(position({ vertOffset: -2429 }), true)).toBe(0)
    expect(paragraphObjectOffset(position({ vertOffset: -2429 }), false)).toBe(-2429)
    expect(paragraphObjectOffset(position({ vertOffset: 300 }), true)).toBe(300)
  })

  test('용지 기준 위치는 한/글 본문 영역(위쪽 여백 + 머리말 여백 아래) 안이면 머리말 여백만큼 위로 옮겨 본문 글과 맞춘다', () => {
    const withHeader: PageFrame = { ...page, headerOffset: 3600 }
    // 한/글 본문 위 끝(6000 + 3600) 아래: Han-Flow 본문 위 끝(6000)에서 같은 거리.
    expect(objectY(position({ vertRelTo: 'PAPER', vertOffset: 10315 }), withHeader)).toBe(6715)
    expect(objectY(position({ vertRelTo: 'PAPER', vertAlign: 'BOTTOM', vertOffset: 500 }), withHeader)).toBe(84188 - 4000 - 500 - 3600)
    // 머리말·위쪽 여백 자리와 쪽 기준 위치는 그대로다.
    expect(objectY(position({ vertRelTo: 'PAPER', vertOffset: 2000 }), withHeader)).toBe(2000)
    expect(objectY(position({ vertRelTo: 'PAGE', vertOffset: 100 }), withHeader)).toBe(6100)
  })

  test('본문 안으로 제한(flowWithText)하면 쪽 본문 밖 위치를 본문 안으로 옮긴다', () => {
    expect(y({ vertRelTo: 'PAPER', vertOffset: 1000, flowWithText: true })).toBe(6000)
    expect(y({ vertRelTo: 'PAPER', vertOffset: 83000, flowWithText: true })).toBe(84188 - 3000 - 4000)
    expect(y({ vertRelTo: 'PAPER', vertOffset: 1000 })).toBe(1000)
  })
})

describe('쪽 본문 띠(자리 차지·글 옆 배치)', () => {
  test('용지·쪽 기준 자리 차지 개체는 바깥 여백까지 쪽 본문 기준 띠를 비운다', () => {
    expect(pageObjectBand(position({ vertRelTo: 'PAGE', outMargin: { top: 140, right: 0, bottom: 852, left: 0 } }), page)).toEqual({ top: 0, bottom: 4852 })
    expect(pageObjectBand(position({ vertRelTo: 'PAGE', vertAlign: 'BOTTOM' }), page)).toEqual({ top: bodyHeight - 4000, bottom: bodyHeight })
    expect(pageObjectBand(position({ vertRelTo: 'PAPER', vertOffset: 30000, wrap: 'SQUARE' }), page)).toEqual({ top: 24000, bottom: 28000 })
  })

  test('글 앞·뒤 개체, 문단 기준 개체, 본문과 겹치지 않는 개체는 띠가 없다', () => {
    expect(pageObjectBand(position({ vertRelTo: 'PAGE', wrap: 'BEHIND_TEXT' }), page)).toBeUndefined()
    expect(pageObjectBand(position({ vertRelTo: 'PAGE', wrap: 'IN_FRONT_OF_TEXT' }), page)).toBeUndefined()
    expect(pageObjectBand(position(), page)).toBeUndefined()
    expect(pageObjectBand(position({ vertRelTo: 'PAPER', vertOffset: 500, height: 3000 }), page)).toBeUndefined()
  })

  test('겹치는 띠는 합쳐 높이를 한 번만 센다', () => {
    const bands = [{ top: 1000, bottom: 3000 }, { top: 0, bottom: 500 }, { top: 2500, bottom: 4000 }]
    expect(mergePageBands(bands)).toEqual([{ top: 0, bottom: 500 }, { top: 1000, bottom: 4000 }])
    expect(pageBandsHeight(bands)).toBe(3500)
  })

  test('본문 위 끝 띠는 빈 블록, 아래 끝 띠는 DOM 없이, 가운데 띠는 float로 비운다', () => {
    expect(pageBandLayout([{ top: 0, bottom: 4852 }, { top: 60000, bottom: bodyHeight }, { top: 20000, bottom: 24000 }], bodyHeight)).toEqual({
      top: 4852,
      middle: [{ top: 20000, bottom: 24000 }]
    })
    expect(pageBandLayout([{ top: 0, bottom: 3000 }, { top: 2000, bottom: 5000 }], bodyHeight)).toEqual({ top: 5000, middle: [] })
  })

  test('block의 용지·쪽 기준 개체 띠만 모은다', () => {
    const block: ViewerParagraph = {
      id: 'p',
      paraStyleId: '0',
      pageBreak: false,
      layoutHeight: 1000,
      content: [
        { type: 'text', text: '글', charStyleId: '0' },
        { type: 'image', resourceId: 'i', width: 10000, height: 4000, position: position({ vertRelTo: 'PAGE' }) },
        { type: 'image', resourceId: 'j', width: 10000, height: 4000, position: position({ vertRelTo: 'PAGE', wrap: 'BEHIND_TEXT' }) },
        { type: 'image', resourceId: 'k', width: 10000, height: 4000, position: position() }
      ]
    }
    expect(blockObjectBands(block, page)).toEqual([{ top: 0, bottom: 4000 }])
  })
})

describe('글 옆 배치(SQUARE)의 글 흐름 쪽과 쪽 기준 띠의 부분 채움', () => {
  const bodyWidth = 59528 - 5000 - 4000

  test('textFlow로 글이 흐를 쪽을 고르고 좁은 쪽에는 흘리지 않는다', () => {
    expect(wrapTextSide('BOTH_SIDES', 30000, 5000)).toBe('left')
    expect(wrapTextSide('BOTH_SIDES', 5000, 30000)).toBe('right')
    expect(wrapTextSide('LARGEST_ONLY', 12000, 11000)).toBe('left')
    expect(wrapTextSide('LEFT_ONLY', 5000, 30000)).toBe('left')
    expect(wrapTextSide('RIGHT_ONLY', 30000, 5000)).toBe('right')
    expect(wrapTextSide('LEFT_ONLY', WRAP_MIN_TEXT_WIDTH - 1, 30000)).toBe('none')
    expect(wrapTextSide('BOTH_SIDES', 100, 200)).toBe('none')
  })

  test('한 단 구역의 쪽 기준 글 옆 배치는 개체 쪽만 비우는 띠를 만든다', () => {
    // 쪽 본문 오른쪽 끝 그림 10000×4000(바깥 여백 왼쪽 500) → 오른쪽 float 10500, 글은 왼쪽으로 흐른다.
    const square = position({ vertRelTo: 'PAGE', horzRelTo: 'PAGE', horzAlign: 'RIGHT', vertOffset: 20000, wrap: 'SQUARE', outMargin: { top: 0, right: 0, bottom: 0, left: 500 } })
    expect(pageObjectBand(square, page, true)).toEqual({ top: 20000, bottom: 24000, wrap: { float: 'right', width: 10500 } })
    // 다단 구역(sideWrap 없음)·자리 차지·문단 기준 가로·안쪽 맞춤·글 흐를 자리가 좁은 쪽만 지정이면 폭 전체 띠다.
    expect(pageObjectBand(square, page)).toEqual({ top: 20000, bottom: 24000 })
    expect(pageObjectBand({ ...square, wrap: 'TOP_AND_BOTTOM' }, page, true)?.wrap).toBeUndefined()
    expect(pageObjectBand({ ...square, horzRelTo: 'PARA' }, page, true)?.wrap).toBeUndefined()
    expect(pageObjectBand({ ...square, horzAlign: 'OUTSIDE' }, page, true)?.wrap).toBeUndefined()
    expect(pageObjectBand({ ...square, textFlow: 'RIGHT_ONLY' }, page, true)?.wrap).toBeUndefined()
    // 왼쪽 끝 개체는 오른쪽으로 흐른다(왼쪽 float, 폭은 개체 오른쪽 끝까지).
    expect(pageObjectBand({ ...square, horzAlign: 'LEFT', horzOffset: 1000 }, page, true)?.wrap).toEqual({ float: 'left', width: 11000 })
    // 가운데 개체의 양쪽 흐름은 넓은 쪽 하나로 근사하고, 남은 폭이 본문의 1/5보다 좁으면 폭 전체 띠다.
    expect(pageObjectBand({ ...square, horzAlign: 'CENTER', width: 36000 }, page, true)?.wrap).toBeUndefined()
  })

  test('겹친 띠는 같은 쪽 float면 넓은 쪽, 다른 쪽이나 폭 전체 띠와 겹치면 폭 전체로 합친다', () => {
    expect(mergePageBands([
      { top: 0, bottom: 1000, wrap: { float: 'right', width: 5000 } },
      { top: 500, bottom: 2000, wrap: { float: 'right', width: 8000 } }
    ])).toEqual([{ top: 0, bottom: 2000, wrap: { float: 'right', width: 8000 } }])
    expect(mergePageBands([
      { top: 0, bottom: 1000, wrap: { float: 'right', width: 5000 } },
      { top: 500, bottom: 2000, wrap: { float: 'left', width: 5000 } }
    ])).toEqual([{ top: 0, bottom: 2000 }])
    expect(mergePageBands([{ top: 0, bottom: 1000, wrap: { float: 'right', width: 5000 } }, { top: 1000, bottom: 2000 }])).toEqual([{ top: 0, bottom: 2000 }])
  })

  test('글 옆 배치 띠는 쪽 본문 위·아래 끝에 닿아도 float로 둔다', () => {
    const wrap = { float: 'left' as const, width: 9000 }
    expect(pageBandLayout([{ top: 0, bottom: 4000, wrap }, { top: 70000, bottom: bodyHeight, wrap }], bodyHeight)).toEqual({
      top: 0,
      middle: [{ top: 0, bottom: 4000, wrap }, { top: 70000, bottom: bodyHeight, wrap }]
    })
  })

  test('글은 띠에 닿을 때만 띠를 지나고, 글 옆 띠 안에서는 남은 폭 비율만큼 느리게 흐른다', () => {
    const full = [{ top: 5000, bottom: 8000 }]
    // 띠 위에서 끝나는 글은 띠와 상관없다.
    expect(flowBlockEnd(0, 4000, 'text', full, bodyWidth)).toBe(4000)
    // 폭 전체 띠를 지나면 띠 높이만큼 아래로 간다.
    expect(flowBlockEnd(4000, 2000, 'text', full, bodyWidth)).toBe(9000)
    const side = [{ top: 5000, bottom: 8000, wrap: { float: 'right' as const, width: bodyWidth / 2 } }]
    const rate = 0.5 * PAGE_WRAP_FLOW_SAFETY
    // 띠 안에서 1000만큼의 글은 1000/rate 높이를 쓴다.
    expect(flowBlockEnd(4000, 2000, 'text', side, bodyWidth)).toBeCloseTo(5000 + 1000 / rate)
    // 띠를 다 채우고 남은 글은 띠 아래로 이어진다.
    expect(flowBlockEnd(4000, 4000, 'text', side, bodyWidth)).toBeCloseTo(8000 + 3000 - 3000 * rate)
    // 표·그림 block은 띠와 겹치지 않는 자리에 통째로 놓는다.
    expect(flowBlockEnd(4000, 2000, 'box', side, bodyWidth)).toBe(10000)
    expect(flowBlockEnd(1000, 2000, 'box', side, bodyWidth)).toBe(3000)
    // 섞인 문단은 띠 옆에서 문단 전체가 좁아지는 경우와 아래로 밀리는 경우 가운데 늦은 쪽이다.
    expect(flowBlockEnd(4000, 2000, 'mixed', side, bodyWidth)).toBeCloseTo(Math.max(10000, 4000 + 2000 / rate))
    expect(flowBlockEnd(4000, 2000, 'mixed', full, bodyWidth)).toBe(10000)
  })

  test('block 종류: 글만 든 문단, 표·그림만 든 문단, 섞인 문단', () => {
    const paragraph = (content: ViewerParagraph['content']): ViewerParagraph => ({ id: 'p', paraStyleId: '0', pageBreak: false, layoutHeight: 1000, content })
    const text = { type: 'text' as const, text: '글', charStyleId: '0' }
    const image = (pos?: ViewerObjectPosition) => ({ type: 'image' as const, resourceId: 'i', width: 1000, height: 1000, ...(pos ? { position: pos } : {}) })
    expect(blockBandFlowKind(paragraph([text, image(position({ vertRelTo: 'PAGE' })), image(position({ wrap: 'BEHIND_TEXT' }))]))).toBe('text')
    expect(blockBandFlowKind(paragraph([{ ...text, text: '' }, image()]))).toBe('box')
    expect(blockBandFlowKind(paragraph([text, image()]))).toBe('mixed')
    expect(blockBandFlowKind(paragraph([text, image(position({ wrap: 'SQUARE' }))]))).toBe('mixed')
  })
})
