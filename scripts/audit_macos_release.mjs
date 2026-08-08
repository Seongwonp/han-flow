import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const appPath = resolve(process.argv.find((argument) => argument.endsWith('.app')) ?? join(root, 'release/mac-arm64/Han-Flow.app'))
const strict = process.argv.includes('--strict')

function run(command, arguments_) {
  return spawnSync(command, arguments_, { encoding: 'utf8' })
}

function executableFiles(directory, results = []) {
  if (!existsSync(directory)) return results
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) executableFiles(path, results)
    else if (entry.isFile() && (statSync(path).mode & 0o111) !== 0) results.push(path)
  }
  return results
}

function architectures(path) {
  const result = run('lipo', ['-archs', path])
  return result.status === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean) : []
}

const mac = packageJson.build?.mac ?? {}
const targets = (Array.isArray(mac.target) ? mac.target : [mac.target])
  .filter(Boolean)
  .map((target) => typeof target === 'string' ? target : target.target)
const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'])
const developerIdCount = (identities.stdout.match(/Developer ID Application:/g) ?? []).length
const notarytool = run('xcrun', ['--find', 'notarytool']).status === 0
const stapler = run('xcrun', ['--find', 'stapler']).status === 0
const appExists = existsSync(appPath)
const signature = appExists ? run('codesign', ['-dv', '--verbose=4', appPath]) : null
const signatureText = `${signature?.stdout ?? ''}\n${signature?.stderr ?? ''}`
const signedByDeveloperId = signatureText.includes('Authority=Developer ID Application:')
const teamIdentifier = signatureText.match(/TeamIdentifier=([^\s]+)/)?.[1] ?? null
const mainExecutable = join(appPath, 'Contents', 'MacOS', packageJson.build?.productName ?? packageJson.name)
const mainArchitectures = existsSync(mainExecutable) ? architectures(mainExecutable) : []
const executableArchitectureSets = appExists
  ? [...new Set(executableFiles(appPath).map((path) => architectures(path).sort().join('+')).filter(Boolean))].sort()
  : []

const checks = [
  { id: 'app-id', passed: typeof packageJson.build?.appId === 'string' && packageJson.build.appId.length > 0,
    detail: packageJson.build?.appId ?? '없음' },
  { id: 'release-targets', passed: targets.includes('dmg') && targets.includes('zip'),
    detail: targets.length > 0 ? targets.join(', ') : '없음' },
  { id: 'signing-required', passed: mac.identity !== null,
    detail: mac.identity === null ? 'identity=null (서명 생략)' : '서명 identity 자동 탐색' },
  { id: 'developer-id', passed: developerIdCount > 0,
    detail: `사용 가능한 Developer ID Application 인증서 ${developerIdCount}개` },
  { id: 'notarytool', passed: notarytool, detail: notarytool ? '사용 가능' : '찾을 수 없음' },
  { id: 'stapler', passed: stapler, detail: stapler ? '사용 가능' : '찾을 수 없음' },
  { id: 'packaged-app', passed: appExists, detail: appExists ? appPath : '앱 없음' },
  { id: 'developer-id-signature', passed: signedByDeveloperId,
    detail: signedByDeveloperId ? `TeamIdentifier=${teamIdentifier}` : 'Developer ID 서명 없음' },
  { id: 'app-architecture', passed: mainArchitectures.length > 0,
    detail: mainArchitectures.length > 0 ? mainArchitectures.join(', ') : '판정 불가' }
]

const blockers = checks.filter((check) => !check.passed).map((check) => check.id)
console.log('HAN_FLOW_MACOS_RELEASE_AUDIT', JSON.stringify({
  checkedAt: new Date().toISOString(),
  version: packageJson.version,
  appPath,
  ready: blockers.length === 0,
  blockers,
  executableArchitectureSets,
  checks
}, null, 2))

if (strict && blockers.length > 0) process.exit(1)
