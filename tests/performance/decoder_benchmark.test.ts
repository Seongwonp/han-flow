import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { shouldLoadProgressively } from '../../src/core/parser/progressive_loading'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip
const sampleCount = 20

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * ratio) - 1]
}

function summarize(samples: number[]): { p50: number; p95: number; min: number; max: number } {
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    min: round(Math.min(...samples)),
    max: round(Math.max(...samples))
  }
}

describe('대형 synthetic HWPX 디코더 기준선', () => {
  benchmark('첫 section과 전체 section 비용을 비교한다', async () => {
    const outputDirectory = process.env.HAN_FLOW_BENCHMARK_OUTPUT
    const directory = outputDirectory ?? mkdtempSync(join(tmpdir(), 'han-flow-benchmark-'))
    try {
      const fixture = createSyntheticHwpx(directory, {
        sectionCount: 80,
        paragraphsPerExtraSection: 250,
        imageBytes: 5 * 1024 * 1024,
        fileName: 'large.hwpx'
      })
      const reader = await HwpxPackageReader.open(fixture)
      const index = await reader.index()

      const firstSectionSamples: number[] = []
      const fullDocumentSamples: number[] = []
      let first: Awaited<ReturnType<typeof decodeViewerDocument>> | undefined
      let full: Awaited<ReturnType<typeof decodeViewerDocument>> | undefined
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const firstStartedAt = performance.now()
        first = await decodeViewerDocument(reader, index, { sectionPaths: [index.sectionPaths[0]] })
        firstSectionSamples.push(performance.now() - firstStartedAt)

        const fullStartedAt = performance.now()
        full = await decodeViewerDocument(reader, index)
        fullDocumentSamples.push(performance.now() - fullStartedAt)
      }

      const firstSection = summarize(firstSectionSamples)
      const fullDocument = summarize(fullDocumentSamples)

      const result = {
        fileBytes: statSync(fixture).size,
        sectionCount: index.sectionPaths.length,
        paragraphCount: full!.sections.reduce((sum, section) => sum + section.blocks.length, 0),
        sampleCount,
        firstSectionMs: firstSection,
        fullDocumentMs: fullDocument,
        p50Speedup: Math.round((fullDocument.p50 / firstSection.p50) * 10) / 10
      }
      console.log('HAN_FLOW_DECODE_BENCHMARK', JSON.stringify(result))

      const largeSectionFixture = createSyntheticHwpx(directory, {
        sectionCount: 2,
        firstSectionExtraParagraphs: 12_000,
        fileName: 'large-section.hwpx'
      })
      const largeSectionIndex = await (await HwpxPackageReader.open(largeSectionFixture)).index()
      console.log('HAN_FLOW_LARGE_SECTION', JSON.stringify({
        sectionCount: largeSectionIndex.sectionPaths.length,
        firstSectionBytes: largeSectionIndex.sectionSizes[largeSectionIndex.sectionPaths[0]],
        progressive: shouldLoadProgressively(largeSectionIndex)
      }))

      expect(first!.sections).toHaveLength(1)
      expect(full!.sections).toHaveLength(80)
      expect(fullDocument.p50).toBeGreaterThan(firstSection.p50)
      expect(largeSectionIndex.sectionPaths).toHaveLength(2)
      expect(shouldLoadProgressively(largeSectionIndex)).toBe(true)
    } finally {
      if (!outputDirectory) rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
