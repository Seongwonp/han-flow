import {
  CompositionCommitBuffer,
  CompositionInputController,
  diffTextInput,
  flushPendingComposition
} from '../../src/core/editing/composition_input'

const caret = (offset: number) => ({ anchorOffset: offset, focusOffset: offset })

describe('HWPX composition input controller', () => {
  test('한글 조합 중간 input은 보류하고 compositionend에서 transaction 하나만 만든다', () => {
    const controller = new CompositionInputController('제목: ', caret(4))
    const compositionId = controller.compositionStart('제목: ', caret(4))

    expect(
      controller.input({
        text: '제목: ㄱ',
        selection: caret(5),
        inputType: 'insertCompositionText',
        isComposing: true,
        timestamp: 10
      })
    ).toBeUndefined()
    expect(
      controller.input({
        text: '제목: 가',
        selection: caret(5),
        inputType: 'insertCompositionText',
        isComposing: true,
        timestamp: 20
      })
    ).toBeUndefined()

    expect(
      controller.compositionEnd({
        text: '제목: 한',
        selection: caret(5),
        inputType: 'insertCompositionText',
        timestamp: 30
      })
    ).toEqual({
      from: 4,
      to: 4,
      insert: '한',
      selectionBefore: caret(4),
      selectionAfter: caret(5),
      inputType: 'insertCompositionText',
      compositionId,
      timestamp: 30
    })

    expect(
      controller.input({
        text: '제목: 한',
        selection: caret(5),
        inputType: 'insertText',
        timestamp: 31
      })
    ).toBeUndefined()
  })

  test('일반 입력과 삭제는 직전 DOM snapshot 기준 최소 diff를 만든다', () => {
    const controller = new CompositionInputController('abc', caret(3))
    expect(
      controller.input({
        text: 'abcd',
        selection: caret(4),
        inputType: 'insertText',
        timestamp: 1
      })
    ).toMatchObject({ from: 3, to: 3, insert: 'd' })
    expect(
      controller.input({
        text: 'abd',
        selection: caret(2),
        inputType: 'deleteContentBackward',
        timestamp: 2
      })
    ).toMatchObject({ from: 2, to: 3, insert: '' })
  })

  test('취소된 조합은 commit을 만들지 않는다', () => {
    const controller = new CompositionInputController('원문', caret(2))
    controller.compositionStart('원문', caret(2))
    controller.input({
      text: '원문ㄱ',
      selection: caret(3),
      inputType: 'insertCompositionText',
      isComposing: true,
      timestamp: 1
    })
    expect(
      controller.compositionEnd({
        text: '원문',
        selection: caret(2),
        timestamp: 2
      })
    ).toBeUndefined()
  })

  test('연속된 macOS 한글 음절 조합을 한 burst transaction으로 합친다', () => {
    const buffer = new CompositionCommitBuffer()
    buffer.begin('제목: ', caret(4), 'composition-1', 1)
    buffer.update({
      text: '제목: 한',
      selection: caret(5),
      inputType: 'insertCompositionText',
      timestamp: 2
    })
    buffer.begin('제목: 한', caret(5), 'composition-2', 3)
    buffer.update({
      text: '제목: 한글',
      selection: caret(6),
      inputType: 'insertCompositionText',
      timestamp: 4
    })
    buffer.update({
      text: '제목: 한글 ',
      selection: caret(7),
      inputType: 'insertText',
      timestamp: 5
    })

    expect(buffer.flush()).toEqual({
      from: 4,
      to: 4,
      insert: '한글 ',
      selectionBefore: caret(4),
      selectionAfter: caret(7),
      inputType: 'insertText',
      compositionId: 'composition-1',
      timestamp: 5
    })
    expect(buffer.pending).toBe(false)
    expect(buffer.flush()).toBeUndefined()
  })

  test('surrogate pair 내부를 자르지 않고 emoji 전체를 교체한다', () => {
    expect(
      diffTextInput('A😀B', 'A😃B', caret(3), caret(3), {
        inputType: 'insertText',
        timestamp: 1
      })
    ).toMatchObject({
      from: 1,
      to: 3,
      insert: '😃'
    })
  })
})

describe('편집 command 전 남은 조합 글자 반영(flushPendingComposition)', () => {
  // 입력 칸이 음절마다 compositionstart → 조합 input → compositionend를 받고, 음절 묶음은 대기 시간이 지나야 commit한다.
  const typeSyllables = (
    controller: CompositionInputController,
    buffer: CompositionCommitBuffer,
    base: string,
    syllables: string[]
  ) => {
    let text = base
    let timestamp = 0
    for (const syllable of syllables) {
      const id = controller.compositionStart(text, caret(text.length))
      buffer.begin(text, caret(text.length), id, timestamp)
      const composing = { text: text + syllable, selection: caret(text.length + 1), inputType: 'insertCompositionText', timestamp: ++timestamp }
      expect(controller.input({ ...composing, isComposing: true })).toBeUndefined()
      buffer.update({ ...composing, isComposing: true })
      text += syllable
      controller.compositionEnd({ text, selection: caret(text.length), inputType: 'insertCompositionText', timestamp: ++timestamp })
      buffer.update({ text, selection: caret(text.length), inputType: 'insertCompositionText', timestamp })
    }
    return text
  }

  test('compositionend 직후(음절 묶음 대기 중) 실행 취소 전에 남은 글자를 commit 하나로 내보낸다', () => {
    const controller = new CompositionInputController('', caret(0))
    const buffer = new CompositionCommitBuffer()
    const text = typeSyllables(controller, buffer, '', ['새', '각', '주'])

    // 예전에는 이 대기 동안 누른 실행 취소를 버렸다. 남은 글자가 있다는 것을 알아야 먼저 반영할 수 있다.
    expect(buffer.pending).toBe(true)
    const intent = flushPendingComposition(controller, buffer, { text, selection: caret(3), inputType: 'insertCompositionText', timestamp: 100 })

    expect(intent).toMatchObject({ from: 0, to: 0, insert: '새각주', selectionBefore: caret(0), selectionAfter: caret(3) })
    expect(buffer.pending).toBe(false)
    expect(controller.isComposing).toBe(false)
    // 대기 시간 timer가 뒤늦게 돌아도 같은 글자를 다시 보내지 않는다.
    expect(flushPendingComposition(controller, buffer, { text, selection: caret(3), timestamp: 101 })).toBeUndefined()
  })

  test('IME가 아직 조합 중이어도 지금 화면 글자를 확정 글자로 보내고, 뒤늦은 compositionend는 같은 글자를 다시 보내지 않는다', () => {
    const controller = new CompositionInputController('본문', caret(2))
    const buffer = new CompositionCommitBuffer()
    const id = controller.compositionStart('본문', caret(2))
    buffer.begin('본문', caret(2), id, 0)
    controller.input({ text: '본문가', selection: caret(3), inputType: 'insertCompositionText', isComposing: true, timestamp: 1 })
    buffer.update({ text: '본문가', selection: caret(3), inputType: 'insertCompositionText', isComposing: true, timestamp: 1 })
    expect(controller.isComposing).toBe(true)

    const intent = flushPendingComposition(controller, buffer, { text: '본문가', selection: caret(3), inputType: 'insertCompositionText', timestamp: 2 })
    expect(intent).toMatchObject({ from: 2, to: 2, insert: '가', compositionId: id })
    expect(controller.isComposing).toBe(false)

    expect(controller.compositionEnd({ text: '본문가', selection: caret(3), inputType: 'insertCompositionText', timestamp: 3 })).toBeUndefined()
    // IME가 확정하면서 글자를 바꿨으면 바뀐 만큼만 보낸다.
    expect(controller.compositionEnd({ text: '본문각', selection: caret(3), inputType: 'insertCompositionText', timestamp: 4 }))
      .toMatchObject({ from: 2, to: 3, insert: '각' })
  })

  test('묶음 없이 조합 input만 받은 입력 칸도 남은 조합 글자를 내보낸다', () => {
    const controller = new CompositionInputController('', caret(0))
    const buffer = new CompositionCommitBuffer()
    controller.input({ text: '한', selection: caret(1), inputType: 'insertCompositionText', isComposing: true, timestamp: 1 })

    expect(flushPendingComposition(controller, buffer, { text: '한', selection: caret(1), timestamp: 2 }))
      .toMatchObject({ from: 0, to: 0, insert: '한' })
    expect(flushPendingComposition(controller, buffer, { text: '한', selection: caret(1), timestamp: 3 })).toBeUndefined()
  })
})
