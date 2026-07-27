import { FixedPageDescriptor } from '../document/fixed_page_document'

export interface FixedPageVirtualRange {
  start: number
  end: number
  topSpacer: number
  bottomSpacer: number
}

export function fixedPageOffsets(pages: FixedPageDescriptor[], gap = 24): number[] {
  const offsets = [0]
  for (const page of pages) {
    offsets.push(offsets[offsets.length - 1] + page.height + gap)
  }
  return offsets
}

function firstPageEndingAfter(offsets: number[], pages: FixedPageDescriptor[], position: number): number {
  let low = 0
  let high = pages.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle] + pages[middle].height < position) low = middle + 1
    else high = middle
  }
  return low
}

export function fixedPageVirtualRange(
  pages: FixedPageDescriptor[],
  scrollTop: number,
  viewportHeight: number,
  zoom: number,
  options: { gap?: number; overscan?: number } = {}
): FixedPageVirtualRange {
  const gap = options.gap ?? 24
  const overscan = options.overscan ?? 2
  if (!pages.length) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 }
  const offsets = fixedPageOffsets(pages, gap)
  const unscaledTop = Math.max(scrollTop / Math.max(zoom, 0.01), 0)
  const unscaledBottom = unscaledTop + viewportHeight / Math.max(zoom, 0.01)
  const firstVisible = firstPageEndingAfter(offsets, pages, unscaledTop)
  let lastVisible = firstVisible
  while (lastVisible < pages.length && offsets[lastVisible] < unscaledBottom) lastVisible += 1
  const start = Math.max(firstVisible - overscan, 0)
  const end = Math.min(lastVisible + overscan, pages.length)
  return {
    start,
    end,
    topSpacer: offsets[start],
    bottomSpacer: Math.max(offsets[pages.length] - offsets[end], 0)
  }
}
