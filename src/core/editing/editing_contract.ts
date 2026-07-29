import { ViewerDocument } from '../document/viewer_document'
import { EditorSelection } from './transaction'

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
