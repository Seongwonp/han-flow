import {
  ViewerDocument,
  ViewerParagraph,
  ViewerTable,
  ViewerTableCell,
  ViewerText
} from '../document/viewer_document'
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
   * false면 병합·머리글 셀이거나 문단에 run이 여러 개인 셀이라 text 입력·삭제·치환만 허용한다.
   */
  cellStructureEditable?: boolean
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
  if (!paragraph.content.length) return undefined
  if (!paragraph.content.every((item) => item.type === 'text' && Boolean(item.sourceAnchor))) {
    return undefined
  }
  return paragraph.content as ViewerText[]
}

function paragraphContexts(
  paragraph: ViewerParagraph,
  texts: readonly ViewerText[],
  structure: EditingStructure,
  rangeScope: string,
  cell?: { cellStyleId?: string; cellStructureEditable: boolean }
): EditingAnchorContext[] {
  return texts.map((text) => ({
    sectionPath: text.sourceAnchor!.sectionPath,
    textNodeId: text.sourceAnchor!.textNodeId,
    text: text.text,
    charStyleId: text.charStyleId,
    paraStyleId: paragraph.paraStyleId,
    paragraphId: paragraph.id,
    rangeScope,
    structure,
    ...(cell ? { cellStyleId: cell.cellStyleId, cellStructureEditable: cell.cellStructureEditable } : {})
  }))
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
    paragraphTexts.every((texts) => texts?.length === 1)
  )
}

function tableContexts(table: ViewerTable, sectionPath: string): EditingAnchorContext[] {
  return table.rows.flatMap((row) => row.cells.flatMap((cell) => {
    // 쪽을 넘어 나뉜 셀 조각은 layout 단계에서만 생기며 조각 사이 caret·선택 복원을 검증하지 않았으므로 제외한다.
    if (cell.splitTop || cell.splitBottom || !cell.paragraphs.length) return []
    const cellScope = `${sectionPath}:table-cell:${cell.sourceCellId ?? `${table.id}:r${cell.row}c${cell.column}`}`
    const paragraphTexts = cell.paragraphs.map(editableTexts)
    const cellStructureEditable = isStructureEditableCell(cell, paragraphTexts)
    return cell.paragraphs.flatMap((paragraph, index) => {
      const texts = paragraphTexts[index]
      if (!texts) return []
      // 구조 편집이 안 되는 셀은 문단 사이 치환(문단 fragment patch)이 거부되므로 선택 범위를 문단 하나로 묶는다.
      const rangeScope = cellStructureEditable ? cellScope : `${cellScope}:paragraph:${paragraph.id}`
      return paragraphContexts(paragraph, texts, 'TABLE_CELL_TEXT', rangeScope, {
        cellStyleId: cell.borderFillId,
        cellStructureEditable
      })
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

export function listEditingAnchorContexts(document: ViewerDocument): EditingAnchorContext[] {
  return document.sections.flatMap((section) => {
    const sectionPath = section.blocks
      .map(paragraphSourcePath)
      .find((path): path is string => Boolean(path))
    if (!sectionPath) return []
    return section.blocks.flatMap((paragraph) => {
      const texts = editableTexts(paragraph)
      const topLevel = texts
        ? paragraphContexts(paragraph, texts, 'TOP_LEVEL_TEXT', `${sectionPath}:top-level`)
        : []
      const nested = paragraph.content.flatMap((item) =>
        item.type === 'table' ? tableContexts(item, sectionPath) : []
      )
      return [...topLevel, ...nested]
    })
  })
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
  return {
    selection: { available: true },
    text: { available: true },
    characterStyle: !topLevel
      ? unavailable('TABLE_CELL_STRUCTURE')
      : !sameRun
        ? unavailable('MULTI_RUN_SELECTION')
        : { available: true },
    paragraphStyle: !topLevel
      ? unavailable('TABLE_CELL_STRUCTURE')
      : !sameParagraph
        ? unavailable('MULTI_PARAGRAPH_SELECTION')
        : { available: true },
    paragraphStructure: !topLevel && !structuralCell
      ? unavailable('TABLE_CELL_STRUCTURE')
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
