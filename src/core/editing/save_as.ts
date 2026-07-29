import { link, open, unlink } from 'fs/promises'
import { basename, dirname, extname, resolve } from 'path'
import { randomUUID } from 'crypto'
import { HwpxPackageReader } from '../parser/package_reader'
import { HwpxSourcePackage } from '../parser/source_package'
import { decodeViewerDocument } from '../parser/viewer_decoder'

export interface SaveHwpxAsOptions {
  verify?: (savedPackage: HwpxSourcePackage) => Promise<void> | void
}

export interface SaveHwpxAsResult {
  destinationPath: string
  entryCount: number
  revision: number
}

function temporaryPathFor(destinationPath: string): string {
  return resolve(dirname(destinationPath), `.${basename(destinationPath)}.han-flow-${randomUUID()}.tmp`)
}

async function assertPackageIdentity(expected: HwpxSourcePackage, actual: HwpxSourcePackage): Promise<void> {
  const expectedEntries = expected.listEntries()
  const actualEntries = actual.listEntries()
  if (expectedEntries.length !== actualEntries.length) {
    throw new Error('저장 검증 실패: HWPX entry 개수가 변경되었습니다.')
  }

  for (let index = 0; index < expectedEntries.length; index += 1) {
    const expectedEntry = expectedEntries[index]
    const actualEntry = actualEntries[index]
    if (
      expectedEntry.path !== actualEntry.path ||
      expectedEntry.type !== actualEntry.type ||
      expectedEntry.compressionMethod !== actualEntry.compressionMethod ||
      expectedEntry.crc32 !== actualEntry.crc32 ||
      expectedEntry.uncompressedSize !== actualEntry.uncompressedSize
    ) {
      throw new Error(`저장 검증 실패: HWPX entry metadata가 변경되었습니다: ${expectedEntry.path}`)
    }
    if (
      expectedEntry.type === 'file' &&
      !expected.readEntry(expectedEntry.path).equals(actual.readEntry(actualEntry.path))
    ) {
      throw new Error(`저장 검증 실패: HWPX entry 내용이 변경되었습니다: ${expectedEntry.path}`)
    }
  }
}

async function validateWithViewer(filePath: string): Promise<void> {
  const reader = await HwpxPackageReader.open(filePath)
  const index = await reader.index()
  await decodeViewerDocument(reader, index)
}

export async function saveHwpxAs(
  sourcePackage: HwpxSourcePackage,
  destinationPath: string,
  options: SaveHwpxAsOptions = {}
): Promise<SaveHwpxAsResult> {
  const resolvedDestination = resolve(destinationPath)
  if (extname(resolvedDestination).toLowerCase() !== '.hwpx') {
    throw new Error('Save As 목적지는 .hwpx 파일이어야 합니다.')
  }
  if (resolvedDestination === resolve(sourcePackage.sourcePath)) {
    throw new Error('V3-2에서는 원본 파일 덮어쓰기를 허용하지 않습니다.')
  }

  const temporaryPath = temporaryPathFor(resolvedDestination)
  let temporaryExists = false
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    temporaryExists = true
    try {
      await handle.writeFile(sourcePackage.toBuffer())
      await handle.sync()
    } finally {
      await handle.close()
    }

    const reopened = await HwpxSourcePackage.open(temporaryPath)
    await assertPackageIdentity(sourcePackage, reopened)
    await validateWithViewer(temporaryPath)
    await options.verify?.(reopened)

    await link(temporaryPath, resolvedDestination)
    try {
      await unlink(temporaryPath)
      temporaryExists = false
    } catch {
      // 목적지는 이미 완전한 package를 가리킨다. finally에서 임시 이름 정리를 한 번 더 시도한다.
    }
    return {
      destinationPath: resolvedDestination,
      entryCount: reopened.listEntries().length,
      revision: sourcePackage.revision
    }
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}
