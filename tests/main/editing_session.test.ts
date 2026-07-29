import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { EditingSessionManager } from '../../src/main/editing_session'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('main process HWPX editing session', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-session-'))
  const fixture = createRoundTripHwpx(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('renderer command를 직렬화해 commit, undo, redo projection을 반환한다', async () => {
    const manager = new EditingSessionManager(() => 'session-1')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === '공개 헤더'
    )!
    const started = await manager.start(7, fixture)
    const before = {
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusOffset: anchor.text.length
    }
    const after = {
      ...before,
      anchorOffset: anchor.text.length + 3,
      focusOffset: anchor.text.length + 3
    }
    const committed = await manager.commit(7, {
      sessionId: started.sessionId,
      transactionId: 'typing-1',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: anchor.text.length,
      to: anchor.text.length,
      insert: ' 수정',
      selectionBefore: before,
      selectionAfter: after,
      inputType: 'insertText',
      timestamp: 1
    })

    expect(committed).toMatchObject({
      revision: 1,
      canUndo: true,
      canRedo: false,
      isDirty: true,
      selection: after
    })
    expect(JSON.stringify(committed.document)).toContain('공개 헤더 수정')

    const undone = await manager.undo(7, started.sessionId)
    expect(undone).toMatchObject({ canUndo: false, canRedo: true, isDirty: false })
    expect(JSON.stringify(undone.document)).not.toContain('공개 헤더 수정')

    const redone = await manager.redo(7, started.sessionId)
    expect(redone).toMatchObject({ canUndo: true, canRedo: false, isDirty: true })
    expect(JSON.stringify(redone.document)).toContain('공개 헤더 수정')
  })

  test('sender와 session ID가 다르면 편집 상태에 접근하지 못한다', async () => {
    const manager = new EditingSessionManager(() => 'bound-session')
    await manager.start(1, fixture)
    await expect(manager.undo(2, 'bound-session')).rejects.toThrow('유효하지 않거나 종료된')
    await expect(manager.redo(1, 'other-session')).rejects.toThrow('유효하지 않거나 종료된')
  })

  test('.hwp는 편집 session을 시작하지 않는다', async () => {
    const manager = new EditingSessionManager()
    await expect(manager.start(1, join(directory, 'document.hwp'))).rejects.toThrow(
      'HWPX 문서만'
    )
  })

  test('검증형 Save As 성공 뒤에만 savepoint를 이동하고 원본을 보존한다', async () => {
    const manager = new EditingSessionManager(() => 'save-session')
    const sourceBytes = readFileSync(fixture)
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === '공개 헤더'
    )!
    const started = await manager.start(11, fixture)
    expect(manager.currentSessionId(11)).toBe(started.sessionId)
    expect(manager.isDirty(11, started.sessionId)).toBe(false)
    const before = {
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusOffset: anchor.text.length
    }
    const after = {
      ...before,
      anchorOffset: anchor.text.length + 3,
      focusOffset: anchor.text.length + 3
    }
    await manager.commit(11, {
      sessionId: started.sessionId,
      transactionId: 'save-edit',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: anchor.text.length,
      to: anchor.text.length,
      insert: ' 저장',
      selectionBefore: before,
      selectionAfter: after,
      inputType: 'insertText',
      timestamp: 1
    })
    expect(manager.isDirty(11, started.sessionId)).toBe(true)

    expect(manager.suggestedSaveAsPath(11, started.sessionId)).toBe(
      join(directory, 'han-flow-round-trip_수정본.hwpx')
    )
    const destination = join(directory, 'saved-session.hwpx')
    const saved = await manager.saveAs(11, started.sessionId, destination)
    expect(saved).toMatchObject({
      destinationPath: destination,
      revision: 1,
      canUndo: true,
      canRedo: false,
      isDirty: false,
      previewStatus: 'stale'
    })
    expect(existsSync(destination)).toBe(true)
    expect(manager.isDirty(11, started.sessionId)).toBe(false)
    expect(readFileSync(fixture)).toEqual(sourceBytes)
    expect(
      listHwpxTextAnchors(
        await HwpxSourcePackage.open(destination),
        'Contents/section0.xml'
      ).find((candidate) => candidate.textNodeId === anchor.textNodeId)?.text
    ).toBe('공개 헤더 저장')

    expect(await manager.undo(11, started.sessionId)).toMatchObject({ isDirty: true })
    expect(await manager.redo(11, started.sessionId)).toMatchObject({ isDirty: false })
  })

  test('취소·충돌에 해당하는 저장 실패는 dirty와 목적지를 바꾸지 않는다', async () => {
    const manager = new EditingSessionManager(() => 'failed-save-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === '공개 헤더'
    )!
    const started = await manager.start(12, fixture)
    const selection = {
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusOffset: 0
    }
    await manager.commit(12, {
      sessionId: started.sessionId,
      transactionId: 'failed-save-edit',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: 0,
      to: 0,
      insert: 'X',
      selectionBefore: selection,
      selectionAfter: { ...selection, anchorOffset: 1, focusOffset: 1 },
      timestamp: 1
    })

    const existing = join(directory, 'existing-save.hwpx')
    writeFileSync(existing, '기존 파일')
    await expect(manager.saveAs(12, started.sessionId, existing)).rejects.toMatchObject({
      code: 'EEXIST'
    })
    expect(readFileSync(existing, 'utf8')).toBe('기존 파일')
    expect(await manager.undo(12, started.sessionId)).toMatchObject({ isDirty: false })
  })
})
