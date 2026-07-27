export interface FixedPageDescriptor {
  index: number
  sectionIndex: number
  width: number
  height: number
}

export interface FixedPageDocument {
  kind: 'fixed-page'
  format: 'hwp'
  pageCount: number
  sectionCount: number
  pages: FixedPageDescriptor[]
}

export interface FixedPageTextRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontFamily?: string
  fontSize: number
  ratio: number
}

export interface FixedPageTextLayout {
  runs: FixedPageTextRun[]
  text: string
  nonWhitespaceCharacters: number
}

export interface FixedPageOpenTimings {
  wasmInitMs: number
  parseMs: number
  pageInfoMs: number
}

export interface FixedPageOpenResult {
  document: FixedPageDocument
  timings: FixedPageOpenTimings
}
