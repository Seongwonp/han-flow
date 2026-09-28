import { resolve } from 'node:path'

const packagedBinaries = {
  darwin: 'release/mac-arm64/Han-Flow.app/Contents/MacOS/Han-Flow',
  win32: 'release/win-unpacked/Han-Flow.exe',
  linux: 'release/linux-unpacked/han-flow'
}

// 플랫폼별 electron-builder dir 출력의 기본 실행 파일 경로.
export function defaultAppBinary(root = process.cwd()) {
  return resolve(root, packagedBinaries[process.platform] ?? packagedBinaries.darwin)
}

// root 실행, 컨테이너, userns가 막힌 CI에서는 Chromium sandbox를 끈다.
export function sandboxDisabled() {
  return process.getuid?.() === 0 || process.env.HAN_FLOW_NO_SANDBOX === '1'
}

// 패키지 앱 실행 인자.
export function electronLaunchArguments() {
  return sandboxDisabled() ? ['--no-sandbox'] : []
}

// 위치 인자를 쓰는 Electron 보조 스크립트는 인자 대신 환경 변수로 sandbox를 끈다.
export function electronLaunchEnvironment() {
  return sandboxDisabled() ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}
}
