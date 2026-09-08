# 공개 호환성 corpus 전략

기준일: 2026-09-08

이 문서는 Sprint 4에서 개인정보 없는 HWP/HWPX 호환성 입력을 30–50개까지 확대하기 위한
manifest, 자동 판정, 지표와 개인정보 보호 계약을 정의한다. 첫 구현은 공개 synthetic HWPX 7종을
하나의 manifest와 빠른 core 검증기로 묶는다. 고정 HWP는 기존 `verify:hwp-matrix`를 유지하며
후속 단계에서 같은 상위 catalog에 연결한다.

## 1. 역할 분리

- `verify:corpus`: OS와 GUI에 의존하지 않는 빠른 source package·decode·pagination 회귀다.
- `verify:matrix`: production 앱의 실제 DOM, 이미지 decode, virtualization과 overflow 회귀다.
- `verify:hwp-matrix`: 고정 HWP의 생성 결정성, 두 engine 구조, 앱·검색·PDF와 오류 5종 회귀다.
- 실제 문서와 한/글 왕복: 공개 자동화가 대신 완료 처리할 수 없는 외부 승인 관문이다.

core의 `estimatedPages`는 source layout 정보를 이용한 pagination 결과다. 실제 글꼴과 DOM 높이를
반영하는 production 페이지 수와 이름·의미를 섞지 않는다. 따라서 continuation fixture는 core
추정 3쪽과 production 2쪽, 대형 fixture는 core 추정 2,499쪽과 production 9,767쪽을 각각 독립된
회귀 기준으로 유지한다.

## 2. manifest 계약

`tests/fixtures/public/hwpx_corpus_manifest.json`은 다음 항목을 명시한다.

- 안정적인 소문자 fixture ID와 category
- 허용 목록에 있는 synthetic generator와 옵션
- `opened` 또는 `rejected` 기대 결과
- section·table·cell·resource와 core `estimatedPages` exact 기대값
- 대형 문서처럼 범위가 중요한 경우 `minimumEstimatedPages`
- 거부 fixture의 안정적인 사용자 오류 code

중복 ID, 임의 generator, 빈 category와 잘못된 정수 기대값은 fixture 생성 전에 거부한다. corpus
추가는 generator 구현, manifest 기대값과 필요 회귀 테스트를 같은 commit에 포함한다.

## 3. 개인정보 없는 report

`npm run verify:corpus -- --output <report.json>`은 다음만 기록한다.

- ZIP timestamp를 제외하고 entry 이름·내용으로 계산한 `contentSha256`
- container byte 크기
- section·paragraph·table·cell·resource count
- 비공백 문자 **수**와 diagnostic count
- core `estimatedPages`, fixture별 판정과 실패 이유

본문 문자열, 파일의 로컬 절대 경로, 사용자 이름, ZIP timestamp와 실행 시간은 report에 넣지
않는다. 같은 source와 dependency로 두 번 실행한 report는 byte-for-byte 동일해야 한다.

## 4. 현재 공개 HWPX corpus

| ID | 범주 | 핵심 관문 |
| --- | --- | --- |
| baseline | document-baseline | 2개 section, 표·resource와 3쪽 추정 |
| cell-continuation | table-pagination | 긴 cell, 반복 머리글과 뒤쪽 anchor table |
| images-rowspan | images-and-span | PNG 12개와 `rowSpan` 원점 cell |
| table-columns | table-structure | 반복 머리글을 포함한 3×3 logical grid |
| round-trip-sentinels | package-preservation | unknown XML·binary 보존용 package |
| large-progressive | large-document | 80개 section과 19,512개 paragraph |
| invalid-package | invalid-package | 필수 header가 없는 package 거부 |

2026-09-08 기준 7/7이 통과한다. 합계는 section 86개, table 7개, cell 29개, resource 15개와
core 추정 2,509쪽이다. 독립 두 실행의 JSON SHA-256 일치를 확인했다.

## 5. 확대 순서

1. HWP 고정 fixture와 기존 matrix를 상위 catalog에서 참조하되 무거운 앱·PDF 실행은 분리한다.
2. 다단, 각주·수식·목록, 머리말·꼬리말 variant를 공개 synthetic HWPX로 추가한다.
3. 실패한 실제 문서는 본문을 복사하지 않고 같은 구조를 재현하는 최소 generator로 축소한다.
4. production matrix 결과도 동일한 fixture ID로 연결해 core 추정과 DOM 실측을 나란히 본다.
5. corpus 30–50개에서 열기 성공률, crash·timeout, 본문 문자 수와 구조 보존률을 집계한다.

실제 문서의 hash·본문·캡처는 공개 manifest와 report에 포함하지 않는다. 공개로 재현할 수 없는
관찰은 비식별 수치만 검증 이력에 분리해서 기록한다.
