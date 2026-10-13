import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { createEditorSelection, type EditorSelection } from '../../src/core/editing/selection'
import { listSelectableMergedTableCells } from '../../src/core/editing/table_cell_selection'
import {
  applyReplaceTableFragmentCommand,
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planInsertTableRowAfter,
  planMergeTableCellRight,
  planSplitTableCell,
  resolveTableFragmentCommand,
  type PatchTableFragmentCommand,
  type ReplaceTableFragmentCommand
} from '../../src/core/editing/table_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import type { EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { encodeRecoveryRecord } from '../../src/main/recovery_journal'
import { createLargeTableHwpx } from '../fixtures/public/create_synthetic_hwpx'

// 표 구조 command의 history·복구 기록 크기 회귀. 전에는 command·inverse가 표 원문 전체를 두 벌씩 담아(`replace-table-fragment`)
// 200 KiB 표에서 행 하나를 더하면 history 항목 약 800 KiB, 복구 기록 commit record 약 400 KiB였다. 지금 planner는 원문 대비 변경
// 조각(`patch-table-fragment`)만 담는다. 같은 계획을 이전 형식으로 바꾼 command와 크기·결과 bytes를 비교한다.
// 크기 표 출력: `HAN_FLOW_RECORD_SIZE_SUMMARY=1 npx jest tests/editing/table_record_size.test.ts`

const sectionPath = 'Contents/section0.xml'

interface Measured {
  command: string
  tableBytes: number
  legacyJournalBytes: number
  patchJournalBytes: number
  legacyHistoryBytes: number
  patchHistoryBytes: number
}

function legacyOf(sourcePackage: HwpxSourcePackage, command: PatchTableFragmentCommand): ReplaceTableFragmentCommand {
  const { expectedFragment, replacementFragment } = resolveTableFragmentCommand(sourcePackage, command)
  return {
    type: 'replace-table-fragment',
    sectionPath: command.sectionPath,
    textNodeId: command.textNodeId,
    ...(command.replacementTextNodeId === undefined ? {} : { replacementTextNodeId: command.replacementTextNodeId }),
    expectedFragment,
    replacementFragment
  }
}

function transaction(
  command: PatchTableFragmentCommand | ReplaceTableFragmentCommand,
  selectionBefore: EditorSelection,
  selectionAfter: EditorSelection,
  baseRevision: number
): EditTransaction {
  return { id: 'table', baseRevision, commands: [command], selectionBefore, selectionAfter, timestamp: 1 }
}

function journalBytes(revision: number, value: EditTransaction): number {
  return encodeRecoveryRecord({ type: 'commit', revision, at: 1, transaction: value }).byteLength
}

/** 같은 계획을 두 형식으로 history에 넣고 결과 bytes가 같은지, 실행 취소가 원문을 되살리는지 확인하며 크기를 잰다. */
function measure(
  label: string,
  sourcePackage: HwpxSourcePackage,
  plan: { command: PatchTableFragmentCommand; selectionAfter: EditorSelection },
  selectionBefore: EditorSelection
): Measured & { package: HwpxSourcePackage } {
  const legacy = legacyOf(sourcePackage, plan.command)
  const patchHistory = new HwpxEditHistory(sourcePackage)
  const legacyHistory = new HwpxEditHistory(sourcePackage)
  const patchTransaction = transaction(plan.command, selectionBefore, plan.selectionAfter, sourcePackage.revision)
  const legacyTransaction = transaction(legacy, selectionBefore, plan.selectionAfter, sourcePackage.revision)
  patchHistory.commit(patchTransaction)
  legacyHistory.commit(legacyTransaction)
  const after = patchHistory.package
  expect(after.readEntry(sectionPath).equals(legacyHistory.package.readEntry(sectionPath))).toBe(true)
  const measured = {
    command: label,
    tableBytes: Buffer.byteLength(legacy.expectedFragment, 'utf8'),
    legacyJournalBytes: journalBytes(after.revision, legacyTransaction),
    patchJournalBytes: journalBytes(after.revision, patchTransaction),
    legacyHistoryBytes: legacyHistory.stats().estimatedBytes,
    patchHistoryBytes: patchHistory.stats().estimatedBytes
  }
  patchHistory.undo()
  expect(patchHistory.package.readEntry(sectionPath).equals(sourcePackage.readEntry(sectionPath))).toBe(true)
  patchHistory.redo()
  expect(patchHistory.package.readEntry(sectionPath).equals(after.readEntry(sectionPath))).toBe(true)
  return { ...measured, package: after }
}

describe('큰 표 구조 command의 기록 크기', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-record-size-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('약 200 KiB 표에서 행·열·셀 command가 표 원문 두 벌 대신 변경 조각만 담는다', async () => {
    const source = await HwpxSourcePackage.open(createLargeTableHwpx(directory))
    const caret = (sourcePackage: HwpxSourcePackage, text: string): EditorSelection => {
      const anchor = listHwpxTextAnchors(sourcePackage, sectionPath).find((item) => item.text === text)
      if (!anchor) throw new Error(`${text} 셀이 없습니다.`)
      return createEditorSelection(sectionPath, anchor.textNodeId, 0)
    }
    const middle = caret(source, 'R60C2')
    const results: Measured[] = []
    const record = (value: Measured & { package: HwpxSourcePackage }): HwpxSourcePackage => {
      const { package: next, ...measured } = value
      results.push(measured)
      return next
    }
    record(measure('insert-row(가운데)', source, planInsertTableRowAfter(source, middle), middle))
    record(measure('insert-row(끝)', source, planInsertTableRowAfter(source, caret(source, 'R119C2')), caret(source, 'R119C2')))
    record(measure('delete-row(가운데)', source, planDeleteTableRow(source, middle), middle))
    record(measure('insert-column', source, planInsertTableColumnAfter(source, middle), middle))
    record(measure('delete-column', source, planDeleteTableColumn(source, middle), middle))
    const merged = record(measure('merge-cell-right', source, planMergeTableCellRight(source, middle), middle))
    const mergedCell = listSelectableMergedTableCells(await decodeViewerDocument(merged))[0]
    const splitBefore = createEditorSelection(sectionPath, mergedCell.textNodeId, 0)
    record(measure('split-cell', merged, planSplitTableCell(merged, mergedCell), splitBefore))

    if (process.env.HAN_FLOW_RECORD_SIZE_SUMMARY === '1') console.log(`HAN_FLOW_TABLE_RECORD_SIZE ${JSON.stringify(results)}`)
    expect(results[0].tableBytes).toBeGreaterThan(190 * 1024)
    for (const result of results) {
      // 이전 형식은 표 원문을 두 벌(forward의 expected·replacement), history는 inverse까지 네 벌 담았다.
      expect(result.legacyJournalBytes).toBeGreaterThan(1.5 * result.tableBytes)
      expect(result.legacyHistoryBytes).toBeGreaterThan(3 * result.tableBytes)
      expect(result.patchJournalBytes).toBeLessThan(result.legacyJournalBytes)
      expect(result.patchHistoryBytes).toBeLessThan(result.legacyHistoryBytes)
    }
    const byLabel = Object.fromEntries(results.map((result) => [result.command, result]))
    // 바뀐 셀 주소·행만 남는 command는 표 크기와 거의 무관하다.
    for (const label of ['insert-row(끝)', 'merge-cell-right', 'split-cell']) {
      expect(byLabel[label].patchJournalBytes).toBeLessThan(4 * 1024)
      expect(byLabel[label].patchHistoryBytes).toBeLessThan(8 * 1024)
    }
    // 가운데 행 추가·삭제는 뒤쪽 행 주소를 모두 고치지만 그래도 이전의 1/20 아래다.
    for (const label of ['insert-row(가운데)', 'delete-row(가운데)']) {
      expect(byLabel[label].patchJournalBytes * 20).toBeLessThan(byLabel[label].legacyJournalBytes)
      expect(byLabel[label].patchHistoryBytes * 20).toBeLessThan(byLabel[label].legacyHistoryBytes)
    }
    // 열 추가·삭제는 모든 행에 셀을 넣거나 빼므로 그 셀 원문 몫만큼 남는다.
    for (const label of ['insert-column', 'delete-column']) {
      expect(byLabel[label].patchJournalBytes * 3).toBeLessThan(byLabel[label].legacyJournalBytes)
    }
  }, 120_000)

  test('기준 표가 바뀌었으면 변경 조각을 적용하지 않고, 이전 형식 command도 그대로 적용한다', async () => {
    const source = await HwpxSourcePackage.open(createLargeTableHwpx(directory, { rows: 4, columns: 2, fileName: 'small.hwpx' }))
    const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === 'R1C1')!
    const plan = planInsertTableRowAfter(source, createEditorSelection(sectionPath, anchor.textNodeId, 0))
    const legacy = legacyOf(source, plan.command)
    const applied = applyReplaceTableFragmentCommand(source, plan.command)
    expect(applied.inverse?.type).toBe('patch-table-fragment')
    // 이미 행을 더한 표에 같은 조각을 다시 적용하지 않는다.
    expect(() => applyReplaceTableFragmentCommand(applied.package, plan.command)).toThrow('표 구조가 변경되어')
    const legacyApplied = applyReplaceTableFragmentCommand(source, legacy)
    expect(legacyApplied.inverse?.type).toBe('replace-table-fragment')
    expect(legacyApplied.package.readEntry(sectionPath).equals(applied.package.readEntry(sectionPath))).toBe(true)
    const undone = applyReplaceTableFragmentCommand(legacyApplied.package, legacyApplied.inverse!)
    expect(undone.package.readEntry(sectionPath).equals(source.readEntry(sectionPath))).toBe(true)
  })
})
