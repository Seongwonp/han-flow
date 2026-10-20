import { ViewerDocument, ViewerPageNumber } from '../document/viewer_document'
import type { HwpUnit } from '../document/viewer_document'

export function formatPageNumber(pageNumber: ViewerPageNumber, pageIndex: number): string | undefined {
  if (pageIndex === 0 && pageNumber.hiddenOnFirstPage) return undefined
  if (pageNumber.position === 'NONE') return undefined
  const value = (pageNumber.start ?? 1) + pageIndex
  const number = pageNumber.formatType === 'DIGIT' ? String(value) : String(value)
  return pageNumber.sideChar ? `${pageNumber.sideChar} ${number} ${pageNumber.sideChar}` : number
}

export function pageNumberPosition(position: string): string {
  return position.toLowerCase().replaceAll('_', '-')
}

/** 쪽 번호 자리(OWPML `hp:pageNum pos`). 안쪽·바깥쪽은 홀수 쪽이면 왼쪽·오른쪽, 짝수 쪽이면 반대다. `NONE`은 undefined. */
export interface PageNumberPlacement {
  vertical: 'top' | 'bottom'
  horizontal: 'left' | 'center' | 'right'
}

export function pageNumberPlacement(position: string, pageNumber: number): PageNumberPlacement | undefined {
  const odd = Math.abs(Math.trunc(pageNumber)) % 2 === 1
  switch (position) {
    case 'TOP_LEFT': return { vertical: 'top', horizontal: 'left' }
    case 'TOP_CENTER': return { vertical: 'top', horizontal: 'center' }
    case 'TOP_RIGHT': return { vertical: 'top', horizontal: 'right' }
    case 'BOTTOM_LEFT': return { vertical: 'bottom', horizontal: 'left' }
    case 'BOTTOM_RIGHT': return { vertical: 'bottom', horizontal: 'right' }
    case 'OUTSIDE_TOP': return { vertical: 'top', horizontal: odd ? 'right' : 'left' }
    case 'OUTSIDE_BOTTOM': return { vertical: 'bottom', horizontal: odd ? 'right' : 'left' }
    case 'INSIDE_TOP': return { vertical: 'top', horizontal: odd ? 'left' : 'right' }
    case 'INSIDE_BOTTOM': return { vertical: 'bottom', horizontal: odd ? 'left' : 'right' }
    case 'NONE': return undefined
    default: return { vertical: 'bottom', horizontal: 'center' }
  }
}

/** 용지 위 끝에서 잰 세로 띠 [top, top + height](HWPUNIT). */
export interface PageStrip {
  top: HwpUnit
  height: HwpUnit
}

/**
 * 머리말·꼬리말 띠와 쪽 번호 자리(용지 기준 HWPUNIT). 한/글은 위쪽 여백 아래 머리말 여백 높이의 머리말 띠, 그 아래 본문, 본문 아래
 * 꼬리말 여백 높이의 꼬리말 띠, 그 아래 아래쪽 여백을 둔다(`ViewerDocument.page.margin`은 본문 여백이다). 머리말·꼬리말 글은 띠 위
 * 끝에서 시작한다. 쪽 번호는 위쪽이면 머리말 띠 위 끝(띠가 없으면 위쪽 여백 가운데), 아래쪽이면 꼬리말 띠 아래 끝(띠가 없으면
 * 아래쪽 여백 가운데)에 맞춘다. 가로는 쪽 본문 왼쪽·가운데·오른쪽이다.
 */
export interface PageDecorationLayout {
  header: PageStrip
  footer: PageStrip
  body: { left: HwpUnit; width: HwpUnit; top: HwpUnit; bottom: HwpUnit }
}

export function pageDecorationLayout(page: ViewerDocument['page']): PageDecorationLayout {
  const headerHeight = Math.max(Math.min(page.headerOffset ?? 0, page.margin.top), 0)
  const footerHeight = Math.max(Math.min(page.footerOffset ?? 0, page.margin.bottom), 0)
  return {
    header: { top: page.margin.top - headerHeight, height: headerHeight },
    footer: { top: page.height - page.margin.bottom, height: footerHeight },
    body: { left: page.margin.left, width: Math.max(page.width - page.margin.left - page.margin.right, 0), top: page.margin.top, bottom: page.height - page.margin.bottom }
  }
}

/**
 * 쪽 번호 상자의 세로 기준(용지 위 끝에서 잰 HWPUNIT). `edge`가 `top`이면 상자 위 끝, `bottom`이면 상자 아래 끝, `middle`이면 상자
 * 가운데가 `y`에 온다.
 */
export interface PageNumberAnchor {
  y: HwpUnit
  edge: 'top' | 'bottom' | 'middle'
  x: HwpUnit
  align: 'left' | 'center' | 'right'
}

export function pageNumberAnchor(page: ViewerDocument['page'], placement: PageNumberPlacement): PageNumberAnchor {
  const layout = pageDecorationLayout(page)
  const x = placement.horizontal === 'left'
    ? layout.body.left
    : placement.horizontal === 'right' ? layout.body.left + layout.body.width : layout.body.left + layout.body.width / 2
  if (placement.vertical === 'top') {
    return layout.header.height > 0
      ? { y: layout.header.top, edge: 'top', x, align: placement.horizontal }
      : { y: layout.header.top / 2, edge: 'middle', x, align: placement.horizontal }
  }
  const footerBottom = layout.footer.top + layout.footer.height
  return layout.footer.height > 0
    ? { y: footerBottom, edge: 'bottom', x, align: placement.horizontal }
    : { y: footerBottom + (page.height - footerBottom) / 2, edge: 'middle', x, align: placement.horizontal }
}
