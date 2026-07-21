import { ViewerPageNumber } from '../document/viewer_document'

export function formatPageNumber(pageNumber: ViewerPageNumber, pageIndex: number): string | undefined {
  if (pageIndex === 0 && pageNumber.hiddenOnFirstPage) return undefined
  const value = (pageNumber.start ?? 1) + pageIndex
  const number = pageNumber.formatType === 'DIGIT' ? String(value) : String(value)
  return pageNumber.sideChar ? `${pageNumber.sideChar} ${number} ${pageNumber.sideChar}` : number
}

export function pageNumberPosition(position: string): string {
  return position.toLowerCase().replaceAll('_', '-')
}
