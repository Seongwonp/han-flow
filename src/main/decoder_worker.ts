import { parentPort } from 'worker_threads'
import { HwpxPackageReader } from '../core/parser/package_reader'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'

interface DecodeRequest {
  filePath: string
  sectionPaths?: string[]
}

parentPort?.once('message', async ({ filePath, sectionPaths }: DecodeRequest) => {
  try {
    const startedAt = performance.now()
    const reader = await HwpxPackageReader.open(filePath)
    const index = await reader.index()
    const document = await decodeViewerDocument(reader, index, sectionPaths ? { sectionPaths } : undefined)
    parentPort?.postMessage({ document, decodeMs: performance.now() - startedAt })
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
