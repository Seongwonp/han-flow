// 서명 재료가 환경 변수로 준비됐는지 확인한다. 값은 출력하지 않고 빠진 변수 이름만 보인다.
import releaseConfig from './windows_release_config.cjs'

const result = releaseConfig.windowsSigningPreflight(process.env)
console.log('HAN_FLOW_WINDOWS_SIGNING_PREFLIGHT', JSON.stringify(result))

if (!result.ready) {
  console.error([
    'Windows 서명 재료가 없어 공개 배포 설치본을 만들지 않습니다.',
    result.error ?? `빠진 환경 변수: ${result.missing.join(', ')}`,
    '비서명 로컬 설치본은 `npm run package:win:installer`를 쓰고, 서명 준비는 docs/v4_release_strategy.md의 Windows 절을 따르세요.'
  ].join('\n'))
  process.exit(1)
}
