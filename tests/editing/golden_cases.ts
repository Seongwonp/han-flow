import { readFileSync } from 'fs'
import { join } from 'path'
import { applyCellStyleCommand, applyRestoreCellStyleCommand } from '../../src/core/editing/cell_style_patch'
import { packageEntryTree } from '../../src/core/editing/package_trees'
import {
  applyReplaceParagraphFragmentCommand,
  planMergeParagraph,
  planReplaceParagraphSelection,
  planSplitParagraph
} from '../../src/core/editing/paragraph_patch'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { getSourceAttribute, nearestSourceAncestor, SourceElement } from '../../src/core/editing/source_tree'
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

// 편집 command 결정적 표본(공개 corpus fixture마다 text·style·paragraph·table family). golden 회귀
// (`editing_golden.test.ts`)와 증분 projection 동치 검사(`tests/parser/viewer_projection.test.ts`)가 같은 표본을 쓴다.

export interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  generator?: string
  fileName?: string
  file?: string
  options?: Record<string, unknown>
  expected: { outcome: string }
}

export const publicRoot = join(__dirname, '../fixtures/public')
const manifest = JSON.parse(
  readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
) as { fixtures: ManifestFixture[] }
export const openedFixtures = manifest.fixtures.filter((fixture) => fixture.expected.outcome === 'opened')

/** fixture마다 text·style·paragraph family에 쓰는 anchor 수(모든 section의 편집 가능 anchor에서 고르게 뽑는다). */
export const ANCHOR_SAMPLE = 4

export interface Case {
  label: string
  /** command(또는 계획)을 만든다. 계획이면 selection도 기록한다. */
  build: (sourcePackage: HwpxSourcePackage) => { command: EditCommand; selectionAfter?: EditorSelection }
}

export interface AppliedResult {
  package: HwpxSourcePackage
  inverse?: EditCommand
  changed?: boolean
}

export function applyCommand(sourcePackage: HwpxSourcePackage, command: EditCommand): AppliedResult {
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

export function safeOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, offset))
  while (!isSurrogateBoundarySafe(text, value)) value -= 1
  return value
}

export function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items]
  return Array.from({ length: count }, (_value, index) => items[Math.floor((index * items.length) / count)])
}

// ---------------------------------------------------------------------------
// family별 command 표본

export interface Located {
  sectionPath: string
  anchor: HwpxTextAnchor
  /** 같은 section에서 다음 편집 가능 anchor(범위 치환 끝) */
  next?: HwpxTextAnchor
}

export function textCases({ sectionPath, anchor }: Located): Case[] {
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

export function styleCases({ sectionPath, anchor }: Located): Case[] {
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

export function paragraphCases({ sectionPath, anchor, next }: Located): Case[] {
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
export function tableCases(sourcePackage: HwpxSourcePackage, sectionPath: string): Case[] {
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

export type Family = 'text' | 'style' | 'paragraph' | 'table'
export const FAMILIES: Family[] = ['text', 'style', 'paragraph', 'table']

/** manifest fixture의 파일 경로. generator fixture는 `directory`에 만든다. */
export function fixturePath(directory: string, fixture: ManifestFixture): string {
  if (fixture.source === 'file') return join(publicRoot, fixture.file!)
  const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
    fixture.generator!
  ]
  return create(directory, fixture.options ?? fixture.fileName)
}

/** fixture 하나의 family별 command 표본. */
export async function casesByFamily(original: HwpxSourcePackage): Promise<Record<Family, Case[]>> {
  const index = await original.index()
  const located: Located[] = index.sectionPaths.flatMap((sectionPath) => {
    const anchors = listHwpxTextAnchors(original, sectionPath)
    return anchors.map((anchor, position) => ({ sectionPath, anchor, next: anchors[position + 1] }))
  })
  const picked = sample(located, ANCHOR_SAMPLE)
  return {
    text: picked.flatMap(textCases),
    style: picked.flatMap(styleCases),
    paragraph: picked.flatMap(paragraphCases),
    table: index.sectionPaths.flatMap((sectionPath) => tableCases(original, sectionPath))
  }
}
