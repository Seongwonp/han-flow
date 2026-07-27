# Han-Flow 실행 계획

기준일: 2026-07-27

이 문서는 현재 작업 순서를 기록한다. 과거 editor prototype 계획은 현재 제품 범위가 아니며
[제품 비전과 로드맵](vision_and_roadmap.md)에서 V3로 다시 정의했다.

## 현재 milestone: V2 fixed-page 품질 관문

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

### 다음 작업 순서

1. 개인정보 없는 표·이미지·머리말 HWP fixture 추가
2. `verify:hwp-matrix`를 package·PDF 회귀 관문에 연결
3. `FileHeader`·암호·DRM·배포용 문서 감지와 오류 UX

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

## 진행 중 milestone: V2-1 importer 경계

- [x] 확장자 분기와 CFB magic 기반 HWP preflight
- [ ] `DocumentImporter`와 format-neutral IPC event
- [x] HWP parser 전용 Web Worker 격리
- [x] 200 MiB 입력 제한
- [x] 30초 open·15초 page timeout과 Worker 강제 종료형 load cancellation
- [x] `.hwp` Finder association, dialog, drop
- [ ] 암호·DRM·배포용·손상 입력 오류 UX
- [ ] 기존 `hwp_parser.ts` prototype 제거 또는 명시적 격리

## 매 milestone 공통 완료 규칙

1. 실제 fixture와 공개 synthetic fixture를 각각 통과한다.
2. 개인정보나 본문을 로그·캡처·commit에 남기지 않는다.
3. V1 test, build와 public production matrix가 회귀하지 않는다.
4. 구현과 같은 commit에서 관련 설계·결정 문서를 갱신한다.
5. 완료 조건을 만족한 논리 단위로 한국어 commit을 만든다.
