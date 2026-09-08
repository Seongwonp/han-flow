# 공개 호환성 corpus 전략

기준일: 2026-09-08

이 문서는 Sprint 4에서 개인정보 없는 HWP/HWPX 호환성 입력을 30–50개까지 확대하기 위한
manifest, 자동 판정, 지표와 개인정보 보호 계약을 정의한다. 공개 synthetic HWPX 8종과 고정
HWP 1종을 `tests/fixtures/public/fixture_catalog.json`의 상위 ID로 묶고, 빠른 core 검증과
production DOM·HWP 앱/PDF 검증은 독립 pipeline으로 실행한다.

## 1. 역할 분리

- `verify:corpus`: OS와 GUI에 의존하지 않는 빠른 source package·decode·pagination 회귀다.
- `verify:matrix`: production 앱의 실제 DOM, 이미지 decode, virtualization과 overflow 회귀다.
- `verify:hwp-matrix`: 고정 HWP의 생성 결정성, 두 engine 구조, 앱·검색·PDF와 오류 5종 회귀다.
- 실제 문서와 한/글 왕복: 공개 자동화가 대신 완료 처리할 수 없는 외부 승인 관문이다.

core의 `estimatedPages`는 source layout 정보를 이용한 pagination 결과다. 실제 글꼴과 DOM 높이를
반영하는 production 페이지 수와 이름·의미를 섞지 않는다. 따라서 continuation fixture는 core
추정 3쪽과 production 2쪽을 별도로 기록한다. 대형 fixture의 core 추정은 2,499쪽이고 production
실측은 빌드·글꼴 환경에 따라 달라질 수 있어 exact 기준으로 고정하지 않는다. 2026-09-08 Windows
재검증에서는 19,503쪽 중 DOM 12쪽만 mount되어 virtualization 관문을 통과했다.

## 2. catalog와 manifest 계약

`fixture_catalog.json`은 소문자 고유 ID, `hwp`/`hwpx` 형식, category와 pipeline을 관리한다.
현재 pipeline은 `hwpx-core`, `hwpx-production`, `hwp-production` 세 가지다. 중복 ID·pipeline,
알 수 없는 pipeline과 형식이 맞지 않는 연결은 실행 전에 거부한다.

`tests/fixtures/public/hwpx_corpus_manifest.json`은 다음 항목을 명시한다.

- 안정적인 소문자 fixture ID와 category
- 허용 목록에 있는 synthetic generator와 옵션
- `opened` 또는 `rejected` 기대 결과
- section·table·cell·resource와 core `estimatedPages` exact 기대값
- 대형 문서처럼 범위가 중요한 경우 `minimumEstimatedPages`
- 거부 fixture의 안정적인 사용자 오류 code

중복 ID, 임의 generator, 빈 category와 잘못된 정수 기대값은 fixture 생성 전에 거부한다. HWPX
manifest의 모든 ID·category와 고정 HWP manifest의 `catalogId`·파일명도 catalog와 교차 검증한다.
corpus 추가는 catalog, generator 구현, manifest 기대값과 필요 회귀 테스트를 같은 commit에 포함한다.

## 3. 개인정보 없는 report

`npm run verify:corpus -- --output <report.json>`은 다음만 기록한다.

- ZIP timestamp를 제외하고 entry 이름·내용으로 계산한 `contentSha256`
- container byte 크기
- section·paragraph·table·cell·resource count
- marker 문단과 bullet·numbering 문단 count
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
| list-markers | lists-and-numbering | 글머리표 2개·DIGIT 번호 2개의 marker 순서 |
| round-trip-sentinels | package-preservation | unknown XML·binary 보존용 package |
| large-progressive | large-document | 80개 section과 19,512개 paragraph |
| invalid-package | invalid-package | 필수 header가 없는 package 거부 |

2026-09-08 기준 8/8이 통과한다. 합계는 section 87개, marker 문단 13개(bullet 5·numbering 8),
table 7개, cell 29개, resource 15개와 core 추정 2,510쪽이다. 전용 `list-markers` fixture는
marker 4개(bullet 2·numbering 2)를 exact 값으로 검사한다. 독립 두 JSON report의 SHA-256
`85F82D921D2EB273D41E7E0208CAB155D51C8261B0BD8698B87D492162AFEB55`가 일치했다.

## 5. 확대 순서

1. 다단, 각주·수식, 머리말·꼬리말 variant를 지원 구현과 함께 공개 synthetic HWPX로 추가한다.
2. 실패한 실제 문서는 본문을 복사하지 않고 같은 구조를 재현하는 최소 generator로 축소한다.
3. 같은 fixture ID의 core 추정과 DOM 실측을 나란히 집계하는 통합 요약을 추가한다.
4. corpus 30–50개에서 열기 성공률, crash·timeout, 본문 문자 수와 구조 보존률을 집계한다.

실제 문서의 hash·본문·캡처는 공개 manifest와 report에 포함하지 않는다. 공개로 재현할 수 없는
관찰은 비식별 수치만 검증 이력에 분리해서 기록한다.
