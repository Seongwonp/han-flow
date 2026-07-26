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
npm run test:probe
```

`probe:hwp`는 두 후보를 별도 process로 병렬 실행한다.

- `kordoc`: Node process에서 semantic IR을 요약
- `kordoc adapter`: section tag와 병합 grid를 정규화한 최소 `ViewerDocument` 구조를 요약
- `@rhwp/core`: hidden Electron renderer에서 실제 Canvas font metric으로 모든 page SVG 생성
- `--hwpx`: build된 Han-Flow decoder로 HWPX `ViewerDocument` 구조를 같은 schema로 요약
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

기준 HWPX와 PDF는 8페이지이고 PDF 비공백 text는 6,077자다. 첫 페이지 867자와 마지막 두
페이지 322·424자는 기준과 같지만 중간 pagination이 합쳐졌고 총 58자가 적다. portrait와
landscape page viewBox는 모두 생성됐다. 현재 결과만으로는 fixed-page renderer를 바로
채택할 수 없다.

## 현재 판단

- `kordoc`은 빠르고 section 경계, 병합 cell 원점, semantic text와 image resource를
  `ViewerDocument` 모양으로 정규화할 수 있다. 그러나 문단 102개와 표 2개가 부족하고 layout
  geometry·테두리·머리말/꼬리말이 없어 단독 renderer 후보에서는 제외한다.
- `@rhwp/core`는 이미지와 실제 page SVG를 제공하지만 AIDA page/text 기준에서 차이가 있다.
- 두 후보를 결합하거나 fork하기 전에 차이가 발생한 구조를 **본문 없이 count와 source
  위치로** 좁힌다.
- 후보 package는 dev dependency로만 고정해 production import graph에서 제외한다. `kordoc`의
  OCR/PDF 선택 dependency까지 개발 설치에 들어오므로 lockfile·설치 크기와 audit 결과는
  유지보수 감점 항목으로 기록한다. 프로젝트 전체 `omit=optional`은 Rollup의 macOS binary도
  제거해 V1 build를 깨뜨리므로 사용하지 않는다.
- production `.app`을 다시 패키징해 `app.asar` 1,294개 entry에 `kordoc`,
  `@rhwp/core`, `rhwp_bg.wasm`이 없음을 확인했다.

## 다음 판정 작업

1. rhwp page별 text count가 기준 8페이지에서 합쳐지거나 누락되는 지점 진단
2. rhwp SVG와 Kordoc semantic text를 결합할 때 search·접근성·PDF shell 경계 설계
3. 후보별 PDF 출력과 section별 자동 비교
4. 같은 HWP를 한컴에서 직접 출력한 PDF인지 reference provenance 재확인
5. 표·이미지·머리말 중심의 개인정보 없는 HWP fixture 추가
