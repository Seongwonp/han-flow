import AdmZip from 'adm-zip'
import * as unzipper from 'unzipper'
import { parseOrderedXml } from './ordered_xml'
import type { OrderedXmlNode } from './ordered_xml'
import type { HwpxPackageIndex, HwpxReadablePackage } from './package_reader'

export const HWPX_MIMETYPE = 'application/hwp+zip'
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
}

interface HwpxSourceEntry extends HwpxSourceEntryMetadata {
  bytes: Buffer
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return crc >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
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

export function validateHwpxSourceEntryMetadata(entries: readonly HwpxSourceEntryMetadata[]): void {
  if (entries.length > MAX_HWPX_ENTRY_COUNT) {
    invalidEntry(`entry 개수가 제한(${MAX_HWPX_ENTRY_COUNT})을 초과합니다.`)
  }

  const paths = new Set<string>()
  let totalBytes = 0
  for (const entry of entries) {
    validateHwpxEntryPath(entry.path, entry.type)
    if (paths.has(entry.path)) invalidEntry(`중복 entry가 있습니다: ${entry.path}`)
    paths.add(entry.path)

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

function validateRequiredEntries(entries: readonly HwpxSourceEntry[]): void {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const mimetype = byPath.get('mimetype')
  if (!mimetype || mimetype.type !== 'file') {
    throw new Error('HWPX 필수 항목이 없습니다: mimetype')
  }
  if (mimetype.compressionMethod !== 0) {
    throw new Error('HWPX mimetype entry는 압축하지 않고 저장해야 합니다.')
  }
  if (!mimetype.bytes.equals(Buffer.from(HWPX_MIMETYPE))) {
    throw new Error(`지원하지 않는 HWPX mimetype입니다: ${mimetype.bytes.toString('utf8')}`)
  }
  if (!byPath.has('Contents/header.xml')) {
    throw new Error('HWPX 필수 항목이 없습니다: Contents/header.xml')
  }
  if (![...byPath.keys()].some((path) => /^Contents\/section\d+\.xml$/.test(path))) {
    throw new Error('HWPX section XML이 없습니다.')
  }
}

export class HwpxSourcePackage implements HwpxReadablePackage {
  private constructor(
    readonly sourcePath: string,
    private readonly sourceEntries: readonly HwpxSourceEntry[],
    readonly revision: number
  ) {}

  static async open(filePath: string): Promise<HwpxSourcePackage> {
    const directory = await unzipper.Open.file(filePath)
    const metadata = directory.files.map((entry) => {
      const type: HwpxSourceEntryType = entry.type === 'Directory' ? 'directory' : 'file'
      if ((entry.flags & 0x1) !== 0) invalidEntry(`암호화된 entry를 지원하지 않습니다: ${entry.path}`)
      return {
        path: entry.path,
        type,
        compressionMethod: entry.compressionMethod as HwpxCompressionMethod,
        crc32: entry.crc32,
        uncompressedSize: entry.uncompressedSize
      }
    })
    validateHwpxSourceEntryMetadata(metadata)

    const entries: HwpxSourceEntry[] = []
    for (let index = 0; index < directory.files.length; index += 1) {
      const entry = directory.files[index]
      const entryMetadata = metadata[index]
      const bytes = entryMetadata.type === 'directory' ? Buffer.alloc(0) : await entry.buffer()
      if (bytes.byteLength !== entryMetadata.uncompressedSize) {
        invalidEntry(`압축 해제 크기가 directory metadata와 다릅니다: ${entryMetadata.path}`)
      }
      entries.push({ ...entryMetadata, bytes })
    }
    validateRequiredEntries(entries)
    return new HwpxSourcePackage(filePath, entries, 0)
  }

  listEntries(): readonly HwpxSourceEntryMetadata[] {
    return this.sourceEntries.map(({ bytes: _bytes, ...metadata }) => ({ ...metadata }))
  }

  readEntry(path: string): Buffer {
    const entry = this.sourceEntries.find((candidate) => candidate.path === path)
    if (!entry || entry.type !== 'file') throw new Error(`HWPX entry가 없습니다: ${path}`)
    return Buffer.from(entry.bytes)
  }

  async index(): Promise<HwpxPackageIndex> {
    const entries = this.listEntries()
    const sectionPaths = entries
      .map((entry) => entry.path)
      .filter((path) => /^Contents\/section\d+\.xml$/.test(path))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    return {
      mimetype: HWPX_MIMETYPE,
      headerPath: 'Contents/header.xml',
      sectionPaths,
      sectionSizes: Object.fromEntries(
        sectionPaths.map((path) => [
          path,
          entries.find((entry) => entry.path === path)?.uncompressedSize ?? 0
        ])
      ),
      resourcePaths: entries
        .map((entry) => entry.path)
        .filter((path) => path.startsWith('BinData/') && !path.endsWith('/'))
        .sort()
    }
  }

  async readOrderedXml(path: string): Promise<OrderedXmlNode[]> {
    return parseOrderedXml(this.readEntry(path))
  }

  async readBuffer(path: string): Promise<Buffer> {
    return this.readEntry(path)
  }

  withEntry(path: string, bytes: Buffer): HwpxSourcePackage {
    const entryIndex = this.sourceEntries.findIndex((candidate) => candidate.path === path)
    if (entryIndex < 0 || this.sourceEntries[entryIndex].type !== 'file') {
      throw new Error(`HWPX entry가 없습니다: ${path}`)
    }
    const current = this.sourceEntries[entryIndex]
    if (current.bytes.equals(bytes)) return this

    const replacement: HwpxSourceEntry = {
      ...current,
      bytes: Buffer.from(bytes),
      crc32: crc32(bytes),
      uncompressedSize: bytes.byteLength
    }
    const entries = this.sourceEntries.map((entry, index) => (index === entryIndex ? replacement : entry))
    validateHwpxSourceEntryMetadata(entries)
    validateRequiredEntries(entries)
    return new HwpxSourcePackage(this.sourcePath, entries, this.revision + 1)
  }

  toBuffer(): Buffer {
    const zip = new AdmZip(undefined, { noSort: true })
    for (const sourceEntry of this.sourceEntries) {
      const entry = zip.addFile(sourceEntry.path, Buffer.from(sourceEntry.bytes))
      entry.header.method = sourceEntry.compressionMethod
    }
    return zip.toBuffer()
  }
}
