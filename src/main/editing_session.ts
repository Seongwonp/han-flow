import { randomUUID } from 'crypto'
import { basename, dirname, extname, join } from 'path'
import {
  EditingActionResult,
  EditingCharacterStyleRequest,
  EditingCommitRequest,
  EditingParagraphStyleRequest,
  EditingSavedResult,
  EditingStartResult
} from '../core/editing/editing_contract'
import { HwpxEditHistory } from '../core/editing/history'
import { saveHwpxAs } from '../core/editing/save_as'
import { EditTransaction, projectEditTransaction } from '../core/editing/transaction'
import { listHwpxTextAnchors } from '../core/editing/text_patch'
import { HwpxSourcePackage } from '../core/parser/source_package'
import { decodeViewerDocument } from '../core/parser/viewer_decoder'

interface EditingSession {
  id: string
  history: HwpxEditHistory
}

function assertHwpxPath(filePath: string): void {
  if (typeof filePath !== 'string' || extname(filePath).toLowerCase() !== '.hwpx') {
    throw new Error('편집 모드는 HWPX 문서만 지원합니다.')
  }
}

function status(session: EditingSession) {
  return {
    revision: session.history.package.revision,
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
      session.history.setSelection(transaction.selectionBefore)
      const result = session.history.commit(transaction)
      return {
        document: result.changed
          ? await projectEditTransaction(result)
          : await decodeViewerDocument(session.history.package),
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
      const from = Math.min(request.selection.anchorOffset, request.selection.focusOffset)
      const to = Math.max(request.selection.anchorOffset, request.selection.focusOffset)
      const anchor = listHwpxTextAnchors(session.history.package, request.sectionPath).find(
        (candidate) => candidate.textNodeId === request.textNodeId
      )
      if (!anchor) throw new Error(`글자 style anchor를 찾을 수 없습니다: ${request.textNodeId}`)
      const splitSelection =
        from !== to && (from > 0 || to < anchor.text.length)
          ? {
              sectionPath: request.sectionPath,
              textNodeId: `${request.sectionPath}#hp:t:${anchor.ordinal + (from > 0 ? 1 : 0)}`,
              anchorOffset: request.selection.anchorOffset <= request.selection.focusOffset
                ? 0
                : to - from,
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
      session.history.setSelection(transaction.selectionBefore)
      const result = session.history.commit(transaction)
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
            : request.marginBefore !== undefined
              ? 'formatParagraphBefore'
              : 'formatParagraphAfter',
        timestamp: request.timestamp
      }
      session.history.setSelection(transaction.selectionBefore)
      const result = session.history.commit(transaction)
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
      if (!session.history.isDirty) throw new Error('저장할 HWPX 변경 내용이 없습니다.')
      const result = await saveHwpxAs(session.history.package, destinationPath)
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
      throw new Error('유효하지 않거나 종료된 HWPX 편집 session입니다.')
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
