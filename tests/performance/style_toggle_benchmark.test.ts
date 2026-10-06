import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { createEditorSelection } from '../../src/core/editing/selection'
import { applyCharacterStyleCommand, StylePatchResult } from '../../src/core/editing/style_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

// `HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/style_toggle_benchmark.test.ts`
// large-progressive synthetic fixture(80 section)의 가장 큰 section 가운데 run에 굵게를 200번 연속으로 켜고 끈다.
// toggle 하나 = applyEditTransaction과 같은 순서(selection 검증용 anchor 조회 → 글자 style command → anchor 조회).
// after: source tree 경로(package tree cache). 전환 전 문자열 경로(style_patch_legacy)는 4단계 뒤 지웠다. 지우기 전 같은 조건의
// 측정값은 평균 6.29ms(p50 6.17·p95 8.44)였다(docs/editing_core_refactor_plan.md 2단계 기록).

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const TOGGLES = 200

type Applier = typeof applyCharacterStyleCommand

function summarize(samples: number[]): { mean: number; p50: number; p95: number; total: number } {
  const sorted = [...samples].sort((left, right) => left - right)
  const round = (value: number): number => Math.round(value * 1000) / 1000
  const total = samples.reduce((sum, value) => sum + value, 0)
  return {
    mean: round(total / samples.length),
    p50: round(sorted[Math.floor(sorted.length * 0.5)]),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    total: Math.round(total)
  }
}

function toggle(
  start: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string,
  apply: Applier,
  firstBold: boolean
): { samples: number[]; package: HwpxSourcePackage } {
  let current = start
  const samples: number[] = []
  for (let index = 0; index < TOGGLES; index += 1) {
    const startedAt = performance.now()
    if (!listHwpxTextAnchors(current, sectionPath).some((candidate) => candidate.textNodeId === textNodeId)) {
      throw new Error('anchor가 사라졌습니다.')
    }
    const result: StylePatchResult = apply(current, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId,
      bold: index % 2 === 0 ? firstBold : !firstBold
    })
    listHwpxTextAnchors(result.package, sectionPath)
    samples.push(performance.now() - startedAt)
    if (!result.changed) throw new Error('굵게 toggle이 문서를 바꾸지 않았습니다.')
    current = result.package
  }
  return { samples, package: current }
}

describe('글자 style toggle 비용', () => {
  benchmark('large-progressive에서 굵게를 200번 toggle할 때 ms/toggle을 잰다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-style-benchmark-'))
    try {
      const fixture = createSyntheticHwpx(directory, {
        fileName: 'large-progressive.hwpx',
        sectionCount: 80,
        paragraphsPerExtraSection: 250,
        imageBytes: 5 * 1024 * 1024
      })
      const opened = await HwpxSourcePackage.open(fixture)
      const index = await opened.index()
      const sectionPath = [...index.sectionPaths].sort(
        (left, right) => index.sectionSizes[right] - index.sectionSizes[left]
      )[0]
      const anchors = listHwpxTextAnchors(opened, sectionPath)
      const anchor = anchors[Math.floor(anchors.length / 2)]

      // 처음 값은 지금 run 모양과 반대여야 한다(같으면 no-op).
      const firstBold = applyCharacterStyleCommand(await HwpxSourcePackage.open(fixture), {
        type: 'apply-character-style',
        sectionPath,
        textNodeId: anchor.textNodeId,
        bold: true
      }).changed

      const after = toggle(opened, sectionPath, anchor.textNodeId, applyCharacterStyleCommand, firstBold)

      // 실제 편집 세션 경로(HwpxEditHistory.commit → applyEditTransaction)
      const history = new HwpxEditHistory(await HwpxSourcePackage.open(fixture))
      const caret = createEditorSelection(sectionPath, anchor.textNodeId, 0)
      history.setSelection(caret)
      const historySamples: number[] = []
      for (let toggleIndex = 0; toggleIndex < TOGGLES; toggleIndex += 1) {
        const startedAt = performance.now()
        history.commit({
          id: `benchmark-${toggleIndex}`,
          baseRevision: history.package.revision,
          commands: [{
            type: 'apply-character-style',
            sectionPath,
            textNodeId: anchor.textNodeId,
            bold: toggleIndex % 2 === 0 ? firstBold : !firstBold
          }],
          selectionBefore: caret,
          selectionAfter: caret,
          inputType: 'formatBold',
          timestamp: toggleIndex * 10
        })
        historySamples.push(performance.now() - startedAt)
      }
      expect(history.package.readEntry(sectionPath).equals(after.package.readEntry(sectionPath))).toBe(true)
      expect(history.package.readEntry('Contents/header.xml').equals(after.package.readEntry('Contents/header.xml'))).toBe(true)

      const result = {
        sectionPath,
        sectionBytes: index.sectionSizes[sectionPath],
        headerBytes: opened.readEntry('Contents/header.xml').byteLength,
        sectionAnchors: anchors.length,
        toggles: TOGGLES,
        afterTreeMs: summarize(after.samples),
        afterHistoryCommitMs: summarize(historySamples)
      }
      console.log(`HAN_FLOW_STYLE_TOGGLE_BENCHMARK ${JSON.stringify(result)}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
