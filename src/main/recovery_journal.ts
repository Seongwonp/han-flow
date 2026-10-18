import { createHash, randomUUID } from 'crypto'
import { constants, createReadStream } from 'fs'
import { lstat, mkdir, open, readdir, rename, rm, stat, type FileHandle } from 'fs/promises'
import { basename, dirname, join, resolve, win32 } from 'path'
import { isTableCaretAnchorId } from '../core/editing/empty_paragraph_anchor'
import { FORWARD_EDIT_COMMAND_TYPES } from '../core/editing/replay_guard'
import { MAX_TRANSACTION_COMMANDS, type EditTransaction } from '../core/editing/transaction'
import { crc32 } from '../core/parser/source_package'

/*
 * 편집 복구 기록(recovery journal). 편집 session 하나마다 `<userData>/recovery/<sessionId>/journal.hfj` 하나를 쓴다.
 *
 * 형식: 한 줄에 record 하나. `<JSON byte 길이>:<CRC-32 8자리 hex>:<JSON>\n`.
 *   - 첫 record는 header(형식 version·앱 version·원본 절대 경로·크기·수정 시각·SHA-256·session 시작 시각).
 *   - 그 뒤는 history 순서대로 commit(history가 replay하는 forward transaction 그대로)·undo·redo·saved(저장 지점) record.
 *     각 record는 적용 뒤 package revision을 담아 replay가 같은 상태에 도착했는지 단계마다 확인한다.
 *   - 마지막 record가 길이·CRC·줄바꿈 중 하나라도 맞지 않으면 쓰다 끊긴 꼬리로 보고 버린다. 중간 record가 깨졌으면 기록 전체를
 *     격리한다(실행하지 않는다).
 * 문서 bytes는 쓰지 않는다. command 안의 입력 글자·XML 조각만 담기며, 폴더는 0o700·파일은 0o600이다.
 *
 * 형식 version
 *   - 1: 표 구조 command가 표 원문 두 벌(`replace-table-fragment`)을 담았다.
 *   - 2: 표 구조 command가 표 원문 대비 변경 조각(`patch-table-fragment`)을 담는다. version 1 기록도 그대로 읽어 replay한다.
 *     version 1만 아는 앱은 version 2 기록을 `unsupported-version`으로 보고 손대지 않는다(격리하지 않는다).
 *   - 3: 글자 command·selection이 표만 든 문단의 표 앞·뒤 합성 caret anchor(`#hp:p:N:table-before|after`)를 가리킬 수 있다.
 *     (각주·미주·머리말·꼬리말 글자 편집은 일반 `#hp:t:N` anchor라 형식이 같지만, 같은 때 바뀐 편집 범위를 이전 앱이 replay하지
 *     않도록 함께 올렸다.) version 1·2 기록도 그대로 읽어 replay하며, 그 기록에 표 앞·뒤 anchor가 있으면 구조 오류(격리)다.
 *     version 2까지만 아는 앱은 version 3 기록을 `unsupported-version`으로 보고 손대지 않는다.
 *
 * 읽는 곳
 *   - main process(앱 시작·문서 열기·편집 엔진 종료 뒤 제안)는 첫 record(header)만 읽는다(`readRecoveryJournalHeader`).
 *     header가 깨졌거나 크기 한도를 넘거나 링크면 그 자리에서 격리한다.
 *   - 사용자가 [복구]를 고르면 main이 파일 bytes를 그대로 편집 worker에 넘기고, worker가 전체 record 길이·CRC·구조를 확인한 뒤
 *     replay한다(`decodeRecoveryJournalFor`). 중간 record 손상은 그때 드러나며 replay 실패와 같이 격리한다.
 *
 * 보관 기한: 격리한 기록(`quarantine-*`), [나중에]로 남겨 둔 기록, 다른 형식 version 기록은 마지막으로 바뀐 뒤
 * `RECOVERY_RETENTION_MS`(30일)가 지나면 앱 시작 뒤(창을 띄운 다음) 지운다(`pruneRecoveryJournals`).
 */

export const RECOVERY_JOURNAL_FORMAT = 'han-flow-recovery-journal'
export const RECOVERY_JOURNAL_VERSION = 3
export const RECOVERY_JOURNAL_FILE = 'journal.hfj'
export const RECOVERY_DIRECTORY_NAME = 'recovery'
/** 빠르게 입력하는 동안 디스크에 내리는 최소 간격. 최악의 손실 구간은 이 간격 + fdatasync 시간이다. */
export const RECOVERY_FLUSH_INTERVAL_MS = 500
/**
 * 남은 기록·격리 기록 보관 기한(30일). 마지막으로 바뀐 뒤 이 기간이 지난 기록은 앱 시작 뒤 지운다. 그동안 원본을 다시 열면
 * 복구를 다시 묻고, 앱 시작 때마다도 묻는다. 기한은 기록 파일(격리 폴더는 격리한 시각)의 수정 시각으로 센다.
 */
export const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** header record를 찾으려고 기록 앞에서 읽는 최대 byte. header는 원본 경로 하나와 숫자 몇 개라 이 안에 든다. */
export const RECOVERY_HEADER_READ_BYTES = 256 * 1024

export interface RecoveryJournalLimits {
  /** 기록 파일 전체 byte 상한. 넘는 기록은 열지 않고 격리한다. 쓰는 쪽은 넘기 전에 기록을 멈춘다. */
  maxBytes: number
  /** header를 뺀 record 수 상한 */
  maxRecords: number
  /** record 하나(JSON)의 byte 상한 */
  maxRecordBytes: number
}

export const RECOVERY_JOURNAL_LIMITS: RecoveryJournalLimits = {
  maxBytes: 64 * 1024 * 1024,
  maxRecords: 100_000,
  maxRecordBytes: 16 * 1024 * 1024
}

export interface RecoverySourceFingerprint {
  size: number
  mtimeMs: number
  sha256: string
}

export interface RecoveryJournalHeader {
  type: 'header'
  format: typeof RECOVERY_JOURNAL_FORMAT
  version: number
  appVersion: string
  sourcePath: string
  sourceSize: number
  sourceMtimeMs: number
  sourceSha256: string
  startedAt: number
}

export type RecoveryJournalEntry =
  | { type: 'commit'; revision: number; at: number; transaction: EditTransaction }
  | { type: 'undo' | 'redo' | 'saved'; revision: number; at: number }

export type RecoveryJournalErrorReason = 'malformed' | 'unsupported-version' | 'oversized' | 'invalid-path'

export class RecoveryJournalError extends Error {
  constructor(readonly reason: RecoveryJournalErrorReason, message: string) {
    super(message)
    this.name = 'RecoveryJournalError'
  }
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 복구 기록 폴더 이름으로 쓸 수 있는 session id(소문자 UUID)인지. */
export function isRecoverySessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

/** `root` 바로 아래 session 폴더 경로. id 형식이 틀리거나 경로가 root 밖으로 나가면 거부한다. */
export function recoveryJournalDirectory(root: string, sessionId: string): string {
  if (!isRecoverySessionId(sessionId)) {
    throw new RecoveryJournalError('invalid-path', '복구 기록 ID 형식이 올바르지 않습니다.')
  }
  const resolvedRoot = resolve(root)
  const directory = resolve(resolvedRoot, sessionId)
  if (dirname(directory) !== resolvedRoot || basename(directory) !== sessionId) {
    throw new RecoveryJournalError('invalid-path', '복구 기록 경로가 복구 폴더 밖을 가리킵니다.')
  }
  return directory
}

export function recoveryJournalPath(root: string, sessionId: string): string {
  return join(recoveryJournalDirectory(root, sessionId), RECOVERY_JOURNAL_FILE)
}

export function createRecoveryJournalHeader(
  sourcePath: string,
  source: RecoverySourceFingerprint,
  appVersion: string,
  startedAt = Date.now()
): RecoveryJournalHeader {
  return {
    type: 'header',
    format: RECOVERY_JOURNAL_FORMAT,
    version: RECOVERY_JOURNAL_VERSION,
    appVersion,
    sourcePath: resolve(sourcePath),
    sourceSize: source.size,
    sourceMtimeMs: source.mtimeMs,
    sourceSha256: source.sha256,
    startedAt
  }
}

/** record 하나를 `<길이>:<crc32>:<json>\n` 한 줄로 만든다. */
export function encodeRecoveryRecord(record: RecoveryJournalHeader | RecoveryJournalEntry): Buffer {
  const json = Buffer.from(JSON.stringify(record), 'utf8')
  const prefix = Buffer.from(`${json.byteLength}:${crc32(json).toString(16).padStart(8, '0')}:`, 'ascii')
  return Buffer.concat([prefix, json, Buffer.from('\n')])
}

const COLON = 0x3a
const NEWLINE = 0x0a
/**
 * version별로 기록의 commit이 담을 수 있는 것. commit은 history가 replay하는 forward transaction이라 inverse 전용
 * `restore-*` command는 받지 않는다. version 1에는 표 변경 조각(`patch-table-fragment`)이, version 1·2에는 표 앞·뒤 합성
 * caret anchor가 없었다.
 */
interface RecoveryJournalVersionSpec {
  commandTypes: ReadonlySet<string>
  tableCaretAnchors: boolean
}

const VERSION_SPECS: ReadonlyMap<number, RecoveryJournalVersionSpec> = new Map([
  [1, {
    commandTypes: new Set([...FORWARD_EDIT_COMMAND_TYPES].filter((type) => type !== 'patch-table-fragment')),
    tableCaretAnchors: false
  }],
  [2, { commandTypes: FORWARD_EDIT_COMMAND_TYPES, tableCaretAnchors: false }],
  [RECOVERY_JOURNAL_VERSION, { commandTypes: FORWARD_EDIT_COMMAND_TYPES, tableCaretAnchors: true }]
])

/** 이 앱이 읽어 replay할 수 있는 기록 형식 version. */
export const READABLE_RECOVERY_JOURNAL_VERSIONS: readonly number[] = [...VERSION_SPECS.keys()]

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isSelection(value: unknown): boolean {
  return (
    isObject(value) &&
    ['sectionPath', 'anchorTextNodeId', 'focusTextNodeId'].every((key) => typeof value[key] === 'string') &&
    ['anchorOffset', 'focusOffset'].every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
  )
}

/** version 3 전 기록이 표 앞·뒤 합성 caret anchor를 가리키는지(그 version 편집은 만들 수 없었다). */
function usesTableCaretAnchor(value: Record<string, unknown>): boolean {
  const commands = value['commands'] as Array<Record<string, unknown>>
  const selections = [value['selectionBefore'], value['selectionAfter']] as Array<Record<string, unknown>>
  return (
    commands.some((command) => isTableCaretAnchorId(command['textNodeId'] as string)) ||
    selections.some((selection) =>
      isTableCaretAnchorId(selection['anchorTextNodeId'] as string) || isTableCaretAnchorId(selection['focusTextNodeId'] as string)
    )
  )
}

function isTransaction(value: unknown, spec: RecoveryJournalVersionSpec): value is EditTransaction {
  if (!isObject(value)) return false
  const { commandTypes } = spec
  const commands = value['commands']
  return (
    typeof value['id'] === 'string' &&
    (value['id'] as string).length > 0 &&
    (value['id'] as string).length <= 4096 &&
    isRevision(value['baseRevision']) &&
    Array.isArray(commands) &&
    commands.length > 0 &&
    commands.length <= MAX_TRANSACTION_COMMANDS &&
    commands.every((command) =>
      isObject(command) &&
      typeof command['type'] === 'string' &&
      commandTypes.has(command['type']) &&
      typeof command['sectionPath'] === 'string' &&
      typeof command['textNodeId'] === 'string'
    ) &&
    isSelection(value['selectionBefore']) &&
    isSelection(value['selectionAfter']) &&
    (value['inputType'] === undefined || typeof value['inputType'] === 'string') &&
    (value['compositionId'] === undefined || typeof value['compositionId'] === 'string') &&
    Number.isFinite(value['timestamp']) &&
    (value['timestamp'] as number) >= 0 &&
    (spec.tableCaretAnchors || !usesTableCaretAnchor(value))
  )
}

function validateHeader(value: unknown): RecoveryJournalHeader {
  if (!isObject(value) || value['type'] !== 'header' || value['format'] !== RECOVERY_JOURNAL_FORMAT) {
    throw new RecoveryJournalError('malformed', '복구 기록 header가 올바르지 않습니다.')
  }
  if (typeof value['version'] !== 'number' || !VERSION_SPECS.has(value['version'])) {
    throw new RecoveryJournalError(
      'unsupported-version',
      `지원하지 않는 복구 기록 형식 version입니다: ${String(value['version'])}`
    )
  }
  if (
    typeof value['appVersion'] !== 'string' ||
    typeof value['sourcePath'] !== 'string' ||
    resolve(value['sourcePath']) !== value['sourcePath'] ||
    !isRevision(value['sourceSize']) ||
    !Number.isFinite(value['sourceMtimeMs']) ||
    typeof value['sourceSha256'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value['sourceSha256']) ||
    !Number.isFinite(value['startedAt'])
  ) {
    throw new RecoveryJournalError('malformed', '복구 기록 header 값이 올바르지 않습니다.')
  }
  return value as unknown as RecoveryJournalHeader
}

function validateEntry(value: unknown, spec: RecoveryJournalVersionSpec): RecoveryJournalEntry {
  if (!isObject(value) || !isRevision(value['revision']) || !Number.isFinite(value['at'])) {
    throw new RecoveryJournalError('malformed', '복구 기록 record가 올바르지 않습니다.')
  }
  switch (value['type']) {
    case 'commit':
      if (!isTransaction(value['transaction'], spec)) {
        throw new RecoveryJournalError('malformed', '복구 기록 transaction이 올바르지 않습니다.')
      }
      return value as unknown as RecoveryJournalEntry
    case 'undo':
    case 'redo':
    case 'saved':
      return value as unknown as RecoveryJournalEntry
    default:
      throw new RecoveryJournalError('malformed', '알 수 없는 복구 기록 record입니다.')
  }
}

/** offset부터 record 하나를 읽는다. 실패하면 undefined. */
function readRecord(
  bytes: Buffer,
  offset: number,
  limits: RecoveryJournalLimits
): { value: unknown; next: number } | undefined {
  const lengthEnd = bytes.indexOf(COLON, offset)
  if (lengthEnd < 0 || lengthEnd - offset < 1 || lengthEnd - offset > 9) return undefined
  const lengthText = bytes.toString('ascii', offset, lengthEnd)
  if (!/^(?:0|[1-9][0-9]*)$/.test(lengthText)) return undefined
  const length = Number(lengthText)
  if (length > limits.maxRecordBytes) return undefined
  const crcStart = lengthEnd + 1
  if (bytes.length < crcStart + 9 || bytes[crcStart + 8] !== COLON) return undefined
  const crcText = bytes.toString('ascii', crcStart, crcStart + 8)
  if (!/^[0-9a-f]{8}$/.test(crcText)) return undefined
  const jsonStart = crcStart + 9
  const jsonEnd = jsonStart + length
  if (jsonEnd >= bytes.length || bytes[jsonEnd] !== NEWLINE) return undefined
  const json = bytes.subarray(jsonStart, jsonEnd)
  if (crc32(json) !== parseInt(crcText, 16)) return undefined
  try {
    return { value: JSON.parse(json.toString('utf8')), next: jsonEnd + 1 }
  } catch {
    return undefined
  }
}

export interface DecodedRecoveryJournal {
  header: RecoveryJournalHeader
  entries: RecoveryJournalEntry[]
  /** 마지막 record가 쓰다 끊겨 버렸는지 */
  tornTail: boolean
}

/**
 * 기록 bytes를 해석한다. 마지막 줄(뒤에 줄바꿈으로 끝나는 record가 더 없음)이 깨졌으면 버리고 tornTail로 알린다.
 * header가 깨졌거나 중간 record가 깨졌거나 한도를 넘으면 RecoveryJournalError를 던진다.
 */
export function decodeRecoveryJournal(
  bytes: Buffer,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): DecodedRecoveryJournal {
  if (bytes.length > limits.maxBytes) {
    throw new RecoveryJournalError('oversized', '복구 기록이 크기 한도를 넘습니다.')
  }
  const first = readRecord(bytes, 0, limits)
  if (!first) throw new RecoveryJournalError('malformed', '복구 기록 header를 읽을 수 없습니다.')
  const header = validateHeader(first.value)
  const spec = VERSION_SPECS.get(header.version)!
  const entries: RecoveryJournalEntry[] = []
  let offset = first.next
  let tornTail = false
  while (offset < bytes.length) {
    const record = readRecord(bytes, offset, limits)
    if (!record) {
      const newline = bytes.indexOf(NEWLINE, offset)
      // 깨진 record 뒤에 줄이 더 있으면 끊긴 꼬리가 아니라 손상이다.
      if (newline >= 0 && newline < bytes.length - 1) {
        throw new RecoveryJournalError('malformed', `복구 기록 ${entries.length + 1}번째 record가 손상되었습니다.`)
      }
      tornTail = true
      break
    }
    entries.push(validateEntry(record.value, spec))
    if (entries.length > limits.maxRecords) {
      throw new RecoveryJournalError('oversized', '복구 기록 record 수가 한도를 넘습니다.')
    }
    offset = record.next
  }
  return { header, entries, tornTail }
}

/**
 * 기록 앞부분(첫 record를 담은 bytes)에서 header만 해석한다. 뒤 record는 읽지 않으므로 기록 크기와 무관하게 빠르다.
 * header가 이 bytes 안에서 끝나지 않거나 깨졌으면 malformed, 다른 형식 version이면 unsupported-version.
 */
export function decodeRecoveryJournalHeader(
  bytes: Buffer,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): RecoveryJournalHeader {
  const first = readRecord(bytes, 0, limits)
  if (!first) throw new RecoveryJournalError('malformed', '복구 기록 header를 읽을 수 없습니다.')
  return validateHeader(first.value)
}

function sameHeader(left: RecoveryJournalHeader, right: RecoveryJournalHeader): boolean {
  return (
    left.format === right.format &&
    left.version === right.version &&
    left.appVersion === right.appVersion &&
    left.sourcePath === right.sourcePath &&
    left.sourceSize === right.sourceSize &&
    left.sourceMtimeMs === right.sourceMtimeMs &&
    left.sourceSha256 === right.sourceSha256 &&
    left.startedAt === right.startedAt
  )
}

/**
 * 편집 worker에서 [복구]할 기록 전체를 해석한다. main이 제안할 때 읽은 header와 다르면(그 사이 파일이 바뀌었다) 손상으로 본다.
 */
export function decodeRecoveryJournalFor(
  expected: RecoveryJournalHeader,
  bytes: Buffer,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): DecodedRecoveryJournal {
  const decoded = decodeRecoveryJournal(bytes, limits)
  if (!sameHeader(decoded.header, expected)) {
    throw new RecoveryJournalError('malformed', '복구 기록 header가 복구를 제안할 때와 다릅니다.')
  }
  return decoded
}

/** 파일의 크기·수정 시각·SHA-256. */
export async function fingerprintFile(filePath: string): Promise<RecoverySourceFingerprint> {
  const before = await stat(filePath)
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolvePromise())
  })
  const after = await stat(filePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error('파일을 읽는 동안 내용이 바뀌었습니다.')
  }
  return { size: after.size, mtimeMs: after.mtimeMs, sha256: hash.digest('hex') }
}

export function sameFingerprint(header: RecoveryJournalHeader, source: RecoverySourceFingerprint): boolean {
  return (
    header.sourceSize === source.size &&
    header.sourceMtimeMs === source.mtimeMs &&
    header.sourceSha256 === source.sha256
  )
}

export type RecoverySourceState = 'match' | 'changed' | 'missing'

/**
 * 원본 경로가 이 컴퓨터의 local 경로로 보이는지(파일 시스템에 손대지 않고 문자열만 본다). Windows에서는 드라이브 문자 경로
 * (`C:\...`)만 받고 UNC(`\\server\share`)·장치 경로(`\\?\`, `\\.\`)·드라이브 상대 경로·대체 데이터 stream(`a.hwpx:x`)은
 * 거부한다. 기록 파일은 앱 밖에서 바뀔 수 있으므로, 앱 시작 때 기록 header의 경로를 lstat·hash하기 전에 이것으로 걸러 원격
 * 공유에 접속(자격 증명 전송)하지 않게 한다. 연결된 network drive 문자는 문자열로 구분할 수 없어 local로 본다.
 * 다른 OS는 절대 경로면 받는다.
 */
export function isLocalRecoverySourcePath(sourcePath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (typeof sourcePath !== 'string' || !sourcePath || sourcePath.includes('\0')) return false
  if (platform !== 'win32') return sourcePath.startsWith('/')
  if (!/^[A-Za-z]:\\/.test(sourcePath)) return false
  if (sourcePath.indexOf(':', 2) >= 0) return false
  return win32.normalize(sourcePath) === sourcePath
}

export interface VerifyRecoverySourceOptions {
  /**
   * 내용(SHA-256)까지 비교할지. 기본은 크기·수정 시각만 본다: 복구를 제안할 때는 hash하지 않고, 사용자가 [복구]를 고르면
   * 편집 worker가 원본을 읽은 bytes 그대로 SHA-256을 계산해 header와 비교한다(`EditingEngine.open`).
   */
  hash?: boolean
}

/** 기록을 만든 원본이 그대로 있는지(크기·수정 시각, 옵션으로 SHA-256). 일반 파일이 아니면 missing으로 본다. */
export async function verifyRecoverySource(
  header: RecoveryJournalHeader,
  options: VerifyRecoverySourceOptions = {}
): Promise<RecoverySourceState> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(header.sourcePath)
  } catch {
    return 'missing'
  }
  if (!stats.isFile()) return 'missing'
  if (stats.size !== header.sourceSize || stats.mtimeMs !== header.sourceMtimeMs) return 'changed'
  if (!options.hash) return 'match'
  try {
    return sameFingerprint(header, await fingerprintFile(header.sourcePath)) ? 'match' : 'changed'
  } catch {
    return 'changed'
  }
}

export interface RecoveryJournalCandidate {
  sessionId: string
  header: RecoveryJournalHeader
  /** 기록 파일 byte 수 */
  journalBytes: number
  /**
   * 기록 파일을 마지막으로 디스크에 내린 시각(수정 시각). writer가 record를 모아 내리므로 마지막 편집과는 최대 한 flush 간격
   * 차이다. 편집 수·끊긴 꼬리 여부는 전체 기록을 해석해야 알 수 있어 [복구] 뒤 편집 worker가 알려 준다.
   */
  lastChangeAt: number
}

/** 링크를 따라가지 않고 기록 파일을 연다. 폴더·파일이 링크이거나 일반 파일이 아니거나 한도를 넘으면 RecoveryJournalError. */
async function openRecoveryJournalFile(
  root: string,
  sessionId: string,
  limits: RecoveryJournalLimits
): Promise<{ handle: FileHandle; size: number; mtimeMs: number } | undefined> {
  const directory = recoveryJournalDirectory(root, sessionId)
  const directoryStats = await lstat(directory).catch(() => undefined)
  if (!directoryStats) return undefined
  if (!directoryStats.isDirectory()) {
    throw new RecoveryJournalError('invalid-path', '복구 기록 폴더가 일반 폴더가 아닙니다.')
  }
  const filePath = join(directory, RECOVERY_JOURNAL_FILE)
  const fileStats = await lstat(filePath).catch(() => undefined)
  if (!fileStats) return undefined
  if (!fileStats.isFile()) throw new RecoveryJournalError('invalid-path', '복구 기록이 일반 파일이 아닙니다.')
  // lstat과 open 사이에 링크로 바뀌어도 따라가지 않는다(O_NOFOLLOW가 없는 Windows는 열린 handle의 fstat으로 다시 본다).
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((reason: NodeJS.ErrnoException) => {
    if (reason.code === 'ENOENT') return undefined
    throw new RecoveryJournalError('invalid-path', `복구 기록을 열 수 없습니다(${reason.code ?? reason.message}).`)
  })
  if (!handle) return undefined
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new RecoveryJournalError('invalid-path', '복구 기록이 일반 파일이 아닙니다.')
    if (stats.size > limits.maxBytes) {
      throw new RecoveryJournalError('oversized', '복구 기록이 크기 한도를 넘습니다.')
    }
    return { handle, size: stats.size, mtimeMs: stats.mtimeMs }
  } catch (reason) {
    await handle.close().catch(() => undefined)
    throw reason
  }
}

/**
 * session 하나의 기록 header를 읽는다(파일 앞 `RECOVERY_HEADER_READ_BYTES`까지만). 폴더·파일이 링크이거나 일반 파일이 아니거나
 * 한도를 넘거나 header가 깨졌으면 RecoveryJournalError. 기록이 없으면 undefined. 뒤 record는 [복구] 때 편집 worker가 확인한다.
 */
export async function readRecoveryJournalHeader(
  root: string,
  sessionId: string,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): Promise<RecoveryJournalCandidate | undefined> {
  const opened = await openRecoveryJournalFile(root, sessionId, limits)
  if (!opened) return undefined
  try {
    const length = Math.min(opened.size, RECOVERY_HEADER_READ_BYTES)
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await opened.handle.read(bytes, 0, length, 0)
    const header = decodeRecoveryJournalHeader(bytes.subarray(0, bytesRead), limits)
    return { sessionId, header, journalBytes: opened.size, lastChangeAt: opened.mtimeMs }
  } finally {
    await opened.handle.close().catch(() => undefined)
  }
}

/**
 * [복구]할 기록 파일 전체 bytes와 header. main은 header만 해석하고, bytes는 편집 worker에 넘겨 `decodeRecoveryJournalFor`로
 * 확인·replay한다(큰 기록의 CRC·JSON 해석이 main event loop를 막지 않게).
 */
export async function readRecoveryJournalBytes(
  root: string,
  sessionId: string,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): Promise<{ candidate: RecoveryJournalCandidate; bytes: Buffer } | undefined> {
  const opened = await openRecoveryJournalFile(root, sessionId, limits)
  if (!opened) return undefined
  try {
    const bytes = await opened.handle.readFile()
    if (bytes.length > limits.maxBytes) throw new RecoveryJournalError('oversized', '복구 기록이 크기 한도를 넘습니다.')
    const header = decodeRecoveryJournalHeader(bytes.subarray(0, RECOVERY_HEADER_READ_BYTES), limits)
    return { candidate: { sessionId, header, journalBytes: bytes.length, lastChangeAt: opened.mtimeMs }, bytes }
  } finally {
    await opened.handle.close().catch(() => undefined)
  }
}

/** 실행하지 않고 옮겨 두는 격리 폴더 이름. session id 형식이 아니므로 다시 목록에 오르지 않는다. */
export async function quarantineRecoveryJournal(root: string, sessionId: string): Promise<string> {
  const directory = recoveryJournalDirectory(root, sessionId)
  const target = join(resolve(root), `quarantine-${sessionId}-${Date.now()}`)
  await rename(directory, target)
  return target
}

export async function discardRecoveryJournal(root: string, sessionId: string): Promise<void> {
  await rm(recoveryJournalDirectory(root, sessionId), { recursive: true, force: true })
}

/** 격리 폴더를 지운다(복구 실패 뒤 사용자가 버리기를 고른 경우). root 바로 아래 quarantine-* 폴더만 받는다. */
export async function discardQuarantinedJournal(root: string, quarantinePath: string): Promise<void> {
  const resolvedRoot = resolve(root)
  const target = resolve(quarantinePath)
  if (dirname(target) !== resolvedRoot || !basename(target).startsWith('quarantine-')) {
    throw new RecoveryJournalError('invalid-path', '격리된 복구 기록 경로가 올바르지 않습니다.')
  }
  await rm(target, { recursive: true, force: true })
}

export interface RecoveryJournalScan {
  candidates: RecoveryJournalCandidate[]
  /** 손상·한도 초과로 격리한 폴더 */
  quarantined: string[]
  /** 다른 형식 version이라 손대지 않은 session id */
  unsupported: string[]
}

/**
 * 복구 폴더의 남은 기록을 모은다(header만 읽는다). `exclude`의 session(지금 열려 있는 편집 session)은 건너뛴다.
 * header 손상·한도 초과·링크 기록은 실행하지 않고 격리한다. 다른 version 기록은 그대로 둔다(그 version 앱이 열 수 있다).
 */
export async function scanRecoveryJournals(
  root: string,
  exclude: ReadonlySet<string> = new Set(),
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): Promise<RecoveryJournalScan> {
  const scan: RecoveryJournalScan = { candidates: [], quarantined: [], unsupported: [] }
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return scan
  }
  for (const name of names.sort()) {
    if (!isRecoverySessionId(name) || exclude.has(name)) continue
    try {
      const candidate = await readRecoveryJournalHeader(root, name, limits)
      if (candidate) scan.candidates.push(candidate)
    } catch (reason) {
      if (reason instanceof RecoveryJournalError && reason.reason === 'unsupported-version') {
        scan.unsupported.push(name)
        continue
      }
      try {
        scan.quarantined.push(await quarantineRecoveryJournal(root, name))
      } catch {
        // 옮기지 못하면 다음 실행에서 다시 시도한다.
      }
    }
  }
  scan.candidates.sort((left, right) => right.lastChangeAt - left.lastChangeAt)
  return scan
}

const QUARANTINE_NAME_PATTERN = /^quarantine-([0-9a-f-]{36})-([0-9]{1,16})$/

/**
 * 보관 기한(`RECOVERY_RETENTION_MS`)이 지난 기록을 지운다. 대상은 root 바로 아래의
 *   - session 폴더(편집 중이 아닌 것: [나중에]로 남긴 기록·다른 형식 version 기록·묻기 전 기록): 기록 파일(없으면 폴더)의 수정 시각,
 *   - 격리 폴더(`quarantine-<id>-<격리 시각>`): 이름의 격리 시각과 폴더 수정 시각 중 늦은 쪽
 * 이 `now - maxAgeMs`보다 오래된 것이다. 다른 이름은 건드리지 않고, 링크는 따라가지 않고 링크만 지운다. `exclude`(열려 있거나
 * 복구 중인 session)는 건너뛴다. 실패한 항목은 다음 실행에서 다시 시도한다. 지운 이름을 돌려준다.
 */
export async function pruneRecoveryJournals(
  root: string,
  options: { now?: number; maxAgeMs?: number; exclude?: ReadonlySet<string> } = {}
): Promise<string[]> {
  const now = options.now ?? Date.now()
  const cutoff = now - (options.maxAgeMs ?? RECOVERY_RETENTION_MS)
  const exclude = options.exclude ?? new Set<string>()
  const resolvedRoot = resolve(root)
  let names: string[]
  try {
    names = await readdir(resolvedRoot)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names.sort()) {
    const quarantine = QUARANTINE_NAME_PATTERN.exec(name)
    if (!quarantine && (!isRecoverySessionId(name) || exclude.has(name))) continue
    const target = join(resolvedRoot, name)
    try {
      const stats = await lstat(target)
      let changedAt = stats.mtimeMs
      if (quarantine) {
        changedAt = Math.max(changedAt, Number(quarantine[2]))
      } else if (stats.isDirectory()) {
        const journal = await lstat(join(target, RECOVERY_JOURNAL_FILE)).catch(() => undefined)
        if (journal) changedAt = Math.max(changedAt, journal.mtimeMs)
      }
      if (!(changedAt < cutoff)) continue
      // fs.rm은 링크를 따라가지 않고 링크 자체를 지운다.
      await rm(target, { recursive: true, force: true })
      removed.push(name)
    } catch {
      // 다음 실행에서 다시 시도한다.
    }
  }
  return removed
}

export interface RecoveryJournalWriterOptions {
  flushIntervalMs?: number
  limits?: RecoveryJournalLimits
  /** 쓰기 실패·한도 초과로 기록을 멈췄을 때 */
  onStopped?: (reason: Error) => void
}

/**
 * main process에서 session 하나의 기록을 쓴다. 편집 worker가 응답과 함께 보낸 record를 받아
 *   - session이 dirty면 파일에 덧붙이고(파일이 없으면 header와 지금까지의 모든 record로 새로 만든다),
 *   - dirty가 아니면(저장 직후·처음 상태로 되돌림) 파일을 지운다. record는 메모리에 남겨 다시 dirty가 되면 처음부터 다시 쓴다.
 * 디스크에는 마지막으로 내린 뒤 `flushIntervalMs`가 지났으면 바로, 아니면 그 간격이 찰 때 한 번에 쓰고 fdatasync한다.
 * worker가 죽어도 이미 응답한 record는 main에 있으므로 그대로 내린다. 앱 process가 강제 종료되면 최대 한 간격을 잃는다.
 */
export class RecoveryJournalWriter {
  private readonly encoded: Buffer[] = []
  private readonly encodedHeader: Buffer
  private totalBytes: number
  private unflushed: Buffer[] = []
  private file: FileHandle | undefined
  private wantFile = false
  private stopped = false
  private closed = false
  private chain: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastFlushAt = 0
  private readonly flushIntervalMs: number
  private readonly limits: RecoveryJournalLimits
  private readonly filePath: string

  constructor(
    readonly directory: string,
    readonly header: RecoveryJournalHeader,
    private readonly options: RecoveryJournalWriterOptions = {}
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? RECOVERY_FLUSH_INTERVAL_MS
    this.limits = options.limits ?? RECOVERY_JOURNAL_LIMITS
    this.filePath = join(directory, RECOVERY_JOURNAL_FILE)
    this.encodedHeader = encodeRecoveryRecord(header)
    this.totalBytes = this.encodedHeader.byteLength
  }

  /** 기록 파일이 있어야 하는 상태(dirty)인지 */
  get hasFile(): boolean {
    return this.wantFile && !this.stopped
  }

  get recordCount(): number {
    return this.encoded.length
  }

  append(entries: readonly RecoveryJournalEntry[], dirty: boolean): void {
    if (this.stopped || this.closed) return
    const added: Buffer[] = []
    for (const entry of entries) {
      const buffer = encodeRecoveryRecord(entry)
      if (
        buffer.byteLength > this.limits.maxRecordBytes ||
        this.totalBytes + buffer.byteLength > this.limits.maxBytes ||
        this.encoded.length + 1 > this.limits.maxRecords
      ) {
        this.stop(new RecoveryJournalError('oversized', '편집 기록이 복구 기록 한도를 넘어 이 session의 복구 기록을 멈췄습니다.'), true)
        return
      }
      this.totalBytes += buffer.byteLength
      this.encoded.push(buffer)
      added.push(buffer)
    }
    if (dirty) {
      if (!this.wantFile) {
        this.wantFile = true
        this.unflushed = [this.encodedHeader, ...this.encoded]
      } else {
        this.unflushed.push(...added)
      }
      if (this.unflushed.length) this.schedule()
    } else if (this.wantFile) {
      this.wantFile = false
      this.unflushed = []
      this.clearTimer()
      this.enqueue(() => this.removeFile())
    }
  }

  /** 아직 내리지 않은 record를 지금 쓰고 fdatasync한다(창 blur·저장·닫기 전). */
  flush(): Promise<void> {
    this.clearTimer()
    return this.enqueue(() => this.writePending())
  }

  /** 정상 종료(저장했거나 버리기를 골랐다): 기록 파일과 폴더를 지우고 더 쓰지 않는다. */
  discard(): Promise<void> {
    this.closed = true
    this.wantFile = false
    this.unflushed = []
    this.clearTimer()
    return this.enqueue(() => this.removeFile())
  }

  /** 비정상 종료(worker 중단): 남은 record를 내리고 파일을 닫되 지우지 않는다. */
  retain(): Promise<void> {
    this.clearTimer()
    const done = this.enqueue(async () => {
      await this.writePending()
      await this.closeFile()
    })
    this.closed = true
    return done
  }

  private schedule(): void {
    if (this.timer) return
    const wait = Math.max(0, this.lastFlushAt + this.flushIntervalMs - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, wait)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.chain.then(operation).catch((reason: unknown) => {
      this.stop(reason instanceof Error ? reason : new Error(String(reason)), false)
    })
    this.chain = next
    return next
  }

  private stop(reason: Error, removeFile: boolean): void {
    if (this.stopped) return
    this.stopped = true
    this.unflushed = []
    this.clearTimer()
    // 한도 초과는 더 이상 최신 상태를 담지 못하는 기록을 지운다. 쓰기 실패는 이미 내린 앞부분을 남긴다.
    if (removeFile) this.chain = this.chain.then(() => this.removeFile()).catch(() => undefined)
    else this.chain = this.chain.then(() => this.closeFile()).catch(() => undefined)
    this.options.onStopped?.(reason)
  }

  private async writePending(): Promise<void> {
    if (!this.wantFile || this.stopped || !this.unflushed.length) return
    const buffers = this.unflushed
    this.unflushed = []
    this.lastFlushAt = Date.now()
    let created = false
    if (!this.file) {
      // recursive mkdir은 새로 만드는 상위 복구 폴더에도 같은 mode를 준다.
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      this.file = await open(this.filePath, 'w', 0o600)
      created = true
    }
    await this.file.write(Buffer.concat(buffers))
    await this.file.datasync()
    if (created) await syncDirectory(this.directory)
  }

  private async closeFile(): Promise<void> {
    const file = this.file
    this.file = undefined
    await file?.close().catch(() => undefined)
  }

  private async removeFile(): Promise<void> {
    await this.closeFile()
    await rm(this.directory, { recursive: true, force: true })
  }
}

/** 새로 만든 파일 이름이 crash 뒤에도 남도록 폴더를 fsync한다. Windows는 폴더를 열 수 없으므로 건너뛴다. */
async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r').catch(() => undefined)
  if (!handle) return
  try {
    await handle.sync()
  } catch {
    // 일부 파일 시스템은 폴더 fsync를 지원하지 않는다.
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** 새 session의 기록 폴더 이름. session id가 UUID 형식이 아니면(테스트용 고정 id 등) 따로 만든다. */
export function recoveryJournalIdFor(sessionId: string): string {
  return isRecoverySessionId(sessionId) ? sessionId : randomUUID()
}
