import { HwpxSourcePackage } from '../parser/source_package'
import {
  HwpxEditConflictError,
  HwpxLossReport,
  invalidateHwpxTextIndex,
  listHwpxTextAnchors,
  locateHwpxEmptyParagraph,
  locateHwpxTextElement
} from './text_patch'
import { isEmptyParagraphAnchorId } from './empty_paragraph_anchor'
import { packageEntryTree, PackageTrees, putPackageTrees, takePackageTrees, withSerializedTree } from './package_trees'
import {
  elementCloseTag,
  elementOpenTag,
  escapeXmlAttribute,
  findDescendantSourceElements,
  findFirstSourceElement,
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  parseSourceTree,
  rawTextOffset,
  readTagAttribute,
  replaceSourceNode,
  serializeSourceNode,
  serializeSourceTree,
  setElementOpenTag,
  setSourceAttribute,
  SourceElement,
  SourceNode,
  SourceTree,
  spliceSourceChildren,
  textRaw,
  writeTagAttribute
} from './source_tree'
import { buildLossReport, findTagEnd, isSurrogateBoundarySafe } from './xml_scan'

/**
 * 글자·문단 모양 command.
 *
 * section·header.xml을 package별 source tree cache(`package_trees.ts`)에서 읽는다. anchor의 `hp:t`에서 부모를 따라
 * `hp:run`·`hp:p`를 찾고, `charPrIDRef`/`paraPrIDRef`는 따옴표를 인식하는 tree attribute API로 바꾼다. 새 definition은
 * 원본 `hh:charPr`/`hh:paraPr`을 조각 tree로 복제해 자식 추가·삭제와 attribute 변경으로 고친 뒤, header tree의 collection
 * 끝에 붙이고 `itemCnt`를 갱신한다. 손대지 않은 byte는 원문 그대로이고, inverse는 바꾼 tag·조각 원문을 들고 있어
 * byte 단위로 되돌린다.
 */

const HEADER_PATH = 'Contents/header.xml'

export type ParagraphAlignment = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY'

export interface ApplyCharacterStyleCommand {
  type: 'apply-character-style'
  sectionPath: string
  textNodeId: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikeout?: boolean
  height?: number
  color?: string
  fontId?: string
  from?: number
  to?: number
}

export interface ApplyParagraphStyleCommand {
  type: 'apply-paragraph-style'
  sectionPath: string
  textNodeId: string
  align?: ParagraphAlignment
  lineSpacing?: number
  indent?: number
  marginBefore?: number
  marginAfter?: number
}

interface HeaderStyleMutation {
  headerPath: string
  collectionName: 'hh:charProperties' | 'hh:paraProperties'
  expectedCollectionOpenTag: string
  replacementCollectionOpenTag: string
  fragment: string
  action: 'insert' | 'remove'
}

export interface RestoreStyleCommand {
  type: 'restore-style'
  target: 'character' | 'paragraph'
  sectionPath: string
  textNodeId: string
  expectedReferenceTag: string
  replacementReferenceTag: string
  headerMutation?: HeaderStyleMutation
}

export interface RestoreCharacterRunCommand {
  type: 'restore-character-run'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
  headerMutation?: HeaderStyleMutation
}

export type StyleEditCommand =
  | ApplyCharacterStyleCommand
  | ApplyParagraphStyleCommand
  | RestoreStyleCommand
  | RestoreCharacterRunCommand

export interface StylePatchResult {
  package: HwpxSourcePackage
  inverse?: RestoreStyleCommand | RestoreCharacterRunCommand
  lossReport: HwpxLossReport
  changed: boolean
}

interface TextStyleContext {
  tree: SourceTree
  /** 빈 문단 합성 anchor의 문단 style이면 없다. */
  textNode?: SourceElement
  run?: SourceElement
  paragraph: SourceElement
}

interface StyleDefinition {
  id: string
  element: SourceElement
}

interface StyleCollection {
  element: SourceElement
  definitions: StyleDefinition[]
}

/** 복제한 definition 조각. `tree.children`은 `[element]`이고 원본 header tree와 독립적으로 고친다. */
interface DefinitionDraft {
  tree: SourceTree
  element: SourceElement
}

function locateTextStyleContext(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string,
  target: 'character' | 'paragraph'
): TextStyleContext {
  // 목록 조회는 section 경로 검증과 오류 message를 전환 전과 같게 유지한다(cache된 tree를 쓰므로 다시 parse하지 않는다).
  listHwpxTextAnchors(sourcePackage, sectionPath)
  if (isEmptyParagraphAnchorId(textNodeId)) {
    // 빈 문단 합성 anchor: 문단 모양만 바꾼다. 글자 모양은 첫 글자를 입력해 `hp:t`가 생긴 뒤 바꾼다.
    if (target === 'character') {
      throw new HwpxEditConflictError('빈 문단은 글자를 입력한 뒤 글자 모양을 바꿀 수 있습니다.')
    }
    const empty = locateHwpxEmptyParagraph(sourcePackage, sectionPath, textNodeId)
    if (!empty) throw new HwpxEditConflictError(`style anchor를 찾을 수 없습니다: ${textNodeId}`)
    if (!isStyleEditableParagraph(empty.paragraph)) {
      throw new HwpxEditConflictError('글자·문단 모양은 최상위 문단과 최상위 표 셀 직속 문단의 run만 편집할 수 있습니다.')
    }
    return { tree: empty.tree, paragraph: empty.paragraph, run: empty.run }
  }
  const located = locateHwpxTextElement(sourcePackage, sectionPath, textNodeId)
  if (!located) throw new HwpxEditConflictError(`style anchor를 찾을 수 없습니다: ${textNodeId}`)
  const { tree, element: textNode } = located
  const run = nearestSourceAncestor(textNode, 'hp:run')
  const paragraph = nearestSourceAncestor(textNode, 'hp:p')
  if (!run || !paragraph || run.parent !== paragraph || !isStyleEditableParagraph(paragraph)) {
    throw new HwpxEditConflictError('글자·문단 모양은 최상위 문단과 최상위 표 셀 직속 문단의 run만 편집할 수 있습니다.')
  }
  if (target === 'character') {
    const descendants = findAllDescendantElements(run)
    if (descendants.filter((element) => element.name === 'hp:t').length !== 1 || descendants.some((element) => element.name !== 'hp:t')) {
      throw new HwpxEditConflictError('복합 run은 아직 style을 편집할 수 없습니다.')
    }
  }
  return { tree, textNode, run, paragraph }
}

/**
 * style command를 받는 문단 위치. `hs:sec` 직속 문단, 또는 최상위 문단에 든 표(`hs:sec > hp:p > hp:run > hp:tbl`)의
 * 셀 `hp:subList` 직속 문단이다. 병합·머리글 셀도 포함한다. 셀 안에 다시 든 표, 글상자·머리말 같은 다른 subList는 제외한다.
 */
function isStyleEditableParagraph(paragraph: SourceElement): boolean {
  const scope = paragraph.parent
  if (scope?.name === 'hs:sec') return true
  if (scope?.name !== 'hp:subList') return false
  const cell = scope.parent
  const row = cell?.parent
  const table = row?.parent
  const hostRun = table?.parent
  const hostParagraph = hostRun?.parent
  return (
    cell?.name === 'hp:tc' &&
    row?.name === 'hp:tr' &&
    table?.name === 'hp:tbl' &&
    hostRun?.name === 'hp:run' &&
    hostParagraph?.name === 'hp:p' &&
    hostParagraph.parent?.name === 'hs:sec'
  )
}

/** 글자 모양은 run, 문단 모양은 문단의 reference attribute를 바꾼다. 글자 모양 context에는 언제나 run이 있다. */
function referenceElementOf(context: TextStyleContext, target: 'character' | 'paragraph'): SourceElement {
  if (target === 'paragraph') return context.paragraph
  if (!context.run) throw new HwpxEditConflictError('글자 모양을 바꿀 run이 없습니다.')
  return context.run
}

function findAllDescendantElements(node: SourceElement): SourceElement[] {
  const result: SourceElement[] = []
  const visit = (children: readonly SourceNode[]): void => {
    for (const child of children) {
      if (child.kind !== 'element') continue
      result.push(child)
      visit(child.children)
    }
  }
  visit(node.children)
  return result
}

function directChildElements(parent: SourceElement, name: string): SourceElement[] {
  return parent.children.filter(
    (child): child is SourceElement => child.kind === 'element' && child.name === name
  )
}

function styleCollection(
  headerTree: SourceTree,
  collectionName: 'hh:charProperties' | 'hh:paraProperties',
  definitionName: 'hh:charPr' | 'hh:paraPr'
): StyleCollection {
  const collection = findSourceElements(headerTree, collectionName)[0]
  if (!collection) throw new HwpxEditConflictError(`HWPX style collection이 없습니다: ${collectionName}`)
  const definitions = directChildElements(collection, definitionName).map((element) => {
    const id = getSourceAttribute(headerTree, element, 'id')
    if (id === undefined) throw new HwpxEditConflictError(`${definitionName} ID가 없습니다.`)
    return { id, element }
  })
  if (!definitions.length) throw new HwpxEditConflictError(`${definitionName} definition이 없습니다.`)
  return { element: collection, definitions }
}

/** definition의 비교용 표기: `id`를 자리표시자로 바꾸고 tag 사이 공백을 없앤다. */
function definitionSignature(xml: string): string {
  const openEnd = findTagEnd(xml, 0)
  const openTag = writeTagAttribute(xml.slice(0, openEnd), 'id', '__HAN_FLOW_STYLE_ID__')
  return (openTag + xml.slice(openEnd)).replace(/>\s+</g, '><').trim()
}

/**
 * header tree의 definition element별 비교 표기 cache. definition element는 제자리에서 바뀌지 않으므로(복제본만 고치고,
 * 추가·삭제는 node 단위) element 객체를 key로 쓴다. 연속 style 명령이 definition 전체를 매번 다시 비교하지 않게 한다.
 */
const signatures = new WeakMap<SourceElement, string>()

function storedDefinitionSignature(tree: SourceTree, element: SourceElement): string {
  let signature = signatures.get(element)
  if (signature === undefined) {
    signature = definitionSignature(serializeSourceNode(tree, element))
    signatures.set(element, signature)
  }
  return signature
}

function nextStyleId(definitions: readonly StyleDefinition[]): string {
  const ids = new Set(definitions.map((definition) => definition.id))
  const numeric = definitions
    .map((definition) => Number(definition.id))
    .filter((id) => Number.isSafeInteger(id) && id >= 0)
  let next = numeric.length ? Math.max(...numeric) + 1 : 0
  while (ids.has(String(next))) next += 1
  return String(next)
}

function updateCollectionCount(openTag: string, nextCount: number): string {
  return readTagAttribute(openTag, 'itemCnt') === undefined
    ? openTag
    : writeTagAttribute(openTag, 'itemCnt', String(nextCount))
}

function createDraft(xml: string): DefinitionDraft {
  const tree = parseSourceTree(xml)
  const element = tree.children[0]
  if (tree.children.length !== 1 || element.kind !== 'element') throw new Error('style definition 원문이 올바르지 않습니다.')
  return { tree, element }
}

/**
 * OWPML 자식 순서(`order`)를 따라 `xml` 조각을 넣는다. `name`보다 뒤에 와야 하는 이름 가운데 definition 안에서
 * 문서 순서로 처음 나오는 element 바로 앞에 넣고, 없으면 definition 끝에 붙인다. 넣은 첫 element를 돌려준다.
 */
function insertOrderedChild(draft: DefinitionDraft, order: readonly string[], name: string, xml: string): SourceElement {
  const nodes = parseSourceFragment(xml)
  const index = order.indexOf(name)
  let parent = draft.element
  let position = draft.element.children.length
  for (const later of order.slice(index + 1)) {
    const found = findFirstSourceElement(draft.element, `hh:${later}`)
    if (found) {
      parent = found.parent!
      position = parent.children.indexOf(found)
      break
    }
  }
  spliceSourceChildren(draft.tree, parent, position, 0, nodes)
  return nodes[0] as SourceElement
}

function removeSourceElements(draft: DefinitionDraft, name: string): void {
  for (const element of findDescendantSourceElements(draft.element, name)) replaceSourceNode(draft.tree, element, [])
}

const characterChildOrder = [
  'fontRef', 'ratio', 'spacing', 'relSz', 'offset', 'italic', 'bold', 'underline',
  'strikeout', 'outline', 'shadow', 'emboss', 'engrave', 'supscript', 'subscript'
]

function setEmptyCharacterChild(draft: DefinitionDraft, name: 'italic' | 'bold', enabled: boolean): void {
  removeSourceElements(draft, `hh:${name}`)
  if (enabled) insertOrderedChild(draft, characterChildOrder, name, `<hh:${name}/>`)
}

function setLineDecoration(draft: DefinitionDraft, name: 'underline' | 'strikeout', enabled: boolean): void {
  const existing = findFirstSourceElement(draft.element, `hh:${name}`)
  if (existing) {
    if (name === 'underline') {
      setSourceAttribute(draft.tree, existing, 'type', enabled ? 'BOTTOM' : 'NONE')
      if (enabled) setSourceAttribute(draft.tree, existing, 'shape', 'SOLID')
    } else {
      setSourceAttribute(draft.tree, existing, 'shape', enabled ? 'SOLID' : 'NONE')
    }
    return
  }
  if (!enabled) return
  const fragment = name === 'underline'
    ? '<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>'
    : '<hh:strikeout shape="SOLID" color="#000000"/>'
  insertOrderedChild(draft, characterChildOrder, name, fragment)
}

function setCharacterStyleAttributes(
  draft: DefinitionDraft,
  options: Pick<ApplyCharacterStyleCommand, 'height' | 'color'>
): void {
  if (options.height !== undefined) setSourceAttribute(draft.tree, draft.element, 'height', String(options.height))
  if (options.color !== undefined) setSourceAttribute(draft.tree, draft.element, 'textColor', options.color.toUpperCase())
}

function hangulFontIds(headerTree: SourceTree): Set<string> {
  const fontface = findSourceElements(headerTree, 'hh:fontface').find(
    (element) => getSourceAttribute(headerTree, element, 'lang') === 'HANGUL'
  )
  if (!fontface) return new Set()
  return new Set(
    directChildElements(fontface, 'hh:font')
      .map((font) => getSourceAttribute(headerTree, font, 'id'))
      .filter((id): id is string => id !== undefined)
  )
}

function setCharacterFontRef(draft: DefinitionDraft, fontId?: string): void {
  if (fontId === undefined) return
  const existing = findFirstSourceElement(draft.element, 'hh:fontRef')
  if (existing) {
    setSourceAttribute(draft.tree, existing, 'hangul', fontId)
    return
  }
  insertOrderedChild(draft, characterChildOrder, 'fontRef', `<hh:fontRef hangul="${escapeXmlAttribute(fontId)}"/>`)
}

const paragraphChildOrder = ['align', 'heading', 'breakSetting', 'margin', 'lineSpacing', 'border', 'autoSpacing']

function setAlignment(draft: DefinitionDraft, align: ParagraphAlignment): void {
  const existing = findFirstSourceElement(draft.element, 'hh:align')
  if (existing) setSourceAttribute(draft.tree, existing, 'horizontal', align)
  else insertOrderedChild(draft, paragraphChildOrder, 'align', `<hh:align horizontal="${align}"/>`)
}

const DEFAULT_MARGIN =
  '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/>' +
  '<hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>'

function setHwpValueElement(draft: DefinitionDraft, margin: SourceElement, name: 'intent' | 'prev' | 'next', value: number): void {
  const existing = findFirstSourceElement(margin, `hc:${name}`)
  if (existing) {
    setSourceAttribute(draft.tree, existing, 'value', String(value))
    setSourceAttribute(draft.tree, existing, 'unit', 'HWPUNIT')
    return
  }
  spliceSourceChildren(draft.tree, margin, margin.children.length, 0, parseSourceFragment(
    `<hc:${name} value="${value}" unit="HWPUNIT"/>`
  ))
}

function setParagraphMetrics(
  draft: DefinitionDraft,
  options: Pick<ApplyParagraphStyleCommand, 'lineSpacing' | 'indent' | 'marginBefore' | 'marginAfter'>
): void {
  if (options.indent !== undefined || options.marginBefore !== undefined || options.marginAfter !== undefined) {
    const existing = findDescendantSourceElements(draft.element, 'hh:margin')
    const margins = existing.length
      ? existing
      : [insertOrderedChild(draft, paragraphChildOrder, 'margin', DEFAULT_MARGIN)]
    for (const margin of margins) {
      // command 값은 실제 HWPUNIT. HwpUnitChar `hp:case` 밖(직접 `hh:margin`·`hp:default`)은 2배로 적는다.
      const scale = margin.parent?.name === 'hp:case' ? 1 : 2
      if (options.indent !== undefined) setHwpValueElement(draft, margin, 'intent', options.indent * scale)
      if (options.marginBefore !== undefined) setHwpValueElement(draft, margin, 'prev', options.marginBefore * scale)
      if (options.marginAfter !== undefined) setHwpValueElement(draft, margin, 'next', options.marginAfter * scale)
    }
  }
  if (options.lineSpacing !== undefined) {
    const existing = findFirstSourceElement(draft.element, 'hh:lineSpacing')
    if (existing) {
      setSourceAttribute(draft.tree, existing, 'type', 'PERCENT')
      setSourceAttribute(draft.tree, existing, 'value', String(options.lineSpacing))
      setSourceAttribute(draft.tree, existing, 'unit', 'HWPUNIT')
    } else {
      insertOrderedChild(
        draft,
        paragraphChildOrder,
        'lineSpacing',
        `<hh:lineSpacing type="PERCENT" value="${options.lineSpacing}" unit="HWPUNIT"/>`
      )
    }
  }
}

function paragraphStructure(tree: SourceTree, element: SourceElement): string {
  const heading = findFirstSourceElement(element, 'hh:heading')
  return JSON.stringify([
    getSourceAttribute(tree, element, 'tabPrIDRef') ?? null,
    heading ? serializeSourceNode(tree, heading) : null
  ])
}

function assertParagraphStructurePreserved(before: DefinitionDraft, after: DefinitionDraft): void {
  if (paragraphStructure(before.tree, before.element) !== paragraphStructure(after.tree, after.element)) {
    throw new HwpxEditConflictError('문단 모양 변경 중 탭 또는 목록 구조가 달라져 적용을 중단했습니다.')
  }
}

/** collection의 마지막 definition 뒤 공백(새 definition 뒤에도 같은 들여쓰기를 둔다). 공백이 아니면 빈 문자열. */
function insertionGap(headerTree: SourceTree, collection: StyleCollection): string {
  const last = collection.definitions[collection.definitions.length - 1].element
  const children = collection.element.children
  const gap = children
    .slice(children.indexOf(last) + 1)
    .map((node) => serializeSourceNode(headerTree, node))
    .join('')
  return /^\s*$/.test(gap) ? gap : ''
}

function noChange(sourcePackage: HwpxSourcePackage): StylePatchResult {
  return {
    package: sourcePackage,
    lossReport: buildLossReport(sourcePackage, []),
    changed: false
  }
}

/** tree에 바로 적용할 수 있게 검증을 끝낸 header definition 추가·제거. */
interface HeaderTreeChange {
  tree: SourceTree
  apply: () => void
}

/** 편집한 tree를 새 package에 쓰는 단계. header를 먼저, section을 다음에 쓴다(전환 전 revision 순서와 같다). */
function commitTrees(
  sourcePackage: HwpxSourcePackage,
  trees: PackageTrees,
  sectionPath: string,
  sectionTree: SourceTree,
  headerTree: SourceTree | undefined
): { package: HwpxSourcePackage; modifiedEntries: string[] } {
  let nextPackage = sourcePackage
  const modifiedEntries: string[] = []
  if (headerTree) {
    nextPackage = withSerializedTree(nextPackage, HEADER_PATH, headerTree)
    modifiedEntries.push(HEADER_PATH)
  }
  nextPackage = withSerializedTree(nextPackage, sectionPath, sectionTree)
  modifiedEntries.push(sectionPath)
  putPackageTrees(nextPackage, trees)
  return { package: nextPackage, modifiedEntries }
}

interface StagedStyle {
  context: TextStyleContext
  trees: PackageTrees
  headerTree?: SourceTree
  referenceTag: string
  nextReferenceTag: string
  headerMutation?: HeaderStyleMutation
}

/**
 * 원본 definition을 복제해 `mutate`로 고치고, 같은 definition이 있으면 재사용하고 없으면 collection 끝에 붙인 뒤
 * run·문단의 reference attribute를 바꾼다. 모든 검증을 마친 뒤 tree cache를 떼어 내고 tree를 고친다.
 * 바뀔 것이 없으면 undefined.
 */
function stageStyleDefinition(
  sourcePackage: HwpxSourcePackage,
  options: {
    sectionPath: string
    textNodeId: string
    target: 'character' | 'paragraph'
    collectionName: 'hh:charProperties' | 'hh:paraProperties'
    definitionName: 'hh:charPr' | 'hh:paraPr'
    referenceAttribute: 'charPrIDRef' | 'paraPrIDRef'
    mutate: (draft: DefinitionDraft) => void
  }
): StagedStyle | undefined {
  const context = locateTextStyleContext(sourcePackage, options.sectionPath, options.textNodeId, options.target)
  const sectionTree = context.tree
  const referenceElement = referenceElementOf(context, options.target)
  const referenceTag = elementOpenTag(sectionTree, referenceElement)
  const currentId = getSourceAttribute(sectionTree, referenceElement, options.referenceAttribute)
  if (currentId === undefined) {
    throw new HwpxEditConflictError(`${options.referenceAttribute}가 없는 문단은 아직 편집할 수 없습니다.`)
  }

  const headerTree = packageEntryTree(sourcePackage, HEADER_PATH)
  const collection = styleCollection(headerTree, options.collectionName, options.definitionName)
  const base = collection.definitions.find((definition) => definition.id === currentId)
  if (!base) {
    throw new HwpxEditConflictError(`${options.definitionName} reference를 찾을 수 없습니다: ${currentId}`)
  }
  const draft = createDraft(serializeSourceNode(headerTree, base.element))
  options.mutate(draft)
  const mutatedSignature = definitionSignature(serializeSourceTree(draft.tree))
  if (mutatedSignature === storedDefinitionSignature(headerTree, base.element)) return undefined

  const equivalent = collection.definitions.find(
    (definition) => storedDefinitionSignature(headerTree, definition.element) === mutatedSignature
  )
  let nextId: string
  let headerChange: (() => void) | undefined
  let headerMutation: HeaderStyleMutation | undefined
  if (equivalent) {
    nextId = equivalent.id
  } else {
    nextId = nextStyleId(collection.definitions)
    setSourceAttribute(draft.tree, draft.element, 'id', nextId)
    const fragment = serializeSourceTree(draft.tree) + insertionGap(headerTree, collection)
    const collectionOpenTag = elementOpenTag(headerTree, collection.element)
    const nextCollectionOpenTag = updateCollectionCount(collectionOpenTag, collection.definitions.length + 1)
    const nodes = parseSourceFragment(fragment)
    headerChange = () => {
      setElementOpenTag(headerTree, collection.element, nextCollectionOpenTag)
      spliceSourceChildren(headerTree, collection.element, collection.element.children.length, 0, nodes)
    }
    headerMutation = {
      headerPath: HEADER_PATH,
      collectionName: options.collectionName,
      expectedCollectionOpenTag: nextCollectionOpenTag,
      replacementCollectionOpenTag: collectionOpenTag,
      fragment,
      action: 'remove'
    }
  }
  const nextReferenceTag = writeTagAttribute(referenceTag, options.referenceAttribute, nextId)

  const trees = takePackageTrees(sourcePackage)
  headerChange?.()
  setElementOpenTag(sectionTree, referenceElement, nextReferenceTag)
  return {
    context,
    trees,
    headerTree: headerChange ? headerTree : undefined,
    referenceTag,
    nextReferenceTag,
    headerMutation
  }
}

export function applyCharacterStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyCharacterStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-character-style') throw new Error('지원하지 않는 글자 style command입니다.')
  if (
    command.bold === undefined && command.italic === undefined && command.underline === undefined &&
    command.strikeout === undefined && command.height === undefined && command.color === undefined &&
    command.fontId === undefined
  ) {
    throw new Error('적용할 글자 style 값이 없습니다.')
  }
  if (command.bold !== undefined && typeof command.bold !== 'boolean') {
    throw new Error('굵게 style 값이 올바르지 않습니다.')
  }
  for (const [label, value] of [
    ['기울임', command.italic],
    ['밑줄', command.underline],
    ['취소선', command.strikeout]
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} style 값이 올바르지 않습니다.`)
  }
  if (
    command.height !== undefined &&
    (!Number.isInteger(command.height) || command.height < 500 || command.height > 7200)
  ) {
    throw new Error('글자 크기는 5pt에서 72pt 사이여야 합니다.')
  }
  if (command.color !== undefined && !/^#[\da-f]{6}$/i.test(command.color)) {
    throw new Error('글자 색상은 #RRGGBB 형식이어야 합니다.')
  }
  if (command.fontId !== undefined) {
    if (!command.fontId || !hangulFontIds(
      packageEntryTree(sourcePackage, HEADER_PATH)
    ).has(command.fontId)) {
      throw new Error('문서에 선언되지 않은 한글 글꼴은 적용할 수 없습니다.')
    }
  }
  if (isEmptyParagraphAnchorId(command.textNodeId)) {
    throw new HwpxEditConflictError('빈 문단은 글자를 입력한 뒤 글자 모양을 바꿀 수 있습니다.')
  }
  const anchor = listHwpxTextAnchors(sourcePackage, command.sectionPath).find(
    (candidate) => candidate.textNodeId === command.textNodeId
  )
  if (!anchor) throw new HwpxEditConflictError(`style anchor를 찾을 수 없습니다: ${command.textNodeId}`)
  const from = command.from ?? 0
  const to = command.to ?? anchor.text.length
  for (const offset of [from, to]) {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > anchor.text.length ||
      !isSurrogateBoundarySafe(anchor.text, offset)
    ) {
      throw new HwpxEditConflictError(`글자 style 범위가 올바르지 않습니다: ${offset}`)
    }
  }
  if (from > to) throw new HwpxEditConflictError('글자 style 범위의 시작이 끝보다 큽니다.')

  const staged = stageStyleDefinition(sourcePackage, {
    ...command,
    target: 'character',
    collectionName: 'hh:charProperties',
    definitionName: 'hh:charPr',
    referenceAttribute: 'charPrIDRef',
    mutate: (draft) => {
      if (command.italic !== undefined) setEmptyCharacterChild(draft, 'italic', command.italic)
      if (command.bold !== undefined) setEmptyCharacterChild(draft, 'bold', command.bold)
      if (command.underline !== undefined) setLineDecoration(draft, 'underline', command.underline)
      if (command.strikeout !== undefined) setLineDecoration(draft, 'strikeout', command.strikeout)
      setCharacterStyleAttributes(draft, command)
      setCharacterFontRef(draft, command.fontId)
    }
  })
  if (!staged) return noChange(sourcePackage)
  const { context, trees } = staged
  const sectionTree = context.tree
  const partial = from !== to && !(from === 0 && to === anchor.text.length)
  if (!partial) {
    const committed = commitTrees(sourcePackage, trees, command.sectionPath, sectionTree, staged.headerTree)
    return {
      package: committed.package,
      inverse: {
        type: 'restore-style',
        target: 'character',
        sectionPath: command.sectionPath,
        textNodeId: command.textNodeId,
        expectedReferenceTag: staged.nextReferenceTag,
        replacementReferenceTag: staged.referenceTag,
        headerMutation: staged.headerMutation
      },
      lossReport: buildLossReport(sourcePackage, committed.modifiedEntries),
      changed: true
    }
  }

  // 부분 선택: reference를 바꾼 run을 좌·선택·우 run으로 나눈다. 전환 전 경로와 같게 reference 변경과 분할을
  // 서로 다른 revision으로 쓴다(header → section reference → section 분할).
  const run = referenceElementOf(context, 'character')
  const textNode = context.textNode!
  const styledRun = serializeSourceNode(sectionTree, run)
  const originalRun = staged.referenceTag + styledRun.slice(staged.nextReferenceTag.length)
  const index = run.children.indexOf(textNode)
  const serializeNodes = (nodes: readonly SourceNode[]): string =>
    nodes.map((node) => serializeSourceNode(sectionTree, node)).join('')
  const beforeText = serializeNodes(run.children.slice(0, index)) + elementOpenTag(sectionTree, textNode)
  const afterText = elementCloseTag(sectionTree, textNode) + serializeNodes(run.children.slice(index + 1)) +
    elementCloseTag(sectionTree, run)
  // 자른 조각은 원문 표기(entity 포함)를 그대로 쓴다. 선택 경계는 surrogate 검사를 통과했으므로 entity 경계다.
  const raw = textNode.children
    .map((node) => {
      if (node.kind !== 'text') throw new HwpxEditConflictError('복합 run은 아직 style을 편집할 수 없습니다.')
      return textRaw(sectionTree, node)
    })
    .join('')
  const cutFrom = rawTextOffset(raw, from)
  const cutTo = rawTextOffset(raw, to)
  const withText = (piece: string, openTag: string): string => openTag + beforeText + piece + afterText
  const fragments: string[] = []
  if (from > 0) fragments.push(withText(raw.slice(0, cutFrom), staged.referenceTag))
  fragments.push(withText(raw.slice(cutFrom, cutTo), staged.nextReferenceTag))
  if (to < anchor.text.length) fragments.push(withText(raw.slice(cutTo), staged.referenceTag))
  const splitFragment = fragments.join('')

  let nextPackage = sourcePackage
  const modifiedEntries: string[] = []
  if (staged.headerTree) {
    nextPackage = withSerializedTree(nextPackage, HEADER_PATH, staged.headerTree)
    modifiedEntries.push(HEADER_PATH)
  }
  nextPackage = withSerializedTree(nextPackage, command.sectionPath, sectionTree)
  modifiedEntries.push(command.sectionPath)
  replaceSourceNode(sectionTree, run, parseSourceFragment(splitFragment))
  invalidateHwpxTextIndex(sectionTree)
  nextPackage = withSerializedTree(nextPackage, command.sectionPath, sectionTree)
  putPackageTrees(nextPackage, trees)
  return {
    package: nextPackage,
    inverse: {
      type: 'restore-character-run',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedFragment: splitFragment,
      replacementFragment: originalRun,
      headerMutation: staged.headerMutation
    },
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function applyParagraphStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyParagraphStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-paragraph-style') throw new Error('지원하지 않는 문단 style command입니다.')
  if (
    command.align === undefined && command.lineSpacing === undefined && command.indent === undefined &&
    command.marginBefore === undefined && command.marginAfter === undefined
  ) {
    throw new Error('적용할 문단 style 값이 없습니다.')
  }
  if (command.align !== undefined && !(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'] as const).includes(command.align)) {
    throw new Error('문단 정렬 style 값이 올바르지 않습니다.')
  }
  if (
    command.lineSpacing !== undefined &&
    (!Number.isInteger(command.lineSpacing) || command.lineSpacing < 100 || command.lineSpacing > 300)
  ) {
    throw new Error('줄 간격은 100%에서 300% 사이여야 합니다.')
  }
  for (const [label, value] of [
    ['문단 앞 간격', command.marginBefore],
    ['문단 뒤 간격', command.marginAfter]
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 7200)) {
      throw new Error(`${label}은 0pt에서 72pt 사이여야 합니다.`)
    }
  }
  if (
    command.indent !== undefined &&
    (!Number.isInteger(command.indent) || command.indent < -7200 || command.indent > 7200)
  ) {
    throw new Error('첫 줄 들여쓰기는 -72pt에서 72pt 사이여야 합니다.')
  }
  const staged = stageStyleDefinition(sourcePackage, {
    ...command,
    target: 'paragraph',
    collectionName: 'hh:paraProperties',
    definitionName: 'hh:paraPr',
    referenceAttribute: 'paraPrIDRef',
    mutate: (draft) => {
      const before = createDraft(serializeSourceTree(draft.tree))
      if (command.align !== undefined) setAlignment(draft, command.align)
      setParagraphMetrics(draft, command)
      assertParagraphStructurePreserved(before, draft)
    }
  })
  if (!staged) return noChange(sourcePackage)
  const committed = commitTrees(sourcePackage, staged.trees, command.sectionPath, staged.context.tree, staged.headerTree)
  return {
    package: committed.package,
    inverse: {
      type: 'restore-style',
      target: 'paragraph',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedReferenceTag: staged.nextReferenceTag,
      replacementReferenceTag: staged.referenceTag,
      headerMutation: staged.headerMutation
    },
    lossReport: buildLossReport(sourcePackage, committed.modifiedEntries),
    changed: true
  }
}

/**
 * inverse의 header definition 추가·제거를 검증하고 tree에 적용할 함수를 만든다. 제거는 collection 끝의 원문이
 * `fragment`와 byte 단위로 같아야 하고, 추가는 `fragment`를 collection 끝에 붙인다.
 */
function planHeaderStyleMutation(
  sourcePackage: HwpxSourcePackage,
  mutation?: HeaderStyleMutation
): (HeaderTreeChange & { inverse: HeaderStyleMutation }) | undefined {
  if (!mutation) return undefined
  const tree = packageEntryTree(sourcePackage, mutation.headerPath)
  const collection = styleCollection(
    tree,
    mutation.collectionName,
    mutation.collectionName === 'hh:charProperties' ? 'hh:charPr' : 'hh:paraPr'
  ).element
  if (elementOpenTag(tree, collection) !== mutation.expectedCollectionOpenTag) {
    throw new HwpxEditConflictError('style collection count가 변경되어 안전하게 복원할 수 없습니다.')
  }
  let change: () => void
  if (mutation.action === 'remove') {
    const children = collection.children
    let tail = ''
    let start = children.length
    while (start > 0 && tail.length < mutation.fragment.length) {
      start -= 1
      tail = serializeSourceNode(tree, children[start]) + tail
    }
    const excess = tail.length - mutation.fragment.length
    const first = children[start]
    if (!tail.endsWith(mutation.fragment) || (excess > 0 && first.kind !== 'text')) {
      throw new HwpxEditConflictError('추가한 style definition이 변경되어 안전하게 제거할 수 없습니다.')
    }
    // 조각이 공백 text node 중간에서 시작하면 그 앞부분은 남긴다.
    const kept = excess > 0 ? parseSourceFragment(tail.slice(0, excess)) : []
    change = () => {
      setElementOpenTag(tree, collection, mutation.replacementCollectionOpenTag)
      spliceSourceChildren(tree, collection, start, children.length - start, kept)
    }
  } else {
    const nodes = parseSourceFragment(mutation.fragment)
    change = () => {
      setElementOpenTag(tree, collection, mutation.replacementCollectionOpenTag)
      spliceSourceChildren(tree, collection, collection.children.length, 0, nodes)
    }
  }
  return {
    tree,
    apply: change,
    inverse: {
      ...mutation,
      expectedCollectionOpenTag: mutation.replacementCollectionOpenTag,
      replacementCollectionOpenTag: mutation.expectedCollectionOpenTag,
      action: mutation.action === 'remove' ? 'insert' : 'remove'
    }
  }
}

export function applyRestoreStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreStyleCommand
): StylePatchResult {
  if (command.type !== 'restore-style') throw new Error('지원하지 않는 style 복원 command입니다.')
  const context = locateTextStyleContext(
    sourcePackage,
    command.sectionPath,
    command.textNodeId,
    command.target
  )
  const referenceElement = referenceElementOf(context, command.target)
  if (elementOpenTag(context.tree, referenceElement) !== command.expectedReferenceTag) {
    throw new HwpxEditConflictError('style reference가 변경되어 안전하게 복원할 수 없습니다.')
  }
  const header = planHeaderStyleMutation(sourcePackage, command.headerMutation)

  const trees = takePackageTrees(sourcePackage)
  header?.apply()
  setElementOpenTag(context.tree, referenceElement, command.replacementReferenceTag)
  const committed = commitTrees(sourcePackage, trees, command.sectionPath, context.tree, header?.tree)
  return {
    package: committed.package,
    inverse: {
      ...command,
      expectedReferenceTag: command.replacementReferenceTag,
      replacementReferenceTag: command.expectedReferenceTag,
      headerMutation: header?.inverse
    },
    lossReport: buildLossReport(sourcePackage, committed.modifiedEntries),
    changed: true
  }
}

export function applyRestoreCharacterRunCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreCharacterRunCommand
): StylePatchResult {
  if (command.type !== 'restore-character-run') {
    throw new Error('지원하지 않는 글자 run 복원 command입니다.')
  }
  const context = locateTextStyleContext(
    sourcePackage,
    command.sectionPath,
    command.textNodeId,
    'character'
  )
  // anchor run부터 이어지는 형제의 원문이 `expectedFragment`로 시작해야 한다(분할된 run 셋 또는 원래 run 하나).
  const siblings = context.paragraph.children
  const start = siblings.indexOf(referenceElementOf(context, 'character'))
  let actual = ''
  let end = start
  while (end < siblings.length && actual.length < command.expectedFragment.length) {
    actual += serializeSourceNode(context.tree, siblings[end])
    end += 1
  }
  const excess = actual.length - command.expectedFragment.length
  if (!actual.startsWith(command.expectedFragment) || excess < 0 || (excess > 0 && siblings[end - 1].kind !== 'text')) {
    throw new HwpxEditConflictError('분할된 글자 run이 변경되어 안전하게 복원할 수 없습니다.')
  }
  const replacement = parseSourceFragment(
    command.replacementFragment + (excess > 0 ? actual.slice(actual.length - excess) : '')
  )
  const header = planHeaderStyleMutation(sourcePackage, command.headerMutation)

  const trees = takePackageTrees(sourcePackage)
  header?.apply()
  spliceSourceChildren(context.tree, context.paragraph, start, end - start, replacement)
  invalidateHwpxTextIndex(context.tree)
  const committed = commitTrees(sourcePackage, trees, command.sectionPath, context.tree, header?.tree)
  return {
    package: committed.package,
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment,
      headerMutation: header?.inverse
    },
    lossReport: buildLossReport(sourcePackage, committed.modifiedEntries),
    changed: true
  }
}
