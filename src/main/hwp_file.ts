import { readFile, stat } from 'fs/promises'
import * as CFB from 'cfb'

export const MAX_HWP_BYTES = 200 * 1024 * 1024
const CFB_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const HWP_SIGNATURE = 'HWP Document File'

export type HwpFileErrorCode =
  | 'HWP_FILE_SIZE'
  | 'HWP_NOT_CFB'
  | 'HWP_CORRUPTED'
  | 'HWP_MISSING_FILE_HEADER'
  | 'HWP_NOT_HWP5'
  | 'HWP_UNSUPPORTED_VERSION'
  | 'HWP_ENCRYPTED'
  | 'HWP_DISTRIBUTION'
  | 'HWP_DRM'

export class HwpFileError extends Error {
  constructor(
    public readonly code: HwpFileErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'HwpFileError'
  }
}

export interface HwpFileHeader {
  version: string
  flags: {
    compressed: boolean
    encrypted: boolean
    distribution: boolean
    containsScripts: boolean
    drm: boolean
  }
}

export function validateHwpContainer(
  bytes: Uint8Array,
  declaredSize = bytes.byteLength
): HwpFileHeader {
  if (declaredSize < CFB_MAGIC.length || declaredSize > MAX_HWP_BYTES) {
    throw new HwpFileError('HWP_FILE_SIZE', 'HWP 파일 크기는 1 byte 이상 200 MiB 이하여야 합니다.')
  }
  if (!CFB_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new HwpFileError('HWP_NOT_CFB', '올바른 HWP 5.x 컨테이너가 아닙니다.')
  }

  let container: CFB.CFB$Container
  try {
    container = CFB.read(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      { type: 'buffer' }
    )
  } catch {
    throw new HwpFileError('HWP_CORRUPTED', '손상되었거나 올바르지 않은 HWP 문서입니다.')
  }
  const fileHeader = CFB.find(container, 'FileHeader')
  if (!fileHeader?.content || fileHeader.content.length < 40) {
    throw new HwpFileError(
      'HWP_MISSING_FILE_HEADER',
      'HWP FileHeader가 없거나 손상된 문서입니다.'
    )
  }
  const signature = fileHeader.content.subarray(0, 32).toString('ascii').replace(/\0+$/u, '')
  if (signature !== HWP_SIGNATURE) {
    throw new HwpFileError('HWP_NOT_HWP5', 'HWP 5.x 문서 형식이 아닙니다.')
  }

  const versionParts = [
    fileHeader.content[35],
    fileHeader.content[34],
    fileHeader.content[33],
    fileHeader.content[32]
  ]
  const version = versionParts.join('.')
  if (versionParts[0] !== 5) {
    throw new HwpFileError(
      'HWP_UNSUPPORTED_VERSION',
      `지원하지 않는 HWP 버전입니다 (${version}). HWP 5.x 문서만 열 수 있습니다.`
    )
  }

  const flagBits = fileHeader.content.readUInt32LE(36)
  const flags = {
    compressed: Boolean(flagBits & (1 << 0)),
    encrypted: Boolean(flagBits & (1 << 1)),
    distribution: Boolean(flagBits & (1 << 2)),
    containsScripts: Boolean(flagBits & (1 << 3)),
    drm: Boolean(flagBits & (1 << 4))
  }
  if (flags.drm) {
    throw new HwpFileError('HWP_DRM', 'DRM으로 보호된 HWP 문서는 열 수 없습니다.')
  }
  if (flags.distribution) {
    throw new HwpFileError('HWP_DISTRIBUTION', '배포용 HWP 문서는 아직 열 수 없습니다.')
  }
  if (flags.encrypted) {
    throw new HwpFileError('HWP_ENCRYPTED', '암호로 보호된 HWP 문서는 아직 열 수 없습니다.')
  }
  return { version, flags }
}

export async function readHwpContainer(filePath: string): Promise<{ bytes: Buffer; readMs: number }> {
  const startedAt = performance.now()
  const file = await stat(filePath)
  if (!file.isFile()) throw new Error('HWP 파일 경로가 올바르지 않습니다.')
  if (file.size < CFB_MAGIC.length || file.size > MAX_HWP_BYTES) {
    throw new Error('HWP 파일 크기는 200 MiB 이하여야 합니다.')
  }
  const bytes = await readFile(filePath)
  validateHwpContainer(bytes, file.size)
  return { bytes, readMs: performance.now() - startedAt }
}
