import * as unzipper from 'unzipper'
import { OrderedXmlNode, parseOrderedXml } from './ordered_xml'
import {
  validateHwpxSourceEntryMetadata,
  type HwpxCompressionMethod,
  type HwpxSourceEntryType
} from './package_preflight'

export interface HwpxPackageIndex {
  mimetype: string
  headerPath: string
  sectionPaths: string[]
  sectionSizes: Record<string, number>
  resourcePaths: string[]
}

export interface HwpxReadablePackage {
  index(): Promise<HwpxPackageIndex>
  readOrderedXml(path: string): Promise<OrderedXmlNode[]>
  readBuffer(path: string): Promise<Buffer>
}

export class HwpxPackageReader implements HwpxReadablePackage {
  private constructor(private readonly directory: unzipper.CentralDirectory) {}

  static async open(filePath: string): Promise<HwpxPackageReader> {
    const directory = await unzipper.Open.file(filePath)
    validateHwpxSourceEntryMetadata(directory.files.map((entry) => ({
      path: entry.path,
      type: (entry.type === 'Directory' ? 'directory' : 'file') as HwpxSourceEntryType,
      compressionMethod: entry.compressionMethod as HwpxCompressionMethod,
      crc32: entry.crc32,
      uncompressedSize: entry.uncompressedSize,
      encrypted: (entry.flags & 0x1) !== 0
    })))
    return new HwpxPackageReader(directory)
  }

  private entry(path: string): unzipper.File {
    const found = this.directory.files.find((file) => file.path === path)
    if (!found) throw new Error(`HWPX 필수 항목이 없습니다: ${path}`)
    return found
  }

  async index(): Promise<HwpxPackageIndex> {
    const mimetype = (await this.entry('mimetype').buffer()).toString('utf8').trim()
    if (mimetype !== 'application/hwp+zip') {
      throw new Error(`지원하지 않는 HWPX mimetype입니다: ${mimetype}`)
    }

    const sectionPaths = this.directory.files
      .map((file) => file.path)
      .filter((path) => /^Contents\/section\d+\.xml$/.test(path))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))

    if (sectionPaths.length === 0) throw new Error('HWPX section XML이 없습니다.')
    this.entry('Contents/header.xml')

    return {
      mimetype,
      headerPath: 'Contents/header.xml',
      sectionPaths,
      sectionSizes: Object.fromEntries(sectionPaths.map((path) => {
        const entry = this.entry(path)
        return [path, entry.uncompressedSize]
      })),
      resourcePaths: this.directory.files
        .map((file) => file.path)
        .filter((path) => path.startsWith('BinData/'))
        .sort()
    }
  }

  async readOrderedXml(path: string): Promise<OrderedXmlNode[]> {
    return parseOrderedXml(await this.entry(path).buffer())
  }

  async readBuffer(path: string): Promise<Buffer> {
    return this.entry(path).buffer()
  }
}
