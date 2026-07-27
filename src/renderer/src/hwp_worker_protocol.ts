import {
  FixedPageDescriptor,
  FixedPageOpenTimings
} from '../../core/document/fixed_page_document'

export type HwpWorkerOperation = 'open' | 'render-page' | 'text-layout'

export interface HwpWorkerRequest {
  id: number
  operation: HwpWorkerOperation
  payload: unknown
}

export interface HwpWorkerSuccess {
  id: number
  ok: true
  result: unknown
}

export interface HwpWorkerFailure {
  id: number
  ok: false
  error: {
    code: string
    message: string
  }
}

export type HwpWorkerResponse = HwpWorkerSuccess | HwpWorkerFailure

export interface HwpWorkerOpenPayload {
  bytes: ArrayBuffer
  wasm: ArrayBuffer
}

export interface HwpWorkerOpenResult {
  pageCount: number
  sectionCount: number
  pages: FixedPageDescriptor[]
  timings: FixedPageOpenTimings
}

export interface HwpWorkerPagePayload {
  index: number
}
