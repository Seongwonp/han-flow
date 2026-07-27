export interface FixedPagePrintReadiness {
  expectedPages: number
  pageCount: number
  readyPages: number
  imageCount: number
  decodedImages: number
}

export function isFixedPagePrintReady(state: FixedPagePrintReadiness): boolean {
  return state.expectedPages > 0 &&
    state.pageCount === state.expectedPages &&
    state.readyPages === state.expectedPages &&
    state.imageCount === state.expectedPages &&
    state.decodedImages === state.expectedPages
}

function readiness(document: Document, expectedPages: number): FixedPagePrintReadiness {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.viewer-fixed-page'))
  const images = pages.flatMap((page) =>
    Array.from(page.querySelectorAll<HTMLImageElement>('.viewer-fixed-page-image'))
  )
  return {
    expectedPages,
    pageCount: pages.length,
    readyPages: pages.filter((page) => page.dataset.pageReady === 'true').length,
    imageCount: images.length,
    decodedImages: images.filter((image) => image.complete && image.naturalWidth > 0).length
  }
}

export async function waitForFixedPagePrintReady(
  document: Document,
  expectedPages: number,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  let state = readiness(document, expectedPages)
  while (!isFixedPagePrintReady(state)) {
    if (performance.now() >= deadline) {
      throw new Error(
        `PDF 페이지 준비 시간이 초과되었습니다. ` +
        `페이지 ${state.readyPages}/${state.expectedPages}, 이미지 ${state.decodedImages}/${state.expectedPages}`
      )
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    state = readiness(document, expectedPages)
  }
}
