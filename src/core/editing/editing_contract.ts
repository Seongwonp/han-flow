import { ViewerDocument } from '../document/viewer_document'
import type { ViewerDocumentPatch } from '../document/viewer_document_patch'
import { EditorSelection } from './transaction'
import type { ParagraphAlignment } from './style_patch'
import type { CellBorderType } from './cell_style_patch'
import type { HwpxSaveLossPolicy } from './loss_policy'
import type { TableCellSelection } from './table_cell_selection'

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
  /** 이 문서 projection의 번호. 뒤이은 편집 결과의 patch는 이 번호부터 이어진다. */
  projectionId: number
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

export interface EditingMergeTableCellRightRequest {
  sessionId: string
  transactionId: string
  selectionBefore: EditorSelection
  timestamp: number
}

export interface EditingSplitTableCellRequest {
  sessionId: string
  transactionId: string
  selection: TableCellSelection
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

/**
 * 편집 결과의 문서 projection. 보통은 바로 앞 projection에 대한 증분(`patch`: 바뀐 section과, header.xml이 바뀌었으면
 * style map)이고, session 시작·refresh·전체 다시 해석 fallback(`viewer_projection.ts`)이면 전체 문서다.
 */
export type EditingProjection =
  | { document: ViewerDocument; projectionId: number; patch?: undefined }
  | { patch: ViewerDocumentPatch; document?: undefined; projectionId?: undefined }

export type EditingActionResult = EditingHistoryStatus & EditingProjection & {
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
