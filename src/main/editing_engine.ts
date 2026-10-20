import { createHash } from 'crypto'
import { open } from 'fs/promises'
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
  EditingInsertFootnoteRequest,
  EditingDeleteFootnoteRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingSplitTableCellRequest,
  EditingHistoryStatus,
  EditingProjection,
  EditingSavedResult
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import { editingCapabilities } from '../core/editing/editing_capability'
import { HwpxEditHistory } from '../core/editing/history'
import type { HwpxSaveLossPolicy } from '../core/editing/loss_policy'
import { planMergeParagraph, planSplitParagraph } from '../core/editing/paragraph_patch'
import { parseEndnotePath, planDeleteEndnote, planDeleteFootnote, planInsertEndnote, planInsertFootnote } from '../core/editing/footnote_patch'
import { saveHwpxAs } from '../core/editing/save_as'
import { planReplaceSelection } from '../core/editing/range_edit'
import {
  planDeleteTableColumn,
  planDeleteTableRow,
  planInsertTableColumnAfter,
  planInsertTableRowAfter,
  planMergeTableCellRight,
  planSplitTableCell
} from '../core/editing/table_patch'
import { assertReplayableTransaction } from '../core/editing/replay_guard'
import { reconcileTableCellSelection } from '../core/editing/table_cell_selection'
import type { EditTransaction } from '../core/editing/transaction'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../core/editing/text_patch'
import type { ViewerDocument } from '../core/document/viewer_document'
import { HwpxSourcePackage, MAX_HWPX_TOTAL_BYTES } from '../core/parser/source_package'
import { ViewerProjectionCache } from '../core/parser/viewer_projection'
import { saveAsFailureMessage } from './editing_save_messages'
import {
  decodeRecoveryJournalFor,
  RecoveryJournalError,
  type RecoveryJournalEntry,
  type RecoveryJournalHeader,
  type RecoveryJournalLimits,
  type RecoverySourceFingerprint
} from './recovery_journal'

export interface EditingEngineSaveRequest {
  destinationPath: string
  /** OS 저장 대화상자가 기존 파일 교체를 이미 확인했을 때만 true. */
  overwrite: boolean
  /** 다른 편집 session의 원본 등 덮어쓰면 안 되는 경로. 이 session의 원본은 save_as가 항상 보호한다. */
  protectedPaths: readonly string[]
  /** 임시 파일 이름 UUID. main이 정해 worker가 강제 종료돼도 남은 임시 파일을 지울 수 있게 한다. */
  temporaryToken?: string
}

export type EditingEngineSaveResult = EditingSavedResult

/** 편집할 수 있는 HWPX 파일 크기 상한. 압축 해제 전체 한도에 ZIP header·central directory 여유를 더한 값이다. */
export const MAX_EDITING_SOURCE_BYTES = MAX_HWPX_TOTAL_BYTES + 64 * 1024 * 1024

/**
 * 원본 파일을 한 번 읽어 bytes와 지문(크기·수정 시각·SHA-256)을 돌려준다. 연 handle의 fstat을 읽기 전후로 비교해 읽는 사이
 * 바뀐 파일은 거부한다(경로를 두 번 열지 않으므로 지문과 bytes가 다른 파일에서 나오지 않는다).
 */
export async function readFileWithFingerprint(
  filePath: string
): Promise<{ bytes: Buffer; fingerprint: RecoverySourceFingerprint }> {
  const handle = await open(filePath, 'r')
  try {
    const before = await handle.stat()
    if (!before.isFile()) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '문서 경로가 일반 파일이 아닙니다.')
    }
    if (before.size > MAX_EDITING_SOURCE_BYTES) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        `문서 파일이 편집 한도(${Math.round(MAX_EDITING_SOURCE_BYTES / 1024 / 1024)} MiB)보다 큽니다.`
      )
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        '편집을 준비하는 동안 문서 파일이 바뀌었습니다. 다시 열어 주세요.'
      )
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { bytes, fingerprint: { size: after.size, mtimeMs: after.mtimeMs, sha256 } }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** 기록 replay 결과. 전체 기록은 worker가 해석하므로 편집 수·끊긴 꼬리 여부도 여기서 main에 알린다. */
export type EditingReplayResult = EditingActionResult & {
  replayedEntries: number
  replayedEdits: number
  tornTail: boolean
}

/**
 * 편집 session 하나의 엔진. `HwpxSourcePackage`·source tree cache·`HwpxEditHistory`·transaction·projection
 * 디코딩·Save As 검증을 모두 소유한다. production에서는 편집 worker(`editing_worker.ts`) 안에서만 만들고,
 * main process는 `EditingSessionManager`를 통해 structured-clone 요청으로만 접근한다.
 */
export class EditingEngine {
  /** 마지막 응답 뒤 history에 일어난 일. worker가 응답에 실어 main의 복구 기록(`recovery_journal.ts`)으로 보낸다. */
  private journal: RecoveryJournalEntry[] = []

  private constructor(
    private readonly history: HwpxEditHistory,
    private readonly projection: ViewerProjectionCache
  ) {}

  static async open(
    filePath: string
  ): Promise<{
    engine: EditingEngine
    document: ViewerDocument
    projectionId: number
    source: RecoverySourceFingerprint
  }> {
    // 원본을 한 번만 읽어 그 bytes로 package를 열고 복구 기록 header에 넣을 SHA-256도 계산한다. 지문과 편집하는 package가
    // 언제나 같은 bytes에서 나온다. 읽는 동안 파일이 바뀌면(크기·수정 시각) 편집을 시작하지 않는다.
    const { bytes, fingerprint: source } = await readFileWithFingerprint(filePath)
    const sourcePackage = await HwpxSourcePackage.open(filePath, bytes)
    const { cache, result } = await ViewerProjectionCache.open(sourcePackage)
    const engine = new EditingEngine(new HwpxEditHistory(sourcePackage), cache)
    return { engine, document: result.document, projectionId: result.projectionId, source }
  }

  /** 쌓인 복구 기록 record를 넘기고 비운다. */
  takeJournal(): RecoveryJournalEntry[] {
    const entries = this.journal
    this.journal = []
    return entries
  }

  /** 모든 편집 command가 지나가는 commit. history가 받아들인 transaction만 그대로 기록한다(replay가 같은 경로를 탄다). */
  private commitTransaction(transaction: EditTransaction, at = Date.now()): void {
    this.history.commitSynchronized(transaction)
    this.journal.push({ type: 'commit', revision: this.history.package.revision, at, transaction })
  }

  private undoHistory(at = Date.now()): ReturnType<HwpxEditHistory['undo']> {
    const action = this.history.undo()
    if (action) this.journal.push({ type: 'undo', revision: this.history.package.revision, at })
    return action
  }

  private redoHistory(at = Date.now()): ReturnType<HwpxEditHistory['redo']> {
    const action = this.history.redo()
    if (action) this.journal.push({ type: 'redo', revision: this.history.package.revision, at })
    return action
  }

  private markSaved(at = Date.now()): void {
    this.history.markSaved()
    this.journal.push({ type: 'saved', revision: this.history.package.revision, at })
  }

  /**
   * main이 header만 확인하고 넘긴 기록 bytes를 여기(편집 worker)서 끝까지 해석·검증한 뒤 replay한다. 기록이 손상됐거나
   * 제안할 때 본 header와 다르면 EDITING_RECOVERY_FAILED(main이 기록을 격리한다).
   */
  async replayJournal(
    expectedHeader: RecoveryJournalHeader,
    journal: Uint8Array,
    limits?: RecoveryJournalLimits
  ): Promise<EditingReplayResult> {
    let decoded: ReturnType<typeof decodeRecoveryJournalFor>
    try {
      const bytes = Buffer.from(journal.buffer, journal.byteOffset, journal.byteLength)
      decoded = decodeRecoveryJournalFor(expectedHeader, bytes, limits)
    } catch (reason) {
      if (!(reason instanceof RecoveryJournalError)) throw reason
      throw new EditingOperationError('EDITING_RECOVERY_FAILED', `복구 기록이 손상되어 되살릴 수 없습니다: ${reason.message}`, 'none')
    }
    const result = await this.replay(decoded.entries)
    return {
      ...result,
      replayedEntries: decoded.entries.length,
      replayedEdits: decoded.entries.filter((entry) => entry.type === 'commit').length,
      tornTail: decoded.tornTail
    }
  }

  /**
   * 복구 기록을 처음부터 다시 적용한다. live 편집과 같은 commit·undo·redo·저장 지점 경로를 타고, 단계마다 기록된 revision과
   * 맞는지 확인한다. commit은 적용 전에 forward command 종류와 문단·표 교체 fragment 구조를 확인한다(`replay_guard.ts`).
   * 하나라도 어긋나면 EDITING_RECOVERY_FAILED. 적용한 record는 다시 기록으로 내보내 새 session의 기록이 된다.
   */
  async replay(entries: readonly RecoveryJournalEntry[]): Promise<EditingActionResult> {
    if (this.history.package.revision !== 0 || this.history.canUndo || this.history.canRedo) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '복구 기록은 새로 연 편집 session에만 적용할 수 있습니다.')
    }
    entries.forEach((entry, index) => {
      try {
        switch (entry.type) {
          case 'commit':
            // 기록 파일은 앱 밖에서 바뀔 수 있다. planner를 거치지 않으므로 live 편집이 만들 수 있는 command인지 먼저 본다.
            assertReplayableTransaction(entry.transaction, this.history.package)
            this.commitTransaction(entry.transaction, entry.at)
            break
          case 'undo':
            if (!this.undoHistory(entry.at)) throw new Error('실행 취소할 편집이 없습니다.')
            break
          case 'redo':
            if (!this.redoHistory(entry.at)) throw new Error('다시 실행할 편집이 없습니다.')
            break
          case 'saved':
            this.markSaved(entry.at)
            break
          default:
            throw new Error('알 수 없는 기록입니다.')
        }
        if (this.history.package.revision !== entry.revision) {
          throw new Error(`revision이 기록(${entry.revision})과 다릅니다(${this.history.package.revision}).`)
        }
      } catch (reason) {
        throw new EditingOperationError(
          'EDITING_RECOVERY_FAILED',
          `복구 기록 ${index + 1}/${entries.length}번째 단계를 적용하지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`,
          'none'
        )
      }
    })
    return this.refresh()
  }

  /**
   * 현재 history package의 projection. 앞 projection에 대한 증분 patch(바뀐 section만)를 돌려주고, 증분으로 만들 수 없으면
   * 전체 문서를 돌려준다(규칙은 `viewer_projection.ts`). renderer는 patch의 `baseProjectionId`가 자기 문서와 다르면 refresh한다.
   */
  private async project(): Promise<EditingProjection> {
    const result = await this.projection.update(this.history.package)
    return result.patch
      ? { patch: result.patch }
      : { document: result.document, projectionId: result.projectionId }
  }

  get sourcePath(): string {
    return this.history.package.sourcePath
  }

  status(): EditingHistoryStatus {
    return {
      revision: this.history.package.revision,
      savedRevision: this.history.savedRevision,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      isDirty: this.history.isDirty
    }
  }

  async commit(request: EditingCommitRequest): Promise<EditingActionResult> {
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
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
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async commitRange(request: EditingRangeCommitRequest): Promise<EditingActionResult> {
    const plan = planReplaceSelection(
      this.history.package,
      request.selectionBefore,
      request.insert
    )
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: plan.commands,
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: request.inputType,
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async splitParagraph(request: EditingSplitParagraphRequest): Promise<EditingActionResult> {
    const plan = planSplitParagraph(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'insertParagraph',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async mergeParagraph(request: EditingMergeParagraphRequest): Promise<EditingActionResult> {
    const plan = planMergeParagraph(
      this.history.package,
      request.selectionBefore,
      request.direction
    )
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: request.inputType,
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async applyCharacterStyle(request: EditingCharacterStyleRequest): Promise<EditingActionResult> {
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
    const anchor = listHwpxTextAnchors(this.history.package, request.sectionPath).find(
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
      baseRevision: this.history.package.revision,
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
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async applyParagraphStyle(request: EditingParagraphStyleRequest): Promise<EditingActionResult> {
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
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
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async undo(): Promise<EditingActionResult> {
    const action = this.undoHistory()
    return {
      ...(await this.project()),
      selection: action?.selection ?? this.history.selection,
      ...this.status()
    }
  }

  async redo(): Promise<EditingActionResult> {
    const action = this.redoHistory()
    return {
      ...(await this.project()),
      selection: action?.selection ?? this.history.selection,
      ...this.status()
    }
  }

  async applyCellStyle(request: EditingCellStyleRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
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
      baseRevision: this.history.package.revision,
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
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async insertFootnote(request: EditingInsertFootnoteRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    const endnote = request.noteKind === 'endnote'
    const capability = endnote ? capabilities.endnote : capabilities.footnote
    if (!capability.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        capability.reason === 'NOTE_IN_HEADER_FOOTER'
          ? '머리말·꼬리말에는 각주·미주를 넣을 수 없습니다.'
          : `${endnote ? '미주' : '각주'}는 본문·표 셀·글상자 문단 글자 사이 caret 위치에만 넣을 수 있습니다.`
      )
    }
    const plan = endnote
      ? planInsertEndnote(this.history.package, request.selectionBefore)
      : planInsertFootnote(this.history.package, request.selectionBefore)
    this.commitTransaction({
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: endnote ? 'insertEndnote' : 'insertFootnote',
      timestamp: request.timestamp
    })
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async deleteFootnote(request: EditingDeleteFootnoteRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    const endnote = parseEndnotePath(request.selectionBefore.sectionPath, request.notePath) !== undefined
    const focusPath = endnote ? capabilities.focus?.endnotePath : capabilities.focus?.footnotePath
    if (!capabilities.selection.available || focusPath !== request.notePath) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        endnote ? '지울 미주의 본문에 caret을 두고 미주를 지울 수 있습니다.' : '지울 각주의 본문에 caret을 두고 각주를 지울 수 있습니다.'
      )
    }
    const plan = endnote
      ? planDeleteEndnote(this.history.package, request.selectionBefore, request.notePath)
      : planDeleteFootnote(this.history.package, request.selectionBefore, request.notePath)
    this.commitTransaction({
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: endnote ? 'deleteEndnote' : 'deleteFootnote',
      timestamp: request.timestamp
    })
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async insertTableRowAfter(request: EditingInsertTableRowRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    if (!capabilities.cellStyle.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '행 추가는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
      )
    }
    const plan = planInsertTableRowAfter(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'insertTableRowAfter',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async deleteTableRow(request: EditingDeleteTableRowRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    if (!capabilities.cellStyle.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '행 삭제는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
      )
    }
    const plan = planDeleteTableRow(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'deleteTableRow',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async insertTableColumnAfter(request: EditingInsertTableColumnRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    if (!capabilities.cellStyle.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '열 추가는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
      )
    }
    const plan = planInsertTableColumnAfter(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'insertTableColumnAfter',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async deleteTableColumn(request: EditingDeleteTableColumnRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    if (!capabilities.cellStyle.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '열 삭제는 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
      )
    }
    const plan = planDeleteTableColumn(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'deleteTableColumn',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async mergeTableCellRight(request: EditingMergeTableCellRightRequest): Promise<EditingActionResult> {
    const capabilities = editingCapabilities(
      await this.projection.documentFor(this.history.package),
      request.selectionBefore
    )
    if (!capabilities.cellStyle.available) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '셀 병합은 하나의 안전한 일반 body 셀을 선택했을 때만 실행할 수 있습니다.'
      )
    }
    const plan = planMergeTableCellRight(this.history.package, request.selectionBefore)
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore: { ...request.selectionBefore },
      selectionAfter: plan.selectionAfter,
      inputType: 'mergeTableCellRight',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: undefined,
      ...this.status()
    }
  }

  async splitTableCell(request: EditingSplitTableCellRequest): Promise<EditingActionResult> {
    const document = await this.projection.documentFor(this.history.package)
    const projection = reconcileTableCellSelection(document, request.selection)
    if (projection.status !== 'CURRENT' || !projection.selection) {
      throw new EditingOperationError(
        'EDITING_UNSUPPORTED',
        '분할할 병합 표 셀 선택이 현재 문서와 일치하지 않습니다.'
      )
    }
    const plan = planSplitTableCell(this.history.package, projection.selection)
    const selectionBefore = {
      sectionPath: projection.selection.sectionPath,
      anchorTextNodeId: projection.selection.textNodeId,
      anchorOffset: 0,
      focusTextNodeId: projection.selection.textNodeId,
      focusOffset: 0
    }
    const transaction: EditTransaction = {
      id: request.transactionId,
      baseRevision: this.history.package.revision,
      commands: [plan.command],
      selectionBefore,
      selectionAfter: plan.selectionAfter,
      inputType: 'splitTableCell',
      timestamp: request.timestamp
    }
    this.commitTransaction(transaction)
    return {
      ...(await this.project()),
      selection: this.history.selection,
      ...this.status()
    }
  }

  async refresh(): Promise<EditingActionResult> {
    // 충돌 복구 등 renderer가 projection을 다시 맞출 때 쓴다. cache를 믿지 않고 처음부터 해석해 전체 문서를 보낸다.
    const rebuilt = await this.projection.rebuild(this.history.package, 'refresh')
    return {
      document: rebuilt.document,
      projectionId: rebuilt.projectionId,
      selection: this.history.selection,
      ...this.status()
    }
  }

  lossPolicy(): HwpxSaveLossPolicy {
    return this.history.saveLossPolicy
  }

  /** @param onPublished 검증을 마친 저장 파일을 목적지에 게시한 직후(임시 이름 정리·폴더 동기화 전) 부른다. */
  async saveAs(request: EditingEngineSaveRequest, onPublished?: () => void): Promise<EditingEngineSaveResult> {
    if (!this.history.isDirty) {
      throw new EditingOperationError(
        'EDITING_NOT_APPLICABLE',
        '저장할 HWPX 변경 내용이 없습니다.'
      )
    }
    let result: Awaited<ReturnType<typeof saveHwpxAs>>
    const lossPolicy = this.history.saveLossPolicy
    try {
      result = await saveHwpxAs(this.history.package, request.destinationPath, {
        overwrite: request.overwrite === true,
        protectedPaths: request.protectedPaths,
        temporaryToken: request.temporaryToken,
        onPublished
      })
    } catch (reason) {
      throw new EditingOperationError('EDITING_SAVE_FAILED', saveAsFailureMessage(reason), 'retry')
    }
    this.markSaved()
    return {
      destinationPath: result.destinationPath,
      entryCount: result.entryCount,
      previewStatus: lossPolicy.previewStatus,
      lossPolicy,
      ...this.status()
    }
  }
}
