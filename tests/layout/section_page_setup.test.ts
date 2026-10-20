import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { viewerPageFrameAt, viewerSectionPage } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { fixedPageVirtualRange } from '../../src/core/layout/fixed_page_virtualization'
import { pageNumberAnchor } from '../../src/core/layout/page_number'
import { paginateViewerDocument, paginateViewerSectionsIncremental } from '../../src/core/layout/pagination'
import type { OrderedXmlNode } from '../../src/core/parser/ordered_xml'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument, sectionPageGeometries, viewerPageGeometry } from '../../src/core/parser/viewer_decoder'
import { ViewerProjectionCache } from '../../src/core/parser/viewer_projection'
import { hwpxPagePrintCss } from '../../src/renderer/src/App'
import { renderStylesForPage, type ViewerRenderStyles } from '../../src/renderer/src/measurement_styles'
import { createSectionPageHwpx, createSyntheticHwpx, SECTION_PAGE_EXPECTED, SECTION_PAGE_SETUPS } from '../fixtures/public/create_synthetic_hwpx'

const pagePr = (attributes: Record<string, string>, margin: Record<string, string>): OrderedXmlNode => ({
  name: 'hp:pagePr',
  attributes,
  children: [{ name: 'hp:margin', attributes: margin, children: [] }]
})
const MARGIN = { left: '1000', right: '2000', top: '1000', bottom: '1000', header: '500', footer: '500', gutter: '300' }

describe('구역마다 다른 쪽 크기·방향·여백', () => {
  let directory: string
  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'han-flow-section-page-')) })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('가로 방향(NARROWLY)은 용지를 돌리고, 제본 여백은 종류마다 왼쪽·위쪽·맞쪽에 더한다', () => {
    const landscape = viewerPageGeometry(pagePr({ landscape: 'NARROWLY', width: '59528', height: '84188', gutterType: 'LEFT_ONLY' }, MARGIN)).page
    expect([landscape.width, landscape.height, landscape.landscape]).toEqual([84188, 59528, true])
    expect(landscape.margin).toEqual({ left: 1300, right: 2000, top: 1500, bottom: 1500 })
    // 이미 돌린 크기를 쓴 가로 방향도 긴 쪽이 너비다.
    expect(viewerPageGeometry(pagePr({ landscape: 'NARROWLY', width: '84188', height: '59528' }, MARGIN)).page.width).toBe(84188)
    const portrait = viewerPageGeometry(pagePr({ landscape: 'WIDELY', width: '59528', height: '84188' }, MARGIN)).page
    expect([portrait.width, portrait.height, portrait.landscape]).toEqual([59528, 84188, undefined])

    const topBottom = viewerPageGeometry(pagePr({ width: '10000', height: '20000', gutterType: 'TOP_BOTTOM' }, MARGIN)).page
    expect(topBottom.margin).toEqual({ left: 1000, right: 2000, top: 1800, bottom: 1500 })

    const mirror = viewerPageGeometry(pagePr({ width: '10000', height: '20000', gutterType: 'LEFT_RIGHT' }, MARGIN)).page
    expect(mirror.mirrorMargins).toBe(true)
    expect(viewerPageFrameAt(mirror, 1)).toBe(mirror)
    const even = viewerPageFrameAt(mirror, 2)
    expect(even.margin).toEqual({ left: 2000, right: 1300, top: 1500, bottom: 1500 })
    expect(viewerPageFrameAt(mirror, 4)).toBe(even)
    // 본문 폭은 홀수·짝수 쪽이 같다.
    expect(even.width - even.margin.left - even.margin.right).toBe(mirror.width - mirror.margin.left - mirror.margin.right)
  })

  test('hp:pagePr가 없는 구역은 앞 구역 쪽 설정을 잇고, 앞에 없으면 문서 첫 쪽 설정이다', () => {
    const first = pagePr({ width: '10000', height: '10000' }, MARGIN)
    const second = pagePr({ width: '20000', height: '10000' }, MARGIN)
    const geometries = sectionPageGeometries([undefined, first, undefined, second, undefined])
    expect(geometries.map((geometry) => geometry.page.width)).toEqual([10000, 10000, 10000, 20000, 20000])
    expect(geometries[0]).toBe(geometries[2])
    expect(geometries[3]).toBe(geometries[4])
  })

  test('합성 문서: 구역마다 쪽 설정으로 쪽을 나누고 쪽 번호 자리를 정한다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createSectionPageHwpx(directory)))
    expect(document.page).toBe(document.sections[0].page)
    const setups = document.sections.map((_section, index) => viewerSectionPage(document, index))
    expect(setups.map(({ width, height }) => [width, height])).toEqual([[59528, 84188], [84188, 59528], [51591, 72850]])
    expect(setups[2].margin.left).toBe(SECTION_PAGE_SETUPS[2].left + SECTION_PAGE_SETUPS[2].gutter)
    const pages = paginateViewerDocument(document)
    expect(pages.map((page) => page.sectionIndex)).toEqual(SECTION_PAGE_EXPECTED.pages.map((page) => page.sectionIndex))
    for (const expected of SECTION_PAGE_EXPECTED.pages) {
      const frame = viewerPageFrameAt(viewerSectionPage(document, expected.sectionIndex), expected.page)
      expect([frame.width, frame.height]).toEqual([expected.width, expected.height])
      expect(frame.margin).toEqual(expected.padding)
      const anchor = pageNumberAnchor(frame, { vertical: 'bottom', horizontal: 'center' })
      expect(anchor.y).toBe(expected.pageNumberBottom)
    }
    // 증분 pagination도 구역 쪽 설정을 쓰고, 쪽 설정이 그대로인 구역은 다시 나누지 않는다.
    const first = paginateViewerSectionsIncremental(document, () => undefined)
    expect(first.pages.map((page) => page.sectionIndex)).toEqual(pages.map((page) => page.sectionIndex))
    const resized = { ...document, sections: document.sections.map((section, index) => index === 1 ? { ...section, page: { ...section.page!, height: section.page!.height / 4 } } : section) }
    const second = paginateViewerSectionsIncremental(resized, () => undefined, first.sections)
    expect(second.reused).toBe(2)
    expect(second.sections[1].availableHeight).toBeLessThan(first.sections[1].availableHeight)
  })

  test('구역 쪽 설정이 바뀌면 그 구역과 그 설정을 잇는 구역만 다시 해석한다', async () => {
    const source = await HwpxSourcePackage.open(createSectionPageHwpx(directory, 'projection.hwpx'))
    const index = await source.index()
    // 구역 2의 쪽 설정을 지워 구역 1 것을 잇게 한다.
    const inheriting = source.withEntry(index.sectionPaths[2], Buffer.from(source.readEntry(index.sectionPaths[2]).toString('utf8').replace(/<hp:pagePr\b[\s\S]*?<\/hp:pagePr>/, '')))
    const { cache, result } = await ViewerProjectionCache.open(inheriting)
    expect(result.document.sections[2].page).toBe(result.document.sections[1].page)
    const section1 = inheriting.readEntry(index.sectionPaths[1]).toString('utf8')
    const edited = inheriting.withEntry(index.sectionPaths[1], Buffer.from(section1.replace('left="5669" right="5669"', 'left="7000" right="7000"')))
    const updated = await cache.update(edited)
    expect(updated.fallback).toBeUndefined()
    expect(updated.patch!.sections.map((section) => section.index)).toEqual([1, 2])
    expect(updated.decodedSections).toBe(2)
    const patched = applyViewerDocumentPatch(result.document, updated.patch!)
    expect(patched.sections[0]).toBe(result.document.sections[0])
    expect(patched.sections[2].page!.margin.left).toBe(7000)
    expect(patched).toStrictEqual(await decodeViewerDocument(edited))

    // 문서 첫 쪽 설정(구역 0)이 바뀌면 여전히 전체 문서로 물러선다.
    const section0 = edited.readEntry(index.sectionPaths[0]).toString('utf8')
    const first = edited.withEntry(index.sectionPaths[0], Buffer.from(section0.replace('left="8504"', 'left="9000"')))
    const rebuilt = await cache.update(first)
    expect(rebuilt.fallback).toBe('page-geometry')
    expect(rebuilt.document).toStrictEqual(await decodeViewerDocument(first))
  })

  test('한/글이 저장한 가로 방향 B4 문서(공개 corpus)는 용지를 돌려 줄 배치 폭과 같은 본문 폭이 된다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(join(__dirname, '../fixtures/public/external/ext-hwpxlib-page-size.hwpx')))
    const page = viewerSectionPage(document, 0)
    expect([page.width, page.height, page.landscape]).toEqual([103180, 72852, true])
    // 원본 줄 배치(`hp:lineseg horzsize="86172"`)와 같은 본문 폭(오차는 한/글 반올림).
    expect(Math.abs(page.width - page.margin.left - page.margin.right - 86172)).toBeLessThanOrEqual(4)
  })

  test('쪽 설정이 없는 구역은 앞 구역 object를 그대로 쓴다(공개 합성 문서)', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createSyntheticHwpx(directory, { fileName: 'inherit.hwpx', sectionCount: 3 })))
    expect(document.sections[1].page).toBe(document.sections[0].page)
    expect(document.sections[2].page).toBe(document.page)
  })

  test('render style·인쇄 CSS·가상화가 쪽마다 크기를 쓴다', () => {
    const page = viewerPageGeometry(pagePr({ width: '10000', height: '20000' }, MARGIN)).page
    const styles = { page, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {} } as ViewerRenderStyles
    expect(renderStylesForPage(styles, { ...page })).toBe(styles)
    const landscape = { ...page, width: 20000, height: 10000 }
    const derived = renderStylesForPage(styles, landscape)
    expect(derived.page).toBe(landscape)
    expect(renderStylesForPage(styles, { ...landscape })).toBe(derived)

    const css = hwpxPagePrintCss([{ width: 794, height: 1123 }, { width: 1123, height: 794 }, { width: 794, height: 1123 }])
    expect(css.match(/@page/g)).toHaveLength(2)
    expect(css).toContain('@page han-flow-page-size-1 { size: 1123px 794px; margin: 0; }')
    expect(css).toContain('.viewer-page[data-page-index="2"] { page: han-flow-page-size-0; }')

    const boxes = [{ height: 1000 }, { height: 500 }, { height: 1000 }, { height: 500 }, { height: 1000 }]
    const range = fixedPageVirtualRange(boxes, 1100 + 524, 100, 1, { overscan: 0 })
    expect(range.start).toBe(2)
    expect(range.topSpacer).toBe(1000 + 24 + 500 + 24)
  })
})
