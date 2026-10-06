import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyCellStyleCommand, applyRestoreCellStyleCommand } from '../../src/core/editing/cell_style_patch'
import { forgetPackageTrees, packageEntryTree } from '../../src/core/editing/package_trees'
import {
  applyReplaceParagraphFragmentCommand,
  planMergeParagraph,
  planReplaceParagraphSelection,
  planSplitParagraph
} from '../../src/core/editing/paragraph_patch'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { getSourceAttribute, nearestSourceAncestor, serializeSourceTree, SourceElement } from '../../src/core/editing/source_tree'
import {
  applyCharacterStyleCommand,
  applyParagraphStyleCommand,
  applyRestoreCharacterRunCommand,
  applyRestoreStyleCommand
} from '../../src/core/editing/style_patch'
import {
  applyReplaceTableFragmentCommand,
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planInsertTableRowAfter,
  planMergeTableCellRight,
  planSplitTableCell
} from '../../src/core/editing/table_patch'
import {
  applyReplaceTextCommand,
  HwpxTextAnchor,
  listHwpxTextAnchors,
  locateHwpxTextElement
} from '../../src/core/editing/text_patch'
import { EditCommand } from '../../src/core/editing/transaction'
import { isSurrogateBoundarySafe } from '../../src/core/editing/xml_scan'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// 편집 command golden 회귀(tree 전환 뒤 legacy differential을 대신한다).
// 공개 corpus 34종마다 command family(text·style·paragraph·table)별로 결정적인 command 표본을 적용하고, 결과를
// `tests/editing/golden/<family>.json`의 기록과 비교한다. 기록은 바뀐 entry(section·header.xml)의 SHA-256(+ 계획이 돌려준
// selection), 거부면 오류 class·message, 바뀌지 않으면 `unchanged`다. 바뀐 모든 command는 inverse가 원래 bytes를, 그 inverse가
// 결과 bytes를 되살리는지(exact undo·redo) 확인한다. 되돌린 package를 다음 command에 이어 써서 tree cache hit와 주기적
// cache miss를 함께 거친다.
// 의도한 동작 변경 뒤 기록 갱신: `HAN_FLOW_UPDATE_GOLDEN=1 npx jest tests/editing/editing_golden.test.ts`

interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  generator?: string
  fileName?: string
  file?: string
  options?: Record<string, unknown>
  expected: { outcome: string }
}

type Family = 'text' | 'style' | 'paragraph' | 'table'
type Golden = Record<string, Record<string, string>>

const FAMILIES: Family[] = ['text', 'style', 'paragraph', 'table']
const UPDATE = process.env.HAN_FLOW_UPDATE_GOLDEN === '1'
const goldenDirectory = join(__dirname, 'golden')
const publicRoot = join(__dirname, '../fixtures/public')
const manifest = JSON.parse(
  readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
) as { fixtures: ManifestFixture[] }
const openedFixtures = manifest.fixtures.filter((fixture) => fixture.expected.outcome === 'opened')

/** fixture마다 text·style·paragraph family에 쓰는 anchor 수(모든 section의 편집 가능 anchor에서 고르게 뽑는다). */
const ANCHOR_SAMPLE = 4
const EDITABLE_ENTRY = /^Contents\/(?:section\d+|header)\.xml$/

interface Case {
  label: string
  /** command(또는 계획)을 만든다. 계획이면 selection도 기록한다. */
  build: (sourcePackage: HwpxSourcePackage) => { command: EditCommand; selectionAfter?: EditorSelection }
}

interface AppliedResult {
  package: HwpxSourcePackage
  inverse?: EditCommand
  changed?: boolean
}

function applyCommand(sourcePackage: HwpxSourcePackage, command: EditCommand): AppliedResult {
  switch (command.type) {
    case 'replace-text': {
      const result = applyReplaceTextCommand(sourcePackage, { ...command, revision: sourcePackage.revision })
      const { revision: _revision, ...inverse } = result.inverse
      return { package: result.package, inverse }
    }
    case 'apply-character-style':
      return applyCharacterStyleCommand(sourcePackage, command)
    case 'apply-paragraph-style':
      return applyParagraphStyleCommand(sourcePackage, command)
    case 'restore-style':
      return applyRestoreStyleCommand(sourcePackage, command)
    case 'restore-character-run':
      return applyRestoreCharacterRunCommand(sourcePackage, command)
    case 'apply-cell-style':
      return applyCellStyleCommand(sourcePackage, command)
    case 'restore-cell-style':
      return applyRestoreCellStyleCommand(sourcePackage, command)
    case 'replace-table-fragment':
      return applyReplaceTableFragmentCommand(sourcePackage, command)
    case 'replace-paragraph-fragment':
      return applyReplaceParagraphFragmentCommand(sourcePackage, command)
  }
}

function safeOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, offset))
  while (!isSurrogateBoundarySafe(text, value)) value -= 1
  return value
}

function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items]
  return Array.from({ length: count }, (_value, index) => items[Math.floor((index * items.length) / count)])
}

function ordinalOf(textNodeId: string): string {
  return textNodeId.slice(textNodeId.lastIndexOf(':') + 1)
}

function selectionLabel(selection: EditorSelection): string {
  return `${ordinalOf(selection.anchorTextNodeId)}:${selection.anchorOffset}-${ordinalOf(selection.focusTextNodeId)}:${selection.focusOffset}`
}

function sha256(...parts: Array<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------
// family별 command 표본

interface Located {
  sectionPath: string
  anchor: HwpxTextAnchor
  /** 같은 section에서 다음 편집 가능 anchor(범위 치환 끝) */
  next?: HwpxTextAnchor
}

function textCases({ sectionPath, anchor }: Located): Case[] {
  const id = anchor.textNodeId
  const middle = safeOffset(anchor.text, Math.floor(anchor.text.length / 2))
  const text = (from: number, to: number, insert: string): Case['build'] => () => ({
    command: { type: 'replace-text', sectionPath, textNodeId: id, from, to, insert }
  })
  return [
    { label: `${anchor.ordinal} insert`, build: text(middle, middle, '가&<"\'') },
    { label: `${anchor.ordinal} delete`, build: text(0, safeOffset(anchor.text, 1), '') },
    { label: `${anchor.ordinal} replace-all`, build: text(0, anchor.text.length, 'x\ty\nz') }
  ]
}

function styleCases({ sectionPath, anchor }: Located): Case[] {
  const base = { sectionPath, textNodeId: anchor.textNodeId }
  const cases: Case[] = [
    { label: `${anchor.ordinal} bold`, build: () => ({ command: { type: 'apply-character-style', ...base, bold: true } }) },
    {
      label: `${anchor.ordinal} italic-underline-size-color`,
      build: () => ({
        command: { type: 'apply-character-style', ...base, italic: true, underline: true, height: 1500, color: '#12ab34' }
      })
    },
    { label: `${anchor.ordinal} align`, build: () => ({ command: { type: 'apply-paragraph-style', ...base, align: 'CENTER' } }) },
    {
      label: `${anchor.ordinal} spacing`,
      build: () => ({
        command: { type: 'apply-paragraph-style', ...base, lineSpacing: 180, marginBefore: 200, marginAfter: 100, indent: -300 }
      })
    },
    {
      label: `${anchor.ordinal} cell`,
      build: () => ({
        command: {
          type: 'apply-cell-style',
          ...base,
          backgroundColor: '#abcdef',
          borderColor: '#123456',
          borderWidth: 0.4,
          borderType: 'SOLID'
        }
      })
    }
  ]
  const from = safeOffset(anchor.text, 1)
  const to = safeOffset(anchor.text, anchor.text.length - 1)
  if (from < to) {
    cases.push({
      label: `${anchor.ordinal} partial-bold`,
      build: () => ({ command: { type: 'apply-character-style', ...base, bold: true, from, to } })
    })
  }
  return cases
}

function paragraphCases({ sectionPath, anchor, next }: Located): Case[] {
  const id = anchor.textNodeId
  const middle = safeOffset(anchor.text, Math.floor(anchor.text.length / 2))
  const cases: Case[] = [
    { label: `${anchor.ordinal} split`, build: (source) => planSplitParagraph(source, createEditorSelection(sectionPath, id, middle)) },
    {
      label: `${anchor.ordinal} merge-previous`,
      build: (source) => planMergeParagraph(source, createEditorSelection(sectionPath, id, 0), 'previous')
    },
    {
      label: `${anchor.ordinal} merge-next`,
      build: (source) => planMergeParagraph(source, createEditorSelection(sectionPath, id, anchor.text.length), 'next')
    }
  ]
  if (next) {
    const selection: EditorSelection = {
      sectionPath,
      anchorTextNodeId: id,
      anchorOffset: middle,
      focusTextNodeId: next.textNodeId,
      focusOffset: safeOffset(next.text, Math.ceil(next.text.length / 2))
    }
    cases.push({
      label: `${anchor.ordinal} range`,
      build: (source) => planReplaceParagraphSelection(source, selection, '삽입\n줄')
    })
  }
  return cases
}

/** 편집 가능한 anchor가 있는 직계 표 셀마다 6종 표 구조 command. */
function tableCases(sourcePackage: HwpxSourcePackage, sectionPath: string): Case[] {
  const tree = packageEntryTree(sourcePackage, sectionPath)
  const seen = new Set<SourceElement>()
  const cases: Case[] = []
  for (const anchor of listHwpxTextAnchors(sourcePackage, sectionPath)) {
    const { element } = locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!
    const cell = nearestSourceAncestor(element, 'hp:tc')
    const row = cell?.parent
    const table = row?.parent
    if (!cell || seen.has(cell) || row?.name !== 'hp:tr' || table?.name !== 'hp:tbl') continue
    seen.add(cell)
    const caret = createEditorSelection(sectionPath, anchor.textNodeId, 0)
    const address = cell.children.find(
      (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:cellAddr'
    )
    const split = {
      sectionPath,
      textNodeId: anchor.textNodeId,
      tableId: 'golden',
      sourceCellId: 'golden',
      row: table.children.filter((child) => child.kind === 'element' && child.name === 'hp:tr').indexOf(row),
      column: Number(address && getSourceAttribute(tree, address, 'colAddr'))
    }
    const label = `${sectionPath.replace(/^Contents\//, '')} ${anchor.ordinal}`
    cases.push(
      { label: `${label} insert-row`, build: (source) => planInsertTableRowAfter(source, caret) },
      { label: `${label} delete-row`, build: (source) => planDeleteTableRow(source, caret) },
      { label: `${label} insert-column`, build: (source) => planInsertTableColumnAfter(source, caret) },
      { label: `${label} delete-column`, build: (source) => planDeleteTableColumn(source, caret) },
      { label: `${label} merge-right`, build: (source) => planMergeTableCellRight(source, caret) },
      { label: `${label} split`, build: (source) => planSplitTableCell(source, split) }
    )
  }
  return cases
}

// ---------------------------------------------------------------------------

describe('편집 command golden 회귀', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-golden-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  const stored = Object.fromEntries(FAMILIES.map((family) => {
    const path = join(goldenDirectory, `${family}.json`)
    return [family, existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Golden) : {}]
  })) as Record<Family, Golden>
  const actual = Object.fromEntries(FAMILIES.map((family) => [family, {} as Golden])) as Record<Family, Golden>
  const totals = { cases: 0, rejected: 0, unchanged: 0, changed: 0, undos: 0 }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (UPDATE) {
      mkdirSync(goldenDirectory, { recursive: true })
      for (const family of FAMILIES) {
        const ordered = Object.fromEntries(
          openedFixtures.filter((fixture) => actual[family][fixture.id]).map((fixture) => [fixture.id, actual[family][fixture.id]])
        )
        writeFileSync(join(goldenDirectory, `${family}.json`), `${JSON.stringify(ordered, null, 1)}\n`)
      }
    }
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') console.log(`HAN_FLOW_EDITING_GOLDEN ${JSON.stringify(totals)}`)
  })

  /** case 하나를 적용·되돌리기·다시 적용하고 기록 문자열과 다음 case에 쓸 package(원문 bytes)를 돌려준다. */
  function run(base: HwpxSourcePackage, testCase: Case): { record: string; next: HwpxSourcePackage } {
    totals.cases += 1
    let built: ReturnType<Case['build']>
    let result: AppliedResult
    try {
      built = testCase.build(base)
      result = applyCommand(base, built.command)
    } catch (error) {
      totals.rejected += 1
      return { record: `! ${(error as Error).constructor.name}: ${(error as Error).message}`, next: base }
    }
    if (result.package === base || result.changed === false) {
      totals.unchanged += 1
      return { record: 'unchanged', next: base }
    }
    totals.changed += 1
    // 편집 command가 바꿀 수 있는 entry는 section과 header.xml뿐이다(그 밖의 entry는 loss report·identity test가 지킨다).
    const modified = result.package.listEntries()
      .map((entry) => entry.path)
      .filter((path) => EDITABLE_ENTRY.test(path) && !result.package.readEntry(path).equals(base.readEntry(path)))
    expect(modified.length).toBeGreaterThan(0)
    const parts: Array<string | Buffer> = []
    for (const path of modified) parts.push(path, '\0', result.package.readEntry(path), '\0')
    const selection = built.selectionAfter ? ` @${selectionLabel(built.selectionAfter)}` : ''
    // 결과 package에 붙은 tree cache가 bytes와 같다.
    for (const path of modified) {
      if (/^Contents\/section\d+\.xml$/.test(path) && totals.changed % 4 === 0) {
        expect(serializeSourceTree(packageEntryTree(result.package, path)) === result.package.readEntry(path).toString('utf8')).toBe(true)
      }
    }
    // exact undo·redo
    const undo = applyCommand(result.package, result.inverse!)
    for (const path of modified) expect(undo.package.readEntry(path).equals(base.readEntry(path))).toBe(true)
    const redo = applyCommand(undo.package, undo.inverse!)
    for (const path of modified) expect(redo.package.readEntry(path).equals(result.package.readEntry(path))).toBe(true)
    const back = applyCommand(redo.package, redo.inverse!)
    for (const path of modified) expect(back.package.readEntry(path).equals(base.readEntry(path))).toBe(true)
    totals.undos += 1
    return { record: `${modified.join(',')} ${sha256(...parts)}${selection}`, next: back.package }
  }

  test('golden 기록이 34종 fixture와 4개 family를 덮는다', () => {
    expect(openedFixtures.length).toBe(34)
    if (!UPDATE) for (const family of FAMILIES) expect(Object.keys(stored[family]).length).toBe(openedFixtures.length)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: family별 command 표본의 결과가 golden 기록과 같고 undo·redo가 정확하다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      const located: Located[] = index.sectionPaths.flatMap((sectionPath) => {
        const anchors = listHwpxTextAnchors(original, sectionPath)
        return anchors.map((anchor, position) => ({ sectionPath, anchor, next: anchors[position + 1] }))
      })
      const picked = sample(located, ANCHOR_SAMPLE)
      const casesByFamily: Record<Family, Case[]> = {
        text: picked.flatMap(textCases),
        style: picked.flatMap(styleCases),
        paragraph: picked.flatMap(paragraphCases),
        table: index.sectionPaths.flatMap((sectionPath) => tableCases(original, sectionPath))
      }
      let current = original
      let position = 0
      for (const family of FAMILIES) {
        const records: Record<string, string> = {}
        for (const testCase of casesByFamily[family]) {
          if (position++ % 7 === 3) forgetPackageTrees(current)
          const { record, next } = run(current, testCase)
          records[testCase.label] = record
          current = next
        }
        actual[family][fixture.id] = records
        if (!UPDATE) expect(records).toEqual(stored[family][fixture.id])
      }
    },
    120_000
  )

  test('표본이 적용·거부·변화 없음을 모두 거쳤다', () => {
    expect(totals.changed).toBeGreaterThan(0)
    expect(totals.rejected).toBeGreaterThan(0)
  })
})
