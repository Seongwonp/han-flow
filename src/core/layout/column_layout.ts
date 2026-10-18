import { HwpUnit, supportsViewerColumnFlow, ViewerColumnLayout, viewerColumnWidths, ViewerParagraph, ViewerSection } from '../document/viewer_document'

/**
 * 다단 영역의 단 배치를 정하는 순수 함수 모음. pagination(단 너비별 높이·배분)과 renderer(화면·PDF의 단 위치·구분선)가 같은
 * 계산을 쓴다. 가로 좌표는 쪽 본문 왼쪽 끝 기준 HWPUNIT이다.
 */

/** 단 하나의 가로 범위(쪽 본문 왼쪽 끝 기준). */
export interface ColumnRect {
  left: HwpUnit
  width: HwpUnit
}

/** 단 사이 구분선의 가로 위치(쪽 본문 왼쪽 끝 기준, 간격 한가운데). */
export interface ColumnSeparator {
  x: HwpUnit
}

/**
 * 이 쪽에서 단을 오른쪽부터 놓는지. `RIGHT`는 언제나, `MIRROR`는 짝수 쪽(1쪽부터 센 쪽 번호)에서 오른쪽부터 놓는다.
 * 그 밖(`LEFT`·알 수 없는 값)은 왼쪽부터다.
 */
export function columnsRightToLeft(layout: Pick<ViewerColumnLayout, 'layout'>, pageNumber: number): boolean {
  if (layout.layout === 'RIGHT') return true
  if (layout.layout === 'MIRROR') return Math.abs(Math.trunc(pageNumber)) % 2 === 0
  return false
}

/**
 * 단 범위(흐름 순서: 0번이 첫 단). 왼쪽부터면 첫 단이 본문 왼쪽 끝에서, 오른쪽부터면 본문 오른쪽 끝에서 시작하고 단 뒤 간격
 * (`hp:colSz gap`)을 흐름 방향으로 둔다. 단이 하나면 본문 전체다.
 */
export function columnRects(layout: ViewerColumnLayout | undefined, bodyWidth: HwpUnit, pageNumber = 1): ColumnRect[] {
  if (!supportsViewerColumnFlow(layout)) return [{ left: 0, width: bodyWidth }]
  const { widths, gaps } = viewerColumnWidths(bodyWidth, layout)
  const rightToLeft = columnsRightToLeft(layout, pageNumber)
  const rects: ColumnRect[] = []
  let cursor = rightToLeft ? bodyWidth : 0
  widths.forEach((width, index) => {
    if (rightToLeft) {
      rects.push({ left: cursor - width, width })
      cursor -= width + gaps[index]
    } else {
      rects.push({ left: cursor, width })
      cursor += width + gaps[index]
    }
  })
  return rects
}

/** 흐름 순서로 이웃한 단 사이 간격의 한가운데. 구분선 종류가 없거나 `NONE`이면 빈 배열이다. */
export function columnSeparators(layout: ViewerColumnLayout | undefined, bodyWidth: HwpUnit, pageNumber = 1): ColumnSeparator[] {
  if (!supportsViewerColumnFlow(layout) || !layout.line || layout.line.type === 'NONE') return []
  const rects = columnRects(layout, bodyWidth, pageNumber)
  return rects.slice(1).map((rect, index) => {
    const previous = rects[index]
    const [leftEdge, rightEdge] = previous.left <= rect.left
      ? [previous.left + previous.width, rect.left]
      : [rect.left + rect.width, previous.left]
    return { x: (leftEdge + rightEdge) / 2 }
  })
}

/** 단 너비를 측정값 key로 쓴다(HWPUNIT 정수). 같은 key의 단은 같은 측정값을 쓴다. */
export function columnWidthKey(width: HwpUnit): string {
  return String(Math.round(width))
}

/**
 * 단 높이를 고르게 맞추는(배분 다단) block 나눔. block은 순서대로 이어서 단에 넣고 나누지 않는다. `heightOf(column, block)`은
 * 그 단 너비로 잰 block 높이다(서로 다른 너비 단). 가장 높은 단이 가장 낮아지는 나눔을 찾아 단마다 첫 block 번호를 돌려준다
 * (`starts[0]`은 0, 빈 단은 다음 단과 같은 번호). block이 없거나 단이 하나면 `[0]`·모두 0이다.
 */
export function balancedColumnStarts(
  blockCount: number,
  columnCount: number,
  heightOf: (column: number, block: number) => number
): number[] {
  if (columnCount <= 1 || blockCount <= 0) return Array.from({ length: Math.max(columnCount, 1) }, () => 0)
  // 높이 한도 `limit`로 앞 단부터 채우면 단이 모자라지 않는지. 단마다 첫 block은 한도보다 높아도 넣는다.
  const fill = (limit: number): number[] | undefined => {
    const starts: number[] = []
    let block = 0
    for (let column = 0; column < columnCount; column += 1) {
      starts.push(block)
      let used = 0
      const first = block
      while (block < blockCount) {
        const height = Math.max(heightOf(column, block), 0)
        if (block > first && used + height > limit) break
        used += height
        block += 1
      }
    }
    return block >= blockCount ? starts : undefined
  }
  const total = Math.max(...Array.from({ length: columnCount }, (_, column) =>
    Array.from({ length: blockCount }, (_unused, block) => Math.max(heightOf(column, block), 0)).reduce((sum, height) => sum + height, 0)
  ))
  let low = 0
  let high = Math.max(total, 1)
  let best = fill(high) ?? Array.from({ length: columnCount }, (_, column) => column === 0 ? 0 : blockCount)
  for (let step = 0; step < 40 && high - low > 0.5; step += 1) {
    const middle = (low + high) / 2
    const starts = fill(middle)
    if (starts) {
      best = starts
      high = middle
    } else {
      low = middle
    }
  }
  return best
}

/**
 * section 측정 DOM의 묶음. 다단 정의가 같은 연속 block(구역 다단, 그 뒤 새 다단 정의마다 새 묶음)을 그 영역의 첫 단 너비로
 * 재고(`width`, `LayoutMeasurements.blockHeights`), 첫 단과 너비가 다른 단이 있으면 그 너비로 한 번 더 잰다(`extraWidths`,
 * `LayoutMeasurements.columnHeights`).
 */
export interface ColumnMeasurementGroup {
  blocks: ViewerParagraph[]
  layout?: ViewerColumnLayout
  width: HwpUnit
  extraWidths: HwpUnit[]
}

export function columnMeasurementGroups(section: Pick<ViewerSection, 'blocks' | 'columnLayout'>, bodyWidth: HwpUnit): ColumnMeasurementGroup[] {
  const groups: ColumnMeasurementGroup[] = []
  const open = (layout: ViewerColumnLayout | undefined) => {
    const active = supportsViewerColumnFlow(layout) ? layout : undefined
    const widths = viewerColumnWidths(bodyWidth, active).widths
    const baseKey = columnWidthKey(widths[0])
    const extraWidths: HwpUnit[] = []
    const seen = new Set([baseKey])
    for (const width of widths) {
      const key = columnWidthKey(width)
      if (seen.has(key)) continue
      seen.add(key)
      extraWidths.push(width)
    }
    groups.push({ blocks: [], ...(active ? { layout: active } : {}), width: widths[0], extraWidths })
  }
  open(section.columnLayout)
  for (const block of section.blocks) {
    if (block.columnLayout) open(block.columnLayout)
    groups[groups.length - 1].blocks.push(block)
  }
  return groups.filter((group, index) => group.blocks.length || index === 0)
}
