import { HwpxSourcePackage } from '../parser/source_package'
import { createEditorSelection, EditorSelection, normalizeEditorSelection } from './selection'
import { compareDocumentOrder } from './paragraph_patch'
import { packageEntryTree, putPackageTrees, takePackageTrees, withSerializedTree } from './package_trees'
import { isPlainSubList } from './paragraph_structure'
import {
  elementOpenTag,
  escapeXmlAttribute,
  findDescendantSourceElements,
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  readTagAttribute,
  replaceSourceNode,
  serializeSourceNode,
  setSourceAttribute,
  SourceElement,
  SourceNode,
  SourceTree,
  spliceSourceChildren,
  textRaw
} from './source_tree'
import {
  HwpxEditConflictError,
  HwpxLossReport,
  hwpxTextElementSource,
  hwpxTextOrdinal,
  invalidateHwpxTextIndex,
  listHwpxTextAnchors,
  locateHwpxTextElement,
  splitHwpxTextContent
} from './text_patch'
import { buildLossReport, isSurrogateBoundarySafe } from './xml_scan'

/**
 * 각주·미주 만들기·지우기 command.
 *
 * - `insert-footnote`: 각주를 둘 수 있는 문단(아래 "넣을 수 있는 자리")의 `hp:t` anchor 글자 사이(offset)에 각주 하나를 넣는다.
 *   그 `hp:t`를 둘로 나누고 사이에 한/글 저장본과 같은 모양의 `<hp:ctrl><hp:footNote>…</hp:footNote></hp:ctrl>`를 둔다. 새 각주
 *   본문은 번호 control(`hp:autoNum`)과 빈 `<hp:t/>`가 든 문단 하나다. 번호는 구역 각주 모양(`hp:footNotePr`)의 번호 매기기를
 *   따른다: 바로 앞 각주 번호 + 1(앞 각주가 없으면 시작 번호 `newNum`), 뒤 각주들은 `number`·`num`을 1씩 올린다. 이어
 *   매기기(`CONTINUOUS`)면 뒤 구역들의 각주도 올린다(새로 매기는 구역에서 멈춘다).
 * - `delete-footnote`: `${sectionPath}#hp:footNote:K`(section 안 각주 문서 순서) 각주를 지우고 뒤 각주 번호를 1씩 내린다.
 *   번호 control만 든 `hp:ctrl`이면 `hp:ctrl`째 지운다. 각주 뒤의 빈 `<hp:t/>` 같은 주변 node는 그대로 둔다.
 * - `insert-endnote`·`delete-endnote`(2026-10-20): 미주(`hp:endNote`, `#hp:endNote:K`)도 같은 방식이다. 번호는 구역 미주 모양
 *   (`hp:endNotePr`)을 따르고, 새 미주 본문 모양은 같은 section 미주 첫 문단, 없으면 header의 `미주` style이다. 미주 본문은 전처럼
 *   구역(문서) 끝 목록에 그린다.
 * - `restore-footnote`(inverse 전용): 각주·미주를 넣거나 지운 문단(section 안 `hp:p` 문서 순서 번호)의 원문을 바꾸기 전 원문으로
 *   되돌리고 다른 각주(`noteKind: 'endnote'`면 미주)의 번호 attribute를 되돌린다. 문단 원문과 번호 값이 지금 값과 같은지 먼저 확인한다.
 *
 * 넣을 수 있는 자리(2026-10-20, `noteHostViolation`): 본문 문단(`hs:sec` 직속), 표 셀 문단(깊이 무관), 글자(와 글자만 든 각주·미주)만
 * 든 글상자 문단이고, 셀·글상자를 거슬러 올라 본문 문단에 닿아야 한다. 머리말·꼬리말(한/글도 각주·미주 넣기를 막는다), 각주·미주
 * 본문, 메모·필드·캡션 안은 거부한다.
 *
 * 쪽마다 새로 매기기(`ON_PAGE`, 2026-10-20): 번호가 쪽 배치에 달려 있다. 한/글은 저장된 `number`·`num`이 아니라 번호 매기기 종류로
 * 열 때 번호를 다시 매기고(번호 매기기 종류를 잘못 쓴 저장본은 한/글이 이어 매긴 번호로 보인다), viewer도 쪽을 나눈 뒤 쪽마다 다시
 * 매긴다(`footnote_layout`). 그래서 새 각주에는 바로 앞 각주 번호 + 1(앞 각주가 다른 쪽이면 틀릴 수 있는 임시 값)을 쓰고, 다른
 * 각주 번호는 바꾸지 않는다.
 *
 * 손대지 않은 node는 원문 bytes 그대로이고, 새 node만 기본 표기로 쓴다. forward command는 package 상태만으로 결과가 정해진다
 * (`instId`도 section의 가장 큰 값 + 1) — 복구 기록 replay와 다시 실행이 같은 bytes를 만든다.
 */

export interface InsertFootnoteCommand {
  type: 'insert-footnote'
  sectionPath: string
  textNodeId: string
  offset: number
}

/** caret 자리에 미주 하나를 넣는다(각주와 같은 자리 규칙). */
export interface InsertEndnoteCommand {
  type: 'insert-endnote'
  sectionPath: string
  textNodeId: string
  offset: number
}

export interface DeleteFootnoteCommand {
  type: 'delete-footnote'
  sectionPath: string
  /** selection 기준 anchor(검증·기록용). 지울 각주는 `notePath`로 정한다. */
  textNodeId: string
  /** `${sectionPath}#hp:footNote:K` */
  notePath: string
}

/** `${sectionPath}#hp:endNote:K` 미주를 지운다. */
export interface DeleteEndnoteCommand {
  type: 'delete-endnote'
  sectionPath: string
  textNodeId: string
  /** `${sectionPath}#hp:endNote:K` */
  notePath: string
}

/** 다른 각주의 번호 attribute 하나를 바꾼다. index는 바꾸기 직전 상태(current)와 바꾼 뒤 상태(target)의 section 안 각주 순서다. */
export interface FootnoteNumberChange {
  sectionPath: string
  currentIndex: number
  targetIndex: number
  /** `number`는 `hp:footNote`, `num`은 그 각주 본문의 `hp:autoNum` attribute다. */
  attribute: 'number' | 'num'
  current: string
  target: string
}

export interface RestoreFootnoteCommand {
  type: 'restore-footnote'
  sectionPath: string
  textNodeId: string
  /** 되돌릴 문단의 section 안 `hp:p` 문서 순서 번호(각주 안 문단보다 앞이라 각주를 넣고 지워도 바뀌지 않는다). */
  paragraphOrdinal: number
  expectedFragment: string
  replacementFragment: string
  numbers: FootnoteNumberChange[]
  /** 미주를 넣거나 지운 경우. `numbers`의 index가 미주 순서다(없으면 각주). */
  noteKind?: 'endnote'
}

export type FootnoteCommand =
  | InsertFootnoteCommand
  | DeleteFootnoteCommand
  | InsertEndnoteCommand
  | DeleteEndnoteCommand
  | RestoreFootnoteCommand

export interface FootnotePatchResult {
  package: HwpxSourcePackage
  inverse: RestoreFootnoteCommand
  lossReport: HwpxLossReport
  changed: true
}

export interface InsertFootnotePlan {
  command: InsertFootnoteCommand
  /** 새 각주 본문의 빈 `hp:t` caret. */
  selectionAfter: EditorSelection
}

export interface InsertNotePlan {
  command: InsertFootnoteCommand | InsertEndnoteCommand
  selectionAfter: EditorSelection
}

export interface DeleteFootnotePlan {
  command: DeleteFootnoteCommand
  selectionAfter: EditorSelection
}

export interface DeleteNotePlan {
  command: DeleteFootnoteCommand | DeleteEndnoteCommand
  selectionAfter: EditorSelection
}

export type NoteKind = 'footnote' | 'endnote'

interface NoteKindSpec {
  element: 'hp:footNote' | 'hp:endNote'
  property: 'hp:footNotePr' | 'hp:endNotePr'
  numType: 'FOOTNOTE' | 'ENDNOTE'
  styleNames: readonly [string, string]
  label: string
}

const NOTE_KINDS: Readonly<Record<NoteKind, NoteKindSpec>> = {
  footnote: { element: 'hp:footNote', property: 'hp:footNotePr', numType: 'FOOTNOTE', styleNames: ['각주', 'Footnote'], label: '각주' },
  endnote: { element: 'hp:endNote', property: 'hp:endNotePr', numType: 'ENDNOTE', styleNames: ['미주', 'Endnote'], label: '미주' }
}

/** 각주·미주 command 종류(transaction·손실 정책이 같은 목록을 쓴다). */
export const NOTE_COMMAND_TYPES: ReadonlySet<string> = new Set([
  'insert-footnote', 'delete-footnote', 'insert-endnote', 'delete-endnote', 'restore-footnote'
])

export function isNoteCommand(command: { type: string }): command is FootnoteCommand {
  return NOTE_COMMAND_TYPES.has(command.type)
}

const SECTION_PATH = /^Contents\/section(\d+)\.xml$/
const HEADER_PATH = 'Contents/header.xml'
const DEFAULT_AUTO_NUM_FORMAT = '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
const NOTE_POSITION_MESSAGE = '각주·미주는 본문·표 셀·글상자 문단 글자 사이에만 넣을 수 있습니다.'
const HEADER_FOOTER_NOTE_MESSAGE = '머리말·꼬리말에는 각주·미주를 넣을 수 없습니다(한/글도 같습니다).'

export function footnotePath(sectionPath: string, index: number): string {
  return `${sectionPath}#hp:footNote:${index}`
}

export function endnotePath(sectionPath: string, index: number): string {
  return `${sectionPath}#hp:endNote:${index}`
}

function parseNotePath(sectionPath: string, notePath: string, kind: NoteKind): number | undefined {
  const prefix = `${sectionPath}#${NOTE_KINDS[kind].element}:`
  if (!notePath.startsWith(prefix)) return undefined
  const index = Number(notePath.slice(prefix.length))
  return Number.isSafeInteger(index) && index >= 0 && `${prefix}${index}` === notePath ? index : undefined
}

/** `${sectionPath}#hp:footNote:K`의 K. 형식이 다르면 undefined. */
export function parseFootnotePath(sectionPath: string, notePath: string): number | undefined {
  return parseNotePath(sectionPath, notePath, 'footnote')
}

/** `${sectionPath}#hp:endNote:K`의 K. 형식이 다르면 undefined. */
export function parseEndnotePath(sectionPath: string, notePath: string): number | undefined {
  return parseNotePath(sectionPath, notePath, 'endnote')
}

function sectionPathsOf(sourcePackage: HwpxSourcePackage): string[] {
  return sourcePackage.listEntries()
    .map((entry) => entry.path)
    .filter((path) => SECTION_PATH.test(path))
    .sort((a, b) => Number(a.match(SECTION_PATH)![1]) - Number(b.match(SECTION_PATH)![1]))
}

const elementChildren = (node: SourceElement, name: string): SourceElement[] =>
  node.children.filter((child): child is SourceElement => child.kind === 'element' && child.name === name)

interface SectionNumbering {
  type: 'CONTINUOUS' | 'ON_SECTION' | 'ON_PAGE'
  newNum: number
  /** 구역 각주(미주) 모양의 번호 모양 원문(`hp:autoNumFormat` 자기 닫힘 tag). */
  formatTag: string
  suffixChar: string
}

/**
 * 구역 정의(구역 첫 문단) 첫 `hp:footNotePr`(미주는 `hp:endNotePr`)의 번호 매기기. viewer decoder(`decodeFootnoteSettings`)와
 * 같은 곳을 읽는다.
 */
function sectionNumbering(tree: SourceTree, kind: NoteKind): SectionNumbering {
  const section = findSourceElements(tree, 'hs:sec')[0]
  const first = section ? elementChildren(section, 'hp:p')[0] : undefined
  const property = first ? findDescendantSourceElements(first, NOTE_KINDS[kind].property)[0] : undefined
  const numbering = property ? elementChildren(property, 'hp:numbering')[0] : undefined
  const format = property ? elementChildren(property, 'hp:autoNumFormat')[0] : undefined
  const type = numbering && getSourceAttribute(tree, numbering, 'type')
  const newNum = Math.trunc(Number(numbering && getSourceAttribute(tree, numbering, 'newNum')))
  const formatTag = format && !format.children.length
    ? elementOpenTag(tree, format).replace(/\s*\/?\s*>$/, '/>')
    : DEFAULT_AUTO_NUM_FORMAT
  return {
    type: type === 'ON_SECTION' || type === 'ON_PAGE' ? type : 'CONTINUOUS',
    newNum: Number.isFinite(newNum) && newNum >= 1 ? newNum : 1,
    formatTag,
    suffixChar: readTagAttribute(formatTag, 'suffixChar') ?? ')'
  }
}

/** 각주(미주)의 번호 attribute(`number`, 본문 첫 `hp:autoNum@num`). */
function numberTargets(tree: SourceTree, note: SourceElement): Array<{ element: SourceElement; attribute: 'number' | 'num'; value: string }> {
  const targets: Array<{ element: SourceElement; attribute: 'number' | 'num'; value: string }> = []
  const number = getSourceAttribute(tree, note, 'number')
  if (number !== undefined && /^\d+$/.test(number)) targets.push({ element: note, attribute: 'number', value: number })
  const autoNum = findDescendantSourceElements(note, 'hp:autoNum')[0]
  const num = autoNum && getSourceAttribute(tree, autoNum, 'num')
  if (autoNum && num !== undefined && /^\d+$/.test(num)) targets.push({ element: autoNum, attribute: 'num', value: num })
  return targets
}

/** 각주에 매긴 번호. `number`, 없으면 번호 control의 `num`. 읽을 수 없으면 undefined. */
function noteNumber(tree: SourceTree, note: SourceElement): number | undefined {
  const value = numberTargets(tree, note)[0]?.value
  return value === undefined ? undefined : Number(value)
}

interface SectionNotes {
  kind: NoteKind
  sectionPath: string
  tree: SourceTree
  notes: SourceElement[]
  numbering: SectionNumbering
}

function sectionNotes(sourcePackage: HwpxSourcePackage, sectionPath: string, kind: NoteKind): SectionNotes {
  const tree = packageEntryTree(sourcePackage, sectionPath)
  return { kind, sectionPath, tree, notes: findSourceElements(tree, NOTE_KINDS[kind].element), numbering: sectionNumbering(tree, kind) }
}

interface PlannedNumberChange {
  tree: SourceTree
  element: SourceElement
  attribute: 'number' | 'num'
  value: string
}

/**
 * 각주 하나를 넣거나(+1) 지운(-1) 뒤 다시 매겨야 하는 번호. 같은 section의 `fromIndex`부터 끝까지와, 이어 매기기면 뒤 section들의
 * 같은 종류 각주(새로 매기는 section에서 멈춘다)다. 반환하는 inverse 항목의 index는 바꾼 뒤 상태(current)와 바꾸기 전 상태(target)다.
 * 쪽마다 새로 매기기(`ON_PAGE`)는 다른 각주 번호를 바꾸지 않는다(한/글·viewer가 쪽마다 다시 매긴다).
 */
function planRenumber(
  sourcePackage: HwpxSourcePackage,
  current: SectionNotes,
  fromIndex: number,
  delta: 1 | -1
): { changes: PlannedNumberChange[]; inverse: FootnoteNumberChange[] } {
  const changes: PlannedNumberChange[] = []
  const inverse: FootnoteNumberChange[] = []
  if (current.numbering.type === 'ON_PAGE') return { changes, inverse }
  const shift = (scope: SectionNotes, from: number, indexShift: number) => {
    scope.notes.slice(from).forEach((note, offset) => {
      const index = from + offset
      for (const target of numberTargets(scope.tree, note)) {
        const next = String(Math.max(Number(target.value) + delta, 0))
        changes.push({ tree: scope.tree, element: target.element, attribute: target.attribute, value: next })
        inverse.push({
          sectionPath: scope.sectionPath,
          currentIndex: index + indexShift,
          targetIndex: index,
          attribute: target.attribute,
          current: next,
          target: target.value
        })
      }
    })
  }
  // 같은 section에서는 넣은(지운) 각주 하나만큼 뒤 각주 index도 밀린다.
  shift(current, fromIndex, delta)
  if (current.numbering.type === 'CONTINUOUS') {
    const paths = sectionPathsOf(sourcePackage)
    for (const path of paths.slice(paths.indexOf(current.sectionPath) + 1)) {
      const later = sectionNotes(sourcePackage, path, current.kind)
      if (later.numbering.type !== 'CONTINUOUS') break
      shift(later, 0, 0)
    }
  }
  return { changes, inverse }
}

/** section 안 `hp:p` 문서 순서 번호. */
function paragraphOrdinalOf(tree: SourceTree, paragraph: SourceElement): number {
  return findSourceElements(tree, 'hp:p').indexOf(paragraph)
}

const plainSubListAccess = (tree: SourceTree) => ({
  elementName: (node: SourceNode) => node.kind === 'element' ? node.name : undefined,
  children: (node: SourceNode) => node.kind === 'element' ? node.children : [],
  attribute: (node: SourceNode, name: string) => node.kind === 'element' ? getSourceAttribute(tree, node, name) : undefined
})

/**
 * 각주·미주 번호 표시를 둘 수 있는 문단인지. 본문 문단(`hs:sec` 직속)이거나, 표 셀(`hp:tc/hp:subList`)·글자만 든 글상자
 * (`hp:drawText/hp:subList`, 글자만 든 각주·미주는 품어도 된다) 문단을 거슬러 올라 본문 문단에 닿아야 한다. 아니면 거부 이유 message.
 */
export function noteHostViolation(tree: SourceTree, paragraph: SourceElement): string | undefined {
  let current: SourceElement = paragraph
  for (;;) {
    const scope = current.parent
    if (scope?.name === 'hs:sec') return undefined
    const host = scope?.name === 'hp:subList' ? scope.parent : undefined
    if (!scope || !host) return NOTE_POSITION_MESSAGE
    if (host.name === 'hp:header' || host.name === 'hp:footer') return HEADER_FOOTER_NOTE_MESSAGE
    if (host.name !== 'hp:tc' && host.name !== 'hp:drawText') return NOTE_POSITION_MESSAGE
    if (host.name === 'hp:drawText' && !isPlainSubList<SourceNode>(scope, plainSubListAccess(tree), true)) return NOTE_POSITION_MESSAGE
    const outer = nearestSourceAncestor(host, 'hp:p')
    if (!outer) return NOTE_POSITION_MESSAGE
    current = outer
  }
}

/** run에 바로 든 `hp:t`이고 그 문단이 각주·미주를 둘 수 있는 자리인지. 아니면 거부한다. */
function noteTextContext(tree: SourceTree, element: SourceElement): { run: SourceElement; paragraph: SourceElement } {
  const run = element.parent
  const paragraph = run?.parent
  if (run?.name !== 'hp:run' || paragraph?.name !== 'hp:p') throw new HwpxEditConflictError(NOTE_POSITION_MESSAGE)
  const violation = noteHostViolation(tree, paragraph)
  if (violation) throw new HwpxEditConflictError(violation)
  return { run, paragraph }
}

/**
 * 새 각주(미주) 본문 문단의 문단·글자 모양. 같은 section의 같은 종류 첫 문단, 없으면 header의 `각주`(`미주`) style, 없으면 번호
 * 표시가 든 문단 값을 쓴다.
 */
function noteParagraphStyle(
  sourcePackage: HwpxSourcePackage,
  scope: SectionNotes,
  near: SourceElement | undefined,
  hostParagraph: SourceElement,
  hostRun: SourceElement
): { paraPrIDRef: string; styleIDRef: string; charPrIDRef: string } {
  const { tree } = scope
  const sample = near ?? scope.notes[0]
  const sampleParagraph = sample ? findDescendantSourceElements(sample, 'hp:p')[0] : undefined
  const sampleRun = sampleParagraph ? elementChildren(sampleParagraph, 'hp:run')[0] : undefined
  if (sampleParagraph && sampleRun) {
    return {
      paraPrIDRef: getSourceAttribute(tree, sampleParagraph, 'paraPrIDRef') ?? '0',
      styleIDRef: getSourceAttribute(tree, sampleParagraph, 'styleIDRef') ?? '0',
      charPrIDRef: getSourceAttribute(tree, sampleRun, 'charPrIDRef') ?? '0'
    }
  }
  try {
    const header = packageEntryTree(sourcePackage, HEADER_PATH)
    const [name, engName] = NOTE_KINDS[scope.kind].styleNames
    const style = findSourceElements(header, 'hh:style').find((candidate) =>
      getSourceAttribute(header, candidate, 'name') === name || getSourceAttribute(header, candidate, 'engName') === engName
    )
    const id = style && getSourceAttribute(header, style, 'id')
    const paraPrIDRef = style && getSourceAttribute(header, style, 'paraPrIDRef')
    const charPrIDRef = style && getSourceAttribute(header, style, 'charPrIDRef')
    if (id !== undefined && paraPrIDRef !== undefined && charPrIDRef !== undefined) return { paraPrIDRef, styleIDRef: id, charPrIDRef }
  } catch {
    // header.xml이 없거나 읽을 수 없으면 번호 표시가 든 문단 값을 쓴다.
  }
  return {
    paraPrIDRef: getSourceAttribute(tree, hostParagraph, 'paraPrIDRef') ?? '0',
    styleIDRef: '0',
    charPrIDRef: getSourceAttribute(tree, hostRun, 'charPrIDRef') ?? '0'
  }
}

/** section의 각주·미주 `instId` 가운데 가장 큰 값 + 1(없으면 1). 같은 package에서 언제나 같은 값이다. */
function nextInstId(tree: SourceTree): string {
  let maximum = 0
  for (const name of ['hp:footNote', 'hp:endNote']) {
    for (const element of findSourceElements(tree, name)) {
      const value = Number(getSourceAttribute(tree, element, 'instId'))
      if (Number.isSafeInteger(value) && value > maximum) maximum = value
    }
  }
  return String(maximum + 1)
}

function noteXml(
  kind: NoteKind,
  number: number,
  numbering: SectionNumbering,
  instId: string,
  style: { paraPrIDRef: string; styleIDRef: string; charPrIDRef: string }
): string {
  const attribute = (value: string) => escapeXmlAttribute(value)
  const suffixCode = numbering.suffixChar ? numbering.suffixChar.codePointAt(0)! : 41
  const { element, numType } = NOTE_KINDS[kind]
  return `<hp:ctrl><${element} number="${number}" suffixChar="${suffixCode}" instId="${attribute(instId)}">` +
    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
    `<hp:p id="0" paraPrIDRef="${attribute(style.paraPrIDRef)}" styleIDRef="${attribute(style.styleIDRef)}" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${attribute(style.charPrIDRef)}"><hp:ctrl><hp:autoNum num="${number}" numType="${numType}">${numbering.formatTag}</hp:autoNum></hp:ctrl><hp:t/></hp:run>` +
    `</hp:p></hp:subList></${element}></hp:ctrl>`
}

/** 각주 하나를 넣기 전 앞 각주 번호. 같은 section 앞 각주, 이어 매기기면 앞 section들의 마지막 각주, 없으면 시작 번호 - 1. */
function previousNumber(sourcePackage: HwpxSourcePackage, scope: SectionNotes, index: number): number {
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const value = noteNumber(scope.tree, scope.notes[candidate])
    if (value !== undefined) return value
  }
  if (index > 0) return scope.numbering.newNum - 1 + index
  if (scope.numbering.type === 'CONTINUOUS') {
    const paths = sectionPathsOf(sourcePackage)
    for (const path of paths.slice(0, paths.indexOf(scope.sectionPath)).reverse()) {
      const earlier = sectionNotes(sourcePackage, path, scope.kind)
      for (let candidate = earlier.notes.length - 1; candidate >= 0; candidate -= 1) {
        const value = noteNumber(earlier.tree, earlier.notes[candidate])
        if (value !== undefined) return value
      }
    }
  }
  return scope.numbering.newNum - 1
}

function assertOffset(text: string, offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length || !isSurrogateBoundarySafe(text, offset)) {
    throw new HwpxEditConflictError(`각주·미주를 넣을 글자 위치가 올바르지 않습니다: ${offset}`)
  }
}

/**
 * caret 자리에 각주(미주)를 넣는 계획. caret은 각주·미주를 둘 수 있는 문단(`noteHostViolation`)의 실제 `hp:t` anchor여야 한다.
 * 새 본문의 빈 `hp:t`는 나뉜 앞 `hp:t` 바로 다음 순번이므로 적용하지 않고 selection을 정한다.
 */
function planInsertNote(sourcePackage: HwpxSourcePackage, selection: EditorSelection, kind: NoteKind): InsertNotePlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (normalized.start.textNodeId !== normalized.end.textNodeId || normalized.start.offset !== normalized.end.offset) {
    throw new HwpxEditConflictError(`${NOTE_KINDS[kind].label}는 선택 범위가 아닌 caret 위치에만 넣을 수 있습니다.`)
  }
  const located = locateHwpxTextElement(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  if (!located) throw new HwpxEditConflictError(NOTE_POSITION_MESSAGE)
  noteTextContext(located.tree, located.element)
  assertOffset(located.anchor.text, normalized.start.offset)
  return {
    command: {
      type: kind === 'footnote' ? 'insert-footnote' : 'insert-endnote',
      sectionPath: selection.sectionPath,
      textNodeId: located.anchor.textNodeId,
      offset: normalized.start.offset
    },
    selectionAfter: createEditorSelection(selection.sectionPath, `${selection.sectionPath}#hp:t:${located.anchor.ordinal + 1}`, 0)
  }
}

export function planInsertFootnote(sourcePackage: HwpxSourcePackage, selection: EditorSelection): InsertFootnotePlan {
  return planInsertNote(sourcePackage, selection, 'footnote') as InsertFootnotePlan
}

export function planInsertEndnote(sourcePackage: HwpxSourcePackage, selection: EditorSelection): InsertNotePlan {
  return planInsertNote(sourcePackage, selection, 'endnote')
}

export function applyInsertFootnoteCommand(
  sourcePackage: HwpxSourcePackage,
  command: InsertFootnoteCommand | InsertEndnoteCommand
): FootnotePatchResult {
  if (command.type !== 'insert-footnote' && command.type !== 'insert-endnote') throw new Error('지원하지 않는 각주 command입니다.')
  const kind: NoteKind = command.type === 'insert-footnote' ? 'footnote' : 'endnote'
  listHwpxTextAnchors(sourcePackage, command.sectionPath)
  const located = locateHwpxTextElement(sourcePackage, command.sectionPath, command.textNodeId)
  if (!located) throw new HwpxEditConflictError(`${NOTE_KINDS[kind].label}를 넣을 text anchor를 찾을 수 없습니다: ${command.textNodeId}`)
  const host = noteTextContext(located.tree, located.element)
  assertOffset(located.anchor.text, command.offset)
  const scope = sectionNotes(sourcePackage, command.sectionPath, kind)
  const { tree } = scope
  const textNode = located.element
  const index = scope.notes.filter((note) => compareDocumentOrder(note, textNode) < 0).length
  const number = previousNumber(sourcePackage, scope, index) + 1
  const style = noteParagraphStyle(sourcePackage, scope, scope.notes[index - 1] ?? scope.notes[index], host.paragraph, host.run)
  const { before, after } = splitHwpxTextContent(tree, textNode, command.offset)
  const fragment = hwpxTextElementSource(tree, textNode, before) +
    noteXml(kind, number, scope.numbering, nextInstId(tree), style) +
    (after ? `<hp:t>${after}</hp:t>` : '<hp:t/>')
  const nodes = parseSourceFragment(fragment)
  const renumber = planRenumber(sourcePackage, scope, index, 1)
  const paragraphOrdinal = paragraphOrdinalOf(tree, host.paragraph)
  const expectedFragment = serializeSourceNode(tree, host.paragraph)

  // 검증·계획을 모두 끝낸 뒤 cache를 떼어 내고 tree를 제자리에서 고친다(다른 section tree도 위에서 이미 cache에 있다).
  const trees = takePackageTrees(sourcePackage)
  for (const change of renumber.changes) setSourceAttribute(change.tree, change.element, change.attribute, change.value)
  replaceSourceNode(tree, textNode, nodes)
  invalidateHwpxTextIndex(tree)
  const { package: nextPackage, modifiedEntries } = commitSections(sourcePackage, trees, [command.sectionPath, ...renumber.changes.map((change) => sectionPathOfTree(trees, change.tree))])
  return {
    package: nextPackage,
    inverse: {
      type: 'restore-footnote',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      paragraphOrdinal,
      expectedFragment: serializeSourceNode(tree, host.paragraph),
      replacementFragment: expectedFragment,
      numbers: renumber.inverse,
      ...(kind === 'endnote' ? { noteKind: 'endnote' as const } : {})
    },
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

/** 번호 표시가 든 문단. 각주·미주를 둘 수 있는 자리(`noteHostViolation`)가 아니면 거부한다. */
function hostParagraph(tree: SourceTree, note: SourceElement, label: string): SourceElement {
  const paragraph = nearestSourceAncestor(note, 'hp:p')
  if (!paragraph || noteHostViolation(tree, paragraph)) {
    throw new HwpxEditConflictError(`본문·표 셀·글상자 문단에 든 ${label}만 지울 수 있습니다.`)
  }
  return paragraph
}

/** selection anchor 기준으로 각주(미주) 하나를 지우는 계획. 지운 뒤 caret은 각주가 있던 자리(앞 글자 끝 또는 뒤 글자 처음)다. */
function planDeleteNote(sourcePackage: HwpxSourcePackage, selection: EditorSelection, notePath: string, kind: NoteKind): DeleteNotePlan {
  const { sectionPath } = selection
  const label = NOTE_KINDS[kind].label
  const index = parseNotePath(sectionPath, notePath, kind)
  const scope = sectionNotes(sourcePackage, sectionPath, kind)
  const note = index === undefined ? undefined : scope.notes[index]
  if (!note) throw new HwpxEditConflictError(`지울 ${label}를 찾을 수 없습니다: ${notePath}`)
  const paragraph = hostParagraph(scope.tree, note, label)
  const anchors = listHwpxTextAnchors(sourcePackage, sectionPath)
  const texts = new Set(findDescendantSourceElements(paragraph, 'hp:t').filter((text) => nearestSourceAncestor(text, 'hp:p') === paragraph))
  const ordinals = anchors.filter((anchor) => texts.has(locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!.element))
  const noteTexts = findDescendantSourceElements(note, 'hp:t').length
  const before = ordinals.filter((anchor) => compareDocumentOrder(locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!.element, note) < 0)
  const after = ordinals.filter((anchor) => compareDocumentOrder(locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!.element, note) > 0)
  const selectionAfter = before.length
    ? createEditorSelection(sectionPath, before[before.length - 1].textNodeId, before[before.length - 1].text.length)
    : after.length
      ? createEditorSelection(sectionPath, `${sectionPath}#hp:t:${after[0].ordinal - noteTexts}`, 0)
      : undefined
  if (!selectionAfter) throw new HwpxEditConflictError(`${label} 앞뒤에 글자 칸이 없는 문단의 ${label}는 아직 지울 수 없습니다.`)
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  return {
    command: { type: kind === 'footnote' ? 'delete-footnote' : 'delete-endnote', sectionPath, textNodeId: normalized.start.textNodeId, notePath },
    selectionAfter
  }
}

export function planDeleteFootnote(sourcePackage: HwpxSourcePackage, selection: EditorSelection, notePath: string): DeleteFootnotePlan {
  return planDeleteNote(sourcePackage, selection, notePath, 'footnote') as DeleteFootnotePlan
}

export function planDeleteEndnote(sourcePackage: HwpxSourcePackage, selection: EditorSelection, notePath: string): DeleteNotePlan {
  return planDeleteNote(sourcePackage, selection, notePath, 'endnote')
}

export function applyDeleteFootnoteCommand(
  sourcePackage: HwpxSourcePackage,
  command: DeleteFootnoteCommand | DeleteEndnoteCommand
): FootnotePatchResult {
  if (command.type !== 'delete-footnote' && command.type !== 'delete-endnote') throw new Error('지원하지 않는 각주 command입니다.')
  const kind: NoteKind = command.type === 'delete-footnote' ? 'footnote' : 'endnote'
  const label = NOTE_KINDS[kind].label
  listHwpxTextAnchors(sourcePackage, command.sectionPath)
  const index = parseNotePath(command.sectionPath, command.notePath, kind)
  const scope = sectionNotes(sourcePackage, command.sectionPath, kind)
  const note = index === undefined ? undefined : scope.notes[index]
  if (!note || index === undefined) throw new HwpxEditConflictError(`지울 ${label}를 찾을 수 없습니다: ${command.notePath}`)
  const { tree } = scope
  const paragraph = hostParagraph(tree, note, label)
  // 번호 control만 든 `hp:ctrl`이면 `hp:ctrl`째 지운다(공백 text만 함께 있어도 같다).
  const control = note.parent?.name === 'hp:ctrl' &&
    note.parent.children.every((child) => child === note || (child.kind === 'text' && !textRaw(tree, child).trim()))
    ? note.parent
    : note
  const container = control.parent
  if (!container) throw new HwpxEditConflictError(`지울 ${label}의 위치가 올바르지 않습니다.`)
  const renumber = planRenumber(sourcePackage, scope, index + 1, -1)
  const paragraphOrdinal = paragraphOrdinalOf(tree, paragraph)
  const expectedFragment = serializeSourceNode(tree, paragraph)

  const trees = takePackageTrees(sourcePackage)
  for (const change of renumber.changes) setSourceAttribute(change.tree, change.element, change.attribute, change.value)
  spliceSourceChildren(tree, container, container.children.indexOf(control as SourceNode), 1, [])
  invalidateHwpxTextIndex(tree)
  const { package: nextPackage, modifiedEntries } = commitSections(sourcePackage, trees, [command.sectionPath, ...renumber.changes.map((change) => sectionPathOfTree(trees, change.tree))])
  return {
    package: nextPackage,
    inverse: {
      type: 'restore-footnote',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      paragraphOrdinal,
      expectedFragment: serializeSourceNode(tree, paragraph),
      replacementFragment: expectedFragment,
      numbers: renumber.inverse,
      ...(kind === 'endnote' ? { noteKind: 'endnote' as const } : {})
    },
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function applyRestoreFootnoteCommand(sourcePackage: HwpxSourcePackage, command: RestoreFootnoteCommand): FootnotePatchResult {
  if (command.type !== 'restore-footnote') throw new Error('지원하지 않는 각주 복원 command입니다.')
  const conflict = () => new HwpxEditConflictError('각주·미주가 변경되어 안전하게 되돌릴 수 없습니다.')
  if (command.noteKind !== undefined && command.noteKind !== 'endnote') throw conflict()
  const noteElement = NOTE_KINDS[command.noteKind ?? 'footnote'].element
  listHwpxTextAnchors(sourcePackage, command.sectionPath)
  const tree = packageEntryTree(sourcePackage, command.sectionPath)
  const paragraph = findSourceElements(tree, 'hp:p')[command.paragraphOrdinal]
  if (!paragraph?.parent || serializeSourceNode(tree, paragraph) !== command.expectedFragment) throw conflict()
  let replacement: SourceNode[]
  try {
    replacement = parseSourceFragment(command.replacementFragment)
  } catch {
    throw conflict()
  }
  if (replacement.length !== 1 || replacement[0].kind !== 'element' || replacement[0].name !== 'hp:p') throw conflict()
  const changes = command.numbers.map((change) => {
    if (!SECTION_PATH.test(change.sectionPath)) throw conflict()
    const changeTree = packageEntryTree(sourcePackage, change.sectionPath)
    const note = findSourceElements(changeTree, noteElement)[change.currentIndex]
    const element = change.attribute === 'number' ? note : note && findDescendantSourceElements(note, 'hp:autoNum')[0]
    if (!element || getSourceAttribute(changeTree, element, change.attribute) !== change.current || !/^\d+$/.test(change.target)) throw conflict()
    return { tree: changeTree, element, change }
  })

  const trees = takePackageTrees(sourcePackage)
  for (const { tree: changeTree, element, change } of changes) setSourceAttribute(changeTree, element, change.attribute, change.target)
  const parent = paragraph.parent
  spliceSourceChildren(tree, parent, parent.children.indexOf(paragraph), 1, replacement)
  invalidateHwpxTextIndex(tree)
  const { package: nextPackage, modifiedEntries } = commitSections(sourcePackage, trees, [command.sectionPath, ...command.numbers.map((change) => change.sectionPath)])
  return {
    package: nextPackage,
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment,
      numbers: command.numbers.map((change) => ({
        ...change,
        currentIndex: change.targetIndex,
        targetIndex: change.currentIndex,
        current: change.target,
        target: change.current
      }))
    },
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function applyFootnoteCommand(sourcePackage: HwpxSourcePackage, command: FootnoteCommand): FootnotePatchResult {
  if (command.type === 'insert-footnote' || command.type === 'insert-endnote') return applyInsertFootnoteCommand(sourcePackage, command)
  if (command.type === 'delete-footnote' || command.type === 'delete-endnote') return applyDeleteFootnoteCommand(sourcePackage, command)
  return applyRestoreFootnoteCommand(sourcePackage, command)
}

function sectionPathOfTree(trees: Map<string, SourceTree>, tree: SourceTree): string {
  for (const [path, candidate] of trees) if (candidate === tree) return path
  throw new Error('각주 번호를 바꾼 section tree를 찾을 수 없습니다.')
}

/** 고친 section tree를 문서 순서로 직렬화해 새 package를 만들고 cache를 옮긴다. */
function commitSections(
  sourcePackage: HwpxSourcePackage,
  trees: Map<string, SourceTree>,
  paths: readonly string[]
): { package: HwpxSourcePackage; modifiedEntries: string[] } {
  const modifiedEntries = sectionPathsOf(sourcePackage).filter((path) => paths.includes(path))
  let nextPackage = sourcePackage
  for (const path of modifiedEntries) nextPackage = withSerializedTree(nextPackage, path, trees.get(path)!)
  putPackageTrees(nextPackage, trees)
  return { package: nextPackage, modifiedEntries }
}

/**
 * 같은 문단 안 여러 run 범위 치환이 지울 각주·미주(범위의 시작 `hp:t`와 끝 `hp:t` 사이에 번호 표시가 있고, 각주·미주를 둘 수 있는
 * 문단에 든 것). 종류마다 index가 큰 것부터다(앞 각주 index가 바뀌지 않게).
 */
export function notesWithinSelection(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  startTextNodeId: string,
  endTextNodeId: string
): Array<{ kind: NoteKind; notePath: string }> {
  const start = locateHwpxTextElement(sourcePackage, sectionPath, startTextNodeId)?.element
  const end = locateHwpxTextElement(sourcePackage, sectionPath, endTextNodeId)?.element
  if (!start || !end || start === end) return []
  const paragraph = nearestSourceAncestor(start, 'hp:p')
  if (!paragraph || nearestSourceAncestor(end, 'hp:p') !== paragraph) return []
  const tree = packageEntryTree(sourcePackage, sectionPath)
  if (noteHostViolation(tree, paragraph)) return []
  return (['footnote', 'endnote'] as const).flatMap((kind) => findSourceElements(tree, NOTE_KINDS[kind].element)
    .map((note, index) => ({ note, index }))
    .filter(({ note }) => nearestSourceAncestor(note, 'hp:p') === paragraph && compareDocumentOrder(start, note) < 0 && compareDocumentOrder(note, end) < 0)
    .map(({ index }) => ({ kind, notePath: kind === 'footnote' ? footnotePath(sectionPath, index) : endnotePath(sectionPath, index) }))
    .reverse())
}

/** @internal test·coverage용: 새 각주(미주) 본문 `hp:t`의 anchor id(적용 결과 package 기준). */
export function insertedFootnoteTextNodeId(nextPackage: HwpxSourcePackage, sectionPath: string, notePath: string): string | undefined {
  const kind: NoteKind = parseEndnotePath(sectionPath, notePath) !== undefined ? 'endnote' : 'footnote'
  const index = parseNotePath(sectionPath, notePath, kind)
  const note = index === undefined ? undefined : findSourceElements(packageEntryTree(nextPackage, sectionPath), NOTE_KINDS[kind].element)[index]
  const text = note && findDescendantSourceElements(note, 'hp:t')[0]
  const ordinal = text ? hwpxTextOrdinal(nextPackage, sectionPath, text) : -1
  return ordinal >= 0 ? `${sectionPath}#hp:t:${ordinal}` : undefined
}
