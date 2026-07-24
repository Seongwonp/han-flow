const { ipcRenderer } = require('electron')
const { readFile } = require('node:fs/promises')
const { dirname, resolve } = require('node:path')
const { performance } = require('node:perf_hooks')

const RESULT_CHANNEL = 'han-flow:hwp-probe-result'
const fileArgument = process.argv.find((argument) => argument.startsWith('--han-flow-probe-file='))
const filePath = fileArgument?.slice('--han-flow-probe-file='.length)

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
    textCharacters: (root.textContent ?? '').replace(/\s/gu, '').length,
    imageElements: document.querySelectorAll('image').length,
    unsafeElements,
    unsafeAttributes,
    viewBox: root.getAttribute('viewBox') ?? null
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
    const pageLimit = Math.min(pageCount, 500)
    const pageDiagnostics = []
    const renderStarted = performance.now()
    for (let page = 0; page < pageLimit; page += 1) {
      pageDiagnostics.push(svgDiagnostics(documentModel.renderPageSvg(page)))
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
        renderedPages: pageLimit,
        truncated: pageLimit < pageCount,
        pageTextCounts: pageDiagnostics.map((page) => page.textCharacters),
        imageElements: pageDiagnostics.reduce((sum, page) => sum + page.imageElements, 0),
        totalSvgBytes: pageDiagnostics.reduce((sum, page) => sum + page.svgBytes, 0),
        unsafeElements: pageDiagnostics.reduce((sum, page) => sum + page.unsafeElements, 0),
        unsafeAttributes: pageDiagnostics.reduce((sum, page) => sum + page.unsafeAttributes, 0),
        pageViewBoxes: [...new Set(pageDiagnostics.map((page) => page.viewBox).filter(Boolean))]
      }
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
