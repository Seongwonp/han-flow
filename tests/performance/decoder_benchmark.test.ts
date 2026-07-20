import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

const benchmark = process.env.HAN_FLOW_BENCHMARK === '1' ? test : test.skip

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

      const firstStartedAt = performance.now()
      const first = await decodeViewerDocument(reader, index, { sectionPaths: [index.sectionPaths[0]] })
      const firstSectionMs = performance.now() - firstStartedAt

      const fullStartedAt = performance.now()
      const full = await decodeViewerDocument(reader, index)
      const fullDocumentMs = performance.now() - fullStartedAt

      const result = {
        fileBytes: statSync(fixture).size,
        sectionCount: index.sectionPaths.length,
        paragraphCount: full.sections.reduce((sum, section) => sum + section.blocks.length, 0),
        firstSectionMs: Math.round(firstSectionMs * 10) / 10,
        fullDocumentMs: Math.round(fullDocumentMs * 10) / 10,
        speedup: Math.round((fullDocumentMs / firstSectionMs) * 10) / 10
      }
      console.log('HAN_FLOW_DECODE_BENCHMARK', JSON.stringify(result))

      expect(first.sections).toHaveLength(1)
      expect(full.sections).toHaveLength(80)
      expect(fullDocumentMs).toBeGreaterThan(firstSectionMs)
    } finally {
      if (!outputDirectory) rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
