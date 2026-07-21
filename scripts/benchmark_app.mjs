import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]
const appBinary = resolve(process.argv[3] ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const sampleCount = 20

if (!fixture?.toLowerCase().endsWith('.hwpx')) {
  console.error('사용법: npm run benchmark:app -- <fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

const percentile = (samples, ratio) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * ratio) - 1]
const summary = (samples) => ({
  p50: Math.round(percentile(samples, 0.5)),
  p95: Math.round(percentile(samples, 0.95)),
  min: Math.round(Math.min(...samples)),
  max: Math.round(Math.max(...samples))
})

async function launch(output, runs) {
  let standardError = ''
  await new Promise((resolvePromise, reject) => {
    const child = spawn(appBinary, [], {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_BENCHMARK_FILE: resolve(fixture),
        HAN_FLOW_BENCHMARK_OUTPUT: output,
        HAN_FLOW_BENCHMARK_RUNS: String(runs),
        HAN_FLOW_BENCHMARK_USER_DATA: `${output}.user-data`
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('앱 성능 측정 시간이 초과되었습니다.')) }, 30_000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`Han-Flow가 종료 코드 ${code}로 끝났습니다. ${standardError.trim()}`))
    })
  })
  try {
    return JSON.parse(await readFile(output, 'utf8')).measurements
  } catch (error) {
    throw new Error(`측정 결과 파일을 읽지 못했습니다. ${standardError.trim()}`, { cause: error })
  }
}

const directory = await mkdtemp(join(tmpdir(), 'han-flow-app-benchmark-'))
try {
  const warm = await launch(join(directory, 'warm.json'), sampleCount + 1)
  const cold = []
  for (let sample = 0; sample < sampleCount; sample += 1) {
    cold.push(...await launch(join(directory, `cold-${sample}.json`), 1))
  }
  const result = {
    fixture: basename(fixture),
    sampleCount,
    warmOpenToFirstPaintMs: summary(warm.slice(1).map((item) => item.openToFirstPaintMs)),
    coldOpenToFirstPaintMs: summary(cold.map((item) => item.openToFirstPaintMs))
  }
  console.log('HAN_FLOW_APP_BENCHMARK', JSON.stringify(result))
} finally {
  await rm(directory, { recursive: true, force: true })
}
