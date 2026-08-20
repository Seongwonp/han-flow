import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  HWPX_MIMETYPE,
  HwpxSourceEntryMetadata,
  HwpxSourcePackage,
  MAX_HWPX_ENTRY_BYTES,
  MAX_HWPX_ENTRY_COUNT,
  MAX_HWPX_TOTAL_BYTES,
  validateHwpxEntryPath,
  validateHwpxSourceEntryMetadata
} from '../../src/core/parser/source_package'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import {
  createRoundTripHwpx,
  roundTripSentinels
} from '../fixtures/public/create_synthetic_hwpx'

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function metadata(path: string): HwpxSourceEntryMetadata {
  return {
    path,
    type: path.endsWith('/') ? 'directory' : 'file',
    compressionMethod: 8,
    crc32: 0,
    uncompressedSize: 1
  }
}

describe('HwpxSourcePackage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-source-package-'))
  const privateFixture = process.env['HAN_FLOW_PRIVATE_HWPX']

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('모든 entry와 unknown XML을 identity round-trip으로 보존한다', async () => {
    const fixture = createRoundTripHwpx(directory)
    const source = await HwpxSourcePackage.open(fixture)
    const sourceEntries = source.listEntries()
    const sourceContent = Object.fromEntries(
      sourceEntries
        .filter((entry) => entry.type === 'file')
        .map((entry) => [entry.path, hash(source.readEntry(entry.path))])
    )

    const output = join(directory, 'han-flow-round-trip-output.hwpx')
    writeFileSync(output, source.toBuffer())
    const reopened = await HwpxSourcePackage.open(output)
    const reopenedEntries = reopened.listEntries()
    const reopenedContent = Object.fromEntries(
      reopenedEntries
        .filter((entry) => entry.type === 'file')
        .map((entry) => [entry.path, hash(reopened.readEntry(entry.path))])
    )

    expect(reopenedEntries).toEqual(sourceEntries)
    expect(reopenedContent).toEqual(sourceContent)
    expect(reopened.readEntry('mimetype').toString()).toBe(HWPX_MIMETYPE)
    expect(reopened.listEntries().find((entry) => entry.path === 'mimetype')?.compressionMethod).toBe(0)
    expect(reopened.readEntry('Unknown/custom.bin')).toEqual(roundTripSentinels.binary)

    const header = reopened.readEntry('Contents/header.xml').toString('utf8')
    const section = reopened.readEntry('Contents/section0.xml').toString('utf8')
    expect(header).toContain(roundTripSentinels.headerAttribute)
    expect(header).toContain(roundTripSentinels.headerNode)
    expect(section).toContain(roundTripSentinels.sectionAttribute)
    expect(section).toContain(roundTripSentinels.sectionNode)

    const reader = await HwpxPackageReader.open(output)
    await expect(reader.index()).resolves.toMatchObject({
      mimetype: HWPX_MIMETYPE,
      headerPath: 'Contents/header.xml',
      sectionPaths: ['Contents/section0.xml']
    })
  })

  ;(privateFixture ? test : test.skip)(
    '비공개 실문서도 본문을 노출하지 않고 identity round-trip한다',
    async () => {
      const source = await HwpxSourcePackage.open(privateFixture!)
      const sourceEntries = source.listEntries()
      const output = join(directory, 'private-round-trip.hwpx')
      writeFileSync(output, source.toBuffer())
      const reopened = await HwpxSourcePackage.open(output)

      expect(reopened.listEntries()).toEqual(sourceEntries)
      for (const entry of sourceEntries) {
        if (entry.type === 'file') {
          expect(hash(reopened.readEntry(entry.path))).toBe(hash(source.readEntry(entry.path)))
        }
      }
    }
  )

  test.each([
    ['/absolute.xml', 'file'],
    ['C:/absolute.xml', 'file'],
    ['../escape.xml', 'file'],
    ['Contents/../escape.xml', 'file'],
    ['./Contents/header.xml', 'file'],
    ['Contents//header.xml', 'file'],
    ['Contents\\header.xml', 'file'],
    ['Contents/header.xml\0suffix', 'file'],
    ['directory', 'directory'],
    ['file/', 'file']
  ] as const)('안전하지 않은 entry 경로를 거부한다: %s', (path, type) => {
    expect(() => validateHwpxEntryPath(path, type)).toThrow('안전하지 않은 HWPX package')
  })

  test('중복 entry와 미지원 압축 방식을 metadata 단계에서 거부한다', () => {
    expect(() =>
      validateHwpxSourceEntryMetadata([
        metadata('Contents/header.xml'),
        metadata('Contents/header.xml')
      ])
    ).toThrow('중복 entry')

    expect(() =>
      validateHwpxSourceEntryMetadata([
        { ...metadata('Contents/header.xml'), compressionMethod: 99 as 8 }
      ])
    ).toThrow('지원하지 않는 압축 방식')

    expect(() =>
      validateHwpxSourceEntryMetadata([
        { ...metadata('Contents/header.xml'), encrypted: true }
      ])
    ).toThrow('암호화된 entry')
  })

  test('entry 개수·개별 크기·전체 압축 해제 크기 제한을 선할당 없이 검증한다', () => {
    expect(() =>
      validateHwpxSourceEntryMetadata(
        Array.from({ length: MAX_HWPX_ENTRY_COUNT + 1 }, (_, index) =>
          metadata(`Contents/entry-${index}.xml`)
        )
      )
    ).toThrow('entry 개수가 제한')

    expect(() =>
      validateHwpxSourceEntryMetadata([
        { ...metadata('Contents/large.xml'), uncompressedSize: MAX_HWPX_ENTRY_BYTES + 1 }
      ])
    ).toThrow('entry 크기가 제한')

    const entryCount = Math.floor(MAX_HWPX_TOTAL_BYTES / MAX_HWPX_ENTRY_BYTES) + 1
    expect(() =>
      validateHwpxSourceEntryMetadata(
        Array.from({ length: entryCount }, (_, index) => ({
          ...metadata(`Contents/large-${index}.xml`),
          uncompressedSize: MAX_HWPX_ENTRY_BYTES
        }))
      )
    ).toThrow('압축 해제 전체 크기가 제한')
  })
})
