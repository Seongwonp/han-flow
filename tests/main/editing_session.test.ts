import { mkdtempSync, rmSync } from 'fs'
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
})
