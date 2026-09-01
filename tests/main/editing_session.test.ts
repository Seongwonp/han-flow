import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { saveHwpxAs } from '../../src/core/editing/save_as'
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
    expect(started).toMatchObject({ revision: 0, savedRevision: 0, isDirty: false })
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
      savedRevision: 0,
      canUndo: true,
      canRedo: false,
      isDirty: true,
      selection: after
    })
    expect(JSON.stringify(committed.document)).toContain('공개 헤더 수정')

    const refreshed = await manager.refresh(7, started.sessionId)
    expect(refreshed).toMatchObject({
      revision: 1,
      canUndo: true,
      canRedo: false,
      isDirty: true,
      selection: after
    })
    expect(JSON.stringify(refreshed.document)).toContain('공개 헤더 수정')

    const undone = await manager.undo(7, started.sessionId)
    expect(undone).toMatchObject({ canUndo: false, canRedo: true, isDirty: false })
    expect(JSON.stringify(undone.document)).not.toContain('공개 헤더 수정')

    const redone = await manager.redo(7, started.sessionId)
    expect(redone).toMatchObject({ canUndo: true, canRedo: false, isDirty: true })
    expect(JSON.stringify(redone.document)).toContain('공개 헤더 수정')
  })

  test('여러 run 범위를 원자적으로 치환하고 역방향 selection을 undo/redo한다', async () => {
    const manager = new EditingSessionManager(() => 'range-session')
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, 'Contents/section0.xml').filter(
      (candidate) => candidate.text.length >= 2
    )
    const first = anchors[0]
    const last = anchors[1]
    const started = await manager.start(28, fixture)
    const backward = {
      sectionPath: first.sectionPath,
      anchorTextNodeId: last.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: first.textNodeId,
      focusOffset: 1
    }
    const committed = await manager.commitRange(28, {
      sessionId: started.sessionId,
      transactionId: 'range-replace',
      selectionBefore: backward,
      insert: '다중범위',
      inputType: 'insertText',
      timestamp: 1
    })

    expect(committed).toMatchObject({ canUndo: true, isDirty: true })
    expect(committed.selection).toMatchObject({
      anchorTextNodeId: first.textNodeId,
      anchorOffset: 5,
      focusTextNodeId: first.textNodeId,
      focusOffset: 5
    })
    expect((await manager.undo(28, started.sessionId)).selection).toEqual(backward)
    expect((await manager.redo(28, started.sessionId)).selection).toEqual(committed.selection)
    const destination = join(directory, 'multi-run-range-save.hwpx')
    await manager.saveAs(28, started.sessionId, destination)
    const reopened = await HwpxSourcePackage.open(destination)
    const reopenedFirst = listHwpxTextAnchors(reopened, first.sectionPath).find(
      (candidate) => candidate.textNodeId === first.textNodeId
    )
    expect(reopenedFirst?.text).toBe(`${first.text.slice(0, 1)}다중범위`)
  })

  test('Enter 문단 나눔을 undo/redo하고 Save As 재개봉한다', async () => {
    const manager = new EditingSessionManager(() => 'split-session')
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const anchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === ''
    )!
    const emptyCount = listHwpxTextAnchors(source, sectionPath).filter(
      (candidate) => candidate.text === ''
    ).length
    const started = await manager.start(29, fixture)
    const selection = {
      sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    const split = await manager.splitParagraph(29, {
      sessionId: started.sessionId,
      transactionId: 'split-paragraph',
      selectionBefore: selection,
      timestamp: 1
    })

    expect(split).toMatchObject({ revision: 1, canUndo: true, isDirty: true })
    expect(split.selection).toEqual({
      ...selection,
      anchorTextNodeId: `${sectionPath}#hp:t:${anchor.ordinal + 1}`,
      focusTextNodeId: `${sectionPath}#hp:t:${anchor.ordinal + 1}`
    })
    expect((await manager.undo(29, started.sessionId)).selection).toEqual(selection)
    expect((await manager.redo(29, started.sessionId)).selection).toEqual(split.selection)

    const destination = join(directory, 'paragraph-split-save.hwpx')
    await manager.saveAs(29, started.sessionId, destination)
    const reopened = await HwpxSourcePackage.open(destination)
    expect(listHwpxTextAnchors(reopened, sectionPath).filter(
      (candidate) => candidate.text === ''
    )).toHaveLength(emptyCount + 1)
  })

  test('문단 시작 Backspace 병합을 undo/redo하고 Save As 재개봉한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hs:sec>',
      '<hp:p id="30" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>병합 앞</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p><hp:p id="31" paraPrIDRef="1"><hp:run charPrIDRef="1"><hp:t>병합 뒤</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hs:sec>'
    )
    const mergeFixture = join(directory, 'paragraph-merge-input.hwpx')
    await saveHwpxAs(
      source.withEntry(sectionPath, Buffer.from(xml, 'utf8')),
      mergeFixture
    )
    const mergeSource = await HwpxSourcePackage.open(mergeFixture)
    const anchor = listHwpxTextAnchors(mergeSource, sectionPath).find(
      (candidate) => candidate.text === '병합 뒤'
    )!
    const selection = {
      sectionPath,
      anchorTextNodeId: anchor.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: anchor.textNodeId,
      focusOffset: 0
    }
    const manager = new EditingSessionManager(() => 'merge-session')
    const started = await manager.start(30, mergeFixture)
    const merged = await manager.mergeParagraph(30, {
      sessionId: started.sessionId,
      transactionId: 'merge-previous',
      selectionBefore: selection,
      direction: 'previous',
      inputType: 'deleteContentBackward',
      timestamp: 1
    })

    expect(merged).toMatchObject({ revision: 1, canUndo: true, isDirty: true })
    expect(merged.selection).toEqual(selection)
    expect((await manager.undo(30, started.sessionId)).selection).toEqual(selection)
    expect((await manager.redo(30, started.sessionId)).selection).toEqual(selection)

    const destination = join(directory, 'paragraph-merge-save.hwpx')
    await manager.saveAs(30, started.sessionId, destination)
    const reopened = await HwpxSourcePackage.open(destination)
    const reopenedXml = reopened.readEntry(sectionPath).toString('utf8')
    expect(reopenedXml).toContain(
      '<hp:p id="30" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>병합 앞</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>병합 뒤</hp:t></hp:run></hp:p>'
    )
    expect(reopenedXml).not.toContain('<hp:p id="31"')
  })

  test('여러 문단 범위 치환을 구조 command로 commit하고 Save As 재개봉한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const sectionPath = 'Contents/section0.xml'
    const xml = source.readEntry(sectionPath).toString('utf8').replace(
      '</hs:sec>',
      '<hp:p id="40" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>문단 시작</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p><hp:p id="41" paraPrIDRef="1"><hp:run charPrIDRef="1"><hp:t>문단 끝</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p></hs:sec>'
    )
    const rangeFixture = join(directory, 'paragraph-range-input.hwpx')
    await saveHwpxAs(
      source.withEntry(sectionPath, Buffer.from(xml, 'utf8')),
      rangeFixture
    )
    const rangeSource = await HwpxSourcePackage.open(rangeFixture)
    const anchors = listHwpxTextAnchors(rangeSource, sectionPath)
    const start = anchors.find((candidate) => candidate.text === '문단 시작')!
    const end = anchors.find((candidate) => candidate.text === '문단 끝')!
    const backward = {
      sectionPath,
      anchorTextNodeId: end.textNodeId,
      anchorOffset: 2,
      focusTextNodeId: start.textNodeId,
      focusOffset: 2
    }
    const manager = new EditingSessionManager(() => 'paragraph-range-session')
    const started = await manager.start(31, rangeFixture)
    const committed = await manager.commitRange(31, {
      sessionId: started.sessionId,
      transactionId: 'paragraph-range-replace',
      selectionBefore: backward,
      insert: '범위',
      inputType: 'insertText',
      timestamp: 1
    })

    expect(committed).toMatchObject({ revision: 1, canUndo: true, isDirty: true })
    expect(committed.selection).toEqual({
      sectionPath,
      anchorTextNodeId: start.textNodeId,
      anchorOffset: 4,
      focusTextNodeId: start.textNodeId,
      focusOffset: 4
    })
    expect((await manager.undo(31, started.sessionId)).selection).toEqual(backward)
    expect((await manager.redo(31, started.sessionId)).selection).toEqual(committed.selection)

    const destination = join(directory, 'paragraph-range-save.hwpx')
    await manager.saveAs(31, started.sessionId, destination)
    const reopenedXml = (await HwpxSourcePackage.open(destination))
      .readEntry(sectionPath)
      .toString('utf8')
    expect(reopenedXml).toContain(
      '<hp:p id="40" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>문단범위</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t> 끝</hp:t></hp:run></hp:p>'
    )
    expect(reopenedXml).not.toContain('<hp:p id="41"')
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
    await expect(manager.undo(2, 'bound-session')).rejects.toMatchObject({
      code: 'EDITING_SESSION_EXPIRED',
      recovery: 'restart-session'
    })
    await expect(manager.redo(1, 'other-session')).rejects.toMatchObject({
      code: 'EDITING_SESSION_EXPIRED',
      recovery: 'restart-session'
    })
  })

  test('.hwp는 편집 session을 시작하지 않는다', async () => {
    const manager = new EditingSessionManager()
    await expect(manager.start(1, join(directory, 'document.hwp'))).rejects.toMatchObject({
      code: 'EDITING_UNSUPPORTED',
      message: expect.stringContaining('HWPX 문서만')
    })
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
      savedRevision: 1,
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

    expect(await manager.undo(11, started.sessionId)).toMatchObject({
      revision: 2,
      savedRevision: 1,
      isDirty: true
    })
    expect(await manager.redo(11, started.sessionId)).toMatchObject({
      revision: 3,
      savedRevision: 1,
      isDirty: false
    })
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
      code: 'EDITING_SAVE_FAILED',
      recovery: 'retry',
      message: expect.stringContaining('변경본을 검증해 저장하지 못했습니다')
    })
    expect(readFileSync(existing, 'utf8')).toBe('기존 파일')
    expect(await manager.undo(12, started.sessionId)).toMatchObject({ isDirty: false })
  })
})
