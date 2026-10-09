import {
  isObjectPlaceholder,
  ViewerDocument,
  ViewerParagraph,
  ViewerSection,
  ViewerTable,
  ViewerTableCell,
  ViewerText
} from '../document/viewer_document'
import { isEmptyParagraphAnchorId } from './empty_paragraph_anchor'
import type { ParagraphStructureBlock } from './paragraph_structure'
import { EditorSelection } from './selection'
import { isSurrogateBoundarySafe } from './xml_scan'

export type EditingStructure = 'TOP_LEVEL_TEXT' | 'TABLE_CELL_TEXT'
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
  return section.blocks.map(paragraphSourcePath).find((path): path is string => Boolean(path))
}

function sectionParagraphStructure(section: ViewerSection): ReadonlyArray<readonly [string, ParagraphStructureEntry]> {
  const cached = sectionStructures.get(section)
  if (cached) return cached
  const sectionPath = sectionSourcePath(section)
  const structure = sectionPath ? topLevelStructure(section.blocks, section.blocks.map(editableTexts), sectionPath) : []
  const result = sectionPath ? section.blocks.map((paragraph, index) => [paragraph.id, structure[index]] as const) : []
  sectionStructures.set(section, result)
  return result
}

/**
 * 구역 본문 문단 id → 문단 구조 gate·여러 문단 범위 scope. renderer가 본문 문단 입력 surface의 Enter·Backspace·Delete와
 * 범위 scope를 capability와 같게 정하는 데 쓴다(표 셀은 셀 안 문단만 보면 되므로 renderer가 같은 규칙을 셀 안에서 쓴다).
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
      const topLevel = texts
        ? paragraphContexts(paragraph, texts, 'TOP_LEVEL_TEXT', structure[index].rangeScope, undefined, structure[index].gate)
        : []
      const nested = paragraph.content.flatMap((item) =>
        item.type === 'table' ? tableContexts(item, sectionPath) : []
      )
      return [...topLevel, ...nested]
    })
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
      cellStyle: state
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
      cellStyle: state
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
      focus
    }
  }
  const topLevel = anchor.structure === 'TOP_LEVEL_TEXT' && focus.structure === 'TOP_LEVEL_TEXT'
  const tableCell = anchor.structure === 'TABLE_CELL_TEXT' && focus.structure === 'TABLE_CELL_TEXT'
  const structuralCell = tableCell && anchor.cellStructureEditable === true && focus.cellStructureEditable === true
  const sameRun = anchor.textNodeId === focus.textNodeId
  const sameParagraph = anchor.paragraphId === focus.paragraphId
  const emptyParagraph = anchor.emptyParagraph === true || focus.emptyParagraph === true
  return {
    selection: { available: true },
    text: { available: true },
    // 글자·문단 모양은 본문과 표 셀(병합·머리글 셀 포함) 모두 같은 run·문단 조건만 본다.
    // 목록에 오르는 표 셀은 최상위 표의 직속 셀뿐이라 셀 안에 다시 든 표는 여기까지 오지 않는다.
    // 빈 문단은 글자 run이 아직 없으므로 첫 입력 전에는 문단 모양만 연다.
    characterStyle: !topLevel && !tableCell
      ? unavailable('TABLE_CELL_STRUCTURE')
      : emptyParagraph
        ? unavailable('EMPTY_PARAGRAPH')
        : !sameRun
          ? unavailable('MULTI_RUN_SELECTION')
          : { available: true },
    paragraphStyle: !topLevel && !tableCell
      ? unavailable('TABLE_CELL_STRUCTURE')
      : !sameParagraph
        ? unavailable('MULTI_PARAGRAPH_SELECTION')
        : { available: true },
    paragraphStructure: emptyParagraph
      ? unavailable('EMPTY_PARAGRAPH')
      : !topLevel && !structuralCell
        ? unavailable('TABLE_CELL_STRUCTURE')
        : focus.structureGate?.split
          ? unavailable(focus.structureGate.split)
          : !sameRun
            ? unavailable('MULTI_RUN_SELECTION')
            : { available: true },
    cellStyle: !structuralCell || !focus.cellStyleId
      ? unavailable('TABLE_CELL_STRUCTURE')
      : { available: true },
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
