import AdmZip from 'adm-zip'
import { randomBytes } from 'crypto'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  HwpxPackageError,
  openHwpxZipDirectory,
  readEntryBounded
} from '../../src/core/parser/bounded_entry'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'

const BOMB_PATH = 'BinData/bomb.bin'
const BOMB_BYTES = 8 * 1024 * 1024
const DECLARED_BYTES = 1024
const SECTION = '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"/>'

/**
 * adm-zip으로 정상 ZIP을 만든 뒤, 지정 entry의 central directory header(offset 24)와
 * local file header(offset 22)의 uncompressedSize만 작게 덮어쓴다. compressedSize와
 * deflate stream은 그대로이므로 실제 압축 해제 결과는 원래 크기(8 MiB)까지 부푼다.
 */
function patchDeclaredSize(zip: Buffer, path: string, declared: number): Buffer {
  const patched = Buffer.from(zip)
  let found = false
  for (let offset = 0; offset + 46 <= patched.length; offset += 1) {
    if (patched.readUInt32LE(offset) !== 0x02014b50) continue
    const nameLength = patched.readUInt16LE(offset + 28)
    const name = patched.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (name !== path) continue
    patched.writeUInt32LE(declared, offset + 24)
    const localHeader = patched.readUInt32LE(offset + 42)
    if (patched.readUInt32LE(localHeader) !== 0x04034b50) throw new Error('local header가 없습니다.')
    patched.writeUInt32LE(declared, localHeader + 22)
    found = true
  }
  if (!found) throw new Error(`central directory entry가 없습니다: ${path}`)
  return patched
}

function hwpxZip(extra?: Buffer): Buffer {
  const zip = new AdmZip()
  const mimetype = zip.addFile('mimetype', Buffer.from('application/hwp+zip'))
  mimetype.header.method = 0
  zip.addFile('Contents/header.xml', Buffer.from('<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>'))
  zip.addFile('Contents/section0.xml', Buffer.from(SECTION))
  if (extra) zip.addFile(BOMB_PATH, extra)
  return zip.toBuffer()
}

function openFdCount(): number | undefined {
  try {
    return readdirSync('/proc/self/fd').length
  } catch {
    return undefined
  }
}

describe('bounded ZIP entry inflation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-bounded-entry-'))
  const bombPath = join(directory, 'zip-bomb.hwpx')
  const normalPath = join(directory, 'normal.hwpx')
  const shortPath = join(directory, 'short.hwpx')
  const leakPath = join(directory, 'leak.hwpx')
  const zeros = Buffer.alloc(BOMB_BYTES)

  beforeAll(() => {
    const bomb = patchDeclaredSize(hwpxZip(zeros), BOMB_PATH, DECLARED_BYTES)
    // 8 MiB의 0은 수 KiB로 압축되어야 "작은 파일이 크게 부푸는" 조건이 된다.
    expect(bomb.byteLength).toBeLessThan(64 * 1024)
    writeFileSync(bombPath, bomb)
    writeFileSync(normalPath, hwpxZip(Buffer.from('정상 resource')))
    writeFileSync(leakPath, patchDeclaredSize(hwpxZip(randomBytes(4 * 1024 * 1024)), BOMB_PATH, DECLARED_BYTES))
    writeFileSync(shortPath, patchDeclaredSize(hwpxZip(Buffer.alloc(100)), BOMB_PATH, 200))
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('선언 크기를 넘는 즉시 counting transform에서 중단한다', async () => {
    const zip = await openHwpxZipDirectory(bombPath)
    const entry = zip.files.find((file) => file.path === BOMB_PATH)
    if (!entry) throw new Error('bomb entry가 없습니다.')
    expect(entry.uncompressedSize).toBe(DECLARED_BYTES)

    const observed: number[] = []
    const read = readEntryBounded(entry, entry.uncompressedSize, {
      onInflate: (bytes) => observed.push(bytes)
    })
    await expect(read).rejects.toBeInstanceOf(HwpxPackageError)
    await expect(read).rejects.toMatchObject({ code: 'HWPX_ENTRY_SIZE_EXCEEDED' })

    // 첫 초과 chunk 이후로는 더 이상 inflate 결과를 받지 않는다(zlib chunk는 최대 64 KiB).
    const maxObserved = Math.max(...observed)
    expect(maxObserved).toBeGreaterThan(DECLARED_BYTES)
    expect(maxObserved).toBeLessThanOrEqual(DECLARED_BYTES + 64 * 1024)
    expect(observed.filter((bytes) => bytes > DECLARED_BYTES)).toHaveLength(1)
  })

  test('abort 시 아직 읽는 중인 원본 파일 stream을 닫아 fd를 남기지 않는다', async () => {
    // 압축되지 않는 4 MiB entry는 fs read stream이 끝까지 읽기 전에 abort되므로,
    // 원본 stream을 명시적으로 destroy하지 않으면 fd가 열린 채 남는다.
    const zip = await openHwpxZipDirectory(leakPath)
    const entry = zip.files.find((file) => file.path === BOMB_PATH)
    if (!entry) throw new Error('entry가 없습니다.')
    const fdsBefore = openFdCount()
    if (fdsBefore === undefined) return
    await expect(readEntryBounded(entry, entry.uncompressedSize))
      .rejects.toMatchObject({ code: 'HWPX_ENTRY_SIZE_EXCEEDED' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(openFdCount()).toBeLessThanOrEqual(fdsBefore)
  })

  test('작은 global cap도 선언 크기보다 먼저 적용한다', async () => {
    const zip = await openHwpxZipDirectory(normalPath)
    const entry = zip.files.find((file) => file.path === 'Contents/section0.xml')
    if (!entry) throw new Error('section entry가 없습니다.')
    await expect(readEntryBounded(entry, entry.uncompressedSize, { cap: 8 }))
      .rejects.toMatchObject({ code: 'HWPX_ENTRY_SIZE_EXCEEDED' })
  })

  test('viewer reader는 zip bomb entry를 구조화된 오류로 거부한다', async () => {
    const reader = await HwpxPackageReader.open(bombPath)
    await expect(reader.index()).resolves.toMatchObject({ sectionPaths: ['Contents/section0.xml'] })
    await expect(reader.readBuffer(BOMB_PATH)).rejects.toMatchObject({
      name: 'HwpxPackageError',
      code: 'HWPX_ENTRY_SIZE_EXCEEDED'
    })
  })

  test('editing source package는 zip bomb entry를 구조화된 오류로 거부한다', async () => {
    await expect(HwpxSourcePackage.open(bombPath)).rejects.toMatchObject({
      code: 'HWPX_ENTRY_SIZE_EXCEEDED'
    })
  })

  test('선언보다 짧게 풀리는 entry는 사후 크기 검사로 거부한다', async () => {
    const reader = await HwpxPackageReader.open(shortPath)
    await expect(reader.readBuffer(BOMB_PATH)).rejects.toMatchObject({
      code: 'HWPX_ENTRY_SIZE_MISMATCH'
    })
  })

  test('올바르게 선언된 entry는 그대로 읽는다', async () => {
    const reader = await HwpxPackageReader.open(normalPath)
    await expect(reader.readBuffer(BOMB_PATH)).resolves.toEqual(Buffer.from('정상 resource'))
    await expect(reader.readOrderedXml('Contents/section0.xml')).resolves.toHaveLength(1)

    const source = await HwpxSourcePackage.open(normalPath)
    expect(source.readEntry(BOMB_PATH)).toEqual(Buffer.from('정상 resource'))
    expect(source.readEntry('Contents/section0.xml').toString('utf8')).toBe(SECTION)
  })
})
