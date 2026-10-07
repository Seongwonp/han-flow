import { HwpxSourcePackage } from '../parser/source_package'
import { EditorSelection, normalizeEditorSelection } from './selection'
import { EditingOperationError } from './editing_error'
import {
  encodeHwpxTextContent,
  HwpxEditConflictError,
  HwpxLossReport,
  hwpxTextElementSource,
  hwpxTextOrdinal,
  invalidateHwpxTextIndex,
  listHwpxTextAnchors,
  locateHwpxTextElement,
  splitHwpxTextContent
} from './text_patch'
import { buildLossReport } from './xml_scan'
import { ParagraphStructureAccess, paragraphStructureViolation } from './paragraph_structure'
import { putPackageTrees, takePackageTrees, withSerializedTree } from './package_trees'
import {
  elementCloseTag,
  elementOpenTag,
  findDescendantSourceElements,
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  readTagAttribute,
  serializeSourceNode,
  SourceElement,
  SourceNode,
  SourceTree,
  spliceSourceChildren,
  textRaw,
  writeTagAttribute
} from './source_tree'

/**
 * 문단 구조 command: 문단 분할(Enter), 경계 병합(문단 맨 앞 Backspace·맨 끝 Delete), 여러 문단 범위 치환.
 *
 * section source tree(`package_trees.ts` cache)에서 `hp:p`·`hp:run`·`hp:t` node를 찾아 교체 fragment를 만든다. 손대지 않는
 * run과 문단은 node의 현재 원문 표기를 그대로 쓰고, 분할·치환 경계의 `hp:t`는 {@link splitHwpxTextContent}로 원문 표기를
 * 잘라 남긴다. 따라서 지우지 않은 부분의 inline `hp:tab`(attribute 포함)·`hp:lineBreak`·entity 표기·원문 CR/LF는 byte
 * 그대로다. 새로 넣는 text만 기본 escape(`\t` → `&#9;`, `\n` → `<hp:lineBreak/>`)로 쓴다.
 *
 * command·inverse는 전과 같은 `replace-paragraph-fragment`(원문 fragment 교체)다. inverse가 바뀌기 전 fragment bytes를
 * 그대로 들고 있어 실행 취소는 언제나 원래 bytes를 복원한다. 적용은 tree에서 fragment에 해당하는 형제 node를 떼고
 * 교체 fragment를 조각 tree로 붙인 뒤 cache를 새 package로 옮긴다.
 *
 * `hp:linesegarray` 정책(전환 전과 같음): 분할·병합·범위 치환으로 새로 만든 문단에는 `hp:linesegarray`를 쓰지 않는다
 * (줄 배치 cache 무효화 — 한/글이 열 때 다시 계산한다). 영향받지 않은 문단의 `hp:linesegarray`는 그대로 두고, 실행 취소는
 * 원래 fragment와 함께 되살린다. 새로 만든 문단은 `hp:run`만 이어 쓰므로 문단 자식 사이·run 안 `hp:t` 앞뒤의 공백
 * text도 쓰지 않는다.
 */

export interface ReplaceParagraphFragmentCommand {
  type: 'replace-paragraph-fragment'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
}

export interface SplitParagraphPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
}

export type MergeParagraphDirection = 'previous' | 'next'

export interface MergeParagraphPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
}

export interface ReplaceParagraphSelectionPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
  affectedTextNodeIds: readonly string[]
}

export interface ParagraphPatchResult {
  package: HwpxSourcePackage
  inverse: ReplaceParagraphFragmentCommand
  lossReport: HwpxLossReport
  changed: true
}

interface ParagraphContext {
  tree: SourceTree
  textNode: SourceElement
  run: SourceElement
  paragraph: SourceElement
  scope: SourceElement
}

function locateParagraph(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string
): ParagraphContext {
  // section 경로 검사·오류 message를 전과 같게 하려고 anchor 목록을 먼저 조회한다(package별 cache).
  listHwpxTextAnchors(sourcePackage, sectionPath)
  const located = locateHwpxTextElement(sourcePackage, sectionPath, textNodeId)
  if (!located) throw new HwpxEditConflictError(`문단 anchor를 찾을 수 없습니다: ${textNodeId}`)
  const { tree, element: textNode } = located
  const run = nearestSourceAncestor(textNode, 'hp:run')
  const paragraph = nearestSourceAncestor(textNode, 'hp:p')
  if (!run || !paragraph || run.parent !== paragraph || !paragraph.parent) {
    throw new HwpxEditConflictError('지원하는 일반 텍스트 문단 구조를 찾을 수 없습니다.')
  }
  const scope = paragraph.parent
  if (scope.name === 'hp:subList') {
    const cell = nearestSourceAncestor(paragraph, 'hp:tc')
    const cellSpan = cell?.children.find(
      (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:cellSpan'
    )
    if (
      !cell ||
      scope.parent !== cell ||
      getSourceAttribute(tree, cell, 'header') === '1' ||
      Number((cellSpan && getSourceAttribute(tree, cellSpan, 'rowSpan')) ?? '1') !== 1 ||
      Number((cellSpan && getSourceAttribute(tree, cellSpan, 'colSpan')) ?? '1') !== 1
    ) {
      throw new HwpxEditConflictError('병합되지 않은 일반 표 body cell 문단만 구조를 편집할 수 있습니다.')
    }
  } else if (scope.name !== 'hs:sec') {
    throw new HwpxEditConflictError('최상위 문단 또는 일반 표 body cell 문단만 구조를 편집할 수 있습니다.')
  }
  return { tree, textNode, run, paragraph, scope }
}

/** element가 아닌 형제(text·comment·CDATA·PI)가 공백 text뿐이면 true. */
function isBlankNode(tree: SourceTree, node: SourceNode): boolean {
  return node.kind === 'text' && !textRaw(tree, node).trim()
}

/** 편집 source tree용 {@link ParagraphStructureAccess}. */
export function sourceParagraphStructureAccess(tree: SourceTree): ParagraphStructureAccess<SourceNode> {
  return {
    elementName: (node) => node.kind === 'element' ? node.name : undefined,
    children: (node) => node.kind === 'element' ? node.children : [],
    isBlank: (node) => isBlankNode(tree, node)
  }
}

/**
 * 문단이 `hp:run`(+ `hp:linesegarray`)만으로 되어 있고 각 run이 `hp:t` 하나(와 앞뒤 공백)만 가지는지 확인하고
 * run 목록을 돌려준다. 규칙은 capability와 함께 쓰는 {@link paragraphStructureViolation}이고, 오류 message는 전환 전과 같다.
 */
function assertSimpleParagraph(context: ParagraphContext): SourceElement[] {
  const { tree, paragraph } = context
  const violation = paragraphStructureViolation<SourceNode>(paragraph, sourceParagraphStructureAccess(tree))
  if (violation) throw new HwpxEditConflictError(violation.message)
  return paragraph.children.filter(
    (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:run'
  )
}

function nextParagraphOpenTag(tree: SourceTree, paragraph: SourceElement): string {
  let openTag = elementOpenTag(tree, paragraph)
  for (const name of ['pageBreak', 'columnBreak']) {
    if (readTagAttribute(openTag, name) !== undefined) openTag = writeTagAttribute(openTag, name, '0')
  }
  const id = readTagAttribute(openTag, 'id')
  if (id === undefined) return openTag
  if (!/^\d+$/.test(id)) throw new HwpxEditConflictError('숫자가 아닌 문단 ID는 아직 나누지 않습니다.')
  const ids = findSourceElements(tree, 'hp:p')
    .map((candidate) => getSourceAttribute(tree, candidate, 'id'))
    .filter((candidate): candidate is string => candidate !== undefined)
  if (ids.some((candidate) => !/^\d+$/.test(candidate))) {
    throw new HwpxEditConflictError('숫자가 아닌 문단 ID가 있는 section은 아직 나누지 않습니다.')
  }
  const numericIds = ids.map(Number)
  if (numericIds.some((candidate) => !Number.isSafeInteger(candidate))) {
    throw new HwpxEditConflictError('문단 ID가 안전한 정수 범위를 벗어났습니다.')
  }
  const nextId = numericIds.reduce((maximum, candidate) => Math.max(maximum, candidate), -1) + 1
  return writeTagAttribute(openTag, 'id', String(nextId))
}

/** run 여는·닫는 tag 원문 사이에 `hp:t`를 주어진 원문 내용으로 다시 쓴 run(run 안 공백 text는 쓰지 않는다). */
function changedTextRun(context: ParagraphContext, content: string): string {
  const { tree, run, textNode } = context
  return elementOpenTag(tree, run) + hwpxTextElementSource(tree, textNode, content) + elementCloseTag(tree, run)
}

/** 문단 안의 `hp:t`(깊이 무관, 문서 순서). */
function paragraphTextNodes(context: ParagraphContext): SourceElement[] {
  return findDescendantSourceElements(context.paragraph, 'hp:t')
}

function textNodeIdFor(sourcePackage: HwpxSourcePackage, sectionPath: string, element: SourceElement): string {
  const ordinal = hwpxTextOrdinal(sourcePackage, sectionPath, element)
  if (ordinal < 0) throw new HwpxEditConflictError('문단 text ordinal을 찾을 수 없습니다.')
  return `${sectionPath}#hp:t:${ordinal}`
}

/** 같은 부모의 `hp:p` 형제 목록. */
function scopedParagraphs(scope: SourceElement): SourceElement[] {
  return scope.children.filter(
    (child): child is SourceElement => child.kind === 'element' && child.name === 'hp:p'
  )
}

/** 같은 부모 안 `first`부터 `last`까지(양 끝 포함) 형제 node. */
function siblingRange(first: SourceElement, last: SourceElement): SourceNode[] {
  const siblings = first.parent!.children
  return siblings.slice(siblings.indexOf(first), siblings.indexOf(last) + 1)
}

/**
 * 문서 순서로 `first` 끝과 `second` 시작 사이의 원문 표기. 같은 부모의 형제가 아니면(한쪽이 다른 문단의 표 cell 안 문단 등)
 * 그 사이에 조상 element의 tag가 반드시 있으므로 비어 있지 않은 표시 문자열을 돌려준다(전환 전 문자열 slice와 같은 판정).
 */
function betweenSource(tree: SourceTree, first: SourceElement, second: SourceElement): string {
  if (!first.parent || first.parent !== second.parent) return '<nested>'
  return siblingRange(first, second)
    .slice(1, -1)
    .map((node) => serializeSourceNode(tree, node))
    .join('')
}

function nodesSource(tree: SourceTree, nodes: readonly SourceNode[]): string {
  return nodes.map((node) => serializeSourceNode(tree, node)).join('')
}

/** 문서 순서(여는 tag 위치)로 `left`가 `right`보다 뒤이면 양수. 조상은 자손보다 앞이다. */
function compareDocumentOrder(left: SourceElement, right: SourceElement): number {
  const path = (node: SourceElement): number[] => {
    const indexes: number[] = []
    for (let current: SourceElement | undefined = node; current?.parent; current = current.parent) {
      indexes.unshift(current.parent.children.indexOf(current))
    }
    return indexes
  }
  const leftPath = path(left)
  const rightPath = path(right)
  for (let index = 0; index < Math.min(leftPath.length, rightPath.length); index += 1) {
    if (leftPath[index] !== rightPath[index]) return leftPath[index] - rightPath[index]
  }
  return leftPath.length - rightPath.length
}

export function planSplitParagraph(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): SplitParagraphPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (normalized.start.textNodeId !== normalized.end.textNodeId) {
    throw new HwpxEditConflictError('여러 run에 걸친 선택은 아직 문단 나눔을 지원하지 않습니다.')
  }
  const context = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const runs = assertSimpleParagraph(context)
  const anchor = listHwpxTextAnchors(sourcePackage, selection.sectionPath).find(
    (candidate) => candidate.textNodeId === normalized.start.textNodeId
  )!
  const targetIndex = runs.indexOf(context.run)
  if (targetIndex < 0) throw new HwpxEditConflictError('문단의 대상 run을 찾을 수 없습니다.')

  const { tree, paragraph } = context
  const beforeRuns = nodesSource(tree, runs.slice(0, targetIndex))
  const afterRuns = nodesSource(tree, runs.slice(targetIndex + 1))
  // 선택 범위 [start, end)를 지우고 앞·뒤 원문 조각을 두 run에 나눠 담는다.
  const left = splitHwpxTextContent(tree, context.textNode, normalized.start.offset).before
  const right = splitHwpxTextContent(tree, context.textNode, normalized.end.offset).after
  const leftRun = changedTextRun(context, left)
  const rightRun = changedTextRun(context, right)
  const paragraphClose = elementCloseTag(tree, paragraph)
  const firstParagraph = elementOpenTag(tree, paragraph) + beforeRuns + leftRun + paragraphClose
  const secondParagraph = nextParagraphOpenTag(tree, paragraph) + rightRun + afterRuns + paragraphClose
  const rightTextNodeId = `${selection.sectionPath}#hp:t:${anchor.ordinal + 1}`
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: normalized.start.textNodeId,
      expectedFragment: serializeSourceNode(tree, paragraph),
      replacementFragment: firstParagraph + secondParagraph
    },
    selectionAfter: {
      sectionPath: selection.sectionPath,
      anchorTextNodeId: rightTextNodeId,
      anchorOffset: 0,
      focusTextNodeId: rightTextNodeId,
      focusOffset: 0
    }
  }
}

export function planMergeParagraph(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection,
  direction: MergeParagraphDirection
): MergeParagraphPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (
    normalized.start.textNodeId !== normalized.end.textNodeId ||
    normalized.start.offset !== normalized.end.offset
  ) {
    throw new HwpxEditConflictError('문단 병합은 접힌 caret에서만 지원합니다.')
  }
  const current = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  assertSimpleParagraph(current)
  const currentTexts = paragraphTextNodes(current)
  const currentAnchor = listHwpxTextAnchors(sourcePackage, selection.sectionPath).find(
    (candidate) => candidate.textNodeId === normalized.start.textNodeId
  )!
  if (direction === 'previous' && (currentTexts[0] !== current.textNode || normalized.start.offset !== 0)) {
    throw new HwpxEditConflictError('이전 문단 병합은 문단 맨 앞에서만 지원합니다.')
  }
  if (
    direction === 'next' &&
    (currentTexts[currentTexts.length - 1] !== current.textNode ||
      normalized.start.offset !== currentAnchor.text.length)
  ) {
    throw new HwpxEditConflictError('다음 문단 병합은 문단 맨 끝에서만 지원합니다.')
  }

  const paragraphs = scopedParagraphs(current.scope)
  const currentIndex = paragraphs.indexOf(current.paragraph)
  const neighborParagraph = paragraphs[currentIndex + (direction === 'previous' ? -1 : 1)]
  if (currentIndex < 0 || !neighborParagraph) {
    throw new EditingOperationError('EDITING_NOT_APPLICABLE', '병합할 인접 문단이 없습니다.')
  }
  const neighborText = findDescendantSourceElements(neighborParagraph, 'hp:t')[0]
  if (!neighborText) throw new HwpxEditConflictError('인접 문단에 text anchor가 없습니다.')
  const neighbor = locateParagraph(
    sourcePackage,
    selection.sectionPath,
    textNodeIdFor(sourcePackage, selection.sectionPath, neighborText)
  )
  assertSimpleParagraph(neighbor)

  const first = direction === 'previous' ? neighbor : current
  const second = direction === 'previous' ? current : neighbor
  const { tree } = current
  if (betweenSource(tree, first.paragraph, second.paragraph).trim()) {
    throw new HwpxEditConflictError('두 문단 사이에 보존해야 할 콘텐츠가 있어 병합할 수 없습니다.')
  }
  const firstRuns = assertSimpleParagraph(first)
  const secondRuns = assertSimpleParagraph(second)
  // run은 원문 표기 그대로 이어 붙인다(경계 `hp:t`의 inline `hp:tab`·entity 표기도 그대로).
  const mergedFragment =
    elementOpenTag(tree, first.paragraph) +
    nodesSource(tree, firstRuns) +
    nodesSource(tree, secondRuns) +
    elementCloseTag(tree, first.paragraph)
  const locatorTextNodeId = textNodeIdFor(sourcePackage, selection.sectionPath, paragraphTextNodes(first)[0])
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: locatorTextNodeId,
      expectedFragment: nodesSource(tree, siblingRange(first.paragraph, second.paragraph)),
      replacementFragment: mergedFragment
    },
    selectionAfter: { ...selection }
  }
}

export function selectionSpansParagraphs(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): boolean {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (normalized.start.textNodeId === normalized.end.textNodeId) return false
  const start = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const end = locateParagraph(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  return start.paragraph !== end.paragraph
}

export function planReplaceParagraphSelection(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection,
  insert: string
): ReplaceParagraphSelectionPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const start = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const end = locateParagraph(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  if (start.paragraph === end.paragraph) {
    throw new HwpxEditConflictError('같은 문단 선택은 text range command를 사용해야 합니다.')
  }
  if (compareDocumentOrder(start.paragraph, end.paragraph) > 0) {
    throw new HwpxEditConflictError('정규화된 문단 선택 순서가 올바르지 않습니다.')
  }
  if (start.scope !== end.scope) {
    throw new HwpxEditConflictError('서로 다른 문단 구조나 표 cell을 가로질러 편집할 수 없습니다.')
  }
  const paragraphs = scopedParagraphs(start.scope)
  const startParagraphIndex = paragraphs.indexOf(start.paragraph)
  const endParagraphIndex = paragraphs.indexOf(end.paragraph)
  if (startParagraphIndex < 0 || endParagraphIndex <= startParagraphIndex) {
    throw new HwpxEditConflictError('여러 문단 selection 범위를 찾을 수 없습니다.')
  }
  const contexts = paragraphs.slice(startParagraphIndex, endParagraphIndex + 1).map((paragraph) => {
    const text = findDescendantSourceElements(paragraph, 'hp:t')[0]
    if (!text) throw new HwpxEditConflictError('selection 문단에 text anchor가 없습니다.')
    const context = locateParagraph(
      sourcePackage,
      selection.sectionPath,
      textNodeIdFor(sourcePackage, selection.sectionPath, text)
    )
    assertSimpleParagraph(context)
    return context
  })
  const { tree } = start
  for (let index = 1; index < contexts.length; index += 1) {
    if (betweenSource(tree, contexts[index - 1].paragraph, contexts[index].paragraph).trim()) {
      throw new HwpxEditConflictError('선택 문단 사이에 보존해야 할 콘텐츠가 있습니다.')
    }
  }

  const startRuns = assertSimpleParagraph(start)
  const endRuns = assertSimpleParagraph(end)
  const startRunIndex = startRuns.indexOf(start.run)
  const endRunIndex = endRuns.indexOf(end.run)
  if (startRunIndex < 0 || endRunIndex < 0) {
    throw new HwpxEditConflictError('selection 경계 run을 찾을 수 없습니다.')
  }
  const anchors = listHwpxTextAnchors(sourcePackage, selection.sectionPath)
  const startAnchorIndex = anchors.findIndex((anchor) => anchor.textNodeId === normalized.start.textNodeId)
  const endAnchorIndex = anchors.findIndex((anchor) => anchor.textNodeId === normalized.end.textNodeId)
  const startAnchor = anchors[startAnchorIndex]
  const endAnchor = anchors[endAnchorIndex]
  if (!startAnchor || !endAnchor) throw new HwpxEditConflictError('selection text anchor를 찾을 수 없습니다.')

  // 시작 hp:t는 [0, start) 원문 조각 + 새 text, 끝 hp:t는 [end, …) 원문 조각만 남긴다.
  const changedStartRun = changedTextRun(
    start,
    splitHwpxTextContent(tree, start.textNode, normalized.start.offset).before + encodeHwpxTextContent(insert)
  )
  const changedEndRun = changedTextRun(end, splitHwpxTextContent(tree, end.textNode, normalized.end.offset).after)
  const replacementFragment =
    elementOpenTag(tree, start.paragraph) +
    nodesSource(tree, startRuns.slice(0, startRunIndex)) +
    changedStartRun +
    changedEndRun +
    nodesSource(tree, endRuns.slice(endRunIndex + 1)) +
    elementCloseTag(tree, start.paragraph)
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: normalized.start.textNodeId,
      expectedFragment: nodesSource(tree, siblingRange(start.paragraph, end.paragraph)),
      replacementFragment
    },
    selectionAfter: {
      sectionPath: selection.sectionPath,
      anchorTextNodeId: normalized.start.textNodeId,
      anchorOffset: normalized.start.offset + insert.length,
      focusTextNodeId: normalized.start.textNodeId,
      focusOffset: normalized.start.offset + insert.length
    },
    affectedTextNodeIds: anchors
      .slice(startAnchorIndex, endAnchorIndex + 1)
      .map((anchor) => anchor.textNodeId)
  }
}

/**
 * `textNodeId`가 든 문단부터 이어지는 형제 node의 원문이 `expectedFragment`와 node 경계에서 정확히 같으면 그 node들을
 * `replacementFragment`를 읽은 조각 node로 바꾼다. 바뀐 section tree와 cache는 새 package로 옮긴다.
 */
export function applyReplaceParagraphFragmentCommand(
  sourcePackage: HwpxSourcePackage,
  command: ReplaceParagraphFragmentCommand
): ParagraphPatchResult {
  if (command.type !== 'replace-paragraph-fragment') throw new Error('지원하지 않는 문단 command입니다.')
  const context = locateParagraph(sourcePackage, command.sectionPath, command.textNodeId)
  const { tree, paragraph } = context
  const parent = paragraph.parent!
  const startIndex = parent.children.indexOf(paragraph)
  let actual = ''
  let endIndex = startIndex
  while (actual.length < command.expectedFragment.length && endIndex < parent.children.length) {
    actual += serializeSourceNode(tree, parent.children[endIndex])
    endIndex += 1
  }
  if (actual !== command.expectedFragment) {
    throw new HwpxEditConflictError('문단 fragment가 변경되어 command를 적용할 수 없습니다.')
  }
  let replacement: SourceNode[]
  try {
    replacement = parseSourceFragment(command.replacementFragment)
  } catch {
    throw new HwpxEditConflictError('문단 fragment가 올바른 XML이 아니어서 command를 적용할 수 없습니다.')
  }

  // 검증을 모두 끝낸 뒤 cache를 떼어 내고 tree를 제자리에서 고친다.
  const trees = takePackageTrees(sourcePackage)
  spliceSourceChildren(tree, parent, startIndex, endIndex - startIndex, replacement)
  // 문단 구조가 바뀌어 `hp:t` 개수·순서가 달라졌다. 다음 조회가 tree에서 색인을 다시 만든다.
  invalidateHwpxTextIndex(tree)
  const nextPackage = withSerializedTree(sourcePackage, command.sectionPath, tree)
  putPackageTrees(nextPackage, trees)
  return {
    package: nextPackage,
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment
    },
    lossReport: buildLossReport(sourcePackage, [command.sectionPath]),
    changed: true
  }
}
