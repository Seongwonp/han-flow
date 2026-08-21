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
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusTextNodeId: anchor.textNodeId,
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

  test('caret 이동을 selection으로 동기화하고 제한된 글자·문단 style을 undo/redo한다', async () => {
    const manager = new EditingSessionManager(() => 'style-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === ''
    )!
    const started = await manager.start(21, fixture)
    const caret = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    const boldOff = await manager.applyCharacterStyle(21, {
      sessionId: started.sessionId,
      transactionId: 'style-bold-off',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection: caret,
      bold: false,
      timestamp: 1
    })
    const charItem = boldOff.document.sections[0].blocks.at(-1)?.content[0]
    expect(charItem?.type).toBe('text')
    expect(
      charItem?.type === 'text'
        ? boldOff.document.charStyles[charItem.charStyleId]?.bold
        : undefined
    ).toBe(false)
    expect(boldOff).toMatchObject({ canUndo: true, isDirty: true, selection: caret })

    const centered = await manager.applyParagraphStyle(21, {
      sessionId: started.sessionId,
      transactionId: 'style-center',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection: caret,
      align: 'CENTER',
      timestamp: 2
    })
    const paragraph = centered.document.sections[0].blocks.at(-1)!
    expect(centered.document.paraStyles[paragraph.paraStyleId]?.align).toBe('CENTER')

    const undoParagraph = await manager.undo(21, started.sessionId)
    const undoParagraphBlock = undoParagraph.document.sections[0].blocks.at(-1)!
    expect(undoParagraph.document.paraStyles[undoParagraphBlock.paraStyleId]?.align).toBe('LEFT')
    const undoCharacter = await manager.undo(21, started.sessionId)
    const undoCharacterItem = undoCharacter.document.sections[0].blocks.at(-1)?.content[0]
    expect(
      undoCharacterItem?.type === 'text'
        ? undoCharacter.document.charStyles[undoCharacterItem.charStyleId]?.bold
        : undefined
    ).toBe(true)
    expect(undoCharacter.isDirty).toBe(false)
    expect(await manager.redo(21, started.sessionId)).toMatchObject({ isDirty: true })
  })

  test('부분 선택 글자 style은 선택 구간 run을 분할하고 선택과 undo·redo를 이동한다', async () => {
    const manager = new EditingSessionManager(() => 'partial-style-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === ''
    )!
    const started = await manager.start(23, fixture)
    const emptyCaret = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    await manager.commit(23, {
      sessionId: started.sessionId,
      transactionId: 'partial-text',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: 0,
      to: 0,
      insert: '부분굵게검증',
      selectionBefore: emptyCaret,
      selectionAfter: { ...emptyCaret, anchorOffset: 6, focusOffset: 6 },
      inputType: 'insertText',
      timestamp: 1
    })
    const selected = { ...emptyCaret, anchorOffset: 4, focusOffset: 2 }
    const styled = await manager.applyCharacterStyle(23, {
      sessionId: started.sessionId,
      transactionId: 'partial-bold',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection: selected,
      bold: false,
      timestamp: 2
    })
    const content = styled.document.sections[0].blocks.at(-1)?.content
    expect(content).toMatchObject([
      { type: 'text', text: '부분' },
      { type: 'text', text: '굵게' },
      { type: 'text', text: '검증' }
    ])
    expect(styled.selection).toEqual({
      ...selected,
      anchorTextNodeId: `${anchor.sectionPath}#hp:t:${anchor.ordinal + 1}`,
      anchorOffset: 2,
      focusTextNodeId: `${anchor.sectionPath}#hp:t:${anchor.ordinal + 1}`,
      focusOffset: 0
    })
    expect(
      content?.[1]?.type === 'text'
        ? styled.document.charStyles[content[1].charStyleId]?.bold
        : undefined
    ).toBe(false)

    const undone = await manager.undo(23, started.sessionId)
    expect(undone.document.sections[0].blocks.at(-1)?.content).toMatchObject([
      { type: 'text', text: '부분굵게검증' }
    ])
    expect(undone.selection).toEqual(selected)
    const redone = await manager.redo(23, started.sessionId)
    expect(redone.document.sections[0].blocks.at(-1)?.content).toHaveLength(3)
    expect(redone.selection).toEqual(styled.selection)
  })

  test('기울임·밑줄·취소선 요청을 projection과 history에 반영한다', async () => {
    const manager = new EditingSessionManager(() => 'decoration-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === ''
    )!
    const started = await manager.start(26, fixture)
    const caret = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    const styled = await manager.applyCharacterStyle(26, {
      sessionId: started.sessionId,
      transactionId: 'style-decorations',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection: caret,
      italic: true,
      underline: true,
      strikeout: true,
      timestamp: 1
    })
    const item = styled.document.sections[0].blocks.at(-1)?.content[0]
    expect(item?.type).toBe('text')
    expect(item?.type === 'text' ? styled.document.charStyles[item.charStyleId] : undefined)
      .toMatchObject({ italic: true, underline: true, strikeout: true })
    const undone = await manager.undo(26, started.sessionId)
    const restoredItem = undone.document.sections[0].blocks.at(-1)?.content[0]
    expect(restoredItem?.type === 'text' ? undone.document.charStyles[restoredItem.charStyleId] : undefined)
      .toMatchObject({ italic: false, underline: false, strikeout: false })
    const redone = await manager.redo(26, started.sessionId)
    const redoneItem = redone.document.sections[0].blocks.at(-1)?.content[0]
    expect(redoneItem?.type === 'text' ? redone.document.charStyles[redoneItem.charStyleId] : undefined)
      .toMatchObject({ italic: true, underline: true, strikeout: true })
  })

  test('줄 간격과 문단 앞뒤 간격 요청을 projection과 history에 반영한다', async () => {
    const manager = new EditingSessionManager(() => 'paragraph-spacing-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === ''
    )!
    const started = await manager.start(27, fixture)
    const caret = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    const styled = await manager.applyParagraphStyle(27, {
      sessionId: started.sessionId,
      transactionId: 'paragraph-spacing',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection: caret,
      lineSpacing: 180,
      indent: -200,
      marginBefore: 200,
      marginAfter: 300,
      timestamp: 1
    })
    const paragraph = styled.document.sections[0].blocks.at(-1)!
    expect(styled.document.paraStyles[paragraph.paraStyleId]).toMatchObject({
      lineSpacing: 180,
      indent: -200,
      margin: { top: 200, bottom: 300 }
    })
    const undone = await manager.undo(27, started.sessionId)
    const restored = undone.document.sections[0].blocks.at(-1)!
    expect(undone.document.paraStyles[restored.paraStyleId]).toMatchObject({
      lineSpacing: 160,
      indent: 0,
      margin: { top: 0, bottom: 0 }
    })
    const redone = await manager.redo(27, started.sessionId)
    const redoneParagraph = redone.document.sections[0].blocks.at(-1)!
    expect(redone.document.paraStyles[redoneParagraph.paraStyleId]).toMatchObject({
      lineSpacing: 180,
      indent: -200,
      margin: { top: 200, bottom: 300 }
    })
  })

  test('부분 글자 style과 문단 정렬을 함께 적용한 package를 안전하게 저장하고 재개봉한다', async () => {
    const manager = new EditingSessionManager(() => 'styled-save-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === ''
    )!
    const started = await manager.start(25, fixture)
    const emptyCaret = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    await manager.commit(25, {
      sessionId: started.sessionId,
      transactionId: 'styled-save-text',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: 0,
      to: 0,
      insert: '부분스타일저장',
      selectionBefore: emptyCaret,
      selectionAfter: { ...emptyCaret, anchorOffset: 7, focusOffset: 7 },
      inputType: 'insertText',
      timestamp: 1
    })
    const selection = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 4,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 2
    }
    const styled = await manager.applyCharacterStyle(25, {
      sessionId: started.sessionId,
      transactionId: 'styled-save-character',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      selection,
      height: 1200,
      color: '#336699',
      timestamp: 2
    })
    await manager.applyParagraphStyle(25, {
      sessionId: started.sessionId,
      transactionId: 'styled-save-paragraph',
      sectionPath: anchor.sectionPath,
      textNodeId: styled.selection!.focusTextNodeId,
      selection: styled.selection!,
      align: 'CENTER',
      timestamp: 3
    })

    const destination = join(directory, 'styled-save-session.hwpx')
    const saved = await manager.saveAs(25, started.sessionId, destination)
    expect(saved).toMatchObject({ isDirty: false, revision: 6 })
    const reopened = await HwpxSourcePackage.open(destination)
    const reopenedAnchors = listHwpxTextAnchors(reopened, anchor.sectionPath)
    expect(reopenedAnchors.filter((candidate) => candidate.textNodeId.startsWith(`${anchor.sectionPath}#hp:t:`)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ text: '부분' }),
        expect.objectContaining({ text: '스타' }),
        expect.objectContaining({ text: '일저장' })
      ]))
    const headerXml = reopened.readEntry('Contents/header.xml').toString('utf8')
    expect(headerXml).toContain('height="1200"')
    expect(headerXml).toContain('textColor="#336699"')
    expect(headerXml).toContain('horizontal="CENTER"')
  })

  test('일반 표 body cell의 단일 hp:t를 기존 transaction으로 편집하고 undo·redo한다', async () => {
    const manager = new EditingSessionManager(() => 'table-cell-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === '긴 설명'
    )!
    const started = await manager.start(24, fixture)
    const before = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: anchor.text.length
    }
    const after = {
      ...before,
      anchorOffset: anchor.text.length + 4,
      focusOffset: anchor.text.length + 4
    }
    const committed = await manager.commit(24, {
      sessionId: started.sessionId,
      transactionId: 'table-cell-text',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: anchor.text.length,
      to: anchor.text.length,
      insert: ' 셀검증',
      selectionBefore: before,
      selectionAfter: after,
      inputType: 'insertText',
      timestamp: 1
    })
    expect(JSON.stringify(committed.document)).toContain('긴 설명 셀검증')
    expect(committed).toMatchObject({ canUndo: true, isDirty: true, selection: after })

    const undone = await manager.undo(24, started.sessionId)
    expect(JSON.stringify(undone.document)).toContain('"text":"긴 설명"')
    expect(JSON.stringify(undone.document)).not.toContain('셀검증')
    const redone = await manager.redo(24, started.sessionId)
    expect(JSON.stringify(redone.document)).toContain('긴 설명 셀검증')
  })

  test('이전 commit 뒤 caret를 옮긴 다음 text transaction을 계속 허용한다', async () => {
    const manager = new EditingSessionManager(() => 'caret-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, 'Contents/section0.xml').find(
      (candidate) => candidate.text === '공개 헤더'
    )!
    const started = await manager.start(22, fixture)
    const atEnd = {
      sectionPath: anchor.sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: anchor.text.length
    }
    await manager.commit(22, {
      sessionId: started.sessionId,
      transactionId: 'caret-first',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: anchor.text.length,
      to: anchor.text.length,
      insert: 'A',
      selectionBefore: atEnd,
      selectionAfter: { ...atEnd, anchorOffset: anchor.text.length + 1, focusOffset: anchor.text.length + 1 },
      inputType: 'insertText',
      timestamp: 1
    })
    const movedToStart = { ...atEnd, anchorOffset: 0, focusOffset: 0 }
    const second = await manager.commit(22, {
      sessionId: started.sessionId,
      transactionId: 'caret-second',
      sectionPath: anchor.sectionPath,
      textNodeId: anchor.textNodeId,
      from: 0,
      to: 0,
      insert: 'B',
      selectionBefore: movedToStart,
      selectionAfter: { ...movedToStart, anchorOffset: 1, focusOffset: 1 },
      inputType: 'insertText',
      timestamp: 2
    })
    expect(JSON.stringify(second.document)).toContain('B공개 헤더A')
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
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: anchor.text.length,
      focusTextNodeId: anchor.textNodeId,
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
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
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
