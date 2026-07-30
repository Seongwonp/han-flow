import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const fixture = process.argv[2]
const expectedError = process.argv.includes('--expect-error')
const expectedErrorCode = process.env.HAN_FLOW_VERIFY_ERROR_CODE
const searchQuery = process.env.HAN_FLOW_VERIFY_SEARCH_QUERY
const editText = process.env.HAN_FLOW_VERIFY_EDIT_TEXT
const editMode = process.env.HAN_FLOW_VERIFY_EDIT_MODE
const editCell = process.env.HAN_FLOW_VERIFY_EDIT_CELL === '1'
const styleProbe = process.env.HAN_FLOW_VERIFY_STYLE === '1'
const editSave = process.env.HAN_FLOW_VERIFY_EDIT_SAVE === '1'
const closeDirtyAction = process.env.HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION
const appArgument = process.argv.slice(3).find((argument) => !argument.startsWith('--'))
const appBinary = resolve(appArgument ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')

if (!/\.(?:hwp|hwpx)$/iu.test(fixture ?? '')) {
  console.error('사용법: npm run verify:app -- <fixture.hwp|fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function launch(output, userData, options = {}) {
  const launchedFixture = options.fixture ?? fixture
  const interactive = options.interactive !== false
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    let settled = false
    const child = spawn(appBinary, [], {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_VISUAL_TEST_FILE: resolve(launchedFixture),
        HAN_FLOW_VISUAL_STATE_OUTPUT: output,
        HAN_FLOW_VISUAL_EXIT: '1',
        HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: process.env.HAN_FLOW_VERIFY_DELAY_MS ?? '3000',
        HAN_FLOW_E2E_USER_DATA: userData,
        HAN_FLOW_DIRTY_ACTION: options.dirtyAction ?? 'discard',
        ...(interactive && searchQuery ? { HAN_FLOW_VISUAL_SEARCH_QUERY: searchQuery } : {}),
        ...(interactive && editText ? { HAN_FLOW_VISUAL_EDIT_TEXT: editText } : {}),
        ...(interactive && editMode ? { HAN_FLOW_VISUAL_EDIT_MODE: editMode } : {}),
        ...(interactive && editCell ? { HAN_FLOW_VISUAL_EDIT_CELL: '1' } : {}),
        ...(interactive && styleProbe ? { HAN_FLOW_VISUAL_STYLE_PROBE: '1' } : {}),
        ...(interactive && options.saveDestination ? { HAN_FLOW_EDIT_SAVE_PATH: options.saveDestination } : {}),
        ...(interactive && options.autoSave ? { HAN_FLOW_VISUAL_AUTO_SAVE: '1' } : {})
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    const finish = (error) => {
      if (settled) return
      settled = true
      clearInterval(outputPoll)
      clearTimeout(timeout)
      if (error) reject(error)
      else resolvePromise()
    }
    const outputPoll = setInterval(async () => {
      try {
        JSON.parse(await readFile(output, 'utf8'))
      } catch {
        // 화면 상태 파일이 완전히 기록될 때까지 기다린다.
      }
    }, 100)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`패키지 앱 검증 시간이 초과되었습니다. ${standardError.trim()}`))
    }, 120_000)
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => {
      if (code === 0) finish()
      else finish(new Error(`Han-Flow가 종료 코드 ${code}로 끝났습니다. ${standardError.trim()}`))
    })
  })
  return JSON.parse(await readFile(output, 'utf8'))
}

const directory = await mkdtemp(join(tmpdir(), 'han-flow-app-verify-'))
try {
  const resolvedFixture = resolve(fixture)
  const verifiesSavedFile = editSave || closeDirtyAction === 'save'
  const sourceHashBefore = verifiesSavedFile ? hash(await readFile(resolvedFixture)) : undefined
  const saveDestination = verifiesSavedFile ? join(directory, 'han-flow-edited.hwpx') : undefined
  const state = await launch(
    join(directory, 'visual-state.json'),
    join(directory, 'user-data'),
    {
      saveDestination,
      autoSave: editSave,
      dirtyAction: closeDirtyAction ?? 'discard'
    }
  )
  const sourceUnchanged = verifiesSavedFile
    ? hash(await readFile(resolvedFixture)) === sourceHashBefore
    : undefined
  let savedState
  let savedFileExists = false
  if (saveDestination) {
    try {
      await readFile(saveDestination)
      savedFileExists = true
      savedState = await launch(
        join(directory, 'saved-visual-state.json'),
        join(directory, 'saved-user-data'),
        { fixture: saveDestination, interactive: false }
      )
    } catch {
      savedFileExists = false
    }
  }
  const incompleteImages = state.images.filter((image) => !image.complete || image.naturalWidth <= 0).length
  const failures = (expectedError ? [
    state.errorVisible ? undefined : '예상한 사용자 오류가 표시되지 않음',
    state.errorMessageLength > 0 ? undefined : '오류 안내가 비어 있음',
    expectedErrorCode && state.errorCode !== expectedErrorCode
      ? `오류 코드 불일치: ${state.errorCode ?? '없음'}`
      : undefined
  ] : [
    state.errorVisible ? '예상하지 않은 사용자 오류가 표시됨' : undefined,
    state.totalPages > 0 ? undefined : '페이지가 생성되지 않음',
    state.mountedPages > 0 ? undefined : '페이지 DOM이 생성되지 않음',
    state.documentLoading ? '백그라운드 문서 로딩이 끝나지 않음' : undefined,
    state.overflowPages.length ? `페이지 overflow: ${state.overflowPages.join(', ')}` : undefined,
    incompleteImages ? `decode 실패 이미지: ${incompleteImages}` : undefined,
    searchQuery && !state.search?.open ? '검색 UI가 열리지 않음' : undefined,
    searchQuery && state.search?.occurrences < 1 ? '검색 결과가 없음' : undefined,
    searchQuery && state.search?.highlights < 1 ? '검색 강조가 표시되지 않음' : undefined,
    searchQuery && state.search?.activePages !== 1 ? '현재 검색 페이지 표시가 올바르지 않음' : undefined,
    searchQuery && state.selectionCharacters < 1 ? '텍스트 선택 layer가 동작하지 않음' : undefined,
    searchQuery && state.accessibility?.documentPages !== state.mountedPages ? '페이지 접근성 label이 누락됨' : undefined,
    searchQuery && state.accessibility?.hiddenImages !== state.mountedPages ? '장식 이미지가 접근성 트리에서 숨겨지지 않음' : undefined,
    searchQuery && state.accessibility?.labeledTextLayers !== state.mountedPages ? '텍스트 접근성 layer가 누락됨' : undefined,
    editText && !state.editingProbe ? '편집 probe 결과가 없음' : undefined,
    editText && state.editingProbe?.probeError ? `편집 probe 오류: ${state.editingProbe.probeError}` : undefined,
    editText && !state.editingProbe?.editedMatches ? 'IME 편집 결과 불일치' : undefined,
    editText && !state.editingProbe?.undoneMatches ? '실행 취소 결과 불일치' : undefined,
    editText && !state.editingProbe?.redoneMatches ? '다시 실행 결과 불일치' : undefined,
    editText && !state.editingProbe?.projectedSelectionMatches ? 'projection 후 selection 복원 불일치' : undefined,
    editText && !state.editingProbe?.undoSelectionMatches ? '실행 취소 selection 복원 불일치' : undefined,
    editText && !state.editingProbe?.redoSelectionMatches ? '다시 실행 selection 복원 불일치' : undefined,
    editCell && state.editingProbe?.surface !== 'table-cell' ? '표 셀 편집 surface 검증 불일치' : undefined,
    styleProbe && !editText ? 'style probe는 HAN_FLOW_VERIFY_EDIT_TEXT와 함께 실행해야 함' : undefined,
    styleProbe && !state.editingProbe?.styleProbe ? 'style 편집 probe 결과가 없음' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.boldApplied ? '굵게 style 적용 불일치' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.partialRunSplit ? '부분 선택 run 분할 불일치' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.alignApplied ? '문단 정렬 적용 불일치' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.undoRestored ? 'style undo 원복 불일치' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.redoRestored ? 'style redo 복원 불일치' : undefined,
    styleProbe && !state.editingProbe?.styleProbe?.multiRunEditable ? '여러 run 문단 입력 surface 불일치' : undefined,
    editSave && !state.editingProbe?.saveStatusMatches ? 'Save As 상태 표시 불일치' : undefined,
    editSave && !state.editingProbe?.dirtyCleared ? 'Save As 뒤 dirty 상태가 해제되지 않음' : undefined,
    verifiesSavedFile && !sourceUnchanged ? 'Save As가 원본 파일을 변경함' : undefined,
    verifiesSavedFile && !savedFileExists ? 'Save As 목적지 파일이 생성되지 않음' : undefined,
    verifiesSavedFile && savedState?.errorVisible ? 'Save As 결과 재열기 실패' : undefined,
    verifiesSavedFile && savedState && savedState.totalPages < 1 ? 'Save As 결과 페이지가 생성되지 않음' : undefined,
    verifiesSavedFile && savedState?.overflowPages?.length ? `Save As 결과 page overflow: ${savedState.overflowPages.join(', ')}` : undefined
  ]).filter(Boolean)
  const result = {
    fixture: basename(fixture),
    expectedError,
    passed: failures.length === 0,
    totalPages: state.totalPages,
    mountedPages: state.mountedPages,
    imageCount: state.images.length,
    overflowPages: state.overflowPages,
    errorCode: expectedError ? state.errorCode : undefined,
    pageTextCounts: state.pageTextCounts,
    search: searchQuery ? state.search : undefined,
    selectionCharacters: searchQuery ? state.selectionCharacters : undefined,
    accessibility: searchQuery ? state.accessibility : undefined,
    editingProbe: editText ? state.editingProbe : undefined,
    saveAs: editSave ? {
      sourceUnchanged,
      savedFileExists,
      reopenedPages: savedState?.totalPages,
      reopenedImages: savedState?.images?.length,
      reopenedOverflowPages: savedState?.overflowPages
    } : undefined,
    dirtyClose: closeDirtyAction ? {
      action: closeDirtyAction,
      sourceUnchanged,
      savedFileExists,
      reopenedPages: savedState?.totalPages,
      reopenedOverflowPages: savedState?.overflowPages
    } : undefined,
    failures
  }
  console.log('HAN_FLOW_APP_VERIFY', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
