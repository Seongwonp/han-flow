import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory, HwpxHistoryLimitError } from '../../src/core/editing/history'
import { saveHwpxAs } from '../../src/core/editing/save_as'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import {
  applyEditTransaction,
  EditCommand,
  EditTransaction,
  EditorSelection,
  MAX_TRANSACTION_COMMANDS,
  projectEditTransaction,
  shouldGroupTransactions
} from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function selection(textNodeId: string, offset: number): EditorSelection {
  return {
    sectionPath,
    anchorTextNodeId: textNodeId,
    anchorOffset: offset,
    focusTextNodeId: textNodeId,
    focusOffset: offset
  }
}

function command(textNodeId: string, from: number, to: number, insert: string): EditCommand {
  return {
    type: 'replace-text',
    sectionPath,
    textNodeId,
    from,
    to,
    insert
  }
}

function transaction(
  source: HwpxSourcePackage,
  id: string,
  commands: EditCommand[],
  selectionBefore: EditorSelection,
  selectionAfter: EditorSelection,
  options: { inputType?: string; compositionId?: string; timestamp?: number } = {}
): EditTransaction {
  return {
    id,
    baseRevision: source.revision,
    commands,
    selectionBefore,
    selectionAfter,
    inputType: options.inputType,
    compositionId: options.compositionId,
    timestamp: options.timestamp ?? 1
  }
}

function textAnchor(source: HwpxSourcePackage, text: string) {
  const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === text)
  if (!anchor) throw new Error(`테스트 anchor를 찾을 수 없습니다: ${text}`)
  return anchor
}

describe('HWPX edit transaction과 bounded history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-history-'))
  const fixture = createRoundTripHwpx(directory)
  const privateFixture = process.env['HAN_FLOW_PRIVATE_HWPX']

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('여러 command를 원자적으로 적용하고 inverse transaction으로 원문을 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalSection = source.readEntry(sectionPath)
    const first = textAnchor(source, '공개 헤더')
    const second = textAnchor(source, '긴 설명')
    const edit = transaction(
      source,
      'multi-edit',
      [
        command(first.textNodeId, 0, first.text.length, '첫 수정'),
        command(second.textNodeId, 0, second.text.length, '둘째 수정')
      ],
      selection(first.textNodeId, 0),
      selection(second.textNodeId, '둘째 수정'.length)
    )

    const applied = applyEditTransaction(source, edit)
    expect(applied.changed).toBe(true)
    expect(applied.package.revision).toBe(2)
    expect(applied.lossReport.modifiedEntries).toEqual([sectionPath])
    expect(textAnchor(applied.package, '첫 수정')).toBeDefined()
    expect(textAnchor(applied.package, '둘째 수정')).toBeDefined()
    const projection = await projectEditTransaction(applied)
    expect(JSON.stringify(projection)).toContain('첫 수정')
    expect(JSON.stringify(projection)).toContain('둘째 수정')

    const restored = applyEditTransaction(applied.package, applied.inverse!)
    expect(restored.package.readEntry(sectionPath)).toEqual(originalSection)
  })

  test('no-op transaction은 inverse나 history entry를 만들지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = textAnchor(source, '공개 헤더')
    const noOp = transaction(
      source,
      'no-op',
      [command(anchor.textNodeId, 0, anchor.text.length, anchor.text)],
      selection(anchor.textNodeId, 0),
      selection(anchor.textNodeId, 0)
    )
    const applied = applyEditTransaction(source, noOp)
    expect(applied.changed).toBe(false)
    expect(applied.inverse).toBeUndefined()

    const history = new HwpxEditHistory(source)
    history.commit(noOp)
    expect(history.stats().undoEntries).toBe(0)
    expect(history.isDirty).toBe(false)

    const movedSelection = selection(anchor.textNodeId, anchor.text.length)
    history.commitSynchronized(transaction(
      history.package,
      'no-op-selection-sync',
      [command(anchor.textNodeId, 0, anchor.text.length, anchor.text)],
      selection(anchor.textNodeId, 0),
      movedSelection
    ))
    expect(history.selection).toEqual(movedSelection)
    expect(history.stats().undoEntries).toBe(0)
    expect(history.isDirty).toBe(false)
  })

  test('중간 command가 실패하면 호출자 package에 부분 결과가 남지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalSection = source.readEntry(sectionPath)
    const first = textAnchor(source, '공개 헤더')
    const invalid = transaction(
      source,
      'atomic-failure',
      [command(first.textNodeId, 0, first.text.length, '부분 수정 금지'), command('missing-anchor', 0, 0, '실패')],
      selection(first.textNodeId, 0),
      selection(first.textNodeId, 0)
    )

    expect(() => applyEditTransaction(source, invalid)).toThrow(HwpxEditConflictError)
    expect(source.revision).toBe(0)
    expect(source.readEntry(sectionPath)).toEqual(originalSection)
  })

  test('동기화 commit 실패는 package·selection·history stack을 모두 원자적으로 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const first = textAnchor(source, '공개 헤더')
    const second = textAnchor(source, '긴 설명')
    const history = new HwpxEditHistory(source)
    const originalSelection = selection(second.textNodeId, 1)
    history.setSelection(originalSelection)
    const before = history.stats()

    expect(() => history.commitSynchronized(transaction(
      history.package,
      'synchronized-atomic-failure',
      [
        command(first.textNodeId, 0, first.text.length, '임시 변경'),
        command('missing-anchor', 0, 0, '실패')
      ],
      selection(first.textNodeId, 0),
      selection(first.textNodeId, 5)
    ))).toThrow(HwpxEditConflictError)

    expect(history.package).toBe(source)
    expect(history.selection).toEqual(originalSelection)
    expect(history.stats()).toEqual(before)
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(false)
    expect(history.isDirty).toBe(false)
  })

  test('undo 뒤 실패한 새 branch는 기존 redo stack과 selection을 보존한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = textAnchor(source, '공개 헤더')
    const end = anchor.text.length
    const history = new HwpxEditHistory(source)
    history.commitSynchronized(transaction(
      history.package,
      'redo-preserve-a',
      [command(anchor.textNodeId, end, end, 'A')],
      selection(anchor.textNodeId, end),
      selection(anchor.textNodeId, end + 1)
    ))
    history.undo()
    const beforePackage = history.package
    const beforeSelection = history.selection
    const before = history.stats()

    expect(() => history.commitSynchronized(transaction(
      history.package,
      'redo-preserve-failure',
      [
        command(anchor.textNodeId, 0, 0, '임시'),
        command('missing-anchor', 0, 0, '실패')
      ],
      selection(anchor.textNodeId, 0),
      selection(anchor.textNodeId, 2)
    ))).toThrow(HwpxEditConflictError)

    expect(history.package).toBe(beforePackage)
    expect(history.selection).toEqual(beforeSelection)
    expect(history.stats()).toEqual(before)
    expect(history.canRedo).toBe(true)
  })

  test('연속 타이핑을 한 undo 단위로 묶고 undo/redo selection을 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalSection = source.readEntry(sectionPath)
    const anchor = textAnchor(source, '공개 헤더')
    const history = new HwpxEditHistory(source)
    const end = anchor.text.length

    const first = transaction(
      history.package,
      'type-a',
      [command(anchor.textNodeId, end, end, 'A')],
      selection(anchor.textNodeId, end),
      selection(anchor.textNodeId, end + 1),
      { inputType: 'insertText', timestamp: 100 }
    )
    history.commit(first)
    expect(history.saveLossPolicy).toMatchObject({
      structures: [{ structure: 'text', compatibilityRisk: 'low' }],
      previewStatus: 'stale',
      untouchedContent: 'preserved',
      notices: ['PREVIEW_STALE'],
      reviewRecommended: true
    })
    const second = transaction(
      history.package,
      'type-b',
      [command(anchor.textNodeId, end + 1, end + 1, 'B')],
      selection(anchor.textNodeId, end + 1),
      selection(anchor.textNodeId, end + 2),
      { inputType: 'insertText', timestamp: 200 }
    )
    history.commit(second)
    const third = transaction(
      history.package,
      'type-c',
      [command(anchor.textNodeId, end + 2, end + 2, 'C')],
      selection(anchor.textNodeId, end + 2),
      selection(anchor.textNodeId, end + 3),
      { inputType: 'insertText', timestamp: 300 }
    )
    history.commit(third)

    expect(history.stats().undoEntries).toBe(1)
    expect(history.isDirty).toBe(true)
    expect(history.undo()?.selection).toEqual(selection(anchor.textNodeId, end))
    expect(history.package.readEntry(sectionPath)).toEqual(originalSection)
    expect(history.isDirty).toBe(false)
    expect(history.saveLossPolicy).toMatchObject({
      structures: [],
      previewStatus: 'current',
      notices: [],
      reviewRecommended: false
    })
    expect(history.redo()?.selection).toEqual(selection(anchor.textNodeId, end + 3))
    expect(textAnchor(history.package, '공개 헤더ABC')).toBeDefined()
    expect(history.saveLossPolicy.structures.map(({ structure }) => structure)).toEqual(['text'])
  })

  test('savepoint 뒤 edit는 별도 undo 단위이며 저장 상태 dirty를 정확히 복원한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = textAnchor(source, '공개 헤더')
    const history = new HwpxEditHistory(source)
    const end = anchor.text.length

    history.commit(
      transaction(
        history.package,
        'saved-a',
        [command(anchor.textNodeId, end, end, 'A')],
        selection(anchor.textNodeId, end),
        selection(anchor.textNodeId, end + 1),
        { inputType: 'insertText', timestamp: 100 }
      )
    )
    expect(history.stats()).toMatchObject({ revision: 1, savedRevision: 0, isDirty: true })
    history.markSaved()
    expect(history.isDirty).toBe(false)
    expect(history.stats()).toMatchObject({ revision: 1, savedRevision: 1, isDirty: false })

    history.commit(
      transaction(
        history.package,
        'after-save-b',
        [command(anchor.textNodeId, end + 1, end + 1, 'B')],
        selection(anchor.textNodeId, end + 1),
        selection(anchor.textNodeId, end + 2),
        { inputType: 'insertText', timestamp: 200 }
      )
    )
    expect(history.stats().undoEntries).toBe(2)
    expect(history.stats()).toMatchObject({ revision: 2, savedRevision: 1, isDirty: true })
    expect(history.isDirty).toBe(true)
    history.undo()
    expect(textAnchor(history.package, '공개 헤더A')).toBeDefined()
    expect(history.isDirty).toBe(false)
    expect(history.stats()).toMatchObject({ revision: 3, savedRevision: 1, isDirty: false })
    history.redo()
    expect(history.isDirty).toBe(true)
    expect(history.stats()).toMatchObject({ revision: 4, savedRevision: 1, isDirty: true })
  })

  test('undo 뒤 새 branch는 redo를 지우고 entry 수·byte 제한을 지킨다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = textAnchor(source, '공개 헤더')
    const history = new HwpxEditHistory(source, { maxEntries: 2, maxBytes: 8_192 })
    let offset = anchor.text.length

    for (const [index, letter] of ['A', 'B', 'C'].entries()) {
      history.commit(
        transaction(
          history.package,
          `paste-${index}`,
          [command(anchor.textNodeId, offset, offset, letter)],
          selection(anchor.textNodeId, offset),
          selection(anchor.textNodeId, offset + 1),
          { inputType: 'insertFromPaste', timestamp: index + 1 }
        )
      )
      offset += 1
    }
    expect(history.stats().undoEntries).toBe(2)
    history.undo()
    expect(history.canRedo).toBe(true)
    offset -= 1
    history.commit(
      transaction(
        history.package,
        'branch-d',
        [command(anchor.textNodeId, offset, offset, 'D')],
        selection(anchor.textNodeId, offset),
        selection(anchor.textNodeId, offset + 1),
        { inputType: 'insertFromPaste', timestamp: 10 }
      )
    )
    expect(history.canRedo).toBe(false)
    expect(textAnchor(history.package, '공개 헤더ABD')).toBeDefined()

    const limited = new HwpxEditHistory(source, { maxBytes: 600 })
    expect(() =>
      limited.commitSynchronized(
        transaction(
          limited.package,
          'too-large',
          [command(anchor.textNodeId, 0, 0, 'X'.repeat(1_000))],
          selection(anchor.textNodeId, 0),
          selection(anchor.textNodeId, 1_000)
        )
      )
    ).toThrow(HwpxHistoryLimitError)
    expect(limited.package).toBe(source)
    expect(limited.selection).toBeUndefined()
    expect(limited.stats()).toMatchObject({
      undoEntries: 0,
      redoEntries: 0,
      revision: 0,
      savedRevision: 0,
      isDirty: false
    })
  })

  test('composition·불연속 selection·stale revision은 grouping 또는 commit을 허용하지 않는다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = textAnchor(source, '공개 헤더')
    const end = anchor.text.length
    const first = transaction(
      source,
      'composition-a',
      [command(anchor.textNodeId, end, end, '가')],
      selection(anchor.textNodeId, end),
      selection(anchor.textNodeId, end + 1),
      { inputType: 'insertText', compositionId: 'ime-1', timestamp: 100 }
    )
    const next = {
      ...transaction(
        source,
        'composition-b',
        [command(anchor.textNodeId, end + 1, end + 1, '나')],
        selection(anchor.textNodeId, end + 1),
        selection(anchor.textNodeId, end + 2),
        { inputType: 'insertText', compositionId: 'ime-2', timestamp: 200 }
      ),
      baseRevision: 1
    }
    expect(shouldGroupTransactions(first, next)).toBe(false)
    expect(
      shouldGroupTransactions(
        { ...first, compositionId: undefined, commands: Array(MAX_TRANSACTION_COMMANDS).fill(first.commands[0]) },
        { ...next, compositionId: undefined }
      )
    ).toBe(false)
    expect(() => applyEditTransaction(source, { ...first, baseRevision: 99 })).toThrow(HwpxEditConflictError)
  })

  test('undo 상태와 redo 상태를 각각 검증된 HWPX로 Save As한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const originalHash = hash(readFileSync(fixture))
    const anchor = textAnchor(source, '공개 헤더')
    const history = new HwpxEditHistory(source)
    history.commit(
      transaction(
        history.package,
        'save-state',
        [command(anchor.textNodeId, 0, anchor.text.length, 'history 저장')],
        selection(anchor.textNodeId, 0),
        selection(anchor.textNodeId, 'history 저장'.length)
      )
    )

    history.undo()
    const undoPath = join(directory, 'history-undo.hwpx')
    await saveHwpxAs(history.package, undoPath, {
      verify: (saved) => expect(textAnchor(saved, '공개 헤더')).toBeDefined()
    })

    history.redo()
    const redoPath = join(directory, 'history-redo.hwpx')
    await saveHwpxAs(history.package, redoPath, {
      verify: (saved) => expect(textAnchor(saved, 'history 저장')).toBeDefined()
    })
    expect(hash(readFileSync(fixture))).toBe(originalHash)
  })
  ;(privateFixture ? test : test.skip)(
    '비공개 실문서 transaction을 undo/redo하고 본문 노출 없이 Save As한다',
    async () => {
      const originalHash = hash(readFileSync(privateFixture!))
      const source = await HwpxSourcePackage.open(privateFixture!)
      const privateSection = source
        .listEntries()
        .map((entry) => entry.path)
        .find((path) => /^Contents\/section\d+\.xml$/.test(path))
      if (!privateSection) throw new Error('실문서 section을 찾을 수 없습니다.')
      const anchor = listHwpxTextAnchors(source, privateSection).find((candidate) => candidate.text.length > 0)
      if (!anchor) throw new Error('실문서 text anchor를 찾을 수 없습니다.')
      const privateSelection = (offset: number): EditorSelection => ({
        sectionPath: privateSection,
        anchorTextNodeId: anchor.textNodeId,
        anchorOffset: offset,
        focusTextNodeId: anchor.textNodeId,
        focusOffset: offset
      })
      const history = new HwpxEditHistory(source)
      history.commit({
        id: 'private-transaction',
        baseRevision: 0,
        commands: [
          {
            type: 'replace-text',
            sectionPath: privateSection,
            textNodeId: anchor.textNodeId,
            from: anchor.text.length,
            to: anchor.text.length,
            insert: ' '
          }
        ],
        selectionBefore: privateSelection(anchor.text.length),
        selectionAfter: privateSelection(anchor.text.length + 1),
        timestamp: 1
      })
      history.undo()
      history.redo()
      await saveHwpxAs(history.package, join(directory, 'private-history.hwpx'))
      expect(hash(readFileSync(privateFixture!))).toBe(originalHash)
    }
  )
})
