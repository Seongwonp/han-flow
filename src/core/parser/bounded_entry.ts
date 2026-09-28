import { createReadStream, stat } from 'fs'
import { Transform, Writable, type Readable } from 'stream'
import { pipeline } from 'stream/promises'
import * as unzipper from 'unzipper'
import { MAX_HWPX_ENTRY_BYTES } from './package_preflight'

export type HwpxPackageErrorCode = 'HWPX_ENTRY_SIZE_EXCEEDED' | 'HWPX_ENTRY_SIZE_MISMATCH'

/** 구조화된 HWPX package 안전성 오류. importer가 code를 그대로 renderer에 전달한다. */
export class HwpxPackageError extends Error {
  constructor(readonly code: HwpxPackageErrorCode, message: string) {
    super(message)
    this.name = 'HwpxPackageError'
  }
}

export interface BoundedZipEntry {
  path: string
  stream(password?: string): Readable
}

export interface ReadEntryBoundedOptions {
  /** declared size와 별개로 적용하는 절대 상한. 기본값은 entry 상한이다. */
  cap?: number
  /** 압축 해제된 chunk가 counting transform을 지날 때마다 누적 byte 수를 알린다. */
  onInflate?: (inflatedBytes: number) => void
}

/**
 * central directory의 uncompressedSize를 신뢰하지 않고, 실제 압축 해제 byte를 세면서
 * 상한을 넘는 즉시 stream을 파기한다. 전체 inflate 결과를 메모리에 올리기 전에 중단한다.
 */
export async function readEntryBounded(
  entry: BoundedZipEntry,
  declaredSize: number,
  options: ReadEntryBoundedOptions = {}
): Promise<Buffer> {
  const cap = options.cap ?? MAX_HWPX_ENTRY_BYTES
  const limit = Math.min(declaredSize, cap)
  const chunks: Buffer[] = []
  let inflated = 0

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      inflated += chunk.byteLength
      options.onInflate?.(inflated)
      if (inflated > limit) {
        callback(new HwpxPackageError(
          'HWPX_ENTRY_SIZE_EXCEEDED',
          `안전하지 않은 HWPX package입니다: 압축 해제 크기가 선언된 크기(${limit} bytes)를 초과합니다: ${entry.path}`
        ))
        return
      }
      callback(null, chunk)
    }
  })
  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    }
  })

  // pipeline은 오류 시 모든 stream을 destroy한다. openHwpxZipDirectory가 만든 entry는
  // close 시 원본 파일 stream도 닫으므로 abort 경로에서 fd가 남지 않는다.
  await pipeline(entry.stream(), counter, collector)

  const bytes = Buffer.concat(chunks, inflated)
  if (bytes.byteLength !== declaredSize) {
    throw new HwpxPackageError(
      'HWPX_ENTRY_SIZE_MISMATCH',
      `안전하지 않은 HWPX package입니다: 압축 해제 크기가 directory metadata와 다릅니다: ${entry.path}`
    )
  }
  return bytes
}

/**
 * unzipper.Open.file과 같은 source를 쓰되, entry stream이 닫힐 때(정상 종료·abort 모두)
 * 해당 entry를 위해 연 파일 read stream을 함께 destroy한다.
 */
export async function openHwpxZipDirectory(filePath: string): Promise<unzipper.CentralDirectory> {
  const opened: { last?: Readable } = {}
  const source = {
    stream(start: number, length?: number): Readable {
      const end = length ? start + length : undefined
      const stream = createReadStream(filePath, { start, end })
      opened.last = stream
      return stream
    },
    size(): Promise<number> {
      return new Promise((resolve, reject) => {
        stat(filePath, (error, stats) => (error ? reject(error) : resolve(stats.size)))
      })
    }
  }
  const directory = await unzipper.Open.custom(source)
  for (const file of directory.files) {
    const openEntry = file.stream.bind(file)
    file.stream = (password?: string) => {
      opened.last = undefined
      const output: Readable = openEntry(password)
      const raw = opened.last as Readable | undefined
      opened.last = undefined
      if (raw) output.once('close', () => raw.destroy())
      return output
    }
  }
  return directory
}
