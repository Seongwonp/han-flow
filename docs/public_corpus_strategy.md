# 공개 호환성 corpus 전략

기준일: 2026-09-28

이 문서는 Sprint 4에서 개인정보 없는 HWP/HWPX 호환성 입력을 30–50개까지 확대하기 위한
manifest, 자동 판정, 지표와 개인정보 보호 계약을 정의한다. 공개 synthetic HWPX 9종과 고정
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
- 허용 목록에 있는 synthetic generator와 옵션, 또는 `"source": "file"` 외부 파일 항목
- `opened` 또는 `rejected` 기대 결과
- section·table·cell·resource·diagnostic·다단 구조와 core `estimatedPages` exact 기대값
- 대형 문서처럼 범위가 중요한 경우 `minimumEstimatedPages`
- 거부 fixture의 안정적인 사용자 오류 code

중복 ID, 임의 generator, 빈 category와 잘못된 정수 기대값은 fixture 생성 전에 거부한다. HWPX
manifest의 모든 ID·category와 고정 HWP manifest의 `catalogId`·파일명도 catalog와 교차 검증한다.
corpus 추가는 catalog, generator 구현, manifest 기대값과 필요 회귀 테스트를 같은 commit에 포함한다.

`source`가 없으면 `generator`로 본다. `"source": "file"` 항목은 `tests/fixtures/public/` 기준
상대 `file` 경로, `origin`(url·publisher·license·retrievedAt·producer), 파일 byte 전체의
`sha256`과 literal `personalData: false`를 필수로 가진다. license는 `KOGL-1`·`CC-BY-4.0`·
`Apache-2.0`·`MIT`·`project-authored`·`other`만 허용하고, 절대 경로·`..`·두 종류 항목의 혼합은
거부한다. catalog에서는 이 항목을 `"provenance": "external"`(기본 `synthetic`)로 표시하며 두
표시는 서로 대응해야 한다. `verify:corpus`는 decode 전에 sha256을 확인해 불일치를 fixture 실패로
보고한다. 반입 규칙과 `npm run corpus:intake`는 `tests/fixtures/public/external/README.md`에 있다.

## 3. 개인정보 없는 report

`npm run verify:corpus -- --output <report.json>`은 다음만 기록한다.

- ZIP timestamp를 제외하고 entry 이름·내용으로 계산한 `contentSha256`
- container byte 크기
- section·paragraph·table·cell·resource count
- marker 문단과 bullet·numbering 문단 count
- 비공백 문자 **수**, diagnostic·다단 section·선언된 단 count
- core `estimatedPages`, fixture별 판정과 실패 이유
- fixture별 `source`, 외부 파일의 license·producer

본문 문자열, 외부 파일의 출처 URL, 파일의 로컬 절대 경로, 사용자 이름, ZIP timestamp와 실행 시간은 report에 넣지
않는다. 같은 source와 dependency로 두 번 실행한 report는 byte-for-byte 동일해야 한다.

## 4. 현재 공개 HWPX corpus

| ID | 범주 | 핵심 관문 |
| --- | --- | --- |
| baseline | document-baseline | 2개 section, 표·resource와 3쪽 추정 |
| cell-continuation | table-pagination | 긴 cell, 반복 머리글과 뒤쪽 anchor table |
| images-rowspan | images-and-span | PNG 12개와 `rowSpan` 원점 cell |
| table-columns | table-structure | 반복 머리글을 포함한 3×3 logical grid |
| list-markers | lists-and-numbering | 글머리표 2개·DIGIT 번호 2개의 marker 순서 |
| multi-column-layout | multi-column-layout | 명시적 단 나눔·높이 기반 2단 흐름과 DOM grid |
| round-trip-sentinels | package-preservation | unknown XML·binary 보존용 package |
| large-progressive | large-document | 80개 section과 19,512개 paragraph |
| invalid-package | invalid-package | 필수 header가 없는 package 거부 |

2026-09-13 기준 9/9가 통과한다. 합계는 111,424 bytes, section 88개, marker 문단 13개
(bullet 5·numbering 8), 다단 section 1개·선언 단 2개·diagnostic 0개, table 7개, cell 29개,
resource 15개와 core 추정 2,512쪽이다. `multi-column-layout`은 명시적 `columnBreak`, 자동 높이
전환과 2쪽 단 순서를 검사한다. 독립 두 JSON report의 SHA-256
`10A806F944CFF272584AD3CFF260E5165CE2AE695AFBC42BC51828C2500F8A79`가 일치했다. Windows
production matrix 6종도 통과했고 이 fixture의 DOM 실측은 1쪽, 단 2개, 양쪽 비공백 문자
17·43개와 overflow 0이었다. core 추정과 DOM 실측 페이지 수는 의미가 달라 별도로 기록한다.

## 5. 확대 순서

1. `RIGHT`·`MIRROR`·비동일 너비 다단, 각주·수식과 머리말·꼬리말 variant를 추가한다.
2. 실패한 실제 문서는 본문을 복사하지 않고 같은 구조를 재현하는 최소 generator로 축소한다.
3. 같은 fixture ID의 core 추정과 DOM 실측을 나란히 집계하는 통합 요약을 추가한다.
4. corpus 30–50개에서 열기 성공률, crash·timeout, 본문 문자 수와 구조 보존률을 집계한다.
   synthetic만으로는 채울 수 없으므로 6절의 실제 한/글 공개 HWPX를 `source: file`로 더한다.

저장소 밖 실사용 문서의 hash·본문·캡처는 공개 manifest와 report에 포함하지 않는다. 공개로
재현할 수 없는 관찰은 비식별 수치만 검증 이력에 분리해서 기록한다. 6절의 외부 fixture는 공개
라이선스로 재배포 가능한 파일만 대상으로 하며 이 규칙의 예외가 아니다.

## 6. 실제 한/글 fixture 확보 계획

현재 HWPX는 모두 프로젝트 generator가 만든 synthetic이다. 실제 한컴 제품이 저장한 구조를
확인하기 위해 다음 순서로 외부 fixture를 확보한다.

### 1단계 — 공개 실제 HWPX 수집(Windows에서 바로)

- 출처: 정부24 민원서식, 부처 보도자료 HWPX 첨부, 법제처 입법예고, 나라장터 공고, 교육청 공문
  양식. 공공누리 1유형(`KOGL-1`)만 받는다.
- 오픈소스 테스트 파일: hwpxlib(Apache-2.0), python-hwpx, hwp.js 샘플. 저장소별 라이선스를
  확인해 기록한다.
- 목표 20종: 공문(머리말·쪽번호), 서식(병합 표·테두리), 보도자료(이미지·다단), 가정통신문(목록),
  논문 양식(각주·수식)과 100쪽 이상 1종.
- 각 파일은 `npm run corpus:intake`로 `source: file` 항목을 만들어 sha256·출처·라이선스·producer를
  기록한다.

### 2단계 — 편집 거부 구조 제작(한/글 필요)

- 한컴독스 웹(무료, HWPX 저장) 또는 한컴오피스 체험판으로 편집 코어가 거부하는 구조를 일부러
  만든다: 문단 1개에 run 3개, 병합 머리글, 중첩 표, 인라인 이미지, 각주, 수식.
- "실제 문서에서 편집 capability가 거부하는 비율"을 corpus 지표로 추가한다.
- 왕복: Han-Flow 편집 → 한컴독스/한/글 재개봉·저장 → Han-Flow 재개봉. 결과는
  [Windows 한/글 재열기 matrix](v3_windows_round_trip_matrix.md)의 WIN-01~10에 연결한다.

### 3단계 — 저장본 승인 근거

- 한컴오피스 뷰어(Windows 무료)에서 Han-Flow 저장본이 복구 경고 없이 열리는지 확인하고, 이를
  외부 승인 근거로 기록한다.

### Linux 환경 활용

- VirtualBox Ubuntu: 한컴오피스 리눅스판(우분투용 베타)의 현재 다운로드 가능 여부를 먼저
  확인하고, 가능하면 2단계를 VM에서 수행한다.
- Noto·Nanum 글꼴 폴백을 실측한다.
- `electron-builder --linux dir` package로 드래그앤드롭, Ctrl 단축키와 Save As GUI E2E를 확인한다.
- Docker·WSL은 GUI 없는 `verify:corpus`, xvfb E2E와 Linux CI job 재현에 사용한다.
- macOS 물리 IME, 서명·공증은 Linux 결과로 갈음하지 않는다.
