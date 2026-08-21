import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ImageResourceBudget,
  ImageResourceLimits,
  validateXmlResourceBudget,
  XmlResourceLimits
} from '../../src/core/parser/resource_budget'
import { DocumentImporter } from '../../src/main/document_importer'

const xmlLimits: XmlResourceLimits = {
  maxDepth: 3,
  maxNodes: 5,
  maxTextCharacters: 10
}

const imageLimits: ImageResourceLimits = {
  maxCount: 2,
  maxBytesPerResource: 64,
  maxTotalBytes: 96,
  maxDimension: 100,
  maxPixelsPerImage: 5_000,
  maxTotalPixels: 6_000
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  Buffer.from('IHDR').copy(bytes, 12)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

describe('HWPX XML resource budget', () => {
  test('정상 XML의 주석·CDATA·따옴표 안 > 문자를 구분한다', () => {
    expect(validateXmlResourceBudget('<?xml version="1.0"?><a x=">"><!--x--><b><![CDATA[123]]></b></a>', xmlLimits))
      .toContain('<![CDATA[123]]>')
  })

  test.each([
    ['깊이', '<a><b><c><d></d></c></b></a>', '깊이가 제한'],
    ['node', '<a><b/><c/><d/><e/><f/></a>', 'node 수가 제한'],
    ['text', '<a>12345678901</a>', 'text 크기가 제한'],
    ['DOCTYPE', '<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>', 'DOCTYPE 선언을 허용하지 않습니다']
  ])('%s 예산 초과를 파싱 전에 거부한다', (_name, xml, message) => {
    expect(() => validateXmlResourceBudget(xml, xmlLimits)).toThrow(message)
  })
})

describe('HWPX image resource budget', () => {
  test('정상 PNG header의 decoded pixel을 누적한다', () => {
    const budget = new ImageResourceBudget(imageLimits)
    budget.add('BinData/a.png', png(50, 50))
    budget.add('BinData/b.png', png(50, 50))
  })

  test('가로·세로와 개별 decoded pixel 폭탄을 거부한다', () => {
    expect(() => new ImageResourceBudget(imageLimits).add('BinData/wide.png', png(101, 1)))
      .toThrow('이미지 가로·세로가 제한')
    expect(() => new ImageResourceBudget(imageLimits).add('BinData/bomb.png', png(80, 80)))
      .toThrow('decoded pixel 수가 제한')
  })

  test('전체 decoded pixel과 resource 개수·바이트 예산을 누적한다', () => {
    const pixels = new ImageResourceBudget(imageLimits)
    pixels.add('BinData/a.png', png(60, 50))
    expect(() => pixels.add('BinData/b.png', png(61, 50))).toThrow('전체 이미지 decoded pixel 수')

    const count = new ImageResourceBudget(imageLimits)
    count.add('BinData/a.bin', Buffer.alloc(1))
    count.add('BinData/b.bin', Buffer.alloc(1))
    expect(() => count.add('BinData/c.bin', Buffer.alloc(1))).toThrow('개수가 제한')

    expect(() => new ImageResourceBudget(imageLimits).add('BinData/a.bin', Buffer.alloc(65)))
      .toThrow('개별 크기가 제한')
  })

  test('확장자와 맞지 않는 손상 raster header를 거부한다', () => {
    expect(() => new ImageResourceBudget(imageLimits).add('BinData/broken.png', Buffer.alloc(24)))
      .toThrow('이미지 header가 올바르지 않습니다')
  })
})

describe('HWPX adversarial package import', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-resource-budget-'))
  const importer = new DocumentImporter(join(directory, 'unused-worker.js'))
  const context = { senderId: 91, onComplete: jest.fn(), onError: jest.fn() }

  function packagePath(fileName: string, section: string, resource?: Buffer): string {
    const path = join(directory, fileName)
    const zip = new AdmZip()
    const mimetype = zip.addFile('mimetype', Buffer.from('application/hwp+zip'))
    mimetype.header.method = 0
    zip.addFile(
      'Contents/header.xml',
      Buffer.from('<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>')
    )
    zip.addFile('Contents/section0.xml', Buffer.from(section))
    if (resource) zip.addFile('BinData/bomb.png', resource)
    zip.writeZip(path)
    return path
  }

  afterAll(() => {
    importer.cancel(context.senderId)
    rmSync(directory, { recursive: true, force: true })
  })

  test('깊이 폭탄 package를 구조화된 가져오기 오류로 종료한다', async () => {
    const depth = 257
    const section = `<hs:sec xmlns:hs="urn:han-flow:section">${'<x>'.repeat(depth)}${'</x>'.repeat(depth)}</hs:sec>`
    const result = await importer.importDocument(
      { filePath: packagePath('deep.hwpx', section), loadId: 'deep' },
      context
    )

    expect(result).toMatchObject({
      ok: false,
      format: 'hwpx',
      error: { code: 'HWPX_IMPORT_FAILED' }
    })
    if (result.ok) throw new Error('깊이 폭탄 package가 허용됐습니다.')
    expect(result.error.message).toContain('깊이가 제한')
  })

  test('decoded dimension 폭탄 package를 구조화된 가져오기 오류로 종료한다', async () => {
    const section = '<hs:sec xmlns:hs="urn:han-flow:section"/>'
    const result = await importer.importDocument(
      { filePath: packagePath('image-bomb.hwpx', section, png(40_000, 2)), loadId: 'image' },
      context
    )

    expect(result).toMatchObject({
      ok: false,
      format: 'hwpx',
      error: { code: 'HWPX_IMPORT_FAILED' }
    })
    if (result.ok) throw new Error('이미지 dimension 폭탄 package가 허용됐습니다.')
    expect(result.error.message).toContain('이미지 가로·세로가 제한')
  })
})
