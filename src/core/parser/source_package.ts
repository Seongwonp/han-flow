import AdmZip from 'adm-zip'
import * as unzipper from 'unzipper'
import { parseOrderedXml } from './ordered_xml'
import type { OrderedXmlNode } from './ordered_xml'
import type { HwpxPackageIndex, HwpxReadablePackage } from './package_reader'
import {
  validateHwpxSourceEntryMetadata,
  type HwpxCompressionMethod,
  type HwpxSourceEntryMetadata,
  type HwpxSourceEntryType
} from './package_preflight'

export {
  MAX_HWPX_ENTRY_BYTES,
  MAX_HWPX_ENTRY_COUNT,
  MAX_HWPX_TOTAL_BYTES,
  validateHwpxEntryPath,
  validateHwpxSourceEntryMetadata
} from './package_preflight'
export type {
  HwpxCompressionMethod,
  HwpxSourceEntryMetadata,
  HwpxSourceEntryType
} from './package_preflight'

export const HWPX_MIMETYPE = 'application/hwp+zip'

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
      return {
        path: entry.path,
        type,
        compressionMethod: entry.compressionMethod as HwpxCompressionMethod,
        crc32: entry.crc32,
        uncompressedSize: entry.uncompressedSize,
        encrypted: (entry.flags & 0x1) !== 0
      }
    })
    validateHwpxSourceEntryMetadata(metadata)

    const entries: HwpxSourceEntry[] = []
    for (let index = 0; index < directory.files.length; index += 1) {
      const entry = directory.files[index]
      const entryMetadata = metadata[index]
      const bytes = entryMetadata.type === 'directory' ? Buffer.alloc(0) : await entry.buffer()
      if (bytes.byteLength !== entryMetadata.uncompressedSize) {
        throw new Error(
          `안전하지 않은 HWPX package입니다: 압축 해제 크기가 directory metadata와 다릅니다: ${entryMetadata.path}`
        )
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
