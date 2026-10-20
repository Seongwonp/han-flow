import { app, shell, BrowserWindow, ipcMain, dialog, Menu, session } from 'electron'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { readdir, readFile, writeFile } from 'fs/promises'
import { DocumentImporter } from './document_importer'
import { DocumentPathNotAllowedError, DocumentPathRegistry } from './document_path_registry'
import { OpenPathRouter, type OpenPathDecision, type OpenPathRequest } from './open_path_router'
import {
  EditingSessionManager,
  INVALID_DESTINATION_MESSAGE,
  PROTECTED_DESTINATION_MESSAGE,
  pdfExportFailureMessage,
  RecoverySourceChangedError,
  samePath,
  type EditingSessionLostEvent
} from './editing_session'
import {
  discardQuarantinedJournal,
  discardRecoveryJournal,
  isLocalRecoverySourcePath,
  isRecoverySessionId,
  pruneRecoveryJournals,
  readRecoveryJournalHeader,
  RECOVERY_DIRECTORY_NAME,
  scanRecoveryJournals,
  verifyRecoverySource,
  type RecoveryJournalCandidate
} from './recovery_journal'
import {
  recoveryChoiceFromTestValue,
  recoveryFailedDialog,
  recoveryJournalStoppedMessage,
  recoveryOfferDialog,
  recoveryUnavailableDialog,
  type RecoveryChoice,
  type RecoveryDialog,
  type RecoveryPromptReason
} from './recovery_messages'
import { isDevToolsShortcut } from './dev_tools_shortcut'
import { findProjectedSurface } from './e2e_surface_follow'
import { APP_TITLE, suggestedPdfExportPath, windowTitle } from './export_file_name'
import { PDF_OBJECT_WARNING_CONTINUE, pdfObjectPlaceholderConfirmation } from './pdf_export_warning'
import { writeFileAtomically } from '../core/editing/save_as'
import { editingLossPolicyDetail } from './editing_loss_guidance'
import { isAllowedExternalUrl, isSameTrustedDocument } from './external_navigation'
import { createGuardedIpc, rendererUrlMatcher } from './ipc_guard'
import type {
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
  EditingSplitTableCellRequest
} from '../core/editing/editing_contract'
import {
  captureEditingIpcResult,
  EditingOperationError
} from '../core/editing/editing_error'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const isE2E = process.env['HAN_FLOW_E2E'] === '1'
const testValue = (name: string): string | undefined => isDev || isE2E ? process.env[name] : undefined
const processStartedAt = Date.now()
const benchmarkFile = testValue('HAN_FLOW_BENCHMARK_FILE')
const benchmarkOutput = testValue('HAN_FLOW_BENCHMARK_OUTPUT')
const benchmarkRuns = Math.max(1, Number(testValue('HAN_FLOW_BENCHMARK_RUNS') ?? 1))
const benchmarkMeasurements: unknown[] = []
const benchmarkUserData = testValue('HAN_FLOW_BENCHMARK_USER_DATA')
const e2eUserData = testValue('HAN_FLOW_E2E_USER_DATA')
if (benchmarkUserData ?? e2eUserData) app.setPath('userData', (benchmarkUserData ?? e2eUserData)!)
// 창은 webContents id로 구분한다. 편집 session·문서 가져오기·경로 허용목록도 같은 id를 쓴다.
const windowsById = new Map<number, BrowserWindow>()
// renderer 진입 문서. 개발 빌드가 dev server를 쓰면(`ELECTRON_RENDERER_URL`) 그 origin을 쓴다.
const rendererFile = join(__dirname, '../renderer/index.html')
const devRendererUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] || undefined : undefined
// 모든 IPC handler는 이 등록기로만 단다. 우리 창의 최상위 renderer 문서가 보낸 요청만 처리한다(`ipc_guard.ts`).
const ipc = createGuardedIpc(ipcMain, {
  isTrustedWebContents: (webContents) => windowsById.get(webContents.id)?.webContents === webContents,
  isTrustedUrl: rendererUrlMatcher({ rendererFile, devServerUrl: devRendererUrl })
})
// PDF 내보내기 요청마다 renderer가 인쇄 준비를 마쳤다고 알릴 때까지 기다리는 대기열(requestId → 보낸 webContents·완료).
const pendingPdfReady = new Map<string, { sender: Electron.WebContents; resolve: () => void }>()
const openPathRouter = new OpenPathRouter()
let applicationQuitRequested = false
const documentImporter = new DocumentImporter(join(__dirname, 'decoder_worker.js'))
// 편집 복구 기록(`recovery_journal.ts`). 사용자별 app data 폴더 아래에만 쓴다.
const recoveryDirectory = join(app.getPath('userData'), RECOVERY_DIRECTORY_NAME)
const editingSessions = new EditingSessionManager(undefined, {
  recovery: {
    directory: recoveryDirectory,
    appVersion: app.getVersion(),
    onSessionLost: (event) => offerRecoveryAfterEngineFailure(event),
    // 한도 초과·쓰기 실패로 복구 기록이 멈추면 그 창의 상태 막대에 계속 알린다(조용히 멈추지 않는다).
    onJournalStopped: (event) => {
      const window = windowsById.get(event.senderId)
      if (!window || window.isDestroyed()) return
      window.webContents.send('editing:recoveryJournalStopped', {
        sessionId: event.sessionId,
        message: recoveryJournalStoppedMessage(event.reason)
      })
    }
  }
})
const documentPaths = new DocumentPathRegistry()
const latestImportLoadIds = new Map<number, string>()
// 창마다 마지막으로 열기에 성공한 문서 경로. PDF 기본 이름과 창 제목에 쓴다.
const currentDocumentPaths = new Map<number, string>()

function setCurrentDocumentPath(senderId: number, filePath: string | undefined): void {
  if (filePath) currentDocumentPaths.set(senderId, filePath)
  else currentDocumentPaths.delete(senderId)
  const window = windowsById.get(senderId)
  if (window && !window.isDestroyed()) window.setTitle(windowTitle(filePath))
}

function isEditingSelection(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    ['sectionPath', 'anchorTextNodeId', 'focusTextNodeId'].every(
      (field) => typeof (value as Record<string, unknown>)[field] === 'string'
    ) &&
    ['anchorOffset', 'focusOffset'].every(
      (field) => Number.isFinite((value as Record<string, unknown>)[field])
    )
  )
}

function isStyleRequestBase(request: unknown): request is Record<string, unknown> {
  return (
    request !== null &&
    typeof request === 'object' &&
    ['sessionId', 'transactionId', 'sectionPath', 'textNodeId'].every(
      (key) => typeof (request as Record<string, unknown>)[key] === 'string'
    ) &&
    Number.isFinite((request as Record<string, unknown>)['timestamp']) &&
    isEditingSelection((request as Record<string, unknown>)['selection'])
  )
}

function editingIpcHandler<TArgs extends unknown[], TResult>(
  handler: (
    event: Electron.IpcMainInvokeEvent,
    ...args: TArgs
  ) => TResult | Promise<TResult>
) {
  return (event: Electron.IpcMainInvokeEvent, ...args: TArgs) =>
    captureEditingIpcResult(() => handler(event, ...args))
}

async function showMessageBox(
  window: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
}

// Electron 43부터 defaultPath를 생략한 파일 대화상자는 OS의 마지막 폴더 대신 항상 다운로드 폴더에서 열린다.
// 이전처럼 마지막으로 쓴 폴더를 이어 쓰도록 직접 기억한다.
let lastDialogDirectory: string | undefined

function rememberDialogDirectory(filePath: string | undefined): void {
  if (filePath) lastDialogDirectory = dirname(filePath)
}

async function showSaveDialog(
  window: BrowserWindow | null,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}

async function lossPolicyDetail(senderId: number, sessionId: string): Promise<string> {
  return editingLossPolicyDetail(await editingSessions.lossPolicy(senderId, sessionId))
}

async function saveEditingSessionWithDialog(
  senderId: number,
  sessionId: string,
  window: BrowserWindow | null,
  confirmPreview: boolean
) {
  const testDestination = testValue('HAN_FLOW_EDIT_SAVE_PATH')
  if (confirmPreview && !testDestination) {
    const confirmation = await showMessageBox(window, {
      type: 'warning',
      buttons: ['다른 이름으로 저장', '취소'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'HWPX 변경본 저장',
      message: '원본은 그대로 두고 새 HWPX 파일을 만듭니다.',
      detail: await lossPolicyDetail(senderId, sessionId)
    })
    if (confirmation.response !== 0) return { outcome: 'cancelled' as const }
  }

  let destinationPath = testDestination
  // 테스트 경로는 교체 확인을 거치지 않았으므로 기존 파일을 덮어쓰지 않는다.
  let overwrite = false
  if (!destinationPath) {
    const selection = await showSaveDialog(window, {
      title: 'HWPX 변경본을 다른 이름으로 저장',
      defaultPath: editingSessions.suggestedSaveAsPath(senderId, sessionId),
      filters: [{ name: 'HWPX 문서', extensions: ['hwpx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (selection.canceled || !selection.filePath) return { outcome: 'cancelled' as const }
    destinationPath = selection.filePath
    // OS 대화상자가 기존 파일 교체를 이미 확인했다. 단 원본 문서는 확인 여부와 무관하게 거부한다.
    const decision = await editingSessions.saveAsDestinationDecision(senderId, sessionId, destinationPath)
    if (decision === 'protected') {
      await showMessageBox(window, {
        type: 'error',
        buttons: ['확인'],
        defaultId: 0,
        noLink: true,
        title: 'HWPX 변경본 저장',
        message: '원본 문서에는 저장할 수 없습니다.',
        detail: PROTECTED_DESTINATION_MESSAGE
      })
      return { outcome: 'cancelled' as const }
    }
    if (decision === 'invalid') {
      await showMessageBox(window, {
        type: 'error',
        buttons: ['확인'],
        defaultId: 0,
        noLink: true,
        title: 'HWPX 변경본 저장',
        message: '이 위치에는 저장할 수 없습니다.',
        detail: INVALID_DESTINATION_MESSAGE
      })
      return { outcome: 'cancelled' as const }
    }
    overwrite = decision === 'replace'
  }

  return {
    outcome: 'saved' as const,
    ...(await editingSessions.saveAs(senderId, sessionId, destinationPath, { overwrite }))
  }
}

async function resolveDirtyEditing(
  senderId: number,
  sessionId: string,
  window: BrowserWindow | null
) {
  if (!editingSessions.isDirty(senderId, sessionId)) return { outcome: 'discarded' as const }
  const testAction = testValue('HAN_FLOW_DIRTY_ACTION')
  let response: number
  if (testAction) {
    response = testAction === 'save' ? 0 : testAction === 'discard' ? 1 : 2
  } else {
    const confirmation = await showMessageBox(window, {
      type: 'warning',
      buttons: ['다른 이름으로 저장', '저장하지 않음', '취소'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: '저장하지 않은 HWPX 변경',
      message: '이 문서의 변경 내용을 어떻게 처리하시겠습니까?',
      detail:
        '저장하면 원본은 그대로 두고 새 HWPX를 만듭니다. ' +
        await lossPolicyDetail(senderId, sessionId)
    })
    response = confirmation.response
  }
  if (response === 2) return { outcome: 'cancelled' as const }
  if (response === 1) return { outcome: 'discarded' as const }
  return saveEditingSessionWithDialog(senderId, sessionId, window, false)
}

function isHwpxPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.hwpx')
}

function isHwpPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.hwp')
}

function isDocumentPath(filePath: string): boolean {
  return isHwpxPath(filePath) || isHwpPath(filePath)
}

function pathFromArguments(arguments_: string[], workingDirectory = process.cwd()): string | undefined {
  const filePath = arguments_.find(isDocumentPath)
  return filePath ? resolve(workingDirectory, filePath) : undefined
}

// E2E probe가 리본 control을 누르기 전에 그 control이 든 탭을 사용자처럼 먼저 고르는 helper(renderer에 주입하는 JS).
const RIBBON_E2E_HELPERS = `
  const selectedRibbonTab = () => document.querySelector('.viewer-ribbon-tabs [role="tab"][aria-selected="true"]')?.textContent?.trim()
  const ribbonTab = (name) => Array.from(document.querySelectorAll('.viewer-ribbon-tabs [role="tab"]'))
    .find((tab) => tab.textContent?.trim() === name)
  const revealRibbonControl = async (label) => {
    const element = document.querySelector('[aria-label="' + label + '"]')
    const panel = element?.closest('[role="tabpanel"]')
    if (!panel || !panel.hidden) return element
    const tab = document.getElementById(panel.getAttribute('aria-labelledby'))
    tab?.click()
    const started = performance.now()
    while (panel.hidden && performance.now() - started < 5000) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    if (panel.hidden) throw new Error('리본 탭 전환 실패: ' + label)
    return document.querySelector('[aria-label="' + label + '"]')
  }
`

function captureVisualState(window: BrowserWindow): void {
  const capturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const stateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  const searchQuery = testValue('HAN_FLOW_VISUAL_SEARCH_QUERY')
  const editText = testValue('HAN_FLOW_VISUAL_EDIT_TEXT')
  // 한 글자 입력 지연 측정(keystroke 수). 문단에 한 글자씩 넣고 입력 event부터 편집 결과가 화면 DOM에 반영될 때까지 잰다.
  const editLatencyKeystrokes = Number(testValue('HAN_FLOW_VISUAL_EDIT_LATENCY') ?? 0)
  // 측정할 편집: text(한 글자 입력, 기본)·bold(문단 글자 전체를 골라 굵게 켜기·끄기를 번갈아). bold는 측정 DOM 다시 재기까지 잰다.
  const editLatencyMode = testValue('HAN_FLOW_VISUAL_EDIT_LATENCY_MODE') === 'bold' ? 'bold' : 'text'
  const editMode = testValue('HAN_FLOW_VISUAL_EDIT_MODE') ?? 'composition'
  const editCellEnabled = testValue('HAN_FLOW_VISUAL_EDIT_CELL') === '1'
  // 문단 편집 E2E 대상: table-caret·table-caret-after(표 앞·뒤 글자), note·endnote(각주·미주 본문), header·footer(머리말·꼬리말),
  // column(2단 영역 둘째 단의 본문 문단), text-box(글상자 글), memo(메모 본문). 없으면 본문 문단·표 셀.
  const editTarget = testValue('HAN_FLOW_VISUAL_EDIT_TARGET')
  const editTargetLabels: Record<string, string> = {
    'table-caret': 'HWPX 표 앞뒤 글자 편집',
    'table-caret-after': 'HWPX 표 앞뒤 글자 편집',
    note: 'HWPX 각주·미주 편집',
    endnote: 'HWPX 각주·미주 편집',
    header: 'HWPX 머리말 편집',
    footer: 'HWPX 꼬리말 편집',
    column: 'HWPX 문단 편집',
    'text-box': 'HWPX 글상자 편집',
    memo: 'HWPX 메모 편집'
  }
  // 같은 입력 칸 이름을 쓰는 대상 가운데 고를 칸(표 앞·뒤 caret, 각주·미주 목록)의 조상 selector.
  const editTargetScopes: Record<string, string> = {
    'table-caret': '.viewer-table-caret-before',
    'table-caret-after': '.viewer-table-caret-after',
    note: '[data-note-kind="footnote"]',
    endnote: '[data-note-kind="endnote"]',
    column: '.viewer-column-flow[data-column-count="2"] > .viewer-column[data-column-index="1"]',
    'text-box': '[data-object-kind="text-box"]',
    memo: '[data-object-kind="memo"]'
  }
  const editTargetScope = editTarget ? editTargetScopes[editTarget] : undefined
  const decorationTarget = editTarget === 'header' || editTarget === 'footer'
  const editSurfaceLabel = (editTarget && editTargetLabels[editTarget]) ??
    (editCellEnabled ? 'HWPX 표 셀 편집' : 'HWPX 문단 편집')
  const editSurfaceKind = editTarget && editTargetLabels[editTarget] ? editTarget : editCellEnabled ? 'table-cell' : 'paragraph'
  const styleProbeEnabled = testValue('HAN_FLOW_VISUAL_STYLE_PROBE') === '1'
  const tableStructureProbeEnabled = testValue('HAN_FLOW_VISUAL_TABLE_STRUCTURE_PROBE') === '1'
  const autoSaveEdit = testValue('HAN_FLOW_VISUAL_AUTO_SAVE') === '1'
  const exitWhenComplete = testValue('HAN_FLOW_VISUAL_EXIT') === '1'
  // 강제 종료 뒤 다시 띄운 앱에서 복구한 편집 글자(HAN_FLOW_E2E_RECOVERY_ACTION=recover와 함께 쓴다).
  const recoveryText = testValue('HAN_FLOW_VISUAL_RECOVERY_TEXT')
  // 화면 글자에 있어야 하는 문자열(복구 뒤 저장본을 다시 열어 확인).
  const expectedText = testValue('HAN_FLOW_VISUAL_EXPECT_TEXT')
  if (!capturePath && !stateOutput) return
  const captureDelayMs = Number(process.env['HAN_FLOW_VISUAL_CAPTURE_DELAY_MS'] ?? 2500)
  const readyTimeoutMs = Number(process.env['HAN_FLOW_VISUAL_READY_TIMEOUT_MS'] ?? 30_000)
  const startedAt = Date.now()
  let previousSignature = ''
  let stableSamples = 0
  let searchTriggered = !searchQuery
  let editTriggered = !editText && !tableStructureProbeEnabled && !(editLatencyKeystrokes > 0)
  let editProbe: unknown = null
  let recoveryTriggered = !recoveryText
  let recoveryProbe: Record<string, unknown> | null = null
  let sampledPeakWorkingSetKb = 0
  const sampleMemory = () => {
    const workingSetKb = app.getAppMetrics()
      .reduce((sum, metric) => sum + metric.memory.workingSetSize, 0)
    sampledPeakWorkingSetKb = Math.max(sampledPeakWorkingSetKb, workingSetKb)
  }
  sampleMemory()
  const memoryInterval = setInterval(sampleMemory, 50)
  const captureWhenReady = async () => {
    const readiness = await window.webContents.executeJavaScript(`(() => {
      const pages = document.querySelector('.viewer-pages')
      const errorVisible = Boolean(document.querySelector('.viewer-error'))
      const mountedPages = Array.from(document.querySelectorAll('.viewer-page'))
      const fixedPagesReady = mountedPages.every((page) => !page.classList.contains('viewer-fixed-page') || page.dataset.pageReady === 'true')
      const searchStatus = document.querySelector('[data-searching]')
      return {
        ready: errorVisible || Boolean(pages && pages.dataset.documentLoading === 'false' && pages.dataset.layoutMeasured === 'true' && fixedPagesReady && (!${searchTriggered} || searchStatus?.dataset.searching === 'false')),
        signature: errorVisible ? 'error' : pages ? [pages.dataset.totalPages, mountedPages.length, mountedPages.filter((page) => page.dataset.pageReady === 'true').length, pages.dataset.documentLoading, pages.dataset.layoutMeasured, document.querySelectorAll('.viewer-fixed-page-search-hit').length, searchStatus?.dataset.searching].join(':') : 'empty'
      }
    })()`)
    stableSamples = readiness.ready && readiness.signature === previousSignature ? stableSamples + 1 : readiness.ready ? 1 : 0
    previousSignature = readiness.signature
    if (stableSamples < 3 && Date.now() - startedAt < readyTimeoutMs) {
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!searchTriggered && searchQuery) {
      searchTriggered = true
      stableSamples = 0
      previousSignature = ''
      await window.webContents.executeJavaScript(`(async () => {
        ${RIBBON_E2E_HELPERS}
        ;(await revealRibbonControl('검색'))?.click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const input = document.querySelector('[aria-label="HWP 문서 검색"]')
        if (!input) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, ${JSON.stringify(searchQuery)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!recoveryTriggered && recoveryText) {
      recoveryTriggered = true
      stableSamples = 0
      previousSignature = ''
      recoveryProbe = await window.webContents.executeJavaScript(`(async () => {
        let phase = 'recovered-editing'
        const waitFor = async (predicate, timeout = 60000) => {
          const started = performance.now()
          while (performance.now() - started < timeout) {
            const result = predicate()
            if (result) return result
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          throw new Error('복구 E2E 조건 대기 시간이 초과되었습니다: ' + phase)
        }
        ${RIBBON_E2E_HELPERS}
        const status = () => document.querySelector('.viewer-status')?.textContent ?? ''
        await waitFor(() => document.querySelector('.viewer-editing-badge') && status().includes('편집 내용 복구 ·'))
        const expected = ${JSON.stringify(recoveryText)}
        const editableTexts = Array.from(document.querySelectorAll('.viewer-editable-text')).map((element) => element.textContent ?? '')
        const textPresent = editableTexts.some((text) => text.includes(expected))
        const recoveredStatus = status()
        const dirty = recoveredStatus.includes('저장 안 됨')
        await revealRibbonControl('실행 취소')
        const undoEnabled = document.querySelector('[aria-label="실행 취소"]')?.disabled === false
        let saveStatusMatches
        let dirtyCleared
        if (${autoSaveEdit}) {
          phase = 'save-button'
          await revealRibbonControl('HWPX 변경본 저장')
          const saveButton = await waitFor(() => {
            const button = document.querySelector('[aria-label="HWPX 변경본 저장"]')
            return button && !button.disabled ? button : undefined
          })
          saveButton.click()
          phase = 'save-complete'
          await waitFor(() => status().includes('저장 완료'))
          saveStatusMatches = /Preview (?:갱신 안 됨|없음)/.test(status())
          dirtyCleared = !status().includes('저장 안 됨') && saveButton.disabled
        }
        return { recovered: true, textPresent, dirty, undoEnabled, recoveredStatus, saveStatusMatches, dirtyCleared }
      })()`).catch((reason) => ({
        probeError: reason instanceof Error ? reason.message : String(reason)
      })) as Record<string, unknown>
      // 저장 뒤에는 dirty가 아니므로 복구 기록이 지워져야 한다(지우기는 비동기라 잠깐 기다린다).
      const remainingJournals = async () => (await readdir(recoveryDirectory).catch(() => [] as string[]))
        .filter((name) => isRecoverySessionId(name)).length
      let journalsAfterSave = await remainingJournals()
      for (let attempt = 0; autoSaveEdit && journalsAfterSave > 0 && attempt < 40; attempt += 1) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
        journalsAfterSave = await remainingJournals()
      }
      recoveryProbe = { ...recoveryProbe, journalsAfterSave }
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!editTriggered && tableStructureProbeEnabled) {
      editTriggered = true
      stableSamples = 0
      previousSignature = ''
      editProbe = await window.webContents.executeJavaScript(`(async () => {
        let phase = 'edit-button'
        const setPhase = (value) => {
          phase = value
          console.error('HAN_FLOW_E2E_PHASE ' + value)
        }
        const waitFor = async (predicate, timeout = 30000) => {
          const started = performance.now()
          while (performance.now() - started < timeout) {
            const result = predicate()
            if (result) return result
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          throw new Error('표 구조 E2E 조건 대기 시간이 초과되었습니다: ' + phase)
        }
        ${RIBBON_E2E_HELPERS}
        const button = (label) => document.querySelector('[aria-label="' + label + '"]')
        const table = () => document.querySelector('.viewer-page .viewer-table')
        const rowCount = () => table()?.querySelectorAll(':scope > tbody > tr').length ?? 0
        const columnCount = () => table()?.querySelectorAll(':scope > colgroup > col').length ?? 0
        const bodyRowCells = () => table()?.querySelectorAll(':scope > tbody > tr:nth-child(2) > td').length ?? 0
        const bodyRowTexts = () => Array.from(
          table()?.querySelectorAll(':scope > tbody > tr:nth-child(2) > td') ?? []
        ).map((cell) => cell.textContent ?? '')
        const waitButton = async (label) => {
          await revealRibbonControl(label)
          return waitFor(() => {
            const candidate = button(label)
            return candidate && !candidate.disabled && !candidate.closest('[role="tabpanel"]')?.hidden ? candidate : undefined
          })
        }
        const clickButton = async (label, nextPhase, predicate) => {
          setPhase(nextPhase)
          ;(await waitButton(label)).click()
          await waitFor(predicate)
        }
        const clickHistory = async (label, nextPhase, predicate) => {
          setPhase(nextPhase)
          ;(await waitButton(label)).click()
          await waitFor(predicate)
        }
        const editButton = await waitFor(() => button('HWPX 편집 시작'))
        editButton.click()
        setPhase('editable-cell')
        await waitFor(() => document.querySelector('.viewer-editing-badge'))
        const activeTabAfterStart = selectedRibbonTab()
        const focusCell = async () => {
          const surface = await waitFor(() => {
            const candidate = document.querySelector('[aria-label="HWPX 표 셀 편집"]')
            return candidate?.dataset.inputReady === 'true' ? candidate : undefined
          })
          surface.focus()
          surface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          await waitFor(() => !button('아래에 표 행 추가')?.disabled)
        }
        await focusCell()
        // 표 안에 caret이 들어가도 탭은 바꾸지 않고 표 탭에만 표시한다.
        const tableTabMarked = selectedRibbonTab() === activeTabAfterStart &&
          ribbonTab('표')?.dataset.context === 'table' &&
          Boolean(ribbonTab('표')?.querySelector('.viewer-ribbon-tab-badge'))
        const original = { rows: rowCount(), columns: columnCount(), bodyCells: bodyRowCells(), texts: bodyRowTexts() }

        await clickButton('아래에 표 행 추가', 'row-insert', () => rowCount() === original.rows + 1)
        const rowInserted = rowCount() === original.rows + 1
        await clickHistory('실행 취소', 'row-insert-undo', () => rowCount() === original.rows)
        await clickHistory('다시 실행', 'row-insert-redo', () => rowCount() === original.rows + 1)
        await clickHistory('실행 취소', 'row-insert-reset', () => rowCount() === original.rows)

        await clickButton('현재 표 행 삭제', 'row-delete', () => rowCount() === original.rows - 1)
        const rowDeleted = rowCount() === original.rows - 1
        await clickHistory('실행 취소', 'row-delete-undo', () => rowCount() === original.rows)

        await clickButton('오른쪽에 표 열 추가', 'column-insert', () => columnCount() === original.columns + 1)
        const columnInserted = columnCount() === original.columns + 1
        await clickHistory('실행 취소', 'column-insert-undo', () => columnCount() === original.columns)
        await clickHistory('다시 실행', 'column-insert-redo', () => columnCount() === original.columns + 1)
        await clickHistory('실행 취소', 'column-insert-reset', () => columnCount() === original.columns)

        await clickButton('현재 표 열 삭제', 'column-delete', () => columnCount() === original.columns - 1)
        const columnDeleted = columnCount() === original.columns - 1
        await clickHistory('실행 취소', 'column-delete-undo', () => columnCount() === original.columns)

        await clickButton('오른쪽 표 셀과 병합', 'cell-merge', () => bodyRowCells() === original.bodyCells - 1)
        const mergedCell = await waitFor(() => table()?.querySelector('[aria-label="병합 표 셀 2행 1열"]'))
        const cellMerged = mergedCell.getAttribute('colspan') === '2' &&
          (mergedCell.textContent ?? '').includes(original.texts[0]) &&
          (mergedCell.textContent ?? '').includes(original.texts[1])
        mergedCell.click()
        await clickButton('선택한 병합 표 셀 분할', 'cell-split', () => bodyRowCells() === original.bodyCells)
        const splitTexts = bodyRowTexts()
        const cellSplit = columnCount() === original.columns &&
          bodyRowCells() === original.bodyCells &&
          splitTexts[0] === original.texts[0] + original.texts[1] &&
          splitTexts[1] === '' &&
          splitTexts[2] === original.texts[2]
        await clickHistory('실행 취소', 'cell-split-undo', () => bodyRowCells() === original.bodyCells - 1)
        const splitUndoRestoredMerge = table()?.querySelector('[aria-label="병합 표 셀 2행 1열"]')?.getAttribute('colspan') === '2'
        await clickHistory('다시 실행', 'cell-split-redo', () => bodyRowCells() === original.bodyCells)
        const splitRedoRestored = bodyRowTexts()[1] === '' && bodyRowTexts()[2] === original.texts[2]

        let saveStatusMatches
        let dirtyCleared
        if (${autoSaveEdit}) {
          setPhase('save-button')
          const saveButton = await waitButton('HWPX 변경본 저장')
          saveButton.click()
          setPhase('save-complete')
          await waitFor(() => document.querySelector('.viewer-status')?.textContent?.includes('저장 완료'))
          saveStatusMatches = document.querySelector('.viewer-status')?.textContent?.includes('표 구조') &&
            /Preview (?:갱신 안 됨|없음)/.test(document.querySelector('.viewer-status')?.textContent ?? '')
          dirtyCleared = !document.querySelector('.viewer-status')?.textContent?.includes('저장 안 됨') && saveButton.disabled
        }
        return {
          mode: 'table-structure',
          surface: 'table-cell',
          activeTabAfterStart,
          tableTabMarked,
          original,
          final: { rows: rowCount(), columns: columnCount(), bodyCells: bodyRowCells(), texts: bodyRowTexts() },
          rowInserted,
          rowDeleted,
          columnInserted,
          columnDeleted,
          cellMerged,
          cellSplit,
          splitUndoRestoredMerge,
          splitRedoRestored,
          saveStatusMatches,
          dirtyCleared
        }
      })()`).catch(async (reason) => ({
        probeError: reason instanceof Error ? reason.message : String(reason),
        diagnostics: await window.webContents.executeJavaScript(`({
          status: document.querySelector('.viewer-status')?.textContent,
          rows: document.querySelector('.viewer-page .viewer-table')?.querySelectorAll(':scope > tbody > tr').length,
          columns: document.querySelector('.viewer-page .viewer-table')?.querySelectorAll(':scope > colgroup > col').length,
          enabledButtons: Array.from(document.querySelectorAll('.viewer-ribbon-controls button:not(:disabled)')).map((button) => button.getAttribute('aria-label'))
        })`)
      }))
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!editTriggered && editLatencyKeystrokes > 0) {
      editTriggered = true
      stableSamples = 0
      previousSignature = ''
      editProbe = await window.webContents.executeJavaScript(`(async () => {
        let phase = 'edit-button'
        const waitFor = async (predicate, timeout = 60000) => {
          const started = performance.now()
          while (performance.now() - started < timeout) {
            const result = predicate()
            if (result) return result
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          throw new Error('입력 지연 측정 조건 대기 시간이 초과되었습니다: ' + phase)
        }
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        ${RIBBON_E2E_HELPERS}
        const surfaceLabel = 'HWPX 문단 편집'
        const surfaces = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
        const readySurface = () => surfaces().find((element) => element.dataset.inputReady === 'true' && (element.textContent ?? '').length > 0)
        if (!readySurface()) {
          const editButton = await waitFor(() => document.querySelector('[aria-label="HWPX 편집 시작"]'))
          editButton.click()
          phase = 'editable-surface'
        }
        let target = await waitFor(readySurface)
        await waitFor(() => document.querySelector('.viewer-editing-badge'))
        const anchorId = target.dataset.sourceTextNodeId
        const pages = () => document.querySelector('.viewer-pages')
        const revision = () => Number(pages()?.dataset.editingRevision ?? -1)
        const textNode = (element) => {
          if (!element.firstChild) element.append(document.createTextNode(''))
          return element.firstChild
        }
        const setSelection = (element, offset, focusOffset = offset) => {
          const node = textNode(element)
          window.getSelection().setBaseAndExtent(node, offset, node, focusOffset)
        }
        const mode = ${JSON.stringify(editLatencyMode)}
        const boldLabel = '현재 텍스트 블록 굵게'
        const boldButton = () => document.querySelector('[aria-label="' + boldLabel + '"]')
        if (mode === 'bold') {
          phase = 'bold-button'
          await revealRibbonControl(boldLabel)
        }
        const measuredMark = () => performance.getEntriesByName('han-flow:layout-measured').at(-1)
        target.focus()
        await frame(); await frame(); await sleep(500)
        const samples = []
        const originalText = target.textContent ?? ''
        for (let index = 0; index < ${editLatencyKeystrokes}; index += 1) {
          phase = (mode === 'bold' ? 'bold-' : 'keystroke-') + index
          target = await waitFor(() => {
            const candidate = surfaces().find((element) => element.dataset.sourceTextNodeId === anchorId)
            return candidate?.dataset.inputReady === 'true' ? candidate : undefined
          })
          if (mode === 'bold') {
            target.focus()
            setSelection(target, 0, (target.textContent ?? '').length)
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
            const button = await waitFor(() => {
              const candidate = boldButton()
              return candidate && !candidate.disabled ? candidate : undefined
            })
            await frame(); await frame()
            const pressed = button.getAttribute('aria-pressed') === 'true'
            // 짝수 번째는 [굵게], 홀수 번째는 [실행 취소]. 같은 모양 definition이 이미 있으면 command가 그 id를 다시 쓰므로
            // 켜고 끄기만 번갈아서는 header.xml이 처음 한 번만 바뀐다. 실행 취소는 더한 \`hh:charPr\`를 지워 매번 header가 바뀐다.
            const action = index % 2 === 0 ? button : await revealRibbonControl('실행 취소')
            const before = revision()
            let domAt
            const observer = new MutationObserver(() => {
              if (domAt === undefined && revision() > before) domAt = performance.now()
            })
            observer.observe(pages(), { attributes: true, attributeFilter: ['data-editing-revision'] })
            const startedAt = performance.now()
            action.click()
            await waitFor(() => domAt !== undefined)
            observer.disconnect()
            // 바뀐 style로 측정 DOM을 다시 재고 pagination이 끝난 시각(renderer 표시 'han-flow:layout-measured').
            const measured = await waitFor(() => {
              const mark = measuredMark()
              return mark && mark.startTime >= startedAt ? mark : undefined
            })
            await frame()
            const frameAt = performance.now()
            const result = performance.getEntriesByName('han-flow:editing-result').at(-1)?.startTime
            const boldAfter = await waitFor(() => boldButton()?.getAttribute('aria-pressed') === String(!pressed), 5000)
              .then(() => true, () => false)
            samples.push({
              domMs: domAt - startedAt,
              measuredMs: measured.startTime - startedAt,
              nextFrameMs: frameAt - startedAt,
              requestMs: result !== undefined ? result - startedAt : null,
              rendererMs: result !== undefined ? measured.startTime - result : null,
              action: index % 2 === 0 ? 'bold' : 'undo',
              measuredSections: measured.detail?.measuredSections ?? null,
              boldAfter
            })
            await waitFor(() => !document.querySelector('.viewer-status')?.textContent?.includes('반영 중'))
            await sleep(400)
            continue
          }
          const original = target.textContent ?? ''
          const before = revision()
          const insert = String.fromCharCode(0xac00 + index)
          setSelection(target, original.length)
          await frame()
          let domAt
          const observer = new MutationObserver(() => {
            if (domAt === undefined && revision() > before) domAt = performance.now()
          })
          observer.observe(pages(), { attributes: true, attributeFilter: ['data-editing-revision'] })
          const startedAt = performance.now()
          target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: insert }))
          target.textContent = original + insert
          setSelection(target, original.length + 1)
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: insert }))
          await waitFor(() => domAt !== undefined)
          observer.disconnect()
          await frame()
          const frameAt = performance.now()
          const result = performance.getEntriesByName('han-flow:editing-result').at(-1)?.startTime
          const commit = performance.getEntriesByName('han-flow:editing-commit').at(-1)?.startTime
          samples.push({
            domMs: domAt - startedAt,
            nextFrameMs: frameAt - startedAt,
            requestMs: result !== undefined && commit !== undefined ? result - commit : null,
            rendererMs: result !== undefined ? domAt - result : null
          })
          await waitFor(() => !document.querySelector('.viewer-status')?.textContent?.includes('반영 중'))
          await sleep(400)
        }
        const summary = (values) => {
          const sorted = values.filter((value) => typeof value === 'number').sort((left, right) => left - right)
          const round = (value) => Math.round(value * 10) / 10
          return sorted.length ? {
            p50: round(sorted[Math.floor(sorted.length * 0.5)]),
            p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
            max: round(sorted[sorted.length - 1])
          } : null
        }
        const text = surfaces().find((element) => element.dataset.sourceTextNodeId === anchorId)?.textContent ?? ''
        if (mode === 'bold') {
          const counts = samples.map((sample) => sample.measuredSections).filter((value) => typeof value === 'number')
          return {
            mode,
            keystrokes: samples.length,
            totalPages: Number(pages()?.dataset.totalPages ?? 0),
            revision: revision(),
            textUnchanged: text === originalText,
            boldToggled: samples.every((sample) => sample.boldAfter),
            inputToDomMs: summary(samples.map((sample) => sample.domMs)),
            inputToMeasuredMs: summary(samples.map((sample) => sample.measuredMs)),
            inputToNextFrameMs: summary(samples.map((sample) => sample.nextFrameMs)),
            requestRoundTripMs: summary(samples.map((sample) => sample.requestMs)),
            rendererUpdateMs: summary(samples.map((sample) => sample.rendererMs)),
            measuredSections: counts.length ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
            samples
          }
        }
        return {
          keystrokes: samples.length,
          totalPages: Number(pages()?.dataset.totalPages ?? 0),
          revision: revision(),
          textEndsWithInput: text.endsWith(Array.from({ length: samples.length }, (_, index) => String.fromCharCode(0xac00 + index)).join('')),
          inputToDomMs: summary(samples.map((sample) => sample.domMs)),
          inputToNextFrameMs: summary(samples.map((sample) => sample.nextFrameMs)),
          requestRoundTripMs: summary(samples.map((sample) => sample.requestMs)),
          rendererUpdateMs: summary(samples.map((sample) => sample.rendererMs)),
          samples
        }
      })()`).catch((reason) => ({ probeError: reason instanceof Error ? reason.message : String(reason) }))
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!editTriggered && editText && editTarget === 'footnote') {
      // 각주 만들기·지우기 E2E: 본문 caret에 [각주 넣기] → 새 각주 본문에 조합 입력 → 실행 취소(입력·각주)·다시 실행 →
      // 새 각주 본문 caret에서 [각주 지우기] → 실행 취소 → (저장). 번호 표시는 쪽 화면의 각주 번호 표시로 센다.
      editTriggered = true
      stableSamples = 0
      previousSignature = ''
      editProbe = await window.webContents.executeJavaScript(`(async () => {
        let phase = 'edit-button'
        const setPhase = (value) => {
          phase = value
          console.error('HAN_FLOW_E2E_PHASE ' + value)
        }
        const waitFor = async (predicate, timeout = 30000) => {
          const started = performance.now()
          while (performance.now() - started < timeout) {
            const result = predicate()
            if (result) return result
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          throw new Error('각주 E2E 조건 대기 시간이 초과되었습니다: ' + phase)
        }
        ${RIBBON_E2E_HELPERS}
        const expected = ${JSON.stringify(editText)}
        const button = (label) => document.querySelector('[aria-label="' + label + '"]')
        const waitButton = async (label) => {
          await revealRibbonControl(label)
          return waitFor(() => {
            const candidate = button(label)
            return candidate && !candidate.disabled && !candidate.closest('[role="tabpanel"]')?.hidden ? candidate : undefined
          })
        }
        const markers = () => Array.from(document.querySelectorAll('.viewer-page sup.viewer-note-marker[data-object-kind="footnote"]')).map((marker) => marker.textContent)
        const surfaceById = (id) => Array.from(document.querySelectorAll('.viewer-page [aria-label="HWPX 각주·미주 편집"]'))
          .find((element) => element.dataset.sourceTextNodeId === id)
        const status = () => document.querySelector('.viewer-status')?.textContent ?? ''
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const textNode = (element) => {
          if (!element.firstChild) element.append(document.createTextNode(''))
          return element.firstChild
        }
        const setSelection = (element, anchorOffset, focusOffset) => {
          const node = textNode(element)
          window.getSelection().setBaseAndExtent(node, anchorOffset, node, focusOffset)
        }
        const getSelection = (element) => {
          const selection = window.getSelection()
          const offset = (node, nodeOffset) => {
            if (!element.contains(node)) return -1
            const range = document.createRange()
            range.selectNodeContents(element)
            range.setEnd(node, nodeOffset)
            return range.toString().length
          }
          return selection?.anchorNode ? { anchorOffset: offset(selection.anchorNode, selection.anchorOffset), focusOffset: offset(selection.focusNode, selection.focusOffset) } : undefined
        }
        const caretAt = (element, offset) => {
          const value = element && getSelection(element)
          return value?.anchorOffset === offset && value?.focusOffset === offset
        }
        const clickAttempts = {}
        const click = async (label, nextPhase, predicate) => {
          setPhase(nextPhase)
          for (let attempt = 1; ; attempt += 1) {
            clickAttempts[nextPhase] = attempt
            ;(await waitButton(label)).click()
            try {
              await waitFor(predicate, attempt < 3 ? 5000 : 30000)
              return
            } catch (error) {
              if (attempt >= 3) throw error
            }
          }
        }
        const editButton = await waitFor(() => button('HWPX 편집 시작'))
        editButton.click()
        setPhase('body-surface')
        await waitFor(() => document.querySelector('.viewer-editing-badge'))
        const activeTabAfterStart = selectedRibbonTab()
        const body = await waitFor(() => Array.from(document.querySelectorAll('.viewer-page [aria-label="HWPX 문단 편집"]'))
          .find((element) => element.dataset.inputReady === 'true' && (element.textContent ?? '').length >= 4))
        body.focus()
        await settle()
        setSelection(body, 2, 2)
        body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        await settle()
        const originalMarkers = markers()
        await click('각주 넣기', 'insert-footnote', () => markers().length === originalMarkers.length + 1)
        const insertedMarkers = markers()
        setPhase('new-footnote-caret')
        const noteSurface = await waitFor(() => {
          const active = document.activeElement
          return active?.getAttribute('aria-label') === 'HWPX 각주·미주 편집' && active.dataset.inputReady === 'true' && (active.textContent ?? '') === '' ? active : undefined
        })
        const noteId = noteSurface.dataset.sourceTextNodeId
        setPhase('type-footnote')
        // 실제 IME처럼 한 입력 칸에 조합 event를 이어 보낸다(편집 E2E 기본 probe와 같은 순서).
        let composed = ''
        const target = surfaceById(noteId)
        for (const character of Array.from(expected)) {
          target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
          target.textContent = composed + 'ㅎ'
          setSelection(target, composed.length + 1, composed.length + 1)
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'ㅎ', isComposing: true }))
          composed += character
          target.textContent = composed
          setSelection(target, composed.length, composed.length)
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: character, isComposing: true }))
          target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: character }))
        }
        await waitFor(() => surfaceById(noteId)?.textContent === expected && !button('실행 취소')?.disabled && status().includes('저장 안 됨'))
        await waitFor(() => caretAt(surfaceById(noteId), expected.length))
        const editedMatches = surfaceById(noteId)?.textContent === expected
        const projectedSelectionMatches = caretAt(surfaceById(noteId), expected.length)
        await click('실행 취소', 'undo-text', () => surfaceById(noteId)?.textContent === '')
        await waitFor(() => caretAt(surfaceById(noteId), 0))
        const undoneMatches = surfaceById(noteId)?.textContent === ''
        const undoSelectionMatches = caretAt(surfaceById(noteId), 0)
        await click('실행 취소', 'undo-insert', () => markers().length === originalMarkers.length)
        const insertUndone = JSON.stringify(markers()) === JSON.stringify(originalMarkers)
        await click('다시 실행', 'redo-insert', () => markers().length === originalMarkers.length + 1)
        await click('다시 실행', 'redo-text', () => surfaceById(noteId)?.textContent === expected)
        await waitFor(() => caretAt(surfaceById(noteId), expected.length))
        const redoneMatches = surfaceById(noteId)?.textContent === expected && JSON.stringify(markers()) === JSON.stringify(insertedMarkers)
        const redoSelectionMatches = caretAt(surfaceById(noteId), expected.length)
        setPhase('delete-caret')
        const redone = surfaceById(noteId)
        redone.focus()
        await settle()
        setSelection(redone, 1, 1)
        redone.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        await settle()
        await click('각주 지우기', 'delete-footnote', () => markers().length === originalMarkers.length)
        const deleted = JSON.stringify(markers()) === JSON.stringify(originalMarkers) &&
          !(document.querySelector('.viewer-pages')?.innerText ?? '').includes(expected)
        await click('실행 취소', 'delete-undo', () => markers().length === originalMarkers.length + 1 && surfaceById(noteId)?.textContent === expected)
        const deleteUndone = JSON.stringify(markers()) === JSON.stringify(insertedMarkers)
        let saveStatusMatches
        let dirtyCleared
        if (${autoSaveEdit}) {
          setPhase('save-button')
          const saveButton = await waitButton('HWPX 변경본 저장')
          saveButton.click()
          setPhase('save-complete')
          await waitFor(() => status().includes('저장 완료'))
          saveStatusMatches = status().includes('각주') && /Preview (?:갱신 안 됨|없음)/.test(status())
          dirtyCleared = !status().includes('저장 안 됨') && saveButton.disabled
        }
        return {
          mode: 'footnote',
          surface: 'footnote',
          noteKind: 'footnote',
          activeTabAfterStart,
          originalMarkers,
          insertedMarkers,
          editedMatches,
          undoneMatches,
          redoneMatches,
          projectedSelectionMatches,
          undoSelectionMatches,
          redoSelectionMatches,
          insertUndone,
          deleted,
          deleteUndone,
          saveStatusMatches,
          dirtyCleared,
          dirtyAtEnd: status().includes('저장 안 됨'),
          clickAttempts,
          editableCount: document.querySelectorAll('.viewer-page [aria-label="HWPX 각주·미주 편집"]').length
        }
      })()`).catch(async (reason) => ({
        probeError: reason instanceof Error ? reason.message : String(reason),
        diagnostics: await window.webContents.executeJavaScript(`({
          status: document.querySelector('.viewer-status')?.textContent,
          markers: Array.from(document.querySelectorAll('.viewer-page sup.viewer-note-marker')).map((marker) => marker.textContent),
          enabledButtons: Array.from(document.querySelectorAll('.viewer-ribbon-controls button:not(:disabled)')).map((button) => button.getAttribute('aria-label')),
          activeLabel: document.activeElement?.getAttribute('aria-label'),
          activeText: document.activeElement?.textContent
        })`)
      }))
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (!editTriggered && editText) {
      editTriggered = true
      stableSamples = 0
      previousSignature = ''
      editProbe = await window.webContents.executeJavaScript(`(async () => {
        let phase = 'edit-button'
        const setPhase = (value) => {
          phase = value
          console.error('HAN_FLOW_E2E_PHASE ' + value)
        }
        setPhase(phase)
        const waitFor = async (predicate, timeout = 30000) => {
          const started = performance.now()
          while (performance.now() - started < timeout) {
            const result = predicate()
            if (result) return result
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          throw new Error('편집 E2E 조건 대기 시간이 초과되었습니다: ' + phase)
        }
        ${RIBBON_E2E_HELPERS}
        const surfaceLabel = ${JSON.stringify(editSurfaceLabel)}
        const targetScope = ${JSON.stringify(editTargetScope ?? null)}
        const readySurface = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
          .find((element) => element.dataset.inputReady === 'true' && (!targetScope || element.closest(targetScope)))
        let target = readySurface()
        if (!target) {
          const existingSurface = document.querySelector('[aria-label="' + surfaceLabel + '"]')
          if (!existingSurface) {
            const editButton = await waitFor(() => document.querySelector('[aria-label="HWPX 편집 시작"]'))
            editButton.click()
            setPhase('editable-surface')
          }
          target = await waitFor(readySurface)
        }
        await waitFor(() => document.querySelector('.viewer-editing-badge'))
        const activeTabAfterStart = selectedRibbonTab()
        const anchorId = target.dataset.sourceTextNodeId
        const surfaces = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
        const surfaceById = (id) => surfaces().find((element) => element.dataset.sourceTextNodeId === id)
        const currentTarget = () => surfaceById(anchorId)
        ${findProjectedSurface.toString()}
        target.focus()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        target = await waitFor(() => {
          const candidate = currentTarget()
          return candidate?.dataset.inputReady === 'true' ? candidate : undefined
        })
        const original = target.textContent ?? ''
        const textNode = (element) => {
          if (!element.firstChild) element.append(document.createTextNode(''))
          return element.firstChild
        }
        const setSelection = (element, anchorOffset, focusOffset) => {
          const selection = window.getSelection()
          const node = textNode(element)
          selection.setBaseAndExtent(node, anchorOffset, node, focusOffset)
        }
        const getSelection = (element) => {
          const selection = window.getSelection()
          const offset = (node, nodeOffset) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            range.setEnd(node, nodeOffset)
            return range.toString().length
          }
          return {
            anchorOffset: offset(selection.anchorNode, selection.anchorOffset),
            focusOffset: offset(selection.focusNode, selection.focusOffset)
          }
        }
        const mode = ${JSON.stringify(editMode)}
        let expected
        let selectionBefore
        let selectionAfter
        if (mode === 'range') {
          const from = Math.max(0, original.length - 2)
          const to = original.length
          selectionBefore = { anchorOffset: to, focusOffset: from }
          expected = original.slice(0, from) + ${JSON.stringify(editText)} + original.slice(to)
          selectionAfter = { anchorOffset: from + ${editText.length}, focusOffset: from + ${editText.length} }
          setSelection(target, selectionBefore.anchorOffset, selectionBefore.focusOffset)
          target.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ${JSON.stringify(editText)} }))
          target.textContent = expected
          setSelection(target, selectionAfter.anchorOffset, selectionAfter.focusOffset)
          target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(editText)} }))
        } else {
          selectionBefore = { anchorOffset: original.length, focusOffset: original.length }
          expected = original + ${JSON.stringify(editText)}
          selectionAfter = { anchorOffset: expected.length, focusOffset: expected.length }
          setSelection(target, selectionBefore.anchorOffset, selectionBefore.focusOffset)
          const compositionCharacters = Array.from(${JSON.stringify(editText)})
          let composed = original
          for (const character of compositionCharacters) {
            target.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
            target.textContent = composed + 'ㅎ'
            setSelection(target, composed.length + 1, composed.length + 1)
            target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'ㅎ', isComposing: true }))
            composed += character
            target.textContent = composed
            setSelection(target, composed.length, composed.length)
            target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: character, isComposing: true }))
            target.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: character }))
          }
        }
        setPhase('commit')
        await waitFor(() => {
          const undoButton = document.querySelector('[aria-label="실행 취소"]')
          return undoButton && !undoButton.disabled &&
            document.querySelector('.viewer-status')?.textContent?.includes('저장 안 됨')
        })
        setPhase('projection')
        // 빈 문단 합성 anchor(#hp:p:N:empty)는 첫 입력 뒤 새 #hp:t:M anchor로 바뀐다. caret을 가진 새 surface를 따라간다.
        const editedTarget = await waitFor(() => findProjectedSurface(surfaces(), anchorId, expected, window.getSelection()?.focusNode))
        const editedAnchorId = editedTarget.dataset.sourceTextNodeId
        // 글자·문단 모양 probe가 run을 나누면 입력 칸 element가 바뀌므로 각주·개체 종류는 편집 직후에 읽어 둔다.
        const editedNoteKind = editedTarget.closest('[data-note-kind]')?.dataset.noteKind
        const editedObjectKind = editedTarget.closest('[data-object-kind]')?.dataset.objectKind
        await waitFor(() => {
          const value = getSelection(editedTarget)
          return value.anchorOffset === selectionAfter.anchorOffset &&
            value.focusOffset === selectionAfter.focusOffset
        })
        const edited = editedTarget.textContent
        const selectionAfterProjection = getSelection(editedTarget)
        const undo = await revealRibbonControl('실행 취소')
        undo?.click()
        setPhase('undo-text')
        const undoneTarget = await waitFor(() => {
          const candidate = currentTarget()
          return candidate?.textContent === original ? candidate : undefined
        })
        setPhase('undo-selection')
        await waitFor(() => {
          const value = getSelection(undoneTarget)
          return value.anchorOffset === selectionBefore.anchorOffset && value.focusOffset === selectionBefore.focusOffset
        })
        const undoSelection = getSelection(undoneTarget)
        const undoneMatches = undoneTarget.textContent === original
        const redo = await revealRibbonControl('다시 실행')
        redo?.click()
        setPhase('redo-text')
        const redoneTarget = await waitFor(() => {
          const candidate = surfaceById(editedAnchorId)
          return candidate?.textContent === expected ? candidate : undefined
        })
        setPhase('redo-selection')
        await waitFor(() => {
          const value = getSelection(redoneTarget)
          return value.anchorOffset === selectionAfter.anchorOffset && value.focusOffset === selectionAfter.focusOffset
        })
        const redoSelection = getSelection(redoneTarget)
        // 머리말·꼬리말 끝·처음에서 방향 키: 쪽마다 되풀이된 같은 칸으로 건너가지 않고 그 쪽 칸 안에 caret이 남아야 한다.
        // 다른 쪽 칸으로 옮겨 가면 caret이 같은 글자의 처음(또는 끝)으로 튄다. 마지막 쪽(둘째 쪽) 칸에서 누른다.
        let navigationProbe
        if (${decorationTarget}) {
          setPhase('decoration-navigation')
          const settle = async () => {
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          const instances = () => surfaces().filter((element) => element.dataset.sourceTextNodeId === editedAnchorId)
          const press = async (index, key, offset, shiftKey) => {
            // 그 쪽 칸을 눌러 caret을 둔 것처럼 focus·selection 뒤 mouseup으로 selection을 알리고, 반영된 뒤 키를 누른다.
            instances()[index].focus()
            await settle()
            const element = instances()[index]
            setSelection(element, offset, offset)
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
            await settle()
            const before = getSelection(element)
            element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))
            // 실제 키보드처럼 keydown이 바꾼 selection이 화면에 반영된 뒤 keyup을 보낸다(keyup은 화면 selection을 다시 읽는다).
            await settle()
            ;(instances()[index] ?? element).dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, bubbles: true, cancelable: true }))
            await settle()
            const surface = instances()[index]
            const after = surface && surface.contains(window.getSelection()?.focusNode) ? getSelection(surface) : undefined
            const at = (value) => value?.anchorOffset === offset && value?.focusOffset === offset
            return {
              key: (shiftKey ? 'Shift+' : '') + key,
              instance: index,
              before,
              after,
              stayed: at(before) && at(after) && document.activeElement === surface
            }
          }
          const last = instances().length - 1
          const checks = [
            await press(last, 'ArrowRight', expected.length, false),
            await press(last, 'ArrowLeft', 0, false),
            await press(last, 'ArrowRight', expected.length, true),
            await press(0, 'ArrowRight', expected.length, false)
          ]
          navigationProbe = {
            instances: last + 1,
            checks,
            passed: last >= 1 && checks.every((check) => check.stayed) &&
              instances().every((element) => element.textContent === expected)
          }
        }
        let styleProbe
        if (${styleProbeEnabled}) {
          setPhase('style-buttons')
          const button = (label) => document.querySelector('[aria-label="' + label + '"]')
          const press = async (label) => (await revealRibbonControl(label))?.click()
          await revealRibbonControl('현재 텍스트 블록 굵게')
          const boldButton = await waitFor(() => {
            const candidate = button('현재 텍스트 블록 굵게')
            return candidate && !candidate.disabled ? candidate : undefined
          })
          const originalBold = boldButton.getAttribute('aria-pressed') === 'true'
          const originalItalic = button('현재 텍스트 블록 기울임')?.getAttribute('aria-pressed') === 'true'
          const originalUnderline = button('현재 텍스트 블록 밑줄')?.getAttribute('aria-pressed') === 'true'
          const originalStrikeout = button('현재 텍스트 블록 취소선')?.getAttribute('aria-pressed') === 'true'
          const alignLabels = ['왼쪽 정렬', '가운데 정렬', '오른쪽 정렬', '양쪽 정렬']
          const originalAlign = alignLabels.find((label) => button(label)?.getAttribute('aria-pressed') === 'true') ?? '왼쪽 정렬'
          const desiredAlign = originalAlign === '가운데 정렬' ? '오른쪽 정렬' : '가운데 정렬'
          const partialStart = Math.max(0, expected.length - ${editText.length})
          redoneTarget.focus()
          setSelection(redoneTarget, partialStart, expected.length)
          redoneTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          await press('현재 텍스트 블록 굵게')
          setPhase('style-bold')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold))
          const boldApplied = button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold)
          const partialRunSplit = await waitFor(() => Array.from(document.querySelectorAll('.viewer-paragraph'))
            .some((paragraph) => paragraph.textContent === expected &&
              paragraph.querySelectorAll(':scope > .viewer-editable-text').length >= 2))
          await press(desiredAlign)
          setPhase('style-align')
          await waitFor(() => button(desiredAlign)?.getAttribute('aria-pressed') === 'true')
          const alignApplied = button(desiredAlign)?.getAttribute('aria-pressed') === 'true'
          await press('실행 취소')
          setPhase('style-align-undo')
          await waitFor(() => button(originalAlign)?.getAttribute('aria-pressed') === 'true')
          await press('실행 취소')
          setPhase('style-bold-undo')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(originalBold))
          const undoRestored = button(originalAlign)?.getAttribute('aria-pressed') === 'true' &&
            button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(originalBold)
          await press('다시 실행')
          setPhase('style-bold-redo')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold))
          await press('다시 실행')
          setPhase('style-align-redo')
          await waitFor(() => button(desiredAlign)?.getAttribute('aria-pressed') === 'true')
          const sizeLabel = () => document.querySelector('[aria-label="현재 글자 크기"]')?.textContent?.trim()
          const originalSize = Number.parseFloat(sizeLabel() ?? '')
          const expectedSize = Math.min(72, originalSize + 1)
          setPhase('style-size')
          await revealRibbonControl('글자 크기 늘리기')
          const increaseSize = await waitFor(() => {
            const candidate = button('글자 크기 늘리기')
            return candidate && !candidate.disabled ? candidate : undefined
          })
          increaseSize.click()
          await waitFor(() => sizeLabel() === expectedSize + 'pt')
          const sizeApplied = sizeLabel() === expectedSize + 'pt'
          setPhase('style-color')
          await revealRibbonControl('글자 색상')
          const colorInput = await waitFor(() => {
            const candidate = document.querySelector('[aria-label="글자 색상"]')
            return candidate && !candidate.disabled ? candidate : undefined
          })
          const originalColor = colorInput.value.toLowerCase()
          const desiredColor = originalColor === '#336699' ? '#663399' : '#336699'
          const colorSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          colorSetter?.call(colorInput, desiredColor)
          colorInput.dispatchEvent(new Event('input', { bubbles: true }))
          colorInput.dispatchEvent(new Event('change', { bubbles: true }))
          await waitFor(() => document.querySelector('[aria-label="글자 색상"]')?.value.toLowerCase() === desiredColor)
          const colorApplied = document.querySelector('[aria-label="글자 색상"]')?.value.toLowerCase() === desiredColor
          const toggleDecoration = async (label, original, phase) => {
            setPhase(phase)
            await revealRibbonControl(label)
            const target = await waitFor(() => {
              const candidate = button(label)
              return candidate && !candidate.disabled ? candidate : undefined
            })
            target.click()
            await waitFor(() => button(label)?.getAttribute('aria-pressed') === String(!original))
            return button(label)?.getAttribute('aria-pressed') === String(!original)
          }
          const italicApplied = await toggleDecoration('현재 텍스트 블록 기울임', originalItalic, 'style-italic')
          const underlineApplied = await toggleDecoration('현재 텍스트 블록 밑줄', originalUnderline, 'style-underline')
          const strikeoutApplied = await toggleDecoration('현재 텍스트 블록 취소선', originalStrikeout, 'style-strikeout')
          const metricValue = (label) => document.querySelector('[aria-label="' + label + '"]')?.textContent?.trim()
          const originalLineSpacing = Number.parseFloat(metricValue('현재 줄 간격') ?? '')
          setPhase('style-line-spacing')
          await press('줄 간격 늘리기')
          await waitFor(() => metricValue('현재 줄 간격') === Math.min(300, originalLineSpacing + 10) + '%')
          const lineSpacingApplied = metricValue('현재 줄 간격') === Math.min(300, originalLineSpacing + 10) + '%'
          const originalMarginBefore = Number.parseFloat(metricValue('현재 문단 앞 간격') ?? '')
          setPhase('style-margin-before')
          await press('문단 앞 간격 늘리기')
          await waitFor(() => metricValue('현재 문단 앞 간격') === Math.min(72, originalMarginBefore + 1) + 'pt')
          const marginBeforeApplied = metricValue('현재 문단 앞 간격') === Math.min(72, originalMarginBefore + 1) + 'pt'
          const originalMarginAfter = Number.parseFloat(metricValue('현재 문단 뒤 간격') ?? '')
          setPhase('style-margin-after')
          await press('문단 뒤 간격 늘리기')
          await waitFor(() => metricValue('현재 문단 뒤 간격') === Math.min(72, originalMarginAfter + 1) + 'pt')
          const marginAfterApplied = metricValue('현재 문단 뒤 간격') === Math.min(72, originalMarginAfter + 1) + 'pt'
          const originalIndent = Number.parseFloat(metricValue('현재 첫 줄 들여쓰기') ?? '')
          setPhase('style-outdent')
          await press('첫 줄 내어쓰기')
          await waitFor(() => metricValue('현재 첫 줄 들여쓰기') === Math.max(-72, originalIndent - 1) + 'pt')
          const outdentApplied = metricValue('현재 첫 줄 들여쓰기') === Math.max(-72, originalIndent - 1) + 'pt'
          setPhase('style-indent-reset')
          await press('첫 줄 들여쓰기')
          await waitFor(() => metricValue('현재 첫 줄 들여쓰기') === originalIndent + 'pt')
          setPhase('style-indent')
          await press('첫 줄 들여쓰기')
          await waitFor(() => metricValue('현재 첫 줄 들여쓰기') === Math.min(72, originalIndent + 1) + 'pt')
          const indentApplied = metricValue('현재 첫 줄 들여쓰기') === Math.min(72, originalIndent + 1) + 'pt'
          styleProbe = {
            boldApplied,
            partialRunSplit,
            alignApplied,
            undoRestored,
            multiRunEditable: partialRunSplit,
            sizeApplied,
            colorApplied,
            italicApplied,
            underlineApplied,
            strikeoutApplied,
            lineSpacingApplied,
            marginBeforeApplied,
            marginAfterApplied,
            outdentApplied,
            indentApplied,
            redoRestored: button(desiredAlign)?.getAttribute('aria-pressed') === 'true' &&
              button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold)
          }
        }
        let saveStatusMatches
        let dirtyCleared
        if (${autoSaveEdit}) {
          setPhase('save-button')
          await revealRibbonControl('HWPX 변경본 저장')
          const saveButton = await waitFor(() => {
            const button = document.querySelector('[aria-label="HWPX 변경본 저장"]')
            return button && !button.disabled ? button : undefined
          })
          saveButton.click()
          setPhase('save-complete')
          await waitFor(() => document.querySelector('.viewer-status')?.textContent?.includes('저장 완료'))
          saveStatusMatches = /Preview (?:갱신 안 됨|없음)/.test(
            document.querySelector('.viewer-status')?.textContent ?? ''
          )
          dirtyCleared = !document.querySelector('.viewer-status')?.textContent?.includes('저장 안 됨') && saveButton.disabled
        }
        return {
          mode,
          surface: ${JSON.stringify(editSurfaceKind)},
          // 머리말·꼬리말은 쪽마다 같은 anchor의 입력 칸이 있다. 다시 실행 뒤 모든 쪽의 칸이 같은 글자인지 본다.
          decorationInstances: surfaces().filter((element) => element.dataset.sourceTextNodeId === editedAnchorId).length,
          decorationSynced: surfaces().filter((element) => element.dataset.sourceTextNodeId === editedAnchorId)
            .every((element) => element.textContent === expected),
          anchorTransition: anchorId === editedAnchorId ? undefined : { from: anchorId, to: editedAnchorId },
          noteKind: editedNoteKind,
          objectKind: editedObjectKind,
          navigationProbe,
          activeTabAfterStart,
          originalLength: original.length,
          editedMatches: edited === expected,
          undoneMatches,
          redoneMatches: redoneTarget.textContent === expected,
          projectedSelectionMatches: selectionAfterProjection.anchorOffset === selectionAfter.anchorOffset && selectionAfterProjection.focusOffset === selectionAfter.focusOffset,
          undoSelectionMatches: undoSelection.anchorOffset === selectionBefore.anchorOffset && undoSelection.focusOffset === selectionBefore.focusOffset,
          redoSelectionMatches: redoSelection.anchorOffset === selectionAfter.anchorOffset && redoSelection.focusOffset === selectionAfter.focusOffset,
          styleProbe,
          saveStatusMatches,
          dirtyCleared,
          // probe가 끝날 때(앱 종료 직전) 저장하지 않은 편집이 남았는지. dirty 종료 E2E가 닫기 확인을 실제로 거쳤는지 본다.
          dirtyAtEnd: Boolean(document.querySelector('.viewer-status')?.textContent?.includes('저장 안 됨')),
          editableCount: document.querySelectorAll('[aria-label="' + surfaceLabel + '"]').length
        }
      })()`).catch(async (reason) => ({
        probeError: reason instanceof Error ? reason.message : String(reason),
        diagnostics: await window.webContents.executeJavaScript(`({
          status: document.querySelector('.viewer-status')?.textContent,
          editableTexts: Array.from(document.querySelectorAll('.viewer-editable-text')).map((element) => ({
            sourceTextNodeId: element.dataset.sourceTextNodeId,
            text: element.textContent
          })),
          undoDisabled: document.querySelector('[aria-label="실행 취소"]')?.disabled,
          redoDisabled: document.querySelector('[aria-label="다시 실행"]')?.disabled
        })`)
      }))
      setTimeout(() => void captureWhenReady(), 250)
      return
    }
    if (capturePath) {
      const image = await window.webContents.capturePage()
      await writeFile(capturePath, image.toPNG())
    }
    const visualState = await window.webContents.executeJavaScript(`({
      images: Array.from(document.querySelectorAll('.viewer-page img')).map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth, srcLength: image.src.length })),
      totalPages: Number(document.querySelector('.viewer-pages')?.dataset.totalPages || 0),
      documentFormat: document.querySelector('.viewer-pages')?.dataset.documentFormat,
      mountedPages: document.querySelectorAll('.viewer-page').length,
      pageSizes: Array.from(document.querySelectorAll('.viewer-page')).map((page) => ({ width: page.clientWidth, height: page.clientHeight })),
      documentLoading: document.querySelector('.viewer-pages')?.dataset.documentLoading === 'true',
      // scripts/pdf_text_count.mjs와 같은 규칙: code point 단위, 공백·사설 영역(\\p{Co}) 글자 제외.
      pageTextCounts: Array.from(document.querySelectorAll('.viewer-page')).map((page) => Number(page.dataset.textCharacters || 0) || (page.innerText.match(/[^\\s\\p{Co}]/gu) || []).length),
      // PDF 비교 census(scripts/pdf_text_count.mjs textCensus와 같은 규칙): 비교 글자·공백 외 전체·사설 영역·ASCII 숫자.
      // privateUseCodePoints는 사설 영역 글자별 수({ 'U+F028B': 2 }). verify_pdf가 PDF에서 빠진 글자를 code point별로 판정한다.
      pageTextCensus: Array.from(document.querySelectorAll('.viewer-page')).map((page) => {
        const number = Number(page.dataset.pageIndex) + 1
        const codePointCounts = (characters) => characters.reduce((counts, character) => {
          const key = 'U+' + character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
          counts[key] = (counts[key] || 0) + 1
          return counts
        }, {})
        if (page.dataset.textRaw !== undefined) {
          const privateUseCodePoints = Object.fromEntries((page.dataset.textPrivateUseCodePoints || '').split(' ').filter(Boolean).map((entry) => {
            const [key, count] = entry.split(':')
            return [key, Number(count)]
          }))
          return { page: number, comparable: Number(page.dataset.textCharacters || 0), raw: Number(page.dataset.textRaw), privateUse: Number(page.dataset.textPrivateUse || 0), digits: Number(page.dataset.textDigits || 0), privateUseCodePoints }
        }
        const text = page.innerText
        return { page: number, comparable: (text.match(/[^\\s\\p{Co}]/gu) || []).length, raw: (text.match(/\\S/gu) || []).length, privateUse: (text.match(/\\p{Co}/gu) || []).length, digits: (text.match(/[0-9]/g) || []).length, privateUseCodePoints: codePointCounts(text.match(/\\p{Co}/gu) || []) }
      }),
      overflowPages: Array.from(document.querySelectorAll('.viewer-page')).map((page) => page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1 ? Number(page.dataset.pageIndex) + 1 : 0).filter(Boolean),
      // 원본처럼 그리지 못한 개체 자리 표시(종류별)와, 그 안에서 되살린 글(글상자 글·수식 script·각주 본문 등) 글자 수.
      placeholderCounts: Array.from(document.querySelectorAll('.viewer-page [data-object-kind]')).reduce((counts, element) => {
        const kind = element.dataset.objectKind
        if (kind && kind !== 'note-list') counts[kind] = (counts[kind] || 0) + 1
        return counts
      }, {}),
      // 원본 위치로 그린 개체(hp:pos treatAsChar="0"): 쪽 번호, 배치(band·wrap·overlay·page), 배치 방식, 개체 상자의 용지 기준 위치·크기(CSS px, 배율 제외).
      positionedObjects: Array.from(document.querySelectorAll('.viewer-page [data-object-placement]')).map((element) => {
        const page = element.closest('.viewer-page')
        const pageBox = page.getBoundingClientRect()
        const scale = pageBox.width / (page.offsetWidth || pageBox.width || 1) || 1
        const target = element.firstElementChild ?? element
        const box = target.getBoundingClientRect()
        const round = (value) => Math.round(value * 10) / 10
        // 자리 차지·글 옆 배치 개체가 비운 자리(감싼 상자)에 개체 밖 본문 글이 들어왔는지. 글 앞·뒤 개체와 본문 자리를 비우지 않는
        // 머리말·꼬리말 안 개체는 겹쳐도 된다.
        const container = element.dataset.objectContainer ?? (element.closest('.viewer-header') ? 'header' : element.closest('.viewer-footer') ? 'footer' : undefined)
        const overlay = element.dataset.objectWrap === 'BEHIND_TEXT' || element.dataset.objectWrap === 'IN_FRONT_OF_TEXT' || container === 'header' || container === 'footer'
        const reserved = element.getBoundingClientRect()
        let textOverlap = false
        // 글 옆 배치 개체: 같은 높이에서 개체 옆으로 흐른 본문 글 줄이 있는지.
        const sideWrap = element.dataset.objectWrap === 'SQUARE' || element.dataset.objectWrap === 'TIGHT' || element.dataset.objectWrap === 'THROUGH'
        let textBeside = false
        if (!overlay) {
          const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
          const range = document.createRange()
          for (let node = walker.nextNode(); node && !textOverlap; node = walker.nextNode()) {
            if (!node.textContent?.trim() || element.contains(node) || node.parentElement?.closest('.viewer-header, .viewer-footer, .viewer-page-number, .viewer-footnotes')) continue
            range.selectNodeContents(node)
            const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0)
            textOverlap = rects.some((rect) =>
              rect.left < reserved.right - 1 && rect.right > reserved.left + 1 && rect.top < reserved.bottom - 1 && rect.bottom > reserved.top + 1)
            if (sideWrap && !textBeside) textBeside = rects.some((rect) => rect.top >= reserved.top - 1 && rect.bottom <= reserved.bottom + 1 &&
              (rect.right <= reserved.left + 1 || rect.left >= reserved.right - 1))
          }
        }
        return {
          page: Number(page.dataset.pageIndex) + 1,
          placement: element.dataset.objectPlacement,
          wrap: element.dataset.objectWrap,
          container: container ?? (element.parentElement?.closest('td') ? 'cell' : element.parentElement?.closest('.viewer-object-body') ? 'text-box' : undefined),
          textOverlap,
          ...(sideWrap ? { textBeside } : {}),
          kind: target.dataset?.objectKind ?? (target.tagName === 'IMG' ? 'image' : target.tagName === 'TABLE' ? 'table' : target.tagName.toLowerCase()),
          x: round((box.left - pageBox.left) / scale),
          y: round((box.top - pageBox.top) / scale),
          width: round(box.width / scale),
          height: round(box.height / scale)
        }
      }),
      // MathML로 그린 수식(수식 script를 해석한 것): 원본 개체 수에는 들고 안내 배너 개수에서는 빠진다.
      renderedEquations: document.querySelectorAll('.viewer-page [data-equation-rendered]').length,
      recoveredObjectCharacters: Array.from(document.querySelectorAll('.viewer-page .viewer-object-body, .viewer-page .viewer-object-fallback, .viewer-page .viewer-note-body, .viewer-page ruby, .viewer-page .viewer-equation-math'))
        .filter((element) => !element.parentElement?.closest('.viewer-object-body, .viewer-note-body'))
        .reduce((sum, element) => sum + (element.textContent.match(/[^\\s\\p{Co}]/gu) || []).length, 0),
      objectNotice: document.querySelector('.viewer-object-banner-text')?.textContent ?? null,
      // 쪽보다 커서 줄여 그린 자리 표시(선언 크기 축소)와 쪽 높이에 맞춰 줄인 되살린 글 상자 수.
      fittedObjects: {
        declared: document.querySelectorAll('.viewer-page [data-object-fitted]').length,
        body: document.querySelectorAll('.viewer-page [data-fit-scale]').length
      },
      // scrollWidth는 왼쪽으로 나간 내용을 세지 않는다. 글자 rect가 용지 좌우 밖에 있으면 PDF에서 잘린다.
      outsidePageTextPages: Array.from(document.querySelectorAll('.viewer-page:not(.viewer-fixed-page)')).map((page) => {
        const box = page.getBoundingClientRect()
        const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue
          range.selectNodeContents(node)
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && (rect.left < box.left - 1 || rect.right > box.right + 1)) return Number(page.dataset.pageIndex) + 1
          }
        }
        return 0
      }).filter(Boolean),
      // 표 셀 글자가 셀 좌우 경계를 넘어 이웃 셀과 겹치는 위치(페이지 번호·셀 text).
      cellOverflowTexts: Array.from(document.querySelectorAll('.viewer-page:not(.viewer-fixed-page) .viewer-table td')).flatMap((cell) => {
        const box = cell.getBoundingClientRect()
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.closest('td') !== cell) continue
          range.selectNodeContents(node)
          const outside = (rect) => rect.width > 0 ? Math.max(box.left - rect.left, rect.right - box.right) : 0
          if (!Array.from(range.getClientRects()).some((rect) => outside(rect) > 1)) continue
          // pre-wrap 줄 끝 공백은 줄 밖으로 걸쳐도 보이지 않으므로, 보이는 글자만 하나씩 잰다.
          const text = node.textContent ?? ''
          for (let index = 0; index < text.length; index += 1) {
            if (/\\s/.test(text[index])) continue
            range.setStart(node, index)
            range.setEnd(node, index + 1)
            const overshoot = Math.max(0, ...Array.from(range.getClientRects()).map(outside))
            if (overshoot > 1) {
              return [(Number(cell.closest('.viewer-page')?.dataset.pageIndex) + 1) + ':' + (cell.textContent ?? '').trim().slice(0, 20) + ' (' + overshoot.toFixed(1) + 'px)']
            }
          }
        }
        return []
      }),
      // 쪽 아래 각주: 본문 번호 표시(sup)가 놓인 쪽과 그 각주 첫 조각이 놓인 쪽이 다른 각주, 다음 쪽으로 이어지는 조각 수.
      // 화면에 올린 쪽(virtualization)끼리만 비교한다.
      footnotePlacement: (() => {
        const anchorPages = new Map()
        const notePages = new Map()
        let continuations = 0
        for (const page of document.querySelectorAll('.viewer-page:not(.viewer-fixed-page)')) {
          const index = Number(page.dataset.pageIndex)
          page.querySelectorAll('sup[data-object-kind="footnote"]').forEach((marker) => {
            if (!marker.closest('.viewer-footnotes') && !anchorPages.has(marker.dataset.sourcePath)) anchorPages.set(marker.dataset.sourcePath, index)
          })
          page.querySelectorAll('.viewer-footnotes .viewer-footnote').forEach((note) => {
            if (note.classList.contains('viewer-footnote-continued')) continuations += 1
            else if (!notePages.has(note.dataset.sourcePath)) notePages.set(note.dataset.sourcePath, index)
          })
        }
        const mismatched = Array.from(anchorPages).filter(([path, index]) => notePages.has(path) && notePages.get(path) !== index)
          .map(([path, index]) => path + ': ' + (index + 1) + '쪽 번호, ' + (notePages.get(path) + 1) + '쪽 각주')
        const missing = Array.from(anchorPages.keys()).filter((path) => !notePages.has(path))
        return { anchors: anchorPages.size, notes: notePages.size, continuations, mismatched, missing }
      })(),
      columnCounts: Array.from(document.querySelectorAll('.viewer-page')).map((page) => page.querySelectorAll(':scope > .viewer-column-flow > .viewer-column').length),
      columnTextCounts: Array.from(document.querySelectorAll('.viewer-page')).map((page) =>
        Array.from(page.querySelectorAll(':scope > .viewer-column-flow > .viewer-column')).map((column) =>
          (column.textContent?.match(/\\S/g) || []).length
        )
      ),
      // 다단 영역마다 단의 가로 위치(쪽 왼쪽 끝 기준 CSS px, 확대 비율 제외)·글자, 단 사이 구분선 위치. 화면에 올린 쪽만 잰다.
      columnLayouts: Array.from(document.querySelectorAll('.viewer-page:not(.viewer-fixed-page)')).map((page) => {
        const pageBox = page.getBoundingClientRect()
        const scale = page.offsetWidth ? pageBox.width / page.offsetWidth : 1
        const x = (value) => Math.round((value - pageBox.left) / scale * 10) / 10
        return {
          page: Number(page.dataset.pageIndex) + 1,
          regions: Array.from(page.querySelectorAll(':scope > .viewer-column-flow')).map((region) => {
            const regionBox = region.getBoundingClientRect()
            return {
              top: Math.round((regionBox.top - pageBox.top) / scale * 10) / 10,
              height: Math.round(regionBox.height / scale * 10) / 10,
              columns: Array.from(region.querySelectorAll(':scope > .viewer-column')).map((column) => {
                const box = column.getBoundingClientRect()
                return {
                  index: Number(column.dataset.columnIndex),
                  left: x(box.left),
                  width: Math.round(box.width / scale * 10) / 10,
                  text: (column.textContent ?? '').replace(/\\s+/g, ' ').trim()
                }
              }),
              rules: Array.from(region.querySelectorAll(':scope > .viewer-column-rule')).map((rule) => {
                const box = rule.getBoundingClientRect()
                return { x: x(box.left + box.width / 2), height: Math.round(box.height / scale * 10) / 10 }
              })
            }
          })
        }
      }).filter((page) => page.regions.length),
      tableTopologies: Array.from(document.querySelectorAll('.viewer-page .viewer-table')).map((table) => ({
        rows: table.querySelectorAll(':scope > tbody > tr').length,
        columns: table.querySelectorAll(':scope > colgroup > col').length,
        rowCellCounts: Array.from(table.querySelectorAll(':scope > tbody > tr')).map((row) => row.querySelectorAll(':scope > td').length),
        columnSpans: Array.from(table.querySelectorAll(':scope > tbody > tr > td')).map((cell) => Number(cell.getAttribute('colspan') ?? 1))
      })),
      errorVisible: Boolean(document.querySelector('.viewer-error')),
      errorCode: document.querySelector('.viewer-error')?.dataset.errorCode || null,
      errorMessageLength: document.querySelector('.viewer-error')?.textContent?.trim().length || 0,
      search: {
        open: Boolean(document.querySelector('.viewer-search')),
        pages: Number(document.querySelector('[data-search-pages]')?.dataset.searchPages || 0),
        occurrences: Number(document.querySelector('[data-search-occurrences]')?.dataset.searchOccurrences || 0),
        highlights: document.querySelectorAll('.viewer-fixed-page-search-hit').length,
        activePages: document.querySelectorAll('.viewer-fixed-page-search-active').length
      },
      selectionCharacters: (() => {
        const run = document.querySelector('.viewer-fixed-page-text-run')
        const selection = window.getSelection()
        if (!run || !selection) return 0
        const range = document.createRange()
        range.selectNodeContents(run)
        selection.removeAllRanges()
        selection.addRange(range)
        const count = Array.from(selection.toString()).length
        selection.removeAllRanges()
        return count
      })(),
      accessibility: {
        documentPages: document.querySelectorAll('.viewer-fixed-page[role="document"][aria-label]').length,
        hiddenImages: document.querySelectorAll('.viewer-fixed-page-image[aria-hidden="true"]').length,
        labeledTextLayers: document.querySelectorAll('.viewer-fixed-page-text-layer[aria-label]').length
      },
      // 상단 막대·리본 control이 글자 줄바꿈으로 세로로 넘치지 않는지 탭 panel마다 하나씩 펼쳐 잰다.
      toolbarLayout: (() => {
        const toolbar = document.querySelector('.viewer-toolbar')
        if (!toolbar) return null
        const panels = Array.from(toolbar.querySelectorAll('.viewer-ribbon-panel'))
        const originallyHidden = panels.map((panel) => panel.hidden)
        const overflowing = new Set()
        const canvas = document.createElement('canvas').getContext('2d')
        const textWidth = (element, text) => {
          const style = getComputedStyle(element)
          canvas.font = style.font || [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(' ')
          return canvas.measureText(text).width
        }
        // select는 가장 긴 option 글자, 글자 input은 값(없으면 placeholder)이 글자 칸(clientWidth - 좌우 padding)에 들어가야 한다.
        // ribbon select는 화살표를 padding 안에 그리므로(main.css) 오른쪽 padding이 화살표 자리다.
        const measureFields = () => {
          for (const element of toolbar.querySelectorAll('select, input')) {
            if (!element.getClientRects().length) continue
            if (element.tagName === 'INPUT' && !['text', 'search', ''].includes(element.type)) continue
            const style = getComputedStyle(element)
            const texts = element.tagName === 'SELECT' ? Array.from(element.options).map((option) => option.text) : [element.value || element.placeholder || '']
            const longest = Math.max(0, ...texts.map((text) => textWidth(element, text)))
            const available = element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
            if (longest > available + 0.5) overflowing.add(element.getAttribute('aria-label') || element.className || element.tagName)
          }
        }
        const measure = () => {
          measureFields()
          for (const element of toolbar.querySelectorAll('button, output, .viewer-file-name, .viewer-ribbon-group-label, .viewer-editing-badge')) {
            if (!element.getClientRects().length) continue
            // 파일 이름은 의도한 말줄임이므로 가로 넘침은 세지 않는다.
            const clipsHorizontally = !element.classList.contains('viewer-file-name') && element.scrollWidth > element.clientWidth + 1
            if (element.scrollHeight > element.clientHeight + 1 || clipsHorizontally) {
              overflowing.add(element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 24) || element.className)
            }
          }
        }
        if (!panels.length) measure()
        panels.forEach((panel, index) => {
          panels.forEach((other, otherIndex) => { other.hidden = otherIndex !== index })
          measure()
        })
        panels.forEach((panel, index) => { panel.hidden = originallyHidden[index] })
        const name = toolbar.querySelector('.viewer-file-name')
        const nameStyle = name ? getComputedStyle(name) : undefined
        return {
          overflowControls: Array.from(overflowing),
          fileName: name ? {
            title: name.getAttribute('title'),
            truncated: name.scrollWidth > name.clientWidth + 1,
            singleLine: name.getBoundingClientRect().height <= Number.parseFloat(nameStyle.lineHeight === 'normal' ? nameStyle.fontSize : nameStyle.lineHeight) * 1.6,
            ellipsis: nameStyle.textOverflow === 'ellipsis' && nameStyle.whiteSpace === 'nowrap'
          } : null
        }
      })(),
      editingUi: (() => {
        const ribbon = document.querySelector('.viewer-edit-ribbon')
        const toolbar = document.querySelector('.viewer-toolbar')
        const panel = document.querySelector('.viewer-ribbon-panel:not([hidden])')
        const buttons = Array.from(panel?.querySelectorAll('.viewer-ribbon-controls button') ?? [])
        return {
          ribbonVisible: Boolean(ribbon),
          tabs: Array.from(document.querySelectorAll('.viewer-ribbon-tabs [role="tab"]')).map((tab) => tab.textContent?.trim()),
          activeTab: document.querySelector('.viewer-ribbon-tabs [aria-selected="true"]')?.textContent?.trim(),
          groupLabels: Array.from(panel?.querySelectorAll('.viewer-ribbon-group-label') ?? []).map((element) => element.textContent?.trim()),
          toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0,
          minimumButtonHeight: buttons.length ? Math.min(...buttons.map((button) => Math.round(button.getBoundingClientRect().height))) : 0
        }
      })(),
      status: document.querySelector('.viewer-status')?.textContent,
      timing: document.querySelector('.viewer-status')?.getAttribute('title')
    })`)
    clearInterval(memoryInterval)
    sampleMemory()
    const processMetrics = app.getAppMetrics()
    visualState.memory = {
      processCount: processMetrics.length,
      currentWorkingSetKb: processMetrics.reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
      sampledPeakWorkingSetKb,
      processPeakSumKb: processMetrics.reduce((sum, metric) => sum + metric.memory.peakWorkingSetSize, 0)
    }
    visualState.editingProbe = editProbe
    if (recoveryText) visualState.recoveryProbe = recoveryProbe
    if (expectedText) {
      visualState.expectedTextPresent = await window.webContents.executeJavaScript(
        `(document.querySelector('.viewer-pages')?.innerText ?? '').includes(${JSON.stringify(expectedText)})`
      )
      // 글자가 든 쪽 수(머리말·꼬리말 편집은 그 머리말을 쓰는 모든 쪽에 있어야 한다).
      visualState.expectedTextPageCount = await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.viewer-page')).filter((page) => (page.innerText ?? '').includes(${JSON.stringify(expectedText)})).length`
      )
    }
    // 쪽 virtualization(50쪽 초과) 문서는 보이는 쪽만 DOM에 있다. verify_app이 원문 개체 수와 비교하도록 쪽을 끝까지 넘기며 쪽마다
    // 자리 표시를 한 번씩 세고 처음 scroll 위치로 돌아온다. 위 값(mountedPages 등)은 넘기기 전 상태다.
    if (
      testValue('HAN_FLOW_VISUAL_OBJECT_CENSUS') === '1' &&
      Number(visualState.mountedPages) < Number(visualState.totalPages)
    ) {
      const censusTimeoutMs = Number(testValue('HAN_FLOW_VISUAL_OBJECT_CENSUS_TIMEOUT_MS') ?? 180_000)
      visualState.objectCensus = await window.webContents.executeJavaScript(`(async () => {
        const stage = document.querySelector('.viewer-stage')
        const totalPages = Number(document.querySelector('.viewer-pages')?.dataset.totalPages || 0)
        const deadline = Date.now() + ${Number.isFinite(censusTimeoutMs) ? censusTimeoutMs : 180_000}
        const visited = new Set()
        const placeholderCounts = {}
        const collect = () => {
          for (const page of document.querySelectorAll('.viewer-page')) {
            const index = Number(page.dataset.pageIndex)
            if (!Number.isInteger(index) || visited.has(index)) continue
            visited.add(index)
            for (const element of page.querySelectorAll('[data-object-kind]')) {
              const kind = element.dataset.objectKind
              if (kind && kind !== 'note-list') placeholderCounts[kind] = (placeholderCounts[kind] || 0) + 1
            }
          }
        }
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
        // scroll 뒤 React가 보이는 쪽 범위를 바꿀 때까지(첫 쪽 번호가 바뀌거나 몇 frame) 기다린다.
        const settle = async (before) => {
          for (let attempt = 0; attempt < 30; attempt += 1) {
            await frame()
            if (document.querySelector('.viewer-page')?.dataset.pageIndex !== before && attempt >= 1) return
          }
        }
        // 화면 기준 쪽 간격(배율 포함). 보이는 범위는 화면 높이 앞뒤로 2쪽씩 더 mount하므로 한 번에 화면 높이 + 3쪽씩 넘긴다.
        const stride = () => {
          const mounted = document.querySelectorAll('.viewer-page')
          return mounted.length > 1 ? Math.max(mounted[1].getBoundingClientRect().top - mounted[0].getBoundingClientRect().top, 1) : 0
        }
        const scrollTo = async (top) => {
          const before = document.querySelector('.viewer-page')?.dataset.pageIndex
          stage.scrollTop = top
          await settle(before)
          collect()
        }
        const start = stage ? stage.scrollTop : 0
        collect()
        let timedOut = false
        if (stage) {
          await scrollTo(0)
          while (visited.size < totalPages) {
            if (Date.now() > deadline) { timedOut = true; break }
            const top = stage.scrollTop
            await scrollTo(top + Math.max(stage.clientHeight, 200) + 3 * stride())
            if (stage.scrollTop <= top) break
          }
          // 넘기다 빠진 쪽이 있으면 그 쪽 위치로 다시 간다.
          for (let index = 0; index < totalPages && visited.size < totalPages && !timedOut; index += 1) {
            if (visited.has(index)) continue
            if (Date.now() > deadline) { timedOut = true; break }
            await scrollTo(index * stride())
          }
          stage.scrollTop = start
          await settle(document.querySelector('.viewer-page')?.dataset.pageIndex)
        }
        return { totalPages, visitedPages: visited.size, placeholderCounts, timedOut }
      })()`)
    }
    visualState.windowTitle = window.getTitle()
    visualState.suggestedPdfPath = suggestedPdfExportPath(currentDocumentPaths.get(window.webContents.id), lastDialogDirectory)
    if (stateOutput) await writeFile(stateOutput, JSON.stringify(visualState, null, 2))
    console.log('Visual test state:', visualState)
    if (exitWhenComplete) app.quit()
  }
  setTimeout(() => void captureWhenReady(), captureDelayMs)
}

/*
 * 편집 복구 제안. 남은 복구 기록은 (1) 앱 시작, (2) 같은 원본 문서를 열 때, (3) 편집 엔진이 비정상 종료한 직후에 묻는다.
 * [복구]를 고르면 main이 renderer에 `recovery:start`를 보내고, renderer가 원본을 연 뒤 `editing:recover`로 기록을 replay한다.
 */
const recoveryTestChoice = recoveryChoiceFromTestValue(testValue('HAN_FLOW_E2E_RECOVERY_ACTION'))
/** 창마다 main이 복구를 시작하라고 보낸 기록. `editing:recover`는 이 기록만 받는다. */
const pendingRecoveries = new Map<number, { journalId: string; filePath: string }>()
/** 지금 대화상자를 띄운 기록(같은 기록을 두 번 묻지 않는다) */
const offeringJournals = new Set<string>()
/** 이번 실행에서 이미 답한 기록. 앱 시작 목록에서 다시 묻지 않는다(문서를 다시 열면 묻는다). */
const answeredJournals = new Set<string>()
/** 시작할 때 열 문서가 정해진 창. 그 문서의 기록은 문서 열기 쪽에서 묻는다. */
const initialOpenWindows = new Map<number, string>()
let startupRecoveryOffered = false

/** 다른 곳에서 쓰는 기록: 열린 편집 session·복구 중인 기록, 대화상자를 띄운 기록, 창에 복구를 시작하라고 보낸 기록. */
function journalsInUse(): Set<string> {
  return new Set([
    ...editingSessions.activeJournalIds(),
    ...offeringJournals,
    ...[...pendingRecoveries.values()].map(({ journalId }) => journalId)
  ])
}

async function askRecovery(window: BrowserWindow | null, prompt: RecoveryDialog): Promise<RecoveryChoice> {
  if (recoveryTestChoice) {
    return prompt.choices.includes(recoveryTestChoice) ? recoveryTestChoice : prompt.choices[prompt.cancelId]
  }
  const { response } = await showMessageBox(window && !window.isDestroyed() ? window : null, {
    type: prompt.type,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail,
    buttons: prompt.buttons,
    defaultId: prompt.defaultId,
    cancelId: prompt.cancelId,
    noLink: true
  })
  return prompt.choices[response] ?? prompt.choices[prompt.cancelId]
}

/** 기록 하나를 묻는다. 원본이 그대로면 [복구][버리기][나중에], 바뀌었거나 없으면 복구할 수 없다고 알리고 [나중에][버리기]. */
async function offerRecovery(
  window: BrowserWindow,
  candidate: RecoveryJournalCandidate,
  reason: RecoveryPromptReason,
  targetWindow: () => Promise<BrowserWindow | undefined>
): Promise<void> {
  const journalId = candidate.sessionId
  // 다른 창이 묻고 있거나 복구하려는 기록은 다시 묻지 않는다(두 창이 같은 기록을 복구하지 않게).
  if (journalsInUse().has(journalId)) return
  offeringJournals.add(journalId)
  try {
    const state = await verifyRecoverySource(candidate.header)
    if (window.isDestroyed()) return
    const choice = await askRecovery(
      window,
      state === 'match' ? recoveryOfferDialog(candidate, reason) : recoveryUnavailableDialog(candidate, state)
    )
    answeredJournals.add(journalId)
    if (choice === 'discard') {
      await discardRecoveryJournal(recoveryDirectory, journalId)
      return
    }
    if (choice !== 'recover' || state !== 'match') return
    const target = await targetWindow()
    if (!target || target.isDestroyed()) return
    const senderId = target.webContents.id
    pendingRecoveries.set(senderId, { journalId, filePath: candidate.header.sourcePath })
    await documentPaths.allow(senderId, candidate.header.sourcePath)
    revealWindow(target)
    target.webContents.send('recovery:start', { filePath: candidate.header.sourcePath, journalId })
  } catch (reason) {
    console.warn('편집 복구 제안 실패:', reason)
  } finally {
    offeringJournals.delete(journalId)
  }
}

/** 문서를 받을 창이 비어 있으면 그 창, 아니면 새 창(load가 끝난 뒤). */
async function emptyOrNewWindow(window: BrowserWindow): Promise<BrowserWindow | undefined> {
  const id = window.isDestroyed() ? undefined : window.webContents.id
  if (
    id !== undefined &&
    !currentDocumentPaths.has(id) &&
    !pendingRecoveries.has(id) &&
    !initialOpenWindows.has(id) &&
    !editingSessions.currentSessionId(id)
  ) {
    return window
  }
  const created = createWindow()
  await new Promise<void>((resolvePromise) => created.webContents.once('did-finish-load', () => resolvePromise()))
  return created.isDestroyed() ? undefined : created
}

async function offerStartupRecoveries(window: BrowserWindow): Promise<void> {
  // 목록을 읽는 동안 시작 문서 열기가 끝나도 그 문서는 문서 열기 쪽이 묻도록 먼저 기억한다.
  const initialPaths = [...initialOpenWindows.values()]
  // 보관 기한(30일)이 지난 격리·[나중에]·다른 version 기록을 지운다. 첫 창을 띄운 뒤 비동기로 돌아 시작을 막지 않는다.
  const pruned = await pruneRecoveryJournals(recoveryDirectory, { exclude: journalsInUse() })
  if (pruned.length) console.warn('보관 기한이 지난 편집 복구 기록을 지웠습니다:', pruned)
  const scan = await scanRecoveryJournals(recoveryDirectory, journalsInUse())
  if (scan.quarantined.length) console.warn('손상된 편집 복구 기록을 격리했습니다:', scan.quarantined)
  for (const candidate of scan.candidates) {
    if (answeredJournals.has(candidate.sessionId)) continue
    // 시작하며 여는 문서의 기록은 그 문서가 열린 뒤 문서 열기 쪽에서 묻는다.
    if (initialPaths.some((path) => samePath(path, candidate.header.sourcePath))) continue
    // 기록 header의 경로는 앱 밖에서 바뀔 수 있다. local 경로가 아니면(UNC·장치 경로 등) 앱 시작 때는 lstat도 하지 않고
    // 남겨 둔다. 사용자가 그 문서를 직접 열면 문서 열기 쪽에서 묻는다.
    if (!isLocalRecoverySourcePath(candidate.header.sourcePath)) continue
    const parent = BrowserWindow.getAllWindows().find((candidateWindow) => !candidateWindow.isDestroyed()) ?? window
    await offerRecovery(parent, candidate, 'startup', () => emptyOrNewWindow(parent))
  }
}

/** 이 창이 방금 연 HWPX 문서에 남은 기록이 있으면 묻는다(가장 최근 기록 하나). */
async function offerRecoveryForOpenedDocument(senderId: number, filePath: string): Promise<void> {
  const window = windowsById.get(senderId)
  if (!window || window.isDestroyed()) return
  const scan = await scanRecoveryJournals(recoveryDirectory, journalsInUse())
  const candidate = scan.candidates.find((entry) => samePath(entry.header.sourcePath, filePath))
  if (!candidate) return
  await offerRecovery(window, candidate, 'open', async () => window)
}

/** 편집 엔진이 timeout·crash·OOM으로 끝나 기록이 남았다. renderer가 "편집 세션 종료"를 처리한 뒤 곧바로 복구를 묻는다. */
function offerRecoveryAfterEngineFailure(event: EditingSessionLostEvent): void {
  const window = windowsById.get(event.senderId)
  if (!window || window.isDestroyed()) return
  setTimeout(() => {
    void (async () => {
      const candidate = await readRecoveryJournalHeader(recoveryDirectory, event.journalId).catch(() => undefined)
      if (candidate && !window.isDestroyed()) await offerRecovery(window, candidate, 'crash', async () => window)
    })()
  }, 100)
}

async function reportRecoveryFailure(window: BrowserWindow | null, journalId: string, reason: unknown): Promise<void> {
  if (reason instanceof RecoverySourceChangedError) {
    const candidate = await readRecoveryJournalHeader(recoveryDirectory, journalId).catch(() => undefined)
    if (!candidate) return
    const state = await verifyRecoverySource(candidate.header)
    const choice = await askRecovery(window, recoveryUnavailableDialog(candidate, state === 'missing' ? 'missing' : 'changed'))
    if (choice === 'discard') await discardRecoveryJournal(recoveryDirectory, journalId)
    return
  }
  const quarantinePath = (reason as { quarantinePath?: string }).quarantinePath
  if (!quarantinePath) return
  const message = reason instanceof Error ? reason.message : String(reason)
  const choice = await askRecovery(window, recoveryFailedDialog(message, quarantinePath))
  if (choice === 'discard') await discardQuarantinedJournal(recoveryDirectory, quarantinePath)
}

function focusedWindowId(): number | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused || focused.isDestroyed()) return null
  const windowId = focused.webContents.id
  return windowsById.has(windowId) ? windowId : null
}

function revealWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function sendOpenPath(window: BrowserWindow, request: OpenPathRequest): void {
  // main이 건넨 경로이므로 이 창의 허용목록에 먼저 올린 뒤 renderer에 알린다.
  void documentPaths.allow(window.webContents.id, request.filePath)
  revealWindow(window)
  window.webContents.send('file:open', request)
  captureVisualState(window)
}

function applyOpenPathDecision(decision: OpenPathDecision): void {
  if (decision.action === 'create') {
    createWindow(decision.request)
    return
  }
  if (decision.action !== 'deliver') return
  const window = windowsById.get(decision.windowId)
  if (!window || window.isDestroyed()) {
    // closed 처리 전에 사라진 창이면 목록에서 빼고 남은 창으로 다시 정한다.
    windowsById.delete(decision.windowId)
    openPathRouter.removeWindow(decision.windowId)
    applyOpenPathDecision(openPathRouter.route(decision.request, focusedWindowId()))
    return
  }
  sendOpenPath(window, decision.request)
}

function flushPendingOpen(): void {
  applyOpenPathDecision(openPathRouter.flush(focusedWindowId()))
}

function deliverOpenPath(filePath: string, receivedAt = Date.now()): void {
  if (!isDocumentPath(filePath)) return
  applyOpenPathDecision(openPathRouter.route({ filePath, receivedAt }, focusedWindowId()))
}

function createWindow(initialOpen?: OpenPathRequest): BrowserWindow {
  const visualCapturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const visualStateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  // Create the browser window.
  const window = new BrowserWindow({
    width: 1200,
    height: visualCapturePath || visualStateOutput ? 1500 : 800,
    show: false,
    title: APP_TITLE,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // macOS 네이티브 스타일 최적화
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 보안 기본값을 명시한다. renderer는 sandbox·context isolation 안에서 preload가 노출한 API만 쓴다.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: !visualStateOutput
    }
  })
  if (visualStateOutput) {
    window.webContents.on('console-message', ({ message }) => {
      if (message.startsWith('HAN_FLOW_E2E_PHASE ')) console.error(message)
    })
  }

  const senderId = window.webContents.id
  windowsById.set(senderId, window)
  // 창 제목은 main이 문서 경로로 정한다. renderer의 document.title은 PDF 제목(문서 이름)으로 쓰므로 창 제목에 반영하지 않는다.
  window.on('page-title-updated', (event) => event.preventDefault())
  openPathRouter.addWindow(senderId)
  let closeApproved = false
  let resolvingClose = false
  window.webContents.on('did-finish-load', () => {
    openPathRouter.markReady(senderId)
    flushPendingOpen()
    if (!startupRecoveryOffered) {
      startupRecoveryOffered = true
      void offerStartupRecoveries(window).catch((reason) => console.warn('편집 복구 기록 확인 실패:', reason))
    }
  })
  // 창을 떠나면 아직 내리지 않은 편집 기록을 바로 디스크에 쓴다.
  window.on('blur', () => void editingSessions.flushJournal(senderId))
  window.webContents.once('destroyed', () => {
    documentImporter.cancel(senderId)
    // 닫기 확인을 거친 창은 이미 끝냈다. 그 밖의 경우(renderer 비정상 종료 등)는 window-all-closed가 정리를 기다린다.
    void editingSessions.stop(senderId)
    documentPaths.forget(senderId)
    latestImportLoadIds.delete(senderId)
    currentDocumentPaths.delete(senderId)
    pendingRecoveries.delete(senderId)
    initialOpenWindows.delete(senderId)
  })
  window.on('close', (event) => {
    if (closeApproved) return
    const sessionId = editingSessions.currentSessionId(senderId)
    if (!sessionId) return
    const dirty = editingSessions.isDirty(senderId)
    // 확인 대화상자를 띄우기 전에 기록을 내린다. 대화상자 중 OS가 앱을 끝내도 편집이 남는다.
    if (dirty) void editingSessions.flushJournal(senderId)
    // 편집 session이 있는 창은 session을 끝내고(복구 기록 삭제까지) 나서 닫는다. 닫힌 뒤에 지우면 앱이 먼저 끝나
    // 다음 실행에서 버린(또는 방금 저장한) 편집을 복구하겠느냐고 묻는다.
    event.preventDefault()
    if (resolvingClose) return
    resolvingClose = true
    void (async () => {
      if (dirty) {
        // 닫히는 바로 그 창을 dialog 부모와 close 대상으로 쓴다.
        const result = await resolveDirtyEditing(senderId, sessionId, window)
        if (result.outcome === 'cancelled') {
          applicationQuitRequested = false
          return
        }
      }
      if (window.isDestroyed()) return
      await editingSessions.stop(senderId)
      closeApproved = true
      const resumeApplicationQuit = applicationQuitRequested
      if (window.isDestroyed()) {
        if (resumeApplicationQuit) app.quit()
        return
      }
      if (resumeApplicationQuit) window.once('closed', () => app.quit())
      window.close()
    })().catch((reason) => console.warn('창 닫기 처리 실패:', reason)).finally(() => {
      resolvingClose = false
    })
  })
  window.on('closed', () => {
    windowsById.delete(senderId)
    openPathRouter.removeWindow(senderId)
    // 받을 창이 load 중에 닫혔다면 남은 창(없으면 새 창)으로 보류한 경로를 넘긴다.
    if (!applicationQuitRequested) flushPendingOpen()
  })
  if (!app.isPackaged && process.platform !== 'darwin') {
    // 메뉴를 제거한 Windows·Linux 개발 빌드에서 DevTools를 열 수 있도록 창 단위로만 가로챈다(전역 단축키 아님).
    const devToolsTarget = window.webContents
    devToolsTarget.on('before-input-event', (event, input) => {
      if (!isDevToolsShortcut(input, process.platform)) return
      event.preventDefault()
      devToolsTarget.toggleDevTools()
    })
  }

  window.on('ready-to-show', () => {
    window.show()
  })

  if (visualCapturePath || visualStateOutput) {
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed()) captureVisualState(window)
    })
  }

  window.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (isSameTrustedDocument(url, currentUrl)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })
  // renderer는 `<webview>`를 쓰지 않는다. webviewTag를 꺼 두었지만 붙이려는 시도도 막는다.
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const visualTestFile = testValue('HAN_FLOW_VISUAL_TEST_FILE')
  const pdfTestPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
  // E2E·benchmark hook은 첫 창에만 적용한다. 이후 창은 main이 건넨 경로만 연다.
  const testOpenPath = windowsById.size === 1 ? benchmarkFile ?? visualTestFile : undefined
  const requestedOpenPath = testOpenPath ?? initialOpen?.filePath
  const openPath = requestedOpenPath ? resolve(requestedOpenPath) : undefined
  const openReceivedAt = testOpenPath ? processStartedAt : initialOpen?.receivedAt
  // renderer가 query로 받은 초기 문서를 읽을 수 있도록 load 전에 허용목록에 올린다.
  if (openPath) {
    void documentPaths.allow(senderId, openPath)
    initialOpenWindows.set(senderId, openPath)
  }
  if (devRendererUrl) {
    const rendererUrl = new URL(devRendererUrl)
    if (openPath) rendererUrl.searchParams.set('open', openPath)
    if (openReceivedAt) rendererUrl.searchParams.set('openReceivedAt', String(openReceivedAt))
    if (pdfTestPath) rendererUrl.searchParams.set('exportPdf', '1')
    window.loadURL(rendererUrl.toString())
  } else {
    window.loadFile(rendererFile, openPath ? { query: { open: openPath, openReceivedAt: String(openReceivedAt), exportPdf: pdfTestPath ? '1' : '0' } } : undefined)
  }
  return window
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, arguments_, workingDirectory) => {
    const filePath = pathFromArguments(arguments_, workingDirectory)
    if (filePath) {
      deliverOpenPath(filePath)
      return
    }
    if (!app.isReady()) return
    const windowId = openPathRouter.preferredWindowId(focusedWindowId())
    const window = windowId === undefined ? undefined : windowsById.get(windowId)
    if (window && !window.isDestroyed()) revealWindow(window)
    else if (windowsById.size === 0) createWindow()
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    deliverOpenPath(filePath)
  })
}

app.whenReady().then(() => {
  // Windows·Linux의 기본 Electron 메뉴는 Ctrl+Z·Ctrl+= 등을 renderer 단축키와 중복 실행하므로 제거한다.
  // macOS는 ⌘Q·편집 role을 위해 기본 메뉴를 유지한다.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  // renderer는 카메라·알림·위치 등 웹 권한을 쓰지 않는다. 요청과 확인을 모두 거절한다.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  // renderer가 PDF 인쇄 준비를 마쳤다는 알림. 요청을 보낸 바로 그 창의 알림만 받는다.
  ipc.on('pdf:ready', (event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    const pending = pendingPdfReady.get(requestId)
    if (!pending || pending.sender !== event.sender) return
    pendingPdfReady.delete(requestId)
    pending.resolve()
  })
  ipc.handle('benchmark:complete', async (event, timing: unknown) => {
    if (!benchmarkFile || !benchmarkOutput) return false
    benchmarkMeasurements.push(timing)
    if (benchmarkMeasurements.length < benchmarkRuns) {
      const sender = event.sender
      setTimeout(() => {
        const window = BrowserWindow.fromWebContents(sender)
        if (window && !window.isDestroyed()) {
          sendOpenPath(window, { filePath: resolve(benchmarkFile), receivedAt: Date.now() })
        }
      }, 25)
      return true
    }
    await writeFile(benchmarkOutput, JSON.stringify({ measurements: benchmarkMeasurements }, null, 2))
    app.quit()
    return true
  })
  ipc.handle('pdf:export', async (event, options: { width: number; height: number; preferCssPageSize?: boolean; objectPlaceholders?: unknown }) => {
    if (
      !options ||
      typeof options !== 'object' ||
      ![options.width, options.height].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 200) ||
      (options.preferCssPageSize !== undefined && typeof options.preferCssPageSize !== 'boolean')
    ) {
      throw new Error('PDF 용지 크기가 올바르지 않습니다.')
    }
    const testPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
    // 원본처럼 그리지 못한 개체가 있으면 저장 위치를 묻기 전에 확인받는다. E2E 경로(`HAN_FLOW_PDF_EXPORT_PATH`)는 묻지 않는다.
    const confirmation = testPath ? undefined : pdfObjectPlaceholderConfirmation(options.objectPlaceholders)
    if (confirmation) {
      const { response } = await showMessageBox(BrowserWindow.fromWebContents(event.sender), confirmation)
      if (response !== PDF_OBJECT_WARNING_CONTINUE) return null
    }
    const targetPath = testPath ?? (await showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'PDF로 내보내기',
      defaultPath: suggestedPdfExportPath(currentDocumentPaths.get(event.sender.id), lastDialogDirectory),
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }]
    })).filePath
    if (!targetPath) return null
    if (!testPath) rememberDialogDirectory(targetPath)

    const requestId = randomUUID()
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingPdfReady.delete(requestId)
          reject(new Error('PDF 렌더링 준비 시간이 초과되었습니다.'))
        }, 30_000)
        pendingPdfReady.set(requestId, {
          sender: event.sender,
          resolve: () => {
            clearTimeout(timeout)
            resolve()
          }
        })
        event.sender.send('pdf:prepare', requestId)
      })
      const printOptions: Electron.PrintToPDFOptions = {
        printBackground: true,
        preferCSSPageSize: options.preferCssPageSize === true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      }
      if (!printOptions.preferCSSPageSize) {
        printOptions.pageSize = { width: options.width, height: options.height }
      }
      const pdf = await event.sender.printToPDF(printOptions)
      // 기존 PDF 교체 동작은 유지하되, 중간에 실패해도 반쯤 쓴 파일이 남지 않도록 임시 파일 rename으로 게시한다.
      // 편집 중인 원본 문서와 심볼릭 링크 목적지는 교체하지 않는다.
      try {
        await writeFileAtomically(targetPath, pdf, {
          overwrite: true,
          protectedPaths: editingSessions.protectedSourcePaths()
        })
      } catch (reason) {
        throw new Error(pdfExportFailureMessage(reason))
      }
      return targetPath
    } finally {
      if (!event.sender.isDestroyed()) event.sender.send('pdf:finish', requestId)
    }
  })

  // 시스템 폰트 목록 가져오기
  ipc.handle('system:getFonts', async () => {
    try {
      const { default: fontList } = await import('font-list')
      return await fontList.getFonts()
    } catch (error) {
      console.error('Font error:', error)
      // font-list 실패 시 모든 설치본에 있는 OS 기본 한글 글꼴만 돌려준다.
      // Windows에서 항상 보장되는 것은 맑은 고딕뿐이다. 바탕·굴림·돋움은 한국어 보조 글꼴(선택 기능)이라 넣지 않는다.
      if (process.platform === 'win32') return ['Malgun Gothic', '맑은 고딕']
      if (process.platform === 'darwin') return ['Apple SD Gothic Neo', 'AppleMyungjo']
      return []
    }
  })

  ipc.handle('resource:readRhwpWasm', async (_event, assetUrl: string) => {
    if (typeof assetUrl !== 'string' || !assetUrl.startsWith('file:')) {
      throw new Error('패키지 내부 WASM 경로만 읽을 수 있습니다.')
    }
    const filePath = resolve(fileURLToPath(assetUrl))
    const rendererRoot = resolve(join(__dirname, '../renderer'))
    const assetRelativePath = relative(rendererRoot, filePath)
    if (
      !assetRelativePath ||
      assetRelativePath.startsWith('..') ||
      isAbsolute(assetRelativePath) ||
      extname(filePath) !== '.wasm' ||
      !basename(filePath).startsWith('rhwp_bg')
    ) {
      throw new Error('허용되지 않은 WASM 경로입니다.')
    }
    return readFile(filePath)
  })

  // 파일 열기 대화상자 핸들러
  ipc.handle('dialog:openFile', async (event) => {
    const options: Electron.OpenDialogOptions = {
      title: '문서 열기',
      defaultPath: lastDialogDirectory,
      properties: ['openFile'],
      filters: [
        { name: '한글 문서', extensions: ['hwp', 'hwpx'] }
      ]
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (canceled || !filePaths[0]) return null
    rememberDialogDirectory(filePaths[0])
    // 사용자가 이 창의 대화상자에서 고른 경로만 이 창이 읽을 수 있다.
    await documentPaths.allow(event.sender.id, filePaths[0])
    return filePaths[0]
  })

  // 새 창 띄우기
  ipc.handle('window:openNew', async () => {
    createWindow()
    return true
  })

  ipc.handle('document:import', async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof (request as { filePath?: unknown }).filePath !== 'string' ||
      typeof (request as { loadId?: unknown }).loadId !== 'string'
    ) {
      throw new Error('문서 열기 요청 형식이 올바르지 않습니다.')
    }
    const sender = event.sender
    const importRequest = request as { filePath: string; loadId: string }
    latestImportLoadIds.set(sender.id, importRequest.loadId)
    // renderer는 새 문서를 열기 전에 이전 문서를 닫는다. 실패하면 제목·PDF 이름도 문서 없음으로 둔다.
    setCurrentDocumentPath(sender.id, undefined)
    try {
      await documentPaths.authorize(sender.id, importRequest.filePath)
    } catch (reason) {
      if (!(reason instanceof DocumentPathNotAllowedError)) throw reason
      return {
        ok: false as const,
        loadId: importRequest.loadId,
        error: { code: reason.code, message: reason.message }
      }
    }
    // 경로 확인을 기다리는 동안 더 새 열기 요청이 왔다면 이 요청은 시작하지 않는다.
    if (latestImportLoadIds.get(sender.id) !== importRequest.loadId) {
      return {
        ok: false as const,
        loadId: importRequest.loadId,
        error: { code: 'DOCUMENT_LOAD_SUPERSEDED', message: '더 최근에 연 문서로 대체되었습니다.' }
      }
    }
    const result = await documentImporter.importDocument(
      importRequest,
      {
        senderId: sender.id,
        onComplete: (payload) => {
          if (!sender.isDestroyed()) sender.send('document:complete', payload)
        },
        onError: (payload) => {
          if (!sender.isDestroyed()) sender.send('document:error', payload)
        }
      }
    )
    if (result.ok && latestImportLoadIds.get(sender.id) === importRequest.loadId) {
      setCurrentDocumentPath(sender.id, importRequest.filePath)
      initialOpenWindows.delete(sender.id)
      const pending = pendingRecoveries.get(sender.id)
      if (pending && !samePath(pending.filePath, importRequest.filePath)) pendingRecoveries.delete(sender.id)
      // 복구하려고 연 문서가 아니면, 같은 원본에 남은 편집 기록이 있는지 확인한다.
      if (!pendingRecoveries.has(sender.id) && isHwpxPath(importRequest.filePath)) {
        void offerRecoveryForOpenedDocument(sender.id, importRequest.filePath)
          .catch((reason) => console.warn('편집 복구 기록 확인 실패:', reason))
      }
    }
    return result
  })

  // preload가 drag-and-drop File에서 얻은 경로. 존재하는 일반 .hwp/.hwpx 파일만 등록한다.
  ipc.handle('document:registerDroppedPath', (event, filePath: unknown) =>
    documentPaths.registerDropped(event.sender.id, filePath)
  )

  ipc.handle('editing:start', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof (request as { filePath?: unknown }).filePath !== 'string'
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 편집 시작 요청 형식이 올바르지 않습니다.'
      )
    }
    const filePath = (request as { filePath: string }).filePath
    try {
      await documentPaths.authorize(event.sender.id, filePath)
    } catch (reason) {
      if (!(reason instanceof DocumentPathNotAllowedError)) throw reason
      throw new EditingOperationError('EDITING_INVALID_REQUEST', reason.message)
    }
    return editingSessions.start(event.sender.id, filePath)
  }))

  ipc.handle('editing:recover', editingIpcHandler(async (event, request: unknown) => {
    const journalId = request && typeof request === 'object' ? (request as { journalId?: unknown }).journalId : undefined
    if (!isRecoverySessionId(journalId)) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '편집 복구 요청 형식이 올바르지 않습니다.')
    }
    // main이 이 창에 복구하라고 보낸 기록만 받는다. renderer가 임의 기록·경로를 고를 수 없다.
    const pending = pendingRecoveries.get(event.sender.id)
    if (!pending || pending.journalId !== journalId) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', '복구를 요청하지 않은 편집 기록입니다.')
    }
    pendingRecoveries.delete(event.sender.id)
    try {
      await documentPaths.authorize(event.sender.id, pending.filePath)
    } catch (reason) {
      if (!(reason instanceof DocumentPathNotAllowedError)) throw reason
      throw new EditingOperationError('EDITING_INVALID_REQUEST', reason.message)
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    try {
      return await editingSessions.recover(event.sender.id, journalId)
    } catch (reason) {
      void reportRecoveryFailure(window, journalId, reason).catch((failure) => console.warn('편집 복구 실패 안내 실패:', failure))
      throw reason
    }
  }))

  ipc.handle('editing:commit', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId', 'sectionPath', 'textNodeId', 'insert'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !['from', 'to', 'timestamp'].every(
        (key) => Number.isFinite((request as Record<string, unknown>)[key])
      ) ||
      !['selectionBefore', 'selectionAfter'].every((key) => {
        return isEditingSelection((request as Record<string, unknown>)[key])
      })
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 편집 commit 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.commit(event.sender.id, request as EditingCommitRequest)
  }))

  ipc.handle('editing:commitRange', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId', 'insert'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 범위 편집 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.commitRange(event.sender.id, request as EditingRangeCommitRequest)
  }))

  ipc.handle('editing:splitParagraph', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 문단 나눔 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.splitParagraph(
      event.sender.id,
      request as EditingSplitParagraphRequest
    )
  }))

  ipc.handle('editing:mergeParagraph', editingIpcHandler(async (event, request: unknown) => {
    const value = request as Record<string, unknown>
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every((key) => typeof value[key] === 'string') ||
      !['previous', 'next'].includes(String(value['direction'])) ||
      !['deleteContentBackward', 'deleteContentForward'].includes(String(value['inputType'])) ||
      !Number.isFinite(value['timestamp']) ||
      !isEditingSelection(value['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 문단 병합 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.mergeParagraph(
      event.sender.id,
      request as EditingMergeParagraphRequest
    )
  }))

  ipc.handle('editing:applyCharacterStyle', editingIpcHandler(async (event, request: unknown) => {
    const style = request as Record<string, unknown>
    const hasBold = typeof style?.['bold'] === 'boolean'
    const hasItalic = typeof style?.['italic'] === 'boolean'
    const hasUnderline = typeof style?.['underline'] === 'boolean'
    const hasStrikeout = typeof style?.['strikeout'] === 'boolean'
    const hasHeight = Number.isFinite(style?.['height'])
    const hasColor = typeof style?.['color'] === 'string'
    const hasFontId = typeof style?.['fontId'] === 'string' && Boolean(style['fontId'])
    if (
      !isStyleRequestBase(request) ||
      (!hasBold && !hasItalic && !hasUnderline && !hasStrikeout && !hasHeight && !hasColor && !hasFontId) ||
      ('bold' in style && !hasBold) ||
      ('italic' in style && !hasItalic) ||
      ('underline' in style && !hasUnderline) ||
      ('strikeout' in style && !hasStrikeout) ||
      ('height' in style && !hasHeight) ||
      ('color' in style && !hasColor) ||
      ('fontId' in style && !hasFontId)
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 글자 style 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.applyCharacterStyle(
      event.sender.id,
      request as unknown as EditingCharacterStyleRequest
    )
  }))

  ipc.handle('editing:applyParagraphStyle', editingIpcHandler(async (event, request: unknown) => {
    const style = request as Record<string, unknown>
    const hasAlign = ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'].includes(String(style?.['align']))
    const hasLineSpacing = Number.isFinite(style?.['lineSpacing'])
    const hasIndent = Number.isFinite(style?.['indent'])
    const hasMarginBefore = Number.isFinite(style?.['marginBefore'])
    const hasMarginAfter = Number.isFinite(style?.['marginAfter'])
    if (
      !isStyleRequestBase(request) ||
      (!hasAlign && !hasLineSpacing && !hasIndent && !hasMarginBefore && !hasMarginAfter) ||
      ('align' in style && !hasAlign) ||
      ('lineSpacing' in style && !hasLineSpacing) ||
      ('indent' in style && !hasIndent) ||
      ('marginBefore' in style && !hasMarginBefore) ||
      ('marginAfter' in style && !hasMarginAfter)
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 문단 style 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.applyParagraphStyle(
      event.sender.id,
      request as unknown as EditingParagraphStyleRequest
    )
  }))

  ipc.handle('editing:applyCellStyle', editingIpcHandler(async (event, request: unknown) => {
    const style = request as Record<string, unknown>
    const hasBackground = typeof style?.['backgroundColor'] === 'string'
    const hasBorderColor = typeof style?.['borderColor'] === 'string'
    const hasBorderWidth = Number.isFinite(style?.['borderWidth'])
    const hasBorderType = ['NONE', 'SOLID'].includes(String(style?.['borderType']))
    if (
      !isStyleRequestBase(request) ||
      (!hasBackground && !hasBorderColor && !hasBorderWidth && !hasBorderType) ||
      ('backgroundColor' in style && !hasBackground) ||
      ('borderColor' in style && !hasBorderColor) ||
      ('borderWidth' in style && !hasBorderWidth) ||
      ('borderType' in style && !hasBorderType)
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 셀 모양 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.applyCellStyle(
      event.sender.id,
      request as unknown as EditingCellStyleRequest
    )
  }))

  ipc.handle('editing:insertTableRowAfter', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 행 추가 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.insertTableRowAfter(
      event.sender.id,
      request as EditingInsertTableRowRequest
    )
  }))

  ipc.handle('editing:deleteTableRow', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 행 삭제 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.deleteTableRow(
      event.sender.id,
      request as EditingDeleteTableRowRequest
    )
  }))

  ipc.handle('editing:insertTableColumnAfter', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 열 추가 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.insertTableColumnAfter(
      event.sender.id,
      request as EditingInsertTableColumnRequest
    )
  }))

  ipc.handle('editing:deleteTableColumn', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 열 삭제 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.deleteTableColumn(
      event.sender.id,
      request as EditingDeleteTableColumnRequest
    )
  }))

  ipc.handle('editing:mergeTableCellRight', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 셀 병합 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.mergeTableCellRight(
      event.sender.id,
      request as EditingMergeTableCellRightRequest
    )
  }))

  ipc.handle('editing:insertFootnote', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', 'HWPX 각주 넣기 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.insertFootnote(event.sender.id, request as EditingInsertFootnoteRequest)
  }))

  ipc.handle('editing:deleteFootnote', editingIpcHandler(async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      !['sessionId', 'transactionId', 'notePath'].every(
        (key) => typeof (request as Record<string, unknown>)[key] === 'string'
      ) ||
      !Number.isFinite((request as Record<string, unknown>)['timestamp']) ||
      !isEditingSelection((request as Record<string, unknown>)['selectionBefore'])
    ) {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', 'HWPX 각주 지우기 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.deleteFootnote(event.sender.id, request as EditingDeleteFootnoteRequest)
  }))

  ipc.handle('editing:splitTableCell', editingIpcHandler(async (event, request: unknown) => {
    const record = request as Record<string, unknown> | null
    const selection = record?.['selection'] as Record<string, unknown> | null
    if (
      !record ||
      !['sessionId', 'transactionId'].every((key) => typeof record[key] === 'string') ||
      !Number.isFinite(record['timestamp']) ||
      !selection ||
      !['sectionPath', 'textNodeId', 'tableId', 'sourceCellId'].every(
        (key) => typeof selection[key] === 'string'
      ) ||
      !['row', 'column'].every(
        (key) => Number.isSafeInteger(selection[key]) && Number(selection[key]) >= 0
      )
    ) {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 표 셀 분할 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.splitTableCell(
      event.sender.id,
      request as EditingSplitTableCellRequest
    )
  }))

  ipc.handle('editing:undo', editingIpcHandler((event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', 'HWPX undo 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.undo(event.sender.id, sessionId)
  }))

  ipc.handle('editing:redo', editingIpcHandler((event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new EditingOperationError('EDITING_INVALID_REQUEST', 'HWPX redo 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.redo(event.sender.id, sessionId)
  }))

  ipc.handle('editing:refresh', editingIpcHandler((event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX 편집 projection 갱신 요청 형식이 올바르지 않습니다.'
      )
    }
    return editingSessions.refresh(event.sender.id, sessionId)
  }))

  ipc.handle('editing:saveAsDialog', editingIpcHandler(async (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX Save As 요청 형식이 올바르지 않습니다.'
      )
    }
    return saveEditingSessionWithDialog(
      event.sender.id,
      sessionId,
      BrowserWindow.fromWebContents(event.sender),
      true
    )
  }))

  ipc.handle('editing:resolveDirty', editingIpcHandler(async (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new EditingOperationError(
        'EDITING_INVALID_REQUEST',
        'HWPX dirty 확인 요청 형식이 올바르지 않습니다.'
      )
    }
    return resolveDirtyEditing(
      event.sender.id,
      sessionId,
      BrowserWindow.fromWebContents(event.sender)
    )
  }))

  ipc.handle('editing:stop', editingIpcHandler(async (event) => {
    await editingSessions.stop(event.sender.id)
    return true
  }))

  const commandLinePath = pathFromArguments(process.argv)
  openPathRouter.setAppReady()
  // macOS는 app 준비 전에 open-file을 보낼 수 있다. 보류한 경로가 명령줄 경로보다 우선한다.
  createWindow(
    openPathRouter.takePending() ??
      (commandLinePath ? { filePath: commandLinePath, receivedAt: processStartedAt } : undefined)
  )

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  applicationQuitRequested = true
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 닫기 확인을 거치지 않고 사라진 창(renderer 비정상 종료 등)의 기록 정리가 끝난 뒤 끝낸다.
    // will-quit에서 종료를 미루면 Electron이 끝나지 않으므로 여기서 기다린다.
    void editingSessions.whenStopped().finally(() => app.quit())
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
