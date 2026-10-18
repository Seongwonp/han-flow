import type { ViewerCharStyle, ViewerDocument, ViewerSection } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch, type ViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { paginateViewerSectionsIncremental } from '../../src/core/layout/pagination'
import { countMeasuredSections, measureDocumentLayout } from '../../src/renderer/src/App'
import { MeasurementStylesTracker, resolveCharStyles, type ViewerRenderStyles } from '../../src/renderer/src/measurement_styles'

// renderer가 style definition을 바꾼 편집 patch 뒤 측정값·쪽 나눔을 다시 쓰는 규칙(App.tsx의 측정 effect와 같은 순서).

const charStyle = (id: string, bold = false): ViewerCharStyle =>
  ({ id, height: 1000, color: '#000000', bold, italic: false, underline: false, strikeout: false, fontFamily: 'HanFlow Test Sans' })

const paragraph = (id: string, charStyleId: string) => ({
  id, paraStyleId: '0', pageBreak: false, layoutHeight: 1000,
  content: [{ type: 'text' as const, text: id, charStyleId }]
})

const section = (id: string, charStyleId: string): ViewerSection =>
  ({ id, blocks: [paragraph(`${id}:p0`, charStyleId)], headers: [], footers: [] })

const baseDocument: ViewerDocument = {
  page: { width: 10000, height: 10000, margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 }, headerOffset: 0, footerOffset: 0 },
  fonts: { '0': 'HanFlow Test Sans' },
  charStyles: { '0': charStyle('0'), '1': charStyle('1') },
  paraStyles: { '0': { id: '0', margin: { top: 0, right: 0, bottom: 0, left: 0 } } },
  cellStyles: {},
  resources: {},
  diagnostics: [],
  sections: [section('s0', '0'), section('s1', '0'), section('s2', '1')]
}

/** 측정 DOM 대신: section마다 문단 높이 하나를 돌려주고, 잰 section을 센다. */
function fakeContainer(document: ViewerDocument, measured: string[]): Element {
  return {
    children: document.sections.map((item) => ({
      querySelectorAll: (selector: string) => {
        if (selector === '[data-measure-block-id]') measured.push(item.id)
        return selector === '[data-measure-block-id]'
          ? [{ dataset: { measureBlockId: item.blocks[0].id }, closest: () => null, getBoundingClientRect: () => ({ height: 20 }) }]
          : []
      }
    }))
  } as unknown as Element
}

function renderStylesOf(document: ViewerDocument, cache: WeakMap<ViewerCharStyle, ViewerCharStyle>, resolved = {}): ViewerRenderStyles {
  return {
    page: document.page,
    charStyles: resolveCharStyles(document.charStyles, resolved, cache),
    paraStyles: document.paraStyles,
    cellStyles: document.cellStyles,
    resources: document.resources
  }
}

const stylePatch = (overrides: Partial<ViewerDocumentPatch>): ViewerDocumentPatch => ({
  baseProjectionId: 1, projectionId: 2, sectionCount: 3, sections: [], diagnostics: [], ...overrides
})

describe('style 변경 편집 뒤 측정 재사용', () => {
  test('찾은 글꼴이 그대로인 글자 모양은 id별 object를 다시 쓴다', () => {
    const cache = new WeakMap<ViewerCharStyle, ViewerCharStyle>()
    const first = resolveCharStyles(baseDocument.charStyles, {}, cache)
    const merged = { ...baseDocument.charStyles, '2': charStyle('2', true) }
    const second = resolveCharStyles(merged, {}, cache)
    expect(second['0']).toBe(first['0'])
    expect(second['1']).toBe(first['1'])
    const substituted = resolveCharStyles(merged, {
      'HanFlow Test Sans': { requested: 'HanFlow Test Sans', resolved: 'Noto Sans CJK KR', substituted: true }
    }, cache)
    expect(substituted['0']).not.toBe(first['0'])
    expect(substituted['0'].fontFamily).toBe('Noto Sans CJK KR')
  })

  test('patch가 알린 style id만 바뀌면 표지가 그대로이고 그 id를 쓰는 section만 다시 잰다', () => {
    const cache = new WeakMap<ViewerCharStyle, ViewerCharStyle>()
    const tracker = new MeasurementStylesTracker()
    const firstKey = tracker.keyFor(renderStylesOf(baseDocument, cache))
    const firstMeasured: string[] = []
    const first = measureDocumentLayout(baseDocument, firstKey, fakeContainer(baseDocument, firstMeasured), undefined)
    expect(firstMeasured).toEqual(['s0', 's1', 's2'])
    const firstPages = paginateViewerSectionsIncremental(baseDocument, (index) => first.sections[index]?.measurements)

    // 글자 모양 1의 definition이 바뀌고(굵게) section0 글자에 새 글자 모양 2를 붙였다.
    const patch = stylePatch({
      sections: [{ index: 0, section: section('s0', '2') }],
      styleChanges: { charStyles: { '1': charStyle('1', true), '2': charStyle('2', true) }, paraStyles: {}, cellStyles: {} },
      restyledSections: [2]
    })
    const next = applyViewerDocumentPatch(baseDocument, patch)
    expect(next.sections[1]).toBe(baseDocument.sections[1])
    expect(next.sections[2]).not.toBe(baseDocument.sections[2])
    expect(next.charStyles['0']).toBe(baseDocument.charStyles['0'])
    tracker.notePatch(patch)
    const nextKey = tracker.keyFor(renderStylesOf(next, cache))
    expect(nextKey).toBe(firstKey)
    const measured: string[] = []
    const second = measureDocumentLayout(next, nextKey, fakeContainer(next, measured), first)
    expect(measured).toEqual(['s0', 's2'])
    expect(countMeasuredSections(second, first)).toBe(2)
    expect(second.sections[1]).toBe(first.sections[1])
    const pages = paginateViewerSectionsIncremental(next, (index) => second.sections[index]?.measurements, firstPages.sections)
    expect(pages.reused).toBe(1)
  })

  test('patch가 알리지 않은 style 변경·쪽 크기 변경·style map 전체 patch·전체 문서는 모든 section을 다시 잰다', () => {
    const cache = new WeakMap<ViewerCharStyle, ViewerCharStyle>()
    const tracker = new MeasurementStylesTracker()
    const styles = renderStylesOf(baseDocument, cache)
    const key = tracker.keyFor(styles)
    expect(tracker.keyFor(styles)).toBe(key)

    // 찾은 글꼴이 바뀌면 모든 글자 모양 object가 바뀐다.
    const substituted = renderStylesOf(baseDocument, cache, {
      'HanFlow Test Sans': { requested: 'HanFlow Test Sans', resolved: 'Noto Sans CJK KR', substituted: true }
    })
    const fontKey = tracker.keyFor(substituted)
    expect(fontKey).not.toBe(key)
    const first = measureDocumentLayout(baseDocument, key, fakeContainer(baseDocument, []), undefined)
    const measured: string[] = []
    measureDocumentLayout(baseDocument, fontKey, fakeContainer(baseDocument, measured), first)
    expect(measured).toEqual(['s0', 's1', 's2'])

    // patch가 알린 id라도 다른 id가 함께 바뀌면(알리지 않은 변경) 새 표지다.
    tracker.notePatch(stylePatch({ styleChanges: { charStyles: { '1': charStyle('1', true) }, paraStyles: {}, cellStyles: {} } }))
    const unannounced = { ...substituted, charStyles: { ...substituted.charStyles, '0': charStyle('0', true), '1': charStyle('1', true) } }
    expect(tracker.keyFor(unannounced)).not.toBe(fontKey)

    // 글꼴 목록이 바뀐 patch(style map 전체).
    const fullKey = tracker.keyFor(unannounced)
    tracker.notePatch(stylePatch({ styles: { fonts: {}, charStyles: { '0': charStyle('0') }, paraStyles: {}, cellStyles: {} } }))
    expect(tracker.keyFor({ ...unannounced, charStyles: { '0': charStyle('0') } })).not.toBe(fullKey)

    // 쪽 크기가 바뀐 문서.
    const pageKey = tracker.keyFor(unannounced)
    expect(tracker.keyFor({ ...unannounced, page: { ...unannounced.page, width: 12000 } })).not.toBe(pageKey)

    // 전체 문서로 바뀌면(reset) 같은 style이라도 새 표지다.
    const sameKey = tracker.keyFor(unannounced)
    tracker.reset()
    expect(tracker.keyFor(unannounced)).not.toBe(sameKey)
  })
})
