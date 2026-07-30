# Han-Flow 검증 이력

이 문서는 구현 완료 주장에 대응하는 재현 명령, 입력 범위, 정량 결과와 발견한 결함을 날짜별로
기록한다. 포트폴리오와 릴리스 회고에서는 이 문서를 요약 자료로 사용하고, 세부 설계 판단은
연결된 기준선·bake-off·ADR을 근거로 사용한다.

실사용 문서는 저장소 밖에 두며 파일명 외 본문·캡처·생성 PDF는 커밋하지 않는다. 자동화 로그도
페이지 수, 구조 count, 비공백 문자 수, 시간·메모리와 안정적 오류 코드만 남긴다. 공개
synthetic fixture는 생성 코드와 SHA-256 manifest를 함께 커밋한다.

## 2026-07-30 — V3-5B 표 body cell text 편집

기존 text source anchor와 transaction을 일반 표 body cell의 단일 문단·단일 run까지
연결했다. pagination 과정에서 동일 source anchor가 복제될 수 있는 반복 머리글과
continuation fragment, 구조 변경 위험이 큰 병합·`rowSpan`·여러 문단 cell은 입력 surface를
열지 않는다. 표 셀은 text 입력만 지원하며 style toolbar 범위에는 포함하지 않는다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 109 passed, 1 suite skipped |
| main session | `tests/main/editing_session.test.ts` | body cell commit·selection·undo/redo 통과 |
| renderer eligibility | `tests/renderer/measurement.test.ts` | 일반 cell 허용, 반복·병합·fragment 차단 통과 |
| production build/package | `npm run package:mac` | main·preload·renderer, arm64 unsigned `.app` 성공 |
| 공개 baseline cell | `npm run verify:matrix` | 범위 편집·undo/redo·Save As, 저장본 3쪽·이미지 4개 |
| 공개 구조 회귀 | 같은 matrix | continuation 2쪽, 병합/rowSpan 이미지 12개, overflow 0 |
| 공개 대형 회귀 | 같은 matrix | 9,767쪽·DOM 12개·overflow 0 |

공개 packaged probe는 원본 SHA-256 불변, projection 뒤 selection, undo/redo selection과
dirty 해제를 확인했다. fixture에는 Preview entry가 없어 저장 상태가 `Preview 없음`으로
표시되는 경로도 검증했다. 본문·캡처·저장본은 커밋하지 않았다.

## 2026-07-29 — V3-5 부분 selection 문단·글자 style

최상위 일반 문단의 단일 `hp:t` source anchor에서 실제 run과 paragraph를 찾고, 원본
`charPr`·`paraPr`를 복제해 굵게와 정렬 4종만 바꾸는 첫 style slice를 연결했다. 같은
definition은 재사용하며 새 ID는 기존 숫자 ID 최대값 다음 값으로 결정적으로 할당한다.
header collection count, definition과 section reference를 함께 변경하고 undo에서는 두
entry의 원본 bytes를 복원한다. 이어서 `hp:t` 내부 부분 selection을 좌·선택·우 최대 3개
run으로 분할하고 선택 run만 새 글자 style을 참조하도록 확장했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 22 suites, 107 passed, 1 suite skipped |
| style 코어 | `tests/editing/style_patch.test.ts` | clone·reuse·run split·entity 의미·byte undo/redo 통과 |
| main session | `tests/main/editing_session.test.ts` | 새 anchor 선택 이동·부분 style undo/redo와 caret 이동 통과 |
| production build | `npm run build` | main·preload·renderer 성공 |
| macOS package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| packaged style | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=스타일검증 HAN_FLOW_VERIFY_STYLE=1 HAN_FLOW_VERIFY_EDIT_SAVE=1 npm run verify:app -- <private.hwpx>` | 부분 run split·굵게·정렬·undo/redo·Save As 통과 |
| 저장본 화면 | 같은 packaged probe의 두 번째 프로세스 | 8쪽·이미지 4개·overflow 0 |
| 공개 HWPX matrix | `npm run verify:matrix` | 5종 통과, 최대 9,767쪽·DOM 12개·overflow 0 |
| 배포 고지 | `npm run verify:notices` | Apache-2.0·rhwp MIT·third-party notice 일치 |

packaged probe는 원문이나 캡처를 남기지 않고 부분 run 생성, style 버튼 상태, projection 뒤
결과, undo/redo 원복 여부와 구조 count만 수집했다. 원본 SHA-256은 변하지 않았으며 임시
저장본을 다시 연 뒤 삭제했다. 프로그램으로 주입한 composition commit은 실행 환경에 따라
간헐적으로 늦어질 수 있어 이 관문은 결정적인 범위 교체를 사용했고, composition-only
패키지 probe는 별도로 통과했다.

이 시점의 글자 모양은 단일 `hp:t` 전체 또는 내부 부분 selection의 굵게, 문단 모양은 최상위
일반 문단 정렬만 지원했다. 분할 뒤 여러 run의 style 재적용과 undo는 가능하지만 하나의
연속 text 입력 surface는 아직 제공하지 않는다. 표 cell text는 다음 날 제한적으로
연결했으며 머리말·꼬리말, 원래부터 복합인 run과 다른 style 속성은 계속 차단한다.

## 2026-07-29 — V3 dirty 문서 교체·종료 보호

main history의 dirty 상태를 파일 교체와 BrowserWindow lifecycle에 연결했다. 열기 dialog,
drop과 Finder `file:open`은 새 import 전에 저장/버리기/취소 결과를 기다리고, 창 닫기와
`⌘Q`는 main이 같은 결정을 직접 처리한다.

첫 packaged discard probe는 비동기 결정 뒤 승인된 두 번째 `window.close()`도
`resolvingClose`가 막아 macOS 프로세스가 남는 결함을 찾았다. 승인 상태를 중복 결정 상태보다
먼저 판정하고, 앱 종료 요청이면 BrowserWindow `closed` 이후 quit을 재개하도록 수정했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 99 passed, 1 suite skipped |
| dirty discard | `HAN_FLOW_VERIFY_EDIT_TEXT=한 HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION=discard npm run verify:app -- <private.hwpx>` | 새 파일 없이 정상 종료 |
| dirty close-save | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=교체 HAN_FLOW_VERIFY_CLOSE_DIRTY_ACTION=save npm run verify:app -- <private.hwpx>` | 원본 hash 불변·저장본 생성·재열기 통과 |
| 저장본 화면 | close-save 두 번째 프로세스 | 8쪽·overflow 0 |

programmatic composition은 환경에 따라 commit event 주입이 불안정할 수 있어 lifecycle
probe에는 결정적인 역방향 범위 교체를 사용했다. 실제 composition 관문과 물리 두벌식 수동
matrix는 별도로 유지한다.

## 2026-07-29 — V3-4 검증형 Save As UI

main-process 편집 session에 검증형 Save As를 연결했다. 사용자는 Preview가 갱신되지 않을 수
있다는 경고를 확인한 뒤 새 `.hwpx` 목적지만 고를 수 있다. renderer에는 raw package,
destination writer나 범용 저장 IPC를 노출하지 않으며 과거 `dialog:saveFile`과
`dialog:confirmSave` preload API는 제거했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 99 passed, 1 suite skipped |
| session Save As | `tests/main/editing_session.test.ts` | 원본 불변·기존 목적지 충돌·savepoint·undo/redo 5건 통과 |
| production package | `npm run package:mac` | arm64 unsigned `.app` 성공 |
| packaged Save As | `HAN_FLOW_VERIFY_EDIT_TEXT=한 HAN_FLOW_VERIFY_EDIT_SAVE=1 npm run verify:app -- <private.hwpx>` | dirty 해제·원본 hash 불변·저장본 재열기 통과 |
| 저장본 화면 | 같은 packaged probe의 두 번째 프로세스 | 8쪽·이미지 4개·overflow 0 |

저장 성공 뒤에만 savepoint가 이동한다. 저장 실패나 취소는 현재 package와 dirty 상태를
바꾸지 않는다. probe는 임시 목적지를 사용하고 원문 대신 길이·hash 불변 여부·구조 count만
출력한 뒤 저장본을 삭제한다.

## 2026-07-29 — V3-4 selection과 re-pagination 복원

편집 projection이나 re-pagination으로 기존 DOM이 교체되어도 selection의 source anchor에
해당하는 새 surface를 찾아 focus와 UTF-16 anchor/focus offset을 복원하도록 강화했다.
정방향 caret뿐 아니라 뒤→앞 범위 selection도 방향을 보존한다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 전체 회귀 | `npm test -- --runInBand` | 21 suites, 97 passed, 1 suite skipped |
| composition selection | `HAN_FLOW_VERIFY_EDIT_TEXT=한 npm run verify:app -- <private.hwpx>` | projection·undo·redo caret 일치 |
| 역방향 범위 교체 | `HAN_FLOW_VERIFY_EDIT_MODE=range HAN_FLOW_VERIFY_EDIT_TEXT=교체 npm run verify:app -- <private.hwpx>` | 본문·projection·undo·redo selection 일치 |
| re-pagination | 같은 composition probe | 2·3페이지 문자 분배 변경, 8쪽·이미지 4개·overflow 0 유지 |

probe는 원문 대신 원문 UTF-16 길이와 각 단계 일치 여부만 출력한다. 실제 키보드 두벌식
입력은 [수동 matrix](v3_ime_manual_matrix.md)에 남겨 자동 event 주입과 구분한다.

## 2026-07-29 — V3-4 paragraph IME surface 첫 slice

ordered XML `hp:t`의 section ordinal을 `ViewerText.sourceAnchor`에 보존하고, renderer의
`plaintext-only` 문단 surface가 native `beforeinput`·composition·input event를 source
transaction으로 바꾸도록 연결했다. browser가 조합 중 DOM을 소유하며 중간값은 commit하지
않고 `compositionend`에서 완성된 UTF-16 최소 diff 하나만 main process로 보낸다.

source package와 bounded history는 sender/session에 묶인 main-process manager가 소유한다.
commit·undo·redo는 sender별 queue로 직렬화하며 renderer에는 raw package bytes와 base
revision을 노출하지 않는다. 첫 UI 범위는 완전히 로드된 HWPX의 최상위 단일 text 문단이고
표·머리말·꼬리말·복합 run·HWP는 계속 읽기 전용이다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 21 suites, 97 passed, 1 suite skipped |
| IME adapter | `tests/editing/composition_input.test.ts` | 조합 중 0회·종료 1회 commit, 삭제·취소·emoji 경계 통과 |
| main session | `tests/main/editing_session.test.ts` | sender binding·commit·undo·redo projection 3건 통과 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| packaged IME probe | `HAN_FLOW_VERIFY_EDIT_TEXT=한 npm run verify:app -- <private.hwpx>` | 8쪽·이미지 4개·overflow 0, 편집·undo·redo 일치 |

probe 결과에는 원문이나 수정 본문을 남기지 않고 길이와 일치 여부, editable count만 기록한다.
실제 물리 키보드 두벌식 입력과 범위 selection·re-pagination caret matrix는 남아 있으므로
V3-4 전체 완료로 표현하지 않는다. 저장 UI도 아직 연결하지 않았다.

## 2026-07-29 — V3-3 transaction과 bounded history

여러 `ReplaceTextCommand`를 base revision과 전후 selection을 가진 하나의 원자적
`EditTransaction`으로 묶었다. 성공 결과는 inverse transaction과 loss report를 만들고,
수정 source package를 기존 viewer decoder로 즉시 projection한다.

history는 문서 snapshot 대신 forward/inverse delta만 기본 100 entries·추정 8 MiB로 제한한다.
연속 typing grouping은 input type, 같은 anchor, selection 연속성, 시간 창과 composition 경계를
함께 사용한다. savepoint는 logical state ID로 추적해 package revision이 계속 증가해도
undo가 저장 상태로 돌아오면 dirty가 정확히 해제된다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 19 suites, 89 passed, 1 suite skipped |
| transaction/history | `tests/editing/transaction_history.test.ts` | atomicity·inverse·grouping·limit·savepoint·Save As 8건 통과 |
| private history | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/editing/transaction_history.test.ts` | undo·redo·Save As·원본 hash 불변 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

사용자 입력 UI는 아직 없다. 다음 관문은 paragraph surface에서 native composition과 selection을
source anchor transaction으로 변환하고 실제 macOS 두벌식 입력을 검증하는 V3-4다.

## 2026-07-29 — V3-2 source text patch와 검증형 Save As

UTF-8 section 원문에서 단순 `hp:t` content span만 수정하는 `ReplaceTextCommand`를 구현했다.
문서 순서 기반 source ID, package revision과 UTF-16 range를 함께 확인하고 inverse command를
만든다. target 밖 XML과 다른 entry는 재직렬화하지 않는다.

Save As는 같은 directory의 배타적 임시 파일을 flush하고 package identity, 기존 viewer decode,
선택 semantic 검증을 모두 통과한 뒤 hard link로 존재하지 않는 목적지 이름만 만든다. 원본
overwrite와 기존 목적지 overwrite는 차단한다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 18 suites, 81 passed, 1 suite skipped |
| text fixture | `tests/editing/text_patch.test.ts` | escape·빈 node·unsupported node·inverse·conflict·fault 6건 통과 |
| private patch | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/editing/text_patch.test.ts` | 한 text patch·Save As·원본 hash 불변 |
| production build | `npm run build` | main/preload/renderer 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

사용자 저장 버튼은 아직 없다. 다음 품질 관문은 여러 command를 하나의 transaction으로 묶고
delta history, undo/redo와 savepoint를 검증하는 V3-3이다.

## 2026-07-29 — V3-1 HWPX source package identity

모든 ZIP entry를 원본 순서와 uncompressed bytes, compression, CRC로 보유하는
`HwpxSourcePackage`를 추가했다. 과거 serializer는 header와 section만 재생성해 unknown XML,
이미지와 package entry를 잃었고 잘못된 mimetype을 기록했으므로 preload/main 저장 IPC와 함께
제거했다. 사용자 저장 기능은 아직 노출하지 않는다.

공개 round-trip fixture에는 unknown namespace·attribute·XML node, PNG, stored binary,
directory entry, Preview와 META-INF를 넣었다. 재패킹 전후 entry metadata와 각 파일 SHA-256이
일치하고 기존 HWPX reader가 결과를 다시 여는지 확인했다. 저장소 밖 AIDA HWPX도 파일명·본문을
assertion이나 결과에 출력하지 않는 선택 테스트로 같은 identity 관문을 통과했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 17 suites, 75 passed, 1 suite skipped |
| private identity | `HAN_FLOW_PRIVATE_HWPX=<path> npm test -- --runInBand tests/parser/source_package.test.ts` | entry metadata·SHA-256 일치 |
| production build/package | `npm run package:mac` | main/preload/renderer, arm64 `.app` 성공 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개·overflow 0 |

Windows 한/글에서 identity 결과를 다시 여는 외부 호환성 확인은 남아 있다. 그 전까지
V3-1을 저장 UI 완료로 표현하지 않으며, 다음 구현은 source anchor 기반 한 text node patch와
검증된 Save As다.

## 2026-07-27 — V2 공통 importer 완료

관련 구현: `35e26e4` (`문서 가져오기 IPC 경계 통합`)

HWP의 main preflight와 HWPX의 package/점진 decoder를 format-neutral `DocumentImporter`로
모았다. preload와 React loader가 `document:import`, `document:complete`,
`document:error` 계약만 사용하도록 변경했고 창 종료 시 진행 중인 decoder Worker를
정리한다. 실행 경로에 없고 항상 실패하던 과거 HWP prototype은 제거했다.

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 16 suites, 62 passed, 1 skipped |
| importer 경계 | `tests/main/document_importer.test.ts` | HWP/HWPX/확장자/오류 4건 통과 |
| production build | `npm run build` | main/preload/renderer build 성공 |
| macOS package | `npm run package:mac` | arm64 `.app` 생성 성공 |
| HWP production matrix | `npm run verify:hwp-matrix` | 2쪽·PDF 98.6%·오류 5종 통과 |
| HWPX production matrix | `npm run verify:matrix` | 5종, 최대 9,767쪽·DOM 12개 통과 |
| probe 테스트 | `npm run test:probe` | 8 passed |
| 배포 고지 | `npm run verify:notices` | Apache-2.0, rhwp MIT, notice 일치 |

이 결과로 V2의 parser 선택, 안전한 열기, 화면·검색·PDF, 성능·메모리 기준선, 공개 fixture,
오류 taxonomy와 importer 경계 완료 조건이 모두 충족됐다. 다음 milestone은 V3 편집 기반
설계이며, 현재 read-only 모델을 즉시 `contentEditable`로 바꾸지 않고 editable model과
무손실 저장 계약부터 검증한다.

## 2026-07-27 — HWP FileHeader 안전한 열기

관련 구현: `8c59b53` (`HWP 지원 불가 문서 오류 분류 추가`)

### 검증 환경

- macOS arm64
- Electron 28.3.3
- `@rhwp/core` 0.7.19, `kordoc` 4.2.7
- production `.app`: unsigned local package

### 실행과 결과

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 15 suites, 58 passed, 1 skipped |
| probe 테스트 | `npm run test:probe` | 8 passed |
| production build | `npm run build` | main/preload/renderer build 성공 |
| macOS package | `npm run package:mac` | arm64 `.app` 생성 성공 |
| HWP 정상·오류 matrix | `npm run verify:hwp-matrix` | 정상 fixture와 오류 5종 통과 |
| HWPX 공개 matrix | `npm run verify:matrix` | 5종 fixture 통과 |
| 배포 고지 | `npm run verify:notices` | Apache-2.0, rhwp MIT, notice 원문 일치 |
| private HWP 앱 | `npm run verify:app -- <private.hwp>` | 7쪽, mount 7, overflow 0 |
| private HWP PDF | `npm run verify:pdf -- <private.hwp>` | 7쪽, 혼합 용지, 문자 99.08% |

공개 HWP matrix는 `FileHeader`를 테스트 중에 변형해 다음 오류 코드가 production 앱에 그대로
표시되는지 확인했다.

- `HWP_ENCRYPTED`
- `HWP_DISTRIBUTION`
- `HWP_DRM`
- `HWP_UNSUPPORTED_VERSION`
- `HWP_CORRUPTED`

기존 HWPX 회귀 결과는 baseline 3쪽, cell continuation 2쪽, 이미지 12개·`rowSpan` fixture
1쪽, 80-section 대형 fixture 9,767쪽 중 DOM 12개 mount, 손상 package의 사용자 오류다.

### 검증 중 발견한 문제

오류 fixture를 연속 실행할 때 Electron이 종료 직후 `Session Storage`를 늦게 닫아 임시
디렉터리 삭제가 `ENOTEMPTY`로 실패할 수 있었다. 앱 판정과 정리 실패를 분리하기 위해 E2E
임시 디렉터리 삭제에 100ms 간격, 최대 5회의 제한된 재시도를 추가했다. 같은 전체 matrix
재실행으로 통과를 확인했다.

## 2026-07-27 — 개인정보 없는 HWP 회귀 관문과 PDF race

관련 구현:

- `191fed8` — 공개 HWP 회귀 매트릭스 추가
- `24f0df9` — HWP PDF 마지막 페이지 출력 대기 보강
- `72e5153` — V2 공개 HWP 검증 현황 문서화

공개 `synthetic-layout.hwp`는 HWP 5.0.3.2, 12,800 byte이며 SHA-256
`b665933da10ec276e8e21ddb1c9e6d2eec5440c9ac5d1bda9e5bc478bd136b9e`로 고정했다.

| 관찰 대상 | 결과 |
| --- | --- |
| 생성 결정성 | 재생성 결과와 고정 SHA-256 일치 |
| kordoc 구조 oracle | section 1, 표 1, 셀 9, 이미지/resource 1/1 |
| rhwp 렌더 | 2쪽, SVG 이미지 1, 위험 요소·속성 0 |
| production 앱 | 2쪽, 반복 머리말 2회, overflow 0 |
| production PDF | 2쪽 A4, 텍스트 보존율 98.6% |

private AIDA HWP 재검증에서 화면은 7쪽이지만 첫 PDF의 마지막 쪽 텍스트가 0자로 출력돼 전체
보존율이 92.1%까지 내려가는 race를 발견했다. 인쇄 준비를 렌더 요청 완료가 아니라 모든
fixed-page SVG의 실제 decode 완료(`naturalWidth > 0`)까지 기다리도록 변경했다. 수정 후
마지막 쪽은 424자, 전체는 99.08%로 회복했다.

## 2026-07-23 — V1 HWPX Release Candidate

상세 근거는 [V1 기준선](v1_baseline.md)과 [Release Candidate 체크리스트](release_checklist.md)에
있다.

- private AIDA HWPX: 8쪽, 이미지 4개, overflow 0
- 화면과 PDF 페이지별 비공백 문자 수 일치
- 15문단 표 cell continuation: 반복 header, 8+7 문단 분배
- 80-section synthetic: 9,767쪽 중 DOM 12개 mount
- 이미지 12개·`rowSpan=2` 공개 fixture와 손상 HWPX 오류 UX
- production Finder 열기, single-instance, drag-and-drop, pinch zoom, dark chrome와 PDF

## 포트폴리오에 사용할 수 있는 근거

- “빠르다”는 표현은 cold/warm 20회 p50/p95와 최대값으로 설명한다.
- “대형 문서를 지원한다”는 표현은 9,767쪽 중 DOM 12개 mount 결과로 설명한다.
- “PDF가 안정적이다”는 표현은 화면/PDF page size와 페이지별 문자 보존율, 실제로 발견해
  수정한 마지막 페이지 race로 설명한다.
- “안전하게 연다”는 표현은 main preflight, Worker timeout·취소, SVG 정제와 다섯
  `FileHeader` 오류 코드로 설명한다.
- “테스트가 있다”는 표현보다 private 실문서와 공개 결정적 fixture를 함께 사용하고 개인정보를
  결과에서 제거한 검증 설계를 설명한다.
