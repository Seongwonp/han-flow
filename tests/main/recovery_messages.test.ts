import type { RecoveryJournalCandidate } from '../../src/main/recovery_journal'
import {
  recoveryChoiceFromTestValue,
  recoveryFailedDialog,
  recoveryOfferDialog,
  recoveryUnavailableDialog
} from '../../src/main/recovery_messages'

const candidate: RecoveryJournalCandidate = {
  sessionId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  header: {
    type: 'header',
    format: 'han-flow-recovery-journal',
    version: 1,
    appVersion: '1.0.0',
    sourcePath: '/문서/보고서.hwpx',
    sourceSize: 10,
    sourceMtimeMs: 1,
    sourceSha256: 'a'.repeat(64),
    startedAt: 1
  },
  entries: [],
  tornTail: false,
  editCount: 7,
  lastChangeAt: Date.UTC(2026, 9, 9, 3, 4, 5)
}

describe('복구 대화상자 문구', () => {
  test('원본이 그대로면 [복구][버리기][나중에]와 마지막 변경 시각·편집 수를 보여 준다', () => {
    const dialog = recoveryOfferDialog(candidate, 'startup')
    expect(dialog.message).toBe('저장하지 않은 편집 내용이 있습니다. 복구하시겠습니까?')
    expect(dialog.buttons).toEqual(['복구', '버리기', '나중에'])
    expect(dialog.choices).toEqual(['recover', 'discard', 'later'])
    expect(dialog.choices[dialog.cancelId]).toBe('later')
    expect(dialog.detail).toContain('보고서.hwpx')
    expect(dialog.detail).toContain('편집 7개')
    expect(dialog.detail).toContain('마지막 변경: 2026')
    expect(recoveryOfferDialog(candidate, 'crash').message).toContain('편집 엔진이 예기치 않게 종료되었습니다.')
  })

  test('원본이 바뀌었거나 없으면 복구 단추 없이 [나중에][버리기]만 준다', () => {
    for (const state of ['changed', 'missing'] as const) {
      const dialog = recoveryUnavailableDialog(candidate, state)
      expect(dialog.choices).toEqual(['later', 'discard'])
      expect(dialog.choices).not.toContain('recover')
      expect(dialog.message).toContain('복구할 수 없습니다')
    }
    expect(recoveryUnavailableDialog(candidate, 'changed').message).toContain('바뀌어')
    expect(recoveryUnavailableDialog(candidate, 'missing').message).toContain('찾을 수 없어')
  })

  test('replay 실패는 격리 위치를 알리고 [보관][버리기]를 준다', () => {
    const dialog = recoveryFailedDialog('복구 기록 3/9번째 단계를 적용하지 못했습니다', '/data/recovery/quarantine-x')
    expect(dialog.choices).toEqual(['later', 'discard'])
    expect(dialog.detail).toContain('/data/recovery/quarantine-x')
  })

  test('E2E 답은 recover·discard·later만 받는다', () => {
    expect(recoveryChoiceFromTestValue('recover')).toBe('recover')
    expect(recoveryChoiceFromTestValue('save')).toBeUndefined()
    expect(recoveryChoiceFromTestValue(undefined)).toBeUndefined()
  })
})
