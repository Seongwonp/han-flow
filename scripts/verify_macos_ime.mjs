import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const arguments_ = process.argv.slice(2)
const option = (name) => {
  const index = arguments_.indexOf(name)
  return index >= 0 ? arguments_[index + 1] : undefined
}
const positional = arguments_.find((value, index) => !value.startsWith('--') && arguments_[index - 1]?.startsWith('--') !== true)
const surface = option('--surface') ?? 'paragraph'
const surfaceLabels = {
  paragraph: 'HWPX 문단 편집',
  cell: 'HWPX 표 셀 편집'
}
const surfaceLabel = surfaceLabels[surface]
const fixture = resolve(positional ?? 'artifacts/v3-acceptance/han-flow-v3-original.hwpx')
const appBinary = resolve(option('--app') ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')

if (process.platform !== 'darwin') {
  console.error('실제 IME 검증은 macOS에서만 실행할 수 있습니다.')
  process.exit(1)
}
if (!surfaceLabel) {
  console.error('사용법: npm run verify:ime:mac -- [fixture.hwpx] [--surface paragraph|cell] [--app <Han-Flow binary>]')
  process.exit(1)
}
if (typeof WebSocket !== 'function') {
  console.error('실제 IME 검증에는 WebSocket을 기본 제공하는 Node.js 22 이상이 필요합니다.')
  process.exit(1)
}

const FIRST_TEXT = '한글입력검증 '
const SECOND_TEXT = '추가 '
const FIRST_KEYS = [5, 40, 1, 15, 46, 3, 2, 37, 12, 3, 32, 15, 15, 38, 0, 13, 46, 2, 49]
const SECOND_KEYS = [8, 45, 15, 40, 49]
const port = 49_152 + Math.floor(Math.random() * 10_000)
const userData = await mkdtemp(join(tmpdir(), 'han-flow-real-ime-'))
const previousFrontmost = spawnSync(
  '/usr/bin/osascript',
  ['-e', 'tell application "System Events" to get unix id of first application process whose frontmost is true'],
  { encoding: 'utf8' }
).stdout.trim()
const child = spawn(appBinary, [`--remote-debugging-port=${port}`], {
  env: {
    ...process.env,
    HAN_FLOW_E2E: '1',
    HAN_FLOW_VISUAL_TEST_FILE: fixture,
    HAN_FLOW_E2E_USER_DATA: userData
  },
  stdio: ['ignore', 'ignore', 'pipe']
})
let standardError = ''
let socket
child.stderr.on('data', (chunk) => { standardError += chunk.toString() })

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

async function stopChild() {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    sleep(2_000)
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

function restoreFrontmostApplication() {
  if (!/^\d+$/u.test(previousFrontmost) || previousFrontmost === String(child.pid)) return
  spawnSync(
    '/usr/bin/osascript',
    ['-e', `tell application "System Events" to set frontmost of first application process whose unix id is ${previousFrontmost} to true`],
    { encoding: 'utf8' }
  )
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Han-Flow가 조기에 종료되었습니다: ${standardError.trim()}`)
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
      if (target) return target
    } catch {
      // DevTools endpoint가 열릴 때까지 기다린다.
    }
    await sleep(50)
  }
  throw new Error(`CDP 연결 시간이 초과되었습니다: ${standardError.trim()}`)
}

function macOsKeyScript(keys) {
  return `tell application "System Events"
set frontmost of first application process whose unix id is ${child.pid} to true
delay 0.3
${keys.map((key) => `key code ${key}\ndelay 0.06`).join('\n')}
get name of first application process whose frontmost is true
end tell`
}

function sendKeys(keys, phase) {
  const result = spawnSync('/usr/bin/osascript', ['-e', macOsKeyScript(keys)], { encoding: 'utf8' })
  if (result.status !== 0 || result.stdout.trim() !== 'Han-Flow') {
    throw new Error(`${phase} 키 입력 실패: ${result.stderr.trim()} (시스템 설정에서 자동화·손쉬운 사용 권한을 확인하세요.)`)
  }
}

try {
  const target = await waitForTarget()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const callback = pending.get(message.id)
    if (!callback) return
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(message.error.message))
    else callback.resolve(message.result)
  })
  const command = (method, params = {}) => {
    const id = nextId++
    socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }))
  }
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  await command('Page.bringToFront')
  const setup = await evaluate(`(async () => {
    const surfaceLabel = ${JSON.stringify(surfaceLabel)}
    const waitFor = async (predicate, timeout = 30000) => {
      const started = performance.now()
      while (performance.now() - started < timeout) {
        const result = predicate()
        if (result) return result
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('편집 surface 준비 시간이 초과되었습니다.')
    }
    const editButton = await waitFor(() =>
      Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '편집')
    )
    editButton.click()
    const findSurface = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
      .find((element) => element.dataset.inputReady === 'true')
    let target = await waitFor(findSurface)
    const anchor = target.dataset.sourceTextNodeId
    const currentSurface = () => Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
      .find((element) => element.dataset.sourceTextNodeId === anchor && element.dataset.inputReady === 'true')
    target.focus()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    target = await waitFor(currentSurface)
    const placeCaretAtEnd = () => {
      target.focus()
      const selection = window.getSelection()
      const node = target.firstChild ?? target.appendChild(document.createTextNode(''))
      selection.setBaseAndExtent(node, target.textContent.length, node, target.textContent.length)
    }
    placeCaretAtEnd()
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    target = await waitFor(currentSurface)
    placeCaretAtEnd()
    window.__hanFlowRealImeAnchor = anchor
    window.__hanFlowRealImeEvents = []
    for (const type of ['beforeinput', 'compositionstart', 'compositionupdate', 'input', 'compositionend']) {
      document.addEventListener(type, (event) => {
        window.__hanFlowRealImeEvents.push({ type, inputType: event.inputType, isComposing: event.isComposing })
      }, true)
    }
    return { anchor, original: target.textContent }
  })()`)

  const snapshot = () => evaluate(`(() => {
    const surfaceLabel = ${JSON.stringify(surfaceLabel)}
    const target = Array.from(document.querySelectorAll('[aria-label="' + surfaceLabel + '"]'))
      .find((element) => element.dataset.sourceTextNodeId === window.__hanFlowRealImeAnchor)
    const counts = window.__hanFlowRealImeEvents.reduce((result, event) => {
      result[event.type] = (result[event.type] ?? 0) + 1
      return result
    }, {})
    return {
      text: target?.textContent,
      active: document.activeElement === target,
      activeId: document.activeElement?.dataset?.sourceTextNodeId,
      undoDisabled: document.querySelector('[aria-label="실행 취소"]')?.disabled,
      dirty: document.querySelector('.viewer-status')?.textContent?.includes('저장 안 됨') ?? false,
      eventCount: window.__hanFlowRealImeEvents.length,
      eventCounts: counts
    }
  })()`)

  sendKeys(FIRST_KEYS, '첫 번째')
  await sleep(2_000)
  const afterFirst = await snapshot()
  sendKeys(SECOND_KEYS, '두 번째')
  await sleep(2_000)
  const afterSecond = await snapshot()
  const failures = [
    afterFirst.text?.includes(FIRST_TEXT) ? undefined : '스페이스바를 포함한 첫 한글 입력 결과가 일치하지 않음',
    afterFirst.active ? undefined : '첫 커밋 뒤 편집 포커스가 유실됨',
    afterFirst.activeId === setup.anchor ? undefined : '첫 커밋 뒤 다른 source anchor가 활성화됨',
    afterFirst.undoDisabled === false ? undefined : '첫 커밋 뒤 실행 취소가 활성화되지 않음',
    afterFirst.dirty ? undefined : '첫 커밋 뒤 dirty 상태가 표시되지 않음',
    (afterFirst.eventCounts.compositionend ?? 0) > 0 ? undefined : '스페이스바 뒤 compositionend가 관찰되지 않음',
    afterSecond.text?.includes(`${FIRST_TEXT}${SECOND_TEXT}`) ? undefined : '클릭 없는 두 번째 한글 입력 결과가 일치하지 않음',
    afterSecond.active ? undefined : '두 번째 커밋 뒤 편집 포커스가 유실됨',
    afterSecond.activeId === setup.anchor ? undefined : '두 번째 커밋 뒤 다른 source anchor가 활성화됨',
    afterSecond.eventCount > afterFirst.eventCount ? undefined : '두 번째 입력의 native IME 이벤트가 관찰되지 않음'
  ].filter(Boolean)
  const result = {
    fixture: fixture.split('/').at(-1),
    surface,
    passed: failures.length === 0,
    inserted: `${FIRST_TEXT}${SECOND_TEXT}`,
    afterFirst,
    afterSecond,
    failures
  }
  console.log('HAN_FLOW_REAL_IME_VERIFY', JSON.stringify(result))
  if (failures.length) process.exitCode = 1
} catch (reason) {
  console.error(`실제 macOS IME 검증 실패: ${reason instanceof Error ? reason.message : String(reason)}`)
  process.exitCode = 1
} finally {
  if (socket) {
    socket.close()
    await Promise.race([
      new Promise((resolvePromise) => socket.addEventListener('close', resolvePromise, { once: true })),
      sleep(500)
    ])
  }
  await stopChild()
  restoreFrontmostApplication()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
