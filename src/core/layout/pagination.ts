import { ViewerDocument, ViewerParagraph } from '../document/viewer_document'

export function paginateDocument(document: ViewerDocument): ViewerParagraph[][] {
  const pages: ViewerParagraph[][] = []
  const availableHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
  let current: ViewerParagraph[] = []
  let usedHeight = 0
  const flush = () => {
    if (current.length) pages.push(current)
    current = []
    usedHeight = 0
  }

  document.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) flush()
    section.blocks.forEach((block) => {
      if (block.pageBreak) flush()
      if (current.length && block.layoutHeight > 0 && usedHeight + block.layoutHeight > availableHeight) flush()
      current.push(block)
      usedHeight += block.layoutHeight
    })
  })
  flush()
  return pages
}
