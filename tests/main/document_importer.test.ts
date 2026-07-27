import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { DocumentImporter, documentFormatFromPath } from '../../src/main/document_importer'
import { createSyntheticHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('문서 가져오기 경계', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'han-flow-importer-'))
  const hwpxFixture = createSyntheticHwpx(directory)
  const hwpFixture = resolve(__dirname, '../fixtures/public/synthetic-layout.hwp')
  const importer = new DocumentImporter(resolve(directory, 'unused-decoder-worker.js'))
  const context = {
    senderId: 1,
    onComplete: jest.fn(),
    onError: jest.fn()
  }

  afterAll(() => {
    importer.cancel(context.senderId)
    rmSync(directory, { recursive: true, force: true })
  })

  test('확장자를 대소문자와 무관하게 식별한다', () => {
    expect(documentFormatFromPath('/tmp/document.HWP')).toBe('hwp')
    expect(documentFormatFromPath('/tmp/document.HwPx')).toBe('hwpx')
    expect(documentFormatFromPath('/tmp/document.pdf')).toBeUndefined()
  })

  test('지원하지 않는 형식은 공통 오류 계약으로 반환한다', async () => {
    await expect(importer.importDocument(
      { filePath: '/tmp/document.pdf', loadId: 'unsupported' },
      context
    )).resolves.toEqual({
      ok: false,
      loadId: 'unsupported',
      error: {
        code: 'UNSUPPORTED_DOCUMENT_FORMAT',
        message: 'HWP 또는 HWPX 문서만 열 수 있습니다.'
      }
    })
  })

  test('HWP 컨테이너를 검증하고 renderer 전달용 바이트를 반환한다', async () => {
    const result = await importer.importDocument(
      { filePath: hwpFixture, loadId: 'hwp' },
      context
    )

    expect(result).toMatchObject({
      ok: true,
      format: 'hwp',
      loadId: 'hwp'
    })
    if (!result.ok || result.format !== 'hwp') throw new Error('HWP 가져오기에 실패했습니다.')
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.timings.sourceReadMs).toBeGreaterThanOrEqual(0)
  })

  test('HWPX를 동일한 계약의 ViewerDocument로 반환한다', async () => {
    const result = await importer.importDocument(
      { filePath: hwpxFixture, loadId: 'hwpx' },
      context
    )

    expect(result).toMatchObject({
      ok: true,
      format: 'hwpx',
      loadId: 'hwpx',
      complete: true,
      sectionCount: 2
    })
    if (!result.ok || result.format !== 'hwpx') throw new Error('HWPX 가져오기에 실패했습니다.')
    expect(result.document.sections).toHaveLength(2)
    expect(result.timings.mainTotalMs).toBeGreaterThanOrEqual(0)
    expect(context.onComplete).not.toHaveBeenCalled()
    expect(context.onError).not.toHaveBeenCalled()
  })
})
