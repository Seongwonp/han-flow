import { basename, dirname } from 'path'
import type { RecoveryJournalCandidate, RecoverySourceState } from './recovery_journal'

/*
 * 복구 대화상자 문구(Electron에 의존하지 않는 순수 함수). 버튼 순서와 응답 번호는 여기서만 정한다.
 */

export type RecoveryChoice = 'recover' | 'discard' | 'later'

export interface RecoveryDialog {
  type: 'question' | 'warning' | 'error'
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
  /** 버튼 index → 선택 */
  choices: RecoveryChoice[]
}

export type RecoveryPromptReason = 'startup' | 'open' | 'crash'

function formatTime(at: number): string {
  return new Date(at).toLocaleString('ko-KR', { hour12: false })
}

function documentLines(candidate: RecoveryJournalCandidate): string {
  const path = candidate.header.sourcePath
  return `문서: ${basename(path)}\n위치: ${dirname(path)}`
}

/** 원본이 그대로일 때: [복구] [버리기] [나중에] */
export function recoveryOfferDialog(candidate: RecoveryJournalCandidate, reason: RecoveryPromptReason): RecoveryDialog {
  const lead = reason === 'crash'
    ? '편집 엔진이 예기치 않게 종료되었습니다. '
    : ''
  return {
    type: 'question',
    title: '편집 내용 복구',
    message: `${lead}저장하지 않은 편집 내용이 있습니다. 복구하시겠습니까?`,
    detail: [
      documentLines(candidate),
      `마지막 변경: ${formatTime(candidate.lastChangeAt)}`,
      `편집 ${candidate.editCount}개${candidate.tornTail ? ' (마지막 순간의 기록 일부는 끝까지 저장되지 않아 제외)' : ''}`,
      '',
      '복구하면 원본은 그대로 두고 편집 모드에서 변경 내용을 되살립니다. 확인한 뒤 다른 이름으로 저장하세요.',
      '[나중에]를 고르면 기록을 보관했다가 이 문서를 다시 열거나 앱을 다시 시작할 때 묻습니다.'
    ].join('\n'),
    buttons: ['복구', '버리기', '나중에'],
    defaultId: 0,
    cancelId: 2,
    choices: ['recover', 'discard', 'later']
  }
}

/** 원본이 바뀌었거나 없을 때: 복구할 수 없다. [나중에] [버리기] */
export function recoveryUnavailableDialog(
  candidate: RecoveryJournalCandidate,
  state: Exclude<RecoverySourceState, 'match'>
): RecoveryDialog {
  const changed = state === 'changed'
  return {
    type: 'warning',
    title: '편집 내용 복구',
    message: changed
      ? '원본 문서가 바뀌어 저장하지 않은 편집 내용을 복구할 수 없습니다.'
      : '원본 문서를 찾을 수 없어 저장하지 않은 편집 내용을 복구할 수 없습니다.',
    detail: [
      documentLines(candidate),
      `마지막 변경: ${formatTime(candidate.lastChangeAt)} · 편집 ${candidate.editCount}개`,
      '',
      changed
        ? '편집을 시작한 뒤 원본 파일의 크기·수정 시각·내용이 달라졌습니다. 다른 내용의 문서에는 편집 기록을 적용하지 않습니다.'
        : '원본 파일이 옮겨졌거나 이름이 바뀌었거나 지워졌습니다. 다른 위치의 파일에는 편집 기록을 적용하지 않습니다.',
      '원본을 원래 상태·위치로 되돌릴 수 있다면 [나중에]를 고른 뒤 다시 여세요.'
    ].join('\n'),
    buttons: ['나중에', '버리기'],
    defaultId: 0,
    cancelId: 0,
    choices: ['later', 'discard']
  }
}

/** replay 실패: 기록은 격리했다. [보관] [버리기] */
export function recoveryFailedDialog(message: string, quarantinePath: string | undefined): RecoveryDialog {
  return {
    type: 'error',
    title: '편집 내용 복구',
    message: '저장하지 않은 편집 내용을 복구하지 못했습니다.',
    detail: [
      message,
      '',
      quarantinePath
        ? `편집 기록은 다시 실행하지 않도록 격리해 보관했습니다: ${quarantinePath}`
        : '편집 기록은 그대로 보관했습니다.',
      '원본 문서는 바뀌지 않았습니다.'
    ].join('\n'),
    buttons: ['보관', '버리기'],
    defaultId: 0,
    cancelId: 0,
    choices: ['later', 'discard']
  }
}

/** E2E 환경 변수 값(recover·discard·later)을 선택으로 바꾼다. 모르는 값이면 undefined(대화상자를 띄운다). */
export function recoveryChoiceFromTestValue(value: string | undefined): RecoveryChoice | undefined {
  return value === 'recover' || value === 'discard' || value === 'later' ? value : undefined
}
