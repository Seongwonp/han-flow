import rhwpWasmUrl from '@rhwp/core/rhwp_bg.wasm?url'
import {
  FixedPageDescriptor,
  FixedPageOpenResult,
  FixedPageTextLayout,
  FixedPageTextRun
} from '../../core/document/fixed_page_document'
import { HwpWorkerClient, HwpWorkerError } from './hwp_worker_client'
import {
  HwpWorkerOpenResult,
  HwpWorkerOperation
} from './hwp_worker_protocol'

const PAGE_CACHE_LIMIT = 20
const TEXT_LAYOUT_CACHE_LIMIT = 20
const MAX_TEXT_RUNS_PER_PAGE = 100_000
const MAX_TEXT_CHARACTERS_PER_PAGE = 5_000_000
const MAX_TEXT_COORDINATE = 1_000_000
const MAX_FONT_SIZE = 10_000
const MAX_SVG_CHARACTERS = 50_000_000
const MAX_TEXT_LAYOUT_CHARACTERS = 50_000_000
export const HWP_OPEN_TIMEOUT_MS = 30_000
export const HWP_PAGE_TIMEOUT_MS = 15_000

const workerClient = new HwpWorkerClient(() => new Worker(
  new URL('./rhwp_worker.ts', import.meta.url),
  { type: 'module', name: 'han-flow-hwp-parser' }
))
let hasActiveDocument = false
let generation = 0
let openGeneration = 0
const pageCache = new Map<number, RenderedRhwpFixedPage>()
const textLayoutCache = new Map<number, FixedPageTextLayout>()
const pageJobs = new Map<number, Promise<RenderedRhwpFixedPage>>()
let renderQueue: Promise<void> = Promise.resolve()

interface RhwpTextLayout {
  runs?: unknown[]
}

export interface RenderedRhwpFixedPage {
  svg: string
}

export interface FixedPageSearchResult {
  pageIndex: number
  occurrences: number
}

async function requestWorker<T>(
  operation: HwpWorkerOperation,
  payload: unknown,
  timeoutMs: number,
  transfer: Transferable[] = []
): Promise<T> {
  try {
    return await workerClient.request<T>(operation, payload, timeoutMs, transfer)
  } catch (error) {
    if (
      error instanceof HwpWorkerError &&
      ['HWP_TIMEOUT', 'HWP_WORKER_CRASHED', 'HWP_WORKER_FAILED'].includes(error.code)
    ) {
      disposeActiveDocument()
    }
    throw error
  }
}

function validPageInfo(page: FixedPageDescriptor, index: number): FixedPageDescriptor {
  const width = Number(page?.width)
  const height = Number(page?.height)
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value < 100_000)) {
    throw new Error(`${index + 1}페이지의 용지 크기가 올바르지 않습니다.`)
  }
  return {
    index,
    sectionIndex: Number.isInteger(page.sectionIndex) && Number(page.sectionIndex) >= 0
      ? Number(page.sectionIndex)
      : 0,
    width,
    height
  }
}

export async function openRhwpFixedPageDocument(
  bytes: Uint8Array,
  loadLocalAsset: (url: string) => Promise<Uint8Array>
): Promise<FixedPageOpenResult> {
  const requestGeneration = ++openGeneration
  disposeActiveDocument()
  const wasm = await loadLocalAsset(rhwpWasmUrl)
  if (requestGeneration !== openGeneration) {
    throw new Error('더 최신 HWP 열기 요청이 있어 이전 요청을 취소했습니다.')
  }
  const documentBytes = bytes.slice().buffer as ArrayBuffer
  const wasmBytes = wasm.slice().buffer as ArrayBuffer
  workerClient.start()
  let result: HwpWorkerOpenResult
  try {
    result = await requestWorker<HwpWorkerOpenResult>(
      'open',
      { bytes: documentBytes, wasm: wasmBytes },
      HWP_OPEN_TIMEOUT_MS,
      [documentBytes, wasmBytes]
    )
  } catch (error) {
    if (requestGeneration === openGeneration) disposeActiveDocument()
    throw error
  }
  if (requestGeneration !== openGeneration) {
    disposeActiveDocument()
    throw new Error('더 최신 HWP 열기 요청이 있어 이전 요청을 취소했습니다.')
  }
  if (
    !Number.isInteger(result.pageCount) ||
    result.pageCount < 1 ||
    result.pageCount > 10_000 ||
    !Array.isArray(result.pages) ||
    result.pages.length !== result.pageCount
  ) {
    disposeActiveDocument()
    throw new Error('HWP Worker의 페이지 정보가 올바르지 않습니다.')
  }
  const pages = result.pages.map(validPageInfo)
  hasActiveDocument = true
  generation += 1
  pageCache.clear()
  return {
    document: {
      kind: 'fixed-page',
      format: 'hwp',
      pageCount: result.pageCount,
      sectionCount: Number.isInteger(result.sectionCount) && result.sectionCount >= 0
        ? result.sectionCount
        : 0,
      pages
    },
    timings: result.timings
  }
}

function safeSvg(svg: string): string {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = parsed.documentElement
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error('HWP 페이지 SVG 형식이 올바르지 않습니다.')
  }
  if (parsed.querySelector('script, foreignObject, iframe, object, embed, audio, video')) {
    throw new Error('HWP 페이지 SVG에서 허용되지 않는 요소를 발견했습니다.')
  }
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on')) {
        throw new Error('HWP 페이지 SVG에서 이벤트 속성을 발견했습니다.')
      }
      if (
        (name === 'href' || name.endsWith(':href')) &&
        !value.startsWith('#') &&
        !value.startsWith('data:image/')
      ) {
        throw new Error('HWP 페이지 SVG에서 외부 리소스를 발견했습니다.')
      }
      if (name === 'style' && /(?:@import|url\s*\(\s*['"]?(?!#|data:image\/))/iu.test(value)) {
        throw new Error('HWP 페이지 SVG 스타일에서 외부 리소스를 발견했습니다.')
      }
    }
  }
  for (const style of parsed.querySelectorAll('style')) {
    if (/(?:@import|url\s*\(\s*['"]?(?!#|data:image\/))/iu.test(style.textContent ?? '')) {
      throw new Error('HWP 페이지 SVG 스타일에서 외부 리소스를 발견했습니다.')
    }
  }
  return new XMLSerializer().serializeToString(root)
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function parseTextRun(value: unknown): FixedPageTextRun | null {
  if (!value || typeof value !== 'object') return null
  const run = value as Record<string, unknown>
  if (typeof run.text !== 'string' || run.text.length > 1_000_000) return null
  const x = finite(run.x, Number.NaN)
  const y = finite(run.y, Number.NaN)
  const width = finite(run.w, Number.NaN)
  const height = finite(run.h, Number.NaN)
  const fontSize = finite(run.fontSize, 12)
  if (![x, y, width, height, fontSize].every(Number.isFinite)) return null
  if (
    [x, y, width, height].some((number) => Math.abs(number) > MAX_TEXT_COORDINATE) ||
    fontSize < 0 ||
    fontSize > MAX_FONT_SIZE
  ) return null
  return {
    text: run.text,
    x,
    y,
    width: Math.max(width, 0),
    height: Math.max(height, 0),
    fontFamily: typeof run.fontFamily === 'string' && run.fontFamily.length <= 200
      ? run.fontFamily
      : undefined,
    fontSize: Math.max(fontSize, 1),
    ratio: Math.min(Math.max(finite(run.ratio, 1), 0.1), 10)
  }
}

function rememberTextLayout(index: number, layout: FixedPageTextLayout): void {
  textLayoutCache.delete(index)
  textLayoutCache.set(index, layout)
  while (textLayoutCache.size > TEXT_LAYOUT_CACHE_LIMIT) {
    const oldest = textLayoutCache.keys().next().value
    if (oldest === undefined) break
    textLayoutCache.delete(oldest)
  }
}

async function pageTextLayout(index: number, cache = true): Promise<FixedPageTextLayout> {
  const cached = textLayoutCache.get(index)
  if (cached) {
    rememberTextLayout(index, cached)
    return cached
  }
  const serialized = await requestWorker<string>(
    'text-layout',
    { index },
    HWP_PAGE_TIMEOUT_MS
  )
  if (typeof serialized !== 'string' || serialized.length > MAX_TEXT_LAYOUT_CHARACTERS) {
    throw new Error(`${index + 1}페이지의 텍스트 레이아웃 크기가 허용 범위를 넘었습니다.`)
  }
  const value = JSON.parse(serialized) as RhwpTextLayout
  if (!Array.isArray(value.runs) || value.runs.length > MAX_TEXT_RUNS_PER_PAGE) {
    throw new Error(`${index + 1}페이지의 텍스트 레이아웃이 올바르지 않습니다.`)
  }
  const runs: FixedPageTextRun[] = []
  let characterCount = 0
  for (const rawRun of value.runs) {
    const run = parseTextRun(rawRun)
    if (!run) continue
    characterCount += run.text.length
    if (characterCount > MAX_TEXT_CHARACTERS_PER_PAGE) {
      throw new Error(`${index + 1}페이지의 텍스트가 허용 범위를 넘었습니다.`)
    }
    runs.push(run)
  }
  const text = runs.map((run) => run.text).join('')
  const layout = {
    runs,
    text,
    nonWhitespaceCharacters: Array.from(text.normalize('NFC').replace(/\s/gu, '')).length
  }
  if (cache) rememberTextLayout(index, layout)
  return layout
}

function rememberPage(index: number, page: RenderedRhwpFixedPage): void {
  pageCache.delete(index)
  pageCache.set(index, page)
  while (pageCache.size > PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value
    if (oldest === undefined) break
    pageCache.delete(oldest)
  }
}

export function renderRhwpFixedPage(index: number): Promise<RenderedRhwpFixedPage> {
  const activeGeneration = generation
  if (!hasActiveDocument) return Promise.reject(new Error('열린 HWP 문서가 없습니다.'))
  const cached = pageCache.get(index)
  if (cached) {
    rememberPage(index, cached)
    return Promise.resolve(cached)
  }
  const pending = pageJobs.get(index)
  if (pending) return pending
  const job = renderQueue.then(async () => {
    if (!hasActiveDocument || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 페이지 렌더링을 취소했습니다.')
    }
    const page = {
      svg: ''
    }
    const svg = await requestWorker<string>('render-page', { index }, HWP_PAGE_TIMEOUT_MS)
    if (typeof svg !== 'string' || svg.length > MAX_SVG_CHARACTERS) {
      throw new Error(`${index + 1}페이지의 SVG 크기가 허용 범위를 넘었습니다.`)
    }
    page.svg = safeSvg(svg)
    rememberPage(index, page)
    return page
  })
  pageJobs.set(index, job)
  void job.then(
    () => pageJobs.delete(index),
    () => pageJobs.delete(index)
  )
  renderQueue = job.then(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    () => undefined
  )
  return job
}

export function getRhwpFixedPageTextLayout(index: number): Promise<FixedPageTextLayout> {
  const activeGeneration = generation
  if (!hasActiveDocument) return Promise.reject(new Error('열린 HWP 문서가 없습니다.'))
  return Promise.resolve().then(async () => {
    if (!hasActiveDocument || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 텍스트 계층 생성을 취소했습니다.')
    }
    return pageTextLayout(index)
  })
}

export async function renderAllRhwpFixedPages(pageCount: number): Promise<RenderedRhwpFixedPage[]> {
  const pages: RenderedRhwpFixedPage[] = []
  for (let index = 0; index < pageCount; index += 1) {
    pages.push(await renderRhwpFixedPage(index))
  }
  return pages
}

export async function searchRhwpFixedPages(query: string, pageCount: number): Promise<FixedPageSearchResult[]> {
  const activeGeneration = generation
  const needle = query.normalize('NFC').trim().toLocaleLowerCase('ko-KR')
  if (!hasActiveDocument || !needle) return []
  const results: FixedPageSearchResult[] = []
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (!hasActiveDocument || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 검색을 취소했습니다.')
    }
    let occurrences = 0
    const layout = await pageTextLayout(pageIndex, false)
    for (const run of layout.runs) {
      const text = run.text.normalize('NFC').toLocaleLowerCase('ko-KR')
      let offset = 0
      while ((offset = text.indexOf(needle, offset)) >= 0) {
        occurrences += 1
        offset += needle.length
      }
    }
    if (occurrences) results.push({ pageIndex, occurrences })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return results
}

export function closeRhwpFixedPageDocument(): void {
  openGeneration += 1
  disposeActiveDocument()
}

function disposeActiveDocument(): void {
  generation += 1
  pageCache.clear()
  textLayoutCache.clear()
  pageJobs.clear()
  hasActiveDocument = false
  workerClient.stop()
}
