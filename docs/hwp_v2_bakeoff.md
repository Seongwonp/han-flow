# HWP V2-0 parser bake-off

기준일: 2026-07-24

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
그림 개체 4, PNG resource 2, semantic text 6,053자다. image block 4와 binary 2는 원본
구조와 맞지만 표가 2개 적고, Kordoc의 265 cell은 HWPX 154 cell과 정의가 다르다. HWPX 전체
문단 303개와 직접 대응할 cell paragraph·section 경계도 Kordoc의 공개 IR에는 나타나지
않는다. Kordoc text는 HWPX semantic 기준보다 52자, 기준 PDF 6,077자보다 28자 많다.
control text의 포함 범위와 누락된 table 종류를 다음 probe에서 구분해야 한다.

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

- `kordoc`은 빠르고 기존 `ViewerDocument` adapter에 가까우나 page geometry와 cell 내부
  paragraph·section 경계를 공개 IR에서 복원할 수 없고 일부 table 구조의 보존 여부가
  미확인이다.
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

1. Kordoc 공개 IR에서 사라진 section·cell paragraph 경계를 adapter에서 복원할 수 있는지 판정
2. rhwp page별 text count가 기준 8페이지에서 합쳐지거나 누락되는 지점 진단
3. header/footer와 cell paragraph를 별도 count로 분리
4. 같은 HWP를 한컴에서 직접 출력한 PDF인지 reference provenance 재확인
5. 표·이미지·머리말 중심의 개인정보 없는 HWP fixture 추가
