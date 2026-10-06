import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { applyReplaceTableFragmentCommand, planInsertTableRowAfter } from '../../src/core/editing/table_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createTableColumnHwpx } from '../fixtures/public/create_synthetic_hwpx'

// `HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/table_structure_benchmark.test.ts`
// 표 행 추가 + 실행 취소 50쌍(예열 5쌍 제외). 한 쌍 = [plan insert-row → apply → anchor 조회 → inverse apply → anchor 조회].
// 대상: table-columns synthetic fixture(A1 셀)와, 행 추가가 가능한 셀이 있는 외부 fixture 가운데 그 section이 가장 큰 것.
// after: source tree 경로. 전환 전 문자열 경로(table_patch_legacy)는 4단계 정리에서 지웠다. 지우기 전 같은 조건의 측정값은
// table-columns 평균 1.35ms, ext-pyhwpx-table-page-break-cell 평균 5.97ms였다(docs/editing_core_refactor_plan.md 4단계 기록).

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const PAIRS = 50
/** JIT 예열용으로 먼저 돌리고 버리는 쌍 수 */
const WARMUP = 5

interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  file?: string
  expected: { outcome: string }
}

type Paths = {
  plan: typeof planInsertTableRowAfter
  apply: typeof applyReplaceTableFragmentCommand
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

function run(start: HwpxSourcePackage, caret: EditorSelection, paths: Paths): { samples: number[]; package: HwpxSourcePackage } {
  let current = start
  const samples: number[] = []
  for (let index = 0; index < WARMUP + PAIRS; index += 1) {
    const startedAt = performance.now()
    const plan = paths.plan(current, caret)
    const result = paths.apply(current, plan.command)
    listHwpxTextAnchors(result.package, caret.sectionPath)
    current = paths.apply(result.package, result.inverse!).package
    listHwpxTextAnchors(current, caret.sectionPath)
    if (index >= WARMUP) samples.push(performance.now() - startedAt)
  }
  return { samples, package: current }
}

/** 행 추가가 가능한 첫 셀 caret. 없으면 undefined. */
async function insertableCaret(path: string): Promise<{ caret: EditorSelection; sectionBytes: number } | undefined> {
  const opened = await HwpxSourcePackage.open(path)
  const index = await opened.index()
  let best: { caret: EditorSelection; sectionBytes: number } | undefined
  for (const sectionPath of index.sectionPaths) {
    if (best && index.sectionSizes[sectionPath] <= best.sectionBytes) continue
    for (const anchor of listHwpxTextAnchors(opened, sectionPath)) {
      const caret = createEditorSelection(sectionPath, anchor.textNodeId, 0)
      try {
        planInsertTableRowAfter(opened, caret)
      } catch {
        continue
      }
      best = { caret, sectionBytes: index.sectionSizes[sectionPath] }
      break
    }
  }
  return best
}

describe('표 행 추가·실행 취소 비용', () => {
  benchmark('table-columns와 가장 큰 외부 표 fixture에서 행 추가+undo 50쌍의 ms/쌍을 잰다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-benchmark-'))
    try {
      const publicRoot = join(__dirname, '../fixtures/public')
      const manifest = JSON.parse(
        readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
      ) as { fixtures: ManifestFixture[] }
      let external: { id: string; path: string; caret: EditorSelection; sectionBytes: number } | undefined
      for (const fixture of manifest.fixtures) {
        if (fixture.source !== 'file' || fixture.expected.outcome !== 'opened') continue
        const path = join(publicRoot, fixture.file!)
        const found = await insertableCaret(path)
        if (found && (!external || found.sectionBytes > external.sectionBytes)) external = { id: fixture.id, path, ...found }
      }
      const tableColumns = createTableColumnHwpx(directory, 'table-columns.hwpx')
      const synthetic = await insertableCaret(tableColumns)
      const targets = [
        { id: 'table-columns', path: tableColumns, ...synthetic! },
        external!
      ]
      const results = []
      for (const target of targets) {
        const after = run(await HwpxSourcePackage.open(target.path), target.caret, {
          plan: planInsertTableRowAfter,
          apply: applyReplaceTableFragmentCommand
        })
        const original = await HwpxSourcePackage.open(target.path)
        expect(after.package.readEntry(target.caret.sectionPath).equals(original.readEntry(target.caret.sectionPath))).toBe(true)
        results.push({
          fixture: target.id,
          sectionPath: target.caret.sectionPath,
          sectionBytes: target.sectionBytes,
          pairs: PAIRS,
          afterTreeMs: summarize(after.samples)
        })
      }
      console.log(`HAN_FLOW_TABLE_BENCHMARK ${JSON.stringify(results)}`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
