# 다음 작업 (2026-10-18 기준)

기준 commit: `083f26c` 이후 main. 이 문서는 다음 작업 세션의 시작점이다.

## 1. 데스크톱(Windows)에서 먼저 할 일 — V3 완료 조건

클라우드·Linux 환경에서는 확인할 수 없는 항목이다. 결과는 아래 matrix 문서에 기록한다.

1. **한/글 재열기**: Han-Flow로 편집·저장한 HWPX를 한/글에서 다시 열어 손상·경고가 없는지 확인한다.
   기록: [V3 Windows 한/글 재열기 matrix](v3_windows_round_trip_matrix.md)
   - 최근 추가된 경로도 포함: 표 앞·뒤 입력, 각주·미주 본문, 머리말·꼬리말, 표 구조 편집(행·열 추가·삭제, 병합·분할)
2. **실제 한글 IME**: 일반 문단, 표 셀, 빈 표 셀, 각주, 머리말에서 조합 입력·Backspace·실행 취소.
3. **Windows 화면 배율** 125%·150%: 리본·상태 막대 잘림, caret 위치, 원본 위치 개체와 다단 위치.
4. **강제 종료 복구 실기**: 편집 → 작업 관리자로 종료 → 재실행 → [복구]/[버리기]/[나중에], 원본을 바꾼 뒤 거부.
5. **`npm test` 재실행**: Windows 일반 권한에서 링크·대소문자 관련 test가 통과하는지 확인한다.
6. **실제 문서 corpus**: 실제 한/글 문서를 30종 목표로 모아 비공개 corpus로 등록한다(`npm run corpus:intake`).

설치본은 최신 main의 Windows CI 실행 Artifacts(`han-flow-windows-installer`)에서 받는다.

### Codex QA 프롬프트 (그대로 붙여 넣기)

```text
너는 데스크톱 문서 편집기와 Electron 앱에 밝은 Windows QA 엔지니어야. Han-Flow(HWP/HWPX 뷰어·제한 편집기)를
설치 앱으로 검증해 줘. 코드는 고치지 마. 모든 주장에 로그·캡처·파일 경로 근거를 붙이고, 확인 못 한 건 "미확인"으로 적어.
보고서에 문서 본문은 옮기지 마.

- 저장소: main 최신(git pull, npm ci). 설치 앱은 최신 Windows CI 설치본.
- 체크리스트: docs/next_steps.md 1절의 1~6번.
- 한/글 재열기는 docs/v3_windows_round_trip_matrix.md 형식으로 채워 줘.
- 입력 지연: npm run benchmark:edit-latency 와 HAN_FLOW_EDIT_LATENCY_MODE=bold 수치를 남겨 줘.

출력: 항목별 통과/실패/미확인 표, 문제 목록(심각도·재현 절차·근거), "다음에 가장 먼저 할 일 3개".
```

## 2. 배포 (V4) — 결정 필요

### Windows 서명 설치본 — 인증서만 넣으면 되는 상태 (2026-10-20)

끝난 것([V4 배포 전략의 Windows 절](v4_release_strategy.md#windows-서명-배포-sprint-5)):

- `npm run package:win:release`: 비서명 설정을 이어받은 release 설정(`scripts/build/electron-builder.win-release.cjs`)으로
  `forceCodeSigning`·SHA-256·RFC 3161 timestamp 서명 NSIS를 `release/windows-release/`에 만든다. 서명 재료가 없으면 빌드 전에 실패.
- `npm run release:audit:win`: 서명(`valid`/`unsigned`/`invalid`)·timestamp·버전 리소스·appId·NSIS 설치 방식·`.hwp`/`.hwpx` 연결·SHA-256.
- `.github/workflows/release-windows.yml`: 수동 실행·`v*` tag. secret 없으면 첫 단계 실패, test 뒤 서명 빌드·strict 감사·`SHA256SUMS.txt`·artifact.
- 비서명 `package:win`·`package:win:installer`·`windows-ci.yml`은 그대로.

소유자가 할 일:

1. **인증서 종류 결정** — 비용은 2026-10 대략치, 구매 전 공식 페이지에서 재확인.
   - Azure Trusted Signing(현 Artifact Signing) Basic: 월 약 US$10. CI 친화적이고 HSM 관리가 없지만 공개 신뢰 자격(국가·조직/개인)이 제한되니
     한국 개인 자격부터 확인. 자격이 되면 1순위.
   - OV 코드 서명 + cloud HSM 서명(SSL.com eSigner·DigiCert KeyLocker·Certum SimplySign 등): 연 약 US$200–500 + 서명 사용료.
     2023-06 이후 새 인증서는 PFX로 내보낼 수 없어 업체 도구를 부르는 custom `sign` hook을 추가해야 한다(업체 정해지면 작업).
   - EV·USB 토큰: 더 비싸고 GitHub hosted runner에서 못 쓰며 2024년부터 SmartScreen 즉시 평판 이점도 없어 권하지 않음.
   - 이미 가진 내보낼 수 있는 PFX(2023-06 이전 발급)가 있으면 지금 `pfx` 모드로 바로 사용.
2. **secret 등록** — GitHub 저장소 Settings → Environments → `windows-release`(승인자 지정 권장).
   - `pfx`: secret `WIN_CSC_LINK`(PFX base64), `WIN_CSC_KEY_PASSWORD`; variable `HAN_FLOW_WIN_PUBLISHER_NAME`(선택).
   - `azure`: secret `AZURE_TENANT_ID`·`AZURE_CLIENT_ID`·`AZURE_CLIENT_SECRET`; variable `HAN_FLOW_WIN_SIGNING_MODE=azure`·
     `HAN_FLOW_AZURE_SIGNING_ENDPOINT`·`HAN_FLOW_AZURE_SIGNING_ACCOUNT`·`HAN_FLOW_AZURE_CERTIFICATE_PROFILE`·`HAN_FLOW_WIN_PUBLISHER_NAME`.
   - 저장소·`.env`·issue·로그에 값을 남기지 않는다.
3. **첫 서명 release** — Actions에서 `Release Windows`를 수동 실행 → artifact의 설치본을 깨끗한 Windows 11에서 디지털 서명 탭·
   SmartScreen·설치·`.hwp`/`.hwpx` 연결·제거 확인([릴리스 체크리스트](release_checklist.md#v4-windows-공개-배포-관문)).
   통과하면 `package.json` version에 맞춘 `v<version>` tag를 push하고 GitHub Release는 수동으로 작성.

### 그 밖

- macOS: Mac 하드웨어와 Apple Developer ID 필요(arm64 서명·공증) — [V4 배포 전략](v4_release_strategy.md)
- 자동 업데이트는 서명된 수동 배포가 안정된 뒤

## 3. 화면 정확도·편집 범위 (여기서도 가능, 실제 문서에서 보이는 순서로)

1. ~~표를 셀 선언 높이로 그리기~~ — 완료(2026-10-20): 선언 높이를 최소 높이로 그림. doc2 1쪽 빨간 타원이 표 안 작성자 줄을 감쌈
2. ~~글 옆 배치(SQUARE·TIGHT)의 쪽 기준 띠 부분 채움과 흐름 쪽~~ — 완료(2026-10-20): `textFlow`대로 흐를 쪽, 한 단 구역의 쪽 기준 글 옆
   배치는 개체 쪽만 비우고 글이 닿을 때만 띠를 씀. 남은 것: `TIGHT` 윤곽선 감싸기·`THROUGH`, 다단 구역의 글 옆 배치(띠 폭 전체),
   문단 기준 개체 아래 다음 문단의 개체 옆 흐름. 양쪽 흐름(`BOTH_SIDES`)은 검토 뒤 보류(2026-10-20): CSS 줄 상자는 float 사이 빈 곳 하나에만
   놓이고 Chromium에 CSS Exclusions가 없어, 줄을 JS로 직접 나눠 그려야 함(편집 입력 칸·PDF 글자 순서·측정 DOM을 함께 바꿔야 함)
3. ~~표 셀·글상자·머리말 안 개체의 원본 위치 배치~~ — 완료(2026-10-20). 남은 것: 머리말 개체의 본문 자리 비우기, 각주 안 개체
4. ~~쪽 번호·머리말·꼬리말을 본문 밖 여백 띠에, 개체 회전·대칭·쌓임 순서~~ — 완료(2026-10-20): 쪽 본문을 한/글 본문 영역(위쪽 + 머리말
   여백 ~ 아래쪽 + 꼬리말 여백)으로 바꾸고 쪽 번호는 꼬리말 띠 아래 끝(doc5-d04 1쪽 쪽 번호가 로고와 겹치던 문제), 줄 높이 바탕 글자·셀
   반 줄 간격·표 문단 줄 간격으로 쪽 수 유지. 남은 것: 겹침 허용 안 함(`allowOverlap="0"`) 자리 밀기, 그림 `rotateimage="0"`, 구역마다
   다른 쪽 크기·여백, 호·곡선·묶음 도형, 그림 자르기, 고정·여백 줄 간격 종류
5. ~~본문을 줄 단위로 쪽 나누기~~ — 완료(2026-10-20): 글자 run만 든 문단, 외톨이줄 보호·문단 보호·다음 문단과 함께·문단 앞 쪽 나눔,
   편집 중 앞 조각 입력. 남은 것: 그림·표·각주 번호·필드가 든 문단의 줄 단위 나눔(각주 번호 줄만 넘기기 포함), 쪽 기준 개체 띠 옆 줄 나눔,
   너비가 다른 단의 줄 나눔, 다단 구역 `keepWithNext`, 편집 중 나뉜 문단 뒤쪽 줄 caret(지금은 앞 조각 안에서 밀려 보임)
6. ~~다단 높이 맞춤을 줄 단위로~~ — 완료(2026-10-20, 단 너비가 같은 다단). 남은 것: 너비가 다른 다단, 평행 다단 정확도
7. 편집 범위: 글상자·메모 안 글, 각주 만들기·지우기, 각주·머리말의 글자·문단 모양과 Enter

## 최근 완료 (2026-10-11 ~ 10-18)

- 편집 worker 격리, 증분 projection, 비정상 종료 복구와 그 보강(경쟁 조건·replay 검증·한도 알림·header만 읽는 검색·보관 기한)
- IPC 보낸 쪽 검사, 큰 표 실행 취소 기록 축소(459KB→수 KB)
- 표 앞·뒤 입력, 각주·미주·머리말·꼬리말 편집과 반복 머리말 방향 키 수정
- 각주를 쪽 아래에 배치, 원본 위치 개체, 다단 조판(RIGHT·MIRROR·서로 다른 너비·구분선)
- 모양 편집의 section 단위 재측정(측정 p50 약 380→39ms), 기호 글꼴 사설 영역 표시, PDF 사설 영역 손실 검사
