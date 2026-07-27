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
승격한다. 최종 채택은 정제된 SVG를 기존 virtualization/PDF shell에 연결하고 package
크기·peak memory를 측정한 뒤 결정한다.

### fixed-page 앱 연결

2026-07-27에 기존 flow `ViewerDocument`를 수정하지 않고 별도 `FixedPageDocument`와 페이지별
용지 크기·section index adapter를 추가했다. main은 200 MiB와 CFB magic을 검사한 뒤 byte만
전달하고, renderer가 WASM을 지연 초기화한다. 화면 페이지는 SVG 원문을 React HTML로 직접
주입하지 않는다. `script`, `foreignObject`, event attribute와 외부 URL이 없는지 검사한 뒤
blob image로 표시한다. CSP도 외부 script 없이 WebAssembly 컴파일과 blob image만 허용한다.

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
| warm 첫 화면 p50 / p95 (20회) | 327 / 393 ms |
| cold 첫 화면 p50 / p95 (20회) | 797 / 873 ms |
| cold 최소 / 최대 | 757 / 898 ms |
| production WASM asset | 약 6.96 MB |
| renderer adapter chunk | 약 0.28 MB |
| unsigned arm64 `.app` / `app.asar` | 약 332 MB / 112.8 MB |

`electron-vite preview` 시각 검증에서는 요청→첫 화면이 약 1.1초였지만, 실제 unsigned
패키지 앱의 격리된 cold/warm 각 20회 측정에서는 cold p95 873ms와 최대 898ms로 1초 목표를
통과했다. 따라서 speculative 성능 변경은 하지 않고 이 수치를 V2 기준선으로 고정한다.

blob image 경계는 SVG text selection/search를 제공하지 않고, 현재 `printToPDF`의 단일 custom
page size로는 세로·가로 혼합 문서의 출력 일치를 아직 보증할 수 없다. `.app`과 `app.asar`
값은 현재 절대 크기이며 V1 기준 대비 증가량은 다음 package 측정에서 분리한다.

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
- `kordoc`은 production renderer가 아니라 semantic 구조 비교 oracle로 유지한다. rhwp SVG의
  text layer가 검색·접근성 요구를 만족하는지 확인하기 전에는 두 parser를 함께 번들하지 않는다.
- `@rhwp/core`는 fixed-page 연결 실험을 위해 production dependency로 승격했다. Vite는
  WASM 약 6.96 MB와 adapter 약 0.28 MB를 별도 asset/chunk로 만들어 HWPX 경로에서 지연
  로딩한다. `kordoc`은 dev dependency와 비교 oracle로만 유지한다.
- `kordoc`의 OCR/PDF 선택 dependency까지 개발 설치에 들어오므로 lockfile·설치 크기와 audit
  결과는 유지보수 감점 항목으로 기록한다. 프로젝트 전체 `omit=optional`은 Rollup의 macOS
  binary도 제거해 V1 build를 깨뜨리므로 사용하지 않는다.

## 다음 판정 작업

1. rhwp SVG text layer의 검색·접근성 가능성 및 blob image 경계 유지 여부 판정
2. fixed-page shell의 mixed-orientation PDF 출력, peak memory와 package 증가량 측정
3. parser의 renderer 격리, timeout과 load cancellation 구현
4. 점수표와 main/oracle 역할을 확정하는 ADR 작성
5. 표·이미지·머리말 중심의 개인정보 없는 HWP fixture 추가
