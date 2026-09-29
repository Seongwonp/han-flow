import { iterateXmlTokens } from './xml_scan'

/**
 * 편집용 lossless source tree.
 *
 * section·header XML 원문을 `xml_scan.ts`의 tokenizer({@link iterateXmlTokens})로 읽어 element·text·
 * comment·PI·CDATA·선언 node로 만든다. 각 node는 원문에서 차지하는 UTF-16 offset 범위를 들고 있고,
 * 편집하지 않은 tree를 직렬화하면 입력 문자열이 byte 단위로 그대로 나온다.
 *
 * 편집 연산은 바뀐 node와 그 조상을 dirty로 표시한다. serializer는 dirty가 아닌 node(와 연속된
 * 형제 구간)를 원문에서 그대로 복사하고 dirty node만 다시 쓴다. dirty element도 따로 바꾸지 않은
 * 여는·닫는 tag는 원문 표기(attribute 순서·따옴표·공백)를 유지한다.
 *
 * text node는 entity를 원문 표기(as-written) 그대로 들고 있고, 해석은 {@link decodeXmlEntities}로 한다.
 */

export type SourceMarkupKind = 'comment' | 'cdata' | 'pi' | 'declaration'

interface SourceNodeBase {
  parent?: SourceElement
  /** 원문 범위. 편집으로 새로 만든 node는 -1이다. dirty가 아닐 때만 의미가 있다. */
  start: number
  end: number
  /** 이 node 또는 자손이 원문과 달라졌으면 true */
  dirty: boolean
}

export interface SourceElement extends SourceNodeBase {
  kind: 'element'
  name: string
  children: SourceNode[]
  /** 원문 여는 tag 바로 뒤 위치. 원문이 자기 닫힘이면 `end`와 같다. */
  openEnd: number
  /** 원문 닫는 tag의 `<` 위치. 원문이 자기 닫힘이면 `end`와 같다. */
  closeStart: number
  /** 원문에서 자기 닫힘 tag였는지 */
  readonly sourceSelfClosing: boolean
  /** 현재 자기 닫힘 형태인지. true이면 `children`은 비어 있어야 한다. */
  selfClosing: boolean
  /** 다시 쓴 여는 tag(자기 닫힘이면 tag 전체). 없으면 원문 여는 tag를 쓴다. */
  openTag?: string
  /** 다시 쓴 닫는 tag. 없으면 원문 닫는 tag를 쓴다. */
  closeTag?: string
}

export interface SourceText extends SourceNodeBase {
  kind: 'text'
  /** 다시 쓴 원문 표기(escape된 XML text). 없으면 원문 범위를 쓴다. */
  raw?: string
}

export interface SourceMarkup extends SourceNodeBase {
  kind: SourceMarkupKind
  /** 편집으로 새로 만든 markup node의 원문. 없으면 원문 범위를 쓴다. */
  raw?: string
}

export type SourceNode = SourceElement | SourceText | SourceMarkup

export interface SourceTree {
  /** parse한 원문. dirty가 아닌 node의 범위는 이 문자열 기준이다. */
  readonly source: string
  children: SourceNode[]
}

/**
 * XML 문자열을 source tree로 읽는다. tokenizer 오류는 `scanXmlElements`의 기본(`'plain'`) 방식과 같고,
 * 여는·닫는 tag 짝이 맞지 않으면 같은 message로 오류를 던진다.
 */
export function parseSourceTree(xml: string): SourceTree {
  const root: SourceNode[] = []
  const stack: SourceElement[] = []
  let siblings = root
  let cursor = 0
  const pushText = (start: number, end: number): void => {
    siblings.push({ kind: 'text', start, end, dirty: false, parent: stack[stack.length - 1] })
  }
  for (const token of iterateXmlTokens(xml)) {
    if (token.start > cursor) pushText(cursor, token.start)
    cursor = token.end
    const parent = stack[stack.length - 1]
    switch (token.kind) {
      case 'open': {
        const element: SourceElement = {
          kind: 'element',
          name: token.name!,
          parent,
          children: [],
          start: token.start,
          openEnd: token.end,
          closeStart: -1,
          end: -1,
          sourceSelfClosing: false,
          selfClosing: false,
          dirty: false
        }
        siblings.push(element)
        stack.push(element)
        siblings = element.children
        break
      }
      case 'self-close':
        siblings.push({
          kind: 'element',
          name: token.name!,
          parent,
          children: [],
          start: token.start,
          openEnd: token.end,
          closeStart: token.end,
          end: token.end,
          sourceSelfClosing: true,
          selfClosing: true,
          dirty: false
        })
        break
      case 'close': {
        const open = stack.pop()
        if (!open || open.name !== token.name) throw new Error(`XML tag 순서가 올바르지 않습니다: ${token.name}`)
        open.closeStart = token.start
        open.end = token.end
        siblings = stack.length ? stack[stack.length - 1].children : root
        break
      }
      default:
        siblings.push({ kind: token.kind, start: token.start, end: token.end, dirty: false, parent })
    }
  }
  if (stack.length) throw new Error(`끝나지 않은 XML element가 있습니다: ${stack[stack.length - 1].name}`)
  if (cursor < xml.length) pushText(cursor, xml.length)
  return { source: xml, children: root }
}

function emitNode(tree: SourceTree, node: SourceNode, out: string[]): void {
  if (!node.dirty) {
    out.push(tree.source.slice(node.start, node.end))
    return
  }
  if (node.kind === 'text') {
    out.push(node.raw ?? tree.source.slice(node.start, node.end))
    return
  }
  if (node.kind !== 'element') {
    // markup node는 편집 연산이 없다. 새로 만든(fragment에서 옮겨 온) node만 dirty이고 원문을 들고 있다.
    out.push(node.raw ?? tree.source.slice(node.start, node.end))
    return
  }
  out.push(elementOpenTag(tree, node))
  if (node.selfClosing) {
    if (node.children.length) throw new Error('자기 닫힘 element에 자식 node가 있습니다.')
    return
  }
  emitChildren(tree, node.children, out)
  out.push(elementCloseTag(tree, node))
}

/** dirty가 아닌 연속 형제는 원문 한 구간으로 복사한다. */
function emitChildren(tree: SourceTree, children: readonly SourceNode[], out: string[]): void {
  let runStart = -1
  let runEnd = -1
  const flush = (): void => {
    if (runStart >= 0) out.push(tree.source.slice(runStart, runEnd))
    runStart = -1
  }
  for (const child of children) {
    if (child.dirty) {
      flush()
      emitNode(tree, child, out)
    } else {
      if (runStart < 0 || child.start !== runEnd) {
        flush()
        runStart = child.start
      }
      runEnd = child.end
    }
  }
  flush()
}

/** tree를 XML 문자열로 쓴다. 편집하지 않은 tree는 `tree.source`와 같다. */
export function serializeSourceTree(tree: SourceTree): string {
  const out: string[] = []
  emitChildren(tree, tree.children, out)
  return out.join('')
}

/** node 하나(자손 포함)의 현재 XML 표기. */
export function serializeSourceNode(tree: SourceTree, node: SourceNode): string {
  const out: string[] = []
  emitNode(tree, node, out)
  return out.join('')
}

/** element의 현재 여는 tag(자기 닫힘이면 tag 전체). */
export function elementOpenTag(tree: SourceTree, element: SourceElement): string {
  return element.openTag ?? tree.source.slice(element.start, element.openEnd)
}

/** element의 현재 닫는 tag. 자기 닫힘이면 빈 문자열. */
export function elementCloseTag(tree: SourceTree, element: SourceElement): string {
  if (element.selfClosing) return ''
  if (element.closeTag !== undefined) return element.closeTag
  return element.sourceSelfClosing ? `</${element.name}>` : tree.source.slice(element.closeStart, element.end)
}

/** text node의 현재 원문 표기(entity 미해석). */
export function textRaw(tree: SourceTree, node: SourceText): string {
  return node.raw ?? tree.source.slice(node.start, node.end)
}

/** markup node(comment·PI·CDATA·선언)의 원문. */
export function markupRaw(tree: SourceTree, node: SourceMarkup): string {
  return node.raw ?? tree.source.slice(node.start, node.end)
}

/** node와 조상을 dirty로 표시한다. 조상이 이미 dirty이면 그 위도 dirty이므로 멈춘다. */
export function markDirty(node: SourceNode): void {
  node.dirty = true
  // 불변식: dirty node의 조상은 모두 dirty다. node가 새로 붙은 경우를 위해 자신과 무관하게 올라간다.
  for (let ancestor = node.parent; ancestor && !ancestor.dirty; ancestor = ancestor.parent) ancestor.dirty = true
}

/** 새 text node. `raw`는 이미 escape된 XML text여야 한다. */
export function createSourceText(raw: string): SourceText {
  return { kind: 'text', start: -1, end: -1, dirty: true, raw }
}

/** 새 element. `openTag`는 여는 tag 원문이고, `selfClosing`이면 자기 닫힘 tag 전체다. */
export function createSourceElement(name: string, openTag: string, selfClosing: boolean): SourceElement {
  return {
    kind: 'element',
    name,
    children: [],
    start: -1,
    openEnd: -1,
    closeStart: -1,
    end: -1,
    sourceSelfClosing: selfClosing,
    selfClosing,
    openTag,
    closeTag: selfClosing ? undefined : `</${name}>`,
    dirty: true
  }
}

const SELF_CLOSING_END = /\s*\/\s*>$/

/**
 * element의 자식을 모두 바꾼다. 자기 닫힘 element에 자식을 넣으면 같은 attribute의
 * 여는 tag(`/>` → `>`)와 `</name>`으로 펼친다.
 */
export function replaceElementChildren(tree: SourceTree, element: SourceElement, children: SourceNode[]): void {
  if (element.selfClosing && children.length) {
    element.openTag = elementOpenTag(tree, element).replace(SELF_CLOSING_END, '>')
    element.closeTag = `</${element.name}>`
    element.selfClosing = false
  }
  for (const child of element.children) child.parent = undefined
  for (const child of children) child.parent = element
  element.children = children
  markDirty(element)
}

/** element를 주어진 자기 닫힘 tag 원문으로 되돌리고 자식을 모두 뗀다. */
export function collapseElementToSelfClosing(element: SourceElement, selfClosingTag: string): void {
  if (!SELF_CLOSING_END.test(selfClosingTag)) throw new Error('자기 닫힘 tag가 아닙니다.')
  for (const child of element.children) child.parent = undefined
  element.children = []
  element.selfClosing = true
  element.openTag = selfClosingTag
  element.closeTag = undefined
  markDirty(element)
}

/**
 * `parent`의 자식 `start`부터 `deleteCount`개를 떼고 `nodes`를 그 자리에 넣는다(Array.splice와 같은 의미).
 * 자기 닫힘 element에 자식을 넣으면 {@link replaceElementChildren}처럼 여는·닫는 tag로 펼친다.
 * 뗀 node를 돌려준다. 새 node는 dirty여야 하고(`createSource*`·{@link parseSourceFragment}), 남은 형제는 원문 그대로 쓰인다.
 */
export function spliceSourceChildren(
  tree: SourceTree,
  parent: SourceElement,
  start: number,
  deleteCount: number,
  nodes: readonly SourceNode[]
): SourceNode[] {
  if (!Number.isInteger(start) || start < 0 || start > parent.children.length) {
    throw new Error('source tree 자식 위치가 올바르지 않습니다.')
  }
  const children = parent.children.slice()
  const removed = children.splice(start, deleteCount, ...nodes)
  replaceElementChildren(tree, parent, children)
  for (const node of removed) node.parent = undefined
  return removed
}

/** node를 부모에서 떼고 그 자리에 `nodes`를 넣는다. */
export function replaceSourceNode(tree: SourceTree, node: SourceNode, nodes: readonly SourceNode[]): void {
  const parent = node.parent
  if (!parent) throw new Error('최상위 source node는 바꿀 수 없습니다.')
  const index = parent.children.indexOf(node)
  if (index < 0) throw new Error('source tree 부모·자식 연결이 올바르지 않습니다.')
  spliceSourceChildren(tree, parent, index, 1, nodes)
}

const TAG_NAME = /^<\s*([^\s/>]+)/

/**
 * element의 여는 tag(자기 닫힘이면 tag 전체)를 주어진 원문으로 바꾼다. inverse가 저장해 둔 tag bytes를 그대로
 * 되돌릴 때 쓴다. tag 이름과 자기 닫힘 여부가 지금 element와 같아야 한다.
 */
export function setElementOpenTag(tree: SourceTree, element: SourceElement, tag: string): void {
  if (tag.match(TAG_NAME)?.[1] !== element.name || SELF_CLOSING_END.test(tag) !== element.selfClosing) {
    throw new Error(`${element.name} tag로 바꿀 수 없는 원문입니다.`)
  }
  parseTagAttributes(tag)
  if (tag === elementOpenTag(tree, element)) return
  element.openTag = tag
  markDirty(element)
}

function detachSourceNode(tree: SourceTree, node: SourceNode): SourceNode {
  if (node.kind === 'text') return createSourceText(textRaw(tree, node))
  if (node.kind !== 'element') {
    return { kind: node.kind, start: -1, end: -1, dirty: true, raw: markupRaw(tree, node) }
  }
  const element = createSourceElement(node.name, elementOpenTag(tree, node), node.selfClosing)
  if (!node.selfClosing) {
    element.closeTag = elementCloseTag(tree, node)
    element.children = node.children.map((child) => {
      const detached = detachSourceNode(tree, child)
      detached.parent = element
      return detached
    })
  }
  return element
}

/**
 * XML 조각을 다른 tree에 붙일 수 있는 새 node 목록으로 읽는다. 각 node는 자기 원문 표기를 직접 들고 있어
 * 어느 tree에 넣어도 같은 문자열로 직렬화되고, 넣은 뒤에도 일반 node처럼 찾고 고칠 수 있다.
 */
export function parseSourceFragment(xml: string): SourceNode[] {
  const fragment = parseSourceTree(xml)
  return fragment.children.map((node) => detachSourceNode(fragment, node))
}

/** `node`의 자손 element 가운데 문서 순서로 처음 나오는 `name`(자기 자신 제외). */
export function findFirstSourceElement(node: SourceElement, name: string): SourceElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'element') continue
    if (child.name === name) return child
    const nested = findFirstSourceElement(child, name)
    if (nested) return nested
  }
  return undefined
}

/** `node`의 자손 element 가운데 `name`을 모두 문서 순서로 모은다(자기 자신 제외). */
export function findDescendantSourceElements(node: SourceElement, name: string): SourceElement[] {
  const result: SourceElement[] = []
  const visit = (children: readonly SourceNode[]): void => {
    for (const child of children) {
      if (child.kind !== 'element') continue
      if (child.name === name) result.push(child)
      visit(child.children)
    }
  }
  visit(node.children)
  return result
}

/** 가장 가까운 조상 element 가운데 이름이 `name`인 것. */
export function nearestSourceAncestor(node: SourceNode, name: string): SourceElement | undefined {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.name === name) return ancestor
  }
  return undefined
}

/** 문서 순서(여는 tag 순서)로 `name` element를 모은다. */
export function findSourceElements(tree: SourceTree, name: string): SourceElement[] {
  const result: SourceElement[] = []
  const visit = (nodes: readonly SourceNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (node.name === name) result.push(node)
      if (node.children.length) visit(node.children)
    }
  }
  visit(tree.children)
  return result
}

// ---------------------------------------------------------------------------
// entity

/**
 * XML text의 entity를 해석한다. 미리 정의된 다섯 entity와 10진·16진 문자 참조만 받고,
 * 그 밖의 entity나 짝 없는 `&`는 오류를 던진다(사용자 정의 entity는 안전하게 되돌릴 수 없다).
 */
export function decodeXmlEntities(source: string): string {
  if (!source.includes('&')) return source
  let decoded = ''
  let cursor = 0
  const entityPattern = /&([^;]+);/g
  for (const match of source.matchAll(entityPattern)) {
    const index = match.index ?? 0
    const plain = source.slice(cursor, index)
    if (plain.includes('&')) throw new Error('해석할 수 없는 XML entity가 있습니다.')
    decoded += plain
    const entity = match[1]
    if (entity === 'amp') decoded += '&'
    else if (entity === 'lt') decoded += '<'
    else if (entity === 'gt') decoded += '>'
    else if (entity === 'quot') decoded += '"'
    else if (entity === 'apos') decoded += "'"
    else if (/^#\d+$/.test(entity)) decoded += String.fromCodePoint(Number(entity.slice(1)))
    else if (/^#x[\da-f]+$/i.test(entity)) decoded += String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    else throw new Error(`지원하지 않는 XML entity입니다: &${entity};`)
    cursor = index + match[0].length
  }
  const tail = source.slice(cursor)
  if (tail.includes('&')) throw new Error('해석할 수 없는 XML entity가 있습니다.')
  return decoded + tail
}

/**
 * text node 원문(entity 미해석) 안에서 해석한 text의 UTF-16 offset `logicalOffset`에 해당하는 원문 offset.
 * entity 하나는 해석한 문자 길이만큼 차지하므로 entity 한가운데에 해당하는 offset이면 오류를 던진다.
 */
export function rawTextOffset(raw: string, logicalOffset: number): number {
  let logical = 0
  let index = 0
  while (logical < logicalOffset) {
    if (index >= raw.length) throw new Error('text 범위가 원문을 벗어났습니다.')
    if (raw[index] === '&') {
      const end = raw.indexOf(';', index)
      if (end < 0) throw new Error('해석할 수 없는 XML entity가 있습니다.')
      logical += decodeXmlEntities(raw.slice(index, end + 1)).length
      index = end + 1
    } else {
      logical += 1
      index += 1
    }
  }
  if (logical !== logicalOffset) throw new Error('XML entity 중간은 편집할 수 없습니다.')
  return index
}

function isValidXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

/** XML 1.0에서 허용하지 않는 문자(NUL, 짝 없는 surrogate 등)가 있으면 오류를 던진다. */
export function assertXmlCharacters(text: string): void {
  for (const character of text) {
    if (!isValidXmlCharacter(character.codePointAt(0)!)) {
      throw new Error('XML 1.0에서 허용하지 않는 문자가 포함되어 있습니다.')
    }
  }
}

/**
 * attribute 값을 escape한다. `&`, `<`, `>`, 감싸는 따옴표와 같은 따옴표, 그리고 attribute 값 정규화로
 * 사라지는 tab·줄바꿈·CR을 문자 참조로 바꾼다.
 */
export function escapeXmlAttribute(value: string, quote: '"' | "'" = '"'): string {
  assertXmlCharacters(value)
  let escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  escaped = quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&apos;')
  return escaped.replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;')
}

// ---------------------------------------------------------------------------
// attribute

/** 여는 tag 원문 안 attribute 하나의 위치. offset은 tag 문자열 기준이다. */
export interface TagAttribute {
  name: string
  /** 따옴표 안 원문(entity 미해석) */
  rawValue: string
  quote: '"' | "'"
  /** attribute 이름 시작 위치 */
  start: number
  /** 값 시작 위치(여는 따옴표 다음) */
  valueStart: number
  /** 값 끝 위치(닫는 따옴표 위치) */
  valueEnd: number
}

function isXmlSpace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

/**
 * 여는 tag(또는 자기 닫힘 tag) 원문의 attribute를 원문 순서대로 읽는다.
 * 따옴표를 인식하므로 다른 attribute 값 안의 `name="..."`나 `>`·줄바꿈이 든 값도 정확히 나눈다.
 */
export function parseTagAttributes(tag: string): TagAttribute[] {
  const invalid = (): Error => new Error(`해석할 수 없는 XML attribute가 있습니다: ${tag.slice(0, 32)}`)
  let index = 0
  if (tag[index] !== '<') throw invalid()
  index += 1
  while (isXmlSpace(tag[index])) index += 1
  while (index < tag.length && !isXmlSpace(tag[index]) && tag[index] !== '/' && tag[index] !== '>') index += 1
  const attributes: TagAttribute[] = []
  for (;;) {
    const beforeSpace = index
    while (isXmlSpace(tag[index])) index += 1
    const character = tag[index]
    if (character === undefined) throw invalid()
    if (character === '>' || character === '/') {
      // `/`는 자기 닫힘 끝(`/>`)이어야 한다.
      if (character === '/' && !/^\/\s*>$/.test(tag.slice(index))) throw invalid()
      if (character === '>' && index !== tag.length - 1) throw invalid()
      return attributes
    }
    if (index === beforeSpace) throw invalid()
    const start = index
    while (index < tag.length && !isXmlSpace(tag[index]) && !'=/>'.includes(tag[index])) index += 1
    const name = tag.slice(start, index)
    while (isXmlSpace(tag[index])) index += 1
    if (tag[index] !== '=') throw invalid()
    index += 1
    while (isXmlSpace(tag[index])) index += 1
    const quote = tag[index]
    if (quote !== '"' && quote !== "'") throw invalid()
    const valueStart = index + 1
    const valueEnd = tag.indexOf(quote, valueStart)
    if (valueEnd < 0) throw invalid()
    attributes.push({ name, rawValue: tag.slice(valueStart, valueEnd), quote, start, valueStart, valueEnd })
    index = valueEnd + 1
  }
}

/** 여는 tag 원문에서 attribute 값을 읽어 entity를 해석해 돌려준다. 없으면 undefined. */
export function readTagAttribute(tag: string, name: string): string | undefined {
  const attribute = parseTagAttributes(tag).find((candidate) => candidate.name === name)
  return attribute ? decodeXmlEntities(attribute.rawValue) : undefined
}

/**
 * 여는 tag 원문의 attribute 값을 바꾼다. 기존 attribute는 제자리에서 따옴표 종류를 유지한 채 값만 바꾸고,
 * 없으면 tag 끝(`>`·`/>` 앞 공백 앞)에 ` name="value"`를 덧붙인다. 값은 escape한다.
 * 나머지 원문(다른 attribute 표기·공백·순서)은 그대로 둔다.
 */
export function writeTagAttribute(tag: string, name: string, value: string): string {
  if (!/^[^\s=/>"'<]+$/.test(name)) throw new Error(`XML attribute 이름이 올바르지 않습니다: ${name}`)
  const attribute = parseTagAttributes(tag).find((candidate) => candidate.name === name)
  if (attribute) {
    return (
      tag.slice(0, attribute.valueStart) +
      escapeXmlAttribute(value, attribute.quote) +
      tag.slice(attribute.valueEnd)
    )
  }
  const tail = tag.match(/\s*\/?\s*>$/)![0]
  return `${tag.slice(0, tag.length - tail.length)} ${name}="${escapeXmlAttribute(value)}"${tail}`
}

/** element의 attribute 값(entity 해석). */
export function getSourceAttribute(tree: SourceTree, element: SourceElement, name: string): string | undefined {
  return readTagAttribute(elementOpenTag(tree, element), name)
}

/** element의 attribute 값을 바꾸고 dirty로 표시한다. 값이 같으면 아무것도 하지 않는다. */
export function setSourceAttribute(tree: SourceTree, element: SourceElement, name: string, value: string): void {
  const current = elementOpenTag(tree, element)
  const next = writeTagAttribute(current, name, value)
  if (next === current) return
  element.openTag = next
  markDirty(element)
}
