import { HwpxSourcePackage } from '../parser/source_package'
import { EditCommand, MAX_TRANSACTION_COMMANDS } from './transaction'
import {
  createEditorSelection,
  EditorSelection,
  normalizeEditorSelection
} from './selection'
import { HwpxEditConflictError, listHwpxTextAnchors } from './text_patch'
import {
  planReplaceParagraphSelection,
  selectionSpansParagraphs
} from './paragraph_patch'

export interface ReplaceSelectionPlan {
  commands: readonly EditCommand[]
  selectionAfter: EditorSelection
  affectedTextNodeIds: readonly string[]
}

export function planReplaceSelection(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection,
  insert: string
): ReplaceSelectionPlan {
  if (selectionSpansParagraphs(sourcePackage, selection)) {
    const plan = planReplaceParagraphSelection(sourcePackage, selection, insert)
    return {
      commands: [plan.command],
      selectionAfter: plan.selectionAfter,
      affectedTextNodeIds: plan.affectedTextNodeIds
    }
  }
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const anchors = listHwpxTextAnchors(sourcePackage, selection.sectionPath)
  const startIndex = anchors.findIndex((anchor) => anchor.textNodeId === normalized.start.textNodeId)
  const endIndex = anchors.findIndex((anchor) => anchor.textNodeId === normalized.end.textNodeId)
  const affected = anchors.slice(startIndex, endIndex + 1)
  if (affected.length === 0) throw new HwpxEditConflictError('selection에 포함된 text run이 없습니다.')
  if (affected.length > MAX_TRANSACTION_COMMANDS) {
    throw new HwpxEditConflictError(
      `selection의 text run 수가 transaction 제한(${MAX_TRANSACTION_COMMANDS})을 초과합니다.`
    )
  }

  const commands: EditCommand[] = affected.map((anchor, index) => {
    const first = index === 0
    const last = index === affected.length - 1
    return {
      type: 'replace-text',
      sectionPath: selection.sectionPath,
      textNodeId: anchor.textNodeId,
      from: first ? normalized.start.offset : 0,
      to: last ? normalized.end.offset : anchor.text.length,
      insert: first ? insert : ''
    }
  })

  return {
    commands,
    selectionAfter: createEditorSelection(
      selection.sectionPath,
      normalized.start.textNodeId,
      normalized.start.offset + insert.length
    ),
    affectedTextNodeIds: affected.map((anchor) => anchor.textNodeId)
  }
}
