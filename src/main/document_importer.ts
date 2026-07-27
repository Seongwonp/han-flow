import { Worker } from 'worker_threads'
import {
  DocumentFormat,
  DocumentImportBackgroundError,
  DocumentImportComplete,
  DocumentImportRequest,
  DocumentImportResult
} from '../core/document/document_import'
import { ViewerDocument } from '../core/document/viewer_document'
import { HwpxPackageReader } from '../core/parser/package_reader'
import { shouldLoadProgressively } from '../core/parser/progressive_loading'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'
import { HwpFileError, readHwpContainer } from './hwp_file'

interface DecoderResult {
  document?: ViewerDocument
  decodeMs?: number
  error?: string
}

interface ImportContext {
  senderId: number
  onComplete: (payload: DocumentImportComplete) => void
  onError: (payload: DocumentImportBackgroundError) => void
}

export function documentFormatFromPath(filePath: string): DocumentFormat | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.hwp')) return 'hwp'
  if (lower.endsWith('.hwpx')) return 'hwpx'
  return undefined
}

export class DocumentImporter {
  private readonly decodeWorkers = new Map<number, Worker>()
  private readonly activeLoadIds = new Map<number, string>()

  constructor(private readonly decoderWorkerPath: string) {}

  async importDocument(
    request: DocumentImportRequest,
    context: ImportContext
  ): Promise<DocumentImportResult> {
    const format = documentFormatFromPath(request.filePath)
    if (!format) {
      return {
        ok: false,
        loadId: request.loadId,
        error: {
          code: 'UNSUPPORTED_DOCUMENT_FORMAT',
          message: 'HWP 또는 HWPX 문서만 열 수 있습니다.'
        }
      }
    }

    this.activeLoadIds.set(context.senderId, request.loadId)
    this.stopDecoder(context.senderId)
    if (format === 'hwp') return this.importHwp(request)
    return this.importHwpx(request, context)
  }

  cancel(senderId: number): void {
    this.activeLoadIds.delete(senderId)
    this.stopDecoder(senderId)
  }

  private async importHwp(request: DocumentImportRequest): Promise<DocumentImportResult> {
    try {
      const source = await readHwpContainer(request.filePath)
      return {
        ok: true,
        format: 'hwp',
        loadId: request.loadId,
        bytes: source.bytes,
        timings: { sourceReadMs: source.readMs }
      }
    } catch (error) {
      return {
        ok: false,
        format: 'hwp',
        loadId: request.loadId,
        error: error instanceof HwpFileError
          ? { code: error.code, message: error.message }
          : {
              code: 'HWP_IMPORT_FAILED',
              message: error instanceof Error ? error.message : 'HWP 문서를 읽을 수 없습니다.'
            }
      }
    }
  }

  private async importHwpx(
    request: DocumentImportRequest,
    context: ImportContext
  ): Promise<DocumentImportResult> {
    try {
      const startedAt = performance.now()
      const reader = await HwpxPackageReader.open(request.filePath)
      const packageOpenedAt = performance.now()
      const index = await reader.index()
      const packageIndexedAt = performance.now()
      const progressive = shouldLoadProgressively(index)
      const firstResult = progressive
        ? await this.decodeInWorker(context.senderId, request.filePath, [index.sectionPaths[0]])
        : {
            document: await decodeViewerDocument(reader, index),
            decodeMs: performance.now() - packageIndexedAt
          }
      const decodedAt = performance.now()

      if (progressive && this.isActive(context.senderId, request.loadId)) {
        setImmediate(() => {
          void this.completeHwpx(request, context)
        })
      }
      return {
        ok: true,
        format: 'hwpx',
        loadId: request.loadId,
        document: firstResult.document,
        timings: {
          packageOpenMs: packageOpenedAt - startedAt,
          packageIndexMs: packageIndexedAt - packageOpenedAt,
          decodeMs: firstResult.decodeMs,
          mainTotalMs: decodedAt - startedAt
        },
        sectionCount: index.sectionPaths.length,
        complete: !progressive
      }
    } catch (error) {
      return {
        ok: false,
        format: 'hwpx',
        loadId: request.loadId,
        error: {
          code: 'HWPX_IMPORT_FAILED',
          message: error instanceof Error ? error.message : 'HWPX 문서를 읽을 수 없습니다.'
        }
      }
    }
  }

  private async completeHwpx(
    request: DocumentImportRequest,
    context: ImportContext
  ): Promise<void> {
    try {
      const complete = await this.decodeInWorker(context.senderId, request.filePath)
      if (this.isActive(context.senderId, request.loadId)) {
        context.onComplete({
          format: 'hwpx',
          loadId: request.loadId,
          document: complete.document,
          decodeMs: complete.decodeMs
        })
      }
    } catch (error) {
      if (this.isActive(context.senderId, request.loadId)) {
        context.onError({
          format: 'hwpx',
          loadId: request.loadId,
          error: {
            code: 'HWPX_BACKGROUND_IMPORT_FAILED',
            message: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }
  }

  private isActive(senderId: number, loadId: string): boolean {
    return this.activeLoadIds.get(senderId) === loadId
  }

  private stopDecoder(senderId: number): void {
    const worker = this.decodeWorkers.get(senderId)
    if (worker) void worker.terminate()
    this.decodeWorkers.delete(senderId)
  }

  private decodeInWorker(
    senderId: number,
    filePath: string,
    sectionPaths?: string[]
  ): Promise<{ document: ViewerDocument; decodeMs: number }> {
    this.stopDecoder(senderId)
    const worker = new Worker(this.decoderWorkerPath)
    this.decodeWorkers.set(senderId, worker)
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        if (this.decodeWorkers.get(senderId) === worker) this.decodeWorkers.delete(senderId)
      }
      worker.once('message', (result: DecoderResult) => {
        settled = true
        cleanup()
        void worker.terminate()
        if (result.error || !result.document) {
          reject(new Error(result.error ?? 'worker 디코딩 결과가 없습니다.'))
        } else {
          resolve({ document: result.document, decodeMs: result.decodeMs ?? 0 })
        }
      })
      worker.once('error', (error) => {
        settled = true
        cleanup()
        reject(error)
      })
      worker.once('exit', (code) => {
        cleanup()
        if (!settled && code !== 0) reject(new Error(`worker가 종료되었습니다: ${code}`))
      })
      worker.postMessage({ filePath, sectionPaths })
    })
  }
}
