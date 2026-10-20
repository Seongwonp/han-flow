'use strict'

// `npm run package:win:release` 전용 electron-builder 설정. --config로 이 파일을 주면 package.json의
// build 필드는 읽히지 않으므로 그 값을 여기서 직접 이어받는다.
const { createWindowsReleaseConfig } = require('./windows_release_config.cjs')
const packageJson = require('../../package.json')

module.exports = createWindowsReleaseConfig(packageJson.build, process.env)
