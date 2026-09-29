# Han-Flow 개발·검증 이력

기준일: 2026-09-28

이 문서는 2026-09-28에 과거 개발 일지(2026-06 prototype·2026-09 작업 일지)와 실행 계획(milestone
체크리스트)을 통합한 단일 이력이다. 날짜별로 커밋 제목, 검증한 내용과 남은 관문만 기록하며 최신
항목이 위에 온다. 설계 판단의 세부 근거는 연결된 전략·기준선·ADR 문서에 둔다.

기록 규칙:

- 실사용 문서는 저장소 밖에 두고 파일명 외 본문·캡처·생성 PDF는 커밋하지 않는다. 자동화 로그도
  페이지 수, 구조 count, 비공백 문자 수, 시간·메모리와 안정적 오류 코드만 남긴다.
- 공개 synthetic fixture는 생성 코드와 SHA-256 manifest를 함께 커밋한다.
- 현재 commit에서 재현할 수 없는 수치(과거 Mac, private 문서)는 아래 별도 절에 두고 현재 상태로
  인용하지 않는다([장기 로드맵 §2](long_term_roadmap.md#2-완료-판정-방식)).
- 현재 git 이력은 재임포트된 것이며 root commit은 `8364d36`(2026-08-02)이다. 그 이전 항목의 commit
  hash는 현재 저장소에 없으므로 "(재임포트 이전 이력, hash 미상)"으로 표시한다.

## 현재 재현 가능한 결과

로컬 수치는 HEAD `c7a999c`를 Linux·Node.js 22.22.2에서 실행한 값이다. CI 수치는 마지막으로 완료된
`492dd02`(2026-09-28) run이며 HEAD run은 작성 시점에 진행 중이었다.

| 관문 | 명령·환경 | 결과 |
| --- | --- | --- |
| Jest | `npm test -- --runInBand` | 43 suites passed·2 skipped, 292 passed·12 skipped |
| parser probe | `npm run test:probe` | 18 passed |
| 공개 HWPX corpus | `npm run verify:corpus` | 9/9(거부 기대 1종 포함), 111,424 bytes, 88 sections, 7 tables, 29 cells, 15 resources, 다단 section 1, core 추정 2,512쪽, 외부 file fixture 0 |
| Windows CI | `windows-latest` run 47 | test·typecheck·probe·corpus·build·`package:win`, 패키지 앱 HWPX matrix·HWP matrix·HWP PDF, 비서명 NSIS와 unpacked artifact 업로드 통과 |
| Linux CI | `ubuntu-latest`·xvfb run 3 | 같은 자동 관문과 `package:linux`, 패키지 앱 E2E 3종, unpacked artifact 업로드 통과 |
| macOS CI | 없음 | Apple Silicon 하드웨어 확보 후 수동 관문으로 진행 |

Linux CI 패키지 앱 E2E 세부:

| fixture | 결과 |
| --- | --- |
| baseline | 3쪽, 이미지 4개, overflow 0 |
| cell-continuation | 2쪽, overflow 0 |
| images-rowspan | 1쪽, 이미지 12개, overflow 0 |
| multi-column-layout | 1쪽, 단 2개, 본문 17·43자 |
| large-progressive | 15,003쪽 중 DOM 12개 mount (Noto CJK 글꼴 기준) |
| invalid-package | crash 없는 사용자 오류 |
| HWP `synthetic-layout` | 5.0.3.2, 2쪽, 표 1·셀 9·이미지 1, 반복 머리말 2회, 결정적 생성, 오류 5종 |
| HWP PDF | 2쪽 A4, 텍스트 보존 98.6% |

대형 문서의 페이지 수는 대체 글꼴 metric에 따라 달라진다(Linux 15,003쪽, 로컬 Windows 19,503쪽,
V1 당시 macOS 9,767쪽). 판정 기준은 DOM mount 12개와 overflow 0이다.

## 남은 수동·외부 관문

| 관문 | 소속 | 상태 |
| --- | --- | --- |
| Windows 한/글 WIN-01~10 재열기와 한/글 재저장 후 역재개봉 | V3 / Sprint 1 | 한/글 미설치로 대기 |
| 실제 Mac 물리 두벌식 입력 matrix | V3 / Sprint 1 | Mac 하드웨어 대기 |
| Windows 실기의 Ctrl 단축키·맑은 고딕 대체·exFAT Save As | Sprint 5 | 자동 테스트 기준만 통과 |
| 실제 한/글 HWPX 외부 fixture 20종 | Sprint 4 | intake 계약 완료, 반입 0종 |
| 개인정보 없는 공개 corpus 30–50종 | Sprint 4 | HWPX 9종·HWP 1종 |
| Windows code signing·설치·제거·DPI | Sprint 5 | 비서명 NSIS만 존재 |
| macOS 13+ 실행, Developer ID 서명·공증·Gatekeeper | Sprint 6 | Mac 하드웨어·인증서 대기 |

## 과거 macOS 측정 (2026-07~08, 현재 재현 불가)

아래 수치는 당시 로컬 Apple Silicon Mac과 macOS 패키지 앱에서 측정했다. 해당 Mac이 고장 나 현재
commit(Electron 44)에서 다시 측정할 수 없으므로 회귀 기준의 역사 기록으로만 사용한다.

| 검증 | 결과 | 시점 |
| --- | --- | --- |
| HWP cold open 20회(Worker 격리 후) | p50 535ms / p95 614ms / max 722ms | 2026-07 V2 |
| HWP warm open 20회 | p50 203ms / p95 237ms | 2026-07 V2 |
| aggregate working set peak p95 | HWP 647.6MiB, HWPX 438.3MiB | 2026-07 V2 |
| private HWP 앱·PDF | 7쪽, 3개 구역 혼합 용지, overflow 0, PDF 텍스트 99.08% | 2026-07-27 |
| private HWPX(AIDA) | 8쪽, 이미지 4개, overflow 0, 화면/PDF 문자 수 일치 | 2026-07-23~29 |
| 80-section synthetic | 9,767쪽 중 DOM 12개 mount | 2026-07 |
| 실제 두벌식 OS-level key matrix | 7 시나리오 통과(아래 2026-08-02) | 2026-08-02 |
| arm64 / x64 / Universal package 실험 | 339.6 / 345.1 / 525.3 MB, smoke 통과 | 2026-08-09 |
| Finder 열기·pinch zoom·dark chrome | V1 RC production 확인 | 2026-07-23 |

로컬 Windows(10.0.26200 x64) 수동 실행 결과도 CI 재현 대상이 아니므로 구분한다. 2026-09-07 표 구조
production E2E와 2026-09-08·13 production matrix(대형 문서 19,503쪽 중 DOM 12개)는 아래 해당 날짜에
기록했다.

## 2026-09-28 — Windows·Linux 기준선 전환

커밋: `31cbb08` Windows Ctrl 단축키와 네이티브 undo 차단 구현 · `8e997fc` Windows·Linux 기본 메뉴 제거로
단축키 중복 실행 방지 · `21d60bc` Windows 글꼴 대체 체인과 한/영 family alias 추가 · `4682f7c` ZIP 압축
해제 상한과 decoder worker 자원 제한 추가 · `8457c4c` Save As를 rename 기반 원자적 게시로 전환하고
덮어쓰기 정책 정리 · `ffcf0a0` Electron 28에서 44로 업그레이드하고 breaking change 감사 · `0b4adb3` 실제
한/글 fixture intake 계약과 확보 계획 추가 · `5c03893` Linux 패키지 target과 headless E2E CI job 추가 ·
`6206f03` Windows NSIS 설치본과 CI artifact 추가 · `492dd02` 저장 덮어쓰기 보장 복원과 worker 한도·플랫폼
고지 정리 · `c7a999c` 창별 열기 경로 전달과 renderer 경로 허용목록 추가

- 단축키: macOS는 ⌘, Windows·Linux는 Ctrl(Ctrl+Y redo 추가, AltGr·Win 조합 무시). contentEditable의
  `historyUndo`·`historyRedo`는 앱 transaction history로 보낸다. Windows·Linux는 기본 메뉴를 제거했다.
- 글꼴: platform별 대체 체인(Windows 맑은 고딕·바탕, macOS Apple 글꼴, Linux Noto)과 한/영 family
  alias, 미설치 시 CSS generic family.
- 자원 한도: ZIP entry를 선언 크기·절대 상한으로 스트리밍 중 차단하고, 크기와 무관하게 모든 HWPX
  디코딩을 heap 1024MB·120초 한도의 decoder worker에서 실행한다.
- Save As: 교체 확인이 없으면 hard link(EEXIST)로 원자 게시, 교체 확인 시 rename, hard link 미지원
  파일 시스템에서만 재확인 후 rename. 원본과 열린 session 원본은 경로·inode로 항상 보호한다.
- Electron 44: `File.path` → `webUtils.getPathForFile`, 대화상자 마지막 폴더 기억, macOS
  `minimumSystemVersion` 13.0.
- corpus에 sha256·출처·라이선스를 요구하는 `source: file` intake 계약 추가(반입 0종).
- CI: Linux(package·xvfb E2E·artifact), Windows(package E2E·Poppler·비서명 NSIS·artifact).
- 보안: 창별 허용목록 밖의 경로는 `document:import`·`editing:start`에서 `DOCUMENT_PATH_NOT_ALLOWED`.

검증: 위 "현재 재현 가능한 결과". 남은 것: Windows 실기(단축키·글꼴·exFAT Save As), macOS 13+ 실행,
외부 fixture 반입.

## 2026-09-13 — 동일 너비 다단 흐름 조판과 문서 정리

커밋: `9e3d238` 동일 너비 다단 흐름 조판 구현 · `72a79a1` 현재 개발 상태 문서 정리

`hp:p columnBreak`를 보존하고 동일 너비 `NEWSPAPER/LEFT`를 왼쪽 단→오른쪽 단→다음 페이지로 배치했다.
실측 layer는 `(본문 폭 - 전체 간격) / 단 수`로 다시 측정한다. `PARALLEL`·`RIGHT`·`MIRROR`·비동일 너비는
fallback diagnostic을 유지한다. 첫 시도에서 지나치게 좁은 synthetic 용지의 실제 overflow를 발견해
단 폭 실측과 현실적인 fixture 폭으로 수정했다.

검증: corpus 9/9, 111,424 bytes, 추정 2,512쪽, 독립 report SHA-256
`10A806F944CFF272584AD3CFF260E5165CE2AE695AFBC42BC51828C2500F8A79` 일치. 로컬 Windows x64 production
matrix 6종 통과(2단 DOM 1쪽·17/43자·overflow 0). 당시 Jest 37 suites·228 passed, probe 14.
남은 것: `RIGHT`·`MIRROR`·비동일 너비 다단, 각주·미주·수식 모델.

## 2026-09-08 — 공개 HWPX corpus와 fixture catalog

커밋: `ff32a9e` 공개 HWPX 코퍼스 자동화 기반 구축 · `0f14a39` 공개 fixture 카탈로그와 Windows HWP 검증
연결 · `09f2485` 목록 구조 공개 코퍼스 확장 · `89f49c5` 다단 레이아웃 읽기 전용 모델 추가

- `verify:corpus`: manifest schema(허용 generator, 중복 ID, 기대값)를 fixture 생성 전에 검증하고
  본문 없는 결정적 JSON report를 만든다. ZIP timestamp를 제외한 content fingerprint를 사용한다.
- `fixture_catalog.json`: HWPX core·production DOM·HWP pipeline을 같은 fixture ID로 선택한다.
- Windows에서 드러난 Electron shim·ESM file URL·기본 앱 경로 문제를 수정하고 HWP 이미지를 고정 PNG
  bytes로 바꿔 생성 결정성(6,656 bytes, SHA-256
  `2400FCEE7AA03235870701AEEA044D084A652BDFB60EFA52264F1774D8725317`)을 복구했다.
- `list-markers`(글머리표 2·DIGIT 번호 2)와 `multi-column-layout` fixture, `ViewerSection.columnLayout`.

| 단계 | corpus | 독립 report SHA-256 |
| --- | --- | --- |
| 자동화 기반 | 7/7, 86 sections, 추정 2,509쪽 | `A7D91650EBD73ABC84CAA299FE9634233C4B2901BC2B536012D66B5E5BF13FD4` |
| 목록 확장 | 8/8, 109,893 bytes, marker 13 | `85F82D921D2EB273D41E7E0208CAB155D51C8261B0BD8698B87D492162AFEB55` |
| 다단 모델 | 9/9, 111,302 bytes, diagnostic 1 | `7D33EC615F203271AE1E34C8D230C1A3D9F029592C17C7FC28C83EDE18F314FF` |

검증: 로컬 Windows production matrix 5종(대형 19,503쪽 중 DOM 12), HWP matrix(2쪽·PDF 98.6%·오류
5종), probe 11. 다단·각주·수식은 구조 모델 없이 열기 성공만으로 보존을 주장하지 않았다.

## 2026-09-07 — Windows 표 구조 승인 번들

커밋: `24f523c` Windows 표 구조 승인 번들 확장

로컬 Windows 10.0.26200 x64의 `Han-Flow.exe` 리본으로 3×3 fixture의 행·열 추가/삭제, 오른쪽 1×2
병합과 분할, 각 undo/redo, Save As, 새 session 재개봉을 자동 실행했다. 결과 3행×3열, 행별 cell
3·3·3, 모든 `colSpan=1`, 1쪽·overflow 0, 원본 hash 불변. 승인 bundle에 구조 편집 전·후 HWPX와
WIN-09~10을 추가했고 PowerShell 무결성 검사에서 일곱 HWPX가 통과했다. 이 E2E는 CI에 없다.
남은 것: 한/글 복구 경고와 역재개봉.

## 2026-09-05 — 표 열 편집과 제한적 병합·분할

커밋: `a17273a` 안전한 표 열 추가 기반 구현 · `2f3739b` 표 열 삭제와 선택 재배치 구현 · `a4a4eeb` 표 셀
병합과 분할 안전 정책 설계 · `3c43f35` 제한된 오른쪽 표 셀 병합 구현 · `a61c2e3` 병합 표 셀 선택 기반
구현 · `7fb423d` 제한된 수평 표 셀 분할 구현

- 열 추가·삭제: 모든 direct row와 반복 머리글을 함께 바꾸고 `colCnt`·뒤쪽 `colAddr`·표 너비를
  원자적으로 갱신한다. 앞선 행의 text 수로 selection ordinal을 이동하고, 삭제 시 살아남은 anchor를
  inverse locator로 쓴다. 마지막 하나뿐인 열·불균일 너비·병합·span은 fail-closed.
- 병합 정책([표 셀 병합·분할 전략](table_merge_split_strategy.md)): 현재 body cell과 오른쪽 cell의
  수평 1×2만, 모양·높이·여백·세로 정렬이 같을 때, 오른쪽 문단은 왼쪽 뒤에 원래 순서로 보존.
- `TableCellSelection`: 읽기 전용 병합 cell을 click·Enter·Space로 선택하고 text caret과 상호 배타적으로
  둔다. 재투영·undo·파일 교체에서 stale selection을 해제한다.
- 분할: `textNodeId` ancestry·주소·`colSpan=2`를 재검증하고 다른 unmerged 행의 일관된 두 열 너비가
  있을 때만 허용한다.

검증: 각 slice마다 typecheck, Jest(36 suites·210 → 37 suites·223 passed), build, probe 8. 모두 exact
undo/redo, `table-structure` loss policy, Save As·재개봉 포함.

## 2026-09-04 — 표 셀 문단·모양과 행 편집

커밋: `f804969` 여러 문단 표 셀 독립 편집 기반 구현 · `ffc759a` 표 셀 문단 범위와 구조 편집 구현 ·
`cf1280d` 표 셀 테두리와 배경 편집 기반 구현 · `a36fbe8` 안전한 표 행 추가 기반 구현 · `fd9ac93` 표 행
삭제와 선택 재배치 구현 · `66c7870` 문서 최신화와 표 열 편집 계획 정리

- 일반 body cell의 모든 문단이 단일 text run이면 cell별 range scope를 공유하고, 같은 cell 안에서
  문단 횡단 치환·Enter 분할·경계 병합을 허용한다. core는 `hp:tc > hp:subList` 경계를 재검증한다.
- 셀 테두리·배경: 기존 `borderFill`을 새 ID로 복제해 선택 셀 reference만 바꾼다.
- 행 추가·삭제: 단순 직사각형 topology만, `rowCnt`·뒤쪽 `rowAddr`·표 높이 갱신. 삭제 후 다음(마지막이면
  이전) body 행으로 selection 재배치. 반복 머리글과 마지막 body 행은 보호.

검증: Jest 34 suites·196 → 36 suites·206 passed, build, probe 8, main session undo/redo·Save As·재개봉.

## 2026-09-01 — Sprint 2 마무리와 Sprint 3 착수

커밋: `88c9159` 편집 오류 계약과 기능 판정 1차 구현 · `3d59282` 구조별 편집 판정과 선택 복구 구현 ·
`4355cd5` 편집 트랜잭션 원자성과 저장 리비전 강화 · `d82722a` 구조별 저장 손실 정책과 사용자 안내 연결 ·
`c5e31e3` 렌더러 상태 소유권과 IME 임시 상태 분리 · `34806d5` 렌더러 셸과 편집 리본 화면 책임 분할 ·
`4e33346` 기존 문서 글꼴 재사용 편집 기반 구현 · `5635f81` 문단 모양과 탭 목록 구조 보존 강화

- 편집 IPC 오류 envelope(conflict, unsupported, invalid request, not applicable, session expired, history
  limit, save failure, internal)와 복구 정책. 내부 오류 원문·경로는 renderer에 보내지 않는다.
- selection별 구조 capability와 stale selection 복구(UTF-16 경계 보정, collapse, 해제, `editing:refresh`).
- `commitSynchronized`: 중간 command·history limit 실패 시 package·selection·stack·dirty 불변. 현재
  `revision`과 `savedRevision` 분리.
- `HwpxSaveLossPolicy`: 구조 kind(text·글자·문단 모양·문단 구조), Preview `current/stale/omitted`.
- renderer를 document·viewer·editing reducer와 ref 기반 IME transient state로 분리하고
  `ViewerToolbar`·`ViewerStage`·`ViewerPageStack`·`ViewerStatusBar`로 분할.
- 문서 HANGUL font-face에 선언된 ID만 재사용하는 글꼴 편집. 문단 모양 변경 시 `tabPrIDRef`·`hh:heading`
  불변식 검증.

검증: Jest 30 suites·167 → 34 suites·189 passed, typecheck, build, probe 8.

## 2026-08-22 — 여러 문단 범위와 공통 편집 host

커밋: `b69326e` 문단 경계 Backspace Delete 병합 구현 · `8566a5c` 여러 문단 범위 구조 치환 코어 구현 ·
`e9160b7` 여러 문단 공통 편집 호스트 연결

문단 시작 Backspace·끝 Delete를 앞 문단 모양과 양쪽 run을 보존하는 merge command로 연결했다. 여러
최상위 문단 selection을 fragment command 하나로 치환하고 stale `hp:linesegarray`를 제거한다. 공통
paragraph host에서 pointer drag와 Shift+방향키 selection이 여러 run·문단을 넘으며 표 셀은 고유
scope로 격리한다. 검증: Jest 26 suites·151 → 27 suites·155 passed, build, probe 8, 치환 → undo →
redo → Save As → 재개봉. 남은 것: 물리 두벌식 여러 문단 조합.

## 2026-08-21 — Sprint 0 완료와 편집 구조 입력

커밋: `c00e110` TypeScript 검증 관문과 타입 안정성 추가 · `fa64a1a` 기능 브랜치 Windows CI 실행 활성화 ·
`9215b24` HWPX 리소스 고갈 방어 추가 · `9ebf807` 미사용 레거시 편집 코드 제거 · `dc4de23` Windows 편집
승인 번들 자동화 · `40efe28` 다중 run 선택 모델 기반 추가 · `01df629` 다중 run 범위 치환 기반 구현 ·
`242207c` HWPX 줄 나눔 편집 기반 구현 · `8306ca5` 최상위 문단 Enter 분할 구현

- 독립 `typecheck` 관문. XML 깊이 256·node 1,000,000·text 50,000,000자·DOCTYPE 금지, 이미지 2,000개·
  개별 32 MiB·전체 192 MiB·한 변 32,768px·pixel 상한. XML depth·PNG dimension 폭탄은
  `HWPX_IMPORT_FAILED`.
- legacy source 5개와 dependency 4종 제거([legacy inventory](legacy_inventory.md)).
- 로컬 Windows x64 `dir` package(279,556,778 bytes)에서 일반 문단·표 cell·style·undo/redo·Save As·
  dirty 저장/버리기 자동 검증과 bundle 무결성 통과.
- anchor/focus selection domain, multi-run 치환, `hp:lineBreak`·`hp:tab` anchor와 Shift+Enter,
  최상위 문단 Enter split.

검증: clean Windows CI(`fa64a1a`) install·test·typecheck·probe 8·build, Jest 23 suites·133 passed·11
skipped, production audit 0. 남은 것: WIN-01~08 한/글 판정.

## 2026-08-20 — Windows 개발 기준선

커밋: `7eb625a` Windows 개발 기준선과 문서 보안 경계 강화

Windows를 주 개발 환경으로 정하고 Node.js 22·npm 10 계약과 Windows CI를 추가했다. HWPX read-only와
editing 경로가 같은 ZIP metadata preflight를 쓰고 renderer sandbox와 HTTPS-only navigation을 적용했다.
미사용 `electron-updater` 제거와 `adm-zip`·`fast-xml-parser`·`unzipper` 갱신으로 production audit
4건 → 0건. 검증: Jest 22 suites·122 passed, probe 8, build.

## 2026-08-09 — Windows 한/글 bundle과 V4-0 배포 기준선

커밋: `87253b7` Windows 한글 호환성 검증 번들 추가 · `247969f` HWPX 컨테이너 해시 판정 명확화 ·
`9e81f6d` macOS 배포 준비 기준선 감사 추가 · `81343be` macOS arm64 배포 타깃 확정

- `npm run fixture:v3-windows`: identity·일반 문단 편집본·표 cell 편집본·A4 문서와 SHA-256 manifest,
  PowerShell 검사, WIN-01~08 양식. 이는 한/글 호환성 통과가 아니라 실기 입력 준비 완료다.
- `npm run release:audit`: 당시 app은 arm64 `dir`, ad-hoc 서명, Team ID 없음. 공개 배포 차단 유지.
- x64·Universal 무인증서 실험 뒤 Apple의 Rosetta 종료 일정을 근거로 공개 target을 arm64-only로 확정
  ([V4 배포 전략](v4_release_strategy.md)).

## 2026-08-02 — V3-6 편집 UX와 실제 두벌식 matrix

커밋: `8364d36` V3 한글 입력 검증 결과 문서화 · `fb4602e` macOS 한글 입력 확장 매트릭스 추가 ·
`3728945` A4 편집 문서와 홈 리본 추가 · `4043056` 기울임 밑줄 취소선 편집 추가 · `2c3895e` 문단 줄
간격과 앞뒤 간격 편집 추가 · `2b4b81a` 첫 줄 들여쓰기와 내어쓰기 편집 추가

- 실제 두벌식 commit 뒤 focus 유실 결함(재클릭 없는 후속 입력 event 0개)을 발견해 두 animation frame
  뒤 focus·selection 복원과 450ms 음절 burst로 수정했다.
- `npm run verify:ime:mac:matrix` 7 시나리오: 문단·표 셀 기본 입력, 조합 중 Backspace·Escape, 양방향
  범위 치환, 실제 `⌘Z`·`⇧⌘Z`. 연속 실행 중 앱 전면화 경쟁을 찾아 probe를 보강했다.
- A4 `59528 × 84189 HWPUNIT` 편집 fixture와 2단 `홈` 리본(최소 버튼 40px). 짧은 입력의 selection
  복원 경쟁을 restore token으로 제거했다.
- 기울임·밑줄·취소선, 줄 간격 100–300%·문단 앞뒤 0–72pt, 첫 줄 −72–72pt.

검증(macOS arm64): Jest 22 suites·113 → 119 passed, unsigned `.app`, packaged A4 적용·Save As·재열기.
남은 것: 사용자 손 입력 matrix([수동 matrix](v3_ime_manual_matrix.md)).

## 2026-07-29~30 — V3-1~V3-5 편집 코어 (재임포트 이전 이력, hash 미상)

- V3-1 `HwpxSourcePackage`: 모든 ZIP entry의 순서·bytes·compression·CRC 보존, 과거 손실성 serializer와
  저장 IPC 제거. identity round-trip의 entry metadata·SHA-256 일치(Jest 17 suites·75).
- V3-2 `ReplaceTextCommand`와 검증형 Save As 코어(Jest 18 suites·81).
- V3-3 `EditTransaction`·bounded history(100 entries·8 MiB)·savepoint(Jest 19 suites·89).
- V3-4 main-process 편집 session, `plaintext-only` IME surface, selection·re-pagination 복원, Save As UI,
  dirty 교체·종료 보호. 승인된 두 번째 close가 막혀 프로세스가 남던 결함 수정(Jest 21 suites·99).
- V3-5 부분 selection 글자·문단 style, 표 body cell text, 여러 run surface, 글자 크기·색상(Jest 22
  suites·112).

검증은 macOS 패키지 앱과 private HWPX(8쪽·이미지 4·overflow 0), 공개 matrix 5종(최대 9,767쪽·DOM 12).
style과 Save As를 한 프로세스에서 연속 실행하는 probe의 간헐적 대기 초과는 기능 실패와 구분해 기록했다.

## 2026-07-27 — V2 HWP 5.0 읽기 완료 (재임포트 이전 이력, hash 미상)

관련 구현(원래 hash는 현재 저장소에 없으며 날짜는 2026-07-27):

- (재임포트 이전 이력, hash 미상) `문서 가져오기 IPC 경계 통합`
- (재임포트 이전 이력, hash 미상) `HWP 지원 불가 문서 오류 분류 추가`
- (재임포트 이전 이력, hash 미상) `공개 HWP 회귀 매트릭스 추가`
- (재임포트 이전 이력, hash 미상) `HWP PDF 마지막 페이지 출력 대기 보강`
- (재임포트 이전 이력, hash 미상) `V2 공개 HWP 검증 현황 문서화`

format-neutral `DocumentImporter`와 `document:import` IPC, HWP 200 MiB·CFB·`FileHeader`·5.x preflight,
`HWP_ENCRYPTED`·`HWP_DISTRIBUTION`·`HWP_DRM`·`HWP_UNSUPPORTED_VERSION`·`HWP_CORRUPTED` 오류 UX, rhwp 전용
Web Worker(open 30초·page 15초)를 완료했다. 공개 `synthetic-layout.hwp`(5.0.3.2, 12,800 bytes, SHA-256
`b665933da10ec276e8e21ddb1c9e6d2eec5440c9ac5d1bda9e5bc478bd136b9e`)는 kordoc 구조 oracle과 rhwp 렌더를 교차 검증한다. 실사용 HWP 재검증에서 마지막
쪽 SVG decode 전에 인쇄가 시작되는 race를 발견해 모든 이미지 `naturalWidth > 0`까지 기다리도록 수정했다.
연속 E2E의 `Session Storage` 늦은 종료로 인한 임시 폴더 삭제 실패는 제한 재시도로 분리했다.

검증(macOS arm64, Electron 28.3.3): Jest 16 suites·62 passed, probe 8, HWP matrix(2쪽·PDF 98.6%·오류
5종), HWPX matrix 5종, notices 일치. parser 역할은 [ADR-0001](adr/0001-hwp-parser-roles.md),
bake-off 경과는 [HWP parser bake-off](hwp_v2_bakeoff.md)에 있다.

## 2026-07-23 — V1 HWPX Release Candidate (재임포트 이전 이력, hash 미상)

상세 근거는 [V1 기준선](v1_baseline.md)과 [Release Candidate 체크리스트](release_checklist.md)에 있다.
실사용 HWPX의 페이지·이미지 보존과 overflow 0, 화면/PDF 페이지별 비공백 문자 수 일치, 15문단 cell
continuation(8+7), 80-section 9,767쪽 중 DOM 12개, 이미지 12개·`rowSpan=2`, 손상 HWPX 오류 UX,
Finder 열기·single-instance·drag-and-drop·pinch zoom·dark chrome·PDF를 확인했다.

## 2026-06 — 초기 prototype (재임포트 이전 이력, hash 미상)

2026-06-06~08에 `parser.ts`·`normalization.ts`·문자열 `renderer-engine`, Zustand store 기반
`contentEditable` 편집기, 리본 UI와 JSON → OWPML serializer를 빠르게 만들었다. 이 serializer는 unknown
XML·package entry를 잃고 잘못된 mimetype을 기록했으며 ZIP·resource 상한도 없었다. V3-0 감사에서 재사용하지
않기로 했고 2026-07~08에 모두 제거했다. 당시의 "완성" 표현은 현재 제품 계약이 아니다.

## 포트폴리오 근거 사용 원칙

- 속도는 OS·architecture·cold/warm·표본 수와 함께 인용하고, 과거 macOS 수치임을 밝힌다.
- 대형 문서는 페이지 수가 아니라 "수천~수만 쪽에서 DOM 12개 mount, overflow 0"으로 설명한다.
- PDF 안정성은 화면/PDF page size·문자 보존율과 실제로 발견해 고친 마지막 페이지 race로 설명한다.
- 안전한 열기는 main preflight, Worker timeout·취소, ZIP·XML·이미지 상한, 경로 허용목록과 오류 코드로
  설명한다.
- "테스트가 있다"보다 private 실문서와 공개 결정적 fixture를 함께 쓰고 결과에서 개인정보를 제거한
  설계를 설명한다.
