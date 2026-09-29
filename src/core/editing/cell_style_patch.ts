import { HwpxSourcePackage } from '../parser/source_package'
import { HwpxEditConflictError, HwpxLossReport, listHwpxTextAnchors, locateHwpxTextElement } from './text_patch'
import { packageEntryTree, putPackageTrees, takePackageTrees, withSerializedTree } from './package_trees'
import {
  elementOpenTag,
  findFirstSourceElement,
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  parseSourceTree,
  readTagAttribute,
  serializeSourceNode,
  serializeSourceTree,
  setElementOpenTag,
  setSourceAttribute,
  SourceElement,
  SourceTree,
  spliceSourceChildren,
  writeTagAttribute
} from './source_tree'
import { buildLossReport, findTagEnd } from './xml_scan'

/**
 * 표 셀 모양 command.
 *
 * section·header.xml을 package별 source tree cache에서 읽는다. anchor의 `hp:t`에서 부모를 따라 `hp:p` → `hp:subList` →
 * `hp:tc`를 찾고, `borderFillIDRef`는 따옴표를 인식하는 tree attribute API로 바꾼다. 새 `hh:borderFill`은 원본을 조각
 * tree로 복제해 고친 뒤 header tree의 `hh:borderFills` 끝에 붙이고 `itemCnt`를 갱신한다. inverse는 바꾼 tag·조각 원문을
 * 들고 있어 byte 단위로 되돌린다.
 */

export type CellBorderType = 'NONE' | 'SOLID'

export interface ApplyCellStyleCommand {
  type: 'apply-cell-style'
  sectionPath: string
  textNodeId: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderType?: CellBorderType
}

interface BorderFillHeaderMutation {
  headerPath: string
  expectedCollectionOpenTag: string
  replacementCollectionOpenTag: string
  fragment: string
  action: 'insert' | 'remove'
}

export interface RestoreCellStyleCommand {
  type: 'restore-cell-style'
  sectionPath: string
  textNodeId: string
  expectedCellOpenTag: string
  replacementCellOpenTag: string
  headerMutation?: BorderFillHeaderMutation
}

export interface CellStylePatchResult {
  package: HwpxSourcePackage
  inverse?: RestoreCellStyleCommand
  lossReport: HwpxLossReport
  changed: boolean
}

const HEADER_PATH = 'Contents/header.xml'

interface CellContext {
  tree: SourceTree
  cell: SourceElement
  cellOpenTag: string
  borderFillId: string
}

function safeCellContext(sourcePackage: HwpxSourcePackage, sectionPath: string, textNodeId: string): CellContext {
  // 목록 조회는 section 경로 검증과 오류 message를 전환 전과 같게 유지한다(cache된 tree를 쓰므로 다시 parse하지 않는다).
  listHwpxTextAnchors(sourcePackage, sectionPath)
  const located = locateHwpxTextElement(sourcePackage, sectionPath, textNodeId)
  if (!located) throw new HwpxEditConflictError(`표 셀 anchor를 찾을 수 없습니다: ${textNodeId}`)
  const { tree, element: textNode } = located
  const paragraph = nearestSourceAncestor(textNode, 'hp:p')
  const subList = paragraph && nearestSourceAncestor(paragraph, 'hp:subList')
  const cell = subList && nearestSourceAncestor(subList, 'hp:tc')
  if (!paragraph || !subList || !cell || subList.parent !== cell) {
    throw new HwpxEditConflictError('표 셀 모양은 일반 body 셀에서만 편집할 수 있습니다.')
  }
  const span = cell.children.find(
    (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:cellSpan'
  )
  const spanAttribute = (name: string): string | undefined => (span ? getSourceAttribute(tree, span, name) : undefined)
  if (
    getSourceAttribute(tree, cell, 'header') === '1' ||
    Number(spanAttribute('rowSpan') ?? '1') !== 1 ||
    Number(spanAttribute('colSpan') ?? '1') !== 1
  ) {
    throw new HwpxEditConflictError('머리글 또는 병합된 표 셀의 모양은 아직 편집할 수 없습니다.')
  }
  const borderFillId = getSourceAttribute(tree, cell, 'borderFillIDRef')
  if (!borderFillId) throw new HwpxEditConflictError('표 셀 borderFill 참조가 없습니다.')
  return { tree, cell, cellOpenTag: elementOpenTag(tree, cell), borderFillId }
}

function validateColor(value: string | undefined, label: string): void {
  if (value !== undefined && !/^#[0-9A-F]{6}$/i.test(value)) {
    throw new HwpxEditConflictError(`${label}은 #RRGGBB 형식이어야 합니다.`)
  }
}

/** 복제한 borderFill 조각 tree의 채우기·사방 테두리 attribute를 바꾼다. */
function mutateBorderFill(draft: SourceTree, definition: SourceElement, command: ApplyCellStyleCommand): void {
  const fill = findFirstSourceElement(definition, 'hc:winBrush')
  if (command.backgroundColor !== undefined) {
    if (!fill) throw new HwpxEditConflictError('기존 단색 채우기가 없는 셀은 아직 배경색을 바꿀 수 없습니다.')
    setSourceAttribute(draft, fill, 'faceColor', command.backgroundColor.toUpperCase())
  }
  const bordersChanged =
    command.borderColor !== undefined || command.borderWidth !== undefined || command.borderType !== undefined
  for (const name of ['hh:leftBorder', 'hh:rightBorder', 'hh:topBorder', 'hh:bottomBorder']) {
    const border = findFirstSourceElement(definition, name)
    if (!border && bordersChanged) {
      throw new HwpxEditConflictError('사방 테두리 정의가 완전하지 않은 셀은 아직 편집할 수 없습니다.')
    }
    if (!border) continue
    if (command.borderColor !== undefined) setSourceAttribute(draft, border, 'color', command.borderColor.toUpperCase())
    if (command.borderWidth !== undefined) setSourceAttribute(draft, border, 'width', String(command.borderWidth))
    if (command.borderType !== undefined) setSourceAttribute(draft, border, 'type', command.borderType)
  }
}

/** borderFill 비교용 표기: 여는 tag의 `id`만 자리표시자로 바꾼다. */
function comparable(fragment: string): string {
  const openEnd = findTagEnd(fragment, 0)
  return writeTagAttribute(fragment.slice(0, openEnd), 'id', '__ID__') + fragment.slice(openEnd)
}

/** header tree의 borderFill element별 비교 표기 cache(definition element는 제자리에서 바뀌지 않는다). */
const comparables = new WeakMap<SourceElement, string>()

function storedComparable(tree: SourceTree, element: SourceElement): string {
  let value = comparables.get(element)
  if (value === undefined) {
    value = comparable(serializeSourceNode(tree, element))
    comparables.set(element, value)
  }
  return value
}

function borderFillCollection(headerTree: SourceTree): SourceElement | undefined {
  return findSourceElements(headerTree, 'hh:borderFills')[0]
}

function commitCellTrees(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  sectionTree: SourceTree,
  headerTree: SourceTree | undefined,
  mutate: () => void
): { package: HwpxSourcePackage; modified: string[] } {
  const trees = takePackageTrees(sourcePackage)
  mutate()
  let currentPackage = sourcePackage
  const modified: string[] = []
  if (headerTree) {
    currentPackage = withSerializedTree(currentPackage, HEADER_PATH, headerTree)
    modified.push(HEADER_PATH)
  }
  currentPackage = withSerializedTree(currentPackage, sectionPath, sectionTree)
  modified.push(sectionPath)
  putPackageTrees(currentPackage, trees)
  return { package: currentPackage, modified }
}

export function applyCellStyleCommand(sourcePackage: HwpxSourcePackage, command: ApplyCellStyleCommand): CellStylePatchResult {
  validateColor(command.backgroundColor, '셀 배경색')
  validateColor(command.borderColor, '셀 테두리색')
  if (command.borderWidth !== undefined && (!Number.isFinite(command.borderWidth) || command.borderWidth < 0.1 || command.borderWidth > 5)) {
    throw new HwpxEditConflictError('셀 테두리 두께는 0.1mm 이상 5mm 이하여야 합니다.')
  }
  if (command.backgroundColor === undefined && command.borderColor === undefined && command.borderWidth === undefined && command.borderType === undefined) {
    throw new HwpxEditConflictError('변경할 표 셀 모양이 없습니다.')
  }
  const context = safeCellContext(sourcePackage, command.sectionPath, command.textNodeId)
  const headerTree = packageEntryTree(sourcePackage, HEADER_PATH)
  const collection = borderFillCollection(headerTree)
  const definitions = collection
    ? collection.children.filter(
        (child): child is SourceElement => child.kind === 'element' && child.name === 'hh:borderFill'
      )
    : []
  const sourceDefinition = definitions.find(
    (definition) => getSourceAttribute(headerTree, definition, 'id') === context.borderFillId
  )
  if (!collection || !sourceDefinition) throw new HwpxEditConflictError('참조된 borderFill 정의를 찾을 수 없습니다.')
  const originalFragment = serializeSourceNode(headerTree, sourceDefinition)
  const draft = parseSourceTree(originalFragment)
  const draftDefinition = draft.children[0] as SourceElement
  mutateBorderFill(draft, draftDefinition, command)
  const desiredWithoutId = serializeSourceTree(draft)
  if (desiredWithoutId === originalFragment) {
    return { package: sourcePackage, lossReport: buildLossReport(sourcePackage, []), changed: false }
  }
  const desiredComparable = comparable(desiredWithoutId)
  const reused = definitions.find((definition) => storedComparable(headerTree, definition) === desiredComparable)
  const maxId = definitions.reduce(
    (max, definition) => Math.max(max, Number(getSourceAttribute(headerTree, definition, 'id')) || 0),
    0
  )
  const nextId = reused ? getSourceAttribute(headerTree, reused, 'id')! : String(maxId + 1)
  setSourceAttribute(draft, draftDefinition, 'id', nextId)
  const desiredFragment = serializeSourceTree(draft)
  const replacementCellOpenTag = writeTagAttribute(context.cellOpenTag, 'borderFillIDRef', nextId)
  let headerMutation: BorderFillHeaderMutation | undefined
  let headerChange: (() => void) | undefined
  if (!reused) {
    const collectionOpenTag = elementOpenTag(headerTree, collection)
    const count = Number(readTagAttribute(collectionOpenTag, 'itemCnt') ?? definitions.length)
    if (!Number.isSafeInteger(count) || count < definitions.length) {
      throw new HwpxEditConflictError('borderFill collection 개수가 올바르지 않습니다.')
    }
    const replacementCollectionOpenTag = writeTagAttribute(collectionOpenTag, 'itemCnt', String(count + 1))
    const nodes = parseSourceFragment(desiredFragment)
    headerChange = () => {
      setElementOpenTag(headerTree, collection, replacementCollectionOpenTag)
      spliceSourceChildren(headerTree, collection, collection.children.length, 0, nodes)
    }
    headerMutation = { headerPath: HEADER_PATH, expectedCollectionOpenTag: replacementCollectionOpenTag, replacementCollectionOpenTag: collectionOpenTag, fragment: desiredFragment, action: 'remove' }
  }
  const committed = commitCellTrees(sourcePackage, command.sectionPath, context.tree, headerChange ? headerTree : undefined, () => {
    headerChange?.()
    setElementOpenTag(context.tree, context.cell, replacementCellOpenTag)
  })
  return {
    package: committed.package,
    inverse: {
      type: 'restore-cell-style',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedCellOpenTag: replacementCellOpenTag,
      replacementCellOpenTag: context.cellOpenTag,
      headerMutation
    },
    lossReport: buildLossReport(sourcePackage, committed.modified),
    changed: true
  }
}

export function applyRestoreCellStyleCommand(sourcePackage: HwpxSourcePackage, command: RestoreCellStyleCommand): CellStylePatchResult {
  const context = safeCellContext(sourcePackage, command.sectionPath, command.textNodeId)
  if (context.cellOpenTag !== command.expectedCellOpenTag) throw new HwpxEditConflictError('표 셀 모양 reference가 변경되어 undo/redo할 수 없습니다.')
  let headerTree: SourceTree | undefined
  let headerChange: (() => void) | undefined
  if (command.headerMutation) {
    const mutation = command.headerMutation
    const tree = packageEntryTree(sourcePackage, mutation.headerPath)
    const collection = borderFillCollection(tree)
    if (!collection || elementOpenTag(tree, collection) !== mutation.expectedCollectionOpenTag) {
      throw new HwpxEditConflictError('borderFill collection이 변경되어 undo/redo할 수 없습니다.')
    }
    if (mutation.action === 'remove') {
      const added = collection.children.find((child) => serializeSourceNode(tree, child) === mutation.fragment)
      if (!added) throw new HwpxEditConflictError('추가한 borderFill을 찾을 수 없습니다.')
      headerChange = () => {
        setElementOpenTag(tree, collection, mutation.replacementCollectionOpenTag)
        spliceSourceChildren(tree, collection, collection.children.indexOf(added), 1, [])
      }
    } else {
      const nodes = parseSourceFragment(mutation.fragment)
      headerChange = () => {
        setElementOpenTag(tree, collection, mutation.replacementCollectionOpenTag)
        spliceSourceChildren(tree, collection, collection.children.length, 0, nodes)
      }
    }
    headerTree = tree
  }
  const committed = commitCellTrees(sourcePackage, command.sectionPath, context.tree, headerTree, () => {
    headerChange?.()
    setElementOpenTag(context.tree, context.cell, command.replacementCellOpenTag)
  })
  return {
    package: committed.package,
    inverse: {
      type: 'restore-cell-style',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedCellOpenTag: command.replacementCellOpenTag,
      replacementCellOpenTag: command.expectedCellOpenTag,
      headerMutation: command.headerMutation ? {
        ...command.headerMutation,
        expectedCollectionOpenTag: command.headerMutation.replacementCollectionOpenTag,
        replacementCollectionOpenTag: command.headerMutation.expectedCollectionOpenTag,
        action: command.headerMutation.action === 'remove' ? 'insert' : 'remove'
      } : undefined
    },
    lossReport: buildLossReport(sourcePackage, committed.modified),
    changed: true
  }
}
