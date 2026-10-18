import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ViewerDocument } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch, sectionStyleIds } from '../../src/core/document/viewer_document_patch'
import { forgetPackageTrees } from '../../src/core/editing/package_trees'
import { applyCharacterStyleCommand, applyRestoreStyleCommand } from '../../src/core/editing/style_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
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
  /** 바뀐 style definition 때문에 다시 재라고 알린(다시 해석하지 않은) section 수. */
  restyledSections: number
  /** style map 전체를 보낸(글꼴 목록이 바뀐) patch 수. */
  fullStylePatches: number
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
      const restyled = new Set(result.patch.restyledSections ?? [])
      this.totals.restyledSections += restyled.size
      if (result.patch.styles) this.totals.fullStylePatches += 1
      expect(result.patch.styles && result.patch.styleChanges).toBeFalsy()
      next.sections.forEach((section, index) => {
        if (restyled.has(index)) {
          // 해석 결과는 그대로이고 object만 새로 만들어 renderer가 다시 잰다.
          expect(patched.has(index)).toBe(false)
          expect(section).not.toBe(this.document.sections[index])
          expect(section).toStrictEqual(this.document.sections[index])
        } else if (!patched.has(index)) {
          expect(section).toBe(this.document.sections[index])
        }
      })
      if (!result.patch.styles && !result.patch.styleChanges) {
        expect(next.charStyles).toBe(this.document.charStyles)
        expect(next.paraStyles).toBe(this.document.paraStyles)
        expect(next.cellStyles).toBe(this.document.cellStyles)
      }
      if (result.patch.styleChanges) {
        // 바뀌지 않은 id의 style object는 앞 문서 것을 그대로 쓰고, 바뀐 id를 쓰는 section은 모두 patch·restyled에 있다.
        for (const name of ['charStyles', 'paraStyles', 'cellStyles'] as const) {
          const changed = new Set(Object.keys(result.patch.styleChanges[name]))
          for (const [id, style] of Object.entries(next[name])) {
            if (!changed.has(id)) expect(style).toBe((this.document[name] as Record<string, unknown>)[id])
          }
          next.sections.forEach((section, index) => {
            if ([...changed].some((id) => sectionStyleIds(section)[name].has(id))) {
              expect(patched.has(index) || restyled.has(index)).toBe(true)
            }
          })
        }
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
  const totals: Totals = {
    steps: 0, compared: 0, patches: 0, fallbacks: {}, decodedSections: 0, totalSections: 0, headerSteps: 0, restyledSections: 0, fullStylePatches: 0
  }

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
    // 표본의 style command는 글꼴 목록을 바꾸지 않는다(새 definition만 더하거나 지운다).
    expect(totals.fullStylePatches).toBe(0)
  })

  describe('style definition 변경의 section별 범위', () => {
    // section 4개: section3만 글자 모양 1을 쓰고, 나머지는 글자 모양 0을 쓴다.
    const openStyled = async () => {
      const base = await HwpxSourcePackage.open(createSyntheticHwpx(directory, { fileName: 'projection-styles.hwpx', sectionCount: 4 }))
      const header = base.readEntry('Contents/header.xml').toString('utf8')
      const styledHeader = header.replace(
        '</hh:charPr></hh:charProperties>',
        '</hh:charPr><hh:charPr id="1" height="1200" textColor="#000000"><hh:fontRef hangul="0"/></hh:charPr></hh:charProperties>'
      )
      expect(styledHeader).not.toBe(header)
      const section3 = base.readEntry('Contents/section3.xml').toString('utf8')
      const source = base
        .withEntry('Contents/header.xml', Buffer.from(styledHeader))
        .withEntry('Contents/section3.xml', Buffer.from(section3.replaceAll('charPrIDRef="0"', 'charPrIDRef="1"')))
      const { cache, result } = await ViewerProjectionCache.open(source)
      const index = await source.index()
      return { source, cache, document: result.document, sectionPaths: index.sectionPaths }
    }
    const editHeader = (source: HwpxSourcePackage, edit: (header: string) => string) => {
      const header = source.readEntry('Contents/header.xml').toString('utf8')
      const changed = edit(header)
      expect(changed).not.toBe(header)
      return source.withEntry('Contents/header.xml', Buffer.from(changed))
    }

    test('글자 모양 command는 새 definition만 보내고 편집한 section만 다시 해석한다', async () => {
      const { source, cache, document, sectionPaths } = await openStyled()
      expect(sectionStyleIds(document.sections[3]).charStyles).toEqual(new Set(['1']))
      const anchor = listHwpxTextAnchors(source, sectionPaths[2]).find((item) => item.text.length > 0)!
      const applied = applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath: sectionPaths[2], textNodeId: anchor.textNodeId, italic: true })
      expect(applied.changed).toBe(true)
      const bold = await cache.update(applied.package)
      expect(bold.patch).toBeDefined()
      expect(bold.patch!.styles).toBeUndefined()
      expect(bold.patch!.styleChanges!.charStyles).toEqual({ '2': expect.objectContaining({ id: '2', italic: true }) })
      expect(bold.patch!.styleChanges!.paraStyles).toEqual({})
      expect(bold.patch!.sections.map(({ index }) => index)).toEqual([2])
      expect(bold.patch!.restyledSections).toBeUndefined()
      expect(bold.decodedSections).toBe(1)
      expect(bold.restyledSections).toBe(0)
      const afterBold = applyViewerDocumentPatch(document, bold.patch!)
      expect(afterBold).toStrictEqual(await decodeViewerDocument(applied.package))
      expect(afterBold.charStyles['0']).toBe(document.charStyles['0'])

      // 실행 취소는 더한 definition을 지운다(null).
      const undone = applyRestoreStyleCommand(applied.package, applied.inverse as Parameters<typeof applyRestoreStyleCommand>[1])
      const undo = await cache.update(undone.package)
      expect(undo.patch!.styleChanges!.charStyles).toEqual({ '2': null })
      expect(undo.patch!.sections.map(({ index }) => index)).toEqual([2])
      const afterUndo = applyViewerDocumentPatch(afterBold, undo.patch!)
      expect(afterUndo).toStrictEqual(await decodeViewerDocument(undone.package))
      expect(afterUndo.charStyles['2']).toBeUndefined()
    })

    test('기존 definition이 바뀌면 그 id를 쓰는 section만 다시 재라고 알리고 다시 해석하지 않는다', async () => {
      const { source, cache, document } = await openStyled()
      const recolored = editHeader(source, (header) => header.replace('<hh:charPr id="1" height="1200"', '<hh:charPr id="1" height="1400"'))
      const one = await cache.update(recolored)
      expect(one.patch!.styleChanges!.charStyles).toEqual({ '1': expect.objectContaining({ height: 1400 }) })
      expect(one.patch!.sections).toEqual([])
      expect(one.patch!.restyledSections).toEqual([3])
      expect(one.decodedSections).toBe(0)
      const afterOne = applyViewerDocumentPatch(document, one.patch!)
      expect(afterOne).toStrictEqual(await decodeViewerDocument(recolored))
      expect(afterOne.sections[3]).not.toBe(document.sections[3])
      expect(afterOne.sections[0]).toBe(document.sections[0])

      // 모든 section이 쓰는 id(문단 모양 0)는 모든 section이 해당한다. 목록 번호(heading)는 그대로라 다시 해석하지 않는다.
      const aligned = editHeader(recolored, (header) => header.replace('<hh:align horizontal="LEFT"/>', '<hh:align horizontal="CENTER"/>'))
      const all = await cache.update(aligned)
      expect(Object.keys(all.patch!.styleChanges!.paraStyles)).toEqual(['0'])
      expect(all.patch!.restyledSections).toEqual([0, 1, 2, 3])
      expect(all.decodedSections).toBe(0)
      expect(applyViewerDocumentPatch(afterOne, all.patch!)).toStrictEqual(await decodeViewerDocument(aligned))
    })

    test('셀 테두리 definition이 바뀌면 그 테두리를 쓰는 표가 든 section만 해당한다', async () => {
      const { source, cache, document } = await openStyled()
      const users = document.sections.flatMap((section, index) => sectionStyleIds(section).cellStyles.has('1') ? [index] : [])
      expect(users.length).toBeGreaterThan(0)
      expect(users.length).toBeLessThan(document.sections.length)
      const filled = editHeader(source, (header) => header.replace('faceColor="#EEEEEE"', 'faceColor="#DDDDDD"'))
      const result = await cache.update(filled)
      expect(Object.keys(result.patch!.styleChanges!.cellStyles)).toEqual(['1'])
      expect(result.patch!.restyledSections).toEqual(users)
      expect(applyViewerDocumentPatch(document, result.patch!)).toStrictEqual(await decodeViewerDocument(filled))
    })

    test('글꼴 목록이 바뀌면 style map 전체를 보낸다', async () => {
      const { source, cache, document } = await openStyled()
      const renamed = editHeader(source, (header) => header.replace('face="HanFlow Test Sans"', 'face="HanFlow Test Serif"'))
      const result = await cache.update(renamed)
      expect(result.patch!.styles).toBeDefined()
      expect(result.patch!.styleChanges).toBeUndefined()
      expect(result.patch!.restyledSections).toBeUndefined()
      expect(applyViewerDocumentPatch(document, result.patch!)).toStrictEqual(await decodeViewerDocument(renamed))
    })
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
    expect(updated.patch!.styles).toBeUndefined()
    // 바뀐 번호 모양을 쓰는 문단 모양만 보낸다(id별 변경).
    expect(Object.keys(updated.patch!.styleChanges!.paraStyles).length).toBeGreaterThan(0)
    expect(Object.keys(updated.patch!.styleChanges!.paraStyles).length).toBeLessThan(Object.keys(result.document.paraStyles).length)
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
