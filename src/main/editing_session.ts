import { randomUUID } from 'crypto'
import { lstat, stat } from 'fs/promises'
import { basename, dirname, extname, join, resolve } from 'path'
import {
  EditingActionResult,
  EditingCharacterStyleRequest,
  EditingCellStyleRequest,
  EditingCommitRequest,
  EditingDeleteTableRowRequest,
  EditingDeleteTableColumnRequest,
  EditingInsertTableColumnRequest,
  EditingMergeTableCellRightRequest,
  EditingMergeParagraphRequest,
  EditingInsertTableRowRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingSplitTableCellRequest,
  EditingSavedResult,
  EditingStartResult
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import { editingCapabilities } from '../core/editing/editing_capability'
import { HwpxEditHistory } from '../core/editing/history'
import type { HwpxSaveLossPolicy } from '../core/editing/loss_policy'
import { planMergeParagraph, planSplitParagraph } from '../core/editing/paragraph_patch'
import { HwpxSaveAsError, saveHwpxAs } from '../core/editing/save_as'
import { planReplaceSelection } from '../core/editing/range_edit'
import {
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planInsertTableRowAfter,
  planMergeTableCellRight,
  planSplitTableCell
} from '../core/editing/table_patch'
import { reconcileTableCellSelection } from '../core/editing/table_cell_selection'
import { EditTransaction, projectEditTransaction } from '../core/editing/transaction'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../core/editing/text_patch'
import { HwpxSourcePackage } from '../core/parser/source_package'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'

interface EditingSession {
  id: string
  history: HwpxEditHistory
}

function assertHwpxPath(filePath: string): void {
  if (typeof filePath !== 'string' || extname(filePath).toLowerCase() !== '.hwpx') {
    throw new EditingOperationError(
      'EDITING_UNSUPPORTED',
      '편집 모드는 HWPX 문서만 지원합니다.'
    )
  }
}

export type SaveAsDestinationDecision = 'new' | 'replace' | 'protected' | 'invalid'

export interface EditingSaveAsOptions {
  /** OS 저장 대화상자가 기존 파일 교체를 이미 확인했을 때만 true. */
  overwrite?: boolean
}

export const PROTECTED_DESTINATION_MESSAGE =
  '열려 있는 원본 문서는 덮어쓸 수 없습니다. 다른 이름이나 다른 폴더를 선택해 주세요.'

export const INVALID_DESTINATION_MESSAGE =
  '저장 위치가 올바르지 않습니다. 폴더나 바로가기(심볼릭 링크)가 아닌 .hwpx 파일 이름을 지정해 주세요.'

/** PDF 내보내기(writeFileAtomically) 실패를 PDF 맥락의 한국어 안내로 바꾼다. */
export function pdfExportFailureMessage(reason: unknown): string {
  if (reason instanceof HwpxSaveAsError) {
    switch (reason.code) {
      case 'HWPX_SAVE_PROTECTED_DESTINATION':
        return '편집 중인 원본 문서 위치에는 PDF를 저장할 수 없습니다. 다른 .pdf 파일 이름을 지정해 주세요.'
      case 'HWPX_SAVE_INVALID_DESTINATION':
        return 'PDF 저장 위치가 올바르지 않습니다. 폴더나 바로가기(심볼릭 링크)가 아닌 .pdf 파일 이름을 지정해 주세요.'
      case 'HWPX_SAVE_DESTINATION_EXISTS':
        return '같은 이름의 파일이 이미 있어 PDF를 저장하지 않았습니다. 다른 이름을 지정해 주세요.'
      case 'HWPX_SAVE_FILESYSTEM':
        switch (reason.systemCode) {
          case 'EACCES':
          case 'EPERM':
          case 'EROFS':
          case 'EBUSY':
            return 'PDF 저장 위치에 쓸 권한이 없거나 기존 PDF가 다른 프로그램에서 열려 있습니다. 파일을 닫거나 다른 위치를 선택해 주세요.'
          case 'ENOSPC':
          case 'EDQUOT':
            return '저장 위치의 공간이 부족해 PDF를 저장하지 못했습니다.'
          default:
            return 'PDF 파일을 쓰지 못했습니다. 저장 위치와 파일 상태를 확인해 주세요.'
        }
    }
  }
  return reason instanceof Error ? reason.message : String(reason)
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}

export function saveAsFailureMessage(reason: unknown): string {
  if (reason instanceof HwpxSaveAsError) {
    switch (reason.code) {
      case 'HWPX_SAVE_PROTECTED_DESTINATION':
        return PROTECTED_DESTINATION_MESSAGE
      case 'HWPX_SAVE_DESTINATION_EXISTS':
        return '같은 이름의 파일이 이미 있어 저장하지 않았습니다. 교체를 확인했거나 다른 이름을 선택해 주세요.'
      case 'HWPX_SAVE_INVALID_DESTINATION':
        return INVALID_DESTINATION_MESSAGE
      case 'HWPX_SAVE_FILESYSTEM':
        switch (reason.systemCode) {
          case 'EACCES':
          case 'EPERM':
          case 'EROFS':
            return '저장 위치에 쓸 권한이 없거나 기존 파일이 다른 프로그램에서 열려 있습니다. 다른 위치를 선택하거나 파일을 닫고 다시 시도해 주세요.'
          case 'EBUSY':
            return '기존 파일이 다른 프로그램에서 사용 중이라 교체하지 못했습니다. 파일을 닫고 다시 시도해 주세요.'
          case 'EXDEV':
            return '저장 위치의 파일 시스템에서 원자적 교체를 지원하지 않아 저장하지 못했습니다. 다른 위치를 선택해 주세요.'
          case 'ENOSPC':
          case 'EDQUOT':
            return '저장 위치의 공간이 부족해 저장하지 못했습니다.'
          default:
            return '저장 위치에 파일을 쓰지 못했습니다. 목적지와 파일 상태를 확인해 주세요.'
        }
    }
  }
  return '변경본을 검증해 저장하지 못했습니다. 목적지와 파일 상태를 확인해 주세요.'
}

function status(session: EditingSession) {
  return {
    revision: session.history.package.revision,
    savedRevision: session.history.savedRevision,
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
    isDirty: session.history.isDirty
  }
}

export class EditingSessionManager {
  private readonly sessions = new Map<number, EditingSession>()
  private readonly queues = new Map<number, Promise<void>>()

  constructor(private readonly createSessionId: () => string = randomUUID) {}

  async start(senderId: number, filePath: string): Promise<EditingStartResult> {
    return this.enqueue(senderId, async () => {
      assertHwpxPath(filePath)
      const sourcePackage = await HwpxSourcePackage.open(filePath)
      const session: EditingSession = {
        id: this.createSessionId(),
        history: new HwpxEditHistory(sourcePackage)
      }
      this.sessions.set(senderId, session)
      return {
        sessionId: session.id,
        document: await decodeViewerDocument(sourcePackage),
        ...status(session)
      }
    })
  }

  async commit(senderId: number, request: EditingCommitRequest): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [
          {
            type: 'replace-text',
            sectionPath: request.sectionPath,
            textNodeId: request.textNodeId,
            from: request.from,
            to: request.to,
            insert: request.insert
          }
        ],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: { ...request.selectionAfter },
        inputType: request.inputType,
        compositionId: request.compositionId,
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async commitRange(senderId: number, request: EditingRangeCommitRequest): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const plan = planReplaceSelection(
        session.history.package,
        request.selectionBefore,
        request.insert
      )
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: plan.commands,
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: request.inputType,
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async splitParagraph(
    senderId: number,
    request: EditingSplitParagraphRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const plan = planSplitParagraph(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'insertParagraph',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async mergeParagraph(
    senderId: number,
    request: EditingMergeParagraphRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const plan = planMergeParagraph(
        session.history.package,
        request.selectionBefore,
        request.direction
      )
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: request.inputType,
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async applyCharacterStyle(
    senderId: number,
    request: EditingCharacterStyleRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      if (
        request.selection.anchorTextNodeId !== request.selection.focusTextNodeId ||
        request.selection.anchorTextNodeId !== request.textNodeId
      ) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '여러 글자 run에 걸친 style 적용은 아직 지원하지 않습니다.'
        )
      }
      const from = Math.min(request.selection.anchorOffset, request.selection.focusOffset)
      const to = Math.max(request.selection.anchorOffset, request.selection.focusOffset)
      const anchor = listHwpxTextAnchors(session.history.package, request.sectionPath).find(
        (candidate) => candidate.textNodeId === request.textNodeId
      )
      if (!anchor) throw new HwpxEditConflictError('글자 style 기준 위치를 찾을 수 없습니다.')
      const splitSelection =
        from !== to && (from > 0 || to < anchor.text.length)
          ? {
              sectionPath: request.sectionPath,
              anchorTextNodeId: `${request.sectionPath}#hp:t:${anchor.ordinal + (from > 0 ? 1 : 0)}`,
              anchorOffset: request.selection.anchorOffset <= request.selection.focusOffset
                ? 0
                : to - from,
              focusTextNodeId: `${request.sectionPath}#hp:t:${anchor.ordinal + (from > 0 ? 1 : 0)}`,
              focusOffset: request.selection.anchorOffset <= request.selection.focusOffset
                ? to - from
                : 0
            }
          : { ...request.selection }
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [
          {
            type: 'apply-character-style',
            sectionPath: request.sectionPath,
            textNodeId: request.textNodeId,
            bold: request.bold,
            italic: request.italic,
            underline: request.underline,
            strikeout: request.strikeout,
            height: request.height,
            color: request.color,
            fontId: request.fontId,
            from,
            to
          }
        ],
        selectionBefore: { ...request.selection },
        selectionAfter: splitSelection,
        inputType:
          request.bold !== undefined
            ? 'formatBold'
            : request.italic !== undefined
              ? 'formatItalic'
              : request.underline !== undefined
                ? 'formatUnderline'
                : request.strikeout !== undefined
                  ? 'formatStrikeThrough'
            : request.height !== undefined
              ? 'formatFontSize'
              : request.color !== undefined
                ? 'formatFontColor'
                : 'formatFontName',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async applyParagraphStyle(
    senderId: number,
    request: EditingParagraphStyleRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [
          {
            type: 'apply-paragraph-style',
            sectionPath: request.sectionPath,
            textNodeId: request.textNodeId,
            align: request.align,
            lineSpacing: request.lineSpacing,
            indent: request.indent,
            marginBefore: request.marginBefore,
            marginAfter: request.marginAfter
          }
        ],
        selectionBefore: { ...request.selection },
        selectionAfter: { ...request.selection },
        inputType: request.align !== undefined
          ? `formatAlign${request.align}`
          : request.lineSpacing !== undefined
            ? 'formatLineSpacing'
            : request.indent !== undefined
              ? 'formatIndent'
              : request.marginBefore !== undefined
                ? 'formatParagraphBefore'
                : 'formatParagraphAfter',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async undo(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, sessionId)
      const action = session.history.undo()
      return {
        document: await decodeViewerDocument(session.history.package),
        selection: action?.selection ?? session.history.selection,
        ...status(session)
      }
    })
  }

  async redo(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, sessionId)
      const action = session.history.redo()
      return {
        document: await decodeViewerDocument(session.history.package),
        selection: action?.selection ?? session.history.selection,
        ...status(session)
      }
    })
  }

  async applyCellStyle(
    senderId: number,
    request: EditingCellStyleRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selection
      )
      if (!capabilities.cellStyle.available || capabilities.focus?.textNodeId !== request.textNodeId) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '표 셀 모양은 하나의 안전한 일반 body 셀을 선택했을 때만 바꿀 수 있습니다.'
        )
      }
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [{
          type: 'apply-cell-style',
          sectionPath: request.sectionPath,
          textNodeId: request.textNodeId,
          backgroundColor: request.backgroundColor,
          borderColor: request.borderColor,
          borderWidth: request.borderWidth,
          borderType: request.borderType
        }],
        selectionBefore: { ...request.selection },
        selectionAfter: { ...request.selection },
        inputType: 'formatTableCell',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async insertTableRowAfter(
    senderId: number,
    request: EditingInsertTableRowRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selectionBefore
      )
      if (!capabilities.cellStyle.available) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '행 추가는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
        )
      }
      const plan = planInsertTableRowAfter(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'insertTableRowAfter',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async deleteTableRow(
    senderId: number,
    request: EditingDeleteTableRowRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selectionBefore
      )
      if (!capabilities.cellStyle.available) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '행 삭제는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
        )
      }
      const plan = planDeleteTableRow(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'deleteTableRow',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async insertTableColumnAfter(
    senderId: number,
    request: EditingInsertTableColumnRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selectionBefore
      )
      if (!capabilities.cellStyle.available) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '열 추가는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
        )
      }
      const plan = planInsertTableColumnAfter(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'insertTableColumnAfter',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async deleteTableColumn(
    senderId: number,
    request: EditingDeleteTableColumnRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selectionBefore
      )
      if (!capabilities.cellStyle.available) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '열 삭제는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
        )
      }
      const plan = planDeleteTableColumn(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'deleteTableColumn',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async mergeTableCellRight(
    senderId: number,
    request: EditingMergeTableCellRightRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const capabilities = editingCapabilities(
        await decodeViewerDocument(session.history.package),
        request.selectionBefore
      )
      if (!capabilities.cellStyle.available) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '셀 병합은 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
        )
      }
      const plan = planMergeTableCellRight(session.history.package, request.selectionBefore)
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore: { ...request.selectionBefore },
        selectionAfter: plan.selectionAfter,
        inputType: 'mergeTableCellRight',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: undefined,
        ...status(session)
      }
    })
  }

  async splitTableCell(
    senderId: number,
    request: EditingSplitTableCellRequest
  ): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, request.sessionId)
      const document = await decodeViewerDocument(session.history.package)
      const projection = reconcileTableCellSelection(document, request.selection)
      if (projection.status !== 'CURRENT' || !projection.selection) {
        throw new EditingOperationError(
          'EDITING_UNSUPPORTED',
          '분할할 병합 표 셀 선택이 현재 문서와 일치하지 않습니다.'
        )
      }
      const plan = planSplitTableCell(session.history.package, projection.selection)
      const selectionBefore = {
        sectionPath: projection.selection.sectionPath,
        anchorTextNodeId: projection.selection.textNodeId,
        anchorOffset: 0,
        focusTextNodeId: projection.selection.textNodeId,
        focusOffset: 0
      }
      const transaction: EditTransaction = {
        id: request.transactionId,
        baseRevision: session.history.package.revision,
        commands: [plan.command],
        selectionBefore,
        selectionAfter: plan.selectionAfter,
        inputType: 'splitTableCell',
        timestamp: request.timestamp
      }
      const result = session.history.commitSynchronized(transaction)
      return {
        document: await projectEditTransaction(result),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  async refresh(senderId: number, sessionId: string): Promise<EditingActionResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, sessionId)
      return {
        document: await decodeViewerDocument(session.history.package),
        selection: session.history.selection,
        ...status(session)
      }
    })
  }

  suggestedSaveAsPath(senderId: number, sessionId: string): string {
    const session = this.requireSession(senderId, sessionId)
    const sourcePath = session.history.package.sourcePath
    const extension = extname(sourcePath)
    const stem = basename(sourcePath, extension)
    return join(dirname(sourcePath), `${stem}_수정본.hwpx`)
  }

  currentSessionId(senderId: number): string | undefined {
    return this.sessions.get(senderId)?.id
  }

  isDirty(senderId: number, sessionId?: string): boolean {
    const session = this.sessions.get(senderId)
    if (!session || (sessionId !== undefined && session.id !== sessionId)) return false
    return session.history.isDirty
  }

  async lossPolicy(senderId: number, sessionId: string): Promise<HwpxSaveLossPolicy> {
    return this.enqueue(senderId, async () =>
      this.requireSession(senderId, sessionId).history.saveLossPolicy
    )
  }

  /** 원본 보호 대상: 열려 있는 모든 편집 session의 원본 경로. PDF 내보내기도 같은 목록을 쓴다. */
  protectedSourcePaths(): string[] {
    return [...this.sessions.values()].map((session) => session.history.package.sourcePath)
  }

  /**
   * 저장 대화상자에서 고른 경로를 어떻게 다룰지 결정한다.
   * 원본(또는 다른 session의 원본)이면 protected, 일반 파일이 아니면(심볼릭 링크·폴더 등) invalid,
   * 이미 있는 다른 파일이면 replace, 없으면 new. 목적지는 lstat으로 보므로 링크를 따라가지 않는다.
   */
  async saveAsDestinationDecision(
    senderId: number,
    sessionId: string,
    destinationPath: string
  ): Promise<SaveAsDestinationDecision> {
    this.requireSession(senderId, sessionId)
    const protectedPaths = this.protectedSourcePaths()
    if (protectedPaths.some((path) => samePath(path, destinationPath))) return 'protected'
    let destinationStats: Awaited<ReturnType<typeof lstat>>
    try {
      destinationStats = await lstat(destinationPath)
    } catch {
      return 'new'
    }
    if (!destinationStats.isFile()) return 'invalid'
    for (const path of protectedPaths) {
      const protectedStats = await stat(path).catch(() => undefined)
      if (
        protectedStats &&
        protectedStats.ino !== 0 &&
        protectedStats.dev === destinationStats.dev &&
        protectedStats.ino === destinationStats.ino
      ) {
        return 'protected'
      }
    }
    return 'replace'
  }

  async saveAs(
    senderId: number,
    sessionId: string,
    destinationPath: string,
    options: EditingSaveAsOptions = {}
  ): Promise<EditingSavedResult> {
    return this.enqueue(senderId, async () => {
      const session = this.requireSession(senderId, sessionId)
      if (!session.history.isDirty) {
        throw new EditingOperationError(
          'EDITING_NOT_APPLICABLE',
          '저장할 HWPX 변경 내용이 없습니다.'
        )
      }
      let result: Awaited<ReturnType<typeof saveHwpxAs>>
      const lossPolicy = session.history.saveLossPolicy
      try {
        result = await saveHwpxAs(session.history.package, destinationPath, {
          overwrite: options.overwrite === true,
          protectedPaths: this.protectedSourcePaths()
        })
      } catch (reason) {
        throw new EditingOperationError('EDITING_SAVE_FAILED', saveAsFailureMessage(reason), 'retry')
      }
      session.history.markSaved()
      return {
        destinationPath: result.destinationPath,
        entryCount: result.entryCount,
        previewStatus: lossPolicy.previewStatus,
        lossPolicy,
        ...status(session)
      }
    })
  }

  stop(senderId: number): void {
    this.sessions.delete(senderId)
    this.queues.delete(senderId)
  }

  private requireSession(senderId: number, sessionId: string): EditingSession {
    const session = this.sessions.get(senderId)
    if (!session || session.id !== sessionId) {
      throw new EditingOperationError(
        'EDITING_SESSION_EXPIRED',
        '편집 session이 종료되었습니다. 문서를 다시 열어 주세요.',
        'restart-session'
      )
    }
    return session
  }

  private enqueue<T>(senderId: number, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(senderId) ?? Promise.resolve()
    const result = previous.then(action)
    this.queues.set(
      senderId,
      result.then(
        () => undefined,
        () => undefined
      )
    )
    return result
  }
}
