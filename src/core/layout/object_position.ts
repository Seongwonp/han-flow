import type { BoxSpacing, HwpUnit, ViewerContent, ViewerObjectPosition, ViewerParagraph, ViewerTextWrap } from '../document/viewer_document'

/**
 * 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`)를 쪽 위 어디에 놓을지 정하는 순수 함수 모음. renderer(화면·PDF)와
 * pagination이 같은 계산을 쓴다. 좌표는 모두 용지 왼쪽 위 기준 HWPUNIT이다.
 *
 * 본문 최상위 문단의 개체만 원본 위치로 그린다(`objectPlacement`). 표 셀·글상자·머리말·꼬리말·각주 안 개체는 줄 흐름 안에 둔다.
 */

/**
 * 용지 크기와 쪽 여백(`ViewerDocument.page`). Han-Flow 쪽 본문은 위쪽·아래쪽 여백 안쪽이다. 한/글은 본문을 위쪽 여백에 머리말
 * 여백(`headerOffset`)을 더한 자리에서 시작하므로, 용지 기준 세로 위치는 그 차이만큼 옮겨 본문 글과의 관계를 맞춘다(`objectY`).
 */
export interface PageFrame {
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
  headerOffset?: HwpUnit
}

/** 개체를 둔 문단이 놓인 단과 문단의 가로 범위(용지 기준). 문단 범위는 문단 왼쪽·오른쪽 여백 안쪽이다. */
export interface HorizontalFrame {
  columnLeft: HwpUnit
  columnWidth: HwpUnit
  paraLeft: HwpUnit
  paraWidth: HwpUnit
}

/**
 * 본문 최상위 문단 안 개체를 그리는 방식.
 * - `band`: 문단 기준 자리 차지(`TOP_AND_BOTTOM`). 문단 흐름 안 블록으로 두어 개체 높이만큼 뒤 글을 아래로 민다.
 * - `wrap`: 문단 기준 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`). 문단 안 float로 두어 그 문단 글이 줄 단위로 개체 옆을 흐른다.
 * - `overlay`: 문단 기준 글 앞·뒤(`IN_FRONT_OF_TEXT`·`BEHIND_TEXT`). 문단 기준 절대 위치라 글 흐름에 영향이 없다.
 * - `page`: 용지·쪽 기준. 쪽 위 절대 위치에 그리고, 글 앞·뒤가 아니면 그 쪽 본문에서 개체 세로 띠를 비운다(`pageObjectBand`).
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
 * 문단 기준에 위 맞춤만 쓴다). 쪽 기준(`PAGE`)은 Han-Flow 쪽 본문 기준이다. 용지 기준(`PAPER`)은 한/글 본문 영역(위쪽 여백 +
 * 머리말 여백 아래) 안이면 머리말 여백만큼 위로 옮겨 Han-Flow 본문 글과 같은 관계에 둔다(그 위 머리말·여백 자리는 그대로).
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
  const header = Math.max(page.headerOffset ?? 0, 0)
  if (position.vertRelTo === 'PAPER' && header > 0 && y >= bodyTop + header) y -= header
  if (position.flowWithText && position.height <= bodyHeight) y = Math.min(Math.max(y, bodyTop), bodyTop + bodyHeight - position.height)
  return clampToPaper(y, position.height, page.height)
}

/** 문단 기준 개체의 문단 위 끝에서 잰 세로 위치. 흐름 안에 두는 개체(`band`·`wrap`)는 문단 위로 올리지 않는다. */
export function paragraphObjectOffset(position: ViewerObjectPosition, inFlow: boolean): HwpUnit {
  return inFlow ? Math.max(position.vertOffset, 0) : position.vertOffset
}

/** 쪽 본문 기준 세로 띠 [top, bottom](HWPUNIT, 쪽 본문 위 끝이 0). */
export interface PageBand {
  top: HwpUnit
  bottom: HwpUnit
}

/**
 * 용지·쪽 기준 개체가 쪽 본문에서 비우는 세로 띠(바깥 여백 포함, 쪽 본문 기준). 글 앞·뒤 개체, 문단 기준 개체, 쪽 본문과
 * 겹치지 않는 개체는 undefined다. 글 옆 배치(`SQUARE`·`TIGHT`·`THROUGH`)도 줄 단위로 감싸지 않고 위아래 띠로 비운다.
 */
export function pageObjectBand(position: ViewerObjectPosition, page: PageFrame): PageBand | undefined {
  if (objectPlacement(position) !== 'page' || isOverlayWrap(position.wrap)) return undefined
  const bodyHeight = page.height - page.margin.top - page.margin.bottom
  const y = objectY(position, page) - page.margin.top
  const top = Math.max(y - position.outMargin.top, 0)
  const bottom = Math.min(y + position.height + position.outMargin.bottom, bodyHeight)
  return bottom > top ? { top, bottom } : undefined
}

/** block(본문 최상위 문단) 안 용지·쪽 기준 개체의 세로 띠. */
export function blockObjectBands(block: ViewerParagraph, page: PageFrame): PageBand[] {
  const bands: PageBand[] = []
  for (const item of block.content) {
    if (!positionedContent(item)) continue
    const band = pageObjectBand(item.position, page)
    if (band) bands.push(band)
  }
  return bands
}

/** 겹치는 띠를 합쳐 위에서부터 정렬한다. */
export function mergePageBands(bands: readonly PageBand[]): PageBand[] {
  const sorted = [...bands].sort((left, right) => left.top - right.top || left.bottom - right.bottom)
  const merged: PageBand[] = []
  for (const band of sorted) {
    const last = merged[merged.length - 1]
    if (last && band.top <= last.bottom) last.bottom = Math.max(last.bottom, band.bottom)
    else merged.push({ ...band })
  }
  return merged
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
    if (band.top <= 0) top = Math.max(top, band.bottom)
    else if (band.bottom < bodyHeight) middle.push(band)
  }
  return { top, middle: middle.filter((band) => band.bottom > top).map((band) => ({ top: Math.max(band.top, top), bottom: band.bottom })) }
}
