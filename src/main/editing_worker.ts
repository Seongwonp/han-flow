import { parentPort } from 'worker_threads'
import type {
  EditingCellStyleRequest,
  EditingCharacterStyleRequest,
  EditingCommitRequest,
  EditingDeleteTableColumnRequest,
  EditingDeleteTableRowRequest,
  EditingInsertTableColumnRequest,
  EditingInsertTableRowRequest,
  EditingMergeParagraphRequest,
  EditingMergeTableCellRightRequest,
  EditingParagraphStyleRequest,
  EditingRangeCommitRequest,
  EditingSplitParagraphRequest,
  EditingSplitTableCellRequest
} from '../core/editing/editing_contract'
import { EditingOperationError } from '../core/editing/editing_error'
import { EditingEngine, type EditingEngineSaveRequest } from './editing_engine'
import {
  serializeEditingWorkerError,
  type EditingWorkerReplayRequest,
  type EditingWorkerRequest,
  type EditingWorkerResponse,
  type EditingWorkerStartResult
} from './editing_worker_protocol'

/*
 * 편집 session 하나를 맡는 worker thread. main process가 session마다 하나씩 resourceLimits를 걸어 만들고,
 * 요청 timeout·OOM·crash가 나면 통째로 terminate한다. 이 thread가 멈춰도 main의 event loop(창·메뉴·대화상자)는 돈다.
 */

let engine: EditingEngine | undefined

function requireEngine(): EditingEngine {
  if (!engine) {
    throw new EditingOperationError(
      'EDITING_SESSION_EXPIRED',
      '편집 session이 종료되었습니다. 문서를 다시 열어 주세요.',
      'restart-session'
    )
  }
  return engine
}

async function dispatch(request: EditingWorkerRequest): Promise<unknown> {
  const payload = request.payload
  switch (request.method) {
    case 'start': {
      if (engine) throw new EditingOperationError('EDITING_INVALID_REQUEST', '편집 worker는 session 하나만 맡습니다.')
      const opened = await EditingEngine.open((payload as { filePath: string }).filePath)
      engine = opened.engine
      const result: EditingWorkerStartResult = {
        sourcePath: engine.sourcePath,
        document: opened.document,
        projectionId: opened.projectionId,
        source: opened.source
      }
      return result
    }
    case 'replay':
      return requireEngine().replay((payload as EditingWorkerReplayRequest).entries)
    case 'commit':
      return requireEngine().commit(payload as EditingCommitRequest)
    case 'commitRange':
      return requireEngine().commitRange(payload as EditingRangeCommitRequest)
    case 'splitParagraph':
      return requireEngine().splitParagraph(payload as EditingSplitParagraphRequest)
    case 'mergeParagraph':
      return requireEngine().mergeParagraph(payload as EditingMergeParagraphRequest)
    case 'applyCharacterStyle':
      return requireEngine().applyCharacterStyle(payload as EditingCharacterStyleRequest)
    case 'applyParagraphStyle':
      return requireEngine().applyParagraphStyle(payload as EditingParagraphStyleRequest)
    case 'applyCellStyle':
      return requireEngine().applyCellStyle(payload as EditingCellStyleRequest)
    case 'insertTableRowAfter':
      return requireEngine().insertTableRowAfter(payload as EditingInsertTableRowRequest)
    case 'deleteTableRow':
      return requireEngine().deleteTableRow(payload as EditingDeleteTableRowRequest)
    case 'insertTableColumnAfter':
      return requireEngine().insertTableColumnAfter(payload as EditingInsertTableColumnRequest)
    case 'deleteTableColumn':
      return requireEngine().deleteTableColumn(payload as EditingDeleteTableColumnRequest)
    case 'mergeTableCellRight':
      return requireEngine().mergeTableCellRight(payload as EditingMergeTableCellRightRequest)
    case 'splitTableCell':
      return requireEngine().splitTableCell(payload as EditingSplitTableCellRequest)
    case 'undo':
      return requireEngine().undo()
    case 'redo':
      return requireEngine().redo()
    case 'refresh':
      return requireEngine().refresh()
    case 'lossPolicy':
      return requireEngine().lossPolicy()
    case 'saveAs':
      return requireEngine().saveAs(payload as EditingEngineSaveRequest)
    default:
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '알 수 없는 편집 요청입니다.')
  }
}

// main은 창별 queue로 요청을 하나씩 보내지만, worker도 도착 순서대로 하나씩 처리해 순서를 보장한다.
let queue: Promise<void> = Promise.resolve()

parentPort?.on('message', (request: EditingWorkerRequest) => {
  queue = queue.then(async () => {
    let response: EditingWorkerResponse
    try {
      const value = await dispatch(request)
      response = { id: request.id, ok: true, value, status: engine?.status() }
    } catch (reason) {
      response = {
        id: request.id,
        ok: false,
        error: serializeEditingWorkerError(reason),
        status: engine?.status()
      }
    }
    // 복구 기록 record는 응답과 같은 message로 보낸다. main은 응답을 받는 순간 기록을 갖는다.
    const journal = engine?.takeJournal()
    if (journal?.length) response.journal = journal
    try {
      parentPort?.postMessage(response)
    } catch (reason) {
      // projection에 structured clone할 수 없는 값이 섞이면 요청만 실패시키고 session은 유지한다.
      parentPort?.postMessage({
        id: request.id,
        ok: false,
        error: serializeEditingWorkerError(reason),
        status: engine?.status(),
        ...(journal?.length ? { journal } : {})
      } satisfies EditingWorkerResponse)
    }
  })
})
