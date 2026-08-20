export const MAX_HWPX_ENTRY_COUNT = 10_000
export const MAX_HWPX_ENTRY_BYTES = 128 * 1024 * 1024
export const MAX_HWPX_TOTAL_BYTES = 512 * 1024 * 1024

export type HwpxCompressionMethod = 0 | 8
export type HwpxSourceEntryType = 'file' | 'directory'

export interface HwpxSourceEntryMetadata {
  path: string
  type: HwpxSourceEntryType
  compressionMethod: HwpxCompressionMethod
  crc32: number
  uncompressedSize: number
  encrypted?: boolean
}

function invalidEntry(message: string): never {
  throw new Error(`안전하지 않은 HWPX package입니다: ${message}`)
}

export function validateHwpxEntryPath(path: string, type: HwpxSourceEntryType): void {
  if (!path || path.includes('\0')) invalidEntry('빈 경로나 NUL 문자가 포함된 entry가 있습니다.')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    invalidEntry(`절대 경로 entry를 허용하지 않습니다: ${path}`)
  }
  if (path.includes('\\')) invalidEntry(`역슬래시 경로 entry를 허용하지 않습니다: ${path}`)

  const isDirectoryPath = path.endsWith('/')
  if ((type === 'directory') !== isDirectoryPath) {
    invalidEntry(`entry 종류와 경로가 일치하지 않습니다: ${path}`)
  }

  const segments = path.split('/')
  if (isDirectoryPath) segments.pop()
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    invalidEntry(`경로 탈출 또는 비정규 entry를 허용하지 않습니다: ${path}`)
  }
}

export function validateHwpxSourceEntryMetadata(
  entries: readonly HwpxSourceEntryMetadata[]
): void {
  if (entries.length > MAX_HWPX_ENTRY_COUNT) {
    invalidEntry(`entry 개수가 제한(${MAX_HWPX_ENTRY_COUNT})을 초과합니다.`)
  }

  const paths = new Set<string>()
  let totalBytes = 0
  for (const entry of entries) {
    validateHwpxEntryPath(entry.path, entry.type)
    if (paths.has(entry.path)) invalidEntry(`중복 entry가 있습니다: ${entry.path}`)
    paths.add(entry.path)

    if (entry.encrypted) invalidEntry(`암호화된 entry를 지원하지 않습니다: ${entry.path}`)
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      invalidEntry(`지원하지 않는 압축 방식(${entry.compressionMethod})입니다: ${entry.path}`)
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      invalidEntry(`entry 크기가 올바르지 않습니다: ${entry.path}`)
    }
    if (entry.uncompressedSize > MAX_HWPX_ENTRY_BYTES) {
      invalidEntry(`entry 크기가 제한(${MAX_HWPX_ENTRY_BYTES} bytes)을 초과합니다: ${entry.path}`)
    }
    totalBytes += entry.uncompressedSize
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_HWPX_TOTAL_BYTES) {
      invalidEntry(`압축 해제 전체 크기가 제한(${MAX_HWPX_TOTAL_BYTES} bytes)을 초과합니다.`)
    }
  }
}
