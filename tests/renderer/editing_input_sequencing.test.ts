import type { EditingHistoryStatus } from '../../src/core/editing/editing_contract'
import {
  CompositionCommitBuffer,
  CompositionInputController,
  flushPendingComposition,
  TextCommitIntent
} from '../../src/core/editing/composition_input'
import type { EditorSelection } from '../../src/core/editing/transaction'
import { answerInputFlushRequest, selectionAfterInput, EditingImeTransientState } from '../../src/renderer/src/renderer_state'

const caret = (offset: number) => ({ anchorOffset: offset, focusOffset: offset })

/** main 편집 session처럼 요청을 받은 순서대로(창 queue) 조금 늦게 처리하는 가짜 편집 코어. */
class FakeEngine {
  text: string
  savedText: string
  log: string[] = []
  private undoStack: string[] = []
  private redoStack: string[] = []
  private revision = 0
  private savedRevision = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(text = '') {
    this.text = text
    this.savedText = text
  }

  commit(intent: TextCommitIntent): Promise<EditingHistoryStatus> {
    return this.enqueue(() => {
      this.log.push(`commit:${intent.insert}`)
      this.undoStack.push(this.text)
      this.redoStack = []
      this.text = this.text.slice(0, intent.from) + intent.insert + this.text.slice(intent.to)
      this.revision += 1
    })
  }

  style(label: string): Promise<EditingHistoryStatus> {
    return this.enqueue(() => {
      this.log.push(`style:${label}:${this.text}`)
      this.undoStack.push(this.text)
      this.redoStack = []
      this.revision += 1
    })
  }

  split(offset: number): Promise<EditingHistoryStatus> {
    return this.enqueue(() => {
      this.log.push(`split:${offset}:${this.text}`)
      this.undoStack.push(this.text)
      this.redoStack = []
      this.text = this.text.slice(0, offset) + '\n' + this.text.slice(offset)
      this.revision += 1
    })
  }

  undo(): Promise<EditingHistoryStatus> {
    return this.enqueue(() => {
      const previous = this.undoStack.pop()
      this.log.push(previous === undefined ? 'undo:none' : 'undo')
      if (previous === undefined) return
      this.redoStack.push(this.text)
      this.text = previous
      this.revision += 1
    })
  }

  saveAs(): Promise<EditingHistoryStatus> {
    return this.enqueue(() => {
      this.log.push(`save:${this.text}`)
      this.savedText = this.text
      this.savedRevision = this.revision
    })
  }

  status(): EditingHistoryStatus {
    return {
      revision: this.revision,
      savedRevision: this.savedRevision,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      isDirty: this.revision !== this.savedRevision
    }
  }

  private enqueue(action: () => void): Promise<EditingHistoryStatus> {
    const result = this.queue.then(() => new Promise<EditingHistoryStatus>((resolve) => {
      setTimeout(() => {
        action()
        resolve(this.status())
      }, 5)
    }))
    this.queue = result.catch(() => undefined)
    return result
  }
}

/**
 * ParagraphInputSurface와 같은 순서로 조합 event를 받는 입력 칸. 음절 묶음은 대기 timer(450ms)가 돌기 전까지 입력 칸에
 * 머물고, 편집 command가 등록된 flush 손잡이로 그 글자를 먼저 commit한다. commit은 App의 commitParagraph처럼 응답까지 센다.
 */
class FakeSurface {
  dom: string
  private readonly controller: CompositionInputController
  private readonly buffer = new CompositionCommitBuffer()
  readonly unregister: () => void

  constructor(
    private readonly transient: EditingImeTransientState,
    private readonly engine: FakeEngine
  ) {
    this.dom = engine.text
    this.controller = new CompositionInputController(this.dom, caret(this.dom.length))
    this.unregister = transient.registerInputFlusher({
      flush: () => this.flush(),
      composing: () => this.controller.isComposing
    })
  }

  /** 한 음절을 조합한다. `end`가 false면 compositionend 전(IME가 아직 조합 중)에서 멈춘다. */
  typeSyllable(syllable: string, end = true): void {
    const before = this.dom
    const id = this.controller.compositionStart(before, caret(before.length))
    this.buffer.begin(before, caret(before.length), id, 0)
    this.transient.setComposing(true)
    this.dom = before + syllable
    const snapshot = { text: this.dom, selection: caret(this.dom.length), inputType: 'insertCompositionText', timestamp: 1 }
    this.controller.input({ ...snapshot, isComposing: true })
    this.buffer.update({ ...snapshot, isComposing: true })
    if (!end) return
    this.controller.compositionEnd(snapshot)
    this.buffer.update(snapshot)
  }

  get composing(): boolean {
    return this.controller.isComposing
  }

  flush(): void {
    if (!this.buffer.pending && !this.controller.isComposing) return
    const intent = flushPendingComposition(this.controller, this.buffer, {
      text: this.dom,
      selection: caret(this.dom.length),
      inputType: 'insertCompositionText',
      timestamp: 2
    })
    this.transient.setComposing(false)
    if (!intent) return
    void this.transient.trackInput(this.engine.commit(intent)).then((status) => this.transient.noteHistory(status))
  }
}

const session = (engine: FakeEngine) => ({ sessionId: 'session-1', ...engine.status() })

describe('입력 직후 편집 command 순서', () => {
  test('조합 끝 직후(음절 묶음 대기 중) 누른 첫 실행 취소가 방금 입력한 글자를 되돌린다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    for (const syllable of ['새', '각', '주']) surface.typeSyllable(syllable)

    // 아직 아무 commit도 보내지 않았다. 예전 renderer는 이때 isComposing이라 실행 취소를 버렸다.
    expect(engine.log).toEqual([])
    expect(transient.isComposing).toBe(true)
    expect(transient.hasPendingInput).toBe(true)
    expect(transient.isImeComposing).toBe(false)

    await transient.runAfterInput(async () => {
      transient.noteHistory(await engine.undo())
    })

    expect(engine.log).toEqual(['commit:새각주', 'undo'])
    expect(engine.text).toBe('')
    expect(transient.hasPendingInput).toBe(false)
    expect(transient.currentSession).toMatchObject({ canUndo: false, canRedo: true })
  })

  test('commit 응답을 기다리는 중 누른 실행 취소는 그 응답 뒤에 돈다', async () => {
    const engine = new FakeEngine('본문')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')
    surface.flush()
    expect(transient.inFlightInputCount).toBe(1)

    let undoSentWhileCommitInFlight = false
    await transient.runAfterInput(async () => {
      undoSentWhileCommitInFlight = transient.inFlightInputCount > 0
      transient.noteHistory(await engine.undo())
    })

    expect(undoSentWhileCommitInFlight).toBe(false)
    expect(engine.log).toEqual(['commit:가', 'undo'])
    expect(engine.text).toBe('본문')
  })

  test('IME가 아직 조합 중일 때 누른 실행 취소도 조합 글자를 먼저 확정해 commit한 뒤 되돌린다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('한')
    surface.typeSyllable('글', false)
    expect(transient.isImeComposing).toBe(true)

    await transient.runAfterInput(async () => {
      transient.noteHistory(await engine.undo())
    })

    expect(surface.composing).toBe(false)
    expect(engine.log).toEqual(['commit:한글', 'undo'])
    expect(engine.text).toBe('')
  })

  test('입력 직후 연달아 누른 실행 취소 두 번은 차례대로 모두 돈다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')
    surface.flush()
    surface.typeSyllable('나')

    const undo = () => transient.runAfterInput(async () => {
      transient.noteHistory(await engine.undo())
    })
    await Promise.all([undo(), undo()])

    expect(engine.log).toEqual(['commit:가', 'commit:나', 'undo', 'undo'])
    expect(engine.text).toBe('')
  })

  test('입력 직후 저장은 마지막 글자까지 담고, 깨끗한 문서도 그 입력으로 dirty가 된 것을 본다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    expect(transient.currentSession?.isDirty).toBe(false)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('끝')

    let saved = false
    await transient.runAfterInput(async () => {
      // App의 saveEditingAs처럼 입력 반영 뒤의 dirty 상태로 저장 여부를 정한다.
      if (!transient.currentSession?.isDirty) return
      transient.noteHistory(await engine.saveAs())
      saved = true
    })

    expect(saved).toBe(true)
    expect(engine.savedText).toBe('끝')
    expect(transient.currentSession).toMatchObject({ isDirty: false })
  })

  test('입력 직후 누른 글자 모양 command는 입력 글자가 반영된 문서에 적용된다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('굵')

    await transient.runAfterInput(async () => {
      transient.noteHistory(await engine.style('bold'))
    })

    expect(engine.log).toEqual(['commit:굵', 'style:bold:굵'])
  })

  test('편집 상태가 reset되면 아직 돌지 않은 command는 버리고 기다림도 풀린다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')
    surface.flush()

    let ran = false
    const queued = transient.runAfterInput(() => {
      ran = true
    })
    transient.reset()
    await queued

    expect(ran).toBe(false)
    expect(transient.hasPendingInput).toBe(false)
    surface.unregister()
  })

  test('입력을 기다린 command는 합성 anchor·같은 입력 칸 caret이면 commit 결과 caret을, 범위는 누른 때 selection을 쓴다', () => {
    const selection = (textNodeId: string, anchorOffset: number, focusOffset = anchorOffset, focusTextNodeId = textNodeId): EditorSelection => ({
      sectionPath: 'Contents/section0.xml',
      anchorTextNodeId: textNodeId,
      anchorOffset,
      focusTextNodeId,
      focusOffset
    })
    const empty = selection('Contents/section0.xml#hp:p:3:empty', 0)
    const moved = selection('Contents/section0.xml#hp:t:7', 2)
    const staleCaret = selection('Contents/section0.xml#hp:t:7', 0)
    const otherSurface = selection('Contents/section0.xml#hp:t:1', 4)
    const range = selection('Contents/section0.xml#hp:t:7', 0, 2)

    expect(selectionAfterInput(empty, moved, true)).toBe(moved)
    expect(selectionAfterInput(empty, moved, false)).toBe(empty)
    expect(selectionAfterInput(staleCaret, moved, true)).toBe(moved)
    expect(selectionAfterInput(otherSurface, moved, true)).toBe(otherSurface)
    expect(selectionAfterInput(range, moved, true)).toBe(range)
    expect(selectionAfterInput(empty, undefined, true)).toBe(empty)
    // Enter·Backspace는 키를 누른 때 읽은 화면 caret을 쓴다(합성 anchor일 때만 결과 caret).
    expect(selectionAfterInput(staleCaret, moved, true, { followSameSurface: false })).toBe(staleCaret)
    expect(selectionAfterInput(empty, moved, true, { followSameSurface: false })).toBe(moved)
  })

  test('한글 입력 직후 Enter는 버리지 않고, 남은 글자 commit 바로 뒤에 기다림 없이 보낸다', async () => {
    const engine = new FakeEngine('본문')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')
    surface.typeSyllable('나')

    let waited: boolean | undefined
    const split = transient.runTypingCommand(async (waitedForInput) => {
      waited = waitedForInput
      transient.noteHistory(await engine.split(4))
    })
    // 글자 commit은 Enter를 받은 그 자리에서 이미 보냈다(main 창 queue 순서: commit → split).
    expect(transient.inFlightInputCount).toBe(2)
    await split

    expect(waited).toBe(false)
    expect(engine.log).toEqual(['commit:가나', 'split:4:본문가나'])
    expect(engine.text).toBe('본문가나\n')
  })

  test('앞선 command가 있으면 Enter도 그 뒤에 차례로 돌고, 빈 문단 첫 입력 직후 Enter는 그 commit 결과를 기다린다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')

    const undo = transient.runAfterInput(async () => {
      transient.noteHistory(await engine.undo())
    })
    expect(transient.commandsIdle).toBe(false)
    const split = transient.runTypingCommand(async () => {
      transient.noteHistory(await engine.split(0))
    })
    await Promise.all([undo, split])
    expect(engine.log).toEqual(['commit:가', 'undo', 'split:0:'])
    expect(transient.commandsIdle).toBe(true)

    surface.typeSyllable('나')
    let waited: boolean | undefined
    await transient.runTypingCommand((waitedForInput) => {
      waited = waitedForInput
    }, true)
    expect(waited).toBe(true)
    expect(engine.log.at(-1)).toBe('commit:나')
  })
})

describe('창 닫기 전 남은 입력 반영 요청(editing:flushInput)', () => {
  test('음절 묶음 대기 중인 마지막 글자를 commit하고 그 응답이 온 뒤에 답한다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('닫')
    // 깨끗한 문서에 친 글자가 아직 입력 칸에만 있다. main(엔진)은 dirty가 아니다.
    expect(engine.status().isDirty).toBe(false)

    let repliedDirty: boolean | undefined
    await answerInputFlushRequest(transient, () => { repliedDirty = engine.status().isDirty })

    expect(engine.log).toEqual(['commit:닫'])
    expect(repliedDirty).toBe(true)
    expect(transient.hasPendingInput).toBe(false)
  })

  test('IME가 아직 조합 중인 글자도 확정해 commit한 뒤 답한다', async () => {
    const engine = new FakeEngine('본문')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('끝', false)
    expect(surface.composing).toBe(true)

    let replied = false
    await answerInputFlushRequest(transient, () => { replied = engine.text === '본문끝' })
    expect(replied).toBe(true)
  })

  test('앞서 줄 선 편집 command가 끝난 뒤에 답한다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    surface.typeSyllable('가')
    const order: string[] = []
    const style = transient.runAfterInput(async () => {
      transient.noteHistory(await engine.style('굵게'))
      order.push('style')
    })
    await answerInputFlushRequest(transient, () => order.push('reply'))
    await style
    expect(order).toEqual(['style', 'reply'])
    expect(engine.log).toEqual(['commit:가', 'style:굵게:가'])
  })

  test('남은 입력이 없으면 바로 답하고, 반영이 실패해도 답한다', async () => {
    const transient = new EditingImeTransientState()
    let replies = 0
    await answerInputFlushRequest(transient, () => { replies += 1 })
    expect(replies).toBe(1)

    const failing = { runAfterInput: () => Promise.reject(new Error('commit 실패')), flushInput: () => undefined }
    const logged: unknown[] = []
    await answerInputFlushRequest(failing, () => { replies += 1 }, (reason) => logged.push(reason))
    expect(replies).toBe(2)
    expect(logged).toHaveLength(1)
  })

  test('앞선 편집 command가 막혀 있어도 대기 글자는 곧바로 commit해 main이 dirty를 본다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const surface = new FakeSurface(transient, engine)
    const gate: { release?: () => void } = {}
    const blocking = transient.runAfterInput(() => new Promise<void>((resolve) => { gate.release = resolve }))
    while (!gate.release) await new Promise((resolve) => setTimeout(resolve, 1))
    // 앞 command가 도는 동안 친 글자가 입력 칸에만 있다.
    surface.typeSyllable('닫')
    expect(engine.status().isDirty).toBe(false)
    let replied = false
    const answer = answerInputFlushRequest(transient, () => { replied = true })
    for (let tries = 0; tries < 50 && !engine.log.length; tries += 1) await new Promise((resolve) => setTimeout(resolve, 2))
    // 답은 앞 command 뒤지만, 글자 commit은 이미 main에 갔다.
    expect(replied).toBe(false)
    expect(engine.log).toEqual(['commit:닫'])
    expect(engine.status().isDirty).toBe(true)
    gate.release()
    await blocking
    await answer
    expect(replied).toBe(true)
    expect(engine.log).toEqual(['commit:닫'])
  })

  test('편집 상태가 reset되면(문서 교체) 남은 command를 버리고도 답한다', async () => {
    const engine = new FakeEngine('')
    const transient = new EditingImeTransientState()
    transient.synchronize(session(engine), 0)
    const gate: { release?: () => void } = {}
    const blocking = transient.runAfterInput(() => new Promise<void>((resolve) => { gate.release = resolve }))
    let replied = false
    const answer = answerInputFlushRequest(transient, () => { replied = true })
    while (!gate.release) await new Promise((resolve) => setTimeout(resolve, 1))
    expect(replied).toBe(false)
    transient.reset()
    gate.release()
    await blocking
    await answer
    expect(replied).toBe(true)
  })
})
