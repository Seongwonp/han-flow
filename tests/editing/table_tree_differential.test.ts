import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { forgetPackageTrees, packageEntryTree, putPackageTrees, takePackageTrees } from '../../src/core/editing/package_trees'
import { createEditorSelection, EditorSelection, normalizeEditorSelection } from '../../src/core/editing/selection'
import {
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  serializeSourceTree,
  SourceElement
} from '../../src/core/editing/source_tree'
import { TableCellSelection } from '../../src/core/editing/table_cell_selection'
import {
  applyReplaceTableFragmentCommand,
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planInsertTableRowAfter,
  planMergeTableCellRight,
  planSplitTableCell,
  ReplaceTableFragmentCommand,
  TablePatchResult
} from '../../src/core/editing/table_patch'
import {
  legacyApplyReplaceTableFragmentCommand,
  legacyPlanDeleteTableColumn,
  legacyPlanDeleteTableRow,
  legacyPlanInsertTableColumnAfter,
  legacyPlanInsertTableRowAfter,
  legacyPlanMergeTableCellRight,
  legacyPlanSplitTableCell
} from '../../src/core/editing/table_patch_legacy'
import { listHwpxTextAnchors, locateHwpxTextElement } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'
import {
  attributeInsideValue,
  cdataWithMarkup,
  cdataWithQuote,
  entityAttribute,
  mergedCellWithTrailingLineSegments,
  NOTE_ADDRESS,
  SPLIT_RIGHT_CELL
} from './table_divergence_repros'

// 4단계 tree 전환 관문: 표 행 추가(아래)·행 삭제·열 추가(오른쪽)·열 삭제·오른쪽 셀 병합·병합 셀 분할을 새 tree 경로
// (`table_patch`)와 전환 전 문자열 경로(`table_patch_legacy`)에 똑같이 계획·적용해 비교한다.
// - 오류: 종류·code·message가 같다.
// - 적용: command(표 fragment·selection 이동 anchor)·selection·section bytes·revision·inverse·loss report가 같다.
// - 모든 적용에서 inverse가 원래 bytes를, 그 inverse가 결과 bytes를 정확히 되살린다(undo·redo).
// 공개 corpus의 표 셀마다(편집 가능한 anchor가 있는 직계 셀) 6종 command를 적용하고, 병합이 성공하면 그 결과에서 분할도
// 비교한다. 전환 전 경로의 잠재 버그(CDATA `as-tag`, 정규식 attribute, 분할 편집 범위 겹침)는 아래 손 작성 재현으로 고정한다.

interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  generator?: string
  fileName?: string
  file?: string
  options?: Record<string, unknown>
  expected: { outcome: string }
}

const publicRoot = join(__dirname, '../fixtures/public')
const manifest = JSON.parse(
  readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
) as { fixtures: ManifestFixture[] }
const openedFixtures = manifest.fixtures.filter((fixture) => fixture.expected.outcome === 'opened')

type Kind = 'insert-row' | 'delete-row' | 'insert-column' | 'delete-column' | 'merge-right' | 'split'

interface Plan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

/** 표 셀 하나: 첫 편집 가능 anchor와 표 안 행 번호·논리 열 주소·span. */
interface CellTarget {
  sectionPath: string
  textNodeId: string
  row: number
  column: number
  merged: boolean
}

function attempt<T>(run: () => T): { value: T } | { error: Error } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: error as Error }
  }
}

function cellTargets(sourcePackage: HwpxSourcePackage, sectionPath: string): CellTarget[] {
  const seen = new Set<SourceElement>()
  const targets: CellTarget[] = []
  const tree = packageEntryTree(sourcePackage, sectionPath)
  for (const anchor of listHwpxTextAnchors(sourcePackage, sectionPath)) {
    const { element } = locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!
    const cell = nearestSourceAncestor(element, 'hp:tc')
    const row = cell?.parent
    const table = row?.parent
    if (!cell || seen.has(cell) || row?.name !== 'hp:tr' || table?.name !== 'hp:tbl') continue
    seen.add(cell)
    const rows = table.children.filter((child) => child.kind === 'element' && child.name === 'hp:tr')
    const address = cell.children.find(
      (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:cellAddr'
    )
    const span = cell.children.find(
      (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:cellSpan'
    )
    const spanValue = (name: string): number => Number((span && getSourceAttribute(tree, span, name)) ?? '1')
    targets.push({
      sectionPath,
      textNodeId: anchor.textNodeId,
      row: rows.indexOf(row),
      column: Number(address && getSourceAttribute(tree, address, 'colAddr')),
      merged: spanValue('colSpan') > 1 || spanValue('rowSpan') > 1
    })
  }
  return targets
}

function cellSelection(target: CellTarget, textNodeId = target.textNodeId): TableCellSelection {
  return {
    sectionPath: target.sectionPath,
    textNodeId,
    tableId: 'differential',
    sourceCellId: 'differential',
    row: target.row,
    column: target.column
  }
}

function plan(tree: boolean, kind: Kind, sourcePackage: HwpxSourcePackage, target: CellTarget, textNodeId?: string): Plan {
  const selection = createEditorSelection(target.sectionPath, textNodeId ?? target.textNodeId, 0)
  switch (kind) {
    case 'insert-row':
      return (tree ? planInsertTableRowAfter : legacyPlanInsertTableRowAfter)(sourcePackage, selection)
    case 'delete-row':
      return (tree ? planDeleteTableRow : legacyPlanDeleteTableRow)(sourcePackage, selection)
    case 'insert-column':
      return (tree ? planInsertTableColumnAfter : legacyPlanInsertTableColumnAfter)(sourcePackage, selection)
    case 'delete-column':
      return (tree ? planDeleteTableColumn : legacyPlanDeleteTableColumn)(sourcePackage, selection)
    case 'merge-right':
      return (tree ? planMergeTableCellRight : legacyPlanMergeTableCellRight)(sourcePackage, selection)
    case 'split':
      return (tree ? planSplitTableCell : legacyPlanSplitTableCell)(sourcePackage, cellSelection(target, textNodeId))
  }
}

function section(sourcePackage: HwpxSourcePackage, sectionPath: string): string {
  return sourcePackage.readEntry(sectionPath).toString('utf8')
}

describe('표 행·열·병합·분할 tree differential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-tree-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  const totals = {
    fixtures: 0,
    tables: 0,
    cells: 0,
    commands: 0,
    rejected: 0,
    applied: 0,
    undos: 0,
    redos: 0,
    byKind: {} as Record<string, number>,
    rejectedByKind: {} as Record<string, number>
  }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') {
      console.log(`HAN_FLOW_TABLE_TREE_DIFFERENTIAL ${JSON.stringify(totals)}`)
    }
  })

  /** command 하나를 두 경로로 계획·적용·되돌리기·다시 적용하며 비교한다. 적용 결과(tree 경로)와 다음 command용 package를 돌려준다. */
  function compare(
    base: HwpxSourcePackage,
    kind: Kind,
    target: CellTarget,
    textNodeId?: string
  ): { next: HwpxSourcePackage; applied?: { result: TablePatchResult; plan: Plan } } {
    const { sectionPath } = target
    totals.commands += 1
    const originalXml = section(base, sectionPath)
    const legacy = attempt(() => plan(false, kind, base, target, textNodeId))
    const tree = attempt(() => plan(true, kind, base, target, textNodeId))
    if ('error' in legacy) {
      expect('error' in tree ? { name: tree.error.constructor.name, message: tree.error.message } : 'no error').toEqual({
        name: legacy.error.constructor.name,
        message: legacy.error.message
      })
      if ('error' in tree) expect((tree.error as { code?: string }).code).toBe((legacy.error as { code?: string }).code)
      totals.rejected += 1
      totals.rejectedByKind[kind] = (totals.rejectedByKind[kind] ?? 0) + 1
      return { next: base }
    }
    if ('error' in tree) throw tree.error
    expect(tree.value.selectionAfter).toEqual(legacy.value.selectionAfter)
    expect(tree.value.command).toEqual(legacy.value.command)

    const treeResult = applyReplaceTableFragmentCommand(base, tree.value.command)
    const legacyResult = legacyApplyReplaceTableFragmentCommand(base, legacy.value.command)
    const treeXml = section(treeResult.package, sectionPath)
    expect(treeXml === section(legacyResult.package, sectionPath)).toBe(true)
    expect(treeResult.package.revision).toBe(legacyResult.package.revision)
    expect(treeResult.lossReport).toEqual(legacyResult.lossReport)
    expect(treeResult.inverse).toEqual(legacyResult.inverse)
    if (!treeResult.changed) return { next: base }
    totals.applied += 1
    totals.byKind[kind] = (totals.byKind[kind] ?? 0) + 1
    // 계획이 돌려준 selection은 결과 문서에서 유효하고, anchor 논리 text는 두 경로가 같다.
    normalizeEditorSelection(treeResult.package, tree.value.selectionAfter)
    expect(listHwpxTextAnchors(treeResult.package, sectionPath).map((anchor) => anchor.text)).toEqual(
      listHwpxTextAnchors(legacyResult.package, sectionPath).map((anchor) => anchor.text)
    )
    // cache된 tree와 tree에서 다시 만든 hp:t 색인이 새로 parse한 결과와 같다.
    if (totals.applied % 5 === 0) {
      expect(serializeSourceTree(packageEntryTree(treeResult.package, sectionPath)) === treeXml).toBe(true)
      const cachedAnchors = listHwpxTextAnchors(treeResult.package, sectionPath)
      const cached = takePackageTrees(treeResult.package)
      expect(listHwpxTextAnchors(treeResult.package, sectionPath)).toEqual(cachedAnchors)
      putPackageTrees(treeResult.package, cached)
    }

    const undo = applyReplaceTableFragmentCommand(treeResult.package, treeResult.inverse!)
    expect(section(undo.package, sectionPath) === originalXml).toBe(true)
    totals.undos += 1
    const redo = applyReplaceTableFragmentCommand(undo.package, undo.inverse!)
    expect(section(redo.package, sectionPath) === treeXml).toBe(true)
    totals.redos += 1
    const back = applyReplaceTableFragmentCommand(redo.package, redo.inverse!)
    expect(section(back.package, sectionPath) === originalXml).toBe(true)
    return { next: back.package, applied: { result: treeResult, plan: tree.value } }
  }

  const KINDS: Kind[] = ['insert-row', 'delete-row', 'insert-column', 'delete-column', 'merge-right']

  async function runDifferential(original: HwpxSourcePackage, sectionPaths: readonly string[]): Promise<void> {
    let current = original
    let position = 0
    for (const sectionPath of sectionPaths) {
      const targets = cellTargets(original, sectionPath)
      totals.tables += findSourceElements(packageEntryTree(original, sectionPath), 'hp:tbl').length
      totals.cells += targets.length
      for (const target of targets) {
        // 주기적으로 cache를 지워 cache miss(첫 조회 parse) 경로도 섞는다.
        if (position++ % 7 === 3) forgetPackageTrees(current)
        for (const kind of KINDS) {
          const { next, applied } = compare(current, kind, target)
          current = next
          if (kind === 'merge-right' && applied) {
            // 방금 병합한 셀을 분할한다(selection은 병합 뒤 첫 text).
            compare(applied.result.package, 'split', target, applied.plan.selectionAfter.anchorTextNodeId)
          }
        }
        if (target.merged) current = compare(current, 'split', target).next
      }
    }
  }

  test('비교 대상에 synthetic·external fixture가 모두 있다', () => {
    expect(openedFixtures.length).toBe(34)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: 표 구조 command가 전환 전 경로와 같은 오류·결과를 만들고 undo·redo가 정확하다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      totals.fixtures += 1
      await runDifferential(original, index.sectionPaths)
    },
    600_000
  )

  test('differential이 6종 command의 적용·거부를 모두 거쳤다', () => {
    for (const kind of [...KINDS, 'split']) expect(totals.byKind[kind]).toBeGreaterThan(0)
    expect(totals.rejected).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // 전환 전 경로와 다른 동작(공개 corpus에는 없음). 새 경로 동작은 `table_patch.test.ts`가 고정한다.

  test('전환 전 경로의 잠재 버그: CDATA as-tag·정규식 attribute·entity attribute·분할 편집 범위 겹침', async () => {
    const base = await HwpxSourcePackage.open(generators.createTableColumnHwpx(directory, 'table-divergence.hwpx'))
    const sectionPath = 'Contents/section0.xml'
    const xml = section(base, sectionPath)
    const variant = (transform: (xml: string) => string): HwpxSourcePackage =>
      base.withEntry(sectionPath, Buffer.from(transform(xml), 'utf8'))
    const caretAt = (source: HwpxSourcePackage, text: string): EditorSelection => {
      const anchor = listHwpxTextAnchors(source, sectionPath).find((item) => item.text === text)!
      return createEditorSelection(sectionPath, anchor.textNodeId, 0)
    }
    const divergences: string[] = []
    const record = (name: string, legacy: () => unknown, tree: () => unknown): { legacy: unknown; tree: unknown } => {
      const legacyResult = attempt(legacy)
      const treeResult = attempt(tree)
      divergences.push(name)
      return {
        legacy: 'error' in legacyResult ? legacyResult.error.message : legacyResult.value,
        tree: 'error' in treeResult ? treeResult.error.message : treeResult.value
      }
    }

    // CDATA 안의 `<hp:t>`를 element로 세어 anchor가 한 칸 앞(H3, 머리글) 셀을 가리킨다.
    const markup = variant(cdataWithMarkup)
    const markupResult = record(
      'cdata-markup',
      () => legacyPlanInsertTableRowAfter(markup, caretAt(markup, 'A1')),
      () => planInsertTableRowAfter(markup, caretAt(markup, 'A1'))
    )
    expect(markupResult.legacy).toBe('반복 머리글 행을 기준으로 행을 추가할 수 없습니다.')
    expect(markupResult.tree).toHaveProperty('command')

    // CDATA 안의 짝 없는 따옴표 뒤를 tag 안으로 읽는다.
    const quote = variant(cdataWithQuote)
    const quoteResult = record(
      'cdata-quote',
      () => legacyPlanInsertTableRowAfter(quote, caretAt(quote, 'A1')),
      () => planInsertTableRowAfter(quote, caretAt(quote, 'A1'))
    )
    expect(quoteResult.legacy).toBe('끝나지 않은 XML tag가 있습니다.')
    expect(quoteResult.tree).toHaveProperty('command')

    // 다른 attribute 값 안의 `rowAddr='2'`를 읽고(검사 통과) 고친다.
    const inside = variant(attributeInsideValue)
    const insideResult = record(
      'attribute-inside-value',
      () => legacyPlanInsertTableRowAfter(inside, caretAt(inside, 'A1')).command.replacementFragment,
      () => planInsertTableRowAfter(inside, caretAt(inside, 'A1')).command.replacementFragment
    )
    expect(insideResult.legacy).toContain(`<hp:cellAddr note=" rowAddr='3'" colAddr="0" rowAddr="2"/>`)
    expect(insideResult.tree).toContain(NOTE_ADDRESS.replace('rowAddr="2"', 'rowAddr="3"'))

    // 문자 참조 attribute를 해석하지 않아 숫자로 읽지 못한다.
    const entity = variant(entityAttribute)
    const entityResult = record(
      'entity-attribute',
      () => legacyPlanInsertTableRowAfter(entity, caretAt(entity, 'A1')),
      () => planInsertTableRowAfter(entity, caretAt(entity, 'A1'))
    )
    expect(entityResult.legacy).toBe('병합·span 또는 불연속 주소가 있는 표에는 아직 행을 추가할 수 없습니다.')
    expect(entityResult.tree).toHaveProperty('command')

    // 분할: 지울 문단과 그 안 hp:linesegarray 편집 범위가 겹쳐 복제 셀 끝이 잘린다(잘못된 XML).
    const merged = variant(mergedCellWithTrailingLineSegments)
    const anchor = listHwpxTextAnchors(merged, sectionPath).find((item) => item.text === 'A1')!
    const selection: TableCellSelection = {
      sectionPath,
      textNodeId: anchor.textNodeId,
      tableId: 'column-table',
      sourceCellId: 'repro',
      row: 1,
      column: 0
    }
    const splitResult = record(
      'split-overlapping-edits',
      () => legacyPlanSplitTableCell(merged, selection).command.replacementFragment,
      () => planSplitTableCell(merged, selection).command.replacementFragment
    )
    const truncated = SPLIT_RIGHT_CELL.slice(0, -'</hp:subList></hp:tc>'.length)
    expect(splitResult.legacy).toContain(truncated + '<hp:tc')
    expect(splitResult.legacy).not.toContain(SPLIT_RIGHT_CELL)
    expect(splitResult.tree).toContain(SPLIT_RIGHT_CELL)
    expect(divergences).toHaveLength(5)
  })
})
