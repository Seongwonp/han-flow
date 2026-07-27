/// <reference lib="webworker" />

import initRhwp, { HwpDocument } from '@rhwp/core'
import {
  HwpWorkerOpenPayload,
  HwpWorkerOpenResult,
  HwpWorkerPagePayload,
  HwpWorkerRequest,
  HwpWorkerResponse
} from './hwp_worker_protocol'

const MAX_PAGE_COUNT = 10_000
let initialized = false
let activeDocument: HwpDocument | null = null

function installTextMeasurement(): void {
  const canvas = new OffscreenCanvas(1, 1)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('HWP 글꼴 측정기를 초기화할 수 없습니다.')
  ;(globalThis as typeof globalThis & {
    measureTextWidth?: (font: string, text: string) => number
  }).measureTextWidth = (font, text) => {
    context.font = font
    return context.measureText(text).width
  }
}

function parsePageInfo(document: HwpDocument, index: number) {
  const info = JSON.parse(document.getPageInfo(index)) as {
    width?: number
    height?: number
    sectionIndex?: number
  }
  const width = Number(info.width)
  const height = Number(info.height)
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value < 100_000)) {
    throw new Error(`${index + 1}페이지의 용지 크기가 올바르지 않습니다.`)
  }
  return {
    index,
    sectionIndex: Number.isInteger(info.sectionIndex) && Number(info.sectionIndex) >= 0
      ? Number(info.sectionIndex)
      : 0,
    width,
    height
  }
}

async function openDocument(payload: HwpWorkerOpenPayload): Promise<HwpWorkerOpenResult> {
  activeDocument?.free()
  activeDocument = null
  installTextMeasurement()
  const wasmStartedAt = performance.now()
  if (!initialized) {
    await initRhwp(new Uint8Array(payload.wasm))
    initialized = true
  }
  const wasmInitMs = performance.now() - wasmStartedAt
  const parseStartedAt = performance.now()
  const document = new HwpDocument(new Uint8Array(payload.bytes))
  const parseMs = performance.now() - parseStartedAt
  const pageCount = document.pageCount()
  const sectionCount = document.getSectionCount()
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
    document.free()
    throw new Error(`지원할 수 없는 HWP 페이지 수입니다: ${pageCount}`)
  }
  const pageInfoStartedAt = performance.now()
  try {
    const pages = Array.from({ length: pageCount }, (_, index) => parsePageInfo(document, index))
    activeDocument = document
    return {
      pageCount,
      sectionCount,
      pages,
      timings: {
        wasmInitMs,
        parseMs,
        pageInfoMs: performance.now() - pageInfoStartedAt
      }
    }
  } catch (error) {
    document.free()
    throw error
  }
}

function pageIndex(payload: HwpWorkerPagePayload): number {
  const index = Number(payload.index)
  if (!activeDocument) throw new Error('열린 HWP 문서가 없습니다.')
  if (!Number.isInteger(index) || index < 0 || index >= activeDocument.pageCount()) {
    throw new Error('HWP 페이지 번호가 올바르지 않습니다.')
  }
  return index
}

async function handle(request: HwpWorkerRequest): Promise<unknown> {
  switch (request.operation) {
    case 'open':
      return openDocument(request.payload as HwpWorkerOpenPayload)
    case 'render-page':
      return activeDocument!.renderPageSvg(pageIndex(request.payload as HwpWorkerPagePayload))
    case 'text-layout':
      return activeDocument!.getPageTextLayout(pageIndex(request.payload as HwpWorkerPagePayload))
  }
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<HwpWorkerRequest>) => void) | null
  postMessage: (message: HwpWorkerResponse) => void
}

scope.onmessage = (event) => {
  const request = event.data
  void handle(request).then(
    (result) => scope.postMessage({ id: request.id, ok: true, result }),
    (reason) => scope.postMessage({
      id: request.id,
      ok: false,
      error: {
        code: request.operation === 'open' ? 'HWP_PARSE_FAILED' : 'HWP_OPERATION_FAILED',
        message: reason instanceof Error ? reason.message : String(reason)
      }
    })
  )
}
