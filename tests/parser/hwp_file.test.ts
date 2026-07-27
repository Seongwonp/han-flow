import * as CFB from 'cfb'
import {
  HwpFileError,
  MAX_HWP_BYTES,
  validateHwpContainer
} from '../../src/main/hwp_file'

interface FixtureOptions {
  signature?: string
  version?: [number, number, number, number]
  flags?: number
  includeFileHeader?: boolean
}

function hwpFixture({
  signature = 'HWP Document File',
  version = [2, 3, 0, 5],
  flags = 0,
  includeFileHeader = true
}: FixtureOptions = {}): Uint8Array {
  const container = CFB.utils.cfb_new()
  if (includeFileHeader) {
    const header = Buffer.alloc(256)
    header.write(signature, 0, 'ascii')
    header.set(version, 32)
    header.writeUInt32LE(flags, 36)
    CFB.utils.cfb_add(container, 'FileHeader', header)
  }
  CFB.utils.cfb_add(container, 'BodyText/Section0', Buffer.from('public fixture'))
  return CFB.write(container, { type: 'buffer' })
}

function expectCode(bytes: Uint8Array, code: string): void {
  expect(() => validateHwpContainer(bytes)).toThrow(expect.objectContaining({ code }))
}

test('HWP 5.x FileHeader의 version과 안전한 flag를 반환한다', () => {
  const result = validateHwpContainer(hwpFixture({
    flags: (1 << 0) | (1 << 3)
  }))
  expect(result).toEqual({
    version: '5.0.3.2',
    flags: {
      compressed: true,
      encrypted: false,
      distribution: false,
      containsScripts: true,
      drm: false
    }
  })
})

test('CFB가 아니거나 손상된 container를 분류한다', () => {
  expectCode(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'HWP_NOT_CFB')
  expectCode(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'HWP_CORRUPTED')
})

test('FileHeader 누락, signature와 지원 version을 구분한다', () => {
  expectCode(hwpFixture({ includeFileHeader: false }), 'HWP_MISSING_FILE_HEADER')
  expectCode(hwpFixture({ signature: 'Not an HWP document' }), 'HWP_NOT_HWP5')
  expectCode(hwpFixture({ version: [0, 0, 0, 4] }), 'HWP_UNSUPPORTED_VERSION')
})

test.each([
  ['HWP_ENCRYPTED', 1 << 1, '암호로 보호된 HWP 문서는 아직 열 수 없습니다.'],
  ['HWP_DISTRIBUTION', 1 << 2, '배포용 HWP 문서는 아직 열 수 없습니다.'],
  ['HWP_DRM', 1 << 4, 'DRM으로 보호된 HWP 문서는 열 수 없습니다.']
])('%s flag를 WASM 전달 전에 거부한다', (code, flags, message) => {
  expect(() => validateHwpContainer(hwpFixture({ flags })))
    .toThrow(expect.objectContaining<HwpFileError>({ code, message }))
})

test('200 MiB를 넘는 입력은 WASM에 전달하기 전에 거부한다', () => {
  expect(() => validateHwpContainer(hwpFixture(), MAX_HWP_BYTES + 1))
    .toThrow(expect.objectContaining({ code: 'HWP_FILE_SIZE' }))
})
