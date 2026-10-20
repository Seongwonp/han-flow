// Windows 공개 배포 설치본을 읽기 전용으로 감사한다.
// - release 설정: appId, forceCodeSigning, NSIS target·설치 방식, .hwp/.hwpx 연결
// - 서명 재료: 환경 변수 이름만 확인(값은 읽어도 출력하지 않음)
// - 설치본·앱 exe: PE 구조, 인증서 표, Authenticode 검증(Windows는 PowerShell, 그 밖은 osslsigncode), 버전 리소스, SHA-256
// 서명자 이름은 출력하지 않고 HAN_FLOW_WIN_PUBLISHER_NAME과 같은지만 보인다. `-- --strict`는 blocker가 있으면 실패한다.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import releaseConfig from './build/windows_release_config.cjs'
import {
  POWERSHELL_SIGNATURE_SCRIPT,
  embeddedSignature,
  parseOsslsigncodeVerify,
  parsePeHeaders,
  parsePowerShellSignature,
  parseVersionInfo
} from './windows_authenticode.mjs'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const strict = process.argv.includes('--strict')
const explicitInstaller = process.argv.slice(2).find((argument) => argument.toLowerCase().endsWith('.exe'))
const outputDirectory = join(root, releaseConfig.RELEASE_OUTPUT_DIRECTORY)
const expectedName = `Han-Flow-${packageJson.version}-win-x64.exe`
const installerPath = explicitInstaller ? resolve(explicitInstaller) : join(outputDirectory, expectedName)
const appExePath = join(outputDirectory, 'win-unpacked', `${packageJson.build.productName}.exe`)

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', reject).on('data', (chunk) => hash.update(chunk)).on('end', () => resolvePromise(hash.digest('hex')))
  })
}

function commandAvailable(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' })
  return !result.error
}

function verifyAuthenticode(path) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SIGNATURE_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, HAN_FLOW_AUDIT_FILE: path }
    })
    if (result.error) return { tool: 'powershell', status: 'unavailable' }
    return parsePowerShellSignature(result.stdout)
  }
  if (!commandAvailable('osslsigncode', ['--version'])) return { tool: 'osslsigncode', status: 'unavailable' }
  const result = spawnSync('osslsigncode', ['verify', '-in', path], { encoding: 'utf8' })
  return parseOsslsigncodeVerify(`${result.stdout}\n${result.stderr}`, result.status)
}

async function inspectExecutable(path) {
  if (!existsSync(path)) return { exists: false }
  const buffer = readFileSync(path)
  const headers = parsePeHeaders(buffer)
  const embedded = embeddedSignature(buffer, headers)
  const versionInfo = headers.isPE ? parseVersionInfo(buffer, headers) : null
  const verification = embedded.present ? verifyAuthenticode(path) : { tool: null, status: 'unsigned' }
  const expectedPublisher = process.env.HAN_FLOW_WIN_PUBLISHER_NAME?.trim() || null
  const { signerCommonName, ...publicVerification } = verification
  return {
    exists: true,
    size: statSync(path).size,
    sha256: await sha256(path),
    pe: headers.isPE ? { machine: headers.machine, format: headers.format } : { error: headers.reason },
    embeddedSignature: embedded.present ? { present: true, size: embedded.size } : { present: false, reason: embedded.reason },
    verification: {
      ...publicVerification,
      publisherMatches: expectedPublisher && signerCommonName ? signerCommonName === expectedPublisher : null
    },
    versionInfo: versionInfo
      ? {
          fixedFileVersion: versionInfo.fixedFileVersion,
          fixedProductVersion: versionInfo.fixedProductVersion,
          ProductName: versionInfo.strings.ProductName ?? null,
          ProductVersion: versionInfo.strings.ProductVersion ?? null,
          FileVersion: versionInfo.strings.FileVersion ?? null,
          CompanyName: versionInfo.strings.CompanyName ?? null
        }
      : null
  }
}

let config = null
let configError = null
try {
  config = releaseConfig.createWindowsReleaseConfig(packageJson.build, process.env)
} catch (error) {
  configError = error.message
}
const preflight = releaseConfig.windowsSigningPreflight(process.env)
const associations = new Set((config?.win?.fileAssociations ?? []).map((association) => association.ext))
const targets = (config?.win?.target ?? []).map((target) => typeof target === 'string' ? target : target.target)
const installer = await inspectExecutable(installerPath)
const appExe = await inspectExecutable(appExePath)

function signatureCheck(id, file) {
  if (!file.exists) return { id, passed: false, detail: '파일 없음' }
  const status = file.verification.status
  const detail = status === 'unavailable'
    ? `내장 서명 있음, 검증 도구(${file.verification.tool}) 없음`
    : `${status}${file.verification.tool ? ` (${file.verification.tool})` : ''}`
  return { id, passed: status === 'valid', detail }
}

// NSIS 설치본은 ProductVersion에, electron-builder가 고친 앱 exe는 FileVersion에 package version 문자열을 그대로 넣는다.
function versionCheck(id, file) {
  if (!file.exists) return { id, passed: false, detail: '파일 없음' }
  const info = file.versionInfo
  if (!info) return { id, passed: false, detail: '버전 리소스 없음' }
  const passed = info.ProductName === packageJson.build.productName &&
    [info.ProductVersion, info.FileVersion].includes(packageJson.version)
  return { id, passed, detail: `${info.ProductName} ProductVersion=${info.ProductVersion} FileVersion=${info.FileVersion}` }
}

const checks = [
  { id: 'release-config', passed: config !== null, detail: configError ?? releaseConfig.RELEASE_OUTPUT_DIRECTORY },
  { id: 'app-id', passed: config?.appId === packageJson.build.appId && typeof config?.appId === 'string',
    detail: config?.appId ?? '없음' },
  { id: 'force-code-signing', passed: config?.forceCodeSigning === true, detail: String(config?.forceCodeSigning ?? false) },
  { id: 'nsis-target', passed: targets.length === 1 && targets[0] === 'nsis', detail: targets.join(', ') || '없음' },
  { id: 'nsis-install-mode', passed: config?.nsis?.oneClick === packageJson.build.nsis.oneClick &&
      config?.nsis?.perMachine === packageJson.build.nsis.perMachine,
    detail: `oneClick=${config?.nsis?.oneClick}, perMachine=${config?.nsis?.perMachine}` },
  { id: 'file-associations', passed: associations.has('hwp') && associations.has('hwpx'),
    detail: [...associations].join(', ') || '없음' },
  { id: 'signing-environment', passed: preflight.ready,
    detail: preflight.ready ? `${preflight.mode} 준비됨` : `${preflight.mode ?? '알 수 없음'}: ${preflight.missing.join(', ')} 없음` },
  { id: 'installer', passed: installer.exists, detail: installer.exists ? relative(root, installerPath) : `${relative(root, installerPath)} 없음` },
  signatureCheck('installer-signature', installer),
  { id: 'installer-timestamp', passed: installer.exists && installer.verification.timestamped === true,
    detail: installer.exists ? String(installer.verification.timestamped ?? false) : '파일 없음' },
  versionCheck('installer-version', installer),
  signatureCheck('app-signature', appExe),
  versionCheck('app-version', appExe)
]
const publisherChecks = [installer, appExe].filter((file) => file.exists && file.verification.publisherMatches !== null)
if (publisherChecks.length > 0) {
  checks.push({ id: 'publisher-name', passed: publisherChecks.every((file) => file.verification.publisherMatches),
    detail: 'HAN_FLOW_WIN_PUBLISHER_NAME과 서명자 CN 비교' })
}

const blockers = checks.filter((check) => !check.passed).map((check) => check.id)
console.log('HAN_FLOW_WINDOWS_RELEASE_AUDIT', JSON.stringify({
  checkedAt: new Date().toISOString(),
  version: packageJson.version,
  platform: process.platform,
  ready: blockers.length === 0,
  blockers,
  checks,
  installer,
  appExe
}, null, 2))

if (strict && blockers.length > 0) process.exit(1)
