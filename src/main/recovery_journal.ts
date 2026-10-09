import { createHash, randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, type FileHandle } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
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
 */

export const RECOVERY_JOURNAL_FORMAT = 'han-flow-recovery-journal'
export const RECOVERY_JOURNAL_VERSION = 1
export const RECOVERY_JOURNAL_FILE = 'journal.hfj'
export const RECOVERY_DIRECTORY_NAME = 'recovery'
/** 빠르게 입력하는 동안 디스크에 내리는 최소 간격. 최악의 손실 구간은 이 간격 + fdatasync 시간이다. */
export const RECOVERY_FLUSH_INTERVAL_MS = 500

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
const COMMAND_TYPES = new Set([
  'replace-text',
  'apply-character-style',
  'apply-paragraph-style',
  'restore-style',
  'restore-character-run',
  'replace-paragraph-fragment',
  'apply-cell-style',
  'restore-cell-style',
  'replace-table-fragment'
])

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

function isTransaction(value: unknown): value is EditTransaction {
  if (!isObject(value)) return false
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
      COMMAND_TYPES.has(command['type']) &&
      typeof command['sectionPath'] === 'string' &&
      typeof command['textNodeId'] === 'string'
    ) &&
    isSelection(value['selectionBefore']) &&
    isSelection(value['selectionAfter']) &&
    (value['inputType'] === undefined || typeof value['inputType'] === 'string') &&
    (value['compositionId'] === undefined || typeof value['compositionId'] === 'string') &&
    Number.isFinite(value['timestamp']) &&
    (value['timestamp'] as number) >= 0
  )
}

function validateHeader(value: unknown): RecoveryJournalHeader {
  if (!isObject(value) || value['type'] !== 'header' || value['format'] !== RECOVERY_JOURNAL_FORMAT) {
    throw new RecoveryJournalError('malformed', '복구 기록 header가 올바르지 않습니다.')
  }
  if (value['version'] !== RECOVERY_JOURNAL_VERSION) {
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

function validateEntry(value: unknown): RecoveryJournalEntry {
  if (!isObject(value) || !isRevision(value['revision']) || !Number.isFinite(value['at'])) {
    throw new RecoveryJournalError('malformed', '복구 기록 record가 올바르지 않습니다.')
  }
  switch (value['type']) {
    case 'commit':
      if (!isTransaction(value['transaction'])) {
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
    entries.push(validateEntry(record.value))
    if (entries.length > limits.maxRecords) {
      throw new RecoveryJournalError('oversized', '복구 기록 record 수가 한도를 넘습니다.')
    }
    offset = record.next
  }
  return { header, entries, tornTail }
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

/** 기록을 만든 원본이 그대로 있는지(크기·수정 시각·SHA-256). 일반 파일이 아니면 missing으로 본다. */
export async function verifyRecoverySource(header: RecoveryJournalHeader): Promise<RecoverySourceState> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(header.sourcePath)
  } catch {
    return 'missing'
  }
  if (!stats.isFile()) return 'missing'
  if (stats.size !== header.sourceSize || stats.mtimeMs !== header.sourceMtimeMs) return 'changed'
  try {
    return sameFingerprint(header, await fingerprintFile(header.sourcePath)) ? 'match' : 'changed'
  } catch {
    return 'changed'
  }
}

export interface RecoveryJournalCandidate {
  sessionId: string
  header: RecoveryJournalHeader
  entries: RecoveryJournalEntry[]
  tornTail: boolean
  /** 편집(commit) 수 */
  editCount: number
  /** 마지막 record 시각(없으면 session 시작 시각) */
  lastChangeAt: number
}

function candidateOf(sessionId: string, decoded: DecodedRecoveryJournal): RecoveryJournalCandidate {
  return {
    sessionId,
    header: decoded.header,
    entries: decoded.entries,
    tornTail: decoded.tornTail,
    editCount: decoded.entries.filter((entry) => entry.type === 'commit').length,
    lastChangeAt: decoded.entries.at(-1)?.at ?? decoded.header.startedAt
  }
}

/**
 * session 하나의 기록을 읽는다. 폴더·파일이 링크이거나 일반 파일이 아니거나 한도를 넘거나 손상됐으면 RecoveryJournalError.
 * 기록이 없으면 undefined.
 */
export async function readRecoveryJournal(
  root: string,
  sessionId: string,
  limits: RecoveryJournalLimits = RECOVERY_JOURNAL_LIMITS
): Promise<RecoveryJournalCandidate | undefined> {
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
  if (fileStats.size > limits.maxBytes) {
    throw new RecoveryJournalError('oversized', '복구 기록이 크기 한도를 넘습니다.')
  }
  const bytes = await readFile(filePath)
  return candidateOf(sessionId, decodeRecoveryJournal(bytes, limits))
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
 * 복구 폴더의 남은 기록을 모은다. `exclude`의 session(지금 열려 있는 편집 session)은 건너뛴다.
 * 손상·한도 초과 기록은 실행하지 않고 격리한다. 다른 version 기록은 그대로 둔다(그 version 앱이 열 수 있다).
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
      const candidate = await readRecoveryJournal(root, name, limits)
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
