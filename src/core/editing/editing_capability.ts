import {
  isObjectPlaceholder,
  ViewerDocument,
  ViewerParagraph,
  ViewerSection,
  ViewerTable,
  ViewerTableCell,
  ViewerText
} from '../document/viewer_document'
import { isEmptyParagraphAnchorId, isTableCaretAnchorId } from './empty_paragraph_anchor'
import type { ParagraphStructureBlock } from './paragraph_structure'
import { EditorSelection } from './selection'
import { isSurrogateBoundarySafe } from './xml_scan'

/**
 * - `TOP_LEVEL_TEXT`: 구역 본문 문단(표만 든 문단의 표 앞·뒤 글자 포함)
 * - `TABLE_CELL_TEXT`: 최상위 표의 셀 문단
 * - `NOTE_TEXT`: 쪽 아래 각주와 구역 끝 미주 목록의 본문 문단
 * - `HEADER_FOOTER_TEXT`: 머리말·꼬리말 문단
 * - `TEXT_BOX_TEXT`: 글자만 든 글상자(도형 글 `hp:drawText`) 문단
 * - `MEMO_TEXT`: 글자만 든 메모 본문 문단
 * 각주·미주·머리말·꼬리말·글상자 문단은 글자 입력·삭제·치환, 글자·문단 모양, 문단 구조 규칙(`paragraph_structure.ts`)을 통과한
 * 문단의 Enter·경계 병합을 허용한다(각주·미주 첫 문단은 번호 control이 든 run도 나눈다). 범위 선택은 문단 하나 안이다. 메모 본문은
 * 글자 입력·삭제·치환과 글자·문단 모양만 허용한다(문단 나눔·병합은 막는다).
 */
export type EditingStructure = 'TOP_LEVEL_TEXT' | 'TABLE_CELL_TEXT' | SublistStructure
/** subList 문단 구조(각주·미주, 머리말·꼬리말, 글상자, 메모). 문단마다 범위 scope를 따로 둔다. */
export type SublistStructure = 'NOTE_TEXT' | 'HEADER_FOOTER_TEXT' | 'TEXT_BOX_TEXT' | 'MEMO_TEXT'
export type EditingCapabilityReason =
  | 'NO_SELECTION'
  | 'STALE_SELECTION'
  | 'CROSS_STRUCTURE_SELECTION'
  | 'MULTI_RUN_SELECTION'
  | 'MULTI_PARAGRAPH_SELECTION'
  | 'TABLE_CELL_STRUCTURE'
  | 'EMPTY_PARAGRAPH'
  /** 문단에 수식·글상자·그림·구역 정의·제어 같은 개체가 있어 문단 나눔·병합·여러 문단 범위를 할 수 없다. */
  | 'PARAGRAPH_HAS_OBJECT'
  /** 문단 run 구조(빈 run, run 하나에 글자 칸 여러 개 등)가 문단 나눔·병합·여러 문단 범위 규칙을 벗어난다. */
  | 'PARAGRAPH_COMPLEX_RUN'
  /** 표가 든 본문 문단의 표 앞·뒤 글자. 글자 입력·삭제만 하고 글자 모양·문단 나눔은 막는다(표 앞·뒤 caret은 문단 모양도 막는다). */
  | 'TABLE_PARAGRAPH'
  /** 메모 본문 문단. 글자 입력·삭제·치환과 글자·문단 모양만 한다(문단 나눔·병합은 막는다). */
  | 'SUBLIST_TEXT'
  /**
   * 각주·미주는 본문 문단(표가 든 문단 제외)·표 셀 문단·글상자 문단 글자 사이의 접힌 caret에만 넣는다(각주·미주·메모 본문 안은 막는다).
   */
  | 'FOOTNOTE_POSITION'
  /** 머리말·꼬리말(그 안 글상자 포함)에는 각주·미주를 넣지 않는다(한/글도 막는다). */
  | 'NOTE_IN_HEADER_FOOTER'

export interface EditingCapabilityState {
  available: boolean
  reason?: EditingCapabilityReason
}

export interface EditingAnchorContext {
  sectionPath: string
  textNodeId: string
  text: string
  charStyleId: string
  paraStyleId: string
  paragraphId: string
  rangeScope: string
  structure: EditingStructure
  cellStyleId?: string
  /**
   * 표 셀 text에서만 쓴다. true면 행·열·병합·분할·셀 style·문단 나눔 같은 구조 command를 허용하는 셀이다.
   * false면 병합·머리글 셀이거나 문단에 run이 여러 개인 셀이라 text 입력·삭제·치환과 글자·문단 모양만 허용한다.
   */
  cellStructureEditable?: boolean
  /**
   * `hp:t`가 없는 빈 문단의 합성 anchor(`#hp:p:N:empty`)이면 true. text 입력과 문단 모양만 허용하고, 첫 입력이
   * `hp:t`를 만든 뒤에는 일반 anchor로 바뀐다.
   */
  emptyParagraph?: boolean
  /** 표가 든 본문 문단(`table_caret.ts`)의 글자 anchor이면 true. */
  tableParagraph?: boolean
  /** 쪽 아래 각주 본문 문단이면 그 각주 경로(`${sectionPath}#hp:footNote:K`). 각주 지우기 대상이다. */
  footnotePath?: string
  /** 구역 끝 미주 본문 문단이면 그 미주 경로(`${sectionPath}#hp:endNote:K`). 미주 지우기 대상이다. */
  endnotePath?: string
  /** 이 문단 caret에 각주·미주를 넣을 수 없는 이유(subList 문단). 본문·표 셀 문단은 `editingCapabilities`가 정한다. */
  noteBlock?: EditingCapabilityReason
  /** 그 가운데 글자가 아직 없는 표 앞·뒤 합성 anchor(`#hp:p:N:table-before|after`)이면 true. */
  tableCaret?: boolean
  /**
   * 이 anchor가 든 문단의 문단 구조 command 차단 이유. `split`은 Enter 분할·여러 문단 범위, `mergePrevious`·`mergeNext`는
   * 문단 맨 앞 Backspace·맨 끝 Delete 병합(인접 문단 포함)이다. 편집 코어와 같은 규칙(`paragraph_structure.ts`)을 쓴다.
   */
  structureGate?: ParagraphStructureGate
}

export interface ParagraphStructureGate {
  split?: EditingCapabilityReason
  mergePrevious?: EditingCapabilityReason
  mergeNext?: EditingCapabilityReason
}

export interface EditingCapabilities {
  selection: EditingCapabilityState
  text: EditingCapabilityState
  characterStyle: EditingCapabilityState
  paragraphStyle: EditingCapabilityState
  paragraphStructure: EditingCapabilityState
  cellStyle: EditingCapabilityState
  /** caret 자리에 각주 만들기(`footnote_patch.ts`). 지우기는 `focus.footnotePath`가 있는 각주 본문이나 번호 표시를 품은 범위에서 한다. */
  footnote: EditingCapabilityState
  /** caret 자리에 미주 만들기. 자리 규칙은 각주와 같고, 지우기는 `focus.endnotePath`가 있는 미주 본문에서 한다. */
  endnote: EditingCapabilityState
  focus?: EditingAnchorContext
}

export type EditingSelectionProjectionStatus =
  | 'CURRENT'
  | 'CLAMPED'
  | 'COLLAPSED'
  | 'CLEARED'

export interface EditingSelectionProjection {
  selection?: EditorSelection
  status: EditingSelectionProjectionStatus
}

function editableTexts(paragraph: ViewerParagraph): ViewerText[] | undefined {
  // 개체 자리 표시는 읽기 전용 표시일 뿐이라 같은 문단 글자 run의 편집 가능 여부에 끼지 않는다.
  const content = paragraph.content.filter((item) => !isObjectPlaceholder(item))
  if (!content.length) return undefined
  if (!content.every((item) => item.type === 'text' && Boolean(item.sourceAnchor))) {
    return undefined
  }
  return content as ViewerText[]
}

/**
 * 표가 든 본문 문단의 글자 run. 자리 표시를 뺀 content가 표 하나와 source anchor가 있는 글자(표 앞·뒤 합성 caret 포함)뿐이어야
 * 한다. 표 셀은 따로(`tableContexts`) 다룬다. 아니면 undefined.
 */
export function tableParagraphTexts(paragraph: ViewerParagraph): ViewerText[] | undefined {
  const content = paragraph.content.filter((item) => !isObjectPlaceholder(item))
  const tables = content.filter((item) => item.type === 'table')
  if (tables.length !== 1) return undefined
  const texts = content.filter((item) => item.type !== 'table')
  if (!texts.length || !texts.every((item) => item.type === 'text' && Boolean(item.sourceAnchor))) return undefined
  return texts as ViewerText[]
}

/** 표가 든 본문 문단의 글자 run마다 따로 쓰는 범위 scope. 표를 사이에 둔 앞·뒤 글자를 한 범위로 묶지 않는다. */
export function tableParagraphRangeScope(sectionPath: string, paragraphId: string, index: number): string {
  return `${sectionPath}:table-paragraph:${paragraphId}:${index}`
}

const SUBLIST_SCOPE_NAMES: Readonly<Record<SublistStructure, string>> = {
  NOTE_TEXT: 'note',
  HEADER_FOOTER_TEXT: 'header-footer',
  TEXT_BOX_TEXT: 'text-box',
  MEMO_TEXT: 'memo'
}

/** 각주·미주·머리말·꼬리말·글상자·메모 문단의 범위 scope(문단 하나). */
export function sublistParagraphRangeScope(sectionPath: string, structure: SublistStructure, paragraphId: string): string {
  return `${sectionPath}:${SUBLIST_SCOPE_NAMES[structure]}:${paragraphId}`
}

/** 메모 본문 문단 gate: 글자만 고치고 문단 나눔·병합은 막는다. */
const MEMO_STRUCTURE_GATE: ParagraphStructureGate = { split: 'SUBLIST_TEXT', mergePrevious: 'SUBLIST_TEXT', mergeNext: 'SUBLIST_TEXT' }

/**
 * subList 하나(각주 하나, 머리말 하나, 글상자 하나, 메모 하나)의 문단마다 문단 구조 gate와 범위 scope. gate는 본문·표 셀과 같은
 * 규칙(`siblingStructure`: 개체가 든 문단·빈 문단은 자기와 인접 문단의 병합을 막는다)이고, 범위 scope는 문단마다 따로다(여러 문단
 * 범위 치환은 열지 않는다). 메모는 문단 구조 command를 모두 막는다.
 */
function sublistStructure(
  paragraphs: readonly ViewerParagraph[],
  sectionPath: string,
  structure: SublistStructure
): ParagraphStructureEntry[] {
  const scope = (paragraph: ViewerParagraph) => sublistParagraphRangeScope(sectionPath, structure, paragraph.id)
  if (structure === 'MEMO_TEXT') return paragraphs.map((paragraph) => ({ rangeScope: scope(paragraph), gate: MEMO_STRUCTURE_GATE }))
  return siblingStructure(paragraphs, paragraphs.map(editableTexts), sectionPath, scope)
    .map((entry, index) => ({ rangeScope: scope(paragraphs[index]), gate: entry.gate }))
}

interface SublistGroup {
  structure: SublistStructure
  paragraphs: readonly ViewerParagraph[]
  /** 쪽 아래 각주면 그 각주 경로. */
  footnotePath?: string
  /** 구역 끝 미주면 그 미주 경로. */
  endnotePath?: string
  /** 이 subList 문단에 각주·미주를 넣을 수 없는 이유. 없으면 넣을 수 있다(본문·표 셀 안 글상자). */
  noteBlock?: EditingCapabilityReason
}

/**
 * 문단 목록 안의 subList 묶음을 문서 순서로 모은다: 각주 번호 표시의 본문, 글상자 글, 메모 본문. 표 셀(깊이 무관)·각주 본문·글상자
 * 글 안도 본다(글자만 든 글상자는 글자만 든 각주·미주를 품을 수 있다). 메모 안은 다시 보지 않는다(글자만 든 메모에는 개체가 없고,
 * 개체가 든 것은 decoder가 anchor를 붙이지 않는다). 미주는 구역 끝 목록 block에 있어 따로 모은다(`sectionSublistGroups`).
 * `noteBlock`은 이 문단들이 든 자리에서 물려받는 각주·미주 넣기 차단 이유(머리말·꼬리말·각주 안)다.
 */
function embeddedSublistGroups(
  paragraphs: readonly ViewerParagraph[],
  groups: SublistGroup[] = [],
  noteBlock?: EditingCapabilityReason
): SublistGroup[] {
  for (const paragraph of paragraphs) {
    for (const item of paragraph.content) {
      if (item.type === 'table') {
        for (const row of item.rows) for (const cell of row.cells) embeddedSublistGroups(cell.paragraphs, groups, noteBlock)
      } else if (item.type === 'object-placeholder') {
        if (item.note) {
          groups.push({ structure: 'NOTE_TEXT', paragraphs: item.note.paragraphs, footnotePath: item.note.sourcePath, noteBlock: 'FOOTNOTE_POSITION' })
          embeddedSublistGroups(item.note.paragraphs, groups, 'FOOTNOTE_POSITION')
        } else if (item.paragraphs?.length && item.kind === 'memo') {
          groups.push({ structure: 'MEMO_TEXT', paragraphs: item.paragraphs, noteBlock: 'FOOTNOTE_POSITION' })
        } else if (item.paragraphs?.length && item.kind === 'text-box') {
          groups.push({ structure: 'TEXT_BOX_TEXT', paragraphs: item.paragraphs, ...(noteBlock ? { noteBlock } : {}) })
          embeddedSublistGroups(item.paragraphs, groups, noteBlock)
        }
      }
    }
  }
  return groups
}

/**
 * section의 모든 subList 묶음. 구역 끝 미주 목록은 쪽 사이에서 나눌 수 있게 미주 문단마다 block이 따로라, 같은 미주(`sourcePath`)의
 * 문단을 다시 하나로 모아 문단 사이 gate를 정한다.
 */
function sectionSublistGroups(section: ViewerSection): SublistGroup[] {
  const groups: SublistGroup[] = []
  const endnotes = new Map<string, ViewerParagraph[]>()
  for (const block of section.blocks) {
    embeddedSublistGroups([block], groups)
    for (const item of block.content) {
      if (item.type !== 'note-list') continue
      for (const note of item.notes) {
        let paragraphs = endnotes.get(note.sourcePath)
        if (!paragraphs) {
          paragraphs = []
          endnotes.set(note.sourcePath, paragraphs)
          groups.push({ structure: 'NOTE_TEXT', paragraphs, endnotePath: note.sourcePath, noteBlock: 'FOOTNOTE_POSITION' })
        }
        paragraphs.push(...note.paragraphs)
        embeddedSublistGroups(note.paragraphs, groups, 'FOOTNOTE_POSITION')
      }
    }
  }
  for (const control of [...section.headers, ...section.footers]) {
    groups.push({ structure: 'HEADER_FOOTER_TEXT', paragraphs: control.paragraphs, noteBlock: 'NOTE_IN_HEADER_FOOTER' })
    embeddedSublistGroups(control.paragraphs, groups, 'NOTE_IN_HEADER_FOOTER')
  }
  return groups
}

function paragraphContexts(
  paragraph: ViewerParagraph,
  texts: readonly ViewerText[],
  structure: EditingStructure,
  rangeScope: string,
  cell?: { cellStyleId?: string; cellStructureEditable: boolean },
  structureGate?: ParagraphStructureGate
): EditingAnchorContext[] {
  const gate = structureGate && Object.keys(structureGate).length ? { structureGate } : {}
  return texts.map((text) => ({
    sectionPath: text.sourceAnchor!.sectionPath,
    textNodeId: text.sourceAnchor!.textNodeId,
    text: text.text,
    charStyleId: text.charStyleId,
    paraStyleId: paragraph.paraStyleId,
    paragraphId: paragraph.id,
    rangeScope,
    structure,
    ...(cell ? { cellStyleId: cell.cellStyleId, cellStructureEditable: cell.cellStructureEditable } : {}),
    ...(isEmptyParagraphAnchorId(text.sourceAnchor!.textNodeId) ? { emptyParagraph: true } : {}),
    ...gate
  }))
}

const isEmptyParagraphTexts = (texts: readonly ViewerText[] | undefined): boolean =>
  Boolean(texts?.some((text) => isEmptyParagraphAnchorId(text.sourceAnchor?.textNodeId)))

/** 문단 구조 command에서 이 문단 자체를 막는 이유(빈 문단·구조 규칙 위반). */
function ownStructureBlock(
  paragraph: ViewerParagraph,
  texts: readonly ViewerText[] | undefined
): EditingCapabilityReason | undefined {
  if (!texts) return 'PARAGRAPH_HAS_OBJECT'
  if (isEmptyParagraphTexts(texts)) return 'EMPTY_PARAGRAPH'
  const block: ParagraphStructureBlock | undefined = paragraph.structureBlock
  return block
}

/**
 * 같은 부모(구역 본문 또는 표 셀) 안 문단 목록의 문단 구조 gate와 여러 문단 범위 scope.
 * 문단 구조 command를 받을 수 없는 문단(개체가 든 문단·빈 문단·표나 그림만 든 문단)은 여러 문단 범위를 끊는다:
 * 그 문단은 문단 하나 scope를 쓰고, 그 뒤의 문단은 새 구간 scope(`${baseScope}:${구간 번호}`, 첫 구간은 `baseScope`)를 쓴다.
 */
function siblingStructure(
  paragraphs: readonly ViewerParagraph[],
  paragraphTexts: ReadonlyArray<readonly ViewerText[] | undefined>,
  baseScope: string,
  ownScope: (paragraph: ViewerParagraph) => string
): { rangeScope: string; gate: ParagraphStructureGate }[] {
  const blocks = paragraphs.map((paragraph, index) => ownStructureBlock(paragraph, paragraphTexts[index]))
  let segment = 0
  let previousBlocked = false
  return paragraphs.map((paragraph, index) => {
    const block = blocks[index]
    if (block) {
      previousBlocked = true
      return { rangeScope: ownScope(paragraph), gate: { split: block, mergePrevious: block, mergeNext: block } }
    }
    if (previousBlocked && index > 0) segment += 1
    previousBlocked = false
    const gate: ParagraphStructureGate = {}
    if (index > 0 && blocks[index - 1]) gate.mergePrevious = blocks[index - 1]
    if (index < paragraphs.length - 1 && blocks[index + 1]) gate.mergeNext = blocks[index + 1]
    return { rangeScope: segment ? `${baseScope}:${segment}` : baseScope, gate }
  })
}

/**
 * 셀이 구조 command(행·열 추가/삭제, 병합·분할, 셀 style, 문단 나눔·병합)의 대상이 될 수 있는지.
 * text 입력은 이 조건과 무관하게 source anchor가 있는 run이면 허용한다.
 */
function isStructureEditableCell(cell: ViewerTableCell, paragraphTexts: ReadonlyArray<ViewerText[] | undefined>): boolean {
  return (
    !cell.header &&
    cell.rowSpan === 1 &&
    cell.columnSpan === 1 &&
    paragraphTexts.length > 0 &&
    // 빈 문단 합성 anchor가 있는 셀은 문단 나눔·행열 command가 쓸 `hp:t`가 없으므로 text 전용으로 둔다.
    paragraphTexts.every((texts) => texts?.length === 1 && !isEmptyParagraphAnchorId(texts[0].sourceAnchor?.textNodeId))
  )
}

function tableContexts(table: ViewerTable, sectionPath: string): EditingAnchorContext[] {
  return table.rows.flatMap((row) => row.cells.flatMap((cell) => {
    // 쪽을 넘어 나뉜 셀 조각은 layout 단계에서만 생기며 조각 사이 caret·선택 복원을 검증하지 않았으므로 제외한다.
    if (cell.splitTop || cell.splitBottom || !cell.paragraphs.length) return []
    const cellScope = `${sectionPath}:table-cell:${cell.sourceCellId ?? `${table.id}:r${cell.row}c${cell.column}`}`
    const paragraphTexts = cell.paragraphs.map(editableTexts)
    const cellStructureEditable = isStructureEditableCell(cell, paragraphTexts)
    const paragraphScope = (paragraph: ViewerParagraph) => `${cellScope}:paragraph:${paragraph.id}`
    // 구조 편집이 되는 셀 안에서도 개체가 든 문단은 문단 나눔·병합·여러 문단 범위에서 빠진다.
    const structure = cellStructureEditable ? cellParagraphStructure(cell.paragraphs, cellScope) : undefined
    return cell.paragraphs.flatMap((paragraph, index) => {
      const texts = paragraphTexts[index]
      if (!texts) return []
      // 구조 편집이 안 되는 셀은 문단 사이 치환(문단 fragment patch)이 거부되므로 선택 범위를 문단 하나로 묶는다.
      const rangeScope = structure?.[index].rangeScope ?? paragraphScope(paragraph)
      return paragraphContexts(paragraph, texts, 'TABLE_CELL_TEXT', rangeScope, {
        cellStyleId: cell.borderFillId,
        cellStructureEditable
      }, structure?.[index].gate)
    })
  }))
}

function paragraphSourcePath(paragraph: ViewerParagraph): string | undefined {
  for (const item of paragraph.content) {
    if (item.type === 'text' && item.sourceAnchor) return item.sourceAnchor.sectionPath
    if (item.type === 'note-list' || (item.type === 'object-placeholder' && item.note)) {
      for (const note of item.type === 'note-list' ? item.notes : [item.note!]) {
        for (const nested of note.paragraphs) {
          const path = paragraphSourcePath(nested)
          if (path) return path
        }
      }
    }
    if (item.type === 'object-placeholder' && item.paragraphs) {
      for (const nested of item.paragraphs) {
        const path = paragraphSourcePath(nested)
        if (path) return path
      }
    }
    if (item.type === 'table') {
      for (const row of item.rows) {
        for (const cell of row.cells) {
          for (const nested of cell.paragraphs) {
            const path = paragraphSourcePath(nested)
            if (path) return path
          }
        }
      }
    }
  }
  return undefined
}

function topLevelStructure(
  blocks: readonly ViewerParagraph[],
  blockTexts: ReadonlyArray<readonly ViewerText[] | undefined>,
  sectionPath: string
): { rangeScope: string; gate: ParagraphStructureGate }[] {
  return siblingStructure(blocks, blockTexts, `${sectionPath}:top-level`, (paragraph) =>
    isEmptyParagraphTexts(blockTexts[blocks.indexOf(paragraph)])
      ? `${sectionPath}:empty-paragraph:${paragraph.id}`
      : `${sectionPath}:paragraph:${paragraph.id}`
  )
}

type ParagraphStructureEntry = { rangeScope: string; gate: ParagraphStructureGate }

/**
 * section별 결과 cache. ViewerSection은 만든 뒤 바꾸지 않으므로(편집 projection patch는 바뀐 section만 새 object로 바꾼다)
 * 편집 뒤에는 바뀐 section만 다시 계산한다.
 */
const sectionStructures = new WeakMap<ViewerSection, ReadonlyArray<readonly [string, ParagraphStructureEntry]>>()
const sectionContexts = new WeakMap<ViewerSection, readonly EditingAnchorContext[]>()

function sectionSourcePath(section: ViewerSection): string | undefined {
  return [
    ...section.blocks,
    ...section.headers.flatMap((control) => control.paragraphs),
    ...section.footers.flatMap((control) => control.paragraphs)
  ].map(paragraphSourcePath).find((path): path is string => Boolean(path))
}

/**
 * subList 문단의 글자 anchor. 문단마다 범위 scope를 따로 두고 문단 구조 gate는 그 subList 안 규칙(`sublistStructure`)을 쓴다.
 * 개체가 든 글상자·메모처럼 decoder가 anchor를 붙이지 않는 문단과 표·그림이 든 문단(셀 포함)은 읽기 전용으로 남는다.
 */
function sublistContexts(group: SublistGroup, sectionPath: string): EditingAnchorContext[] {
  const structure = sublistStructure(group.paragraphs, sectionPath, group.structure)
  return group.paragraphs.flatMap((paragraph, index) => {
    const texts = editableTexts(paragraph)
    if (!texts) return []
    const contexts = paragraphContexts(paragraph, texts, group.structure, structure[index].rangeScope, undefined, structure[index].gate)
    const extra = {
      ...(group.footnotePath ? { footnotePath: group.footnotePath } : {}),
      ...(group.endnotePath ? { endnotePath: group.endnotePath } : {}),
      ...(group.noteBlock ? { noteBlock: group.noteBlock } : {})
    }
    return Object.keys(extra).length ? contexts.map((context) => ({ ...context, ...extra })) : contexts
  })
}

function sectionParagraphStructure(section: ViewerSection): ReadonlyArray<readonly [string, ParagraphStructureEntry]> {
  const cached = sectionStructures.get(section)
  if (cached) return cached
  const sectionPath = sectionSourcePath(section)
  const structure = sectionPath ? topLevelStructure(section.blocks, section.blocks.map(editableTexts), sectionPath) : []
  const result: Array<readonly [string, ParagraphStructureEntry]> = sectionPath
    ? section.blocks.map((paragraph, index) => [paragraph.id, structure[index]] as const)
    : []
  if (sectionPath) {
    for (const group of sectionSublistGroups(section)) {
      const entries = sublistStructure(group.paragraphs, sectionPath, group.structure)
      group.paragraphs.forEach((paragraph, index) => result.push([paragraph.id, entries[index]] as const))
    }
  }
  sectionStructures.set(section, result)
  return result
}

/**
 * 구역 본문 문단과 subList(각주·미주·머리말·꼬리말·글상자·메모) 문단 id → 문단 구조 gate·범위 scope. renderer가 문단 입력
 * surface의 Enter·Backspace·Delete와 범위 scope를 capability와 같게 정하는 데 쓴다(표 셀은 셀 안 문단만 보면 되므로 renderer가
 * 같은 규칙을 셀 안에서 쓴다). subList 문단의 범위 scope는 문단 하나다.
 */
export function topLevelParagraphStructure(
  document: ViewerDocument
): Map<string, ParagraphStructureEntry> {
  const result = new Map<string, ParagraphStructureEntry>()
  for (const section of document.sections) {
    for (const [id, entry] of sectionParagraphStructure(section)) result.set(id, entry)
  }
  return result
}

/**
 * 구조 편집이 되는 표 셀 문단 목록의 문단 구조 gate와 범위 scope. `cellScope`는 셀 범위 scope(`…:table-cell:…`)이고
 * capability(`tableContexts`)와 renderer가 같은 함수로 같은 값을 얻는다.
 */
export function cellParagraphStructure(
  paragraphs: readonly ViewerParagraph[],
  cellScope: string
): { rangeScope: string; gate: ParagraphStructureGate }[] {
  return siblingStructure(paragraphs, paragraphs.map(editableTexts), cellScope, (paragraph) => `${cellScope}:paragraph:${paragraph.id}`)
}

function sectionAnchorContexts(section: ViewerSection): readonly EditingAnchorContext[] {
  const cached = sectionContexts.get(section)
  if (cached) return cached
  const sectionPath = sectionSourcePath(section)
  let result: EditingAnchorContext[] = []
  if (sectionPath) {
    const blockTexts = section.blocks.map(editableTexts)
    // 빈 문단(`empty-paragraph`)·개체가 든 문단(`paragraph`)은 여러 문단 범위 치환에 끼지 않도록 문단마다 따로 scope를 둔다.
    const structure = topLevelStructure(section.blocks, blockTexts, sectionPath)
    result = section.blocks.flatMap((paragraph, index) => {
      const texts = blockTexts[index]
      const tableTexts = texts ? undefined : tableParagraphTexts(paragraph)
      const topLevel = texts
        ? paragraphContexts(paragraph, texts, 'TOP_LEVEL_TEXT', structure[index].rangeScope, undefined, structure[index].gate)
        : tableTexts
          ? tableTexts.flatMap((text, textIndex) =>
              paragraphContexts(
                paragraph,
                [text],
                'TOP_LEVEL_TEXT',
                tableParagraphRangeScope(sectionPath, paragraph.id, textIndex),
                undefined,
                { split: 'TABLE_PARAGRAPH', mergePrevious: 'TABLE_PARAGRAPH', mergeNext: 'TABLE_PARAGRAPH' }
              ).map((context) => ({
                ...context,
                tableParagraph: true,
                ...(isTableCaretAnchorId(context.textNodeId) ? { tableCaret: true } : {})
              }))
            )
          : []
      const tables = paragraph.content.flatMap((item) => item.type === 'table' ? tableContexts(item, sectionPath) : [])
      return [...topLevel, ...tables]
    })
    // 각주 본문은 번호 표시가 놓인 쪽 아래에, 미주는 구역 끝 목록에 그리지만 원본 위치(번호 표시가 든 문단)에서 센다.
    // 글상자·메모 글은 개체가 놓인 문단에서 센다.
    result.push(...sectionSublistGroups(section).flatMap((group) => sublistContexts(group, sectionPath)))
  }
  sectionContexts.set(section, result)
  return result
}

export function listEditingAnchorContexts(document: ViewerDocument): EditingAnchorContext[] {
  return document.sections.flatMap((section) => sectionAnchorContexts(section))
}

function safeOffset(text: string, requested: number): number {
  let offset = Number.isFinite(requested) ? Math.floor(requested) : 0
  offset = Math.max(0, Math.min(offset, text.length))
  if (!isSurrogateBoundarySafe(text, offset)) offset -= 1
  return offset
}

export function reconcileEditingSelection(
  document: ViewerDocument,
  selection: EditorSelection | undefined
): EditingSelectionProjection {
  if (!selection) return { status: 'CLEARED' }
  const contexts = listEditingAnchorContexts(document).filter(
    (context) => context.sectionPath === selection.sectionPath
  )
  const anchor = contexts.find((context) => context.textNodeId === selection.anchorTextNodeId)
  const focus = contexts.find((context) => context.textNodeId === selection.focusTextNodeId)
  if (!anchor && !focus) return { status: 'CLEARED' }
  if (!anchor || !focus || anchor.rangeScope !== focus.rangeScope) {
    const survivor = focus ?? anchor!
    const requested = focus ? selection.focusOffset : selection.anchorOffset
    const offset = safeOffset(survivor.text, requested)
    return {
      status: 'COLLAPSED',
      selection: {
        sectionPath: survivor.sectionPath,
        anchorTextNodeId: survivor.textNodeId,
        anchorOffset: offset,
        focusTextNodeId: survivor.textNodeId,
        focusOffset: offset
      }
    }
  }
  const anchorOffset = safeOffset(anchor.text, selection.anchorOffset)
  const focusOffset = safeOffset(focus.text, selection.focusOffset)
  return {
    selection: { ...selection, anchorOffset, focusOffset },
    status:
      anchorOffset === selection.anchorOffset && focusOffset === selection.focusOffset
        ? 'CURRENT'
        : 'CLAMPED'
  }
}

const unavailable = (reason: EditingCapabilityReason): EditingCapabilityState => ({
  available: false,
  reason
})

export function editingCapabilities(
  document: ViewerDocument | null | undefined,
  selection: EditorSelection | undefined
): EditingCapabilities {
  if (!document || !selection) {
    const state = unavailable('NO_SELECTION')
    return {
      selection: state,
      text: state,
      characterStyle: state,
      paragraphStyle: state,
      paragraphStructure: state,
      cellStyle: state,
      footnote: state,
      endnote: state
    }
  }
  const contexts = listEditingAnchorContexts(document)
  const anchor = contexts.find((context) => context.textNodeId === selection.anchorTextNodeId)
  const focus = contexts.find((context) => context.textNodeId === selection.focusTextNodeId)
  if (!anchor || !focus) {
    const state = unavailable('STALE_SELECTION')
    return {
      selection: state,
      text: state,
      characterStyle: state,
      paragraphStyle: state,
      paragraphStructure: state,
      cellStyle: state,
      footnote: state,
      endnote: state
    }
  }
  if (anchor.rangeScope !== focus.rangeScope) {
    const state = unavailable('CROSS_STRUCTURE_SELECTION')
    return {
      selection: state,
      text: state,
      characterStyle: state,
      paragraphStyle: state,
      paragraphStructure: state,
      cellStyle: state,
      footnote: state,
      endnote: state,
      focus
    }
  }
  const projection = reconcileEditingSelection(document, selection)
  if (!projection.selection || projection.status !== 'CURRENT') {
    const state = unavailable('STALE_SELECTION')
    return {
      selection: state,
      text: state,
      characterStyle: state,
      paragraphStyle: state,
      paragraphStructure: state,
      cellStyle: state,
      footnote: state,
      endnote: state,
      focus
    }
  }
  const topLevel = anchor.structure === 'TOP_LEVEL_TEXT' && focus.structure === 'TOP_LEVEL_TEXT'
  const tableCell = anchor.structure === 'TABLE_CELL_TEXT' && focus.structure === 'TABLE_CELL_TEXT'
  // 같은 범위 scope 안이므로 anchor·focus의 구조는 같다.
  const memo = anchor.structure === 'MEMO_TEXT'
  const sublist = anchor.structure === 'NOTE_TEXT' || anchor.structure === 'HEADER_FOOTER_TEXT' || anchor.structure === 'TEXT_BOX_TEXT'
  const tableParagraph = anchor.tableParagraph === true || focus.tableParagraph === true
  const tableCaret = anchor.tableCaret === true || focus.tableCaret === true
  const structuralCell = tableCell && anchor.cellStructureEditable === true && focus.cellStructureEditable === true
  const sameRun = anchor.textNodeId === focus.textNodeId
  const sameParagraph = anchor.paragraphId === focus.paragraphId
  const emptyParagraph = anchor.emptyParagraph === true || focus.emptyParagraph === true
  // 글자·문단 모양은 본문, 표 셀(병합·머리글 셀 포함), 각주·미주·머리말·꼬리말·글상자 문단 모두 같은 run·문단 조건만 본다.
  // 목록에 오르는 표 셀은 최상위 표의 직속 셀뿐이라 셀 안에 다시 든 표는 여기까지 오지 않는다.
  // 빈 문단은 글자 run이 아직 없으므로 첫 입력 전에는 문단 모양만 연다. 메모 본문은 글자와 글자·문단 모양만,
  // 표가 든 본문 문단은 글자와(표 앞·뒤 caret이 아니면) 문단 모양만 연다.
  const characterStyle = (): EditingCapabilityState => {
    if (!topLevel && !tableCell && !sublist && !memo) return unavailable('TABLE_CELL_STRUCTURE')
    if (tableParagraph) return unavailable('TABLE_PARAGRAPH')
    if (emptyParagraph) return unavailable('EMPTY_PARAGRAPH')
    return sameRun ? { available: true } : unavailable('MULTI_RUN_SELECTION')
  }
  const paragraphStyle = (): EditingCapabilityState => {
    if (!topLevel && !tableCell && !sublist && !memo) return unavailable('TABLE_CELL_STRUCTURE')
    if (tableCaret) return unavailable('TABLE_PARAGRAPH')
    return sameParagraph ? { available: true } : unavailable('MULTI_PARAGRAPH_SELECTION')
  }
  const paragraphStructure = (): EditingCapabilityState => {
    if (memo) return unavailable('SUBLIST_TEXT')
    if (tableParagraph) return unavailable('TABLE_PARAGRAPH')
    if (emptyParagraph) return unavailable('EMPTY_PARAGRAPH')
    if (!topLevel && !structuralCell && !sublist) return unavailable('TABLE_CELL_STRUCTURE')
    if (focus.structureGate?.split) return unavailable(focus.structureGate.split)
    return sameRun ? { available: true } : unavailable('MULTI_RUN_SELECTION')
  }
  // 각주·미주는 본문·표 셀·글상자 문단 글자 사이의 접힌 caret에 넣는다(편집 코어 `noteHostViolation`과 같은 자리). 머리말·꼬리말과
  // 각주·미주·메모 본문 안은 막는다.
  const note = (): EditingCapabilityState => {
    if (focus.noteBlock) return unavailable(focus.noteBlock)
    if (!topLevel && !tableCell && anchor.structure !== 'TEXT_BOX_TEXT') return unavailable('FOOTNOTE_POSITION')
    return sameRun && selection.anchorOffset === selection.focusOffset && !tableParagraph && !emptyParagraph
      ? { available: true }
      : unavailable('FOOTNOTE_POSITION')
  }
  return {
    selection: { available: true },
    text: { available: true },
    characterStyle: characterStyle(),
    paragraphStyle: paragraphStyle(),
    paragraphStructure: paragraphStructure(),
    cellStyle: !structuralCell || !focus.cellStyleId
      ? unavailable('TABLE_CELL_STRUCTURE')
      : { available: true },
    footnote: note(),
    endnote: note(),
    focus
  }
}

export function characterStyleCapability(
  selection: EditorSelection | undefined
): EditingCapabilityState {
  if (!selection) return unavailable('NO_SELECTION')
  if (selection.anchorTextNodeId !== selection.focusTextNodeId) {
    return unavailable('MULTI_RUN_SELECTION')
  }
  return { available: true }
}
