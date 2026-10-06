import { HwpxSourcePackage } from '../parser/source_package'
import { EditorSelection, normalizeEditorSelection } from './selection'
import { TableCellSelection } from './table_cell_selection'
import {
  HwpxEditConflictError,
  HwpxLossReport,
  hwpxTextOrdinal,
  invalidateHwpxTextIndex,
  listHwpxTextAnchors,
  locateHwpxTextElement
} from './text_patch'
import { buildLossReport } from './xml_scan'
import { putPackageTrees, takePackageTrees, withSerializedTree } from './package_trees'
import {
  findDescendantSourceElements,
  findFirstSourceElement,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  parseSourceTree,
  parseTagAttributes,
  replaceElementChildren,
  replaceSourceNode,
  serializeSourceNode,
  serializeSourceTree,
  setSourceAttribute,
  SourceElement,
  SourceNode,
  SourceTree,
  spliceSourceChildren,
  elementOpenTag
} from './source_tree'

/**
 * 표 구조 command: 행 추가(선택 행 아래)·삭제, 열 추가(선택 열 오른쪽)·삭제, 수평 1×2 셀 병합(오른쪽 셀)과 그 분할.
 *
 * section source tree(`package_trees.ts` cache)에서 anchor의 `hp:t`부터 부모를 따라 `hp:tc`·`hp:tr`·`hp:tbl`을 찾고,
 * topology 검사(병합 없는 직사각형 표, 단순 텍스트 셀, 반복 머리글, 고유 ID, 크기 attribute)를 tree node와 따옴표를
 * 인식하는 attribute API로 한다. 교체 fragment는 표 node를 작업용 tree로 복제해 tree 연산(attribute 변경, 자식
 * 추가·삭제)으로 고친 뒤 직렬화한다. 손대지 않은 셀·행은 원문 표기 그대로이고, 새로 만든 빈 행·열·분할 셀은 전과 같이
 * 선택한 행·셀 원문을 복제해 `hp:t` 내용을 비우고 `hp:linesegarray`를 지우고 문단 ID를 새로 매긴 것이다.
 *
 * command·inverse는 전과 같은 `replace-table-fragment`(표 원문 fragment 교체)다. inverse가 바뀌기 전 표 bytes를 그대로
 * 들고 있어 실행 취소는 언제나 원래 bytes를 복원한다. 적용은 tree에서 표 node를 교체 fragment 조각 node로 바꾸고
 * cache를 새 package로 옮긴다.
 */

export interface ReplaceTableFragmentCommand {
  type: 'replace-table-fragment'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
  replacementTextNodeId?: string
}

export interface InsertTableRowPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export interface DeleteTableRowPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export interface InsertTableColumnPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export interface DeleteTableColumnPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export interface MergeTableCellRightPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export interface SplitTableCellPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

export type TablePatchResult =
  | { package: HwpxSourcePackage; inverse: ReplaceTableFragmentCommand; lossReport: HwpxLossReport; changed: true }
  | { package: HwpxSourcePackage; inverse?: undefined; lossReport: HwpxLossReport; changed: false }

interface TableContext {
  tree: SourceTree
  text: SourceElement
  cell: SourceElement
  row: SourceElement
  table: SourceElement
}

/** 단순 텍스트 셀의 `hp:subList` 안에 허용하는 element. */
const SIMPLE_CELL_CONTENT = new Set(['hp:p', 'hp:run', 'hp:t', 'hp:linesegarray', 'hp:lineseg'])

/** 새로 만든 조각 node는 여는·닫는 tag 원문을 직접 들고 있어 tree 원문이 필요 없다. */
const DETACHED: SourceTree = { source: '', children: [] }

function children(parent: SourceElement, name: string): SourceElement[] {
  return parent.children.filter(
    (child): child is SourceElement => child.kind === 'element' && child.name === name
  )
}

function firstChild(parent: SourceElement, name: string): SourceElement | undefined {
  return parent.children.find(
    (child): child is SourceElement => child.kind === 'element' && child.name === name
  )
}

function attr(tree: SourceTree, element: SourceElement, name: string): string | undefined {
  return getSourceAttribute(tree, element, name)
}

function numberAttr(tree: SourceTree, element: SourceElement | undefined, name: string): number {
  return element ? Number(attr(tree, element, name)) : Number.NaN
}

function everyDescendantElement(element: SourceElement, predicate: (element: SourceElement) => boolean): boolean {
  for (const child of element.children) {
    if (child.kind !== 'element') continue
    if (!predicate(child) || !everyDescendantElement(child, predicate)) return false
  }
  return true
}

function locateTable(sourcePackage: HwpxSourcePackage, sectionPath: string, textNodeId: string): TableContext {
  // section 경로 검사·오류 message를 전과 같게 하려고 anchor 목록을 먼저 조회한다(package별 cache).
  listHwpxTextAnchors(sourcePackage, sectionPath)
  const located = locateHwpxTextElement(sourcePackage, sectionPath, textNodeId)
  if (!located) throw new HwpxEditConflictError('표 anchor를 찾을 수 없습니다.')
  const { tree, element: text } = located
  const cell = nearestSourceAncestor(text, 'hp:tc')
  const row = cell && nearestSourceAncestor(cell, 'hp:tr')
  const table = row && nearestSourceAncestor(row, 'hp:tbl')
  if (!cell || !row || !table || row.parent !== table || cell.parent !== row) {
    throw new HwpxEditConflictError('표 행 추가는 일반 표 셀에서만 지원합니다.')
  }
  return { tree, text, cell, row, table }
}

function assertSameCell(start: TableContext, end: TableContext, message: string, compareCell = true): void {
  if (start.table !== end.table || start.row !== end.row || (compareCell && start.cell !== end.cell)) {
    throw new HwpxEditConflictError(message)
  }
}

interface SimpleTable {
  rows: SourceElement[]
  columnCount: number
  selectedRowIndex: number
  selectedColumnIndex: number
  selectedRowHeight: number
  selectedColumnWidth: number
}

/** 셀의 `hp:subList` 하나가 단순 텍스트 문단(run 하나·`hp:t` 하나)만 담는지 검사한다. 검사 순서·message는 전과 같다. */
function assertSimpleCellContent(
  subList: SourceElement,
  messages: { noParagraph: string; complexElement: string; complexRun: string }
): SourceElement[] {
  const paragraphs = children(subList, 'hp:p')
  if (!paragraphs.length) throw new HwpxEditConflictError(messages.noParagraph)
  if (!everyDescendantElement(subList, (element) => SIMPLE_CELL_CONTENT.has(element.name))) {
    throw new HwpxEditConflictError(messages.complexElement)
  }
  for (const paragraph of paragraphs) {
    const runs = children(paragraph, 'hp:run')
    const texts = runs.flatMap((run) => children(run, 'hp:t'))
    if (runs.length !== 1 || texts.length !== 1) throw new HwpxEditConflictError(messages.complexRun)
  }
  return paragraphs
}

function assertSimpleRectangularTable(context: TableContext): SimpleTable {
  const { tree, table, row: selectedRow, cell: selectedCell } = context
  const rowCount = Number(attr(tree, table, 'rowCnt'))
  const columnCount = Number(attr(tree, table, 'colCnt'))
  const rows = children(table, 'hp:tr')
  const tableSize = firstChild(table, 'hp:sz')
  const tableHeight = numberAttr(tree, tableSize, 'height')
  const tableWidth = numberAttr(tree, tableSize, 'width')
  if (!Number.isSafeInteger(rowCount) || rowCount !== rows.length || !Number.isSafeInteger(columnCount) || columnCount < 1) {
    throw new HwpxEditConflictError('표 행·열 개수와 실제 구조가 일치하지 않습니다.')
  }
  if (!Number.isFinite(tableHeight) || tableHeight < 0) {
    throw new HwpxEditConflictError('표 전체 높이가 올바르지 않습니다.')
  }
  if (!Number.isFinite(tableWidth) || tableWidth < 0) {
    throw new HwpxEditConflictError('표 전체 너비가 올바르지 않습니다.')
  }
  if (findFirstSourceElement(table, 'hp:tbl')) {
    throw new HwpxEditConflictError('중첩 표가 있는 표에는 아직 행을 추가할 수 없습니다.')
  }
  let selectedRowHeight = 0
  let selectedColumnIndex = -1
  let selectedColumnWidth = 0
  rows.forEach((row, rowIndex) => {
    if (attr(tree, row, 'id') !== undefined) {
      throw new HwpxEditConflictError('고유 ID가 있는 행은 아직 복제할 수 없습니다.')
    }
    const cells = children(row, 'hp:tc')
    if (cells.length !== columnCount) throw new HwpxEditConflictError('직사각형 표에만 행을 추가할 수 있습니다.')
    cells.forEach((cell, columnIndex) => {
      if (attr(tree, cell, 'id') !== undefined) {
        throw new HwpxEditConflictError('고유 ID가 있는 셀은 아직 복제할 수 없습니다.')
      }
      const address = firstChild(cell, 'hp:cellAddr')
      const span = firstChild(cell, 'hp:cellSpan')
      const cellSize = firstChild(cell, 'hp:cellSz')
      if (
        !address || !span || !cellSize ||
        Number(attr(tree, address, 'rowAddr')) !== rowIndex ||
        Number(attr(tree, address, 'colAddr')) !== columnIndex ||
        Number(attr(tree, span, 'rowSpan')) !== 1 ||
        Number(attr(tree, span, 'colSpan')) !== 1
      ) throw new HwpxEditConflictError('병합·span 또는 불연속 주소가 있는 표에는 아직 행을 추가할 수 없습니다.')
      const cellHeight = Number(attr(tree, cellSize, 'height'))
      const cellWidth = Number(attr(tree, cellSize, 'width'))
      if (!Number.isFinite(cellHeight) || cellHeight < 0) {
        throw new HwpxEditConflictError('표 셀 높이가 올바르지 않습니다.')
      }
      if (!Number.isFinite(cellWidth) || cellWidth < 0) {
        throw new HwpxEditConflictError('표 셀 너비가 올바르지 않습니다.')
      }
      if (row === selectedRow) selectedRowHeight = Math.max(selectedRowHeight, cellHeight)
      if (cell === selectedCell) {
        selectedColumnIndex = columnIndex
        selectedColumnWidth = cellWidth
      }
      const subLists = children(cell, 'hp:subList')
      if (subLists.length !== 1) throw new HwpxEditConflictError('단순 텍스트 셀로 이루어진 표에만 행을 추가할 수 있습니다.')
      assertSimpleCellContent(subLists[0], {
        noParagraph: '빈 문단 구조가 없는 셀에는 행을 추가할 수 없습니다.',
        complexElement: '이미지·제어 문자 등 복합 콘텐츠가 있는 표에는 아직 행을 추가할 수 없습니다.',
        complexRun: '복합 콘텐츠가 있는 표에는 아직 행을 추가할 수 없습니다.'
      })
      if (cell === selectedCell && attr(tree, cell, 'header') === '1') {
        throw new HwpxEditConflictError('반복 머리글 행을 기준으로 행을 추가할 수 없습니다.')
      }
    })
  })
  const selectedRowIndex = rows.indexOf(selectedRow)
  if (selectedRowIndex < 0) throw new HwpxEditConflictError('선택한 표 행을 찾을 수 없습니다.')
  if (selectedColumnIndex < 0) throw new HwpxEditConflictError('선택한 표 열을 찾을 수 없습니다.')
  if (tableHeight < selectedRowHeight) {
    throw new HwpxEditConflictError('표 전체 높이가 선택 행 높이보다 작습니다.')
  }
  if (tableWidth < selectedColumnWidth) {
    throw new HwpxEditConflictError('표 전체 너비가 선택 열 너비보다 작습니다.')
  }
  return { rows, columnCount, selectedRowIndex, selectedColumnIndex, selectedRowHeight, selectedColumnWidth }
}

// ---------------------------------------------------------------------------
// 문단 ID·text ordinal

/** section의 숫자 문단 ID 최댓값 + 1. 숫자가 아닌 ID가 있으면 `message`로 거부한다. */
function nextParagraphId(tree: SourceTree, message: string): { next: number } {
  const ids: string[] = []
  const visit = (nodes: readonly SourceNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (node.name === 'hp:p') {
        const id = attr(tree, node, 'id')
        if (id !== undefined) ids.push(id)
      }
      if (node.children.length) visit(node.children)
    }
  }
  visit(tree.children)
  if (ids.some((id) => !/^\d+$/.test(id))) throw new HwpxEditConflictError(message)
  return { next: ids.map(Number).reduce((maximum, id) => Math.max(maximum, id), -1) + 1 }
}

const ROW_PARAGRAPH_ID_MESSAGE = '숫자가 아닌 문단 ID가 있는 표에는 행을 추가할 수 없습니다.'
const STRUCTURE_PARAGRAPH_ID_MESSAGE = '숫자가 아닌 문단 ID가 있는 표의 구조는 편집할 수 없습니다.'

function ordinalOf(sourcePackage: HwpxSourcePackage, sectionPath: string, text: SourceElement): number {
  const ordinal = hwpxTextOrdinal(sourcePackage, sectionPath, text)
  if (ordinal < 0) throw new HwpxEditConflictError('표 anchor가 올바르지 않습니다.')
  return ordinal
}

function textNodeId(sectionPath: string, ordinal: number): string {
  return `${sectionPath}#hp:t:${ordinal}`
}

function shiftTextNodeId(sectionPath: string, id: string, delta: number): string {
  const prefix = `${sectionPath}#hp:t:`
  const ordinal = Number(id.slice(prefix.length))
  if (!id.startsWith(prefix) || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new HwpxEditConflictError('표 anchor가 올바르지 않습니다.')
  }
  return textNodeId(sectionPath, ordinal + delta)
}

function caret(sectionPath: string, id: string): EditorSelection {
  return { sectionPath, anchorTextNodeId: id, anchorOffset: 0, focusTextNodeId: id, focusOffset: 0 }
}

// ---------------------------------------------------------------------------
// 작업용 표 tree와 복제 template

/**
 * 표 node를 작업용 tree로 복제한다. 원래 section tree(cache)는 계획 단계에서 바꾸지 않는다. 원래 표의 node는
 * {@link TableDraft.map}으로 같은 위치의 작업용 node를 찾는다(같은 원문을 다시 parse했으므로 구조가 같다).
 */
interface TableDraft {
  tree: SourceTree
  map: (node: SourceElement) => SourceElement
}

function draftTable(context: TableContext): TableDraft {
  const tree = parseSourceTree(serializeSourceNode(context.tree, context.table))
  const root = tree.children.find((node): node is SourceElement => node.kind === 'element')!
  const map = (node: SourceElement): SourceElement => {
    const path: number[] = []
    let current = node
    while (current !== context.table) {
      const parent = current.parent
      if (!parent) throw new Error('표 바깥 node는 작업용 tree에 없습니다.')
      path.push(parent.children.indexOf(current))
      current = parent
    }
    let mapped: SourceElement = root
    for (let index = path.length - 1; index >= 0; index -= 1) mapped = mapped.children[path[index]] as SourceElement
    return mapped
  }
  return { tree, map }
}

function insertAfter(draft: TableDraft, node: SourceElement, inserted: SourceNode): void {
  const parent = node.parent!
  spliceSourceChildren(draft.tree, parent, parent.children.indexOf(node) + 1, 0, [inserted])
}

function removeNode(tree: SourceTree, node: SourceElement): void {
  replaceSourceNode(tree, node, [])
}

/** element 원문을 어느 tree에도 붙일 수 있는 조각 node로 복제한다. */
function cloneElement(tree: SourceTree, element: SourceElement): SourceElement {
  return parseSourceFragment(serializeSourceNode(tree, element)).find(
    (node): node is SourceElement => node.kind === 'element'
  )!
}

/** 복제한 template 안의 `hp:t` 내용을 비운다(자기 닫힘·빈 `hp:t`는 그대로). */
function emptyTexts(root: SourceElement): void {
  for (const text of findDescendantSourceElements(root, 'hp:t')) {
    if (text.children.length) replaceElementChildren(DETACHED, text, [])
  }
}

/** `root` 안의 `hp:linesegarray`를 모두 지운다. */
function removeLineSegments(tree: SourceTree, root: SourceElement): void {
  for (const lines of findDescendantSourceElements(root, 'hp:linesegarray')) removeNode(tree, lines)
}

function renumberParagraphs(paragraphs: readonly SourceElement[], paragraphId: { next: number }): void {
  for (const paragraph of paragraphs) {
    if (attr(DETACHED, paragraph, 'id') !== undefined) {
      setSourceAttribute(DETACHED, paragraph, 'id', String(paragraphId.next++))
    }
  }
}

/** 선택 행을 복제한 빈 행: 셀 주소 `rowAddr`, 빈 `hp:t`, `hp:linesegarray` 제거, 새 문단 ID. */
function cloneEmptyRow(context: TableContext, newRowIndex: number): SourceElement {
  const row = cloneElement(context.tree, context.row)
  for (const address of findDescendantSourceElements(row, 'hp:cellAddr')) {
    setSourceAttribute(DETACHED, address, 'rowAddr', String(newRowIndex))
  }
  emptyTexts(row)
  removeLineSegments(DETACHED, row)
  renumberParagraphs(findDescendantSourceElements(row, 'hp:p'), nextParagraphId(context.tree, ROW_PARAGRAPH_ID_MESSAGE))
  return row
}

/** 선택 열의 셀을 복제한 빈 셀: `colAddr`, 빈 `hp:t`, `hp:linesegarray` 제거, 새 문단 ID(표 전체에서 이어 매김). */
function cloneEmptyCell(
  context: TableContext,
  source: SourceElement,
  newColumnIndex: number,
  paragraphId: { next: number }
): SourceElement {
  const cell = cloneElement(context.tree, source)
  const address = findFirstSourceElement(cell, 'hp:cellAddr')
  if (!address) throw new HwpxEditConflictError('복제할 표 셀 주소가 없습니다.')
  setSourceAttribute(DETACHED, address, 'colAddr', String(newColumnIndex))
  emptyTexts(cell)
  removeLineSegments(DETACHED, cell)
  renumberParagraphs(findDescendantSourceElements(cell, 'hp:p'), paragraphId)
  return cell
}

/** 분할로 생기는 오른쪽 빈 셀: 병합 셀을 복제해 첫 문단만 남기고 비운 뒤 열 주소·span·너비를 바꾼다. */
function cloneEmptySplitCell(context: TableContext, column: number, width: number): SourceElement {
  const cell = cloneElement(context.tree, context.cell)
  const address = findFirstSourceElement(cell, 'hp:cellAddr')
  const cellSpan = findFirstSourceElement(cell, 'hp:cellSpan')
  const cellSize = findFirstSourceElement(cell, 'hp:cellSz')
  const subList = findFirstSourceElement(cell, 'hp:subList')
  const paragraphs = subList ? children(subList, 'hp:p') : []
  if (!address || !cellSpan || !cellSize || !subList || !paragraphs.length) {
    throw new HwpxEditConflictError('분할할 표 셀의 기본 구조가 없습니다.')
  }
  const paragraphId = nextParagraphId(context.tree, STRUCTURE_PARAGRAPH_ID_MESSAGE)
  setSourceAttribute(DETACHED, address, 'colAddr', String(column))
  setSourceAttribute(DETACHED, cellSpan, 'colSpan', '1')
  setSourceAttribute(DETACHED, cellSize, 'width', String(width))
  for (const paragraph of paragraphs.slice(1)) removeNode(DETACHED, paragraph)
  const [firstParagraph] = paragraphs
  renumberParagraphs([firstParagraph], paragraphId)
  emptyTexts(firstParagraph)
  removeLineSegments(DETACHED, cell)
  return cell
}

/** 여는 tag attribute 집합의 비교 표기(이름순, 원문 값). `omitted` 이름은 뺀다. */
function tagAttributes(tree: SourceTree, element: SourceElement, omitted: readonly string[] = []): string {
  const attributes = parseTagAttributes(elementOpenTag(tree, element))
    .filter((attribute) => !omitted.includes(attribute.name))
    .map((attribute) => [attribute.name, attribute.rawValue] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(attributes)
}

function fragmentCommand(
  context: TableContext,
  sectionPath: string,
  locatorTextNodeId: string,
  draft: TableDraft,
  replacementTextNodeId?: string
): ReplaceTableFragmentCommand {
  return {
    type: 'replace-table-fragment',
    sectionPath,
    textNodeId: locatorTextNodeId,
    ...(replacementTextNodeId === undefined ? {} : { replacementTextNodeId }),
    expectedFragment: serializeSourceNode(context.tree, context.table),
    replacementFragment: serializeSourceTree(draft.tree)
  }
}

// ---------------------------------------------------------------------------
// 셀 분할·병합

export function planSplitTableCell(
  sourcePackage: HwpxSourcePackage,
  selection: TableCellSelection
): SplitTableCellPlan {
  const context = locateTable(sourcePackage, selection.sectionPath, selection.textNodeId)
  const { tree, table, row: selectedRow, cell: selectedCell } = context
  const rowCount = Number(attr(tree, table, 'rowCnt'))
  const columnCount = Number(attr(tree, table, 'colCnt'))
  const rows = children(table, 'hp:tr')
  if (
    !Number.isSafeInteger(rowCount) ||
    rowCount !== rows.length ||
    !Number.isSafeInteger(columnCount) ||
    columnCount < 2
  ) throw new HwpxEditConflictError('표 행·열 개수와 실제 구조가 일치하지 않습니다.')
  if (findFirstSourceElement(table, 'hp:tbl')) {
    throw new HwpxEditConflictError('중첩 표가 있는 셀은 아직 분할할 수 없습니다.')
  }
  const selectedRowIndex = rows.indexOf(selectedRow)
  const selectedAddress = firstChild(selectedCell, 'hp:cellAddr')
  const selectedSpan = firstChild(selectedCell, 'hp:cellSpan')
  const selectedSize = firstChild(selectedCell, 'hp:cellSz')
  const selectedSubList = firstChild(selectedCell, 'hp:subList')
  if (!selectedAddress || !selectedSpan || !selectedSize || !selectedSubList || selectedRowIndex < 0) {
    throw new HwpxEditConflictError('분할할 표 셀 구조를 찾을 수 없습니다.')
  }
  const selectedColumn = Number(attr(tree, selectedAddress, 'colAddr'))
  if (
    selection.row !== selectedRowIndex ||
    selection.column !== selectedColumn ||
    Number(attr(tree, selectedAddress, 'rowAddr')) !== selectedRowIndex
  ) throw new HwpxEditConflictError('선택한 표 셀 주소가 source와 일치하지 않습니다.')
  if (
    attr(tree, selectedCell, 'header') === '1' ||
    Number(attr(tree, selectedSpan, 'rowSpan')) !== 1 ||
    Number(attr(tree, selectedSpan, 'colSpan')) !== 2 ||
    selectedColumn < 0 ||
    selectedColumn + 1 >= columnCount
  ) throw new HwpxEditConflictError('수평 1×2 body 병합 셀만 분할할 수 있습니다.')
  if (attr(tree, selectedCell, 'id') !== undefined || attr(tree, selectedRow, 'id') !== undefined) {
    throw new HwpxEditConflictError('고유 ID가 있는 표 셀은 아직 분할할 수 없습니다.')
  }
  assertSimpleCellContent(selectedSubList, {
    noParagraph: '문단이 없는 표 셀은 분할할 수 없습니다.',
    complexElement: '복합 콘텐츠가 있는 표 셀은 아직 분할할 수 없습니다.',
    complexRun: '복합 콘텐츠가 있는 표 셀은 아직 분할할 수 없습니다.'
  })
  const evidence: Array<{ left: number; right: number }> = []
  rows.forEach((row, rowIndex) => {
    const cells = children(row, 'hp:tc')
    let nextColumn = 0
    for (const cell of cells) {
      const address = firstChild(cell, 'hp:cellAddr')
      const span = firstChild(cell, 'hp:cellSpan')
      const size = firstChild(cell, 'hp:cellSz')
      if (!address || !span || !size || attr(tree, cell, 'id') !== undefined) {
        throw new HwpxEditConflictError('불완전하거나 고유 ID가 있는 표는 아직 분할할 수 없습니다.')
      }
      const cellColumn = Number(attr(tree, address, 'colAddr'))
      const rowSpan = Number(attr(tree, span, 'rowSpan'))
      const columnSpan = Number(attr(tree, span, 'colSpan'))
      const expectedSpan = cell === selectedCell ? 2 : 1
      if (
        Number(attr(tree, address, 'rowAddr')) !== rowIndex ||
        cellColumn !== nextColumn ||
        rowSpan !== 1 ||
        columnSpan !== expectedSpan
      ) throw new HwpxEditConflictError('선택한 1×2 병합 외 span·불연속 주소가 있는 표는 분할할 수 없습니다.')
      nextColumn += columnSpan
    }
    if (nextColumn !== columnCount) throw new HwpxEditConflictError('표의 logical 열 주소가 완전하지 않습니다.')
    if (row === selectedRow) return
    const columnOf = (cell: SourceElement): number => Number(attr(tree, firstChild(cell, 'hp:cellAddr')!, 'colAddr'))
    const left = cells.find((cell) => columnOf(cell) === selectedColumn)
    const right = cells.find((cell) => columnOf(cell) === selectedColumn + 1)
    if (!left || !right) throw new HwpxEditConflictError('분할 너비를 확인할 대응 열이 없습니다.')
    evidence.push({
      left: numberAttr(tree, firstChild(left, 'hp:cellSz'), 'width'),
      right: numberAttr(tree, firstChild(right, 'hp:cellSz'), 'width')
    })
  })
  const widths = evidence[0]
  if (
    !widths ||
    !Number.isFinite(widths.left) || widths.left <= 0 ||
    !Number.isFinite(widths.right) || widths.right <= 0 ||
    evidence.some((item) => item.left !== widths.left || item.right !== widths.right)
  ) throw new HwpxEditConflictError('다른 행에서 일관된 분할 열 너비를 확인할 수 없습니다.')
  const selectedWidth = Number(attr(tree, selectedSize, 'width'))
  if (selectedWidth !== widths.left + widths.right) {
    throw new HwpxEditConflictError('병합 셀 너비와 대응 열 너비 합이 일치하지 않습니다.')
  }
  const firstText = findFirstSourceElement(selectedCell, 'hp:t')
  if (!firstText) throw new HwpxEditConflictError('분할 뒤 selection을 보존할 text가 없습니다.')
  const firstTextNodeId = textNodeId(selection.sectionPath, ordinalOf(sourcePackage, selection.sectionPath, firstText))
  const splitCell = cloneEmptySplitCell(context, selectedColumn + 1, widths.right)

  const draft = draftTable(context)
  const cell = draft.map(selectedCell)
  setSourceAttribute(draft.tree, draft.map(selectedSpan), 'colSpan', '1')
  setSourceAttribute(draft.tree, draft.map(selectedSize), 'width', String(widths.left))
  removeLineSegments(draft.tree, cell)
  insertAfter(draft, cell, splitCell)
  return {
    command: fragmentCommand(context, selection.sectionPath, selection.textNodeId, draft, firstTextNodeId),
    selectionAfter: caret(selection.sectionPath, firstTextNodeId)
  }
}

export function planMergeTableCellRight(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): MergeTableCellRightPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  assertSameCell(context, endContext, '셀 병합은 하나의 표 셀에서만 실행할 수 있습니다.')
  const { rows, columnCount, selectedRowIndex, selectedColumnIndex } = assertSimpleRectangularTable(context)
  if (selectedColumnIndex >= columnCount - 1) {
    throw new HwpxEditConflictError('오른쪽에 병합할 표 셀이 없습니다.')
  }
  const { tree } = context
  const cells = children(rows[selectedRowIndex], 'hp:tc')
  const leftCell = cells[selectedColumnIndex]
  const rightCell = cells[selectedColumnIndex + 1]
  if (
    attr(tree, leftCell, 'header') === '1' ||
    attr(tree, rightCell, 'header') === '1'
  ) throw new HwpxEditConflictError('반복 머리글 셀은 병합할 수 없습니다.')
  if (tagAttributes(tree, leftCell) !== tagAttributes(tree, rightCell)) {
    throw new HwpxEditConflictError('모양 속성이 다른 표 셀은 아직 병합할 수 없습니다.')
  }
  const leftSize = firstChild(leftCell, 'hp:cellSz')!
  const rightSize = firstChild(rightCell, 'hp:cellSz')!
  if (tagAttributes(tree, leftSize, ['width']) !== tagAttributes(tree, rightSize, ['width'])) {
    throw new HwpxEditConflictError('높이·geometry가 다른 표 셀은 아직 병합할 수 없습니다.')
  }
  const leftWidth = Number(attr(tree, leftSize, 'width'))
  const rightWidth = Number(attr(tree, rightSize, 'width'))
  if (!Number.isFinite(leftWidth) || leftWidth < 0 || !Number.isFinite(rightWidth) || rightWidth < 0) {
    throw new HwpxEditConflictError('병합할 표 셀 너비가 올바르지 않습니다.')
  }
  const leftMargin = firstChild(leftCell, 'hp:cellMargin')
  const rightMargin = firstChild(rightCell, 'hp:cellMargin')
  if (
    !leftMargin ||
    !rightMargin ||
    tagAttributes(tree, leftMargin) !== tagAttributes(tree, rightMargin)
  ) throw new HwpxEditConflictError('여백이 다른 표 셀은 아직 병합할 수 없습니다.')
  const leftSubList = firstChild(leftCell, 'hp:subList')!
  const rightSubList = firstChild(rightCell, 'hp:subList')!
  if (tagAttributes(tree, leftSubList) !== tagAttributes(tree, rightSubList)) {
    throw new HwpxEditConflictError('세로 정렬이 다른 표 셀은 아직 병합할 수 없습니다.')
  }
  const firstLeftText = findFirstSourceElement(leftCell, 'hp:t')
  if (!firstLeftText) throw new HwpxEditConflictError('병합 뒤 selection을 보존할 text가 없습니다.')
  const firstLeftTextNodeId = textNodeId(selection.sectionPath, ordinalOf(sourcePackage, selection.sectionPath, firstLeftText))
  // 오른쪽 셀 문단을 원문 표기 그대로(문단 사이 공백 text는 빼고) 옮기고 줄 배치 cache는 지운다.
  const movedParagraphs = children(rightSubList, 'hp:p').map((paragraph) => {
    const moved = cloneElement(tree, paragraph)
    removeLineSegments(DETACHED, moved)
    return moved
  })

  const draft = draftTable(context)
  const left = draft.map(leftCell)
  const leftList = draft.map(leftSubList)
  setSourceAttribute(draft.tree, draft.map(firstChild(leftCell, 'hp:cellSpan')!), 'colSpan', '2')
  setSourceAttribute(draft.tree, draft.map(leftSize), 'width', String(leftWidth + rightWidth))
  removeLineSegments(draft.tree, left)
  spliceSourceChildren(draft.tree, leftList, leftList.children.length, 0, movedParagraphs)
  removeNode(draft.tree, draft.map(rightCell))
  return {
    command: fragmentCommand(context, selection.sectionPath, normalized.start.textNodeId, draft, firstLeftTextNodeId),
    selectionAfter: caret(selection.sectionPath, firstLeftTextNodeId)
  }
}

// ---------------------------------------------------------------------------
// 열 추가·삭제

/** 선택 열의 셀 너비가 모든 행에서 같은지 확인하고 열의 셀 목록을 돌려준다. */
function uniformColumnCells(context: TableContext, table: SimpleTable, message: string): SourceElement[] {
  const cells = table.rows.map((row) => children(row, 'hp:tc')[table.selectedColumnIndex])
  for (const cell of cells) {
    if (numberAttr(context.tree, firstChild(cell, 'hp:cellSz'), 'width') !== table.selectedColumnWidth) {
      throw new HwpxEditConflictError(message)
    }
  }
  return cells
}

export function planInsertTableColumnAfter(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): InsertTableColumnPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  assertSameCell(context, endContext, '열 추가는 하나의 표 셀에서만 실행할 수 있습니다.')
  const simple = assertSimpleRectangularTable(context)
  const { rows, columnCount, selectedRowIndex, selectedColumnIndex, selectedColumnWidth } = simple
  const selectedCells = uniformColumnCells(context, simple, '행마다 너비가 다른 열은 아직 추가할 수 없습니다.')
  const insertedTextsBeforeSelection = selectedCells
    .slice(0, selectedRowIndex)
    .reduce((count, cell) => count + findDescendantSourceElements(cell, 'hp:t').length, 0)
  const paragraphId = nextParagraphId(context.tree, STRUCTURE_PARAGRAPH_ID_MESSAGE)
  const clones = selectedCells.map((cell) => cloneEmptyCell(context, cell, selectedColumnIndex + 1, paragraphId))

  const { tree } = context
  const draft = draftTable(context)
  const tableSize = firstChild(context.table, 'hp:sz')!
  setSourceAttribute(draft.tree, draft.map(context.table), 'colCnt', String(columnCount + 1))
  setSourceAttribute(
    draft.tree,
    draft.map(tableSize),
    'width',
    String(Number(attr(tree, tableSize, 'width')) + selectedColumnWidth)
  )
  rows.forEach((row, rowIndex) => {
    const cells = children(row, 'hp:tc')
    for (let columnIndex = selectedColumnIndex + 1; columnIndex < cells.length; columnIndex += 1) {
      setSourceAttribute(draft.tree, draft.map(firstChild(cells[columnIndex], 'hp:cellAddr')!), 'colAddr', String(columnIndex + 1))
    }
    insertAfter(draft, draft.map(cells[selectedColumnIndex]), clones[rowIndex])
  })
  const shift = (id: string): string => shiftTextNodeId(selection.sectionPath, id, insertedTextsBeforeSelection)
  return {
    command: fragmentCommand(context, selection.sectionPath, normalized.start.textNodeId, draft, shift(normalized.start.textNodeId)),
    selectionAfter: {
      ...selection,
      anchorTextNodeId: shift(selection.anchorTextNodeId),
      focusTextNodeId: shift(selection.focusTextNodeId)
    }
  }
}

export function planDeleteTableColumn(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): DeleteTableColumnPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  assertSameCell(context, endContext, '열 삭제는 하나의 표 셀에서만 실행할 수 있습니다.')
  const simple = assertSimpleRectangularTable(context)
  const { rows, columnCount, selectedRowIndex, selectedColumnIndex, selectedColumnWidth } = simple
  if (columnCount <= 1) {
    throw new HwpxEditConflictError('표에는 하나 이상의 열이 남아 있어야 합니다.')
  }
  const selectedCells = uniformColumnCells(context, simple, '행마다 너비가 다른 열은 아직 삭제할 수 없습니다.')
  const selectedRowCells = children(rows[selectedRowIndex], 'hp:tc')
  const targetCell = selectedRowCells[selectedColumnIndex + 1] ?? selectedRowCells[selectedColumnIndex - 1]
  const targetText = targetCell && findFirstSourceElement(targetCell, 'hp:t')
  if (!targetText) throw new HwpxEditConflictError('삭제 뒤 selection을 옮길 표 셀을 찾을 수 없습니다.')
  const { sectionPath } = selection
  const targetOriginalOrdinal = ordinalOf(sourcePackage, sectionPath, targetText)
  const deletedTextsBeforeTarget = selectedCells.reduce(
    (count, cell) => count + findDescendantSourceElements(cell, 'hp:t').filter(
      (text) => ordinalOf(sourcePackage, sectionPath, text) < targetOriginalOrdinal
    ).length,
    0
  )
  const targetTextNodeId = textNodeId(sectionPath, targetOriginalOrdinal - deletedTextsBeforeTarget)
  const { tree } = context
  const tableSize = firstChild(context.table, 'hp:sz')!
  const tableWidth = Number(attr(tree, tableSize, 'width'))
  if (tableWidth <= selectedColumnWidth) {
    throw new HwpxEditConflictError('표 전체 너비가 삭제 후 남는 열 너비보다 작습니다.')
  }

  const draft = draftTable(context)
  setSourceAttribute(draft.tree, draft.map(context.table), 'colCnt', String(columnCount - 1))
  setSourceAttribute(draft.tree, draft.map(tableSize), 'width', String(tableWidth - selectedColumnWidth))
  for (const row of rows) {
    const cells = children(row, 'hp:tc')
    for (let columnIndex = selectedColumnIndex + 1; columnIndex < cells.length; columnIndex += 1) {
      setSourceAttribute(draft.tree, draft.map(firstChild(cells[columnIndex], 'hp:cellAddr')!), 'colAddr', String(columnIndex - 1))
    }
    removeNode(draft.tree, draft.map(cells[selectedColumnIndex]))
  }
  return {
    command: fragmentCommand(context, sectionPath, normalized.start.textNodeId, draft, targetTextNodeId),
    selectionAfter: caret(sectionPath, targetTextNodeId)
  }
}

// ---------------------------------------------------------------------------
// 행 추가·삭제

/** `fromRow` 뒤 행들의 셀 주소 `rowAddr`를 `delta`만큼 옮긴다. */
function shiftRowAddresses(draft: TableDraft, rows: readonly SourceElement[], fromRow: number, delta: number): void {
  for (let index = fromRow + 1; index < rows.length; index += 1) {
    for (const cell of children(rows[index], 'hp:tc')) {
      setSourceAttribute(draft.tree, draft.map(firstChild(cell, 'hp:cellAddr')!), 'rowAddr', String(index + delta))
    }
  }
}

function setTableRows(draft: TableDraft, context: TableContext, rowCount: number, height: number): void {
  const tableSize = firstChild(context.table, 'hp:sz')!
  setSourceAttribute(draft.tree, draft.map(context.table), 'rowCnt', String(rowCount))
  setSourceAttribute(draft.tree, draft.map(tableSize), 'height', String(height))
}

function tableHeight(context: TableContext): number {
  return Number(attr(context.tree, firstChild(context.table, 'hp:sz')!, 'height'))
}

export function planInsertTableRowAfter(sourcePackage: HwpxSourcePackage, selection: EditorSelection): InsertTableRowPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  assertSameCell(context, endContext, '행 추가는 하나의 표 셀에서만 실행할 수 있습니다.')
  const { rows, selectedRowIndex, selectedRowHeight } = assertSimpleRectangularTable(context)
  const clone = cloneEmptyRow(context, selectedRowIndex + 1)

  const draft = draftTable(context)
  setTableRows(draft, context, rows.length + 1, tableHeight(context) + selectedRowHeight)
  shiftRowAddresses(draft, rows, selectedRowIndex, 1)
  insertAfter(draft, draft.map(rows[selectedRowIndex]), clone)
  return {
    command: fragmentCommand(context, selection.sectionPath, normalized.start.textNodeId, draft),
    selectionAfter: { ...selection }
  }
}

export function planDeleteTableRow(sourcePackage: HwpxSourcePackage, selection: EditorSelection): DeleteTableRowPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  assertSameCell(context, endContext, '행 삭제는 하나의 표 행에서만 실행할 수 있습니다.', false)
  const { rows, selectedRowIndex, selectedRowHeight } = assertSimpleRectangularTable(context)
  const { tree, row } = context
  const bodyRows = rows.filter((candidate) => children(candidate, 'hp:tc').every(
    (cell) => attr(tree, cell, 'header') !== '1'
  ))
  if (!bodyRows.includes(row)) {
    throw new HwpxEditConflictError('반복 머리글 행은 삭제할 수 없습니다.')
  }
  if (bodyRows.length <= 1) {
    throw new HwpxEditConflictError('표에는 하나 이상의 body 행이 남아 있어야 합니다.')
  }
  const selectedBodyIndex = bodyRows.indexOf(row)
  const targetRow = bodyRows[selectedBodyIndex + 1] ?? bodyRows[selectedBodyIndex - 1]
  const targetText = targetRow && findFirstSourceElement(targetRow, 'hp:t')
  if (!targetText) throw new HwpxEditConflictError('삭제 뒤 selection을 옮길 표 셀을 찾을 수 없습니다.')
  const { sectionPath } = selection
  const deletedTextCount = findDescendantSourceElements(row, 'hp:t').length
  const targetOriginalOrdinal = ordinalOf(sourcePackage, sectionPath, targetText)
  const targetTextNodeId = textNodeId(
    sectionPath,
    rows.indexOf(targetRow) > selectedRowIndex ? targetOriginalOrdinal - deletedTextCount : targetOriginalOrdinal
  )

  const draft = draftTable(context)
  setTableRows(draft, context, rows.length - 1, tableHeight(context) - selectedRowHeight)
  shiftRowAddresses(draft, rows, selectedRowIndex, -1)
  removeNode(draft.tree, draft.map(row))
  return {
    command: fragmentCommand(context, sectionPath, normalized.start.textNodeId, draft, targetTextNodeId),
    selectionAfter: caret(sectionPath, targetTextNodeId)
  }
}

// ---------------------------------------------------------------------------
// 적용

/**
 * `textNodeId`가 든 표의 현재 원문이 `expectedFragment`와 같으면 표 node를 `replacementFragment`를 읽은 조각 node로 바꾼다.
 * 바뀐 section tree와 cache는 새 package로 옮긴다.
 */
export function applyReplaceTableFragmentCommand(
  sourcePackage: HwpxSourcePackage,
  command: ReplaceTableFragmentCommand
): TablePatchResult {
  const context = locateTable(sourcePackage, command.sectionPath, command.textNodeId)
  if (serializeSourceNode(context.tree, context.table) !== command.expectedFragment) {
    throw new HwpxEditConflictError('표 구조가 변경되어 편집을 적용할 수 없습니다.')
  }
  if (command.expectedFragment === command.replacementFragment) {
    return { package: sourcePackage, lossReport: buildLossReport(sourcePackage, [command.sectionPath]), changed: false }
  }
  let replacement: SourceNode[]
  try {
    replacement = parseSourceFragment(command.replacementFragment)
  } catch {
    throw new HwpxEditConflictError('표 fragment가 올바른 XML이 아니어서 편집을 적용할 수 없습니다.')
  }

  // 검증을 모두 끝낸 뒤 cache를 떼어 내고 tree를 제자리에서 고친다.
  const trees = takePackageTrees(sourcePackage)
  replaceSourceNode(context.tree, context.table, replacement)
  // 행·열·셀이 바뀌어 `hp:t` 개수·순서가 달라졌다. 다음 조회가 tree에서 색인을 다시 만든다.
  invalidateHwpxTextIndex(context.tree)
  const nextPackage = withSerializedTree(sourcePackage, command.sectionPath, context.tree)
  putPackageTrees(nextPackage, trees)
  return {
    package: nextPackage,
    inverse: {
      ...command,
      textNodeId: command.replacementTextNodeId ?? command.textNodeId,
      replacementTextNodeId: command.textNodeId,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment
    },
    lossReport: buildLossReport(sourcePackage, [command.sectionPath]),
    changed: true
  }
}
