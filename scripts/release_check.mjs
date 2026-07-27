import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const fixture = process.argv[2]

if (!fixture?.toLowerCase().endsWith('.hwpx')) {
  console.error('사용법: npm run release:check -- <private-reference.hwpx>')
  process.exit(1)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const steps = [
  { name: '전체 테스트', command: npm, arguments_: ['test', '--', '--runInBand'] },
  { name: 'macOS production 패키지', command: npm, arguments_: ['run', 'package:mac'] },
  { name: '라이선스와 배포 고지', command: npm, arguments_: ['run', 'verify:notices'] },
  { name: '공개 호환성 matrix', command: npm, arguments_: ['run', 'verify:matrix'] },
  { name: '공개 HWP 렌더/PDF matrix', command: npm, arguments_: ['run', 'verify:hwp-matrix'] },
  { name: 'private 앱 smoke test', command: npm, arguments_: ['run', 'verify:app', '--', resolve(fixture)] },
  { name: 'private 화면/PDF 일치', command: npm, arguments_: ['run', 'verify:pdf', '--', resolve(fixture)] }
]

async function run(step) {
  console.log(`\n[release:check] ${step.name}`)
  await new Promise((resolvePromise, reject) => {
    const child = spawn(step.command, step.arguments_, { stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${step.name} 실패(종료 코드 ${code})`))
    })
  })
}

for (const step of steps) await run(step)
console.log('\nHAN_FLOW_RELEASE_CHECK', JSON.stringify({
  version: '1.0.0-rc.1',
  fixture: 'private-reference.hwpx',
  passed: true,
  steps: steps.map(({ name }) => name)
}))
