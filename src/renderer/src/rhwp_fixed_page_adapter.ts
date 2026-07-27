import initRhwp, { HwpDocument } from '@rhwp/core'
import rhwpWasmUrl from '@rhwp/core/rhwp_bg.wasm?url'
import {
  FixedPageDescriptor,
  FixedPageOpenResult,
  FixedPageTextLayout,
  FixedPageTextRun
} from '../../core/document/fixed_page_document'

const MAX_PAGE_COUNT = 10_000
const PAGE_CACHE_LIMIT = 20
const TEXT_LAYOUT_CACHE_LIMIT = 20
const MAX_TEXT_RUNS_PER_PAGE = 100_000
const MAX_TEXT_CHARACTERS_PER_PAGE = 5_000_000
const MAX_TEXT_COORDINATE = 1_000_000
const MAX_FONT_SIZE = 10_000

let initialized: Promise<number> | null = null
let activeDocument: HwpDocument | null = null
let generation = 0
let openGeneration = 0
const pageCache = new Map<number, RenderedRhwpFixedPage>()
const textLayoutCache = new Map<number, FixedPageTextLayout>()
const pageJobs = new Map<number, Promise<RenderedRhwpFixedPage>>()
let renderQueue: Promise<void> = Promise.resolve()

interface RhwpPageInfo {
  width?: number
  height?: number
  sectionIndex?: number
}

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

function ensureTextMeasurement(): void {
  const canvas = globalThis.document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('HWP 글꼴 측정기를 초기화할 수 없습니다.')
  ;(globalThis as typeof globalThis & { measureTextWidth?: (font: string, text: string) => number })
    .measureTextWidth = (font, text) => {
      context.font = font
      return context.measureText(text).width
    }
}

async function initializeRhwp(loadLocalAsset: (url: string) => Promise<Uint8Array>): Promise<number> {
  if (!initialized) {
    initialized = (async () => {
      const startedAt = performance.now()
      const wasm = await loadLocalAsset(rhwpWasmUrl)
      await initRhwp(wasm)
      return performance.now() - startedAt
    })()
  }
  return initialized
}

function parsePageInfo(document: HwpDocument, index: number): FixedPageDescriptor {
  const info = JSON.parse(document.getPageInfo(index)) as RhwpPageInfo
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

export async function openRhwpFixedPageDocument(
  bytes: Uint8Array,
  loadLocalAsset: (url: string) => Promise<Uint8Array>
): Promise<FixedPageOpenResult> {
  const requestGeneration = ++openGeneration
  disposeActiveDocument()
  ensureTextMeasurement()
  const wasmInitMs = await initializeRhwp(loadLocalAsset)
  if (requestGeneration !== openGeneration) {
    throw new Error('더 최신 HWP 열기 요청이 있어 이전 요청을 취소했습니다.')
  }
  const parseStartedAt = performance.now()
  const document = new HwpDocument(bytes)
  const parseMs = performance.now() - parseStartedAt
  const pageCount = document.pageCount()
  const sectionCount = document.getSectionCount()
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
    document.free()
    throw new Error(`지원할 수 없는 HWP 페이지 수입니다: ${pageCount}`)
  }
  const pageInfoStartedAt = performance.now()
  let pages: FixedPageDescriptor[]
  try {
    pages = Array.from({ length: pageCount }, (_, index) => parsePageInfo(document, index))
  } catch (error) {
    document.free()
    throw error
  }
  const pageInfoMs = performance.now() - pageInfoStartedAt
  activeDocument = document
  generation += 1
  pageCache.clear()
  return {
    document: {
      kind: 'fixed-page',
      format: 'hwp',
      pageCount,
      sectionCount,
      pages
    },
    timings: { wasmInitMs, parseMs, pageInfoMs }
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

function pageTextLayout(document: HwpDocument, index: number, cache = true): FixedPageTextLayout {
  const cached = textLayoutCache.get(index)
  if (cached) {
    rememberTextLayout(index, cached)
    return cached
  }
  const value = JSON.parse(document.getPageTextLayout(index)) as RhwpTextLayout
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
  const document = activeDocument
  const activeGeneration = generation
  if (!document) return Promise.reject(new Error('열린 HWP 문서가 없습니다.'))
  const cached = pageCache.get(index)
  if (cached) {
    rememberPage(index, cached)
    return Promise.resolve(cached)
  }
  const pending = pageJobs.get(index)
  if (pending) return pending
  const job = renderQueue.then(() => {
    if (activeDocument !== document || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 페이지 렌더링을 취소했습니다.')
    }
    const page = {
      svg: safeSvg(document.renderPageSvg(index))
    }
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
  const document = activeDocument
  const activeGeneration = generation
  if (!document) return Promise.reject(new Error('열린 HWP 문서가 없습니다.'))
  return Promise.resolve().then(() => {
    if (activeDocument !== document || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 텍스트 계층 생성을 취소했습니다.')
    }
    return pageTextLayout(document, index)
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
  const document = activeDocument
  const activeGeneration = generation
  const needle = query.normalize('NFC').trim().toLocaleLowerCase('ko-KR')
  if (!document || !needle) return []
  const results: FixedPageSearchResult[] = []
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (activeDocument !== document || generation !== activeGeneration) {
      throw new Error('HWP 문서가 교체되어 검색을 취소했습니다.')
    }
    let occurrences = 0
    const layout = pageTextLayout(document, pageIndex, false)
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
  activeDocument?.free()
  activeDocument = null
}
