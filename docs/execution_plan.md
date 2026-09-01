# Han-Flow 실행 계획

기준일: 2026-08-09

이 문서는 현재 작업 순서를 기록한다. 과거 editor prototype 계획은 현재 제품 범위가 아니며
[제품 비전과 로드맵](vision_and_roadmap.md)에서 V3로 다시 정의했다.

## 완료한 milestone: V2 fixed-page 품질 관문

### 방금 완료

- [x] rhwp 좌표형 text run의 schema·범위 검증과 page별 cache
- [x] 정제된 SVG blob image와 분리된 React text layer
- [x] `⌘F` 검색, 결과 이동·하이라이트와 DOM 텍스트 선택
- [x] 장식 SVG image 숨김, page document role과 text layer label
- [x] 첫 page image 우선 paint 후 text layer·나머지 page 점진 렌더
- [x] 패키지 HWP 검색·선택·접근성 자동 검증
- [x] Worker 격리 후 cold/warm 각 20회 재측정: p95 614ms / 237ms
- [x] HWPX production 앱 회귀 검증
- [x] CSS named page 기반 세로·가로 혼합 HWP PDF 출력
- [x] HWP PDF 7페이지·용지 크기·텍스트 99.08%와 대표 PNG 검증
- [x] HWPX PDF 8페이지·페이지별 글자 수 회귀 검증
- [x] 저장소 밖 HWP/HWPX aggregate working set peak 기준선
- [x] V1 RC 재패키징과 현재 `.app`·`app.asar` 논리 크기 증가량 측정
- [x] 중복 rhwp WASM 제거와 production MIT license 포함
- [x] rhwp 전용 Web Worker 격리와 강제 종료형 timeout·load cancellation
- [x] Worker 요청 ID, crash/timeout 오류와 SVG·text layout 응답 상한
- [x] ADR-0001에서 rhwp production visual / kordoc development oracle 확정
- [x] MIT 원문과 third-party notice production package 포함
- [x] `verify:notices`와 release gate에서 세 고지 원문 일치 자동 검증
- [x] 개인정보 없는 2쪽 HWP 고정 fixture와 SHA-256 manifest
- [x] HWP fixture의 표 1개·셀 9개·이미지 1개를 두 parser로 교차 검증
- [x] `verify:hwp-matrix`에 생성 결정성·앱·반복 머리말·PDF 관문 통합
- [x] PDF 인쇄 전 모든 SVG image decode를 기다려 마지막 페이지 누락 race 제거
- [x] 저장소 밖 실사용 HWP PDF 텍스트 보존 재검증
- [x] CFB 무결성·FileHeader signature·5.x version preflight
- [x] 암호·배포용·DRM·비지원 version·손상 HWP 구조화 오류 UX
- [x] 공개 HWP를 변형한 5종 오류 production E2E matrix
- [x] 날짜·명령·수치·실패/수정 내용을 모은 검증 이력 문서
- [x] format-neutral `DocumentImporter`와 `document:import` IPC
- [x] preload·React loader의 HWP/HWPX 공통 성공·오류 계약
- [x] 기존 `hwp_parser.ts` prototype 제거
- [x] V2 완료 조건 전체 재검증

## 완료한 milestone: V2-0 HWP parser bake-off

### 1. probe 계약

- [x] production dependency와 기존 `.hwpx` 경로를 바꾸지 않는 실험 entry 작성
- [x] 입력: 저장소 밖의 `.hwp` 절대 경로
- [x] 출력: 본문 없는 JSON 진단
- [x] 지표: parse/first-page/total 시간, page·section·paragraph·table·image 수, 오류 분류
- [x] 60초 timeout과 signal 기반 취소

### 2. `@rhwp/core` probe

- [x] WASM을 hidden Electron renderer에서 초기화하는 독립 실험
- [x] 저장소 밖 기준 HWP page count와 전체 page SVG 생성
- [x] SVG의 script, event handler, 외부 URL 검사
- [x] 기준 PDF와 privacy-safe 페이지 그룹·문자 보존율 자동 비교
- [x] PDF 3·4페이지가 합쳐진 SVG를 PNG로 재렌더링해 겹침·잘림 없음 확인
- [x] peak memory와 production package 증가량 측정
- [x] fixed-page variant로 기존 zoom·page virtualization shell 연결
- [x] 저장소 밖 실사용 HWP의 구역·세로/가로 용지·overflow 0 확인
- [x] 패키지 HWP cold/warm 20회 측정과 첫 화면 1초 관문 통과
- [x] 좌표형 text layer의 검색·선택·접근성 및 blob image 경계 유지 확인
- [x] mixed-orientation PDF 출력과 대표 세로·가로 PNG 검증
- [x] 개인정보 없는 HWP 고정 fixture와 production app/PDF matrix

### 3. `kordoc` probe

- [x] HWP `ParseResult.blocks`, images, metadata와 warnings 수집
- [x] 첫 paragraph/table/image gap 표 작성
- [x] 저장소 밖 HWPX의 decoder와 문서 전체 구조 count 자동 비교
- [x] `pageNumber` tag로 section 경계를 복원하고 병합 cell 중복을 제거하는 최소 adapter
- [x] 저장소 밖 HWPX adapter의 section·semantic text·image/resource 보존 가능성 판정
- [x] kordoc production 미채택으로 parser code bundle 분리 실험 종료

### 4. 결정

- [x] [V2 전략 점수표](hwp_v2_strategy.md#점수표)와 ADR-0001 작성
- [x] rhwp main, 자동 fallback 없음, kordoc development oracle 역할 결정
- [x] MIT license와 third-party notice 확정
- [x] architecture decision을 V2 전략·아키텍처 문서에 반영

## 완료한 milestone: V2-1 importer 경계

- [x] 확장자·CFB·FileHeader 기반 HWP preflight
- [x] `DocumentImporter`와 format-neutral IPC event
- [x] HWP parser 전용 Web Worker 격리
- [x] 200 MiB 입력 제한
- [x] 30초 open·15초 page timeout과 Worker 강제 종료형 load cancellation
- [x] `.hwp` Finder association, dialog, drop
- [x] 암호·DRM·배포용·비지원 version·손상 입력 오류 UX
- [x] 기존 `hwp_parser.ts` prototype 제거

## 완료한 milestone: V3-0 편집 기반 조사

- [x] 과거 `store.ts`, `NormalizedDocument`, serializer와 저장 IPC 실행 경로 감사
- [x] KS X 6101·한컴 HWPX package 구조와 OWPML 공개 모델 조사
- [x] W3C composition/input/selection event와 React 입력 경계 조사
- [x] transaction history와 안전한 파일 교체 근거 조사
- [x] source package·editable model·viewer projection 분리
- [x] `LossReport`, IME matrix와 단계별 품질 관문 문서화

감사 결과 과거 editor store와 serializer는 재사용하지 않는다. 현재 serializer는 package
entry와 미지원 XML을 잃고 잘못된 mimetype을 기록하므로 실문서 저장 경로로 사용할 수 없다.
세부 근거는 [V3 HWPX 편집 조사와 구현 전략](v3_editing_strategy.md)에 있다.

## 완료한 코드 관문: V3-1 package preservation

1. [x] 사용되지 않는 손실성 `hwpx:save` IPC와 과거 serializer를 제거한다.
2. [x] 모든 entry bytes·compression·CRC를 제한된 형태로 읽는 `HwpxSourcePackage`를 만든다.
3. [x] path traversal, duplicate, encrypted entry와 압축 해제 크기 상한을 검증한다.
4. [x] 수정 없는 identity round-trip에서 entry set·compression·CRC·content SHA-256을 비교한다.
5. [x] unknown namespace·attribute·entry sentinel 공개 fixture를 추가한다.
6. [x] Han-Flow 재열기와 기존 production matrix 회귀를 확인한다.
7. [ ] Windows 한/글 재열기 결과를 기록한다.

코드 관문과 저장소 밖 실사용 HWPX의 privacy-safe identity 검증은 통과했다. Windows 한/글
재열기는 V3 전체의 외부 호환성 관문으로 계속 추적한다.

## 완료한 코드 관문: V3-2 text patch와 Save As

1. [x] UTF-8 section에서 단순 `hp:t` source span과 결정적 text node ID를 만든다.
2. [x] revision·UTF-16 범위를 검증하는 `ReplaceTextCommand`와 inverse를 만든다.
3. [x] XML escape, 공백·tab·line break, 빈 node와 Unicode 경계를 검증한다.
4. [x] 수정 section 외 entry bytes와 unknown XML·binary를 그대로 보존한다.
5. [x] `LossReport`에 preserved/modified entry와 stale preview를 기록한다.
6. [x] 같은 directory temp write·flush·재개봉·identity·viewer 검증 후에만 Save As한다.
7. [x] 원본 불변, 기존 목적지 비덮어쓰기와 검증 실패 cleanup을 fault test로 확인한다.
8. [x] 사용자 저장 확인 UI와 제한된 IPC를 main 편집 session에 연결한다.

공개 fixture와 저장소 밖 실사용 HWPX 모두 한 text patch·Save As·재개봉을 통과했다. 현재
코어는 사용자 UI에 노출하지 않는다.

## 완료한 코드 관문: V3-3 transaction과 history

1. [x] base revision·command 배열·전후 selection을 가진 원자적 transaction을 만든다.
2. [x] 중간 command 실패와 stale revision에서 부분 결과를 반환하지 않는다.
3. [x] 역순 inverse transaction으로 여러 text edit를 byte 단위 복원한다.
4. [x] transaction 결과를 기존 `ViewerDocument` projection으로 다시 decode한다.
5. [x] package snapshot 대신 forward/inverse delta만 저장한다.
6. [x] 기본 100 entries·8 MiB와 transaction 1,000 commands 상한을 둔다.
7. [x] `inputType`·selection·anchor·시간·composition 경계를 모두 사용해 typing을 묶는다.
8. [x] undo/redo selection, branch, savepoint·dirty와 undo/redo 후 Save As를 검증한다.
9. [x] 실제 DOM selection과 IME event는 V3-4 input surface에서 연결한다.
10. [x] main의 selection 동기화와 command apply를 단일 atomic history commit으로 묶는다.
11. [x] 중간 command·history limit 실패에서 package, selection, undo/redo stack과 dirty를 보존한다.
12. [x] 현재 package revision과 마지막 검증 저장 revision을 분리해 IPC·renderer에 전달한다.

공개 fixture와 저장소 밖 실사용 문서에서 transaction → undo → redo → Save As와 원본 hash 불변을
통과했다.

2026-09-01 hardening에서는 main이 transaction 전에 selection을 먼저 바꾸던 순서를 제거했다.
`commitSynchronized`는 검증과 command 적용, history 용량 확인이 모두 성공한 뒤에만 package,
selection과 stack을 함께 전환한다. 성공한 no-op은 selection만 동기화하고 history entry는 만들지
않는다. `savedRevision`은 저장 성공 뒤에만 이동하며 dirty는 logical savepoint로 계속 판정한다.

## 완료한 자동 코드 관문: V3-4 한국어 IME와 selection

1. [x] ordered XML `hp:t` ordinal을 `ViewerText.sourceAnchor`로 projection한다.
2. [x] source scanner anchor와 decoder anchor가 빈 text를 포함해 일치하는지 검증한다.
3. [x] composition 중간 input을 보류하고 종료 시 최소 UTF-16 diff 하나만 만든다.
4. [x] source package와 history를 renderer 밖 main-process session에 둔다.
5. [x] sender/session binding과 직렬 commit·undo·redo IPC를 검증한다.
6. [x] 최상위 단일 text 문단만 `plaintext-only` surface로 연결한다.
7. [x] `⌘Z`·`⇧⌘Z`, dirty 상태와 projection selection 복원을 연결한다.
8. [x] 저장소 밖 HWPX에서 composition → undo → redo와 overflow 0을 검증한다.
9. [ ] 실제 macOS 두벌식 키보드로 삽입·삭제·범위 교체·조합 취소 matrix를 수동 확인한다.
10. [x] 실제 page text 분배가 바뀌는 re-pagination 뒤 caret·undo/redo selection을 검증한다.
11. [x] 검증형 Save As를 사용자 확인 UI와 제한된 IPC로 연결한다.

자동 packaged probe는 composition caret과 뒤→앞 범위 selection을 각각 projection,
undo, redo 뒤 비교한다. 실사용 문서에서 입력 후 페이지 text 분배가 바뀌어도
페이지·이미지 보존, overflow 0과 source anchor focus가 유지됐다. 물리 키보드 항목은
[macOS 한국어 IME 수동 matrix](v3_ime_manual_matrix.md)에 분리했다.

2026-08-02에는 실제 macOS 두벌식 입력기에 key code를 전달하는 공개 fixture 전용 smoke를
추가했다. 일반 문단과 표 셀에서 `한글입력검증 `을 입력해 스페이스바로 조합을 종료하고,
2초 뒤 같은 source anchor가 focus를 유지한 상태에서 클릭 없이 `추가 `를 입력했다. 이 검사는
커밋 뒤 focus 소실 회귀뿐 아니라 조합 중 Backspace·Escape, 앞→뒤·뒤→앞 범위 치환과 실제
`⌘Z`·`⇧⌘Z` selection 복원도 자동으로 막는다. 사용자 손 입력과 문단 간 클릭을 포함한 물리
키보드 수동 matrix는 대체하지 않는다.

Save As는 Preview stale 경고 → 목적지 선택 → 같은 디렉터리 임시 파일·`fsync` → package
identity·viewer 재해석 → 새 목적지 hard link 순서다. 저장 성공 뒤에만 savepoint를 옮기며
저장소 밖 HWPX에서 원본 hash 불변, 저장본 구조 보존과 overflow 0 재열기를 통과했다.

### 완료한 후속 관문: dirty 문서 교체·종료 보호

1. [x] dialog·drop·Finder 전달 전에 저장/버리기/취소 결정을 받는다.
2. [x] BrowserWindow close와 `⌘Q`를 main-process history의 dirty 상태로 보호한다.
3. [x] Save 선택은 검증형 Save As를 재사용하고 성공 뒤에만 종료한다.
4. [x] cancel은 현재 session과 화면을 유지하고 discard만 명시적으로 폐기한다.
5. [x] 중복 close를 막되 승인된 두 번째 close는 통과시키는 lifecycle 순서를 검증한다.
6. [x] 패키지에서 discard 종료와 close-save 원본 불변·저장본 재열기를 검증한다.

## 완료한 코드 관문: V3-5 문단·글자 style과 표 cell text

1. [x] source anchor에서 최상위 단일 run과 일반 문단을 결정적으로 찾는다.
2. [x] 원본 `charPr`·`paraPr`를 기준으로 굵게와 정렬만 제한적으로 변경한다.
3. [x] 동일 definition 재사용과 숫자 style ID의 결정적 할당을 구현한다.
4. [x] header collection count, definition과 section reference를 함께 갱신한다.
5. [x] inverse가 추가 definition과 reference를 제거해 원본 bytes를 복원한다.
6. [x] sender-bound style IPC와 활성 surface에만 열리는 toolbar를 연결한다.
7. [x] caret 이동 뒤 다음 transaction selection을 main history와 동기화한다.
8. [x] 공개 fixture에서 style reuse, no-op, 표 cell 차단과 undo/redo를 검증한다.
9. [x] 저장소 밖 HWPX에서 굵게·정렬·undo/redo·Save As 재열기를 검증한다.
10. [x] 단일 `hp:t` 내부 부분 selection을 좌·선택·우 run으로 분할한다.
11. [x] 표 cell text source anchor와 transaction을 별도 관문으로 구현한다.
12. [x] 여러 run 문단을 run별 입력 surface로 연결하고 좌우 경계 caret 이동을 지원한다.
13. [x] 글자 크기와 `#RRGGBB` 색상을 원본 `charPr` clone·reuse 경계에 추가한다.
14. [x] 부분 style·정렬을 함께 적용한 package의 Save As와 재개봉을 통합 검증한다.

글꼴 family 편집은 HWPX font-face ID, 시스템 설치 font mapping과 재배포 라이선스 정책을
함께 확정해야 하므로 V3 완료 조건에서 제외한다. 원본 덮어쓰기도 backup·crash recovery
계약 없이 노출하지 않고 검증형 Save As를 V3의 저장 제품 계약으로 확정한다.

## 완료한 코드 관문: V3-6A 현실적인 편집 UX 기반

1. [x] 좁은 pagination 스트레스 fixture와 별도로 실제 A4 세로 편집 fixture를 만든다.
2. [x] A4 `59528 × 84189 HWPUNIT`, 사방 약 20mm 여백과 넓은 본문 표를 자동 검증한다.
3. [x] 25px 도구 모음을 상단 문서 제어와 `홈` 리본의 2단 구조로 바꾼다.
4. [x] 현재 안전한 Save As, undo/redo, 굵게·크기·색상과 정렬만 그룹별로 노출한다.
5. [x] 편집 버튼 높이 40px, toolbar 높이 150px 이상과 활성 `홈` 탭을 packaged E2E로 측정한다.
6. [x] 다크 모드와 좁은 창의 가로 overflow를 유지하고 인쇄에서는 리본을 숨긴다.
7. [x] A4 fixture에서 범위 치환·undo/redo·selection과 overflow 0을 검증한다.

리본에 기능이 있는 것처럼 보이게 하는 비활성 placeholder는 추가하지 않는다. 줄 간격,
문단 앞뒤 간격, 목록과 표 도구는 각 source command·inverse·Save As·Windows 재열기 관문을 만든 뒤
활성화한다.

## 완료한 코드 관문: V3-6B 글자 장식 확장

1. [x] 한컴 공개 OWPML 모델에서 `italic`, `bold`, `underline`, `strikeout` 요소 순서를 확인한다.
2. [x] 기울임·밑줄·취소선을 기존 `charPr` clone·reuse command와 inverse에 연결한다.
3. [x] 밑줄의 `type/shape/color`, 취소선의 `shape/color`을 보존하며 해제 시 `NONE`을 기록한다.
4. [x] `ViewerCharStyle` projection과 CSS 조합 렌더링을 연결한다.
5. [x] 홈 리본과 `⌘I`·`⌘U` 단축키를 활성화하고 IPC boolean 검증을 추가한다.
6. [x] 전체 테스트, production build와 packaged A4 범위 편집·Save As·재열기를 통과한다.

다음 내부 slice는 문단 줄 간격·문단 앞뒤 간격 command다. 목록·표 구조·글꼴 family 편집은
각각 별도 source 모델과 외부 한/글 호환성 근거가 생기기 전까지 노출하지 않는다.

## 완료한 코드 관문: V3-6C 문단 간격 편집

1. [x] 공식 `ParaShapeType`의 `margin → lineSpacing` 순서와 각 속성 계약을 확인한다.
2. [x] 줄 간격을 `PERCENT` 100–300% 범위의 source command와 inverse에 연결한다.
3. [x] 문단 앞·뒤 간격을 `hc:prev`·`hc:next` HWPUNIT 0–72pt 범위로 연결한다.
4. [x] 기존 좌우 여백·들여쓰기와 알 수 없는 `paraPr` 속성을 보존한다.
5. [x] 홈 리본에 40px 조절기와 현재 값을 표시하고 IPC 숫자 검증을 추가한다.
6. [x] 22 suites·118 tests와 packaged A4 적용·Save As·재열기를 통과한다.

## 완료한 코드 관문: V3-6D 첫 줄 들여쓰기·내어쓰기

1. [x] 공식 `CMargin` 모델에서 `hc:intent`가 `Margin_Indent`에 대응함을 확인한다.
2. [x] −7200–7200 HWPUNIT 범위의 첫 줄 indent command와 inverse를 추가한다.
3. [x] `ViewerParaStyle.indent`와 CSS `text-indent` projection을 연결한다.
4. [x] 홈 리본에서 1pt 단위 내어쓰기·들여쓰기와 현재 음수·양수 값을 표시한다.
5. [x] 좌우 여백과 문단 앞·뒤 간격을 바꾸지 않는 clone·reuse 경계를 검증한다.
6. [x] 22 suites·119 tests와 packaged 양방향 조절·Save As·재열기를 통과한다.

목록·표 구조 편집과 글꼴 family는 현재 V3의 제한된 편집 경계보다 영향 범위가 크므로 별도
설계 관문 뒤에 진행한다. 자동 코드 범위에서 다음 우선순위는 Windows 한/글 재열기용 공개
호환성 package와 수동 판정표를 준비하는 것이다.

## 완료한 milestone: Sprint 0 재현성과 P0 방어

1. [x] Node.js 22와 npm 10 version contract를 저장소에 기록한다.
2. [x] Windows clean install·test·probe·build CI 초안을 추가한다. package가 필요한 notice
   검증은 macOS release 관문에 유지한다.
3. [x] HWPX read-only와 editing 경로가 같은 ZIP metadata preflight를 사용한다.
4. [x] renderer sandbox와 context isolation을 명시하고 외부 navigation을 HTTPS로 제한한다.
5. [x] clean Windows npm 환경에서 전체 CI 명령을 통과한다. GitHub Actions와 로컬
   Node.js 22.23.2 clean install에서 같은 test·typecheck·probe·build 관문을 확인했다.
6. [x] main·core·renderer의 project 범위를 바로잡고 독립 `typecheck` 관문을 추가한다.
   production에서 import되지 않던 초기 parser·normalization·renderer-engine과 과거 store는
   inventory 판정 뒤 삭제했으며 임시 typecheck 제외도 제거했다.
7. [x] XML·이미지 resource budget과 adversarial fixture를 추가한다. XML은 parse 전에
   depth·node·text·DOCTYPE을 검사하고, image resource는 순차 read 중 count·bytes·decoded
   dimension·pixel 합계를 제한한다. 실제 ZIP 형태의 깊이·PNG dimension 폭탄은
   `HWPX_IMPORT_FAILED`로 종료한다.
8. [x] legacy production 비사용 코드를 제거하거나 experimental로 격리한다. 손실성 parser와
   normalization, 문자열 renderer, snapshot store와 전용 타입을 삭제하고 미사용 dependency
   네 종을 lockfile에서 제거했다. 상세 판정은 [production·legacy inventory](legacy_inventory.md)에 있다.

상세 장기 순서와 완료 규칙은 [장기 완성도 로드맵](long_term_roadmap.md)을 따른다.

## 진행 중인 milestone: Sprint 2 selection과 multi-run range

1. [x] anchor와 focus가 각각 text node ID와 UTF-16 offset을 갖는 selection domain을 분리한다.
2. [x] ordered `hp:t` 순서로 순방향·역방향 여러 run 범위를 정규화한다.
3. [x] 없는 run, 범위 밖 offset과 surrogate pair 중간 offset을 transaction 전에 거부한다.
4. [x] transaction grouping, history, IPC와 renderer의 단일 run 선택을 새 모델로 이관한다.
5. [x] run 경계에서 Shift+방향키로 인접 run selection을 만든다.
6. [x] 공통 paragraph editing host에서 pointer drag native selection을 만든다.
7. [x] 여러 run 치환을 원자적 command 배열로 만들고 빈 run은 보존한다.
8. [x] multi-run 치환의 undo/redo 방향·focus와 Save As 재개봉을 검증한다.

글자 style command는 아직 한 run만 허용한다. renderer capability가 여러 run 선택에서 글자 모양
control과 단축키를 비활성화하고 main도 같은 요청을 안정적인 지원 제한 오류로 거부한다. text
입력의 cross-run·cross-paragraph 조합 종료는 공통 range commit 경로로 연결되어 있다.

## 완료한 milestone: Sprint 2 문단 구조 입력

1. [x] `hp:t`의 plain text와 `hp:lineBreak`·`hp:tab` 혼합 콘텐츠를 하나의 UTF-16 anchor로 읽는다.
2. [x] 알 수 없는 inline control은 viewer와 source editor 모두 편집 불가로 판정한다.
3. [x] Shift+Enter를 결정적인 `insertLineBreak` transaction으로 보내고 `<hp:lineBreak/>`로 저장한다.
4. [x] 단일·다중 run plain-text 붙여넣기의 줄바꿈을 같은 command 경로로 왕복한다.
5. [x] 일반 Enter에서 최상위 일반 텍스트 `hp:p`를 두 문단으로 분할한다.
6. [x] 문단 시작 Backspace와 문단 끝 Delete에서 인접 최상위 일반 문단을 병합한다.
7. [x] split/merge 시 stale `hp:linesegarray`를 제거하고 inverse에서 원문 fragment bytes를 복원한다.
8. [x] split/merge selection·undo/redo·Save As 재개봉을 공개 fixture와 main session에서 검증한다.

여러 문단 selection domain과 공통 paragraph editing host까지 연결했다. 표 셀 구조 편집은
cell의 여러 문단 편집 경계를 별도 scope로 확장한 뒤 진행한다.

## 진행 중인 milestone: Sprint 2 여러 문단 selection

1. [x] 최상위 일반 텍스트 문단을 가로지르는 순방향·역방향 selection을 정규화한다.
2. [x] 시작 문단 prefix와 끝 문단 suffix를 앞 문단 모양 아래 합치고 중간 문단을 제거한다.
3. [x] 양 끝 run style, inline line break, caret anchor와 빈 `hp:t`를 보존한다.
4. [x] 중간 복합 문단·보존 XML element를 fail-closed하고 기존 중첩 run 경로와 구분한다.
5. [x] main `commitRange`에서 구조 command 한 개로 undo/redo·Save As 재개봉을 검증한다.
6. [x] 공통 paragraph editing host에서 키보드와 pointer selection을 여러 문단으로 확장한다.
7. [x] 여러 문단 selection의 시각 강조와 입력·삭제·붙여넣기·조합 종료 routing을 연결한다.

같은 section의 최상위 문단은 공통 host scope를 공유하고 표 셀 문단은 고유 scope로 격리한다.
macOS 두벌식 물리 키보드의 여러 문단 조합 치환은 아래 외부 승인 matrix에 남긴다.

## 진행 중인 milestone: Sprint 2 capability와 오류 UX

1. [x] 편집 오류를 conflict, unsupported, invalid request, not applicable, session expired,
   history limit, save failure와 internal로 분류한다.
2. [x] main IPC에서 오류 code·복구 정책만 직렬화하고 내부 오류 본문·경로는 숨긴다.
3. [x] renderer에서 지원 제한·충돌·세션 종료·저장 실패를 서로 다른 안내로 표시한다.
4. [x] 인접 문단이 없는 경계 merge는 문자열 비교 없이 not-applicable no-op로 처리한다.
5. [x] 여러 run selection의 글자 모양 control과 단축키를 요청 전에 비활성화한다.
6. [x] 문단 split/merge, 글자·문단 style의 세부 구조 capability를 selection마다 계산한다.
7. [x] stale selection conflict에서 최신 projection과 안전한 caret 복구 동작을 연결한다.

최상위 텍스트, 단순 표 셀, 여러 run·문단과 cross-scope selection을 별도 capability로 계산한다.
표 셀 Enter·경계 병합과 style 요청은 renderer에서 사전 차단한다. conflict에서는 main session의
현재 projection을 다시 받고 selection을 유지, UTF-16 경계 보정, 남은 endpoint로 collapse 또는
안전한 해제 중 하나로 복구하며 상태바에 결과를 남긴다.

## 완료한 milestone: Sprint 2 구조별 저장 loss policy

1. [x] 편집 command를 본문 텍스트, 글자 모양, 문단 모양, 문단 구조로 분류한다.
2. [x] 분류를 history state에 저장해 grouping·undo·redo·새 branch에서 함께 복원한다.
3. [x] 변경 구조별 targeted source edit와 문단 구조 재열기 권고를 저장 전 확인창에 표시한다.
4. [x] 손대지 않은 XML·이미지·package entry 보존 정책과 Preview current/stale/omitted를 구분한다.
5. [x] 검증 저장 결과 IPC와 renderer 완료 상태에 구조 목록과 Preview 판정을 전달한다.
6. [x] core policy, history 복원, 사용자 안내와 Save As 결과를 공개 fixture 회귀로 검증한다.

`HwpxSaveLossPolicy`는 경로나 본문을 포함하지 않고 구조 kind, 보존 방식, 호환성 검토 수준과
안정적인 notice code만 전달한다. 현재 문단 split·merge는 targeted fragment 교체를 사용하지만
구조 변화가 크므로 `review`로 표시하고 Han-Flow·한/글 재열기를 권장한다. 텍스트·글자 모양·문단
모양은 `low`로 구분한다. 모든 경우 손대지 않은 package 내용은 보존하며 Preview entry가 있으면
편집 상태에서 `stale`, 원문 상태까지 undo하면 `current`, 원래 없으면 `omitted`로 판정한다.

## 완료한 milestone: Sprint 2 renderer 상태 소유권 분리

1. [x] HWPX projection·HWP fixed document·열기 진단을 document state로 묶는다.
2. [x] zoom·virtual range·검색·PDF·측정 상태를 viewer state로 분리한다.
3. [x] session history·selection·pending·상태 안내를 editing state로 분리한다.
4. [x] IME composing, 최신 session/pending mirror와 transaction sequence를 transient state로 격리한다.
5. [x] 기존 `App` 호출부는 typed setter adapter를 사용해 동작을 바꾸지 않고 reducer로 이전한다.
6. [x] slice 독립성, 함수형 pending 전이, reset과 동기 IME 차단 상태를 단위 테스트한다.

세 React reducer는 서로의 필드를 소유하지 않는다. document projection 반영은 viewer의 zoom·검색
상태를 암묵적으로 초기화하지 않고, editing pending 전이는 동시에 끝나는 요청에서도 함수형 update로
0 아래로 내려가지 않는다. IME composing은 key handler와 문서 교체 보호가 render 완료를 기다리지
않도록 ref 기반 `EditingImeTransientState`에서 즉시 읽되 문서 bytes나 selection은 저장하지 않는다.

## 완료한 milestone: Sprint 2 renderer 화면 책임 분할

1. [x] title·검색·zoom·PDF·열기 action과 편집 ribbon을 `ViewerToolbar`로 추출한다.
2. [x] loading·error·empty·document 영역을 `ViewerStage` shell로 추출한다.
3. [x] HWP/HWPX 공통 metadata·zoom·virtual spacer를 `ViewerPageStack`으로 추출한다.
4. [x] revision·progress·font 대체·overflow·성능·PDF 안내를 `ViewerStatusBar`로 추출한다.
5. [x] 기존 `ParagraphInputSurface`의 composition lifecycle과 source selection 계약은 유지한다.
6. [x] toolbar, stage, page stack과 status bar를 React 정적 렌더 회귀로 검증한다.

`App`은 IPC·비동기 command orchestration과 page content 조합을 맡고, 추출된 컴포넌트는 source
package나 main API를 직접 읽지 않는다. toolbar callback과 page stack metadata는 typed props로만
전달한다. HWPX의 표·문단 재귀 renderer는 기존 measurement·selection 회귀를 유지하기 위해 이번
단계에서 재작성하지 않고 독립 함수 컴포넌트 경계를 그대로 보존했다.

## 완료한 milestone: Sprint 3 기존 font-face 재사용 기반

1. [x] `ViewerDocument.fonts`의 HANGUL font-face ID·family projection을 편집 선택 UI에 연결한다.
2. [x] `ApplyCharacterStyleCommand.fontId`는 header에 실제 선언된 ID만 허용한다.
3. [x] 기존 charPr 복제·동등 definition 재사용·부분 run split과 exact inverse를 그대로 사용한다.
4. [x] main IPC가 비어 있거나 형식이 잘못된 font ID 요청을 차단한다.
5. [x] ribbon은 시스템 전체 글꼴이 아니라 현재 문서 font-face만 선택지로 제공한다.
6. [x] font 전환·decoder projection·undo 복원·미선언 ID 거부와 UI option을 자동 검증한다.

이 단계는 font file을 포함하거나 시스템 글꼴 이름을 HWPX에 새로 기록하지 않는다. 저장 command는
문서 header의 `hh:fontface lang="HANGUL"` 아래 존재하는 `hh:font` ID만 받아 `hh:fontRef`의
`hangul` 참조를 바꾼 charPr를 생성 또는 재사용한다. 따라서 설치 여부와 재배포 라이선스 판단은
보기의 대체 글꼴 안내에 남고 package mutation 범위로 확대되지 않는다.

## 완료한 milestone: Sprint 3 문단 모양과 기존 탭·목록 유지

1. [x] 정렬 4종, 줄 간격, 문단 앞·뒤 간격과 첫 줄 들여쓰기·내어쓰기 command를 유지한다.
2. [x] `hp:tab`이 포함된 복합 run에도 문단 모양 command를 허용하고 글자 모양 제한은 분리한다.
3. [x] paraPr 복제 전후의 `tabPrIDRef`와 `hh:heading` raw 구조를 불변식으로 검증한다.
4. [x] 정렬 element가 없을 때 공식 paraPr 자식 순서에 맞춰 삽입한다.
5. [x] `ViewerParaStyle.tabPrId`와 기존 bullet·number marker projection으로 저장 결과를 검증한다.
6. [x] save loss 안내에 기존 탭 정의와 글머리표·번호 매기기 구조 보존 범위를 표시한다.
7. [x] 인라인 탭·목록 heading·tabPr 참조·inverse byte 복원을 공개 fixture로 자동 검증한다.

이 단계는 기존 구조 보존 기반이다. 사용자 정의 tab stop을 만들거나 `hh:tabProperties`,
`hh:bullets`, `hh:numberings`를 변경하지 않으며 목록 수준·모양 편집 UI도 열지 않는다. 실제 한/글
왕복 판정 전에는 자동 검증 완료와 외부 호환성 승인을 구분한다.

## 다음 milestone: V3 외부 승인

1. [ ] [실제 macOS 두벌식 입력 matrix](v3_ime_manual_matrix.md)를 물리 키보드로 통과한다.
2. [ ] [Windows 한/글 재열기 matrix](v3_windows_round_trip_matrix.md)를 통과한다.
3. [x] 자동 test, production build, unsigned macOS package와 공개 HWPX matrix를 통과한다.
4. [x] 실패 결과를 숨기지 않고 자동화와 외부 수동 결과를 검증 이력에 분리한다.
5. [x] 실제 macOS 두벌식 OS-level key smoke로 일반 문단·표 셀의 스페이스바 commit과
   commit 뒤 focus·연속 입력을 검증한다.
6. [x] 실제 key code로 Backspace·Escape·양방향 범위 치환과 `⌘Z`·`⇧⌘Z`를 자동 검증한다.
7. [x] production identity·일반 문단 style·표 cell·A4를 묶은 Windows 전송 bundle을 생성한다.
8. [x] manifest SHA-256, PowerShell 검사와 WIN-01~08 결과 양식을 제공한다.
9. [x] Windows x64 production `dir` package를 만들고 같은 packaged 앱에서 일반 문단·표 cell,
   전체 제한 style, undo/redo, Save As·재열기와 dirty 종료의 저장·버리기를 자동 검증한다.

두 수동 관문을 통과하면 V3를 완료로 표시하고 V4 서명·공증·배포 작업으로 이동한다.

## 진행 중인 병행 milestone: V4-0 배포 준비 감사

Windows 환경 없이 가능한 V4 조사만 먼저 진행한다. 이 작업은 V3의 두 외부 승인 항목을
완료로 바꾸지 않는다.

1. [x] 공식 Apple·Electron·electron-builder 자료에서 직접 배포 요구사항을 확인한다.
2. [x] 현재 app이 arm64 `dir`, ad-hoc 서명, Team ID 없음임을 측정한다.
3. [x] updater는 runtime 연결이 없음을 확인했고 2026-08-20 미사용 dependency를 제거했다.
4. [x] 인증서 이름·credential을 저장하지 않는 `npm run release:audit`를 추가한다.
5. [x] DMG+ZIP, 서명·공증·stapling, architecture와 updater의 단계 순서를 문서화한다.
6. [ ] Apple Developer Program과 Developer ID Application 인증서를 준비한다.
7. [x] arm64/x64/Universal build와 공식 Rosetta 종료 일정을 근거로 arm64-only를 결정한다.
8. [ ] release 전용 설정과 최소 entitlement를 signed build로 검증한다.

상세 근거와 공개 배포 승인표는 [V4 macOS 배포 전략](v4_release_strategy.md)을 따른다.

## 매 milestone 공통 완료 규칙

1. 실제 fixture와 공개 synthetic fixture를 각각 통과한다.
2. 개인정보나 본문을 로그·캡처·commit에 남기지 않는다.
3. V1 test, build와 public production matrix가 회귀하지 않는다.
4. 구현과 같은 commit에서 관련 설계·결정 문서를 갱신한다.
5. 완료 조건을 만족한 논리 단위로 한국어 commit을 만든다.
