import {
  CompositionCommitBuffer,
  CompositionInputController,
  diffTextInput
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
