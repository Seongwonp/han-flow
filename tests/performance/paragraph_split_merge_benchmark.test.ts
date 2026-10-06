import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import {
  applyReplaceParagraphFragmentCommand,
  planMergeParagraph,
  planSplitParagraph
} from '../../src/core/editing/paragraph_patch'
import { createEditorSelection } from '../../src/core/editing/selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

// `HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/paragraph_split_merge_benchmark.test.ts`
// large-progressive synthetic fixture(80 section)의 가장 큰 section 가운데 문단에서 Enter(가운데 분할)와 새 문단 맨 앞
// Backspace(이전 문단과 병합)를 200쌍 연속으로 적용한다. 한 쌍 = [plan split → apply → anchor 조회 → plan merge → apply →
// anchor 조회]. after: source tree 경로. 전환 전 문자열 경로(paragraph_patch_legacy)는 4단계 뒤 지웠다. 지우기 전 같은 조건의
// 측정값은 평균 18.93ms(p50 18.28·p95 26.92)였다(docs/editing_core_refactor_plan.md 3단계 기록).

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const PAIRS = 200

type Paths = {
  split: typeof planSplitParagraph
  merge: typeof planMergeParagraph
  apply: typeof applyReplaceParagraphFragmentCommand
}

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

function run(
  start: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string,
  offset: number,
  paths: Paths
): { samples: number[]; package: HwpxSourcePackage } {
  let current = start
  const samples: number[] = []
  const caret = createEditorSelection(sectionPath, textNodeId, offset)
  for (let index = 0; index < PAIRS; index += 1) {
    const startedAt = performance.now()
    const split = paths.split(current, caret)
    current = paths.apply(current, split.command).package
    listHwpxTextAnchors(current, sectionPath)
    const merge = paths.merge(current, split.selectionAfter, 'previous')
    current = paths.apply(current, merge.command).package
    listHwpxTextAnchors(current, sectionPath)
    samples.push(performance.now() - startedAt)
  }
  return { samples, package: current }
}

describe('문단 Enter·Backspace 비용', () => {
  benchmark('large-progressive에서 Enter+Backspace 200쌍의 ms/쌍을 잰다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-paragraph-benchmark-'))
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
      const offset = Math.floor(anchor.text.length / 2)

      const after = run(opened, sectionPath, anchor.textNodeId, offset, {
        split: planSplitParagraph,
        merge: planMergeParagraph,
        apply: applyReplaceParagraphFragmentCommand
      })

      // 실제 편집 세션 경로(HwpxEditHistory.commit → applyEditTransaction)
      const history = new HwpxEditHistory(await HwpxSourcePackage.open(fixture))
      const caret = createEditorSelection(sectionPath, anchor.textNodeId, offset)
      const historySamples: number[] = []
      for (let pair = 0; pair < PAIRS; pair += 1) {
        const startedAt = performance.now()
        history.setSelection(caret)
        const split = planSplitParagraph(history.package, caret)
        history.commit({
          id: `split-${pair}`, baseRevision: history.package.revision, commands: [split.command],
          selectionBefore: caret, selectionAfter: split.selectionAfter, inputType: 'insertParagraph', timestamp: pair * 20
        })
        const merge = planMergeParagraph(history.package, split.selectionAfter, 'previous')
        history.commit({
          id: `merge-${pair}`, baseRevision: history.package.revision, commands: [merge.command],
          selectionBefore: split.selectionAfter, selectionAfter: merge.selectionAfter,
          inputType: 'deleteContentBackward', timestamp: pair * 20 + 10
        })
        historySamples.push(performance.now() - startedAt)
      }
      // 한 쌍마다 대상 run이 하나씩 늘어나므로 두 경로가 같은 bytes에 이른다.
      expect(history.package.readEntry(sectionPath).equals(after.package.readEntry(sectionPath))).toBe(true)

      const result = {
        sectionPath,
        sectionBytes: index.sectionSizes[sectionPath],
        sectionAnchors: anchors.length,
        pairs: PAIRS,
        afterTreeMs: summarize(after.samples),
        afterHistoryCommitMs: summarize(historySamples)
      }
      console.log(`HAN_FLOW_PARAGRAPH_BENCHMARK ${JSON.stringify(result)}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
