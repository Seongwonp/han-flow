import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]
const appBinary = resolve(process.argv[3] ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')

if (!fixture?.toLowerCase().endsWith('.hwpx')) {
  console.error('사용법: npm run verify:app -- <fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

async function launch(output, userData) {
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const child = spawn(appBinary, [], {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_VISUAL_TEST_FILE: resolve(fixture),
        HAN_FLOW_VISUAL_STATE_OUTPUT: output,
        HAN_FLOW_VISUAL_EXIT: '1',
        HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: process.env.HAN_FLOW_VERIFY_DELAY_MS ?? '3000',
        HAN_FLOW_E2E_USER_DATA: userData
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('패키지 앱 검증 시간이 초과되었습니다.')) }, 30_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`Han-Flow가 종료 코드 ${code}로 끝났습니다. ${standardError.trim()}`))
    })
  })
  return JSON.parse(await readFile(output, 'utf8'))
}

const directory = await mkdtemp(join(tmpdir(), 'han-flow-app-verify-'))
try {
  const state = await launch(join(directory, 'visual-state.json'), join(directory, 'user-data'))
  const incompleteImages = state.images.filter((image) => !image.complete || image.naturalWidth <= 0).length
  const failures = [
    state.totalPages > 0 ? undefined : '페이지가 생성되지 않음',
    state.mountedPages > 0 ? undefined : '페이지 DOM이 생성되지 않음',
    state.documentLoading ? '백그라운드 문서 로딩이 끝나지 않음' : undefined,
    state.overflowPages.length ? `페이지 overflow: ${state.overflowPages.join(', ')}` : undefined,
    incompleteImages ? `decode 실패 이미지: ${incompleteImages}` : undefined
  ].filter(Boolean)
  const result = {
    fixture: basename(fixture),
    passed: failures.length === 0,
    totalPages: state.totalPages,
    mountedPages: state.mountedPages,
    imageCount: state.images.length,
    overflowPages: state.overflowPages,
    pageTextCounts: state.pageTextCounts,
    failures
  }
  console.log('HAN_FLOW_APP_VERIFY', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
