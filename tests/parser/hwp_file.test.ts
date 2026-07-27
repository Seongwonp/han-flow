import { MAX_HWP_BYTES, validateHwpContainer } from '../../src/main/hwp_file'

const magic = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

test('CFB magic을 가진 HWP 5.x 입력만 통과시킨다', () => {
  expect(() => validateHwpContainer(magic)).not.toThrow()
  expect(() => validateHwpContainer(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])))
    .toThrow('올바른 HWP 5.x 컨테이너가 아닙니다.')
})

test('200 MiB를 넘는 입력은 WASM에 전달하기 전에 거부한다', () => {
  expect(() => validateHwpContainer(magic, MAX_HWP_BYTES + 1))
    .toThrow('HWP 파일 크기는 200 MiB 이하여야 합니다.')
})
