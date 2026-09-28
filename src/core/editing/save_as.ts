import { lstat, open, rename, stat, unlink } from 'fs/promises'
import type { Stats } from 'fs'
import { basename, dirname, extname, resolve } from 'path'
import { randomUUID } from 'crypto'
import { HwpxPackageReader } from '../parser/package_reader'
import { HwpxSourcePackage } from '../parser/source_package'
import { decodeViewerDocument } from '../parser/viewer_decoder'

export interface SaveHwpxAsOptions {
  verify?: (savedPackage: HwpxSourcePackage) => Promise<void> | void
  /**
   * 이미 존재하는 목적지를 교체할지 여부. 사용자가 OS 저장 대화상자에서 교체를 확인한 경우에만 true로 넘긴다.
   * 원본(sourcePath)과 protectedPaths는 이 값과 무관하게 절대 덮어쓰지 않는다.
   */
  overwrite?: boolean
  /** 원본 외에 덮어쓰면 안 되는 경로(예: 다른 편집 session의 원본). */
  protectedPaths?: readonly string[]
}

export interface SaveHwpxAsResult {
  destinationPath: string
  entryCount: number
  revision: number
  replacedExisting: boolean
}

export type HwpxSaveAsErrorCode =
  | 'HWPX_SAVE_INVALID_DESTINATION'
  | 'HWPX_SAVE_PROTECTED_DESTINATION'
  | 'HWPX_SAVE_DESTINATION_EXISTS'
  | 'HWPX_SAVE_FILESYSTEM'

export class HwpxSaveAsError extends Error {
  constructor(
    readonly code: HwpxSaveAsErrorCode,
    message: string,
    /** 파일 시스템 실패일 때 원인 errno 코드(EACCES, EPERM, EXDEV, ENOSPC 등). */
    readonly systemCode?: string
  ) {
    super(message)
    this.name = 'HwpxSaveAsError'
  }
}

function systemErrorCode(reason: unknown): string | undefined {
  return reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : undefined
}

function filesystemError(action: string, reason: unknown): HwpxSaveAsError {
  const code = systemErrorCode(reason)
  return new HwpxSaveAsError(
    'HWPX_SAVE_FILESYSTEM',
    `${action} 실패${code ? ` (${code})` : ''}`,
    code
  )
}

function temporaryPathFor(destinationPath: string): string {
  return resolve(dirname(destinationPath), `.${basename(destinationPath)}.han-flow-${randomUUID()}.tmp`)
}

const caseInsensitivePaths = process.platform === 'win32' || process.platform === 'darwin'

function samePathString(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return caseInsensitivePaths ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function statOrUndefined(filePath: string, follow: boolean): Promise<Stats | undefined> {
  try {
    return follow ? await stat(filePath) : await lstat(filePath)
  } catch (reason) {
    if (systemErrorCode(reason) === 'ENOENT') return undefined
    throw filesystemError('저장 목적지 확인', reason)
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  // 일부 파일 시스템(FAT 계열 등)은 안정적인 inode를 주지 않으므로 0이면 비교하지 않는다.
  return left.ino !== 0 && right.ino !== 0 && left.dev === right.dev && left.ino === right.ino
}

/**
 * 목적지가 원본·보호 경로가 아니며, overwrite가 없을 때는 아직 존재하지 않음을 확인한다.
 * 임시 파일을 쓰기 전과 rename 직전에 두 번 호출해 대화상자 이후 바뀐 상태도 거부한다.
 */
async function assertDestinationPublishable(
  destinationPath: string,
  protectedPaths: readonly string[],
  overwrite: boolean
): Promise<boolean> {
  if (protectedPaths.some((protectedPath) => samePathString(protectedPath, destinationPath))) {
    throw new HwpxSaveAsError(
      'HWPX_SAVE_PROTECTED_DESTINATION',
      '원본 파일 덮어쓰기는 허용하지 않습니다. 다른 이름으로 저장해 주세요.'
    )
  }
  const existing = await statOrUndefined(destinationPath, false)
  if (!existing) return false
  if (!existing.isFile()) {
    throw new HwpxSaveAsError(
      'HWPX_SAVE_INVALID_DESTINATION',
      'Save As 목적지가 일반 파일이 아닙니다.'
    )
  }
  if (!overwrite) {
    throw new HwpxSaveAsError(
      'HWPX_SAVE_DESTINATION_EXISTS',
      '같은 이름의 파일이 이미 있습니다. 교체를 확인하지 않은 기존 파일은 덮어쓰지 않습니다.'
    )
  }
  for (const protectedPath of protectedPaths) {
    const protectedStats = await statOrUndefined(protectedPath, true)
    if (protectedStats && sameFile(protectedStats, existing)) {
      throw new HwpxSaveAsError(
        'HWPX_SAVE_PROTECTED_DESTINATION',
        '원본 파일 덮어쓰기는 허용하지 않습니다. 다른 이름으로 저장해 주세요.'
      )
    }
  }
  return true
}

/** 임시 파일을 만들고 fsync한다. 실패하면 스스로 정리하므로 호출자는 성공한 뒤에만 정리 책임을 진다. */
async function writeTemporarySibling(temporaryPath: string, data: Uint8Array): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
  } catch (reason) {
    throw filesystemError('임시 파일 만들기', reason)
  }
  try {
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (reason) {
    await unlink(temporaryPath).catch(() => undefined)
    throw filesystemError('임시 파일 쓰기', reason)
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  // Windows는 디렉터리 handle fsync를 지원하지 않는다(EISDIR/EPERM). rename 자체는 이미 원자적이다.
  if (process.platform === 'win32') return
  try {
    const handle = await open(directoryPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // 일부 네트워크·FAT 계열 파일 시스템은 디렉터리 fsync를 거부한다. 게시는 이미 끝났으므로 무시한다.
  }
}

/** 같은 디렉터리의 임시 파일을 rename으로 목적지에 게시한다. 같은 volume 안에서 원자적이다. */
async function publishTemporary(temporaryPath: string, destinationPath: string): Promise<void> {
  try {
    await rename(temporaryPath, destinationPath)
  } catch (reason) {
    throw filesystemError('저장 파일 게시', reason)
  }
  await syncDirectory(dirname(destinationPath))
}

/**
 * 임시 파일에 쓰고 fsync한 뒤 rename으로 교체한다. 기존 파일이 있으면 overwrite가 true일 때만 교체한다.
 * 검증이 필요 없는 산출물(PDF 내보내기 등)에 쓴다.
 */
export async function writeFileAtomically(
  destinationPath: string,
  data: Buffer | Uint8Array,
  options: { overwrite?: boolean; protectedPaths?: readonly string[] } = {}
): Promise<void> {
  const resolvedDestination = resolve(destinationPath)
  const overwrite = options.overwrite === true
  const protectedPaths = options.protectedPaths ?? []
  await assertDestinationPublishable(resolvedDestination, protectedPaths, overwrite)
  const temporaryPath = temporaryPathFor(resolvedDestination)
  let temporaryExists = false
  try {
    await writeTemporarySibling(temporaryPath, data)
    temporaryExists = true
    await assertDestinationPublishable(resolvedDestination, protectedPaths, overwrite)
    await publishTemporary(temporaryPath, resolvedDestination)
    temporaryExists = false
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
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
    throw new HwpxSaveAsError(
      'HWPX_SAVE_INVALID_DESTINATION',
      'Save As 목적지는 .hwpx 파일이어야 합니다.'
    )
  }
  const overwrite = options.overwrite === true
  const protectedPaths = [sourcePackage.sourcePath, ...(options.protectedPaths ?? [])]
  // 검증 비용을 쓰기 전에 원본 보호와 기존 파일 정책을 먼저 확인한다.
  await assertDestinationPublishable(resolvedDestination, protectedPaths, overwrite)

  const temporaryPath = temporaryPathFor(resolvedDestination)
  let temporaryExists = false
  try {
    await writeTemporarySibling(temporaryPath, sourcePackage.toBuffer())
    temporaryExists = true

    const reopened = await HwpxSourcePackage.open(temporaryPath)
    await assertPackageIdentity(sourcePackage, reopened)
    await validateWithViewer(temporaryPath)
    await options.verify?.(reopened)

    // 검증하는 동안 목적지가 생겼거나 원본으로 바뀌었으면 게시하지 않는다.
    const replacedExisting = await assertDestinationPublishable(
      resolvedDestination,
      protectedPaths,
      overwrite
    )
    await publishTemporary(temporaryPath, resolvedDestination)
    temporaryExists = false
    return {
      destinationPath: resolvedDestination,
      entryCount: reopened.listEntries().length,
      revision: sourcePackage.revision,
      replacedExisting
    }
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}
