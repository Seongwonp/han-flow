export type HwpUnit = number

export interface ViewerDocument {
  page: { width: HwpUnit; height: HwpUnit; margin: BoxSpacing; headerOffset: HwpUnit; footerOffset: HwpUnit }
  fonts: Record<string, string>
  charStyles: Record<string, ViewerCharStyle>
  paraStyles: Record<string, ViewerParaStyle>
  cellStyles: Record<string, ViewerCellStyle>
  resources: Record<string, ViewerResource>
  sections: ViewerSection[]
  diagnostics: ViewerDiagnostic[]
}

export interface ViewerPageNumber {
  position: string
  formatType: string
  sideChar: string
  start?: number
  hiddenOnFirstPage: boolean
}

export interface ViewerHeaderFooter {
  id: string
  applyPageType: string
  paragraphs: ViewerParagraph[]
}

export interface ViewerParseTimings {
  packageOpenMs: number
  packageIndexMs: number
  decodeMs: number
  mainTotalMs: number
}

export interface BoxSpacing { top: HwpUnit; right: HwpUnit; bottom: HwpUnit; left: HwpUnit }
export interface ViewerDiagnostic { source: string; message: string }
export interface ViewerCharStyle { id: string; height: HwpUnit; color: string; bold: boolean; fontId?: string; fontFamily?: string }
export interface ViewerParaStyle { id: string; align?: string; lineSpacing?: number; margin: BoxSpacing; heading?: ViewerHeadingStyle }
export interface ViewerHeadingStyle { type: string; idRef: string; level: number; bullet?: string; numberPattern?: string; numberFormat?: string }
export interface ViewerBorder { type: string; widthMm: number; color: string }
export interface ViewerCellStyle { id: string; backgroundColor?: string; left: ViewerBorder; right: ViewerBorder; top: ViewerBorder; bottom: ViewerBorder }
export interface ViewerResource { id: string; path: string; mime: string; data: string }
export interface ViewerSection { id: string; blocks: ViewerParagraph[]; pageNumber?: ViewerPageNumber; headers: ViewerHeaderFooter[]; footers: ViewerHeaderFooter[] }
export interface ViewerParagraph { id: string; paraStyleId: string; pageBreak: boolean; layoutTop?: HwpUnit; layoutHeight: HwpUnit; marker?: string; content: ViewerContent[] }
export type ViewerContent = ViewerText | ViewerTable | ViewerImage
export interface ViewerText { type: 'text'; text: string; charStyleId: string }
export interface ViewerImage { type: 'image'; resourceId?: string; width?: HwpUnit; height?: HwpUnit }
export interface ViewerTable { type: 'table'; id: string; rowCount: number; columnCount: number; width?: HwpUnit; height?: HwpUnit; pageBreak?: string; repeatHeader: boolean; rows: ViewerTableRow[] }
export interface ViewerTableRow { cells: ViewerTableCell[]; fragmentHeight?: HwpUnit }
export interface ViewerTableCell {
  row: number
  column: number
  rowSpan: number
  columnSpan: number
  width: HwpUnit
  height: HwpUnit
  margin: BoxSpacing
  borderFillId?: string
  verticalAlign?: string
  header: boolean
  paragraphs: ViewerParagraph[]
  sourceCellId?: string
  splitTop?: boolean
  splitBottom?: boolean
}
