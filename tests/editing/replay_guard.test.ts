import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { assertReplayableTransaction, FORWARD_EDIT_COMMAND_TYPES } from '../../src/core/editing/replay_guard'
import { createEditorSelection } from '../../src/core/editing/selection'
import { planInsertTableRowAfter, resolveTableFragmentCommand } from '../../src/core/editing/table_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxEditConflictError } from '../../src/core/editing/text_patch'
import type { EditCommand, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createTableColumnHwpx } from '../fixtures/public/create_synthetic_hwpx'
import { casesByFamily, fixturePath, openedFixtures } from './golden_cases'

const SECTION = 'Contents/section0.xml'
const ANCHOR = `${SECTION}#hp:t:0`
const selection = {
  sectionPath: SECTION,
  anchorTextNodeId: ANCHOR,
  anchorOffset: 0,
  focusTextNodeId: ANCHOR,
  focusOffset: 0
}

function transaction(...commands: EditCommand[]): EditTransaction {
  return { id: 't', baseRevision: 0, commands, selectionBefore: selection, selectionAfter: selection, timestamp: 1 }
}

const paragraph = (body: string) => `<hp:p id="1" paraPrIDRef="0" styleIDRef="0">${body}</hp:p>`
const run = (text: string) => `<hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>`
const paragraphCommand = (replacementFragment: string): EditCommand => ({
  type: 'replace-paragraph-fragment',
  sectionPath: SECTION,
  textNodeId: ANCHOR,
  expectedFragment: paragraph(run('원문')),
  replacementFragment
})

const cell = (column: number, body = paragraph(run('셀'))) =>
  `<hp:tc><hp:subList>${body}</hp:subList><hp:cellAddr colAddr="${column}" rowAddr="0"/>` +
  '<hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="100" height="100"/></hp:tc>'
const table = (cells: string, extra = '') =>
  `<hp:tbl rowCnt="1" colCnt="2"><hp:sz width="200" height="100"/>${extra}<hp:tr>${cells}</hp:tr></hp:tbl>`
const tableCommand = (replacementFragment: string, expectedFragment = table(cell(0) + cell(1))): EditCommand => ({
  type: 'replace-table-fragment',
  sectionPath: SECTION,
  textNodeId: ANCHOR,
  expectedFragment,
  replacementFragment
})

describe('복구 기록 replay 검사', () => {
  test('편집 엔진이 만드는 forward command 종류만 받고 inverse 전용 restore-*는 거부한다', () => {
    expect([...FORWARD_EDIT_COMMAND_TYPES].sort()).toEqual([
      'apply-cell-style',
      'apply-character-style',
      'apply-paragraph-style',
      'delete-endnote',
      'delete-footnote',
      'insert-endnote',
      'insert-footnote',
      'patch-table-fragment',
      'replace-paragraph-fragment',
      'replace-table-fragment',
      'replace-text'
    ])
    for (const type of ['restore-style', 'restore-character-run', 'restore-cell-style', 'restore-footnote'] as const) {
      expect(() => assertReplayableTransaction(transaction({ type, sectionPath: SECTION, textNodeId: ANCHOR } as never)))
        .toThrow(HwpxEditConflictError)
    }
  })

  test('문단 fragment는 문단 구조 규칙을 통과한 hp:p만 이어 붙인 것이어야 한다', () => {
    // planner가 만드는 모양(분할: 두 문단, 병합·범위 치환: 한 문단, 줄바꿈·탭 포함)
    expect(() => assertReplayableTransaction(transaction(paragraphCommand(paragraph(run('앞')) + paragraph(run('뒤'))))))
      .not.toThrow()
    expect(() => assertReplayableTransaction(transaction(paragraphCommand(
      paragraph('<hp:run charPrIDRef="0"><hp:t>줄<hp:lineBreak/>바꿈<hp:tab/></hp:t></hp:run>')
    )))).not.toThrow()
    for (const hostile of [
      // 조작한 기록이 알 수 없는 element를 문단에 끼워 넣는다.
      paragraph(`${run('INJECTED')}<evil:payload xmlns:evil="urn:x">x</evil:payload>`),
      paragraph('<hp:run charPrIDRef="0"><hp:t>글</hp:t><hp:ctrl><hp:fieldBegin type="HYPERLINK"/></hp:ctrl></hp:run>'),
      paragraph(`${run('표')}<hp:tbl/>`),
      // 문단 밖 element·text, 빈 fragment, 깨진 XML
      `${paragraph(run('앞'))}<hp:tbl/>`,
      `${paragraph(run('앞'))}글`,
      '',
      '<hp:p><hp:run>'
    ]) {
      expect(() => assertReplayableTransaction(transaction(paragraphCommand(hostile)))).toThrow(HwpxEditConflictError)
    }
  })

  test('표 fragment는 표 하나이고 원래 표에 없던 콘텐츠를 더하지 않아야 한다', () => {
    const original = table(cell(0) + cell(1))
    // planner가 만드는 모양: 행·열·셀 뼈대와 단순 텍스트 문단은 늘 수 있다.
    expect(() => assertReplayableTransaction(transaction(tableCommand(
      table(cell(0) + cell(1) + cell(2, paragraph(run(''))))
    )))).not.toThrow()
    // 원래 표에 있던 개체는 지우거나 그대로 둘 수 있다(늘리지만 않으면).
    const withPicture = table(cell(0, paragraph('<hp:run charPrIDRef="0"><hp:pic/><hp:t/></hp:run>')) + cell(1))
    expect(() => assertReplayableTransaction(transaction(tableCommand(withPicture, withPicture)))).not.toThrow()
    expect(() => assertReplayableTransaction(transaction(tableCommand(original, withPicture)))).not.toThrow()
    for (const hostile of [
      table(cell(0, paragraph('<hp:run charPrIDRef="0"><hp:pic/><hp:t/></hp:run>')) + cell(1)),
      table(cell(0) + cell(1), '<hp:caption/>'),
      table(cell(0, paragraph(run('중첩')) + table(cell(0) + cell(1))) + cell(1)),
      original + original,
      `${original}<hp:p/>`,
      paragraph(run('표 아님')),
      '<hp:tbl>'
    ]) {
      expect(() => assertReplayableTransaction(transaction(tableCommand(hostile, original)))).toThrow(HwpxEditConflictError)
    }
    // 원래 그림이 하나였는데 둘로 늘리는 것도 거부한다.
    expect(() => assertReplayableTransaction(transaction(tableCommand(
      table(cell(0, paragraph('<hp:run charPrIDRef="0"><hp:pic/><hp:pic/><hp:t/></hp:run>')) + cell(1)),
      withPicture
    )))).toThrow(HwpxEditConflictError)
  })

  test('표 변경 조각은 현재 표에 적용한 결과에 같은 표 규칙을 걸고, 단독 transaction·현재 문서가 있어야 한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-replay-patch-'))
    try {
      const source = await HwpxSourcePackage.open(createTableColumnHwpx(directory))
      const anchor = listHwpxTextAnchors(source, SECTION).find((item) => item.text === 'A1')!
      const caret = createEditorSelection(SECTION, anchor.textNodeId, 0)
      const plan = planInsertTableRowAfter(source, caret)
      const patch = plan.command
      const forward = { ...transaction(patch), selectionBefore: caret, selectionAfter: plan.selectionAfter }
      expect(() => assertReplayableTransaction(forward, source)).not.toThrow()
      // 문서 없이, 또는 다른 command와 함께 들어온 변경 조각은 확인할 수 없으므로 거부한다.
      expect(() => assertReplayableTransaction(forward)).toThrow(HwpxEditConflictError)
      expect(() => assertReplayableTransaction({ ...forward, commands: [patch, patch] }, source)).toThrow('단독 transaction')
      // 조작한 기록이 변경 조각으로 원래 표에 없던 그림을 끼워 넣는다.
      const { expectedFragment } = resolveTableFragmentCommand(source, patch)
      const textStart = expectedFragment.indexOf('<hp:t>A1</hp:t>')
      const hostile = { ...patch, edits: [[textStart, 0, '<hp:pic/>'] as const] }
      expect(() => assertReplayableTransaction({ ...forward, commands: [hostile] }, source)).toThrow('원래 표에 없던 콘텐츠(hp:pic)')
      // 표 밖으로 나가는 조각, 기준과 다른 표, 형식이 틀린 조각
      const outside = { ...patch, edits: [[0, 0, '<hp:p/>'] as const] }
      expect(() => assertReplayableTransaction({ ...forward, commands: [outside] }, source)).toThrow(HwpxEditConflictError)
      const stale = { ...patch, expectedSha256: '0'.repeat(64) }
      expect(() => assertReplayableTransaction({ ...forward, commands: [stale] }, source)).toThrow('표 구조가 변경되어')
      // 겹치거나 표 원문을 벗어나는 조각은 현재 표에 적용할 때 거부한다.
      for (const edits of [[[10, 5, 'x'], [12, 0, 'y']], [[0, expectedFragment.length + 1, '']]]) {
        const malformed = { ...patch, edits } as never
        expect(() => assertReplayableTransaction({ ...forward, commands: [malformed] }, source)).toThrow('표 변경 조각이 올바르지 않아')
      }
      // 필드 모양이 틀린 command는 문서를 보기 전에 거부한다.
      for (const malformed of [
        { ...patch, edits: [[-1, 0, 'x']] },
        { ...patch, edits: [['0', 0, '']] },
        { ...patch, edits: [[0, 0]] },
        { ...patch, edits: 'x' },
        { ...patch, expectedLength: -1 },
        { ...patch, expectedLength: '9' },
        { ...patch, expectedSha256: 'A'.repeat(64) },
        { ...patch, expectedSha256: undefined },
        { ...patch, replacementTextNodeId: 3 }
      ]) {
        expect(() => assertReplayableTransaction({ ...forward, commands: [malformed as never] }, source)).toThrow('표 변경 조각 형식이 올바르지 않습니다')
        expect(() => assertReplayableTransaction({ ...forward, commands: [malformed as never] })).toThrow('표 변경 조각 형식이 올바르지 않습니다')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  // planner가 실제로 만든 command는 모두 통과해야 한다(공개 corpus golden 표본 전체). 거짓 거부는 정상 기록의 복구를 막는다.
  test('공개 corpus의 문단·표 planner command는 모두 replay 검사를 통과한다', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'han-flow-replay-guard-'))
    const passed = { text: 0, style: 0, paragraph: 0, table: 0 }
    try {
      for (const fixture of openedFixtures) {
        const original = await HwpxSourcePackage.open(fixturePath(directory, fixture))
        const families = await casesByFamily(original)
        for (const family of ['text', 'style', 'paragraph', 'table'] as const) {
          for (const testCase of families[family]) {
            let command: EditCommand
            try {
              command = testCase.build(original).command
            } catch {
              continue // planner가 거부한 case는 기록에 남지 않는다.
            }
            if (!FORWARD_EDIT_COMMAND_TYPES.has(command.type)) continue
            expect(() => assertReplayableTransaction(transaction(command), original)).not.toThrow()
            passed[family] += 1
          }
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    expect(passed.paragraph).toBeGreaterThan(20)
    expect(passed.table).toBeGreaterThan(20)
  }, 120_000)
})
