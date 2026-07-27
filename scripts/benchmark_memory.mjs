import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]
const appBinary = resolve(process.argv[3] ?? 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow')
const sampleCount = Math.max(1, Number(process.env.HAN_FLOW_MEMORY_SAMPLES ?? 5))

if (!/\.(?:hwp|hwpx)$/iu.test(fixture ?? '') || !Number.isInteger(sampleCount) || sampleCount > 30) {
  console.error('사용법: npm run benchmark:memory -- <fixture.hwp|fixture.hwpx> [Han-Flow 실행 파일]')
  process.exit(1)
}

const percentile = (samples, ratio) => [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * ratio) - 1]
const mib = (kilobytes) => kilobytes / 1024
const summary = (samples) => ({
  p50MiB: Number(mib(percentile(samples, 0.5)).toFixed(1)),
  p95MiB: Number(mib(percentile(samples, 0.95)).toFixed(1)),
  minMiB: Number(mib(Math.min(...samples)).toFixed(1)),
  maxMiB: Number(mib(Math.max(...samples)).toFixed(1))
})

async function launch(output, userData) {
  let standardError = ''
  return new Promise((resolvePromise, reject) => {
    let settled = false
    const child = spawn(appBinary, [], {
      env: {
        ...process.env,
        HAN_FLOW_E2E: '1',
        HAN_FLOW_VISUAL_TEST_FILE: resolve(fixture),
        HAN_FLOW_VISUAL_STATE_OUTPUT: output,
        HAN_FLOW_VISUAL_EXIT: '1',
        HAN_FLOW_VISUAL_CAPTURE_DELAY_MS: '1000',
        HAN_FLOW_VISUAL_READY_TIMEOUT_MS: '45000',
        HAN_FLOW_E2E_USER_DATA: userData
      },
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr.on('data', (chunk) => { standardError += chunk.toString() })
    const finish = (error, state) => {
      if (settled) return
      settled = true
      clearInterval(outputPoll)
      clearTimeout(timeout)
      if (error) reject(error)
      else resolvePromise(state)
    }
    const outputPoll = setInterval(async () => {
      try {
        const state = JSON.parse(await readFile(output, 'utf8'))
        if (!state.memory) return
        child.kill('SIGTERM')
        finish(undefined, state)
      } catch {
        // 상태 파일이 완전히 기록될 때까지 기다린다.
      }
    }, 100)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`메모리 측정 시간이 초과되었습니다. ${standardError.trim()}`))
    }, 60_000)
    child.once('error', (error) => finish(error))
    child.once('exit', (code) => {
      if (code !== 0) finish(new Error(`Han-Flow가 종료 코드 ${code}로 끝났습니다. ${standardError.trim()}`))
    })
  })
}

const directory = await mkdtemp(join(tmpdir(), 'han-flow-memory-'))
try {
  const measurements = []
  for (let sample = 0; sample < sampleCount; sample += 1) {
    measurements.push(await launch(
      join(directory, `state-${sample}.json`),
      join(directory, `user-data-${sample}`)
    ))
  }
  const fileBytes = (await stat(resolve(fixture))).size
  const sampledPeaks = measurements.map((state) => state.memory.sampledPeakWorkingSetKb)
  const processPeakSums = measurements.map((state) => state.memory.processPeakSumKb)
  const result = {
    format: extname(fixture).slice(1).toLowerCase(),
    inputMiB: Number((fileBytes / 1024 / 1024).toFixed(2)),
    sampleCount,
    mountedPages: [...new Set(measurements.map((state) => state.mountedPages))],
    totalPages: [...new Set(measurements.map((state) => state.totalPages))],
    processCounts: [...new Set(measurements.map((state) => state.memory.processCount))],
    sampledAggregatePeak: summary(sampledPeaks),
    conservativeProcessPeakSum: summary(processPeakSums)
  }
  console.log('HAN_FLOW_MEMORY_BENCHMARK', JSON.stringify(result))
} finally {
  await rm(directory, { recursive: true, force: true })
}
