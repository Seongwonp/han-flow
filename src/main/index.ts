import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { basename, extname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile } from 'fs/promises'
import { DocumentImporter } from './document_importer'
import { EditingSessionManager } from './editing_session'
import { isAllowedExternalUrl, isSameTrustedDocument } from './external_navigation'
import type {
  EditingCharacterStyleRequest,
  EditingCommitRequest,
  EditingParagraphStyleRequest
} from '../core/editing/editing_contract'

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
let mainWindow: BrowserWindow | null = null
let pendingOpen: { filePath: string; receivedAt: number } | null = null
let applicationQuitRequested = false
const documentImporter = new DocumentImporter(join(__dirname, 'decoder_worker.js'))
const editingSessions = new EditingSessionManager()

function isEditingSelection(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    ['sectionPath', 'textNodeId'].every(
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

async function showMessageBox(
  window: BrowserWindow | null,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
}

async function showSaveDialog(
  window: BrowserWindow | null,
  options: Electron.SaveDialogOptions
): Promise<Electron.SaveDialogReturnValue> {
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
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
      detail:
        '문서 본문 변경은 저장되지만 HWPX의 Preview 미리보기는 갱신되지 않을 수 있습니다. ' +
        '알 수 없는 XML과 이미지 등 원본 package 항목은 그대로 보존합니다.'
    })
    if (confirmation.response !== 0) return { outcome: 'cancelled' as const }
  }

  let destinationPath = testDestination
  if (!destinationPath) {
    const selection = await showSaveDialog(window, {
      title: 'HWPX 변경본을 다른 이름으로 저장',
      defaultPath: editingSessions.suggestedSaveAsPath(senderId, sessionId),
      filters: [{ name: 'HWPX 문서', extensions: ['hwpx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (selection.canceled || !selection.filePath) return { outcome: 'cancelled' as const }
    destinationPath = selection.filePath
  }

  return {
    outcome: 'saved' as const,
    ...(await editingSessions.saveAs(senderId, sessionId, destinationPath))
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
        '저장하면 원본은 그대로 두고 새 HWPX를 만듭니다. Preview 미리보기는 갱신되지 않을 수 있습니다.'
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

function pathFromArguments(arguments_: string[]): string | undefined {
  return arguments_.find(isDocumentPath)
}

function captureVisualState(window: BrowserWindow): void {
  const capturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const stateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  const searchQuery = testValue('HAN_FLOW_VISUAL_SEARCH_QUERY')
  const editText = testValue('HAN_FLOW_VISUAL_EDIT_TEXT')
  const editMode = testValue('HAN_FLOW_VISUAL_EDIT_MODE') ?? 'composition'
  const editCellEnabled = testValue('HAN_FLOW_VISUAL_EDIT_CELL') === '1'
  const styleProbeEnabled = testValue('HAN_FLOW_VISUAL_STYLE_PROBE') === '1'
  const editSavePath = testValue('HAN_FLOW_EDIT_SAVE_PATH')
  const autoSaveEdit = testValue('HAN_FLOW_VISUAL_AUTO_SAVE') === '1'
  const exitWhenComplete = testValue('HAN_FLOW_VISUAL_EXIT') === '1'
  if (!capturePath && !stateOutput) return
  const captureDelayMs = Number(process.env['HAN_FLOW_VISUAL_CAPTURE_DELAY_MS'] ?? 2500)
  const readyTimeoutMs = Number(process.env['HAN_FLOW_VISUAL_READY_TIMEOUT_MS'] ?? 30_000)
  const startedAt = Date.now()
  let previousSignature = ''
  let stableSamples = 0
  let searchTriggered = !searchQuery
  let editTriggered = !editText
  let editProbe: unknown = null
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
        document.querySelector('[aria-label="검색"]')?.click()
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
        const surfaceLabel = ${JSON.stringify(editCellEnabled ? 'HWPX 표 셀 편집' : 'HWPX 문단 편집')}
        const readySurface = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
          .find((element) => element.dataset.inputReady === 'true')
        let target = readySurface()
        if (!target) {
          const existingSurface = document.querySelector('[aria-label="' + surfaceLabel + '"]')
          if (!existingSurface) {
            const editButton = await waitFor(() =>
              Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '편집')
            )
            editButton.click()
            setPhase('editable-surface')
          }
          target = await waitFor(readySurface)
        }
        const anchorId = target.dataset.sourceTextNodeId
        const currentTarget = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
          .find((element) => element.dataset.sourceTextNodeId === anchorId)
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
        const editedTarget = await waitFor(() => {
          const candidate = currentTarget()
          return candidate?.textContent === expected ? candidate : undefined
        })
        await waitFor(() => {
          const value = getSelection(editedTarget)
          return value.anchorOffset === selectionAfter.anchorOffset &&
            value.focusOffset === selectionAfter.focusOffset
        })
        const edited = editedTarget.textContent
        const selectionAfterProjection = getSelection(editedTarget)
        const undo = document.querySelector('[aria-label="실행 취소"]')
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
        const redo = document.querySelector('[aria-label="다시 실행"]')
        redo?.click()
        setPhase('redo-text')
        const redoneTarget = await waitFor(() => {
          const candidate = currentTarget()
          return candidate?.textContent === expected ? candidate : undefined
        })
        setPhase('redo-selection')
        await waitFor(() => {
          const value = getSelection(redoneTarget)
          return value.anchorOffset === selectionAfter.anchorOffset && value.focusOffset === selectionAfter.focusOffset
        })
        const redoSelection = getSelection(redoneTarget)
        let styleProbe
        if (${styleProbeEnabled}) {
          setPhase('style-buttons')
          const button = (label) => document.querySelector('[aria-label="' + label + '"]')
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
          button('현재 텍스트 블록 굵게')?.click()
          setPhase('style-bold')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold))
          const boldApplied = button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold)
          const partialRunSplit = await waitFor(() => Array.from(document.querySelectorAll('.viewer-paragraph'))
            .some((paragraph) => paragraph.textContent === expected &&
              paragraph.querySelectorAll(':scope > .viewer-editable-text').length >= 2))
          button(desiredAlign)?.click()
          setPhase('style-align')
          await waitFor(() => button(desiredAlign)?.getAttribute('aria-pressed') === 'true')
          const alignApplied = button(desiredAlign)?.getAttribute('aria-pressed') === 'true'
          document.querySelector('[aria-label="실행 취소"]')?.click()
          setPhase('style-align-undo')
          await waitFor(() => button(originalAlign)?.getAttribute('aria-pressed') === 'true')
          document.querySelector('[aria-label="실행 취소"]')?.click()
          setPhase('style-bold-undo')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(originalBold))
          const undoRestored = button(originalAlign)?.getAttribute('aria-pressed') === 'true' &&
            button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(originalBold)
          document.querySelector('[aria-label="다시 실행"]')?.click()
          setPhase('style-bold-redo')
          await waitFor(() => button('현재 텍스트 블록 굵게')?.getAttribute('aria-pressed') === String(!originalBold))
          document.querySelector('[aria-label="다시 실행"]')?.click()
          setPhase('style-align-redo')
          await waitFor(() => button(desiredAlign)?.getAttribute('aria-pressed') === 'true')
          const sizeLabel = () => document.querySelector('[aria-label="현재 글자 크기"]')?.textContent?.trim()
          const originalSize = Number.parseFloat(sizeLabel() ?? '')
          const expectedSize = Math.min(72, originalSize + 1)
          setPhase('style-size')
          const increaseSize = await waitFor(() => {
            const candidate = button('글자 크기 늘리기')
            return candidate && !candidate.disabled ? candidate : undefined
          })
          increaseSize.click()
          await waitFor(() => sizeLabel() === expectedSize + 'pt')
          const sizeApplied = sizeLabel() === expectedSize + 'pt'
          setPhase('style-color')
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
          button('줄 간격 늘리기')?.click()
          await waitFor(() => metricValue('현재 줄 간격') === Math.min(300, originalLineSpacing + 10) + '%')
          const lineSpacingApplied = metricValue('현재 줄 간격') === Math.min(300, originalLineSpacing + 10) + '%'
          const originalMarginBefore = Number.parseFloat(metricValue('현재 문단 앞 간격') ?? '')
          setPhase('style-margin-before')
          button('문단 앞 간격 늘리기')?.click()
          await waitFor(() => metricValue('현재 문단 앞 간격') === Math.min(72, originalMarginBefore + 1) + 'pt')
          const marginBeforeApplied = metricValue('현재 문단 앞 간격') === Math.min(72, originalMarginBefore + 1) + 'pt'
          const originalMarginAfter = Number.parseFloat(metricValue('현재 문단 뒤 간격') ?? '')
          setPhase('style-margin-after')
          button('문단 뒤 간격 늘리기')?.click()
          await waitFor(() => metricValue('현재 문단 뒤 간격') === Math.min(72, originalMarginAfter + 1) + 'pt')
          const marginAfterApplied = metricValue('현재 문단 뒤 간격') === Math.min(72, originalMarginAfter + 1) + 'pt'
          const originalIndent = Number.parseFloat(metricValue('현재 첫 줄 들여쓰기') ?? '')
          setPhase('style-outdent')
          button('첫 줄 내어쓰기')?.click()
          await waitFor(() => metricValue('현재 첫 줄 들여쓰기') === Math.max(-72, originalIndent - 1) + 'pt')
          const outdentApplied = metricValue('현재 첫 줄 들여쓰기') === Math.max(-72, originalIndent - 1) + 'pt'
          setPhase('style-indent-reset')
          button('첫 줄 들여쓰기')?.click()
          await waitFor(() => metricValue('현재 첫 줄 들여쓰기') === originalIndent + 'pt')
          setPhase('style-indent')
          button('첫 줄 들여쓰기')?.click()
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
          surface: ${JSON.stringify(editCellEnabled ? 'table-cell' : 'paragraph')},
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
      pageTextCounts: Array.from(document.querySelectorAll('.viewer-page')).map((page) => Number(page.dataset.textCharacters || 0) || (page.innerText.match(/\\S/g) || []).length),
      overflowPages: Array.from(document.querySelectorAll('.viewer-page')).map((page) => page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1 ? Number(page.dataset.pageIndex) + 1 : 0).filter(Boolean),
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
      editingUi: (() => {
        const ribbon = document.querySelector('.viewer-edit-ribbon')
        const toolbar = document.querySelector('.viewer-toolbar')
        const buttons = Array.from(document.querySelectorAll('.viewer-ribbon-controls button'))
        return {
          ribbonVisible: Boolean(ribbon),
          activeTab: document.querySelector('.viewer-ribbon-tabs [aria-selected="true"]')?.textContent?.trim(),
          groupLabels: Array.from(document.querySelectorAll('.viewer-ribbon-group-label')).map((element) => element.textContent?.trim()),
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
    if (stateOutput) await writeFile(stateOutput, JSON.stringify(visualState, null, 2))
    console.log('Visual test state:', visualState)
    if (exitWhenComplete) app.quit()
  }
  setTimeout(() => void captureWhenReady(), captureDelayMs)
}

function deliverOpenPath(filePath: string, receivedAt = Date.now()): void {
  if (!isDocumentPath(filePath)) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpen = { filePath, receivedAt }
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('file:open', { filePath, receivedAt })
  captureVisualState(mainWindow)
}

function createWindow(initialOpen?: { filePath: string; receivedAt: number }): void {
  const visualCapturePath = testValue('HAN_FLOW_VISUAL_CAPTURE_PATH')
  const visualStateOutput = testValue('HAN_FLOW_VISUAL_STATE_OUTPUT')
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: visualCapturePath || visualStateOutput ? 1500 : 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // macOS 네이티브 스타일 최적화
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !visualStateOutput
    }
  })
  if (visualStateOutput) {
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      if (message.startsWith('HAN_FLOW_E2E_PHASE ')) console.error(message)
    })
  }

  const senderId = mainWindow.webContents.id
  let closeApproved = false
  let resolvingClose = false
  mainWindow.webContents.once('destroyed', () => {
    documentImporter.cancel(senderId)
    editingSessions.stop(senderId)
  })
  mainWindow.on('close', (event) => {
    if (closeApproved || !editingSessions.isDirty(senderId)) return
    if (resolvingClose) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    const sessionId = editingSessions.currentSessionId(senderId)
    if (!sessionId) return
    resolvingClose = true
    const window = mainWindow
    void resolveDirtyEditing(senderId, sessionId, window)
      .then((result) => {
        if (result.outcome === 'cancelled') {
          applicationQuitRequested = false
          return
        }
        if (!window || window.isDestroyed()) return
        closeApproved = true
        editingSessions.stop(senderId)
        const resumeApplicationQuit = applicationQuitRequested
        if (resumeApplicationQuit) window.once('closed', () => app.quit())
        window.close()
      })
      .finally(() => {
        resolvingClose = false
      })
  })
  mainWindow.on('closed', () => { mainWindow = null })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (visualCapturePath || visualStateOutput) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (mainWindow) captureVisualState(mainWindow)
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? ''
    if (isSameTrustedDocument(url, currentUrl)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  const visualTestFile = testValue('HAN_FLOW_VISUAL_TEST_FILE')
  const pdfTestPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
  const openPath = benchmarkFile ?? visualTestFile ?? initialOpen?.filePath
  const openReceivedAt = benchmarkFile || visualTestFile ? processStartedAt : initialOpen?.receivedAt
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    if (openPath) rendererUrl.searchParams.set('open', openPath)
    if (openReceivedAt) rendererUrl.searchParams.set('openReceivedAt', String(openReceivedAt))
    if (pdfTestPath) rendererUrl.searchParams.set('exportPdf', '1')
    mainWindow.loadURL(rendererUrl.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), openPath ? { query: { open: openPath, openReceivedAt: String(openReceivedAt), exportPdf: pdfTestPath ? '1' : '0' } } : undefined)
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, arguments_) => {
    const filePath = pathFromArguments(arguments_)
    if (filePath) deliverOpenPath(filePath)
    else if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })

  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    deliverOpenPath(filePath)
  })
}

app.whenReady().then(() => {
  ipcMain.handle('benchmark:complete', async (_event, timing: unknown) => {
    if (!benchmarkFile || !benchmarkOutput) return false
    benchmarkMeasurements.push(timing)
    if (benchmarkMeasurements.length < benchmarkRuns) {
      setTimeout(() => deliverOpenPath(benchmarkFile), 25)
      return true
    }
    await writeFile(benchmarkOutput, JSON.stringify({ measurements: benchmarkMeasurements }, null, 2))
    app.quit()
    return true
  })
  ipcMain.handle('pdf:export', async (event, options: { width: number; height: number; preferCssPageSize?: boolean }) => {
    if (
      !options ||
      typeof options !== 'object' ||
      ![options.width, options.height].every((value) => Number.isFinite(value) && value >= 0.1 && value <= 200) ||
      (options.preferCssPageSize !== undefined && typeof options.preferCssPageSize !== 'boolean')
    ) {
      throw new Error('PDF 용지 크기가 올바르지 않습니다.')
    }
    const testPath = testValue('HAN_FLOW_PDF_EXPORT_PATH')
    const targetPath = testPath ?? (await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined, {
      title: 'PDF로 내보내기',
      defaultPath: '문서.pdf',
      filters: [{ name: 'PDF 문서', extensions: ['pdf'] }]
    })).filePath
    if (!targetPath) return null

    const requestId = `${Date.now()}`
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ipcMain.removeListener('pdf:ready', ready); reject(new Error('PDF 렌더링 준비 시간이 초과되었습니다.')) }, 30_000)
        const ready = (readyEvent: Electron.IpcMainEvent, readyId: string) => {
          if (readyEvent.sender !== event.sender || readyId !== requestId) return
          clearTimeout(timeout)
          ipcMain.removeListener('pdf:ready', ready)
          resolve()
        }
        ipcMain.on('pdf:ready', ready)
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
      await writeFile(targetPath, pdf)
      return targetPath
    } finally {
      if (!event.sender.isDestroyed()) event.sender.send('pdf:finish', requestId)
    }
  })

  // 시스템 폰트 목록 가져오기
  ipcMain.handle('system:getFonts', async () => {
    try {
      const { default: fontList } = await import('font-list')
      return await fontList.getFonts()
    } catch (error) {
      console.error('Font error:', error)
      return ['함초롬바탕', 'Pretendard', '나눔고딕', 'Apple SD Gothic Neo']
    }
  })

  ipcMain.handle('resource:readRhwpWasm', async (_event, assetUrl: string) => {
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
  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '문서 열기',
      properties: ['openFile'],
      filters: [
        { name: '한글 문서', extensions: ['hwp', 'hwpx'] }
      ]
    })
    if (canceled) return null
    return filePaths[0]
  })

  // 새 창에서 열기 대화상자
  ipcMain.handle('dialog:askOpenMode', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['현재 창에서 열기', '새 창에서 열기', '취소'],
      defaultId: 1,
      title: '열기 방식 선택',
      message: '파일을 어떻게 여시겠습니까?'
    })
    return response // 0: Current, 1: New, 2: Cancel
  })

  // 새 창 띄우기
  ipcMain.handle('window:openNew', async () => {
    createWindow()
    return true
  })

  // 이미지 열기 대화상자
  ipcMain.handle('dialog:openImage', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '이미지 삽입',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp'] }
      ]
    })
    if (canceled) return null
    
    const filePath = filePaths[0]
    const fs = require('fs')
    const buffer = fs.readFileSync(filePath)
    const ext = filePath.split('.').pop()
    return {
      path: filePath,
      data: buffer.toString('base64'),
      ext: ext
    }
  })

  ipcMain.handle('document:import', async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof (request as { filePath?: unknown }).filePath !== 'string' ||
      typeof (request as { loadId?: unknown }).loadId !== 'string'
    ) {
      throw new Error('문서 열기 요청 형식이 올바르지 않습니다.')
    }
    const sender = event.sender
    return documentImporter.importDocument(
      request as { filePath: string; loadId: string },
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
  })

  ipcMain.handle('editing:start', async (event, request: unknown) => {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof (request as { filePath?: unknown }).filePath !== 'string'
    ) {
      throw new Error('HWPX 편집 시작 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.start(event.sender.id, (request as { filePath: string }).filePath)
  })

  ipcMain.handle('editing:commit', async (event, request: unknown) => {
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
      throw new Error('HWPX 편집 commit 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.commit(event.sender.id, request as EditingCommitRequest)
  })

  ipcMain.handle('editing:applyCharacterStyle', async (event, request: unknown) => {
    const style = request as Record<string, unknown>
    const hasBold = typeof style?.['bold'] === 'boolean'
    const hasItalic = typeof style?.['italic'] === 'boolean'
    const hasUnderline = typeof style?.['underline'] === 'boolean'
    const hasStrikeout = typeof style?.['strikeout'] === 'boolean'
    const hasHeight = Number.isFinite(style?.['height'])
    const hasColor = typeof style?.['color'] === 'string'
    if (
      !isStyleRequestBase(request) ||
      (!hasBold && !hasItalic && !hasUnderline && !hasStrikeout && !hasHeight && !hasColor) ||
      ('bold' in style && !hasBold) ||
      ('italic' in style && !hasItalic) ||
      ('underline' in style && !hasUnderline) ||
      ('strikeout' in style && !hasStrikeout) ||
      ('height' in style && !hasHeight) ||
      ('color' in style && !hasColor)
    ) {
      throw new Error('HWPX 글자 style 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.applyCharacterStyle(
      event.sender.id,
      request as unknown as EditingCharacterStyleRequest
    )
  })

  ipcMain.handle('editing:applyParagraphStyle', async (event, request: unknown) => {
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
      throw new Error('HWPX 문단 style 요청 형식이 올바르지 않습니다.')
    }
    return editingSessions.applyParagraphStyle(
      event.sender.id,
      request as unknown as EditingParagraphStyleRequest
    )
  })

  ipcMain.handle('editing:undo', (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('HWPX undo 요청 형식이 올바르지 않습니다.')
    return editingSessions.undo(event.sender.id, sessionId)
  })

  ipcMain.handle('editing:redo', (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new Error('HWPX redo 요청 형식이 올바르지 않습니다.')
    return editingSessions.redo(event.sender.id, sessionId)
  })

  ipcMain.handle('editing:saveAsDialog', async (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new Error('HWPX Save As 요청 형식이 올바르지 않습니다.')
    }
    return saveEditingSessionWithDialog(
      event.sender.id,
      sessionId,
      BrowserWindow.fromWebContents(event.sender),
      true
    )
  })

  ipcMain.handle('editing:resolveDirty', async (event, sessionId: unknown) => {
    if (typeof sessionId !== 'string') {
      throw new Error('HWPX dirty 확인 요청 형식이 올바르지 않습니다.')
    }
    return resolveDirtyEditing(
      event.sender.id,
      sessionId,
      BrowserWindow.fromWebContents(event.sender)
    )
  })

  ipcMain.handle('editing:stop', (event) => {
    editingSessions.stop(event.sender.id)
    return true
  })

  const commandLinePath = pathFromArguments(process.argv)
  createWindow(pendingOpen ?? (commandLinePath ? { filePath: commandLinePath, receivedAt: processStartedAt } : undefined))
  pendingOpen = null

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
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
