import type { BoxSpacing, HwpUnit, ViewerContent, ViewerObjectPosition, ViewerParagraph, ViewerTextWrap } from '../document/viewer_document'

/**
 * 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`)를 쪽 위 어디에 놓을지 정하는 순수 함수 모음. renderer(화면·PDF)와
 * pagination이 같은 계산을 쓴다. 좌표는 모두 용지 왼쪽 위 기준 HWPUNIT이다.
 *
 * 본문 최상위 문단 개체는 쪽·단 기준, 머리말·꼬리말 개체는 쪽 기준, 표 셀·글상자 안 개체는 그 칸을 용지로 본 기준으로 원본 위치에
 * 그린다(`objectPlacement`, renderer `containerObjectFrame`). 각주 안 개체는 줄 흐름 안에 둔다.
 */

/**
 * 용지 크기와 쪽 본문 여백(`ViewerDocument.page`). `margin.top`·`margin.bottom`은 한/글 본문 영역 여백(위쪽 여백 + 머리말 여백,
 * 아래쪽 여백 + 꼬리말 여백)이라 쪽 기준(`PAGE`)·용지 기준(`PAPER`) 위치가 한/글과 같은 용지 자리에 놓인다.
 */
export interface PageFrame {
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
}

/** 개체를 둔 문단이 놓인 단과 문단의 가로 범위(용지 기준). 문단 범위는 문단 왼쪽·오른쪽 여백 안쪽이다. */
export interface HorizontalFrame {
  columnLeft: HwpUnit
  columnWidth: HwpUnit
  paraLeft: HwpUnit
  paraWidth: HwpUnit
}

/**
 * 문단 안 개체를 그리는 방식.
 * - `band`: 문단 기준 자리 차지(`TOP_AND_BOTTOM`). 문단 흐름 안 블록으로 두어 개체 높이만큼 뒤 글을 아래로 민다.
 * - `wrap`: 문단 기준 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`). 문단 안 float로 두어 그 문단 글이 줄 단위로 개체 옆을 흐른다.
 * - `overlay`: 문단 기준 글 앞·뒤(`IN_FRONT_OF_TEXT`·`BEHIND_TEXT`). 문단 기준 절대 위치라 글 흐름에 영향이 없다.
 * - `page`: 용지·쪽 기준. 쪽(칸 안 개체는 칸) 위 절대 위치에 그리고, 글 앞·뒤가 아니면 그 쪽 본문(칸 글 흐름)에서 개체 세로 띠를
 *   비운다(`pageObjectBand`, 글 옆 배치는 다단이 없으면 개체 쪽만).
 */
export type ObjectPlacement = 'band' | 'wrap' | 'overlay' | 'page'

export function isOverlayWrap(wrap: ViewerTextWrap): boolean {
  return wrap === 'BEHIND_TEXT' || wrap === 'IN_FRONT_OF_TEXT'
}

export function objectPlacement(position: ViewerObjectPosition | undefined): ObjectPlacement | undefined {
  if (!position) return undefined
  if (position.vertRelTo !== 'PARA') return 'page'
  if (isOverlayWrap(position.wrap)) return 'overlay'
  return position.wrap === 'TOP_AND_BOTTOM' ? 'band' : 'wrap'
}

export type PositionedContent = Extract<ViewerContent, { type: 'image' | 'table' | 'object-placeholder' }> & { position: ViewerObjectPosition }

/** 원본 위치로 그리는 content(그림·표·개체 자리 표시)인지. 각주 번호 같은 줄 안 표시는 위치가 없다. */
export function positionedContent(item: ViewerContent): item is PositionedContent {
  return (item.type === 'image' || item.type === 'table' || item.type === 'object-placeholder') && Boolean(item.position)
}

export function contentPlacement(item: ViewerContent): ObjectPlacement | undefined {
  return positionedContent(item) ? objectPlacement(item.position) : undefined
}

/**
 * 문단 높이를 재는 측정 DOM과 쪽 DOM에서 문단 흐름 밖에 있는 content인지. `page`는 쪽 layer에, `overlay`는 절대 위치로 그리므로
 * 문단 높이에 들지 않는다. `band`·`wrap`은 문단 안에서 자리를 차지한다.
 */
export function contentOutOfFlow(item: ViewerContent): boolean {
  const placement = contentPlacement(item)
  return placement === 'page' || placement === 'overlay'
}

/** 쪽 사이에서 나눌 수 있는 문단 흐름 안 표인지. 글 옆 float(`wrap`)와 흐름 밖 표는 나누지 않는다. */
export function tableInFlow(item: ViewerContent): boolean {
  if (item.type !== 'table') return false
  const placement = contentPlacement(item)
  return placement === undefined || placement === 'band'
}

/** 홀수 쪽(1쪽부터)이면 안쪽(`INSIDE`)이 왼쪽, 바깥쪽(`OUTSIDE`)이 오른쪽이다. 짝수 쪽은 반대다. */
function resolvedHorizontalAlign(align: ViewerObjectPosition['horzAlign'], pageNumber: number): 'LEFT' | 'CENTER' | 'RIGHT' {
  const odd = Math.abs(Math.trunc(pageNumber)) % 2 === 1
  if (align === 'INSIDE') return odd ? 'LEFT' : 'RIGHT'
  if (align === 'OUTSIDE') return odd ? 'RIGHT' : 'LEFT'
  return align
}

function aligned(start: number, extent: number, size: number, align: 'START' | 'CENTER' | 'END', offset: number): number {
  if (align === 'END') return start + extent - size - offset
  if (align === 'CENTER') return start + (extent - size) / 2 + offset
  return start + offset
}

/** 가로 기준 영역(`horzRelTo`)의 [왼쪽, 폭]. */
export function horizontalReference(position: ViewerObjectPosition, page: PageFrame, frame: HorizontalFrame): [number, number] {
  switch (position.horzRelTo) {
    case 'PAPER': return [0, page.width]
    case 'PAGE': return [page.margin.left, page.width - page.margin.left - page.margin.right]
    case 'COLUMN': return [frame.columnLeft, frame.columnWidth]
    default: return [frame.paraLeft, frame.paraWidth]
  }
}

/** 용지 밖으로 나가지 않게(쪽 overflow·PDF 잘림 방지) 개체가 용지 안에 들어가면 그 안으로 옮긴다. */
function clampToPaper(value: number, size: number, extent: number): number {
  if (size >= extent) return Math.min(Math.max(value, extent - size), 0)
  return Math.min(Math.max(value, 0), extent - size)
}

/** 개체 왼쪽 끝(용지 기준). `pageNumber`는 안쪽·바깥쪽 맞춤에 쓰는 1부터 센 쪽 번호다. */
export function objectX(position: ViewerObjectPosition, page: PageFrame, frame: HorizontalFrame, pageNumber = 1): HwpUnit {
  const [start, extent] = horizontalReference(position, page, frame)
  const align = resolvedHorizontalAlign(position.horzAlign, pageNumber)
  const x = aligned(start, extent, position.width, align === 'LEFT' ? 'START' : align === 'RIGHT' ? 'END' : 'CENTER', position.horzOffset)
  return clampToPaper(x, position.width, page.width)
}

/**
 * 개체 위쪽 끝(용지 기준). 문단 기준(`PARA`)이면 `paraTop`(문단 위 끝)에서 `vertOffset`만큼 아래이고 맞춤은 위로 본다(한/글은
 * 문단 기준에 위 맞춤만 쓴다). 쪽 기준(`PAGE`)은 쪽 본문 영역, 용지 기준(`PAPER`)은 용지 전체 기준이다.
 * `flowWithText`면 쪽 본문 안으로 제한한다. 안쪽·바깥쪽 세로 맞춤은 위·아래로 본다.
 */
export function objectY(position: ViewerObjectPosition, page: PageFrame, paraTop = page.margin.top): HwpUnit {
  const bodyTop = page.margin.top
  const bodyHeight = page.height - page.margin.top - page.margin.bottom
  if (position.vertRelTo === 'PARA') return paraTop + position.vertOffset
  const [start, extent] = position.vertRelTo === 'PAPER' ? [0, page.height] : [bodyTop, bodyHeight]
  const align = position.vertAlign === 'BOTTOM' || position.vertAlign === 'OUTSIDE'
    ? 'END'
    : position.vertAlign === 'CENTER' ? 'CENTER' : 'START'
  let y = aligned(start, extent, position.height, align, position.vertOffset)
  if (position.flowWithText && position.height <= bodyHeight) y = Math.min(Math.max(y, bodyTop), bodyTop + bodyHeight - position.height)
  return clampToPaper(y, position.height, page.height)
}

/** 문단 기준 개체의 문단 위 끝에서 잰 세로 위치. 흐름 안에 두는 개체(`band`·`wrap`)는 문단 위로 올리지 않는다. */
export function paragraphObjectOffset(position: ViewerObjectPosition, inFlow: boolean): HwpUnit {
  return inFlow ? Math.max(position.vertOffset, 0) : position.vertOffset
}

/**
 * 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)에서 본문 글이 흐르는 쪽. `none`이면 개체 양옆 빈 곳이 좁아 글이 개체 옆에 오지 않는다
 * (자리 차지처럼 개체 아래로 간다).
 */
export type WrapTextSide = 'left' | 'right' | 'none'

/** 글 옆 배치에서 글을 흘리는 최소 빈 폭(HWPUNIT, 약 1cm). 이보다 좁은 쪽에는 글을 두지 않는다. */
export const WRAP_MIN_TEXT_WIDTH = 2835

/**
 * 개체 왼쪽·오른쪽 빈 폭(`leftGap`·`rightGap`, 바깥 여백 뺀 값)과 `textFlow`로 글이 흐를 쪽을 정한다.
 * - `LEFT_ONLY`·`RIGHT_ONLY`: 그쪽에만(빈 폭이 `minWidth`보다 좁으면 `none`).
 * - `LARGEST_ONLY`: 넓은 쪽.
 * - `BOTH_SIDES`: 한/글은 한 줄을 개체 양옆 두 조각으로 나눠 흘리지만 CSS 줄 상자는 한 줄을 둘로 나누지 못하므로 넓은 쪽으로
 *   근사한다. 개체가 한쪽 끝에 붙어 다른 쪽이 좁으면 한/글도 넓은 쪽에만 흐르므로 같다.
 * `TIGHT`(윤곽선 감싸기)·`THROUGH`(빈 곳 흐름)도 개체 상자를 쓰는 `SQUARE`로 근사한다.
 */
export function wrapTextSide(textFlow: string, leftGap: number, rightGap: number, minWidth = WRAP_MIN_TEXT_WIDTH): WrapTextSide {
  const left = leftGap >= minWidth
  const right = rightGap >= minWidth
  if (textFlow === 'LEFT_ONLY') return left ? 'left' : 'none'
  if (textFlow === 'RIGHT_ONLY') return right ? 'right' : 'none'
  if (!left && !right) return 'none'
  return rightGap >= leftGap ? 'right' : 'left'
}

/**
 * 쪽 본문 기준 세로 띠 [top, bottom](HWPUNIT, 쪽 본문 위 끝이 0).
 * `wrap`이 있으면 글 옆 배치 띠다. 쪽 본문 `float`쪽 끝에서 `width`만큼(개체와 그 바깥쪽 빈 곳)만 비우고 남은 폭에 글이 흐른다.
 * 없으면 띠 폭 전체를 비운다(자리 차지, 다단 구역, 글 흐를 자리가 좁은 글 옆 배치).
 */
export interface PageBand {
  top: HwpUnit
  bottom: HwpUnit
  wrap?: { float: 'left' | 'right'; width: HwpUnit }
}

/** 쪽 기준 글 옆 배치 띠에서 글을 흘리는 최소 폭의 본문 폭 비율. 이보다 좁으면 띠 폭 전체를 비운다(쪽 나눔 어림 오차 방지). */
export const PAGE_WRAP_MIN_TEXT_RATIO = 0.2

/**
 * 용지·쪽 기준 개체가 쪽 본문에서 비우는 세로 띠(바깥 여백 포함, 쪽 본문 기준). 글 앞·뒤 개체, 문단 기준 개체, 쪽 본문과
 * 겹치지 않는 개체는 undefined다.
 *
 * `sideWrap`(다단이 없는 구역)이면 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)는 개체 옆으로 글을 흘리는 띠(`wrap`)가 된다. 가로 위치가
 * 문단 기준(`PARA`, 쪽 나눔은 문단 여백을 모른다)이거나 안쪽·바깥쪽 맞춤(쪽 번호가 필요하다)이면 띠 폭 전체를 비운다.
 */
export function pageObjectBand(position: ViewerObjectPosition, page: PageFrame, sideWrap = false): PageBand | undefined {
  if (objectPlacement(position) !== 'page' || isOverlayWrap(position.wrap)) return undefined
  const bodyHeight = page.height - page.margin.top - page.margin.bottom
  const y = objectY(position, page) - page.margin.top
  const top = Math.max(y - position.outMargin.top, 0)
  const bottom = Math.min(y + position.height + position.outMargin.bottom, bodyHeight)
  if (bottom <= top) return undefined
  if (
    !sideWrap || position.wrap === 'TOP_AND_BOTTOM' || position.horzRelTo === 'PARA' ||
    position.horzAlign === 'INSIDE' || position.horzAlign === 'OUTSIDE'
  ) return { top, bottom }
  const bodyLeft = page.margin.left
  const bodyWidth = page.width - page.margin.left - page.margin.right
  const x = objectX(position, page, { columnLeft: bodyLeft, columnWidth: bodyWidth, paraLeft: bodyLeft, paraWidth: bodyWidth })
  const clamp = (value: number) => Math.min(Math.max(value, 0), bodyWidth)
  const left = clamp(x - position.outMargin.left - bodyLeft)
  const right = clamp(x + position.width + position.outMargin.right - bodyLeft)
  const side = wrapTextSide(position.textFlow, left, bodyWidth - right, Math.max(WRAP_MIN_TEXT_WIDTH, bodyWidth * PAGE_WRAP_MIN_TEXT_RATIO))
  if (side === 'none') return { top, bottom }
  return { top, bottom, wrap: side === 'right' ? { float: 'left', width: right } : { float: 'right', width: bodyWidth - left } }
}

/** block(본문 최상위 문단) 안 용지·쪽 기준 개체의 세로 띠. `sideWrap`은 `pageObjectBand`와 같다. */
export function blockObjectBands(block: ViewerParagraph, page: PageFrame, sideWrap = false): PageBand[] {
  const bands: PageBand[] = []
  for (const item of block.content) {
    if (!positionedContent(item)) continue
    const band = pageObjectBand(item.position, page, sideWrap)
    if (band) bands.push(band)
  }
  return bands
}

/** 겹치거나 맞닿은 두 띠를 합친 글 옆 배치. 같은 쪽 float면 넓은 쪽, 그 밖(폭 전체 띠와 합치거나 양쪽 float)은 폭 전체다. */
function mergedWrap(left: PageBand['wrap'], right: PageBand['wrap']): PageBand['wrap'] {
  if (!left || !right || left.float !== right.float) return undefined
  return { float: left.float, width: Math.max(left.width, right.width) }
}

/** 겹치는 띠를 합쳐 위에서부터 정렬한다. */
export function mergePageBands(bands: readonly PageBand[]): PageBand[] {
  const sorted = [...bands].sort((left, right) => left.top - right.top || left.bottom - right.bottom)
  const merged: PageBand[] = []
  for (const band of sorted) {
    const last = merged[merged.length - 1]
    if (last && band.top <= last.bottom) {
      const wrap = mergedWrap(last.wrap, band.wrap)
      if (wrap) last.wrap = wrap
      else delete last.wrap
      last.bottom = Math.max(last.bottom, band.bottom)
    } else merged.push({ ...band })
  }
  return merged
}

/**
 * 쪽 기준 글 옆 띠 안에서 글이 흐르는 속도(남은 폭 비율)에 곱하는 안전 계수. 좁은 줄은 낱말 단위 줄바꿈으로 남는 자리가 있어
 * 높이가 폭 비율보다 더 늘 수 있다. 어림이 모자라면 쪽 아래 여백으로 넘치므로 조금 넉넉히 잡는다.
 */
export const PAGE_WRAP_FLOW_SAFETY = 0.85

/**
 * 쪽 본문에서 띠를 지나는 block 종류.
 * - `text`: 글만 든 문단. 글 옆 띠 안에서는 남은 폭에 줄 단위로 흐르고, 폭 전체 띠는 건너뛴다.
 * - `box`: 표·그림만 든 문단. 띠와 겹치지 않는 첫 자리에 통째로 놓인다(표는 float 옆에 들어가지 않으면 float 아래로 간다).
 * - `mixed`: 글과 표·그림이 섞였거나 글 옆 개체를 품은 문단(`flow-root`). 띠 옆에서 문단 전체가 좁아질 수도, 아래로 밀릴 수도
 *   있어 둘 중 늦게 끝나는 쪽으로 어림한다.
 */
export type BandFlowKind = 'text' | 'box' | 'mixed'

/** 쪽 위 block이 띠를 지나는 방식(`flowBlockEnd`). 글 앞·뒤·쪽 기준 개체는 문단 흐름 밖이라 따지지 않는다. */
export function blockBandFlowKind(block: ViewerParagraph): BandFlowKind {
  let text = false
  let box = false
  for (const item of block.content) {
    if (item.type === 'text') {
      if (item.text) text = true
      continue
    }
    if (item.type === 'object-placeholder' && !item.position && item.flow === 'marker') {
      text = true
      continue
    }
    if (positionedContent(item) && contentOutOfFlow(item)) continue
    if (positionedContent(item) && contentPlacement(item) === 'wrap') return 'mixed'
    box = true
  }
  if (!box) return 'text'
  return text ? 'mixed' : 'box'
}

function bandTextRate(band: PageBand, bodyWidth: number): number {
  if (!band.wrap || bodyWidth <= 0) return 0
  return Math.max(bodyWidth - band.wrap.width, 0) / bodyWidth * PAGE_WRAP_FLOW_SAFETY
}

/**
 * 다단이 없는 쪽에서 쪽 본문 `start`부터 높이 `height`(띠가 없을 때 높이)인 block을 띠(`mergePageBands` 결과) 사이로 흘렸을 때 끝
 * 위치. 띠는 글이 닿을 때만 자리를 쓴다(띠 위에서 끝나는 글은 띠와 상관없다).
 */
export function flowBlockEnd(start: number, height: number, kind: BandFlowKind, bands: readonly PageBand[], bodyWidth: number): number {
  if (height <= 0 || !bands.length) return start + Math.max(height, 0)
  const boxEnd = () => {
    let top = start
    for (const band of bands) {
      if (band.bottom <= top) continue
      if (band.top >= top + height) break
      top = band.bottom
    }
    return top + height
  }
  if (kind === 'box') return boxEnd()
  if (kind === 'mixed') {
    const end = boxEnd()
    const rates = bands.filter((band) => band.wrap && band.top < end && band.bottom > start).map((band) => bandTextRate(band, bodyWidth))
    const rate = rates.length ? Math.min(...rates) : 0
    return rate > 0 ? Math.max(end, start + height / rate) : end
  }
  let cursor = start
  let remaining = height
  for (const band of bands) {
    if (band.bottom <= cursor) continue
    if (band.top > cursor) {
      if (remaining <= band.top - cursor) return cursor + remaining
      remaining -= band.top - cursor
      cursor = band.top
    }
    const rate = bandTextRate(band, bodyWidth)
    const capacity = (band.bottom - cursor) * rate
    if (rate > 0 && remaining <= capacity) return cursor + remaining / rate
    remaining -= capacity
    cursor = band.bottom
  }
  return cursor + remaining
}

/** 띠들이 쪽 본문에서 차지하는 높이(겹친 부분은 한 번). pagination은 이만큼 본문 높이를 줄인다. */
export function pageBandsHeight(bands: readonly PageBand[]): HwpUnit {
  return mergePageBands(bands).reduce((sum, band) => sum + band.bottom - band.top, 0)
}

/**
 * 쪽 DOM에서 띠를 비우는 방법. 본문 위 끝에 붙은 띠는 본문 앞 빈 블록(`top`, 높이), 본문 아래 끝에 닿는 띠는 pagination이
 * 그만큼 덜 채우므로 DOM이 필요 없고, 그 사이 띠(`middle`)는 폭 0 float로 띠 위 끝까지 내려간 뒤 폭 전체 float로 띠를 비운다.
 */
export function pageBandLayout(bands: readonly PageBand[], bodyHeight: HwpUnit): { top: HwpUnit; middle: PageBand[] } {
  let top = 0
  const middle: PageBand[] = []
  for (const band of mergePageBands(bands)) {
    // 글 옆 배치 띠는 위·아래 끝에 닿아도 옆으로 글이 흐르므로 float로 둔다.
    if (!band.wrap && band.top <= 0) top = Math.max(top, band.bottom)
    else if (band.wrap || band.bottom < bodyHeight) middle.push(band)
  }
  return { top, middle: middle.filter((band) => band.bottom > top).map((band) => ({ ...band, top: Math.max(band.top, top) })) }
}

/**
 * 쪽 본문 기준 띠를 쪽 안 다단 영역(`top`부터 `height`만큼) 기준으로 옮긴다. 영역 밖 띠는 빼고 영역에 걸친 띠는 영역 안으로 자른다.
 * 영역이 쪽 본문 위 끝에서 쪽 끝까지면 띠 그대로다.
 */
export function regionPageBands(bands: readonly PageBand[] | undefined, top: HwpUnit, height: HwpUnit): PageBand[] | undefined {
  if (!bands?.length) return undefined
  if (top <= 0 && !Number.isFinite(height)) return [...bands]
  const shifted = bands
    .map((band) => ({ ...band, top: Math.max(band.top - top, 0), bottom: Math.min(band.bottom - top, height) }))
    .filter((band) => band.bottom > band.top)
  return shifted.length ? shifted : undefined
}
