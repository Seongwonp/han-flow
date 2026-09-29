import { HwpxSourcePackage } from '../parser/source_package'
import {
  assertXmlCharacters,
  collapseElementToSelfClosing,
  createSourceElement,
  createSourceText,
  decodeXmlEntities,
  elementOpenTag,
  findSourceElements,
  parseSourceTree,
  replaceElementChildren,
  serializeSourceNode,
  serializeSourceTree,
  SourceElement,
  SourceNode,
  SourceTree,
  textRaw
} from './source_tree'
import { buildLossReport, HwpxEditConflictError, isSurrogateBoundarySafe } from './xml_scan'

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

/**
 * text node 원문(entity 미해석) 안에서 논리 offset에 해당하는 원문 offset. entity 하나는 해석한 문자 길이만큼
 * 논리 offset을 차지하므로 entity 중간에서 멈추지 않는다(surrogate 경계 검사가 앞서 이를 보장한다).
 */
function rawOffsetOf(raw: string, logicalOffset: number): number {
  let logical = 0
  let index = 0
  while (logical < logicalOffset) {
    if (index >= raw.length) throw new HwpxEditConflictError('text 범위가 원문을 벗어났습니다.')
    if (raw[index] === '&') {
      const end = raw.indexOf(';', index)
      if (end < 0) throw new HwpxEditConflictError('해석할 수 없는 XML entity가 있습니다.')
      logical += decodeXmlEntities(raw.slice(index, end + 1)).length
      index = end + 1
    } else {
      logical += 1
      index += 1
    }
  }
  if (logical !== logicalOffset) throw new HwpxEditConflictError('XML entity 중간은 편집할 수 없습니다.')
  return index
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
  let fragment: SourceTree
  try {
    fragment = parseSourceTree(insertSource)
  } catch {
    throw mismatch()
  }
  const holder = createSourceElement('hp:t', '<hp:t>', false)
  holder.children = fragment.children
  const value = hwpxTextValue(fragment, holder)
  if (value !== insert) throw mismatch()
  try {
    assertXmlCharacters(value)
  } catch {
    throw mismatch()
  }
  return fragment.children.map((node) =>
    node.kind === 'text'
      ? createSourceText(textRaw(fragment, node))
      : createSourceElement((node as SourceElement).name, fragment.source.slice(node.start, node.end), true)
  )
}

function decodeUtf8(bytes: Buffer): string {
  const xml = bytes.toString('utf8')
  if (!Buffer.from(xml, 'utf8').equals(bytes)) {
    throw new Error('UTF-8이 아닌 section XML은 아직 편집할 수 없습니다.')
  }
  return xml
}

/**
 * `hp:t` element를 주어진 논리 텍스트로 다시 쓴다.
 * `openTag`·`closeTag`는 원문 XML에서 잘라 낸 tag이고, 자기 닫힘 `<hp:t/>`이면 `closeTag`는 빈 문자열이다.
 * 자기 닫힘 tag는 text가 비어 있으면 원문 그대로 두고, 아니면 같은 attribute의 열린 tag로 펼친다.
 */
export function rewriteHwpxTextElement(openTag: string, closeTag: string, text: string): string {
  if (!closeTag) {
    if (!isSelfClosingTextTag(openTag)) throw new HwpxEditConflictError('hp:t tag 형식이 올바르지 않습니다.')
    return text ? `${expandSelfClosingTag(openTag)}${encodeHwpxTextContent(text)}</hp:t>` : openTag
  }
  return openTag + encodeHwpxTextContent(text) + closeTag
}

// ---------------------------------------------------------------------------
// section별 source tree cache

/**
 * section 하나의 source tree와 `hp:t` 목록.
 * `elements[N]`이 anchor `${sectionPath}#hp:t:N`의 element이고(자기 닫힘 포함, 문서 순서),
 * `anchors`는 편집 가능한 것만 ordinal 순서로 담은 고정 배열이다.
 */
interface SectionTextState {
  tree: SourceTree
  elements: SourceElement[]
  anchors: readonly HwpxTextAnchor[]
}

/**
 * package별 section tree cache. `HwpxSourcePackage`는 불변이므로 package 객체(= 그 revision의 bytes)를
 * key로 쓴다. text command는 tree를 제자리에서 고친 뒤 cache를 새 package로 옮긴다. 그 밖의 command가 만든
 * package에는 cache가 없으므로 첫 조회 때 다시 parse한다(= non-text revision에서 무효화).
 */
const sectionStates = new WeakMap<HwpxSourcePackage, Map<string, SectionTextState>>()

function freezeAnchor(anchor: HwpxTextAnchor): HwpxTextAnchor {
  return Object.freeze(anchor)
}

function buildSectionTextState(sectionPath: string, xml: string): SectionTextState {
  const tree = parseSourceTree(xml)
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
  let states = sectionStates.get(sourcePackage)
  const cached = states?.get(sectionPath)
  if (cached) return cached
  const state = buildSectionTextState(sectionPath, decodeUtf8(sourcePackage.readEntry(sectionPath)))
  if (!states) {
    states = new Map()
    sectionStates.set(sourcePackage, states)
  }
  states.set(sectionPath, state)
  return state
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

/** test 전용: cache를 비운 것과 같은 결과를 얻으려고 package의 cache 항목을 지운다. */
export function forgetHwpxTextTree(sourcePackage: HwpxSourcePackage): void {
  sectionStates.delete(sourcePackage)
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
    const states = sectionStates.get(sourcePackage)!
    // tree를 제자리에서 고치므로 먼저 원래 package에서 떼어 낸다. 이후 실패하면 cache는 그냥 버려진다.
    sectionStates.delete(sourcePackage)
    if (edit.kind === 'content') replaceElementChildren(state.tree, element, edit.children)
    else collapseElementToSelfClosing(element, edit.tag)
    const nextXml = serializeSourceTree(state.tree)
    nextPackage = sourcePackage.withEntry(command.sectionPath, Buffer.from(nextXml, 'utf8'))
    const anchors = state.anchors.slice()
    anchors[index] = anchor
    state.anchors = Object.freeze(anchors)
    // 다른 section tree는 바뀌지 않았으므로 함께 옮긴다.
    sectionStates.set(nextPackage, states)
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
