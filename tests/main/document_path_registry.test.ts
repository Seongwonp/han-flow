import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  DOCUMENT_PATH_NOT_ALLOWED,
  DOCUMENT_PATH_NOT_REGULAR_MESSAGE,
  DocumentPathNotAllowedError,
  DocumentPathRegistry
} from '../../src/main/document_path_registry'

const symlinkTest = process.platform === 'win32' ? test.skip : test

describe('renderer 문서 경로 허용목록', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'han-flow-path-registry-'))
  const documentPath = join(directory, 'report.hwpx')
  const otherDocument = join(directory, 'other.hwp')
  const secret = join(directory, 'secret.txt')
  const folderWithExtension = join(directory, 'folder.hwp')
  writeFileSync(documentPath, 'hwpx')
  writeFileSync(otherDocument, 'hwp')
  writeFileSync(secret, 'secret')
  mkdirSync(folderWithExtension)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  const expectRejected = async (promise: Promise<unknown>, message?: string) => {
    const error = await promise.then(() => undefined, (reason: unknown) => reason)
    expect(error).toBeInstanceOf(DocumentPathNotAllowedError)
    expect((error as DocumentPathNotAllowedError).code).toBe(DOCUMENT_PATH_NOT_ALLOWED)
    if (message) expect((error as Error).message).toBe(message)
  }

  test('main이 건넨 경로만 그 webContents에서 허용한다', async () => {
    const registry = new DocumentPathRegistry()
    await registry.allow(1, documentPath)
    await expect(registry.authorize(1, documentPath)).resolves.toBe(documentPath)
    await expectRejected(registry.authorize(1, otherDocument))
    await expectRejected(registry.authorize(2, documentPath))
  })

  test('문자열이 아니거나 상대 경로인 요청은 거부한다', async () => {
    const registry = new DocumentPathRegistry()
    await registry.allow(1, documentPath)
    await expectRejected(registry.authorize(1, 42))
    await expectRejected(registry.authorize(1, 'report.hwpx'))
    await expectRejected(registry.authorize(1, join(directory, '..', 'x', '..', 'nope.hwpx')))
  })

  test('. 과 .. 이 섞인 같은 파일 경로는 정규화해 비교한다', async () => {
    const registry = new DocumentPathRegistry()
    await registry.allow(1, documentPath)
    const dotted = join(directory, 'sub', '..', 'report.hwpx')
    mkdirSync(join(directory, 'sub'), { recursive: true })
    await expect(registry.authorize(1, dotted)).resolves.toBe(dotted)
  })

  test('허용목록의 파일이 사라졌으면 importer가 원래 오류를 내도록 통과시킨다', async () => {
    const registry = new DocumentPathRegistry()
    const missing = join(directory, 'missing.hwpx')
    await registry.allow(1, missing)
    await expect(registry.authorize(1, missing)).resolves.toBe(missing)
    await expectRejected(registry.authorize(1, join(directory, 'missing-other.hwpx')))
  })

  test('허용한 경로라도 일반 파일이 아니면 거부한다', async () => {
    const registry = new DocumentPathRegistry()
    await registry.allow(1, folderWithExtension)
    await expectRejected(registry.authorize(1, folderWithExtension), DOCUMENT_PATH_NOT_REGULAR_MESSAGE)
  })

  symlinkTest('심볼릭 링크는 실제 대상 경로로 비교한다', async () => {
    const registry = new DocumentPathRegistry()
    const disguised = join(directory, 'disguised.hwp')
    symlinkSync(secret, disguised)
    const alias = join(directory, 'alias.hwpx')
    symlinkSync(documentPath, alias)
    await registry.allow(1, documentPath)
    // 허용한 문서를 가리키는 링크는 같은 파일이므로 허용한다.
    await expect(registry.authorize(1, alias)).resolves.toBe(alias)
    // 허용하지 않은 파일을 가리키는 .hwp 링크는 거부한다.
    await expectRejected(registry.authorize(1, disguised))
    // main이 링크 경로 자체를 건넸더라도 실제 대상이 문서가 아니면 거부한다.
    await registry.allow(2, disguised)
    await expectRejected(registry.authorize(2, disguised), DOCUMENT_PATH_NOT_REGULAR_MESSAGE)
  })

  test('drag-and-drop 경로는 존재하는 일반 .hwp/.hwpx 파일만 등록한다', async () => {
    const registry = new DocumentPathRegistry()
    await expect(registry.registerDropped(1, secret)).resolves.toBe(false)
    await expect(registry.registerDropped(1, folderWithExtension)).resolves.toBe(false)
    await expect(registry.registerDropped(1, join(directory, 'none.hwpx'))).resolves.toBe(false)
    await expect(registry.registerDropped(1, 'relative.hwpx')).resolves.toBe(false)
    await expect(registry.registerDropped(1, { path: documentPath })).resolves.toBe(false)
    await expectRejected(registry.authorize(1, folderWithExtension))
    await expect(registry.registerDropped(1, documentPath)).resolves.toBe(true)
    await expect(registry.authorize(1, documentPath)).resolves.toBe(documentPath)
    await expectRejected(registry.authorize(2, documentPath))
  })

  symlinkTest('문서가 아닌 대상을 가리키는 .hwp 링크는 drag-and-drop으로도 등록하지 않는다', async () => {
    const registry = new DocumentPathRegistry()
    const link = join(directory, 'dropped-link.hwp')
    symlinkSync(secret, link)
    await expect(registry.registerDropped(1, link)).resolves.toBe(false)
    await expectRejected(registry.authorize(1, link))
  })

  test('진행 중인 등록이 끝난 뒤 권한을 확인한다', async () => {
    const registry = new DocumentPathRegistry()
    const registration = registry.registerDropped(1, otherDocument)
    // 등록을 기다리지 않고 바로 확인해도 IPC 순서대로 등록 결과를 반영한다.
    await expect(registry.authorize(1, otherDocument)).resolves.toBe(otherDocument)
    await expect(registration).resolves.toBe(true)
  })

  test('webContents가 사라지면 허용목록을 버리고 늦은 등록도 되살리지 않는다', async () => {
    const registry = new DocumentPathRegistry()
    await registry.allow(1, documentPath)
    const late = registry.registerDropped(1, otherDocument)
    registry.forget(1)
    await late
    await expectRejected(registry.authorize(1, documentPath))
    await expectRejected(registry.authorize(1, otherDocument))
  })

  test('Windows·macOS는 대소문자를 구분하지 않고 비교한다', async () => {
    const fileSystem = {
      realpath: async (filePath: string) => filePath,
      stat: async () => ({ isFile: () => true })
    }
    const insensitive = new DocumentPathRegistry(fileSystem, 'darwin')
    await insensitive.allow(1, '/Users/a/Report.HWPX')
    await expect(insensitive.authorize(1, '/users/a/report.hwpx')).resolves.toBe('/users/a/report.hwpx')
    const sensitive = new DocumentPathRegistry(fileSystem, 'linux')
    await sensitive.allow(1, '/home/a/Report.HWPX')
    await expectRejected(sensitive.authorize(1, '/home/a/report.hwpx'))
  })
})
