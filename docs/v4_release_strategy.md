# V4 macOS 배포 조사와 구현 전략

기준일: 2026-08-09

## 결정 요약

Han-Flow V4의 첫 공개 배포는 Mac App Store가 아닌 **Developer ID로 서명·공증한 직접 배포**로
진행한다. 첫 배포 단위는 Apple Silicon arm64용 `dmg`와 향후 업데이트 metadata를 만들 수 있는
arm64 `zip`이다. 현재 `dir` target은 로컬 검증 전용으로 유지한다.

Intel x64와 Universal은 2026-08-09 실험에서 모두 package 구조 생성에 성공했지만 공개 target으로
채택하지 않는다. Apple은 일반 Intel 앱을 위한 Rosetta를 macOS 27까지만 제공하고 macOS 28부터
일부 오래된 게임만 예외로 둔다. macOS 26.4부터 Intel 앱 실행 시 지원 종료 알림도 표시한다.
Han-Flow의 실제 사용 환경과 미래 호환성을 고려해 **V4는 arm64-only**로 확정한다.

V3의 Windows 한/글 재열기 승인은 아직 대기 중이다. V4 조사는 병행하되 그 결과를 V3 완료로
간주하지 않으며, 인증서나 Apple 계정 secret 없이 수행할 수 있는 감사·문서화부터 진행한다.

## 2026-08-09 현재 기준선

`npm run release:audit`로 현재 production app과 build 설정을 조사했다.

| 항목 | 현재 상태 | 공개 배포 조건 |
| --- | --- | --- |
| package | `arm64`용 `dir` | `dmg` + `zip` release artifact |
| 서명 | Electron 실행 파일의 ad-hoc 서명, Team ID 없음 | Developer ID Application 서명 |
| 공증 | 미실행 | Apple notarization 성공 |
| stapling | 미실행 | 배포 artifact에 ticket 부착·검증 |
| architecture | 앱 framework는 arm64, `font-list` helper는 universal | V4 공개 artifact는 arm64-only |
| updater | runtime 연결 없음; 2026-08-20 미사용 dependency 제거 | 서명된 수동 릴리스 안정화 후 별도 도입 |

현재 `mac.identity: null`은 개인용 로컬 빌드에서 의도적으로 서명을 생략한다. 이를 공개 release
설정에 재사용하면 안 된다. release 전용 설정에는 `forceCodeSigning: true`를 두어 인증서가
없을 때 unsigned artifact가 조용히 만들어지지 않게 한다.

## Apple 배포 요구사항

Apple의 외부 배포 경로는 Developer ID certificate로 앱을 식별하고 Gatekeeper가 서명과
공증 상태를 확인하는 구조다. Han-Flow에는 `Developer ID Application` 인증서가 필요하다.
공증 제출물은 hardened runtime과 secure timestamp를 사용하고, 배포 빌드에
`com.apple.security.get-task-allow`를 포함하지 않아야 한다.

공증은 `notarytool` 경로를 사용한다. electron-builder에는 `mac.notarize: true`를 설정할 수
있지만 Apple ID/app-specific password, App Store Connect API key 또는 keychain profile은
환경·CI secret으로만 전달한다. 인증서와 credential은 저장소, `.env`, 로그, fixture에
커밋하지 않는다.

## 단계별 구현 순서

### V4-0 — 배포 기준선과 결정

- [x] 현재 app의 서명·Team ID·architecture를 읽기 전용으로 측정한다.
- [x] `dir`, `dmg`, `zip`의 역할과 updater 연결 상태를 기록한다.
- [x] 인증서 이름을 기록하지 않고 준비 여부만 판정하는 `release:audit`를 추가한다.
- [ ] Apple Developer Program 가입과 Developer ID Application 인증서를 준비한다.
- [x] Apple Silicon arm64-only 공개 지원 범위를 결정한다.

### V4-1 — 서명된 수동 배포

1. local unsigned 설정과 별도의 release 설정을 만든다.
2. `hardenedRuntime: true`, 최소 entitlements, `forceCodeSigning: true`를 적용한다.
3. arm64 release를 만들고 `codesign --verify --deep --strict`를 통과한다.
4. `dmg`와 `zip`을 생성해 SHA-256, 파일 크기, version을 manifest에 기록한다.
5. 공증 제출 뒤 ticket을 staple하고 `stapler validate`와 `spctl --assess`를 통과한다.
6. 인터넷에서 받은 파일과 같은 quarantine 조건으로 깨끗한 macOS 계정에서 설치·첫 실행한다.

entitlement는 Electron 실행에 실제 필요한 항목만 추가한다. 특히 library validation 해제 같은
광범위한 권한은 서명 실패가 재현되고 더 좁은 해결책이 없을 때만 검토한다.

### V4-2 — 아키텍처 실험과 결정

1. [x] arm64와 x64 `dir` package를 각각 생성한다.
2. [x] Universal merge에서 `app.asar`, native helper와 architecture별 resource를 검사한다.
3. [x] `font-list` helper, Electron framework와 모든 Mach-O의 architecture inventory를 기록한다.
4. [x] Apple의 Rosetta 종료 일정과 실제 지원 종료 알림을 근거로 arm64-only를 선택한다.

실험 결과는 다음과 같다.

| artifact | 논리 크기 | Mach-O | 실행 결과 |
| --- | ---: | --- | --- |
| arm64 | 339,563,671 byte | arm64 15, universal helper 1 | 3쪽·이미지 4개·overflow 0 |
| x64 | 345,097,640 byte | x64 15, universal helper 1 | package 구조 통과, Rosetta 종료 알림 확인 |
| Universal | 525,279,804 byte | 16개 모두 arm64+x86_64 | 강제 native arm64로 3쪽·이미지 4개·overflow 0 |

같은 `com.hanflow.viewer` bundle ID를 가진 세 app을 같은 폴더에서 연속 실행할 때 macOS 26.5.2의
LaunchServices 등록이 충돌해 `HIServices._RegisterApplication`에서 `SIGABRT`했다. 해당 app을
`lsregister -f`로 다시 등록하자 arm64와 Universal native smoke가 통과했다. 이는 renderer 진입
전 실험 환경 문제이며, 기본 등록은 마지막에 arm64 app으로 복원했다. E2E runner에는 이후
signal 이름과 선택적 architecture 강제 실행 진단을 추가했다.

`experiment:package:mac:x64`, `experiment:package:mac:universal`,
`experiment:verify:mac-arch`는 재현용이며 지원 artifact를 만드는 release 명령이 아니다.

### V4-3 — 업데이트와 공개 릴리스

첫 공개 버전은 수동 설치 경로를 먼저 안정화한다. 그 뒤 `electron-updater`를 main process에
연결하고 공개 GitHub Releases를 provider로 사용한다. macOS auto-update에는 signed app과
`zip`/`latest-mac.yml`이 필요하다.

- 업데이트 확인은 사용자가 앱을 연 뒤 수행하고 실패가 문서 열기를 막지 않는다.
- 자동 다운로드·설치 시점, 재시작 동의, downgrade 금지와 rollback 절차를 문서화한다.
- draft/prerelease 채널과 stable 채널을 분리한다.
- 공개 release 전에 이전 버전 → 새 버전 업데이트와 손상 metadata 실패를 검증한다.

## 공개 배포 승인 관문

- [ ] V3 macOS 물리 입력·Windows 한/글 matrix 승인
- [ ] 개인정보 없는 실제 HWPX/HWP compatibility corpus 통과
- [ ] Developer ID 서명과 strict verification 통과
- [ ] notarization, stapling, Gatekeeper 평가 통과
- [ ] arm64 release artifact의 열기·편집 Save As·PDF 통과
- [ ] 깨끗한 계정에서 DMG 설치, Finder 연결, 첫 실행 통과
- [ ] Apache-2.0, third-party notices, known limitations 포함
- [ ] artifact SHA-256과 release manifest 기록
- [ ] changelog와 GitHub Release 초안 검토
- [ ] updater를 활성화한다면 이전 공개 버전에서 실제 업데이트 통과

## 공식 참고 자료

아래 자료는 2026-08-09에 확인했다.

- Apple, [Developer ID certificates](https://developer.apple.com/help/glossary/developer-id-certificate/)
- Apple, [Developer ID](https://developer.apple.com/developer-id/)
- Apple, [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- Apple, [Resolving common notarization issues](https://developer.apple.com/documentation/security/resolving-common-notarization-issues)
- Apple 지원, [Apple Silicon이 탑재된 Mac에서 Intel 기반 앱 사용하기](https://support.apple.com/ko-kr/102527)
- Apple, [macOS Tahoe 26.4 Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-26_4-release-notes)
- Electron, [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- Electron, [Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- Electron, [Publishing and Updating](https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating)
- electron-builder, [Notarization](https://www.electron.build/docs/notarization/)
- electron-builder, [macOS Code Signing](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
- electron-builder, [macOS build options](https://www.electron.build/mac/)
- electron-builder, [Multi Platform Build](https://www.electron.build/docs/architecture/)
- electron-builder, [Auto Update](https://www.electron.build/docs/features/auto-update/)
