import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { outputProbe } from './hwp_probe_common.mjs'

const filePath = process.argv[2]
if (!filePath) {
  console.error('사용법: npm run probe:hwp -- <document.hwp>')
  process.exit(1)
}

const activeChildren = new Set()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of activeChildren) child.kill('SIGTERM')
    process.exitCode = 130
  })
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    activeChildren.add(child)
    let stdout = ''
    let stderr = ''
    let finished = false
    const finish = (code, fallback) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      activeChildren.delete(child)
      const line = stdout.split('\n').find((value) => value.startsWith('HAN_FLOW_HWP_PROBE '))
      let payload
      try {
        payload = line ? JSON.parse(line.slice('HAN_FLOW_HWP_PROBE '.length)) : null
      } catch {
        payload = null
      }
      resolvePromise({
        code,
        payload: payload ?? fallback ?? {
          schemaVersion: 1,
          success: false,
          error: { code: 'INVALID_PROBE_OUTPUT', message: '후보가 유효한 진단 JSON을 반환하지 않았습니다.' },
          stderrLength: stderr.trim().length
        }
      })
    }
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(1, {
        schemaVersion: 1,
        success: false,
        error: { code: 'TIMEOUT', message: '후보 probe 실행 시간이 초과되었습니다.' }
      })
    }, 60_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', () => finish(1))
    child.once('exit', (code) => finish(code))
  })
}

const root = resolve(import.meta.dirname, '../..')
const electron = resolve(root, 'node_modules/.bin/electron')
const [kordoc, rhwp] = await Promise.all([
  run(process.execPath, [resolve(import.meta.dirname, 'kordoc_probe.mjs'), filePath]),
  run(electron, [resolve(import.meta.dirname, 'rhwp_probe_main.cjs'), filePath])
])

const results = [kordoc.payload, rhwp.payload]
const kordocResult = kordoc.payload.result
const rhwpResult = rhwp.payload.result
outputProbe('HAN_FLOW_HWP_BAKEOFF', {
  schemaVersion: 1,
  completed: results.every((result) => result.result?.success === true),
  observations: {
    kordocSectionCount: kordocResult?.sectionCount ?? null,
    kordocTextCharacters: kordocResult?.structure?.textCharacters ?? null,
    rhwpPageCount: rhwpResult?.pageCount ?? null,
    rhwpTextCharacters: rhwpResult?.pageTextCounts?.reduce((sum, count) => sum + count, 0) ?? null,
    rhwpImageElements: rhwpResult?.imageElements ?? null
  },
  results
})
if (kordoc.code !== 0 || rhwp.code !== 0) process.exitCode = 1
