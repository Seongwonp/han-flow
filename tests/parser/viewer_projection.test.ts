import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ViewerDocument } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import { forgetPackageTrees } from '../../src/core/editing/package_trees'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ViewerProjectionCache, ViewerProjectionFallback } from '../../src/core/parser/viewer_projection'
import { applyCommand, casesByFamily, FAMILIES, fixturePath, openedFixtures } from '../editing/golden_cases'
import { createListMarkerHwpx, createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

// 증분 projection 동치: 공개 corpus 38종에 golden 회귀와 같은 결정적 command 표본을 적용·되돌리기·다시 적용·되돌리기하면서
// 매 단계 증분 projection(앞 문서에 patch 적용)이 같은 package를 `decodeViewerDocument`로 처음부터 해석한 문서와
// 깊은 비교로 같은지 본다. patch에 없는 section은 앞 문서의 object를 그대로 써야 한다(React memo가 건너뛴다).

interface Totals {
  steps: number
  /** 전체 decode와 깊은 비교를 한 단계 수. */
  compared: number
  patches: number
  fallbacks: Partial<Record<ViewerProjectionFallback, number>>
  decodedSections: number
  totalSections: number
  headerSteps: number
}

class ProjectionChecker {
  private document: ViewerDocument
  private projectionId: number

  private stepIndex = 0

  /**
   * `compareEvery`: 몇 단계마다 전체 decode와 비교할지. section 80개짜리 large-progressive는 단계마다 전체 decode·비교가
   * 1초 가까이 걸려 10단계마다(와 마지막 단계) 비교하고, 그 사이 단계는 patch 기준·object 공유 불변식만 본다.
   */
  constructor(
    private readonly cache: ViewerProjectionCache,
    initial: { document: ViewerDocument; projectionId: number },
    private readonly totals: Totals,
    private readonly compareEvery = 1
  ) {
    this.document = initial.document
    this.projectionId = initial.projectionId
  }

  async step(sourcePackage: HwpxSourcePackage, last = false): Promise<void> {
    const result = await this.cache.update(sourcePackage)
    this.totals.steps += 1
    this.totals.totalSections += result.document.sections.length
    this.totals.decodedSections += result.decodedSections
    if (result.headerDecoded) this.totals.headerSteps += 1
    let next: ViewerDocument
    if (result.patch) {
      this.totals.patches += 1
      expect(result.patch.baseProjectionId).toBe(this.projectionId)
      next = applyViewerDocumentPatch(this.document, result.patch)
      const patched = new Set(result.patch.sections.map(({ index }) => index))
      next.sections.forEach((section, index) => {
        if (!patched.has(index)) expect(section).toBe(this.document.sections[index])
      })
      if (!result.patch.styles) {
        expect(next.charStyles).toBe(this.document.charStyles)
        expect(next.paraStyles).toBe(this.document.paraStyles)
      }
      expect(next.resources).toBe(this.document.resources)
      expect(next.page).toBe(this.document.page)
    } else {
      this.totals.fallbacks[result.fallback!] = (this.totals.fallbacks[result.fallback!] ?? 0) + 1
      next = result.document
    }
    if (last || this.stepIndex++ % this.compareEvery === 0) {
      this.totals.compared += 1
      expect(next).toStrictEqual(await decodeViewerDocument(sourcePackage))
    }
    this.document = next
    this.projectionId = result.projectionId
  }
}

describe('편집 증분 projection', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-viewer-projection-'))
  const totals: Totals = { steps: 0, compared: 0, patches: 0, fallbacks: {}, decodedSections: 0, totalSections: 0, headerSteps: 0 }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    console.log(`HAN_FLOW_VIEWER_PROJECTION_EQUIVALENCE ${JSON.stringify(totals)}`)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: command·undo·redo 뒤 증분 projection이 전체 decode와 같다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(directory, fixture))
      const { cache, result } = await ViewerProjectionCache.open(original)
      expect(result.document).toStrictEqual(await decodeViewerDocument(original))
      const checker = new ProjectionChecker(cache, result, totals, result.document.sections.length > 20 ? 10 : 1)
      const cases = await casesByFamily(original)
      let current = original
      let position = 0
      for (const family of FAMILIES) {
        for (const testCase of cases[family]) {
          if (position++ % 7 === 3) forgetPackageTrees(current)
          let applied
          try {
            applied = applyCommand(current, testCase.build(current).command)
          } catch {
            continue
          }
          if (applied.package === current || applied.changed === false) {
            // 바뀌지 않은 command도 renderer에는 빈 patch가 간다.
            await checker.step(applied.package)
            continue
          }
          await checker.step(applied.package)
          const undo = applyCommand(applied.package, applied.inverse!)
          await checker.step(undo.package)
          const redo = applyCommand(undo.package, undo.inverse!)
          await checker.step(redo.package)
          const back = applyCommand(redo.package, redo.inverse!)
          await checker.step(back.package)
          current = back.package
        }
      }
      await checker.step(current, true)
    },
    300_000
  )

  test('표본이 증분 patch를 주로 거쳤고 바뀐 section만 다시 해석했다', () => {
    expect(totals.steps).toBeGreaterThan(1000)
    expect(totals.compared).toBeGreaterThan(totals.steps * 0.9)
    expect(totals.patches).toBe(totals.steps)
    expect(totals.headerSteps).toBeGreaterThan(0)
    expect(totals.decodedSections).toBeLessThan(totals.totalSections / 2)
  })

  test('header의 목록 번호 정의가 바뀌면 그 문단 style을 쓰는 section을 다시 해석한다', async () => {
    const source = await HwpxSourcePackage.open(createListMarkerHwpx(directory))
    const { cache, result } = await ViewerProjectionCache.open(source)
    const header = source.readEntry('Contents/header.xml').toString('utf8')
    const changedHeader = header.replace(/(<hh:paraHead\b[^>]*>)([^<]*)/, (_match, open: string, text: string) => `${open}(${text})`)
    expect(changedHeader).not.toBe(header)
    const edited = source.withEntry('Contents/header.xml', Buffer.from(changedHeader))
    const updated = await cache.update(edited)
    expect(updated.patch).toBeDefined()
    expect(updated.patch!.styles).toBeDefined()
    expect(updated.decodedSections).toBeGreaterThan(0)
    expect(applyViewerDocumentPatch(result.document, updated.patch!)).toStrictEqual(await decodeViewerDocument(edited))
  })

  test('쪽 크기·그림 entry가 바뀌면 전체 문서로 물러선다', async () => {
    const fixture = createSyntheticHwpx(directory, { fileName: 'projection-fallback.hwpx', sectionCount: 3, imageBytes: 1024 })
    const source = await HwpxSourcePackage.open(fixture)
    const { cache } = await ViewerProjectionCache.open(source)
    const index = await source.index()
    const section = source.readEntry(index.sectionPaths[0]).toString('utf8')
    const resized = source.withEntry(index.sectionPaths[0], Buffer.from(section.replace(/(<hp:pagePr\b[^>]*\bwidth=")(\d+)/, (_match, prefix: string, width: string) => `${prefix}${Number(width) + 100}`)))
    const geometry = await cache.update(resized)
    expect(geometry.patch).toBeUndefined()
    expect(geometry.fallback).toBe('page-geometry')
    expect(geometry.document).toStrictEqual(await decodeViewerDocument(resized))

    const image = index.resourcePaths[0]
    expect(image).toBeDefined()
    const bytes = resized.readEntry(image)
    bytes[bytes.length - 1] ^= 0xff
    const repainted = resized.withEntry(image, bytes)
    const resource = await cache.update(repainted)
    expect(resource.fallback).toBe('non-section-entry')
    expect(resource.document).toStrictEqual(await decodeViewerDocument(repainted))
  })
})
