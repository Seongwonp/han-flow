import { Buffer } from 'buffer'
import { HwpxSourcePackage } from '../parser/source_package'
import {
  applyEditTransaction,
  EditTransaction,
  EditTransactionResult,
  EditorSelection,
  rebaseTransaction,
  shouldGroupTransactions
} from './transaction'
import { equalEditorSelections, validateEditorSelection } from './selection'

export interface EditHistoryOptions {
  maxEntries?: number
  maxBytes?: number
  groupWindowMs?: number
}

export interface EditHistoryAction {
  package: HwpxSourcePackage
  selection: EditorSelection
  transaction: EditTransaction
}

export interface EditHistoryStats {
  undoEntries: number
  redoEntries: number
  estimatedBytes: number
  maxEntries: number
  maxBytes: number
}

interface HistoryEntry {
  forward: EditTransaction
  inverse: EditTransaction
  beforeStateId: number
  afterStateId: number
  estimatedBytes: number
}

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_GROUP_WINDOW_MS = 1_000

export class HwpxHistoryLimitError extends Error {
  readonly code = 'HWPX_HISTORY_LIMIT'
}

function commandBytes(transaction: EditTransaction): number {
  return transaction.commands.reduce(
    (sum, command) => {
      const common =
        Buffer.byteLength(command.sectionPath, 'utf8') +
        Buffer.byteLength(command.textNodeId, 'utf8') +
        64
      if (command.type === 'replace-text') {
        return sum + common + Buffer.byteLength(command.insert, 'utf8')
      }
      if (command.type === 'replace-paragraph-fragment') {
        return (
          sum +
          common +
          Buffer.byteLength(command.expectedFragment, 'utf8') +
          Buffer.byteLength(command.replacementFragment, 'utf8')
        )
      }
      if (command.type === 'apply-character-style' || command.type === 'apply-paragraph-style') {
        return sum + common + 32
      }
      if (command.type === 'restore-character-run') {
        const headerBytes = command.headerMutation
          ? Buffer.byteLength(command.headerMutation.fragment, 'utf8') +
            Buffer.byteLength(command.headerMutation.expectedCollectionOpenTag, 'utf8') +
            Buffer.byteLength(command.headerMutation.replacementCollectionOpenTag, 'utf8')
          : 0
        return (
          sum +
          common +
          headerBytes +
          Buffer.byteLength(command.expectedFragment, 'utf8') +
          Buffer.byteLength(command.replacementFragment, 'utf8')
        )
      }
      const headerBytes = command.headerMutation
        ? Buffer.byteLength(command.headerMutation.fragment, 'utf8') +
          Buffer.byteLength(command.headerMutation.expectedCollectionOpenTag, 'utf8') +
          Buffer.byteLength(command.headerMutation.replacementCollectionOpenTag, 'utf8')
        : 0
      return (
        sum +
        common +
        headerBytes +
        Buffer.byteLength(command.expectedReferenceTag, 'utf8') +
        Buffer.byteLength(command.replacementReferenceTag, 'utf8')
      )
    },
    256
  )
}

function entryBytes(forward: EditTransaction, inverse: EditTransaction): number {
  return commandBytes(forward) + commandBytes(inverse)
}

function combineTransactions(previous: EditTransaction, next: EditTransaction): EditTransaction {
  return {
    ...previous,
    id: `${previous.id}+${next.id}`,
    commands: [...previous.commands, ...next.commands],
    selectionAfter: next.selectionAfter,
    timestamp: next.timestamp
  }
}

function combineInverses(previous: EditTransaction, next: EditTransaction): EditTransaction {
  return {
    ...next,
    id: `${next.id}+${previous.id}`,
    commands: [...next.commands, ...previous.commands],
    selectionAfter: previous.selectionAfter
  }
}

export class HwpxEditHistory {
  private currentPackage: HwpxSourcePackage
  private currentSelection: EditorSelection | undefined
  private readonly undoStack: HistoryEntry[] = []
  private readonly redoStack: HistoryEntry[] = []
  private currentStateId = 0
  private savedStateId = 0
  private nextStateId = 1
  private estimatedBytes = 0
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly groupWindowMs: number

  constructor(sourcePackage: HwpxSourcePackage, options: EditHistoryOptions = {}) {
    this.currentPackage = sourcePackage
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.groupWindowMs = options.groupWindowMs ?? DEFAULT_GROUP_WINDOW_MS
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error('history maxEntries는 1 이상이어야 합니다.')
    }
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) {
      throw new Error('history maxBytes는 1 이상이어야 합니다.')
    }
    if (!Number.isFinite(this.groupWindowMs) || this.groupWindowMs < 0) {
      throw new Error('history groupWindowMs가 올바르지 않습니다.')
    }
  }

  get package(): HwpxSourcePackage {
    return this.currentPackage
  }

  get selection(): EditorSelection | undefined {
    return this.currentSelection ? { ...this.currentSelection } : undefined
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  get isDirty(): boolean {
    return this.currentStateId !== this.savedStateId
  }

  setSelection(selection: EditorSelection): void {
    validateEditorSelection(this.currentPackage, selection)
    this.currentSelection = { ...selection }
  }

  stats(): EditHistoryStats {
    return {
      undoEntries: this.undoStack.length,
      redoEntries: this.redoStack.length,
      estimatedBytes: this.estimatedBytes,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes
    }
  }

  commit(transaction: EditTransaction): EditTransactionResult {
    if (this.currentSelection) {
      const before = transaction.selectionBefore
      if (!equalEditorSelections(before, this.currentSelection)) {
        throw new Error('transaction selectionBefore가 현재 selection과 다릅니다.')
      }
    }

    const result = applyEditTransaction(this.currentPackage, transaction)
    if (!result.changed) return result
    if (!result.inverse) throw new Error('변경된 transaction에 inverse가 없습니다.')

    const previousEntry = this.undoStack[this.undoStack.length - 1]
    const canGroup =
      previousEntry &&
      previousEntry.afterStateId !== this.savedStateId &&
      shouldGroupTransactions(previousEntry.forward, transaction, this.groupWindowMs)

    let entry: HistoryEntry
    if (canGroup) {
      const forward = combineTransactions(previousEntry.forward, transaction)
      const inverse = combineInverses(previousEntry.inverse, result.inverse)
      const estimatedBytes = entryBytes(forward, inverse)
      this.assertEntryFits(estimatedBytes)
      this.undoStack.pop()
      this.estimatedBytes -= previousEntry.estimatedBytes
      entry = {
        forward,
        inverse,
        beforeStateId: previousEntry.beforeStateId,
        afterStateId: this.nextStateId++,
        estimatedBytes
      }
    } else {
      const estimatedBytes = entryBytes(transaction, result.inverse)
      this.assertEntryFits(estimatedBytes)
      entry = {
        forward: transaction,
        inverse: result.inverse,
        beforeStateId: this.currentStateId,
        afterStateId: this.nextStateId++,
        estimatedBytes
      }
    }

    for (const redoEntry of this.redoStack) this.estimatedBytes -= redoEntry.estimatedBytes
    this.redoStack.length = 0
    this.undoStack.push(entry)
    this.estimatedBytes += entry.estimatedBytes
    this.currentPackage = result.package
    this.currentSelection = { ...transaction.selectionAfter }
    this.currentStateId = entry.afterStateId
    this.trimUndoStack()
    return result
  }

  undo(): EditHistoryAction | undefined {
    const entry = this.undoStack[this.undoStack.length - 1]
    if (!entry) return undefined
    const transaction = rebaseTransaction(entry.inverse, this.currentPackage.revision)
    const result = applyEditTransaction(this.currentPackage, transaction)
    this.undoStack.pop()
    this.redoStack.push(entry)
    this.currentPackage = result.package
    this.currentSelection = { ...entry.forward.selectionBefore }
    this.currentStateId = entry.beforeStateId
    return {
      package: this.currentPackage,
      selection: { ...this.currentSelection },
      transaction
    }
  }

  redo(): EditHistoryAction | undefined {
    const entry = this.redoStack[this.redoStack.length - 1]
    if (!entry) return undefined
    const transaction = rebaseTransaction(entry.forward, this.currentPackage.revision)
    const result = applyEditTransaction(this.currentPackage, transaction)
    this.redoStack.pop()
    this.undoStack.push(entry)
    this.currentPackage = result.package
    this.currentSelection = { ...entry.forward.selectionAfter }
    this.currentStateId = entry.afterStateId
    return {
      package: this.currentPackage,
      selection: { ...this.currentSelection },
      transaction
    }
  }

  markSaved(): void {
    this.savedStateId = this.currentStateId
  }

  private assertEntryFits(estimatedBytes: number): void {
    if (estimatedBytes > this.maxBytes) {
      throw new HwpxHistoryLimitError(`편집 transaction이 history byte 제한(${this.maxBytes})을 초과합니다.`)
    }
  }

  private trimUndoStack(): void {
    while (this.undoStack.length > this.maxEntries || this.estimatedBytes > this.maxBytes) {
      const removed = this.undoStack.shift()
      if (!removed) break
      this.estimatedBytes -= removed.estimatedBytes
    }
  }
}
