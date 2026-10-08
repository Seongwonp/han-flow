import { link, lstat, open, rename, stat, unlink } from 'fs/promises'
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
  /**
   * 테스트 전용 seam: 마지막 목적지 확인 뒤, 게시 직전에 호출된다.
   * 확인과 게시 사이에 목적지가 생기는 경쟁 상황을 재현하는 데만 쓴다.
   */
  onBeforePublish?: () => Promise<void> | void
  /**
   * 임시 파일 이름에 쓸 UUID. 호출자(main process)가 미리 정해 두면 저장을 맡은 편집 worker가 중간에
   * 종료되더라도 같은 이름(`saveTemporaryPath`)으로 남은 임시 파일을 지울 수 있다. 생략하면 새로 만든다.
   */
  temporaryToken?: string
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

const DESTINATION_EXISTS_MESSAGE =
  '같은 이름의 파일이 이미 있습니다. 교체를 확인하지 않은 기존 파일은 덮어쓰지 않습니다.'

const TEMPORARY_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * 목적지와 같은 디렉터리의 임시 파일 경로. token은 UUID 형식만 허용해 다른 경로를 가리키지 못하게 한다.
 * 편집 worker를 강제 종료한 main process가 남은 임시 파일을 지울 때도 같은 함수를 쓴다.
 */
export function saveTemporaryPath(destinationPath: string, token: string): string {
  if (!TEMPORARY_TOKEN_PATTERN.test(token)) {
    throw new HwpxSaveAsError('HWPX_SAVE_INVALID_DESTINATION', '임시 파일 식별자가 올바르지 않습니다.')
  }
  const resolvedDestination = resolve(destinationPath)
  return resolve(dirname(resolvedDestination), `.${basename(resolvedDestination)}.han-flow-${token}.tmp`)
}

function temporaryPathFor(destinationPath: string, token: string = randomUUID()): string {
  return saveTemporaryPath(destinationPath, token)
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
 * 임시 파일을 쓰기 전과 게시 직전에 호출해 대화상자 이후 바뀐 상태도 거부한다.
 * overwrite가 없을 때 마지막 보장은 publishTemporary의 hard link(EEXIST)가 맡는다.
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
      DESTINATION_EXISTS_MESSAGE
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

/**
 * 게시할 파일의 권한: 일반 파일 기본값(0o666)에 현재 umask를 적용한 값.
 * 임시 파일은 쓰는 동안 0o600으로 만들고, 게시 직전에 이 값으로 바꾼다.
 */
function publishedFileMode(): number {
  return 0o666 & ~process.umask()
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
      await handle.chmod(publishedFileMode())
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

/** hard link를 지원하지 않는 파일 시스템(exFAT·FAT32·일부 SMB 등)이 link에 돌려주는 errno. */
const LINK_UNSUPPORTED_CODES = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EACCES'])

/**
 * 같은 디렉터리의 임시 파일을 목적지에 게시한다.
 * - overwrite: rename으로 기존 파일을 원자적으로 교체한다.
 * - overwrite 아님: hard link로 게시한다. 목적지가 이미 있으면 OS가 EEXIST로 원자적으로 거부하므로
 *   확인 뒤에 생긴 파일도 덮어쓰지 않는다. 성공하면 임시 이름만 지운다.
 *   hard link를 지원하지 않는 파일 시스템에서만 확인 후 rename으로 물러선다(확인과 rename 사이의 짧은 경쟁은 남는다).
 */
async function publishTemporary(
  temporaryPath: string,
  destinationPath: string,
  overwrite: boolean,
  recheck: () => Promise<unknown>
): Promise<void> {
  if (!overwrite) {
    let linked = false
    try {
      await link(temporaryPath, destinationPath)
      linked = true
    } catch (reason) {
      const code = systemErrorCode(reason)
      if (code === 'EEXIST') {
        throw new HwpxSaveAsError(
          'HWPX_SAVE_DESTINATION_EXISTS',
          DESTINATION_EXISTS_MESSAGE
        )
      }
      if (!code || !LINK_UNSUPPORTED_CODES.has(code)) throw filesystemError('저장 파일 게시', reason)
    }
    if (linked) {
      // 목적지는 이미 게시됐다. 임시 이름 정리는 실패해도 저장 결과에 영향을 주지 않는다.
      await unlink(temporaryPath).catch(() => undefined)
      await syncDirectory(dirname(destinationPath))
      return
    }
    // hard link 미지원 파일 시스템: rename 직전에 다시 확인한다.
    await recheck()
  }
  try {
    await rename(temporaryPath, destinationPath)
  } catch (reason) {
    throw filesystemError('저장 파일 게시', reason)
  }
  await syncDirectory(dirname(destinationPath))
}

/**
 * 임시 파일에 쓰고 fsync한 뒤 게시한다. 기존 파일이 있으면 overwrite가 true일 때만 교체한다.
 * 검증이 필요 없는 산출물(PDF 내보내기 등)에 쓴다. protectedPaths는 overwrite와 무관하게 거부한다.
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
    await publishTemporary(temporaryPath, resolvedDestination, overwrite, () =>
      assertDestinationPublishable(resolvedDestination, protectedPaths, overwrite)
    )
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

  const temporaryPath = temporaryPathFor(resolvedDestination, options.temporaryToken)
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
    await options.onBeforePublish?.()
    await publishTemporary(temporaryPath, resolvedDestination, overwrite, () =>
      assertDestinationPublishable(resolvedDestination, protectedPaths, overwrite)
    )
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
