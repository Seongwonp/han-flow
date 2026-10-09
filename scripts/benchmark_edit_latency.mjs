import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { defaultAppBinary, electronLaunchArguments } from './app_binary.mjs'
import { loadGenerator } from './corpus/corpus_runtime.mjs'

/*
 * 패키지 앱에서 한 글자 입력 지연을 잰다. 인자가 없으면 공개 합성 fixture large-progressive(80 section, 약 19.5k 문단)를 만든다.
 * 편집을 시작한 뒤 본문 문단 하나에 한 글자씩 insertText를 넣고, 입력 event부터 편집 결과(revision)가 화면 DOM에 반영될 때까지와
 * 다음 frame까지를 잰다. renderer 쪽 구간은 편집 요청 시작·결과 도착 시각 표시(`performance.mark`)로 나눈다.
 *
 *   xvfb-run -a npm run benchmark:edit-latency -- [fixture.hwpx] [Han-Flow 실행 파일]
 */

const keystrokes = Number(process.env.HAN_FLOW_EDIT_LATENCY_KEYSTROKES ?? 30)
const fixtureArgument = process.argv[2]
const appBinary = process.argv[3] ? resolve(process.argv[3]) : defaultAppBinary()

const directory = await mkdtemp(join(tmpdir(), 'han-flow-edit-latency-'))
try {
  const fixture = fixtureArgument
    ? resolve(fixtureArgument)
    : loadGenerator().createSyntheticHwpx(directory, {
        fileName: 'large-progressive.hwpx',
        sectionCount: 80,
        paragraphsPerExtraSection: 250,
        imageBytes: 5 * 1024 * 1024
      })
  const output = join(directory, 'visual-state.json')
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const child = spawn(appBinary, electronLaunchArguments(), {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_VISUAL_TEST_FILE: fixture,
        HAN_FLOW_VISUAL_STATE_OUTPUT: output,
        HAN_FLOW_VISUAL_EXIT: '1',
        HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: '500',
        HAN_FLOW_VISUAL_READY_TIMEOUT_MS: '120000',
        HAN_FLOW_VISUAL_EDIT_LATENCY: String(keystrokes),
        HAN_FLOW_E2E_USER_DATA: join(directory, 'user-data'),
        HAN_FLOW_DIRTY_ACTION: 'discard'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`입력 지연 측정 시간이 초과되었습니다. ${standardError.trim()}`))
    }, Number(process.env.HAN_FLOW_EDIT_LATENCY_TIMEOUT_MS ?? 600_000))
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`Han-Flow가 종료 코드 ${code}로 끝났습니다. ${standardError.trim()}`))
    })
  })
  const state = JSON.parse(await readFile(output, 'utf8'))
  const probe = state.editingProbe ?? {}
  if (probe.probeError || !probe.keystrokes) {
    throw new Error(`입력 지연을 재지 못했습니다: ${probe.probeError ?? '결과 없음'}`)
  }
  const { samples: _samples, ...summary } = probe
  console.log('HAN_FLOW_EDIT_LATENCY', JSON.stringify(summary))
  if (!probe.textEndsWithInput) throw new Error('입력한 글자가 화면 문단에 남지 않았습니다.')
} finally {
  await rm(directory, { recursive: true, force: true })
}
