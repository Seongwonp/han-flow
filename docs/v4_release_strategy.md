# V4 배포 조사와 구현 전략 (macOS·Windows)

기준일: 2026-08-09 (macOS), 2026-10-20 (Windows 서명 배포 절)

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

## Windows 서명 배포 (Sprint 5)

### 결정 요약

Windows 공개 배포 단위는 **Authenticode로 서명·timestamp한 x64 NSIS 설치본**이다. 인증서는 아직 없으므로
2026-10-20 기준으로 인증서만 넣으면 바로 서명 release를 만들 수 있게 경로를 분리해 두었다.

| 경로 | 명령 | 설정 | 출력 | 서명 |
| --- | --- | --- | --- | --- |
| 로컬·CI 검증 | `npm run package:win`, `npm run package:win:installer` | `package.json`의 `build` | `release/` | 안 함(SmartScreen 경고) |
| 공개 배포 | `npm run package:win:release` | `scripts/build/electron-builder.win-release.cjs` | `release/windows-release/` | 강제(`forceCodeSigning: true`) |

- release 설정은 `package.json`의 `build`를 그대로 이어받고(`scripts/build/windows_release_config.cjs`)
  `forceCodeSigning: true`, NSIS x64 단일 target, 별도 출력 폴더, 서명 옵션만 덧씌운다. 비서명
  `windows-ci.yml` 흐름과 `package:win*` 명령은 바뀌지 않는다.
- 설치 방식은 비서명 설치본과 같다: `oneClick: false`, `perMachine: false`(사용자별 설치, UAC 없음),
  설치 경로 선택, 바탕 화면 바로 가기, 한국어(1042), 제거 때 사용자 데이터 보존.
- `appId`는 `com.hanflow.viewer`로 고정한다. NSIS 제거 GUID가 appId에서 만들어지므로 바꾸면 기존 설치를
  덮어쓰지 못하고 두 개가 설치된다. `nsis.guid`는 따로 두지 않는다.
- `.hwp`(`application/x-hwp`)·`.hwpx`(`application/hwp+zip`) 파일 연결은 기존 `win.fileAssociations`를 그대로 쓴다.
- artifact 이름은 `Han-Flow-<version>-win-x64.exe`로 같고, 서명본은 출력 폴더로 구분한다.
- 서명은 SHA-256 하나와 RFC 3161 timestamp만 쓴다(Electron 44는 Windows 10 이상만 지원해 SHA-1 이중 서명 불필요).
  timestamp가 있어야 인증서가 만료된 뒤에도 이미 배포한 설치본의 서명이 유효하다.
- 인증서·비밀번호·Azure credential은 설정 파일에 넣지 않고 electron-builder가 직접 읽는 환경 변수로만 전달한다.
  사전 검사(`scripts/build/check_windows_signing.mjs`)와 감사는 값이 아니라 빠진 변수 **이름**만 출력한다.

### 서명 방식과 환경 변수

`HAN_FLOW_WIN_SIGNING_MODE`(`pfx` 또는 `azure`)로 고른다. 비우면 `HAN_FLOW_AZURE_SIGNING_ENDPOINT`가 있을 때
`azure`, 없으면 `pfx`다.

| 방식 | secret(GitHub Environment secret) | variable(GitHub Environment variable) |
| --- | --- | --- |
| `pfx` — 내보낼 수 있는 PFX 인증서 | `WIN_CSC_LINK`(PFX의 base64 또는 https 경로), `WIN_CSC_KEY_PASSWORD` | `HAN_FLOW_WIN_PUBLISHER_NAME`(선택, 인증서 CN과 같게) |
| `azure` — Azure Trusted Signing(Artifact Signing) | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | `HAN_FLOW_WIN_SIGNING_MODE=azure`, `HAN_FLOW_AZURE_SIGNING_ENDPOINT`, `HAN_FLOW_AZURE_SIGNING_ACCOUNT`, `HAN_FLOW_AZURE_CERTIFICATE_PROFILE`, `HAN_FLOW_WIN_PUBLISHER_NAME` |

로컬에서는 같은 이름을 셸 세션 환경 변수로만 넣고 `.env`·저장소·로그에 남기지 않는다. PFX를 base64로 바꾸는 예:
PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`, Linux `base64 -w0 cert.pfx`.
Azure 방식은 electron-builder가 Windows에서 PowerShell `TrustedSigning` module(`Invoke-TrustedSigning`)을 쓰므로
Windows 러너에서만 동작한다.

### 인증서 선택지 (소유자 결정 필요)

가격·자격 조건은 자주 바뀌므로 구매 전 각 공식 페이지에서 다시 확인한다. 아래 금액은 2026-10 기준 대략치다.

| 선택지 | 대략 비용 | 장점 | 주의 | 현재 구현 |
| --- | --- | --- | --- | --- |
| Azure Trusted Signing(현 Artifact Signing) Basic | 월 약 US$10(연 약 US$120) + Azure 구독 | HSM 관리 불필요, CI에서 바로 서명, Microsoft 루트 | 공개 신뢰 인증서 자격(조직 이력·국가, 개인 개발자 허용 국가)이 제한됨 — 한국 개인 자격 여부를 먼저 확인 | `azure` 모드 |
| OV 코드 서명(Sectigo·DigiCert·SSL.com·Certum 등) + cloud HSM 서명(eSigner·KeyLocker·SimplySign 등) | 연 약 US$200–500, cloud 서명 사용료 별도 | 개인 이름 발급 가능(Certum 오픈소스용 등 저가 상품 있음) | 2023-06부터 새 인증서 개인키는 HSM·토큰에만 두어 PFX로 내보낼 수 없음. cloud 서명은 업체 도구를 부르는 custom `sign` hook이 필요 | 미구현(업체 확정 뒤 추가) |
| OV/EV + USB 하드웨어 토큰 | 연 약 US$300–700 | 로컬 Windows에서 서명 | GitHub hosted runner에서 쓸 수 없음. EV도 2024년부터 SmartScreen 평판을 즉시 주지 않아 OV보다 나은 점이 작음 | 로컬 `certificateSubjectName` 설정 필요(미구현) |
| 2023-06 이전 발급된 내보낼 수 있는 PFX | 보유 시 0 | 지금 설정으로 바로 사용 | 남은 유효 기간 확인 | `pfx` 모드 |

어떤 인증서든 처음에는 SmartScreen 평판이 쌓일 때까지 "알 수 없는 게시자"가 아닌 게시자 이름과 함께 경고가
보일 수 있다. 같은 게시자 이름으로 꾸준히 서명해 평판을 쌓는다.

### 자동화

- `npm run package:win:release`: 서명 재료 사전 검사 → `npm run build` → release 설정으로 NSIS 생성. 재료가 없으면
  빌드 전에 실패하고, 있어도 서명이 하나라도 실패하면 `forceCodeSigning`으로 실패한다.
- `npm run release:audit:win [-- <설치본.exe>] [-- --strict]`: release 설정(appId·forceCodeSigning·NSIS target·설치 방식·파일 연결),
  서명 환경 변수 이름, 설치본과 `win-unpacked/Han-Flow.exe`의 PE 구조·인증서 표·Authenticode 검증(Windows는
  `Get-AuthenticodeSignature`, 그 밖은 `osslsigncode verify`, 도구가 없으면 `unavailable`)·timestamp·버전 리소스·SHA-256을
  JSON으로 낸다. 서명자 이름은 출력하지 않고 `HAN_FLOW_WIN_PUBLISHER_NAME`과 같은지만 보인다. 서명이 없으면 `unsigned`로 보고한다.
- `.github/workflows/release-windows.yml`: 수동 실행(`workflow_dispatch`)과 `v*` tag push. `windows-release` environment의
  secret으로 사전 검사 → tag와 `package.json` version 일치 확인 → 의존성 설치 → test·typecheck·probe·corpus →
  서명 설치본 → strict 감사 → SHA-256(`SHA256SUMS.txt`) → 설치본·checksum·감사 결과를 30일 artifact로 올린다.
  secret이 없으면 첫 단계에서 이유를 남기고 실패하며 비서명 설치본을 만들지 않는다. GitHub Release 작성은 수동이다.

### 2026-10-20 Linux 검증

- release 설정을 `npx electron-builder --config scripts/build/electron-builder.win-release.cjs --win dir --x64 --publish never`로
  읽으면 `release/windows-release/win-unpacked`까지 만든 뒤 인증서가 없어 `forceCodeSigning` 오류로 실패한다(의도한 동작).
- 자체 서명 시험 PFX와 `USE_SYSTEM_OSSLSIGNCODE=true`로 서명 단계까지 진입함을 확인했다. 이 sandbox에서는 timestamp
  server(HTTP)에 닿지 못해 서명이 끝나지 않았고, NSIS 설치본은 Linux에서 wine이 필요해 만들지 못했다. 실제 서명·NSIS는
  Windows 러너에서 확인한다.
- `release:audit:win`을 Linux에서 만든 실제 `Han-Flow.exe`(PE32+ x64)에 실행해 비서명은 `unsigned`, osslsigncode 자체 서명본은
  서명자 있음·timestamp 없음·자체 서명 chain `invalid`, 버전 리소스 `Han-Flow`·FileVersion `1.0.0-rc.1`로 읽음을 확인했다.

### Windows 공개 배포 관문

- [x] 비서명 로컬·CI 경로와 분리된 release 설정(`forceCodeSigning`, timestamp, 별도 출력)
- [x] 서명 재료 사전 검사와 `release:audit:win`, release workflow와 SHA-256
- [ ] 인증서 종류 결정과 구매·발급, GitHub `windows-release` environment에 secret 등록
- [ ] release workflow에서 서명 설치본 생성, `release:audit:win -- --strict` 통과
- [ ] 깨끗한 Windows 11에서 설치본 속성의 디지털 서명·timestamp, SmartScreen 표시, 설치·첫 실행·제거 확인
- [ ] 설치 뒤 `.hwp`·`.hwpx` 연결(연결 프로그램 목록)과 비서명 설치본 위 덮어쓰기 설치 확인
- [ ] 설치본 SHA-256과 GitHub Release 초안 검토

Windows 참고 자료(2026-10-20 확인):

- electron-builder, [Windows Code Signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)
- electron-builder, [NSIS](https://www.electron.build/nsis.html)
- Electron, [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- Microsoft, [Trusted Signing 개요](https://learn.microsoft.com/azure/trusted-signing/overview)
- CA/Browser Forum, [Baseline Requirements for Code Signing Certificates](https://cabforum.org/working-groups/code-signing/requirements/)
- GitHub, [Using secrets in GitHub Actions](https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)

## macOS 공식 참고 자료

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
