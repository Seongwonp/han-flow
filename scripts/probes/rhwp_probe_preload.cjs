const { ipcRenderer } = require('electron')
const { readFile } = require('node:fs/promises')
const { dirname, resolve } = require('node:path')
const { performance } = require('node:perf_hooks')

const RESULT_CHANNEL = 'han-flow:hwp-probe-result'
const fileArgument = process.argv.find((argument) => argument.startsWith('--han-flow-probe-file='))
const filePath = fileArgument?.slice('--han-flow-probe-file='.length)
const captureArgument = process.argv.find((argument) => argument.startsWith('--han-flow-probe-capture-pages='))
const capturePages = new Set(
  (captureArgument?.slice('--han-flow-probe-capture-pages='.length) ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
)

function svgDiagnostics(svg) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = document.documentElement
  const unsafeElements = document.querySelectorAll('script, foreignObject').length
  let unsafeAttributes = 0
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (name.startsWith('on')) unsafeAttributes += 1
      if ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#') && !value.startsWith('data:')) {
        unsafeAttributes += 1
      }
    }
  }
  return {
    svgBytes: Buffer.byteLength(svg),
    normalizedText: (root.textContent ?? '').normalize('NFC').replace(/\s/gu, ''),
    imageElements: document.querySelectorAll('image').length,
    unsafeElements,
    unsafeAttributes,
    viewBox: root.getAttribute('viewBox') ?? null
  }
}

function numericDiagnostics(value, depth = 0) {
  if (depth > 4) return undefined
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => numericDiagnostics(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, numericDiagnostics(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    )
  }
  return undefined
}

function jsonShapeDiagnostics(json) {
  const value = JSON.parse(json)
  const keys = new Map()
  const objectKeys = new Map()
  const numericFields = new Map()
  let objects = 0
  let arrays = 0
  const visit = (item, parentKey = '') => {
    if (typeof item === 'number' && Number.isFinite(item)) {
      const current = numericFields.get(parentKey) ?? { count: 0, min: item, max: item }
      current.count += 1
      current.min = Math.min(current.min, item)
      current.max = Math.max(current.max, item)
      numericFields.set(parentKey, current)
      return
    }
    if (typeof item === 'string') {
      const current = keys.get(parentKey) ?? { count: 0, characters: 0, nonWhitespaceCharacters: 0 }
      current.count += 1
      current.characters += Array.from(item.normalize('NFC')).length
      current.nonWhitespaceCharacters += Array.from(item.normalize('NFC').replace(/\s/gu, '')).length
      keys.set(parentKey, current)
      return
    }
    if (Array.isArray(item)) {
      arrays += 1
      item.forEach((child) => visit(child, parentKey))
      return
    }
    if (item && typeof item === 'object') {
      objects += 1
      Object.entries(item).forEach(([key, child]) => {
        objectKeys.set(key, (objectKeys.get(key) ?? 0) + 1)
        visit(child, key)
      })
    }
  }
  visit(value)
  return {
    rootType: Array.isArray(value) ? 'array' : typeof value,
    rootLength: Array.isArray(value) ? value.length : undefined,
    rootKeys: value && !Array.isArray(value) && typeof value === 'object' ? Object.keys(value).sort() : undefined,
    objects,
    arrays,
    objectKeys: Object.fromEntries([...objectKeys.entries()].sort(([left], [right]) => left.localeCompare(right))),
    numericFields: Object.fromEntries([...numericFields.entries()].sort(([left], [right]) => left.localeCompare(right))),
    stringFields: Object.fromEntries([...keys.entries()].map(([key, statistics]) => [
      key,
      {
        ...statistics,
        nonWhitespaceCharacters: statistics.nonWhitespaceCharacters ?? 0
      }
    ]).sort(([left], [right]) => left.localeCompare(right)))
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const started = performance.now()
  try {
    if (!filePath) throw new Error('probe 파일 인자가 없습니다.')

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context를 만들 수 없습니다.')
    globalThis.measureTextWidth = (font, text) => {
      context.font = font
      return context.measureText(text).width
    }

    const modulePath = require.resolve('@rhwp/core')
    const rhwp = await import(modulePath)
    const wasm = await readFile(resolve(dirname(modulePath), 'rhwp_bg.wasm'))
    const initStarted = performance.now()
    await rhwp.default(wasm)
    const initMs = performance.now() - initStarted

    const bytes = await readFile(filePath)
    const parseStarted = performance.now()
    const documentModel = new rhwp.HwpDocument(new Uint8Array(bytes))
    const parseMs = performance.now() - parseStarted
    const pageCount = documentModel.pageCount()
    const sectionCount = documentModel.getSectionCount()
    const pageLimit = Math.min(pageCount, 500)
    const pageDiagnostics = []
    const pageInfos = []
    const pageTextLayouts = []
    const privateSvgPages = []
    const renderStarted = performance.now()
    for (let page = 0; page < pageLimit; page += 1) {
      const svg = documentModel.renderPageSvg(page)
      pageDiagnostics.push(svgDiagnostics(svg))
      try {
        pageInfos.push(numericDiagnostics(JSON.parse(documentModel.getPageInfo(page))))
      } catch {
        pageInfos.push(null)
      }
      try {
        pageTextLayouts.push(jsonShapeDiagnostics(documentModel.getPageTextLayout(page)))
      } catch {
        pageTextLayouts.push(null)
      }
      if (capturePages.has(page + 1)) privateSvgPages.push({ page: page + 1, svg })
    }
    const renderMs = performance.now() - renderStarted
    documentModel.free()

    ipcRenderer.send(RESULT_CHANNEL, {
      schemaVersion: 1,
      engine: 'rhwp',
      engineVersion: '0.7.19',
      timings: { initMs, parseMs, renderMs, totalMs: performance.now() - started },
      result: {
        success: true,
        pageCount,
        sectionCount,
        renderedPages: pageLimit,
        truncated: pageLimit < pageCount,
        pageTextCounts: pageDiagnostics.map((page) => Array.from(page.normalizedText).length),
        imageElements: pageDiagnostics.reduce((sum, page) => sum + page.imageElements, 0),
        totalSvgBytes: pageDiagnostics.reduce((sum, page) => sum + page.svgBytes, 0),
        unsafeElements: pageDiagnostics.reduce((sum, page) => sum + page.unsafeElements, 0),
        unsafeAttributes: pageDiagnostics.reduce((sum, page) => sum + page.unsafeAttributes, 0),
        pageViewBoxes: [...new Set(pageDiagnostics.map((page) => page.viewBox).filter(Boolean))],
        pageInfos,
        pageTextLayouts
      },
      privatePageTexts: pageDiagnostics.map((page) => page.normalizedText),
      privateSvgPages
    })
  } catch {
    ipcRenderer.send(RESULT_CHANNEL, {
      schemaVersion: 1,
      engine: 'rhwp',
      engineVersion: '0.7.19',
      timings: { totalMs: performance.now() - started },
      result: {
        success: false,
        error: { code: 'PROBE_FAILED', message: 'rhwp 후보 probe 실행에 실패했습니다.' }
      }
    })
  }
})
