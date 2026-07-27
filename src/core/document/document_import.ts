import {
  ViewerDocument,
  ViewerParseTimings
} from './viewer_document'

export type DocumentFormat = 'hwp' | 'hwpx'

export interface DocumentImportRequest {
  filePath: string
  loadId: string
}

export interface DocumentImportError {
  code: string
  message: string
}

export interface HwpDocumentImportSuccess {
  ok: true
  format: 'hwp'
  loadId: string
  bytes: Uint8Array
  timings: {
    sourceReadMs: number
  }
}

export interface HwpxDocumentImportSuccess {
  ok: true
  format: 'hwpx'
  loadId: string
  document: ViewerDocument
  timings: ViewerParseTimings
  sectionCount: number
  complete: boolean
}

export interface DocumentImportFailure {
  ok: false
  format?: DocumentFormat
  loadId: string
  error: DocumentImportError
}

export type DocumentImportResult =
  | HwpDocumentImportSuccess
  | HwpxDocumentImportSuccess
  | DocumentImportFailure

export interface DocumentImportComplete {
  format: 'hwpx'
  loadId: string
  document: ViewerDocument
  decodeMs: number
}

export interface DocumentImportBackgroundError {
  format: 'hwpx'
  loadId: string
  error: DocumentImportError
}
