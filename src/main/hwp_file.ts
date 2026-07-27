import { readFile, stat } from 'fs/promises'

export const MAX_HWP_BYTES = 200 * 1024 * 1024
const CFB_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export function validateHwpContainer(bytes: Uint8Array, declaredSize = bytes.byteLength): void {
  if (declaredSize < CFB_MAGIC.length || declaredSize > MAX_HWP_BYTES) {
    throw new Error('HWP 파일 크기는 200 MiB 이하여야 합니다.')
  }
  if (!CFB_MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error('올바른 HWP 5.x 컨테이너가 아닙니다.')
  }
}

export async function readHwpContainer(filePath: string): Promise<{ bytes: Buffer; readMs: number }> {
  const startedAt = performance.now()
  const file = await stat(filePath)
  if (!file.isFile()) throw new Error('HWP 파일 경로가 올바르지 않습니다.')
  if (file.size < CFB_MAGIC.length || file.size > MAX_HWP_BYTES) {
    throw new Error('HWP 파일 크기는 200 MiB 이하여야 합니다.')
  }
  const bytes = await readFile(filePath)
  validateHwpContainer(bytes, file.size)
  return { bytes, readMs: performance.now() - startedAt }
}
