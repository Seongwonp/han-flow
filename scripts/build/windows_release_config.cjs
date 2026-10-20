'use strict'

// Windows 공개 배포(서명) 설정. 로컬·CI 비서명 설정(package.json의 build)은 그대로 두고, 그 위에
// 서명 강제·timestamp·별도 출력 폴더만 덧씌운다. 인증서·비밀번호·Azure credential은 설정에 넣지 않고
// electron-builder가 직접 읽는 환경 변수로만 전달한다. 이 module은 값이 아닌 변수 이름만 보고한다.

const RELEASE_OUTPUT_DIRECTORY = 'release/windows-release'
const RFC3161_TIMESTAMP_SERVER = 'http://timestamp.digicert.com'
const AZURE_TIMESTAMP_SERVER = 'http://timestamp.acs.microsoft.com'

const SIGNING_MODES = ['pfx', 'azure']

// 서명 방식별로 있어야 하는 환경 변수. 배열 안 배열은 "이 중 하나"다.
const REQUIRED_ENVIRONMENT = {
  pfx: [['WIN_CSC_LINK', 'CSC_LINK'], ['WIN_CSC_KEY_PASSWORD', 'CSC_KEY_PASSWORD']],
  azure: [
    ['AZURE_TENANT_ID'],
    ['AZURE_CLIENT_ID'],
    ['AZURE_CLIENT_SECRET'],
    ['HAN_FLOW_AZURE_SIGNING_ENDPOINT'],
    ['HAN_FLOW_AZURE_SIGNING_ACCOUNT'],
    ['HAN_FLOW_AZURE_CERTIFICATE_PROFILE'],
    ['HAN_FLOW_WIN_PUBLISHER_NAME']
  ]
}

function present(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0
}

function resolveWindowsSigningMode(env = process.env) {
  const explicit = env.HAN_FLOW_WIN_SIGNING_MODE?.trim().toLowerCase()
  if (explicit) {
    if (!SIGNING_MODES.includes(explicit)) {
      throw new Error(`HAN_FLOW_WIN_SIGNING_MODE는 ${SIGNING_MODES.join(' 또는 ')}여야 합니다`)
    }
    return explicit
  }
  return present(env, 'HAN_FLOW_AZURE_SIGNING_ENDPOINT') ? 'azure' : 'pfx'
}

// 값은 절대 돌려주지 않는다. 빠진 변수 이름(또는 "A|B" 대안)만 돌려준다.
function windowsSigningPreflight(env = process.env) {
  let mode
  try {
    mode = resolveWindowsSigningMode(env)
  } catch (error) {
    return { mode: null, ready: false, missing: ['HAN_FLOW_WIN_SIGNING_MODE'], error: error.message }
  }
  const missing = REQUIRED_ENVIRONMENT[mode]
    .filter((alternatives) => !alternatives.some((name) => present(env, name)))
    .map((alternatives) => alternatives.join('|'))
  return { mode, ready: missing.length === 0, missing }
}

function createWindowsReleaseConfig(baseBuild, env = process.env) {
  if (!baseBuild?.win || !baseBuild?.nsis) throw new Error('package.json build.win·build.nsis가 필요합니다')
  const mode = resolveWindowsSigningMode(env)
  const publisherName = present(env, 'HAN_FLOW_WIN_PUBLISHER_NAME') ? env.HAN_FLOW_WIN_PUBLISHER_NAME.trim() : null

  const signing = mode === 'azure'
    ? {
        azureSignOptions: {
          publisherName: publisherName ?? '',
          endpoint: env.HAN_FLOW_AZURE_SIGNING_ENDPOINT?.trim() ?? '',
          codeSigningAccountName: env.HAN_FLOW_AZURE_SIGNING_ACCOUNT?.trim() ?? '',
          certificateProfileName: env.HAN_FLOW_AZURE_CERTIFICATE_PROFILE?.trim() ?? '',
          fileDigest: 'SHA256',
          timestampRfc3161: AZURE_TIMESTAMP_SERVER,
          timestampDigest: 'SHA256'
        }
      }
    : {
        // 인증서 파일·비밀번호는 WIN_CSC_LINK·WIN_CSC_KEY_PASSWORD(또는 CSC_*) 환경 변수로만 받는다.
        // Electron 44는 Windows 10 이상만 지원하므로 SHA-1 이중 서명 없이 SHA-256 + RFC 3161 timestamp만 쓴다.
        signtoolOptions: {
          signingHashAlgorithms: ['sha256'],
          rfc3161TimeStampServer: RFC3161_TIMESTAMP_SERVER,
          ...(publisherName ? { publisherName } : {})
        }
      }

  return {
    ...baseBuild,
    // 인증서가 없거나 서명이 실패하면 비서명 artifact를 만들지 않고 실패한다.
    forceCodeSigning: true,
    directories: { ...baseBuild.directories, output: RELEASE_OUTPUT_DIRECTORY },
    win: {
      ...baseBuild.win,
      target: [{ target: 'nsis', arch: ['x64'] }],
      signExecutable: true,
      signAndEditExecutable: true,
      ...signing
    },
    // 설치 방식은 비서명 설치본과 같게 둔다. appId가 같아야 NSIS uninstall GUID가 같아 기존 설치를 덮어쓴다.
    nsis: { ...baseBuild.nsis }
  }
}

module.exports = {
  RELEASE_OUTPUT_DIRECTORY,
  RFC3161_TIMESTAMP_SERVER,
  AZURE_TIMESTAMP_SERVER,
  SIGNING_MODES,
  REQUIRED_ENVIRONMENT,
  resolveWindowsSigningMode,
  windowsSigningPreflight,
  createWindowsReleaseConfig
}
