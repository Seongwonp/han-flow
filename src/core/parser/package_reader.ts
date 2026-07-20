import * as unzipper from 'unzipper'
import { OrderedXmlNode, parseOrderedXml } from './ordered_xml'

export interface HwpxPackageIndex {
  mimetype: string
  headerPath: string
  sectionPaths: string[]
  resourcePaths: string[]
}

export class HwpxPackageReader {
  private constructor(private readonly directory: unzipper.CentralDirectory) {}

  static async open(filePath: string): Promise<HwpxPackageReader> {
    return new HwpxPackageReader(await unzipper.Open.file(filePath))
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
      resourcePaths: this.directory.files
        .map((file) => file.path)
        .filter((path) => path.startsWith('BinData/'))
        .sort()
    }
  }

  async readOrderedXml(path: string): Promise<OrderedXmlNode[]> {
    return parseOrderedXml(await this.entry(path).buffer())
  }
}
