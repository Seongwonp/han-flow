# Han-Flow 실행 계획

기준일: 2026-07-27

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
- [x] AIDA HWP/HWPX cold 5회 aggregate working set peak 기준선
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
- [x] private AIDA HWP 7쪽 PDF 텍스트 99.08% 재검증
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
- [x] AIDA page count와 전체 page SVG 생성
- [x] SVG의 script, event handler, 외부 URL 검사
- [x] 기준 PDF와 privacy-safe 페이지 그룹·문자 보존율 자동 비교
- [x] PDF 3·4페이지가 합쳐진 SVG를 PNG로 재렌더링해 겹침·잘림 없음 확인
- [x] peak memory와 production package 증가량 측정
- [x] fixed-page variant로 기존 zoom·page virtualization shell 연결
- [x] 실제 AIDA HWP의 7페이지·3구역·세로/가로 용지·overflow 0 확인
- [x] 패키지 HWP cold/warm 20회 측정과 첫 화면 1초 관문 통과
- [x] 좌표형 text layer의 검색·선택·접근성 및 blob image 경계 유지 확인
- [x] mixed-orientation PDF 출력과 대표 세로·가로 PNG 검증
- [x] 개인정보 없는 HWP 고정 fixture와 production app/PDF matrix

### 3. `kordoc` probe

- [x] HWP `ParseResult.blocks`, images, metadata와 warnings 수집
- [x] 첫 paragraph/table/image gap 표 작성
- [x] AIDA의 HWPX decoder와 문서 전체 구조 count 자동 비교
- [x] `pageNumber` tag로 section 경계를 복원하고 병합 cell 중복을 제거하는 최소 adapter
- [x] AIDA adapter의 section·semantic text·image/resource 보존 가능성 판정
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

코드 관문과 실사용 AIDA HWPX의 privacy-safe identity 검증은 통과했다. Windows 한/글
재열기는 V3 전체의 외부 호환성 관문으로 계속 추적한다.

## 완료한 코드 관문: V3-2 text patch와 Save As

1. [x] UTF-8 section에서 단순 `hp:t` source span과 결정적 text node ID를 만든다.
2. [x] revision·UTF-16 범위를 검증하는 `ReplaceTextCommand`와 inverse를 만든다.
3. [x] XML escape, 공백·tab·line break, 빈 node와 Unicode 경계를 검증한다.
4. [x] 수정 section 외 entry bytes와 unknown XML·binary를 그대로 보존한다.
5. [x] `LossReport`에 preserved/modified entry와 stale preview를 기록한다.
6. [x] 같은 directory temp write·flush·재개봉·identity·viewer 검증 후에만 Save As한다.
7. [x] 원본 불변, 기존 목적지 비덮어쓰기와 검증 실패 cleanup을 fault test로 확인한다.
8. [ ] 사용자 저장 확인 UI와 제한된 IPC는 transaction/history 이후 연결한다.

공개 fixture와 저장소 밖 AIDA HWPX 모두 한 text patch·Save As·재개봉을 통과했다. 현재
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

공개 fixture와 AIDA 실문서에서 transaction → undo → redo → Save As와 원본 hash 불변을
통과했다.

## 현재 milestone: V3-4 한국어 IME와 selection

1. [x] ordered XML `hp:t` ordinal을 `ViewerText.sourceAnchor`로 projection한다.
2. [x] source scanner anchor와 decoder anchor가 빈 text를 포함해 일치하는지 검증한다.
3. [x] composition 중간 input을 보류하고 종료 시 최소 UTF-16 diff 하나만 만든다.
4. [x] source package와 history를 renderer 밖 main-process session에 둔다.
5. [x] sender/session binding과 직렬 commit·undo·redo IPC를 검증한다.
6. [x] 최상위 단일 text 문단만 `plaintext-only` surface로 연결한다.
7. [x] `⌘Z`·`⇧⌘Z`, dirty 상태와 projection selection 복원을 연결한다.
8. [x] 패키지 AIDA에서 composition → undo → redo, 8쪽·이미지 4개·overflow 0을 검증한다.
9. [ ] 실제 macOS 두벌식 키보드로 삽입·삭제·범위 교체·조합 취소 matrix를 수동 확인한다.
10. [ ] re-pagination으로 문단이 다음 쪽으로 이동한 뒤 caret 복원을 확대 검증한다.
11. [ ] 검증형 Save As를 사용자 확인 UI와 제한된 IPC로 연결한다.

## 매 milestone 공통 완료 규칙

1. 실제 fixture와 공개 synthetic fixture를 각각 통과한다.
2. 개인정보나 본문을 로그·캡처·commit에 남기지 않는다.
3. V1 test, build와 public production matrix가 회귀하지 않는다.
4. 구현과 같은 commit에서 관련 설계·결정 문서를 갱신한다.
5. 완료 조건을 만족한 논리 단위로 한국어 commit을 만든다.
