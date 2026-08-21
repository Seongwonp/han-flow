import { ViewerDocument } from '../document/viewer_document'
import { EditorSelection } from './transaction'
import type { ParagraphAlignment } from './style_patch'

export interface EditingHistoryStatus {
  revision: number
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
  previewStatus: 'stale' | 'omitted'
}

export type EditingSaveAsDialogResult =
  | { outcome: 'cancelled' }
  | ({ outcome: 'saved' } & EditingSavedResult)

export type EditingResolveDirtyResult =
  | { outcome: 'cancelled' }
  | { outcome: 'discarded' }
  | ({ outcome: 'saved' } & EditingSavedResult)
