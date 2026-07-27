# HWP V2-0 parser bake-off

기준일: 2026-07-26

## 목적

`@rhwp/core`와 `kordoc`을 production 앱에 연결하기 전에 같은 HWP 5.0 입력과 개인정보
비노출 schema로 비교한다. 이 문서의 숫자는 후보 채택을 위한 초기 측정이며 호환성 보증이
아니다.

## probe

```bash
npm run probe:hwp -- /path/to/document.hwp
npm run probe:hwp -- /path/to/document.hwp --hwpx /path/to/reference.hwpx
npm run probe:hwp -- /path/to/document.hwp --hwpx /path/to/reference.hwpx --pdf /path/to/reference.pdf
npm run test:probe
```

`probe:hwp`는 두 후보를 별도 process로 병렬 실행한다.

- `kordoc`: Node process에서 semantic IR을 요약
- `kordoc adapter`: section tag와 병합 grid를 정규화한 최소 `ViewerDocument` 구조를 요약
- `@rhwp/core`: hidden Electron renderer에서 실제 Canvas font metric으로 모든 page SVG 생성
- `--hwpx`: build된 Han-Flow decoder로 HWPX `ViewerDocument` 구조를 같은 schema로 요약
- `--pdf`: Poppler text layer와 rhwp SVG를 본문 없이 페이지 그룹·문자 다중집합으로 비교
- 공통 preflight: CFB magic, HWP signature/version, 보안 flag, stream 크기
- 공통 제한: 200 MiB 입력 상한, 60초 timeout, signal 전달

출력은 파일명과 본문을 포함하지 않는다. 입력 크기와 짧은 SHA-256 식별자, 구조 count,
페이지별 비공백 글자 수, 시간과 분류된 오류만 JSON 한 줄로 출력한다.

## AIDA 첫 측정

private AIDA `.hwp`를 2회 실행해 다음 범위를 확인했다. 실제 파일과 출력 SVG는 저장소에
넣지 않았다.

### 공통 container

- HWP version: 5.1.0.1
- file size: 950,272 bytes
- stream: 13
- compressed: yes
- encrypted / distribution / script / DRM: no

### `kordoc` 4.2.7

| 지표 | 결과 |
| --- | ---: |
| parse | 약 15–17 ms |
| probe total | 약 118–146 ms |
| section | 3 |
| top-level/recursive block | 56 |
| heading / paragraph | 6 / 33 |
| table / cell | 13 / 265 |
| image block / extracted binary | 4 / 2 |
| 비공백 text | 6,105 |
| warning code | 없음 |

자동 비교한 HWPX `ViewerDocument` 기준은 section 3, paragraph 303, table 15, cell 154,
그림 개체 4, PNG resource 2, semantic text 6,053자다. Kordoc 원시 IR의 top-level block은
모두 `pageNumber`를 가지고 있으며 AIDA에서는 실제 물리 페이지가 아니라 section 1·2·3의
경계로 동작했다. block 분포도 22·1·15로 안정적으로 분리돼 section 경계는 추가 재파싱 없이
복원할 수 있다.

Kordoc의 265 cell은 병합 영역에 포함된 grid slot까지 각 cell처럼 채운 값이다. adapter가
앞선 `rowSpan`·`colSpan`이 덮은 slot 115개를 제외하면 실제 원점 cell은 150개가 된다.
이 과정에서 중복 text 52자가 제거돼 semantic text가 HWPX 기준과 같은 **6,053자**가 됐다.
그림 개체 4개도 보존되며 동일 binary를 SHA-256으로 합치면 resource 2개로 기준과 일치한다.

최소 adapter 결과는 다음과 같다.

| 지표 | Kordoc 원시 IR | 최소 adapter | HWPX 기준 | adapter delta |
| --- | ---: | ---: | ---: | ---: |
| section | 3 | 3 | 3 | 0 |
| paragraph | 39 | 201 | 303 | -102 |
| table | 13 | 13 | 15 | -2 |
| cell | 265 | 150 | 154 | -4 |
| image object | 4 | 4 | 4 | 0 |
| image resource | 2 | 2 | 2 | 0 |
| semantic text | 6,105 | 6,053 | 6,053 | 0 |

adapter는 cell에 중첩 block이 있으면 문단 순서를 유지하고, 없으면 평탄화 text로 최소 한 문단을
만든다. 그럼에도 HWPX보다 문단이 102개 적다. Kordoc IR이 버린 빈 문단·control 문단과 누락된
표 2개는 공개 IR만으로 복원할 수 없다. 용지·여백, 문단 정렬·간격, 표 크기·테두리·배경,
머리말·꼬리말·쪽 번호도 제공되지 않는다. 따라서 Kordoc은 **semantic text 보조 경로로는
유효하지만 단독 visual renderer로는 부적합**하다.

개발 의존성을 포함한 `npm audit`에서는 총 20건(보통 5, 높음 15)이 보고됐고 `kordoc`과 그
선택 dependency도 높음 항목에 포함됐다. 반면 `--omit=dev` production 집계는 기존 직접
dependency를 포함한 4건(보통 1, 높음 3)이며 probe 후보는 포함되지 않았다. 이 결과는
`kordoc`을 production dependency로 승격하지 않는 현재 경계를 유지할 근거다.

### `@rhwp/core` 0.7.19

| 지표 | 결과 |
| --- | ---: |
| WASM init | 약 25–90 ms |
| parse | 약 90–124 ms |
| 7 page SVG render | 약 232–256 ms |
| probe total | 약 405–477 ms |
| page | 7 |
| image element | 4 |
| SVG 비공백 text | 6,019 |
| total SVG | 약 4.57 MB |
| script/foreignObject/외부 URL | 0 |

기준 HWPX와 PDF는 8페이지이고 PDF 비공백 text는 6,077자다. privacy-safe 정렬기는 공백을
제거하고 NFC 정규화한 text를 페이지 길이로 먼저 정렬한 뒤, 순서 기반 edit 통계와 순서에
영향받지 않는 문자 다중집합 보존율을 함께 계산한다. 표는 PDF와 SVG의 DOM 읽기 순서가 다를
수 있으므로 콘텐츠 보존 판정에는 문자 다중집합을 우선한다.

| 기준 PDF | rhwp | PDF 글자 | rhwp 글자 | 문자 다중집합 보존율 |
| --- | --- | ---: | ---: | ---: |
| 1 | 1 | 867 | 867 | 100% |
| 2 | 2 | 1,650 | 1,638 | 99.27% |
| 3–4 | 3 | 1,502 | 1,490 | 99.20% |
| 5 | 4 | 174 | 171 | 97.70% |
| 6 | 5 | 1,138 | 1,107 | 97.19% |
| 7 | 6 | 322 | 322 | 99.69% |
| 8 | 7 | 424 | 424 | 99.76% |

문서 전체는 PDF 6,077자 중 rhwp에 6,019자가 있고 추가 문자는 없다. 다중집합 보존율은
**99.05%**다. 빠진 58자는 문장부호 57자와 숫자 1자이며 **한글과 영문 누락은 0자**다.
따라서 58자 차이는 본문 단어 유실이 아니라 불릿·표식·쪽 번호 계열의 text layer 차이다.

`getSectionCount()`와 숫자 필드만 남긴 `getPageInfo()`도 함께 검사했다. rhwp는 section 3개를
보존하며 페이지 소속은 첫 세로 section 4장, 가로 section 1장, 마지막 세로 section 2장이다.
기준 PDF에서 첫 section이 5장이던 것만 4장으로 줄었다. 즉 8→7페이지 차이는 section 경계
유실이 아니라 글꼴 폭·행 높이 차이로 첫 section이 한 장 적게 조판된 결과다.

기준 PDF 3·4페이지와 대응하는 rhwp 3페이지를 opt-in local PNG로 다시 렌더링했다. 앞쪽 표와
뒤쪽 본문이 한 페이지 위·아래로 이어지지만 겹침·잘림·테두리 파손 없이 읽을 수 있었다.
portrait와 landscape viewBox도 모두 생성됐다. 이 결과로 `@rhwp/core`를 **주 visual 후보**로
승격한다. fixed-page shell, package 크기, peak memory와 parser 격리 관문을 통과했다.
이 결과를 근거로 [ADR-0001](adr/0001-hwp-parser-roles.md)에서 production visual engine으로
최종 채택했다.

### fixed-page 앱 연결

2026-07-27에 기존 flow `ViewerDocument`를 수정하지 않고 별도 `FixedPageDocument`와 페이지별
용지 크기·section index adapter를 추가했다. main은 200 MiB와 CFB magic을 검사한 뒤 byte만
전달한다. renderer adapter는 전용 Web Worker에서 WASM을 초기화하고 document 생성·page
info·SVG·text layout 작업을 수행한다. 화면 페이지는 SVG 원문을 React HTML로 직접 주입하지
않는다. `script`, `foreignObject`, event attribute와 외부 URL이 없는지 검사한 뒤 blob
image로 표시한다. CSP도 외부 script 없이 WebAssembly 컴파일과 blob image만 허용한다.

50페이지 이하는 전체 page shell을 만들되 SVG 생성은 페이지별 queue로 순차 실행하고, 50페이지
초과는 세로·가로 용지의 누적 높이를 계산해 viewport 주변만 mount한다. AIDA production
build smoke test 결과는 다음과 같다.

| 지표 | 결과 |
| --- | ---: |
| page / section | 7 / 3 |
| 세로 / 가로 page | 6 / 1 |
| image decode 실패 | 0 |
| page overflow | 0 |
| HWP 읽기 | 약 2 ms |
| WASM 초기화 | 약 47–117 ms |
| HWP parse | 약 125–256 ms |
| Worker 격리 후 warm 첫 화면 p50 / p95 (20회) | 203 / 237 ms |
| Worker 격리 후 cold 첫 화면 p50 / p95 (20회) | 535 / 614 ms |
| Worker 격리 후 cold 최소 / 최대 | 499 / 722 ms |
| Worker 격리 후 cold 앱 시작 / 요청→첫 화면 p95 | 302 / 364 ms |
| production WASM asset | 6.64 MiB |
| HWP Worker / renderer adapter chunk | 약 0.29 / 0.01 MB |
| unsigned arm64 `.app` / `app.asar` logical size | 324.27 / 100.67 MiB |
| V1 RC 대비 `.app` / `app.asar` 증가 | +6.96 MiB / +6.96 MiB |
| Worker 격리 후 HWP aggregate working set peak p50 / p95 (cold 5회) | 619.9 / 647.6 MiB |
| HWPX aggregate working set peak p50 / p95 (cold 5회) | 436.8 / 438.3 MiB |

텍스트 layer를 첫 image와 함께 만들면 cold p95가 1초 부근까지 올라갔다. 첫 page SVG image의
`load`를 첫 화면으로 확정하고, 좌표형 text layer와 2쪽 이후 렌더를 그 다음 유휴 구간에
시작하도록 바꿨다. Worker 격리 뒤 실제 unsigned 패키지 앱의 cold/warm 각 20회 측정에서
cold p95 614ms와 최대 722ms로 1초 목표를 통과했다. 문서마다 Worker를 새로 만들기 때문에
warm p95는 기존 125ms에서 237ms로 늘었지만 안전한 강제 취소와 UI thread 분리를 위해
허용한다. 측정기는 cold 앱 시작, 요청→model과 요청→첫 화면도 분리해 시작 회귀와 문서 처리
회귀를 구별한다.

### Worker 격리와 작업 취소

open 요청마다 Worker 수명주기를 새로 시작한다. 새 문서가 열리면 이전 Worker를 즉시
종료하므로 동기 WASM parse나 page render가 뒤에서 계속 실행되지 않는다. open은 30초,
page SVG·text layout은 15초 제한이며 timeout과 crash는 진행 중 RPC를 실패시키고 adapter의
문서 상태와 cache를 무효화한다. 응답은 요청 ID로 연결해 이전 문서 결과를 버린다.

Worker 결과는 다시 신뢰하지 않는다. SVG·text layout JSON은 parse 전에 각각 5천만 문자
상한을 확인하고 기존 element·URL, run 수·문자 수·좌표 검증을 그대로 통과한다. 패키지
AIDA 회귀에서 7페이지, 이미지 7개, 검색 4페이지·6건, 선택과 접근성 layer가 모두 유지됐고
HWPX 8페이지 경로도 통과했다.

### 검색·선택용 text layer

rhwp의 page text layout은 page별 `runs`에 text, x/y, width/height, font family/size와 가로
비율을 제공한다. adapter는 유한 좌표, run·문자 수와 family 길이 상한을 검사하고 page cache에
보관한다. 화면은 정제된 SVG를 계속 blob image로 표시하며, text는 React가 escape하는 투명
span으로 별도 렌더링한다. print media에서는 중복 출력을 막기 위해 text layer를 숨긴다.

private AIDA에서 text layout 비공백 글자는 페이지별
`867, 1650, 1499, 174, 1138, 322, 424`, 합계 6,074자다. 기준 PDF 6,077자와 3자 차이고,
SVG 내부 text 6,019자보다 55자를 더 보존한다. production 앱 검증은 본문을 출력하지 않고
검색 4페이지·6건, highlight 6개, DOM 선택 1자와 7개 page의 접근성 계약을 확인했다.

### 세로·가로 혼합 PDF

단일 custom page size를 쓰면 AIDA HWP의 7페이지가 모두 A4 세로로 출력됐다. fixed page마다
고유한 CSS named page와 원본 px 크기를 부여하고 `preferCSSPageSize`를 사용하도록 바꿨다.
인쇄 flex container를 좌측 정렬하지 않으면 가로 page의 왼쪽 열이 page 밖으로 밀렸으므로,
print media에서 원점을 고정하고 텍스트 보존 관문으로 이 회귀를 잡는다.

최종 production PDF는 1-4·6-7페이지가 약 594.96×841.92pt, 5페이지만 약
841.92×594.96pt다. 화면과 PDF 모두 7페이지이며, PDF 비공백 text는 페이지별
`866, 1638, 1490, 171, 1107, 322, 424`로 화면 text layer 대비 99.08%다. 첫·중간·끝과
가로 5페이지를 Poppler PNG로 재렌더링해 표·이미지·테두리의 잘림과 겹침이 없음을 확인했다.
동일 경로의 HWPX PDF도 8페이지와 페이지별 글자 수가 화면과 일치한다.

### peak memory와 package 증가량

V1 기준은 RC 완료 commit `cd8050d`를 당시 lockfile로 다시 설치·패키징한 unsigned arm64
앱이다. regular file logical bytes 합계와 `app.asar` 실제 byte를 비교한다. V1 `.app`은
317.31MiB, 현재 앱은 324.27MiB로 **6.96MiB(+2.19%)** 증가했다. `app.asar`는
93.71→100.67MiB로 **6.96MiB(+7.42%)** 증가했다.

첫 측정에서는 Vite asset과 production `node_modules`에 같은 6,963,835-byte WASM이 두 번
들어가 `.app` 증가량이 13.92MiB였다. `@rhwp/core`를 renderer build-time dependency로
옮겨 중복을 제거했고, 패키지 HWP/HWPX smoke test를 다시 통과했다. MIT license 원문은
`Contents/Resources/licenses/rhwp-MIT.txt`에 유지한다.

메모리는 격리된 cold 앱을 포맷별 5회 실행하고 visual E2E 시작부터 전체 page가 안정될 때까지
Electron 4개 process working set을 50ms 간격으로 합산했다. Worker 격리 후 0.91MiB HWP
7페이지는 p50/p95 **619.9/647.6MiB**, 0.89MiB HWPX 8페이지 기준선은
**436.8/438.3MiB**다. HWP p95는 격리 전보다 58.0MiB, HWPX보다 209.3MiB 높다. WASM heap,
Worker 수명주기, SVG/blob image와 GPU texture가 포함된 이 문서 쌍의 회귀 기준선이다.
macOS working set은 shared page를 process별로 중복 집계할 수 있어 앱의 고유
물리 메모리로 해석하지 않는다. 5회 p95는 표본상 최대값이며 공개 대형 HWP fixture가 생기면
표본 수와 문서 크기를 늘린다.

대표 페이지를 저장소 밖에서 확인할 때만 아래 opt-in 환경 변수를 사용한다. 기본 probe는
SVG나 PNG를 파일로 남기지 않는다.

```bash
HAN_FLOW_HWP_PROBE_VISUAL_DIR=/tmp/han-flow-rhwp \
HAN_FLOW_HWP_PROBE_VISUAL_PAGES=3 \
npm run probe:hwp -- /path/to/document.hwp --pdf /path/to/reference.pdf
```

## 현재 판단

- `kordoc`은 빠르고 section 경계, 병합 cell 원점, semantic text와 image resource를
  `ViewerDocument` 모양으로 정규화할 수 있다. 그러나 문단 102개와 표 2개가 부족하고 layout
  geometry·테두리·머리말/꼬리말이 없어 단독 renderer 후보에서는 제외한다.
- `@rhwp/core`는 section·세로/가로 용지·이미지와 본문 한글/영문을 보존하고 읽기 좋은 SVG를
  만든다. 기준보다 한 페이지 적지만 깨진 화면은 아니므로 주 visual 후보로 올린다.
- `kordoc`은 production renderer가 아니라 semantic 구조 비교 oracle로 유지한다. rhwp 좌표형
  text layer가 검색·선택·접근성 요구를 충족했으므로 이를 위해 두 parser를 함께 번들하지 않는다.
- `@rhwp/core`는 fixed-page 연결을 위한 renderer build-time dependency다. Vite는 WASM
  6.64 MiB와 adapter 약 0.28 MB를 별도 asset/chunk로 만들고 HWPX 경로에서는 지연 로딩한다.
  production `node_modules` 중복은 제거한다. `kordoc`은 dev dependency와 비교 oracle로만
  유지한다.
- `kordoc`의 OCR/PDF 선택 dependency까지 개발 설치에 들어오므로 lockfile·설치 크기와 audit
  결과는 유지보수 감점 항목으로 기록한다. 프로젝트 전체 `omit=optional`은 Rollup의 macOS
  binary도 제거해 V1 build를 깨뜨리므로 사용하지 않는다.

## 공개 HWP 회귀 fixture

`tests/fixtures/public/synthetic-layout.hwp`는 외부 문서나 blank template을 복사하지 않고
`HwpDocument.createEmpty()`에서 생성하고 FileHeader를 5.0.3.2로 기록한 12,800 byte의 고정
HWP다. 자체 문자열, Canvas PNG, 3×3 표와 두 쪽 반복 머리말을 포함하며 전체 SHA-256
`b665933da10ec276e8e21ddb1c9e6d2eec5440c9ac5d1bda9e5bc478bd136b9e`을 manifest에 기록한다.
두 번 생성한 결과는 byte 단위로 같았고 export 자기 재로드 전후 모두 2쪽이었다.

`npm run verify:hwp-matrix`의 독립 관찰 결과는 다음과 같다.

| 관문 | 결과 |
| --- | --- |
| kordoc semantic oracle | section 1, 표 1, 셀 9, 이미지/resource 1/1 |
| rhwp SVG | 2쪽, 이미지 요소 1, 위험 요소·속성 0 |
| production 앱 | 2쪽, overflow 0, 반복 머리말 2쪽·2회 검색 |
| production PDF | 2쪽 A4, 텍스트 보존율 98.6% |

private AIDA HWP 재검증에서는 인쇄 직전 마지막 SVG image decode가 끝나기 전에
`printToPDF`가 시작될 수 있는 race를 발견했다. 모든 fixed page DOM과 `naturalWidth > 0`인
이미지 수가 page count와 같을 때만 `pdf:ready`를 보내도록 수정했다. 이후 AIDA HWP는
7쪽 모두 출력됐고 마지막 쪽 424자를 포함해 전체 텍스트 보존율 99.08%를 회복했다.

## 다음 판정 작업

1. `FileHeader`·암호·DRM·배포용 문서 감지와 오류 UX
2. format-neutral `DocumentImporter`와 IPC 경계
3. 지원 불가·손상 HWP 공개 corpus를 `verify:hwp-matrix`에 추가
