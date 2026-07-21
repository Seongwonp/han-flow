import { ViewerDocument, ViewerHeaderFooter, ViewerPageNumber } from '../document/viewer_document'
import { ViewerPage } from './pagination'

export interface ViewerPageDecoration {
  pageNumber?: ViewerPageNumber
  pageNumberIndex: number
  header?: ViewerHeaderFooter
  footer?: ViewerHeaderFooter
}

function matchingControl(controls: ViewerHeaderFooter[], pageNumber: number): ViewerHeaderFooter | undefined {
  const parity = pageNumber % 2 === 0 ? 'EVEN' : 'ODD'
  return [...controls].reverse().find((control) => control.applyPageType === parity)
    ?? [...controls].reverse().find((control) => control.applyPageType === 'BOTH')
}

export function resolvePageDecorations(document: ViewerDocument, pages: ViewerPage[]): ViewerPageDecoration[] {
  let activePageNumber: ViewerPageNumber | undefined
  let activeHeaders: ViewerHeaderFooter[] = []
  let activeFooters: ViewerHeaderFooter[] = []
  let number = 1
  let previousSection = -1

  return pages.map((page) => {
    if (page.sectionIndex !== previousSection) {
      const section = document.sections[page.sectionIndex]
      if (section.pageNumber) {
        activePageNumber = section.pageNumber
        if (section.pageNumber.start !== undefined) number = section.pageNumber.start
      }
      if (section.headers.length) activeHeaders = section.headers
      if (section.footers.length) activeFooters = section.footers
      previousSection = page.sectionIndex
    }
    const decoration = {
      pageNumber: activePageNumber,
      pageNumberIndex: number - (activePageNumber?.start ?? 1),
      header: matchingControl(activeHeaders, number),
      footer: matchingControl(activeFooters, number)
    }
    number += 1
    return decoration
  })
}
