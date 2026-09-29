import { HwpxSourcePackage } from '../parser/source_package'
import {
  assertXmlCharacters,
  collapseElementToSelfClosing,
  createSourceElement,
  createSourceText,
  decodeXmlEntities,
  elementCloseTag,
  elementOpenTag,
  findSourceElements,
  parseSourceFragment,
  rawTextOffset,
  replaceElementChildren,
  serializeSourceNode,
  SourceElement,
  SourceNode,
  SourceTree,
  textRaw
} from './source_tree'
import { buildLossReport, HwpxEditConflictError, isSurrogateBoundarySafe } from './xml_scan'
import {
  forgetPackageTrees,
  packageEntryTree,
  putPackageTrees,
  takePackageTrees,
  withSerializedTree
} from './package_trees'

export { HwpxEditConflictError }

export interface HwpxTextAnchor {
  sectionPath: string
  textNodeId: string
  ordinal: number
  text: string
}

export interface ReplaceTextCommand {
  type: 'replace-text'
  revision: number
  sectionPath: string
  textNodeId: string
  from: number
  to: number
  insert: string
  /**
   * inverse 전용. 적용 결과 text가 비면 `hp:t`를 이 자기 닫힘 tag 원문(`<hp:t/>` 등)으로 되돌린다.
   * 빈 `<hp:t/>`에 글자를 넣은 편집을 실행 취소할 때 원본 bytes를 그대로 복원하기 위해 쓴다.
   */
  restoreSelfClosingTag?: string
  /**
   * inverse 전용. `insert`를 기본 escape 대신 이 원문 XML 표기(text·entity·`hp:lineBreak`/`hp:tab` element)로
   * 넣는다. 지운 범위가 attribute 있는 `<hp:tab .../>`, 비표준 entity, 원문 CR/LF처럼 기본 표기가 아니었을 때
   * 실행 취소가 원래 bytes를 그대로 복원하도록 쓴다. 해석한 논리 text는 `insert`와 같아야 한다.
   */
  insertSource?: string
}

export interface HwpxLossReport {
  preservedEntries: string[]
  modifiedEntries: string[]
  regeneratedEntries: string[]
  omittedEntries: Array<{ path: string; reason: string }>
  unsupportedFeatures: Array<{
    code: string
    location?: string
    policy: 'preserved' | 'blocked' | 'removed'
  }>
  previewStatus: 'current' | 'stale' | 'omitted'
}

export interface ReplaceTextResult {
  package: HwpxSourcePackage
  inverse: ReplaceTextCommand
  anchor: HwpxTextAnchor
  lossReport: HwpxLossReport
}

const SELF_CLOSING_END = /\s*\/\s*>$/
const LINE_BREAK_TAG = '<hp:lineBreak/>'

/** 자기 닫힘 `<hp:t .../>`를 같은 attribute의 여는 tag `<hp:t ...>`로 바꾼다. */
function expandSelfClosingTag(tag: string): string {
  return tag.replace(SELF_CLOSING_END, '>')
}

function isSelfClosingTextTag(tag: string): boolean {
  return /^<\s*hp:t(?=[\s/])/.test(tag) && SELF_CLOSING_END.test(tag)
}

const INLINE_TEXT_CONTROLS: Readonly<Record<string, string>> = {
  'hp:lineBreak': '\n',
  'hp:tab': '\t'
}

export function escapeXmlText(text: string): string {
  assertXmlCharacters(text)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

/** HWPX hp:t의 논리 텍스트를 OWPML 혼합 콘텐츠로 직렬화한다. */
export function encodeHwpxTextContent(text: string): string {
  return escapeXmlText(text).replace(/&#10;/g, LINE_BREAK_TAG)
}

/**
 * `hp:t` 논리 텍스트를 source tree 자식 node로 만든다. 결과를 직렬화하면
 * {@link encodeHwpxTextContent}와 같은 문자열이 나온다(줄바꿈은 `<hp:lineBreak/>` element).
 */
function hwpxTextContentNodes(text: string): SourceNode[] {
  const nodes: SourceNode[] = []
  escapeXmlText(text)
    .split('&#10;')
    .forEach((segment, index) => {
      if (index > 0) nodes.push(createSourceElement('hp:lineBreak', LINE_BREAK_TAG, true))
      if (segment) nodes.push(createSourceText(segment))
    })
  return nodes
}

/**
 * `hp:t` element의 논리 텍스트. text와 자기 닫힘 `hp:lineBreak`/`hp:tab`만 있어야 하고,
 * 그 밖의 자식(comment·CDATA·PI·다른 element)이나 해석할 수 없는 entity가 있으면 undefined다.
 */
function hwpxTextValue(tree: SourceTree, element: SourceElement): string | undefined {
  let text = ''
  for (const child of element.children) {
    if (child.kind === 'text') {
      try {
        text += decodeXmlEntities(textRaw(tree, child))
      } catch {
        return undefined
      }
    } else if (child.kind === 'element' && child.sourceSelfClosing && child.selfClosing) {
      const control = INLINE_TEXT_CONTROLS[child.name]
      if (control === undefined) return undefined
      text += control
    } else {
      return undefined
    }
  }
  return text
}

/** 자기 닫힘 inline control element(`hp:lineBreak`/`hp:tab`)는 논리 text 한 글자다. 그 밖의 node는 0. */
function inlineControlLength(node: SourceNode): number {
  return node.kind === 'element' && node.selfClosing && INLINE_TEXT_CONTROLS[node.name] !== undefined ? 1 : 0
}

/** {@link rawTextOffset}을 편집 충돌 오류로 감싼다(surrogate 경계 검사가 앞서 entity 중간을 막는다). */
function rawOffsetOf(raw: string, logicalOffset: number): number {
  try {
    return rawTextOffset(raw, logicalOffset)
  } catch (error) {
    throw new HwpxEditConflictError((error as Error).message)
  }
}

/** 이어진 text node를 하나로 합친다. 원문 표기를 이어 붙이므로 직렬화 결과는 같다. */
function mergeAdjacentText(tree: SourceTree, nodes: SourceNode[]): SourceNode[] {
  const merged: SourceNode[] = []
  for (const node of nodes) {
    const previous = merged[merged.length - 1]
    if (node.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = createSourceText(textRaw(tree, previous) + textRaw(tree, node))
    } else {
      merged.push(node)
    }
  }
  return merged
}

interface TextChildSplice {
  children: SourceNode[]
  /** 지운 논리 범위의 원문 표기(entity·inline control element 포함) */
  removedSource: string
}

/**
 * `hp:t` 자식 가운데 논리 범위 [from, to)에 걸친 node만 바꾼다. 범위 밖 text 원문·`hp:tab`(attribute 포함)·
 * `hp:lineBreak` node는 그대로 두고, 범위 경계에 걸친 text node는 원문 표기를 잘라 앞뒤 조각으로 남긴다.
 * 범위 안의 inline control element는 지운다.
 */
function spliceTextChildren(
  tree: SourceTree,
  element: SourceElement,
  from: number,
  to: number,
  insertNodes: SourceNode[]
): TextChildSplice {
  const before: SourceNode[] = []
  const after: SourceNode[] = []
  let prefix = ''
  let suffix = ''
  let removedSource = ''
  let position = 0
  for (const child of element.children) {
    let length: number
    let raw: string | undefined
    if (child.kind === 'text') {
      raw = textRaw(tree, child)
      length = decodeXmlEntities(raw).length
    } else {
      length = inlineControlLength(child)
      if (!length) throw new HwpxEditConflictError('지원하지 않는 hp:t 혼합 콘텐츠가 있습니다.')
    }
    const start = position
    const end = position + length
    position = end
    if (end <= from) {
      before.push(child)
      continue
    }
    if (start >= to) {
      after.push(child)
      continue
    }
    if (raw === undefined) {
      // 범위 안에 온전히 든 inline control. 원문 표기(attribute 포함)를 inverse용으로 모은다.
      removedSource += serializeSourceNode(tree, child)
      continue
    }
    const cutStart = rawOffsetOf(raw, Math.max(0, from - start))
    const cutEnd = rawOffsetOf(raw, Math.min(length, to - start))
    if (start < from) prefix = raw.slice(0, cutStart)
    if (end > to) suffix = raw.slice(cutEnd)
    removedSource += raw.slice(cutStart, cutEnd)
  }
  const middle: SourceNode[] = []
  if (prefix) middle.push(createSourceText(prefix))
  middle.push(...insertNodes)
  if (suffix) middle.push(createSourceText(suffix))
  // 경계의 text node를 합쳐 연속 입력이 text node를 잘게 쪼개지 않게 한다(원문 표기를 이어 붙이므로 bytes는 같다).
  return { children: mergeAdjacentText(tree, [...before, ...middle, ...after]), removedSource }
}

/**
 * inverse의 `insertSource`를 `hp:t` 자식 node로 만든다. text와 자기 닫힘 `hp:lineBreak`/`hp:tab`만 받고,
 * 해석한 논리 text가 `insert`와 다르면 거부한다.
 */
function insertSourceNodes(insertSource: string, insert: string): SourceNode[] {
  const mismatch = (): HwpxEditConflictError =>
    new HwpxEditConflictError('되돌릴 hp:t 원문 표기가 삽입할 text와 일치하지 않습니다.')
  let nodes: SourceNode[]
  try {
    nodes = parseSourceFragment(insertSource)
  } catch {
    throw mismatch()
  }
  const holder = createSourceElement('hp:t', '<hp:t>', false)
  holder.children = nodes
  const value = hwpxTextValue(EMPTY_TREE, holder)
  if (value !== insert) throw mismatch()
  try {
    assertXmlCharacters(value)
  } catch {
    throw mismatch()
  }
  for (const node of nodes) node.parent = undefined
  return nodes
}

/** 새로 만든 node만 직렬화할 때 쓰는 빈 tree(새 node는 원문 범위를 참조하지 않는다). */
const EMPTY_TREE: SourceTree = { source: '', children: [] }

/**
 * @internal `hp:t` 내용을 논리 offset에서 둘로 나눈 원문 표기. text node는 entity 경계에서 원문을 자르고,
 * inline `hp:tab`(attribute 포함)·`hp:lineBreak`·원문 CR/LF·entity 표기는 byte 그대로 앞 또는 뒤 조각에 남는다.
 * offset 위치의 inline control은 뒤 조각에 속한다. 문단 분할·여러 문단 치환이 쓴다.
 */
export function splitHwpxTextContent(
  tree: SourceTree,
  element: SourceElement,
  offset: number
): { before: string; after: string } {
  let before = ''
  let after = ''
  let position = 0
  for (const child of element.children) {
    if (child.kind !== 'text') {
      const length = inlineControlLength(child)
      if (!length) throw new HwpxEditConflictError('지원하지 않는 hp:t 혼합 콘텐츠가 있습니다.')
      if (position < offset) before += serializeSourceNode(tree, child)
      else after += serializeSourceNode(tree, child)
      position += length
      continue
    }
    const raw = textRaw(tree, child)
    const length = decodeXmlEntities(raw).length
    if (position + length <= offset) before += raw
    else if (position >= offset) after += raw
    else {
      const cut = rawOffsetOf(raw, offset - position)
      before += raw.slice(0, cut)
      after += raw.slice(cut)
    }
    position += length
  }
  if (offset < 0 || offset > position) throw new HwpxEditConflictError(`text 범위가 올바르지 않습니다: ${offset}`)
  return { before, after }
}

/**
 * @internal `hp:t` element를 주어진 원문 내용(escape된 XML 혼합 콘텐츠)으로 다시 쓴 XML 표기.
 * 자기 닫힘 `<hp:t/>`는 내용이 비면 원문 tag 그대로 두고, 아니면 같은 attribute의 열린 tag로 펼친다.
 */
export function hwpxTextElementSource(tree: SourceTree, element: SourceElement, content: string): string {
  const openTag = elementOpenTag(tree, element)
  if (element.selfClosing) {
    if (!isSelfClosingTextTag(openTag)) throw new HwpxEditConflictError('hp:t tag 형식이 올바르지 않습니다.')
    return content ? `${expandSelfClosingTag(openTag)}${content}</hp:t>` : openTag
  }
  return openTag + content + elementCloseTag(tree, element)
}

// ---------------------------------------------------------------------------
// section별 `hp:t` 색인

/**
 * section source tree 하나의 `hp:t` 목록.
 * `elements[N]`이 anchor `${sectionPath}#hp:t:N`의 element이고(자기 닫힘 포함, 문서 순서),
 * `anchors`는 편집 가능한 것만 ordinal 순서로 담은 고정 배열이다.
 */
interface SectionTextState {
  tree: SourceTree
  elements: SourceElement[]
  anchors: readonly HwpxTextAnchor[]
  /** element → ordinal. 문단 command가 처음 쓸 때 만든다. */
  ordinals?: Map<SourceElement, number>
}

/**
 * source tree별 `hp:t` 색인. tree 자체는 package별 cache(`package_trees.ts`)에 있고, tree를 고친 command가 cache를
 * 새 package로 옮기면 색인도 함께 따라간다. `hp:t` 개수·순서를 바꾸는 tree 연산(글자 run 분할 등)은
 * {@link invalidateHwpxTextIndex}로 색인을 버리고, 다음 조회가 다시 parse하지 않고 tree에서 새로 만든다.
 */
const textIndexes = new WeakMap<SourceTree, SectionTextState>()

function freezeAnchor(anchor: HwpxTextAnchor): HwpxTextAnchor {
  return Object.freeze(anchor)
}

function buildSectionTextState(sectionPath: string, tree: SourceTree): SectionTextState {
  const elements = findSourceElements(tree, 'hp:t')
  const anchors: HwpxTextAnchor[] = []
  elements.forEach((element, ordinal) => {
    // 한/글은 빈 입력 칸을 `<hp:t/>`로 저장한다. 빈 anchor로 노출하고 첫 입력 때 열린 tag로 펼친다.
    // 사용자 정의 entity나 알 수 없는 inline control은 안전하게 복원할 수 없으므로 노출하지 않는다.
    const text = element.selfClosing ? '' : hwpxTextValue(tree, element)
    if (text === undefined) return
    anchors.push(freezeAnchor({ sectionPath, textNodeId: `${sectionPath}#hp:t:${ordinal}`, ordinal, text }))
  })
  return { tree, elements, anchors: Object.freeze(anchors) }
}

function sectionTextState(sourcePackage: HwpxSourcePackage, sectionPath: string): SectionTextState {
  const tree = packageEntryTree(sourcePackage, sectionPath)
  let state = textIndexes.get(tree)
  if (!state) {
    state = buildSectionTextState(sectionPath, tree)
    textIndexes.set(tree, state)
  }
  return state
}

/** @internal tree 연산이 `hp:t` 개수·순서를 바꾸었을 때 그 tree의 색인을 버린다. */
export function invalidateHwpxTextIndex(tree: SourceTree): void {
  textIndexes.delete(tree)
}

/** 편집 가능한 anchor 목록에서 ordinal의 위치(없으면 -1). 목록은 ordinal 오름차순이다. */
function anchorIndex(anchors: readonly HwpxTextAnchor[], ordinal: number): number {
  let low = 0
  let high = anchors.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const value = anchors[middle].ordinal
    if (value === ordinal) return middle
    if (value < ordinal) low = middle + 1
    else high = middle - 1
  }
  return -1
}

function findAnchorIndex(state: SectionTextState, sectionPath: string, textNodeId: string): number {
  const prefix = `${sectionPath}#hp:t:`
  if (!textNodeId.startsWith(prefix)) return -1
  const ordinal = Number(textNodeId.slice(prefix.length))
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || `${prefix}${ordinal}` !== textNodeId) return -1
  return anchorIndex(state.anchors, ordinal)
}

/** test 전용: cache를 비운 것과 같은 결과를 얻으려고 package의 tree cache를 지운다. */
export function forgetHwpxTextTree(sourcePackage: HwpxSourcePackage): void {
  forgetPackageTrees(sourcePackage)
}

/**
 * @internal 편집 가능한 anchor의 `hp:t` element와 그 section tree. 없으면 undefined.
 * style command가 section을 다시 parse하지 않고 run·문단을 찾는 데 쓴다.
 */
export function locateHwpxTextElement(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string
): { tree: SourceTree; element: SourceElement; anchor: HwpxTextAnchor } | undefined {
  const state = sectionTextState(sourcePackage, sectionPath)
  const index = findAnchorIndex(state, sectionPath, textNodeId)
  if (index < 0) return undefined
  const anchor = state.anchors[index]
  return { tree: state.tree, element: state.elements[anchor.ordinal], anchor }
}

/**
 * @internal `hp:t` element의 anchor ordinal(section 안 문서 순서, 편집 불가 `hp:t` 포함). tree에 없으면 -1.
 * 문단 command가 인접 문단의 첫 `hp:t`를 anchor id로 바꿀 때 쓴다.
 */
export function hwpxTextOrdinal(sourcePackage: HwpxSourcePackage, sectionPath: string, element: SourceElement): number {
  const state = sectionTextState(sourcePackage, sectionPath)
  if (!state.ordinals) state.ordinals = new Map(state.elements.map((candidate, ordinal) => [candidate, ordinal]))
  return state.ordinals.get(element) ?? -1
}

// ---------------------------------------------------------------------------
// 공개 API

/** section XML에 있는 모든 `hp:t`의 ordinal을 source tree 기준 문서 순서대로 돌려준다(교차 parser 검증용). */
export function listHwpxTextOrdinals(sourcePackage: HwpxSourcePackage, sectionPath: string): number[] {
  return sectionTextState(sourcePackage, sectionPath).elements.map((_element, ordinal) => ordinal)
}

/** section의 편집 가능한 `hp:t` anchor. 반환 배열과 원소는 고정(frozen)되어 있고 package마다 cache된다. */
export function listHwpxTextAnchors(sourcePackage: HwpxSourcePackage, sectionPath: string): readonly HwpxTextAnchor[] {
  if (!/^Contents\/section\d+\.xml$/.test(sectionPath)) {
    throw new Error(`HWPX section 경로가 아닙니다: ${sectionPath}`)
  }
  return sectionTextState(sourcePackage, sectionPath).anchors
}

function assertTextBoundary(text: string, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new HwpxEditConflictError(`text 범위가 올바르지 않습니다: ${offset}`)
  }
  if (!isSurrogateBoundarySafe(text, offset)) {
    throw new HwpxEditConflictError('Unicode surrogate pair 중간은 편집할 수 없습니다.')
  }
}

type TextElementEdit =
  | { kind: 'none' }
  | { kind: 'content'; children: SourceNode[] }
  | { kind: 'collapse'; tag: string }

/**
 * `hp:t` 하나의 text 범위를 바꾼다. section source tree에서 ordinal로 `hp:t`를 찾아 범위에 걸친 자식 node만
 * 바꾸고, 바뀐 node만 다시 쓰는 serializer로 새 section XML을 만든다. 범위 밖 text의 entity 표기·inline
 * `hp:tab`(attribute 포함)·`hp:lineBreak`·원문 CR/LF는 byte 그대로이고, 빈 편집은 입력과 같은 bytes를 만든다.
 * inverse는 지운 범위의 원문 표기를 `insertSource`로 들고 있어 실행 취소가 원래 bytes를 복원한다.
 */
export function applyReplaceTextCommand(
  sourcePackage: HwpxSourcePackage,
  command: ReplaceTextCommand
): ReplaceTextResult {
  if (command.type !== 'replace-text') throw new Error('지원하지 않는 HWPX 편집 command입니다.')
  if (command.revision !== sourcePackage.revision) {
    throw new HwpxEditConflictError(
      `문서 revision이 변경되었습니다: expected ${command.revision}, actual ${sourcePackage.revision}`
    )
  }

  const state = sectionTextState(sourcePackage, command.sectionPath)
  const index = findAnchorIndex(state, command.sectionPath, command.textNodeId)
  if (index < 0) throw new HwpxEditConflictError(`text anchor를 찾을 수 없습니다: ${command.textNodeId}`)
  const sourceAnchor = state.anchors[index]
  assertTextBoundary(sourceAnchor.text, command.from)
  assertTextBoundary(sourceAnchor.text, command.to)
  if (command.from > command.to) throw new HwpxEditConflictError('text 범위의 시작이 끝보다 큽니다.')

  const removed = sourceAnchor.text.slice(command.from, command.to)
  const nextText = sourceAnchor.text.slice(0, command.from) + command.insert + sourceAnchor.text.slice(command.to)
  const element = state.elements[sourceAnchor.ordinal]
  const openTag = elementOpenTag(state.tree, element)

  // tree를 고치기 전에 모든 검증과 escape를 끝낸다. 도중 실패가 cache된 tree를 망가뜨리지 않게 한다.
  // 새로 넣는 text는 기본 escape(`\t` → `&#9;`, `\n` → `<hp:lineBreak/>`)로 쓰고, inverse는 지운 범위의 원문 표기를
  // `insertSource`로 넘겨 받아 그대로 되살린다.
  const insertNodes =
    command.insertSource !== undefined
      ? insertSourceNodes(command.insertSource, command.insert)
      : hwpxTextContentNodes(command.insert)
  let edit: TextElementEdit
  let restoreSelfClosingTag: string | undefined
  let removedSource = ''
  if (element.selfClosing) {
    // `<hp:t/>` → `<hp:t>…</hp:t>`로 펼친다. inverse가 빈 text로 되돌릴 때 원래 tag bytes를 다시 쓴다.
    if (!isSelfClosingTextTag(openTag)) throw new HwpxEditConflictError('hp:t tag 형식이 올바르지 않습니다.')
    edit = nextText ? { kind: 'content', children: insertNodes } : { kind: 'none' }
    if (nextText) restoreSelfClosingTag = openTag
  } else {
    // 바뀐 범위에 걸친 자식 node만 바꾼다. 범위 밖 원문 표기(attribute 있는 `hp:tab`, entity 표기, CR/LF)는 그대로다.
    const splice = spliceTextChildren(state.tree, element, command.from, command.to, insertNodes)
    removedSource = splice.removedSource
    if (command.restoreSelfClosingTag !== undefined && nextText === '') {
      if (
        !isSelfClosingTextTag(command.restoreSelfClosingTag) ||
        expandSelfClosingTag(command.restoreSelfClosingTag) !== openTag
      ) {
        throw new HwpxEditConflictError('되돌릴 빈 hp:t tag가 현재 원문과 일치하지 않습니다.')
      }
      edit = { kind: 'collapse', tag: command.restoreSelfClosingTag }
    } else {
      edit = { kind: 'content', children: splice.children }
    }
  }
  // 지운 범위가 기본 표기가 아니면(원문 `hp:tab` attribute, 비표준 entity, CR/LF 등) inverse가 원문 표기를 들고 간다.
  const insertSource = removedSource !== encodeHwpxTextContent(removed) ? removedSource : undefined

  let nextPackage = sourcePackage
  const anchor: HwpxTextAnchor = freezeAnchor({
    sectionPath: sourceAnchor.sectionPath,
    textNodeId: sourceAnchor.textNodeId,
    ordinal: sourceAnchor.ordinal,
    text: nextText
  })
  if (edit.kind !== 'none') {
    // tree를 제자리에서 고치므로 먼저 원래 package에서 떼어 낸다. 이후 실패하면 cache는 그냥 버려진다.
    const trees = takePackageTrees(sourcePackage)
    if (edit.kind === 'content') replaceElementChildren(state.tree, element, edit.children)
    else collapseElementToSelfClosing(element, edit.tag)
    nextPackage = withSerializedTree(sourcePackage, command.sectionPath, state.tree)
    const anchors = state.anchors.slice()
    anchors[index] = anchor
    state.anchors = Object.freeze(anchors)
    // 다른 entry tree는 바뀌지 않았으므로 함께 옮긴다.
    putPackageTrees(nextPackage, trees)
  }

  return {
    package: nextPackage,
    inverse: {
      type: 'replace-text',
      revision: nextPackage.revision,
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      from: command.from,
      to: command.from + command.insert.length,
      insert: removed,
      ...(restoreSelfClosingTag !== undefined ? { restoreSelfClosingTag } : {}),
      ...(insertSource !== undefined ? { insertSource } : {})
    },
    anchor: { ...anchor },
    lossReport: buildLossReport(sourcePackage, [command.sectionPath])
  }
}
