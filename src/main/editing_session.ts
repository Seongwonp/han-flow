import { randomUUID } from 'crypto'
import { basename, dirname, extname, join } from 'path'
import {
  EditingActionResult,
  EditingCharacterStyleRequest,
  EditingCommitRequest,
  EditingMergeParagraphRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingSavedResult,
  EditingStartResult
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import { HwpxEditHistory } from '../core/editing/history'
import { planMergeParagraph, planSplitParagraph } from '../core/editing/paragraph_patch'
import { saveHwpxAs } from '../core/editing/save_as'
import { planReplaceSelection } from '../core/editing/range_edit'
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
              : 'formatFontColor',
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

  async saveAs(
    senderId: number,
    sessionId: string,
    destinationPath: string
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
      try {
        result = await saveHwpxAs(session.history.package, destinationPath)
      } catch {
        throw new EditingOperationError(
          'EDITING_SAVE_FAILED',
          '변경본을 검증해 저장하지 못했습니다. 목적지와 파일 상태를 확인해 주세요.',
          'retry'
        )
      }
      session.history.markSaved()
      const hasPreview = session.history.package
        .listEntries()
        .some((entry) => entry.path.startsWith('Preview/'))
      return {
        destinationPath: result.destinationPath,
        entryCount: result.entryCount,
        previewStatus: hasPreview ? 'stale' : 'omitted',
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
