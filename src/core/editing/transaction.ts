import {
  applyReplaceTextCommand,
  HwpxEditConflictError,
  HwpxLossReport,
  ReplaceTextCommand
} from './text_patch'
import {
  applyCharacterStyleCommand,
  applyParagraphStyleCommand,
  applyRestoreCharacterRunCommand,
  applyRestoreStyleCommand,
  ApplyCharacterStyleCommand,
  ApplyParagraphStyleCommand,
  RestoreCharacterRunCommand,
  RestoreStyleCommand
} from './style_patch'
import {
  applyReplaceParagraphFragmentCommand,
  ReplaceParagraphFragmentCommand
} from './paragraph_patch'
import {
  applyCellStyleCommand,
  applyRestoreCellStyleCommand,
  ApplyCellStyleCommand,
  RestoreCellStyleCommand
} from './cell_style_patch'
import {
  applyReplaceTableFragmentCommand,
  ReplaceTableFragmentCommand
} from './table_patch'
import { ViewerDocument } from '../document/viewer_document'
import { HwpxSourcePackage } from '../parser/source_package'
import { decodeViewerDocument } from '../parser/viewer_decoder'
import {
  EditorSelection,
  equalEditorSelections,
  validateEditorSelection
} from './selection'

export type { EditorSelection } from './selection'

export type EditCommand =
  | Omit<ReplaceTextCommand, 'revision'>
  | ApplyCharacterStyleCommand
  | ApplyParagraphStyleCommand
  | RestoreStyleCommand
  | RestoreCharacterRunCommand
  | ReplaceParagraphFragmentCommand
  | ApplyCellStyleCommand
  | RestoreCellStyleCommand
  | ReplaceTableFragmentCommand

export interface EditTransaction {
  id: string
  baseRevision: number
  commands: readonly EditCommand[]
  selectionBefore: EditorSelection
  selectionAfter: EditorSelection
  inputType?: string
  compositionId?: string
  timestamp: number
}

export interface EditTransactionResult {
  package: HwpxSourcePackage
  inverse?: EditTransaction
  lossReport: HwpxLossReport
  changed: boolean
}

export const MAX_TRANSACTION_COMMANDS = 1_000

function stripRevision(command: ReplaceTextCommand): EditCommand {
  const { revision: _revision, ...operation } = command
  return operation
}

function validateTransactionShape(transaction: EditTransaction): void {
  if (!transaction.id.trim()) throw new Error('편집 transaction ID가 비어 있습니다.')
  if (!Number.isSafeInteger(transaction.baseRevision) || transaction.baseRevision < 0) {
    throw new Error('편집 transaction base revision이 올바르지 않습니다.')
  }
  if (transaction.commands.length === 0) throw new Error('편집 transaction에 command가 없습니다.')
  if (transaction.commands.length > MAX_TRANSACTION_COMMANDS) {
    throw new Error(`편집 transaction command 수가 제한(${MAX_TRANSACTION_COMMANDS})을 초과합니다.`)
  }
  if (!Number.isFinite(transaction.timestamp) || transaction.timestamp < 0) {
    throw new Error('편집 transaction timestamp가 올바르지 않습니다.')
  }
}

export function applyEditTransaction(
  sourcePackage: HwpxSourcePackage,
  transaction: EditTransaction
): EditTransactionResult {
  validateTransactionShape(transaction)
  if (sourcePackage.revision !== transaction.baseRevision) {
    throw new HwpxEditConflictError(
      `transaction revision이 변경되었습니다: expected ${transaction.baseRevision}, actual ${sourcePackage.revision}`
    )
  }
  validateEditorSelection(sourcePackage, transaction.selectionBefore)

  let currentPackage = sourcePackage
  const inverseCommands: EditCommand[] = []
  const modifiedEntries = new Set<string>()
  let previewStatus: HwpxLossReport['previewStatus'] = sourcePackage
    .listEntries()
    .some((entry) => entry.path.startsWith('Preview/'))
    ? 'current'
    : 'omitted'

  for (const command of transaction.commands) {
    const result =
      command.type === 'replace-text'
        ? applyReplaceTextCommand(currentPackage, {
            ...command,
            revision: currentPackage.revision
          })
        : command.type === 'apply-character-style'
          ? applyCharacterStyleCommand(currentPackage, command)
          : command.type === 'apply-paragraph-style'
            ? applyParagraphStyleCommand(currentPackage, command)
            : command.type === 'restore-style'
              ? applyRestoreStyleCommand(currentPackage, command)
              : command.type === 'restore-character-run'
                ? applyRestoreCharacterRunCommand(currentPackage, command)
                : command.type === 'apply-cell-style'
                  ? applyCellStyleCommand(currentPackage, command)
                  : command.type === 'restore-cell-style'
                    ? applyRestoreCellStyleCommand(currentPackage, command)
                    : command.type === 'replace-table-fragment'
                      ? applyReplaceTableFragmentCommand(currentPackage, command)
                      : applyReplaceParagraphFragmentCommand(currentPackage, command)
    if (result.package !== currentPackage) {
      const inverse =
        command.type === 'replace-text'
          ? stripRevision(result.inverse as ReplaceTextCommand)
          : result.inverse
      if (!inverse) throw new Error('변경된 command에 inverse가 없습니다.')
      inverseCommands.unshift(inverse)
      result.lossReport.modifiedEntries.forEach((path) => modifiedEntries.add(path))
      if (result.lossReport.previewStatus === 'stale') previewStatus = 'stale'
      currentPackage = result.package
    }
  }

  validateEditorSelection(currentPackage, transaction.selectionAfter)
  const allEntries = sourcePackage.listEntries().map((entry) => entry.path)
  const changed = currentPackage !== sourcePackage
  return {
    package: currentPackage,
    inverse: changed
      ? {
          id: `${transaction.id}:inverse`,
          baseRevision: currentPackage.revision,
          commands: inverseCommands,
          selectionBefore: transaction.selectionAfter,
          selectionAfter: transaction.selectionBefore,
          inputType: 'historyUndo',
          compositionId: transaction.compositionId,
          timestamp: transaction.timestamp
        }
      : undefined,
    lossReport: {
      preservedEntries: allEntries.filter((path) => !modifiedEntries.has(path)),
      modifiedEntries: [...modifiedEntries],
      regeneratedEntries: [],
      omittedEntries: [],
      unsupportedFeatures: [],
      previewStatus
    },
    changed
  }
}

export async function projectEditTransaction(result: EditTransactionResult): Promise<ViewerDocument> {
  return decodeViewerDocument(result.package)
}

export function rebaseTransaction(transaction: EditTransaction, revision: number): EditTransaction {
  return { ...transaction, baseRevision: revision }
}

const GROUPABLE_INPUT_TYPES = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward'])

export function shouldGroupTransactions(previous: EditTransaction, next: EditTransaction, windowMs = 1_000): boolean {
  if (
    previous.commands.length === 0 ||
    next.commands.length !== 1 ||
    previous.commands.length + next.commands.length > MAX_TRANSACTION_COMMANDS ||
    !previous.inputType ||
    previous.inputType !== next.inputType ||
    !GROUPABLE_INPUT_TYPES.has(previous.inputType) ||
    previous.compositionId ||
    next.compositionId ||
    next.timestamp < previous.timestamp ||
    next.timestamp - previous.timestamp > windowMs ||
    !equalEditorSelections(previous.selectionAfter, next.selectionBefore)
  ) {
    return false
  }
  const previousCommand = previous.commands[previous.commands.length - 1]
  const nextCommand = next.commands[0]
  return (
    previousCommand.type === 'replace-text' &&
    nextCommand.type === 'replace-text' &&
    previousCommand.sectionPath === nextCommand.sectionPath &&
    previousCommand.textNodeId === nextCommand.textNodeId
  )
}
