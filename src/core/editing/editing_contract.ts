import { ViewerDocument } from '../document/viewer_document'
import { EditorSelection } from './transaction'
import type { ParagraphAlignment } from './style_patch'
import type { CellBorderType } from './cell_style_patch'
import type { HwpxSaveLossPolicy } from './loss_policy'

export interface EditingHistoryStatus {
  revision: number
  savedRevision: number
  canUndo: boolean
  canRedo: boolean
  isDirty: boolean
}

export interface EditingStartRequest {
  filePath: string
}

export interface EditingStartResult extends EditingHistoryStatus {
  sessionId: string
  document: ViewerDocument
}

export interface EditingCommitRequest {
  sessionId: string
  transactionId: string
  sectionPath: string
  textNodeId: string
  from: number
  to: number
  insert: string
  selectionBefore: EditorSelection
  selectionAfter: EditorSelection
  inputType?: string
  compositionId?: string
  timestamp: number
}

export interface EditingRangeCommitRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  insert: string
  inputType?: string
  timestamp: number
}

export interface EditingSplitParagraphRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

export interface EditingMergeParagraphRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  direction: 'previous' | 'next'
  inputType: 'deleteContentBackward' | 'deleteContentForward'
  timestamp: number
}

export interface EditingInsertTableRowRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

export interface EditingDeleteTableRowRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

export interface EditingInsertTableColumnRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

export interface EditingDeleteTableColumnRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

interface EditingStyleRequestBase {
  sessionId: string
  transactionId: string
  sectionPath: string
  textNodeId: string
  selection: EditorSelection
  timestamp: number
}

export interface EditingCharacterStyleRequest extends EditingStyleRequestBase {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikeout?: boolean
  height?: number
  color?: string
  fontId?: string
}

export interface EditingParagraphStyleRequest extends EditingStyleRequestBase {
  align?: ParagraphAlignment
  lineSpacing?: number
  indent?: number
  marginBefore?: number
  marginAfter?: number
}

export interface EditingActionResult extends EditingHistoryStatus {
  document: ViewerDocument
  selection?: EditorSelection
}

export interface EditingSavedResult extends EditingHistoryStatus {
  destinationPath: string
  entryCount: number
  previewStatus: 'current' | 'stale' | 'omitted'
  lossPolicy: HwpxSaveLossPolicy
}

export interface EditingCellStyleRequest extends EditingStyleRequestBase {
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderType?: CellBorderType
}

export type EditingSaveAsDialogResult =
  | { outcome: 'cancelled' }
  | ({ outcome: 'saved' } & EditingSavedResult)

export type EditingResolveDirtyResult =
  | { outcome: 'cancelled' }
  | { outcome: 'discarded' }
  | ({ outcome: 'saved' } & EditingSavedResult)
