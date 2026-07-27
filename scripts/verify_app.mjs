import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]
const expectedError = process.argv.includes('--expect-error')
const expectedErrorCode = process.env.HAN_FLOW_VERIFY_ERROR_CODE
const searchQuery = process.env.HAN_FLOW_VERIFY_SEARCH_QUERY
const appArgument = process.argv.slice(3).find((argument) => !argument.startsWith('--'))
const appBinary = resolve(appArgument ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')

if (!/\.(?:hwp|hwpx)$/iu.test(fixture ?? '')) {
  console.error('사용법: npm run verify:app -- <fixture.hwp|fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

async function launch(output, userData) {
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    let settled = false
    const child = spawn(appBinary, [], {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_VISUAL_TEST_FILE: resolve(fixture),
        HAN_FLOW_VISUAL_STATE_OUTPUT: output,
        HAN_FLOW_VISUAL_EXIT: '1',
        HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: process.env.HAN_FLOW_VERIFY_DELAY_MS ?? '3000',
        HAN_FLOW_E2E_USER_DATA: userData,
        ...(searchQuery ? { HAN_FLOW_VISUAL_SEARCH_QUERY: searchQuery } : {})
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
        child.kill('SIGTERM')
        finish()
      } catch {
        // 화면 상태 파일이 완전히 기록될 때까지 기다린다.
      }
    }, 100)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`패키지 앱 검증 시간이 초과되었습니다. ${standardError.trim()}`))
    }, 60_000)
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
  const state = await launch(join(directory, 'visual-state.json'), join(directory, 'user-data'))
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
    searchQuery && state.accessibility?.labeledTextLayers !== state.mountedPages ? '텍스트 접근성 layer가 누락됨' : undefined
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
    failures
  }
  console.log('HAN_FLOW_APP_VERIFY', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
