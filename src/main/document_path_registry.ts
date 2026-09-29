import { realpath as fsRealpath, stat as fsStat } from 'fs/promises'
import { extname, isAbsolute, resolve } from 'path'

export const DOCUMENT_PATH_NOT_ALLOWED = 'DOCUMENT_PATH_NOT_ALLOWED'

export const DOCUMENT_PATH_NOT_ALLOWED_MESSAGE =
  '이 창에서 열도록 선택한 문서가 아니어서 읽을 수 없습니다. 파일 열기, 끌어 놓기 또는 탐색기에서 문서를 다시 열어 주세요.'

export const DOCUMENT_PATH_NOT_REGULAR_MESSAGE =
  '일반 HWP·HWPX 파일이 아니어서 열 수 없습니다. 폴더나 다른 형식을 가리키는 바로가기(심볼릭 링크)는 열 수 없습니다.'

/** renderer에 그대로 전달할 code를 가진 경로 허용목록 오류. */
export class DocumentPathNotAllowedError extends Error {
  readonly code = DOCUMENT_PATH_NOT_ALLOWED

  constructor(message = DOCUMENT_PATH_NOT_ALLOWED_MESSAGE) {
    super(message)
    this.name = 'DocumentPathNotAllowedError'
  }
}

export interface DocumentPathFileSystem {
  realpath(filePath: string): Promise<string>
  stat(filePath: string): Promise<{ isFile(): boolean }>
}

const nodeFileSystem: DocumentPathFileSystem = {
  realpath: (filePath) => fsRealpath(filePath),
  stat: (filePath) => fsStat(filePath)
}

function hasDocumentExtension(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return extension === '.hwp' || extension === '.hwpx'
}

function isMissingPathError(reason: unknown): boolean {
  const code = reason && typeof reason === 'object' && 'code' in reason
    ? (reason as { code: unknown }).code
    : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * renderer(webContents)별 문서 경로 허용목록.
 *
 * main이 직접 건넨 경로(열기 대화상자, OS 파일 열기, 명령줄, second-instance, E2E hook)와
 * preload가 drag-and-drop `File`에서 얻어 등록한 경로만 `document:import`·`editing:start`로
 * 읽을 수 있다. 비교는 심볼릭 링크를 푼 실제 경로로 하므로 `x.hwp` 링크로 다른 파일을 가리켜도
 * 허용목록을 우회하지 못한다.
 */
export class DocumentPathRegistry {
  private readonly allowed = new Map<number, Set<string>>()
  private readonly pending = new Map<number, Set<Promise<unknown>>>()
  private readonly forgotten = new Set<number>()

  constructor(
    private readonly fileSystem: DocumentPathFileSystem = nodeFileSystem,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  /** main이 직접 건넨 경로를 허용한다. 존재 여부는 authorize 시점에 확인한다. */
  allow(ownerId: number, filePath: string): Promise<void> {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) return Promise.resolve()
    this.add(ownerId, resolve(filePath))
    return this.track(ownerId, this.fileSystem.realpath(filePath).then(
      (realPath) => { this.add(ownerId, realPath) },
      () => undefined
    ))
  }

  /**
   * preload가 drag-and-drop `File`에서 얻은 경로를 등록한다. main이 건넨 경로가 아니므로
   * 존재하는 일반 .hwp/.hwpx 파일(링크라면 실제 대상도 .hwp/.hwpx)일 때만 허용한다.
   */
  registerDropped(ownerId: number, filePath: unknown): Promise<boolean> {
    if (typeof filePath !== 'string' || !isAbsolute(filePath) || !hasDocumentExtension(filePath)) {
      return Promise.resolve(false)
    }
    return this.track(ownerId, (async () => {
      try {
        const realPath = await this.fileSystem.realpath(filePath)
        if (!hasDocumentExtension(realPath) || !(await this.fileSystem.stat(realPath)).isFile()) {
          return false
        }
        this.add(ownerId, resolve(filePath))
        this.add(ownerId, realPath)
        return true
      } catch {
        return false
      }
    })())
  }

  /**
   * renderer가 요청한 경로가 이 webContents에 허용된 일반 문서 파일인지 확인한다.
   * 허용되면 요청 경로를 그대로 돌려주고, 아니면 DocumentPathNotAllowedError를 던진다.
   * 허용목록에 있지만 이미 사라진 파일은 importer가 원래의 읽기 오류를 내도록 통과시킨다.
   */
  async authorize(ownerId: number, filePath: unknown): Promise<string> {
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new DocumentPathNotAllowedError()
    const pending = this.pending.get(ownerId)
    if (pending?.size) await Promise.allSettled([...pending])
    const paths = this.allowed.get(ownerId)
    if (!paths) throw new DocumentPathNotAllowedError()

    let realPath: string
    try {
      realPath = await this.fileSystem.realpath(filePath)
    } catch (reason) {
      if (isMissingPathError(reason) && paths.has(this.key(resolve(filePath)))) return filePath
      throw new DocumentPathNotAllowedError()
    }
    if (!paths.has(this.key(realPath))) throw new DocumentPathNotAllowedError()
    let regularFile = false
    try {
      regularFile = (await this.fileSystem.stat(realPath)).isFile()
    } catch {
      regularFile = false
    }
    if (!regularFile || !hasDocumentExtension(realPath)) {
      throw new DocumentPathNotAllowedError(DOCUMENT_PATH_NOT_REGULAR_MESSAGE)
    }
    return filePath
  }

  /** webContents가 사라지면 그 허용목록을 버린다. */
  forget(ownerId: number): void {
    this.allowed.delete(ownerId)
    this.pending.delete(ownerId)
    // webContents id는 한 process 안에서 재사용되지 않는다. 늦게 끝난 등록이 되살리지 않게 막는다.
    this.forgotten.add(ownerId)
  }

  private add(ownerId: number, filePath: string): void {
    if (this.forgotten.has(ownerId)) return
    let paths = this.allowed.get(ownerId)
    if (!paths) {
      paths = new Set()
      this.allowed.set(ownerId, paths)
    }
    paths.add(this.key(filePath))
  }

  private track<T>(ownerId: number, work: Promise<T>): Promise<T> {
    if (this.forgotten.has(ownerId)) return work
    let pending = this.pending.get(ownerId)
    if (!pending) {
      pending = new Set()
      this.pending.set(ownerId, pending)
    }
    const owned = pending
    owned.add(work)
    void work.finally(() => { owned.delete(work) }).catch(() => undefined)
    return work
  }

  private key(filePath: string): string {
    return this.platform === 'win32' || this.platform === 'darwin'
      ? filePath.toLowerCase()
      : filePath
  }
}
