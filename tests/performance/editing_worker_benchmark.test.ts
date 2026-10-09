import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { performance } from 'perf_hooks'
import { serialize } from 'v8'
import type { EditingActionResult, EditingCommitRequest } from '../../src/core/editing/editing_contract'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { EditingEngine } from '../../src/main/editing_engine'
import { EditingSessionManager } from '../../src/main/editing_session'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'
import { writeEditingWorkerShim } from '../main/ts_worker_shim'

// `HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/editing_worker_benchmark.test.ts`
// large-progressive(80 section)의 가장 큰 section 가운데 hp:t에 한 글자씩 commit한다.
// fullProjection: 증분 projection 이전 경로의 재현. command마다 package 전체를 `decodeViewerDocument`로 다시 해석하고
//   전체 문서를 structured clone(v8 serialize·deserialize)한다(worker→main 한 번 분).
// inProcess: 같은 thread에서 EditingEngine을 직접 실행(증분 projection, patch만 돌려준다).
// worker: EditingSessionManager가 편집 worker에 요청. main thread 점유 시간은 event loop utilization의
//   active 시간 증가분(IPC handler 안에서 main이 실제로 일한 시간: 요청 직렬화·응답 역직렬화)으로 잰다.
// 실행 취소·다시 실행도 worker 경로로 잰다. payload는 결과 하나의 v8 serialize 크기다.

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const KEYSTROKES = 40
const WARMUP = 5

function summarize(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right)
  const round = (value: number): number => Math.round(value * 100) / 100
  return {
    mean: round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    p50: round(sorted[Math.floor(sorted.length * 0.5)]),
    p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    max: round(sorted[sorted.length - 1])
  }
}

async function measure(
  commit: (index: number) => Promise<unknown>
): Promise<{ endToEndMs: ReturnType<typeof summarize>; mainBusyMs: ReturnType<typeof summarize> }> {
  const endToEnd: number[] = []
  const mainBusy: number[] = []
  for (let index = 0; index < KEYSTROKES + WARMUP; index += 1) {
    const utilization = performance.eventLoopUtilization()
    const startedAt = performance.now()
    await commit(index)
    const elapsed = performance.now() - startedAt
    const busy = performance.eventLoopUtilization(utilization).active
    if (index < WARMUP) continue
    endToEnd.push(elapsed)
    mainBusy.push(busy)
  }
  return { endToEndMs: summarize(endToEnd), mainBusyMs: summarize(mainBusy) }
}

function structuredCloneLikeIpc<T>(value: T): T {
  return structuredClone(value)
}

describe('편집 worker 격리 비용', () => {
  benchmark('large-progressive에서 keystroke 크기 commit의 main 점유와 왕복 지연을 잰다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-worker-benchmark-'))
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
      const base = Math.floor(anchor.text.length / 2)
      const request = (sessionId: string, keystroke: number): EditingCommitRequest => {
        const offset = base + keystroke
        const selection = (at: number) => ({
          sectionPath,
          anchorTextNodeId: anchor.textNodeId,
          anchorOffset: at,
          focusTextNodeId: anchor.textNodeId,
          focusOffset: at
        })
        return {
          sessionId,
          transactionId: `benchmark-${keystroke}`,
          sectionPath,
          textNodeId: anchor.textNodeId,
          from: offset,
          to: offset,
          insert: String.fromCharCode(0xac00 + (keystroke % 400)),
          selectionBefore: selection(offset),
          selectionAfter: selection(offset + 1),
          inputType: 'insertText',
          timestamp: keystroke * 10
        }
      }

      const legacy = new HwpxEditHistory(opened)
      const fullProjection = await measure(async (keystroke) => {
        const commit = request('legacy', keystroke)
        legacy.commitSynchronized({
          id: commit.transactionId,
          baseRevision: legacy.package.revision,
          commands: [{
            type: 'replace-text',
            sectionPath: commit.sectionPath,
            textNodeId: commit.textNodeId,
            from: commit.from,
            to: commit.to,
            insert: commit.insert
          }],
          selectionBefore: commit.selectionBefore,
          selectionAfter: commit.selectionAfter,
          inputType: commit.inputType,
          timestamp: commit.timestamp
        })
        return structuredCloneLikeIpc(await decodeViewerDocument(legacy.package))
      })
      const legacyPayloadBytes = serialize(await decodeViewerDocument(legacy.package)).byteLength

      const { engine } = await EditingEngine.open(fixture)
      const inProcess = await measure((keystroke) => engine.commit(request('in-process', keystroke)))

      const manager = new EditingSessionManager(() => 'benchmark', {
        workerPath: writeEditingWorkerShim(directory)
      })
      const started = await manager.start(1, fixture)
      let last: EditingActionResult | undefined
      const worker = await measure(async (keystroke) => {
        last = await manager.commit(1, request(started.sessionId, keystroke))
      })
      const patchPayloadBytes = serialize(last).byteLength
      const undoRedo = await measure((index) => index % 2 === 0
        ? manager.undo(1, started.sessionId)
        : manager.redo(1, started.sessionId))
      await manager.dispose()

      const result = {
        sectionPath,
        sectionBytes: index.sectionSizes[sectionPath],
        keystrokes: KEYSTROKES,
        payloadBytes: { fullDocument: legacyPayloadBytes, patch: patchPayloadBytes },
        fullProjection,
        inProcess,
        worker,
        workerUndoRedo: undoRedo
      }
      console.log(`HAN_FLOW_EDITING_WORKER_BENCHMARK ${JSON.stringify(result)}`)
      expect(last?.patch?.sections.map((section) => section.index)).toHaveLength(1)
      expect(worker.endToEndMs.p50).toBeLessThan(fullProjection.endToEndMs.p50)
      expect(worker.mainBusyMs.p50).toBeLessThan(fullProjection.mainBusyMs.p50)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }, 600_000)
})
