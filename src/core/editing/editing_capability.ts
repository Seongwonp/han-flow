import {
  ViewerDocument,
  ViewerParagraph,
  ViewerTable,
  ViewerText
} from '../document/viewer_document'
import { EditorSelection } from './selection'

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
}

export interface EditingCapabilities {
  selection: EditingCapabilityState
  text: EditingCapabilityState
  characterStyle: EditingCapabilityState
  paragraphStyle: EditingCapabilityState
  paragraphStructure: EditingCapabilityState
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
  structure: EditingStructure,
  rangeScope: string
): EditingAnchorContext[] {
  const texts = editableTexts(paragraph)
  if (!texts || (structure === 'TABLE_CELL_TEXT' && texts.length !== 1)) return []
  return texts.map((text) => ({
    sectionPath: text.sourceAnchor!.sectionPath,
    textNodeId: text.sourceAnchor!.textNodeId,
    text: text.text,
    charStyleId: text.charStyleId,
    paraStyleId: paragraph.paraStyleId,
    paragraphId: paragraph.id,
    rangeScope,
    structure
  }))
}

function tableContexts(table: ViewerTable, sectionPath: string): EditingAnchorContext[] {
  return table.rows.flatMap((row) => row.cells.flatMap((cell) => {
    const safeCell =
      !cell.splitTop &&
      !cell.splitBottom &&
      !cell.header &&
      cell.rowSpan === 1 &&
      cell.columnSpan === 1 &&
      cell.paragraphs.length > 0
    if (!safeCell) return []
    const cellScope = `${sectionPath}:table-cell:${cell.sourceCellId ?? `${table.id}:r${cell.row}c${cell.column}`}`
    const contexts = cell.paragraphs.map((paragraph) => paragraphContexts(
      paragraph,
      'TABLE_CELL_TEXT',
      cellScope
    ))
    return contexts.every((paragraph) => paragraph.length === 1)
      ? contexts.flat()
      : []
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
      const topLevel = paragraphContexts(
        paragraph,
        'TOP_LEVEL_TEXT',
        `${sectionPath}:top-level`
      )
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
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  ) offset -= 1
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
      paragraphStructure: state
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
      paragraphStructure: state
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
      focus
    }
  }
  const topLevel = anchor.structure === 'TOP_LEVEL_TEXT' && focus.structure === 'TOP_LEVEL_TEXT'
  const tableCell = anchor.structure === 'TABLE_CELL_TEXT' && focus.structure === 'TABLE_CELL_TEXT'
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
    paragraphStructure: !topLevel && !tableCell
      ? unavailable('TABLE_CELL_STRUCTURE')
      : !sameRun
        ? unavailable('MULTI_RUN_SELECTION')
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
