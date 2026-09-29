import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { createEditorSelection } from '../../src/core/editing/selection'
import {
  applyReplaceTextCommand,
  HwpxTextAnchor,
  listHwpxTextAnchors,
  ReplaceTextResult
} from '../../src/core/editing/text_patch'
import { legacyApplyReplaceTextCommand, legacyListHwpxTextAnchors } from '../../src/core/editing/text_patch_legacy'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

// `HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/text_edit_benchmark.test.ts`
// large-progressive synthetic fixture(80 section)의 가장 큰 section 가운데 hp:t에 500자를 한 글자씩 입력한다.
// keystroke 하나 = applyEditTransaction과 같은 순서(selection 검증용 anchor 조회 → text command → anchor 조회).
// before: 전환 전 문자열 경로(text_patch_legacy, 매번 section 재scan), after: source tree 경로(cache 재사용).

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const KEYSTROKES = 500

type Lister = (sourcePackage: HwpxSourcePackage, sectionPath: string) => readonly HwpxTextAnchor[]
type Applier = typeof applyReplaceTextCommand

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

function typeCharacters(
  start: HwpxSourcePackage,
  sectionPath: string,
  anchor: HwpxTextAnchor,
  list: Lister,
  apply: Applier
): { samples: number[]; package: HwpxSourcePackage } {
  let current = start
  let offset = Math.floor(anchor.text.length / 2)
  const samples: number[] = []
  for (let index = 0; index < KEYSTROKES; index += 1) {
    const startedAt = performance.now()
    if (!list(current, sectionPath).some((candidate) => candidate.textNodeId === anchor.textNodeId)) {
      throw new Error('anchor가 사라졌습니다.')
    }
    const result: ReplaceTextResult = apply(current, {
      type: 'replace-text',
      revision: current.revision,
      sectionPath,
      textNodeId: anchor.textNodeId,
      from: offset,
      to: offset,
      insert: String.fromCharCode(0xac00 + (index % 400))
    })
    list(result.package, sectionPath)
    samples.push(performance.now() - startedAt)
    current = result.package
    offset += 1
  }
  return { samples, package: current }
}

describe('text 입력 keystroke 비용', () => {
  benchmark('large-progressive에 500자를 입력할 때 전환 전·후 ms/keystroke를 비교한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-text-benchmark-'))
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
      const anchors = legacyListHwpxTextAnchors(opened, sectionPath)
      const anchor = anchors[Math.floor(anchors.length / 2)]

      const before = typeCharacters(opened, sectionPath, anchor, legacyListHwpxTextAnchors, legacyApplyReplaceTextCommand)
      const afterStart = await HwpxSourcePackage.open(fixture)
      const after = typeCharacters(afterStart, sectionPath, anchor, listHwpxTextAnchors, applyReplaceTextCommand)
      expect(after.package.readEntry(sectionPath).equals(before.package.readEntry(sectionPath))).toBe(true)

      // 실제 편집 세션 경로(HwpxEditHistory.commit → applyEditTransaction, 입력 묶기 포함)
      const history = new HwpxEditHistory(await HwpxSourcePackage.open(fixture))
      let offset = Math.floor(anchor.text.length / 2)
      history.setSelection(createEditorSelection(sectionPath, anchor.textNodeId, offset))
      const historySamples: number[] = []
      for (let index = 0; index < KEYSTROKES; index += 1) {
        const startedAt = performance.now()
        history.commit({
          id: `benchmark-${index}`,
          baseRevision: history.package.revision,
          commands: [{
            type: 'replace-text',
            sectionPath,
            textNodeId: anchor.textNodeId,
            from: offset,
            to: offset,
            insert: String.fromCharCode(0xac00 + (index % 400))
          }],
          selectionBefore: createEditorSelection(sectionPath, anchor.textNodeId, offset),
          selectionAfter: createEditorSelection(sectionPath, anchor.textNodeId, offset + 1),
          inputType: 'insertText',
          timestamp: index * 10
        })
        historySamples.push(performance.now() - startedAt)
        offset += 1
      }
      expect(history.package.readEntry(sectionPath).equals(before.package.readEntry(sectionPath))).toBe(true)

      const result = {
        sectionPath,
        sectionBytes: index.sectionSizes[sectionPath],
        sectionAnchors: anchors.length,
        keystrokes: KEYSTROKES,
        beforeLegacyMs: summarize(before.samples),
        afterTreeMs: summarize(after.samples),
        afterHistoryCommitMs: summarize(historySamples)
      }
      console.log(`HAN_FLOW_TEXT_EDIT_BENCHMARK ${JSON.stringify(result)}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
