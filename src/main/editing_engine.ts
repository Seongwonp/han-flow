import { stat } from 'fs/promises'
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
  EditingHistoryStatus,
  EditingProjection,
  EditingSavedResult
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import { editingCapabilities } from '../core/editing/editing_capability'
import { HwpxEditHistory } from '../core/editing/history'
import type { HwpxSaveLossPolicy } from '../core/editing/loss_policy'
import { planMergeParagraph, planSplitParagraph } from '../core/editing/paragraph_patch'
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
import { reconcileTableCellSelection } from '../core/editing/table_cell_selection'
import type { EditTransaction } from '../core/editing/transaction'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../core/editing/text_patch'
import type { ViewerDocument } from '../core/document/viewer_document'
import { HwpxSourcePackage } from '../core/parser/source_package'
import { ViewerProjectionCache } from '../core/parser/viewer_projection'
import { saveAsFailureMessage } from './editing_save_messages'
import { fingerprintFile, type RecoveryJournalEntry, type RecoverySourceFingerprint } from './recovery_journal'

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
    // 복구 기록 header에 넣을 원본 지문. 읽는 동안 파일이 바뀌면(크기·수정 시각) 편집을 시작하지 않는다.
    const [sourcePackage, source] = await Promise.all([HwpxSourcePackage.open(filePath), fingerprintFile(filePath)])
    const after = await stat(filePath)
    if (after.size !== source.size || after.mtimeMs !== source.mtimeMs) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        '편집을 준비하는 동안 문서 파일이 바뀌었습니다. 다시 열어 주세요.'
      )
    }
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
   * 복구 기록을 처음부터 다시 적용한다. live 편집과 같은 commit·undo·redo·저장 지점 경로를 타고, 단계마다 기록된 revision과
   * 맞는지 확인한다. 하나라도 어긋나면 EDITING_RECOVERY_FAILED. 적용한 record는 다시 기록으로 내보내 새 session의 기록이 된다.
   */
  async replay(entries: readonly RecoveryJournalEntry[]): Promise<EditingActionResult> {
    if (this.history.package.revision !== 0 || this.history.canUndo || this.history.canRedo) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '복구 기록은 새로 연 편집 session에만 적용할 수 있습니다.')
    }
    entries.forEach((entry, index) => {
      try {
        switch (entry.type) {
          case 'commit':
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

  async saveAs(request: EditingEngineSaveRequest): Promise<EditingEngineSaveResult> {
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
        temporaryToken: request.temporaryToken
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
