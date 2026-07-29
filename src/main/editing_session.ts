import { randomUUID } from 'crypto'
import { extname } from 'path'
import {
  EditingActionResult,
  EditingCommitRequest,
  EditingStartResult
} from '../core/editing/editing_contract'
import { HwpxEditHistory } from '../core/editing/history'
import { EditTransaction, projectEditTransaction } from '../core/editing/transaction'
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
