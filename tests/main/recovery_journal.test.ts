import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createRecoveryJournalHeader,
  decodeRecoveryJournal,
  encodeRecoveryRecord,
  fingerprintFile,
  isRecoverySessionId,
  readRecoveryJournal,
  RECOVERY_JOURNAL_FILE,
  RECOVERY_JOURNAL_LIMITS,
  RecoveryJournalEntry,
  RecoveryJournalError,
  recoveryJournalDirectory,
  RecoveryJournalWriter,
  scanRecoveryJournals,
  verifyRecoverySource
} from '../../src/main/recovery_journal'

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

function commit(revision: number, insert: string): RecoveryJournalEntry {
  const selection = {
    sectionPath: 'Contents/section0.xml',
    anchorTextNodeId: 'Contents/section0.xml#hp:t:0',
    anchorOffset: 0,
    focusTextNodeId: 'Contents/section0.xml#hp:t:0',
    focusOffset: 0
  }
  return {
    type: 'commit',
    revision,
    at: 1_700_000_000_000 + revision,
    transaction: {
      id: `t${revision}`,
      baseRevision: revision - 1,
      commands: [{
        type: 'replace-text',
        sectionPath: selection.sectionPath,
        textNodeId: selection.anchorTextNodeId,
        from: 0,
        to: 0,
        insert
      }],
      selectionBefore: selection,
      selectionAfter: { ...selection, anchorOffset: insert.length, focusOffset: insert.length },
      inputType: 'insertText',
      timestamp: revision
    }
  }
}

describe('복구 기록 형식', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-recovery-unit-'))
  const source = join(directory, 'source.hwpx')
  writeFileSync(source, 'source bytes')
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  const header = () => createRecoveryJournalHeader(source, { size: 12, mtimeMs: 1, sha256: 'a'.repeat(64) }, '1.0.0', 5)
  const journal = (entries: RecoveryJournalEntry[]) =>
    Buffer.concat([encodeRecoveryRecord(header()), ...entries.map(encodeRecoveryRecord)])

  test('record는 길이·CRC-32·JSON 한 줄이고 그대로 되읽힌다', () => {
    const record = encodeRecoveryRecord(commit(1, '가나'))
    expect(record.toString('utf8')).toMatch(/^\d+:[0-9a-f]{8}:\{.*\}\n$/)
    const decoded = decodeRecoveryJournal(journal([commit(1, '가나'), { type: 'undo', revision: 2, at: 3 }]))
    expect(decoded.header).toEqual(header())
    expect(decoded.entries).toEqual([commit(1, '가나'), { type: 'undo', revision: 2, at: 3 }])
    expect(decoded.tornTail).toBe(false)
  })

  test.each([
    ['중간에서 잘린 마지막 record', (bytes: Buffer) => bytes.subarray(0, bytes.length - 7)],
    ['줄바꿈만 빠진 마지막 record', (bytes: Buffer) => bytes.subarray(0, bytes.length - 1)],
    ['CRC가 틀린 마지막 record', (bytes: Buffer) => {
      const copy = Buffer.from(bytes)
      copy[copy.length - 3] ^= 0x01
      return copy
    }],
    ['0으로 채워진 꼬리', (bytes: Buffer) => Buffer.concat([bytes, Buffer.alloc(64)])]
  ])('%s는 끊긴 꼬리로 버리고 앞의 완전한 record는 모두 읽는다', (_label, tear) => {
    const complete = [commit(1, '가'), commit(2, '나')]
    const bytes = tear(journal([...complete, commit(3, '다')]))
    const decoded = decodeRecoveryJournal(bytes)
    expect(decoded.tornTail).toBe(true)
    expect(decoded.entries).toEqual(_label === '0으로 채워진 꼬리' ? [...complete, commit(3, '다')] : complete)
  })

  test('중간 record 손상은 끊긴 꼬리가 아니라 손상으로 거부한다', () => {
    const bytes = journal([commit(1, '가'), commit(2, '나'), commit(3, '다')])
    const second = bytes.indexOf(Buffer.from('"t2"'))
    bytes[second + 1] = 'x'.charCodeAt(0)
    expect(() => decodeRecoveryJournal(bytes)).toThrow(expect.objectContaining({ reason: 'malformed' }))
  })

  test('다른 형식 version은 거부한다', () => {
    const bytes = Buffer.concat([encodeRecoveryRecord({ ...header(), version: 2 }), encodeRecoveryRecord(commit(1, '가'))])
    expect(() => decodeRecoveryJournal(bytes)).toThrow(expect.objectContaining({ reason: 'unsupported-version' }))
  })

  test('header·record 구조가 틀리면 거부한다', () => {
    expect(() => decodeRecoveryJournal(Buffer.from('garbage\n'))).toThrow(RecoveryJournalError)
    expect(() => decodeRecoveryJournal(encodeRecoveryRecord({ ...header(), sourcePath: 'relative.hwpx' }))).toThrow(
      expect.objectContaining({ reason: 'malformed' })
    )
    const badCommand = commit(1, '가') as Extract<RecoveryJournalEntry, { type: 'commit' }>
    const bytes = journal([
      { ...badCommand, transaction: { ...badCommand.transaction, commands: [{ type: 'run-script' }] } } as never,
      commit(2, '나')
    ])
    expect(() => decodeRecoveryJournal(bytes)).toThrow(expect.objectContaining({ reason: 'malformed' }))
  })

  test('크기·record 수 한도를 넘으면 거부한다', () => {
    const bytes = journal([commit(1, '가'), commit(2, '나'), commit(3, '다')])
    expect(() => decodeRecoveryJournal(bytes, { ...RECOVERY_JOURNAL_LIMITS, maxBytes: bytes.length - 1 })).toThrow(
      expect.objectContaining({ reason: 'oversized' })
    )
    expect(() => decodeRecoveryJournal(bytes, { ...RECOVERY_JOURNAL_LIMITS, maxRecords: 2 })).toThrow(
      expect.objectContaining({ reason: 'oversized' })
    )
  })

  test('기록 경로는 복구 폴더 바로 아래 UUID 이름만 허용한다', () => {
    expect(isRecoverySessionId(SESSION)).toBe(true)
    expect(recoveryJournalDirectory(directory, SESSION)).toBe(join(directory, SESSION))
    for (const id of ['..', '../x', `${SESSION}/..`, SESSION.toUpperCase(), 'session-1', '', `${SESSION}\0`]) {
      expect(isRecoverySessionId(id)).toBe(false)
      expect(() => recoveryJournalDirectory(directory, id)).toThrow(expect.objectContaining({ reason: 'invalid-path' }))
    }
  })

  test('원본 지문이 크기·수정 시각·SHA-256 중 하나라도 다르면 changed, 없으면 missing', async () => {
    const fingerprint = await fingerprintFile(source)
    const matching = createRecoveryJournalHeader(source, fingerprint, '1.0.0')
    expect(await verifyRecoverySource(matching)).toBe('match')
    expect(await verifyRecoverySource({ ...matching, sourceSha256: 'b'.repeat(64) })).toBe('changed')
    expect(await verifyRecoverySource({ ...matching, sourceMtimeMs: matching.sourceMtimeMs + 1 })).toBe('changed')
    expect(await verifyRecoverySource({ ...matching, sourcePath: join(directory, 'moved.hwpx') })).toBe('missing')
  })

  test('남은 기록 목록: 손상 기록은 격리하고, 다른 version은 그대로 두고, 링크·잘못된 이름은 건너뛴다', async () => {
    const root = join(directory, 'scan')
    mkdirSync(join(root, SESSION), { recursive: true })
    writeFileSync(join(root, SESSION, RECOVERY_JOURNAL_FILE), journal([commit(1, '가')]))
    const broken = '9b2f5d0e-1c1a-4b9a-8c55-3f1f2e9c0a11'
    mkdirSync(join(root, broken))
    writeFileSync(join(root, broken, RECOVERY_JOURNAL_FILE), 'not a journal\nreally\n')
    const future = 'e4d1c0b2-8f7a-4c3b-9d2e-1a0b9c8d7e6f'
    mkdirSync(join(root, future))
    writeFileSync(join(root, future, RECOVERY_JOURNAL_FILE), encodeRecoveryRecord({ ...header(), version: 9 }))
    mkdirSync(join(root, 'not-a-session'))
    symlinkSync(join(root, SESSION), join(root, OTHER))

    const scan = await scanRecoveryJournals(root)
    expect(scan.candidates.map((candidate) => candidate.sessionId)).toEqual([SESSION])
    expect(scan.candidates[0]).toMatchObject({ editCount: 1, lastChangeAt: commit(1, '가').at, tornTail: false })
    expect(scan.unsupported).toEqual([future])
    // 심볼릭 링크 session 폴더와 손상 기록은 실행하지 않고 격리한다.
    expect(scan.quarantined).toHaveLength(2)
    const quarantined = readdirSync(root).filter((name) => name.startsWith('quarantine-'))
    expect(quarantined).toHaveLength(2)
    expect(quarantined.some((name) => name.includes(broken))).toBe(true)
    expect(quarantined.some((name) => name.includes(OTHER))).toBe(true)
    // 링크를 따라가지 않고 링크 자체를 옮겼으므로 원래 기록은 그대로다.
    expect(readdirSync(join(root, SESSION))).toEqual([RECOVERY_JOURNAL_FILE])
    expect((await scanRecoveryJournals(root, new Set([SESSION]))).candidates).toEqual([])
    await expect(readRecoveryJournal(root, OTHER)).resolves.toBeUndefined()
  })
})

describe('복구 기록 writer', () => {
  const root = mkdtempSync(join(tmpdir(), 'han-flow-recovery-writer-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const header = createRecoveryJournalHeader(join(root, 'a.hwpx'), { size: 1, mtimeMs: 1, sha256: 'c'.repeat(64) }, '1.0.0')
  const filePath = join(root, SESSION, RECOVERY_JOURNAL_FILE)

  test('dirty일 때만 파일을 만들고, clean이 되면 지우고, 다시 dirty가 되면 처음부터 다시 쓴다', async () => {
    const writer = new RecoveryJournalWriter(recoveryJournalDirectory(root, SESSION), header, { flushIntervalMs: 10_000 })
    writer.append([], false)
    await writer.flush()
    expect(() => statSync(filePath)).toThrow()

    writer.append([commit(1, '가')], true)
    await writer.flush()
    expect(decodeRecoveryJournal(readFileSync(filePath)).entries).toEqual([commit(1, '가')])
    if (process.platform !== 'win32') {
      expect(statSync(filePath).mode & 0o777).toBe(0o600)
      expect(statSync(join(root, SESSION)).mode & 0o777).toBe(0o700)
    }

    writer.append([{ type: 'saved', revision: 1, at: 2 }], false)
    await writer.flush()
    expect(() => statSync(join(root, SESSION))).toThrow()

    writer.append([commit(2, '나')], true)
    await writer.flush()
    expect(decodeRecoveryJournal(readFileSync(filePath)).entries).toEqual([
      commit(1, '가'),
      { type: 'saved', revision: 1, at: 2 },
      commit(2, '나')
    ])

    await writer.discard()
    expect(() => statSync(join(root, SESSION))).toThrow()
  })

  test('빠른 입력은 간격마다 한 번 내리고, 간격 안에서는 내리지 않는다', async () => {
    const writer = new RecoveryJournalWriter(recoveryJournalDirectory(root, OTHER), header, { flushIntervalMs: 300 })
    const path = join(root, OTHER, RECOVERY_JOURNAL_FILE)
    writer.append([commit(1, '가')], true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    // 쉬고 있다가 들어온 첫 record는 바로 내린다.
    expect(decodeRecoveryJournal(readFileSync(path)).entries).toHaveLength(1)
    writer.append([commit(2, '나')], true)
    writer.append([commit(3, '다')], true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(decodeRecoveryJournal(readFileSync(path)).entries).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(decodeRecoveryJournal(readFileSync(path)).entries).toHaveLength(3)
    // 비정상 종료 경로: 남은 record를 내리고 파일은 남긴다.
    writer.append([commit(4, '라')], true)
    await writer.retain()
    expect(decodeRecoveryJournal(readFileSync(path)).entries).toHaveLength(4)
    writer.append([commit(5, '마')], true)
    expect(decodeRecoveryJournal(readFileSync(path)).entries).toHaveLength(4)
  })

  test('한도를 넘으면 기록을 멈추고 최신 상태를 담지 못하는 파일을 지운다', async () => {
    const session = '3d6f4e2a-5b1c-4d7e-8f9a-0b1c2d3e4f5a'
    const stopped: Error[] = []
    const writer = new RecoveryJournalWriter(recoveryJournalDirectory(root, session), header, {
      limits: { ...RECOVERY_JOURNAL_LIMITS, maxRecords: 2 },
      onStopped: (reason) => stopped.push(reason)
    })
    writer.append([commit(1, '가'), commit(2, '나')], true)
    await writer.flush()
    writer.append([commit(3, '다')], true)
    await writer.flush()
    expect(stopped).toHaveLength(1)
    expect(writer.hasFile).toBe(false)
    expect(() => statSync(join(root, session))).toThrow()
  })
})
