import { Worker, type ResourceLimits } from 'worker_threads'
import {
  DocumentFormat,
  DocumentImportBackgroundError,
  DocumentImportComplete,
  DocumentImportError,
  DocumentImportRequest,
  DocumentImportResult
} from '../core/document/document_import'
import { ViewerDocument } from '../core/document/viewer_document'
import { HwpxPackageReader } from '../core/parser/package_reader'
import { shouldLoadProgressively } from '../core/parser/progressive_loading'
import { HwpFileError, readHwpContainer } from './hwp_file'

interface DecoderResult {
  document?: ViewerDocument
  decodeMs?: number
  error?: string
  code?: string
}

/*
 * decoder worker 한도. 모든 HWPX 디코딩은 main thread가 아니라 이 한도를 건 worker에서 실행한다.
 * 한 번 열 때 worker 요청은 최대 두 번이다(progressive면 첫 section 요청과 background 전체 요청,
 * 아니면 전체 요청 한 번). 두 상수는 요청마다 따로 적용되며, 첫 요청이 쓴 시간은 background 요청의
 * 예산에서 빼지 않는다.
 */

/** worker 요청 하나(첫 section 또는 전체 디코딩)에 허용하는 wall-clock 시간. */
export const DECODER_WORKER_TIMEOUT_MS = 120_000

/** worker 요청 하나의 heap 한도. 초과 시 process 전체 abort 대신 ERR_WORKER_OUT_OF_MEMORY로 끝난다. */
export const DECODER_WORKER_RESOURCE_LIMITS: ResourceLimits = {
  maxOldGenerationSizeMb: 1024,
  maxYoungGenerationSizeMb: 64
}

export interface DocumentImporterOptions {
  decodeTimeoutMs?: number
  resourceLimits?: ResourceLimits
}

/** renderer에 그대로 전달할 code를 가진 가져오기 오류. */
export class DocumentImportCodedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DocumentImportCodedError'
  }
}

function structuredCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code: unknown }).code
  return typeof code === 'string' && /^HWPX_[A-Z_]+$/.test(code) ? code : undefined
}

function importError(error: unknown, fallbackCode: string, fallbackMessage: string): DocumentImportError {
  return {
    code: structuredCode(error) ?? fallbackCode,
    message: error instanceof Error ? error.message : (error === undefined ? fallbackMessage : String(error))
  }
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

  private readonly decodeTimeoutMs: number
  private readonly resourceLimits: ResourceLimits

  constructor(
    private readonly decoderWorkerPath: string,
    options: DocumentImporterOptions = {}
  ) {
    this.decodeTimeoutMs = options.decodeTimeoutMs ?? DECODER_WORKER_TIMEOUT_MS
    this.resourceLimits = options.resourceLimits ?? DECODER_WORKER_RESOURCE_LIMITS
  }

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
      // main thread는 package index만 읽고, section 디코딩은 크기와 무관하게 한도를 건 worker에서 한다.
      const firstResult = await this.decodeInWorker(
        context.senderId,
        request.filePath,
        progressive ? [index.sectionPaths[0]] : undefined
      )
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
        error: importError(error, 'HWPX_IMPORT_FAILED', 'HWPX 문서를 읽을 수 없습니다.')
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
          error: importError(error, 'HWPX_BACKGROUND_IMPORT_FAILED', 'HWPX 문서를 읽을 수 없습니다.')
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
    const worker = new Worker(this.decoderWorkerPath, { resourceLimits: this.resourceLimits })
    this.decodeWorkers.set(senderId, worker)
    return new Promise((resolve, reject) => {
      let settled = false
      // 현재 protocol에는 진행 이벤트가 없으므로 이 요청 전체에 하나의 deadline을 적용한다.
      // 요청마다 새 timer를 만들므로 첫 section 요청과 background 요청은 각각 전체 예산을 받는다.
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        void worker.terminate()
        reject(new DocumentImportCodedError(
          'HWPX_DECODE_TIMEOUT',
          `문서 해석이 제한 시간(${Math.ceil(this.decodeTimeoutMs / 1000)}초)을 넘어 중단했습니다. 문서가 지나치게 복잡하거나 손상되었을 수 있습니다.`
        ))
      }, this.decodeTimeoutMs)
      const cleanup = () => {
        clearTimeout(timeout)
        if (this.decodeWorkers.get(senderId) === worker) this.decodeWorkers.delete(senderId)
      }
      worker.once('message', (result: DecoderResult) => {
        if (settled) return
        settled = true
        cleanup()
        void worker.terminate()
        if (result.error || !result.document) {
          const message = result.error ?? 'worker 디코딩 결과가 없습니다.'
          reject(result.code ? new DocumentImportCodedError(result.code, message) : new Error(message))
        } else {
          resolve({ document: result.document, decodeMs: result.decodeMs ?? 0 })
        }
      })
      worker.once('error', (error: Error & { code?: string }) => {
        if (settled) return
        settled = true
        cleanup()
        if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
          const limit = this.resourceLimits.maxOldGenerationSizeMb
          reject(new DocumentImportCodedError(
            'HWPX_RESOURCE_EXHAUSTED',
            `문서 해석 중 메모리 한도${limit ? `(${limit} MiB)` : ''}를 넘어 중단했습니다. 문서가 지나치게 크거나 손상되었을 수 있습니다.`
          ))
        } else {
          reject(error)
        }
      })
      worker.once('exit', (code) => {
        const wasSettled = settled
        settled = true
        cleanup()
        if (!wasSettled) reject(new Error(`worker가 결과 없이 종료되었습니다: ${code}`))
      })
      worker.postMessage({ filePath, sectionPaths })
    })
  }
}
