import type { RendererRequestOutcome } from './ipc_guard'

/*
 * 편집 session이 있는 창을 닫을 때(창 닫기·앱 종료)의 순서.
 *
 * renderer는 마지막 한글 음절을 잠깐(음절 묶음 대기) 입력 칸에 두었다가 commit한다. 그 사이 창을 닫으면 main은 session이
 * 깨끗하다고 보고 저장 확인 없이 닫아 글자를 잃는다. 그래서 dirty를 판단하기 전에 renderer에 남은 입력을 반영하라고 묻고
 * (`editing:flushInput`), 답이 오거나(반영 끝) 시간 초과·renderer 없음이면 그때의 상태로 dirty를 다시 본다. dirty이면 방금 반영한
 * commit까지 복구 기록을 디스크에 내린 뒤 기존 저장/버리기/취소 확인을 거친다. 확인이 끝나면 session을 끝내고 닫는다.
 */

/** renderer가 남은 입력을 반영하고 답할 때까지 기다리는 최대 시간. 넘으면(멈춘 renderer) 그때 상태로 닫기를 이어 간다. */
export const RENDERER_INPUT_FLUSH_TIMEOUT_MS = 1000
export const EDITING_FLUSH_INPUT_CHANNEL = 'editing:flushInput'
export const EDITING_INPUT_FLUSHED_CHANNEL = 'editing:inputFlushed'

export type WindowCloseDecision = 'close' | 'cancelled' | 'gone'

export interface WindowCloseSteps {
  /** 창의 현재 편집 session id(없으면 undefined) */
  currentSessionId(): string | undefined
  /** renderer에 남은 입력 반영을 요청하고 답을 기다린다(시간 제한 포함). 거절하지 않는다. */
  flushRendererInput(): Promise<RendererRequestOutcome>
  isDirty(sessionId: string): boolean
  /** 복구 기록을 디스크에 내린다. */
  flushJournal(): Promise<void>
  /** 저장/버리기/취소 확인 */
  resolveDirty(sessionId: string): Promise<{ outcome: string }>
  /** 창이 이미 사라졌는지 */
  windowDestroyed(): boolean
  /** 편집 session을 끝낸다(복구 기록 삭제 포함). */
  stopSession(): Promise<void>
  log(message: string): void
}

/**
 * 닫기 확인 순서를 실행한다. `close`면 창을 닫아도 되고(session은 이미 끝냄), `cancelled`면 사용자가 닫기를 취소했으며,
 * `gone`이면 그 사이 창이 사라져 더 할 일이 없다.
 */
export async function resolveWindowClose(steps: WindowCloseSteps): Promise<WindowCloseDecision> {
  const outcome = await steps.flushRendererInput()
  if (outcome === 'timeout') steps.log('창 닫기: renderer가 남은 입력 반영에 답하지 않아 지금 상태로 닫기 확인을 이어 갑니다.')
  else if (outcome === 'unavailable') steps.log('창 닫기: renderer가 없어 남은 입력을 반영하지 못하고 지금 상태로 닫기 확인을 이어 갑니다.')
  // 반영을 기다리는 사이 session이 끝났을 수 있다(편집 종료·문서 교체).
  const sessionId = steps.currentSessionId()
  if (sessionId && steps.isDirty(sessionId)) {
    // 방금 반영한 commit까지 기록을 내린다. 확인 대화상자 중 OS가 앱을 끝내도 편집이 남는다.
    await steps.flushJournal().catch((reason: unknown) => steps.log(`창 닫기: 복구 기록 쓰기 실패: ${String(reason)}`))
    const result = await steps.resolveDirty(sessionId)
    if (result.outcome === 'cancelled') return 'cancelled'
  }
  if (steps.windowDestroyed()) return 'gone'
  await steps.stopSession()
  return 'close'
}
