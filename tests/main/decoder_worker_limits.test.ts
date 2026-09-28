import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  DECODER_WORKER_RESOURCE_LIMITS,
  DECODER_WORKER_TIMEOUT_MS,
  DocumentImporter
} from '../../src/main/document_importer'
import { PROGRESSIVE_SECTION_COUNT } from '../../src/core/parser/progressive_loading'

const SECTION = '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"/>'

function hwpx(path: string, sections: Buffer[]): string {
  const zip = new AdmZip()
  const mimetype = zip.addFile('mimetype', Buffer.from('application/hwp+zip'))
  mimetype.header.method = 0
  zip.addFile('Contents/header.xml', Buffer.from('<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"/>'))
  sections.forEach((section, index) => zip.addFile(`Contents/section${index}.xml`, section))
  zip.writeZip(path)
  return path
}

/** 테스트 전용 CommonJS worker. 실제 decoder 대신 정지·OOM·오류 응답을 재현한다. */
function worker(directory: string, name: string, body: string): string {
  const path = join(directory, `${name}.js`)
  writeFileSync(path, `const { parentPort } = require('worker_threads')\n${body}\n`)
  return path
}

describe('decoder worker 자원 제한', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-worker-limits-'))
  const progressive = hwpx(
    join(directory, 'progressive.hwpx'),
    Array.from({ length: PROGRESSIVE_SECTION_COUNT }, () => Buffer.from(SECTION))
  )
  const stalling = worker(directory, 'stalling', `parentPort.once('message', () => { for (;;) {} })`)
  const firstThenStall = worker(directory, 'first-then-stall', `
parentPort.once('message', ({ sectionPaths }) => {
  if (!sectionPaths) for (;;) {}
  parentPort.postMessage({ document: { sections: [] }, decodeMs: 0 })
})`)
  const hungry = worker(directory, 'hungry', `
parentPort.once('message', () => {
  const retained = []
  for (;;) retained.push(new Array(1_000_000).fill(retained.length))
})`)
  const coded = worker(directory, 'coded', `
parentPort.once('message', () => parentPort.postMessage({
  error: '안전하지 않은 HWPX package입니다: 압축 해제 크기가 선언된 크기(1 bytes)를 초과합니다',
  code: 'HWPX_ENTRY_SIZE_EXCEEDED'
}))`)
  const context = () => ({ senderId: 7, onComplete: jest.fn(), onError: jest.fn() })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('기본 한도는 설정 가능한 상수로 노출한다', () => {
    expect(DECODER_WORKER_TIMEOUT_MS).toBe(120_000)
    expect(DECODER_WORKER_RESOURCE_LIMITS).toMatchObject({ maxOldGenerationSizeMb: 1024 })
  })

  test('멈춘 worker를 wall-clock timeout으로 종료하고 구조화된 오류를 반환한다', async () => {
    const importer = new DocumentImporter(stalling, { decodeTimeoutMs: 200 })
    const ctx = context()
    const startedAt = Date.now()
    const result = await importer.importDocument({ filePath: progressive, loadId: 'stall' }, ctx)
    expect(Date.now() - startedAt).toBeLessThan(10_000)
    expect(result).toMatchObject({
      ok: false,
      format: 'hwpx',
      loadId: 'stall',
      error: { code: 'HWPX_DECODE_TIMEOUT' }
    })
    if (result.ok) throw new Error('timeout이 적용되지 않았습니다.')
    expect(result.error.message).toContain('제한 시간')
    importer.cancel(ctx.senderId)
  })

  test('background 전체 디코딩 timeout도 같은 오류 envelope로 알린다', async () => {
    const importer = new DocumentImporter(firstThenStall, { decodeTimeoutMs: 300 })
    const ctx = context()
    const result = await importer.importDocument({ filePath: progressive, loadId: 'bg' }, ctx)
    expect(result).toMatchObject({ ok: true, format: 'hwpx', complete: false })

    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('background 오류가 오지 않았습니다.')), 10_000)
      ctx.onError.mockImplementation(() => {
        clearTimeout(deadline)
        resolve()
      })
    })
    expect(ctx.onComplete).not.toHaveBeenCalled()
    expect(ctx.onError).toHaveBeenCalledWith({
      format: 'hwpx',
      loadId: 'bg',
      error: { code: 'HWPX_DECODE_TIMEOUT', message: expect.stringContaining('제한 시간') }
    })
    importer.cancel(ctx.senderId)
  })

  // 프로세스 전역 --max-old-space-size(NODE_OPTIONS 포함)가 걸려 있으면 Node가 worker
  // resourceLimits를 무시하므로 그 환경에서는 OOM 재현이 불가능해 건너뛴다.
  const heapFlagPinned =
    /max-old-space-size/.test(process.env.NODE_OPTIONS ?? '') ||
    process.execArgv.some((argument) => argument.includes('max-old-space-size'))
  const oomTest = heapFlagPinned ? test.skip : test
  oomTest('worker heap 한도 초과를 process abort 대신 구조화된 오류로 바꾼다', async () => {
    const importer = new DocumentImporter(hungry, {
      decodeTimeoutMs: 30_000,
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 }
    })
    const ctx = context()
    const result = await importer.importDocument({ filePath: progressive, loadId: 'oom' }, ctx)
    expect(result).toMatchObject({
      ok: false,
      format: 'hwpx',
      loadId: 'oom',
      error: { code: 'HWPX_RESOURCE_EXHAUSTED' }
    })
    if (result.ok) throw new Error('OOM이 구조화되지 않았습니다.')
    expect(result.error.message).toContain('메모리 한도(32 MiB)')
    importer.cancel(ctx.senderId)
  }, 30_000)

  test('worker가 보낸 구조화된 package 오류 code를 보존한다', async () => {
    const importer = new DocumentImporter(coded)
    const ctx = context()
    const result = await importer.importDocument({ filePath: progressive, loadId: 'coded' }, ctx)
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'HWPX_ENTRY_SIZE_EXCEEDED' }
    })
    importer.cancel(ctx.senderId)
  })

  test('main thread 경로의 zip bomb section도 구조화된 code로 반환한다', async () => {
    const path = hwpx(join(directory, 'bomb.hwpx'), [Buffer.alloc(8 * 1024 * 1024, 0x20)])
    const zip = new AdmZip(path)
    // adm-zip으로 쓴 뒤 central directory·local header의 uncompressedSize만 1 KiB로 조작한다.
    const bytes = zip.toBuffer()
    for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
      const nameLength = bytes.readUInt16LE(offset + 28)
      if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString() !== 'Contents/section0.xml') continue
      bytes.writeUInt32LE(1024, offset + 24)
      bytes.writeUInt32LE(1024, bytes.readUInt32LE(offset + 42) + 22)
    }
    writeFileSync(path, bytes)

    const importer = new DocumentImporter(join(directory, 'unused.js'))
    const result = await importer.importDocument({ filePath: path, loadId: 'bomb' }, context())
    expect(result).toMatchObject({
      ok: false,
      format: 'hwpx',
      error: { code: 'HWPX_ENTRY_SIZE_EXCEEDED' }
    })
  })
})
