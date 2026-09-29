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

// Electron 실행 인자. 패키지 앱과 `electron <script> <args>` 보조 스크립트 모두 맨 앞에 붙인다.
// 보조 스크립트(*.cjs)는 자기 스크립트 경로 뒤의 인자만 위치 인자로 읽으므로 앞에 붙은 옵션과 섞이지 않는다.
export function electronLaunchArguments() {
  return sandboxDisabled() ? ['--no-sandbox'] : []
}
