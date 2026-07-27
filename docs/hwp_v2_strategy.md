# Han-Flow V2 HWP 5.0 조사와 도입 전략

기준일: 2026-07-27

## 결론

V2의 목표는 `.hwp` 5.0 문서를 **읽기 전용으로 열고, 읽기 좋은 레이아웃으로 표시하고,
PDF로 내보내는 것**이다. Han-Flow가 HWP 5.0 레코드 전체를 직접 구현하지 않는다. 공개
규격은 후보 파서의 출력 검증, 보안 경계 정의, Han-Flow 문서 모델로의 adapter 작성에
사용한다.

평가한 두 후보는 다음과 같다.

1. `@rhwp/core`: Rust/WASM 파서와 페이지 SVG renderer를 함께 사용해 레이아웃 보존 가능성을
   측정한다.
2. `kordoc`: TypeScript HWP 5.0 파서의 구조화된 IR을 Han-Flow `ViewerDocument`로
   정규화해 기존 pagination/renderer를 재사용할 수 있는지 측정한다.

private AIDA `.hwp`·동일 문서 `.hwpx`·기준 PDF 삼쌍과 production 앱 검증 결과
`@rhwp/core` 0.7.19를 **production visual engine**, `kordoc` 4.2.7을
**development-only semantic oracle**로 확정했다. 자동 fallback은 두지 않는다. 전체 근거와
92/54점 점수표는 [ADR-0001](adr/0001-hwp-parser-roles.md)에 있다. 라이브러리 README의
지원 범위는 호환성 보증으로 간주하지 않는다.

## 범위

### V2에서 하는 것

- HWP 5.0 CFB/OLE 컨테이너 식별과 지원 여부 판정
- 문단, 글자 스타일, 표, 이미지, 용지와 구역 정보의 read-only import
- 기존 macOS 열기, drag-and-drop, zoom, 가상화, PDF 흐름 연결
- 손상·암호·DRM·배포용 문서의 명시적인 오류 처리
- parser 격리, 입력 크기 제한, timeout, 취소
- 실제 문서와 synthetic fixture를 이용한 후보별 회귀 matrix

### V2에서 하지 않는 것

- HWP 5.0 레코드 전체를 Han-Flow에서 직접 재구현
- `.hwp` 저장, 수정, 암호 해제 또는 DRM 우회
- HWP 3.x 지원
- 한컴오피스와 픽셀 단위로 동일한 결과
- 후보 라이브러리의 editor UI를 Han-Flow에 포함

편집은 V3, 사용자 배포와 서명·공증은 V4 범위다.

## 공식 형식에서 확인한 사실

한글과컴퓨터의 revision 1.3 공개 문서에 따르면 HWP 5.0은 Windows Compound File에
기초한다. 문자 정보는 주로 UTF-16LE이고, 길이는 HWPUNIT(1/7,200 inch)를 사용한다.
`FileHeader`에는 signature, 버전, 압축·암호·배포용·DRM 등의 플래그가 있으며, `DocInfo`,
`BodyText/SectionN`, `BinData` 같은 storage와 stream에 스타일, 본문, 표·그림 자원이
나뉘어 저장된다. 압축된 `DocInfo`, `BodyText`, `BinData`는 플래그를 확인한 뒤 처리해야
한다.

Microsoft의 CFB 규격은 compound file을 storage와 stream의 계층으로 정의하고 FAT,
Mini FAT, sector chain과 directory entry의 무결성 조건을 둔다. 따라서 확장자만 보고
파싱해서는 안 되며 CFB magic, sector chain, HWP `FileHeader` signature와 version을
순서대로 확인해야 한다.

공개 HWP 5.0 규격은 이를 참고해 만든 결과물에 아래 문구를 UI, 매뉴얼, 도움말과 소스 중
존재하는 구성물에 표시하도록 요구한다. 현재 README와 production third-party notice에
기록하며 앱 내 정보 화면은 V4 배포 UI에서 연결한다.

> 본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

## 후보 조사

버전과 저장소 활동은 2026-07-24에 공식 GitHub API와 npm registry로 다시 확인했다.

| 후보 | 확인 버전 | 런타임·라이선스 | 장점 | Han-Flow 관점의 위험 | 판정 |
| --- | --- | --- | --- | --- | --- |
| `@rhwp/core` | 0.7.19 | Rust/WASM, MIT | HWP/HWPX parse, page count, 페이지 SVG renderer 제공. macOS Electron renderer에서 별도 JVM 없이 실행 가능 | WASM 약 7 MB, 0.x API, 기존 semantic renderer를 우회함. Web Worker memory 비용이 있음 | **production visual engine** |
| `kordoc` | 4.2.7 | TypeScript, MIT | Node 18+, CFB 기반 HWP parse, 문단·표·중첩 cell·이미지·일부 style을 구조화된 IR로 반환 | IR은 추출 중심이며 HWP 페이지 좌표·전체 문단/테두리 속성이 부족함. 현재 unpacked 약 11.1 MB | **development semantic oracle** |
| `hwp.js` | 0.0.3 | TypeScript, Apache-2.0 | 현재 프로젝트와 같은 `cfb`를 사용하고 paragraph, line segment, table, picture 모델을 노출 | 최신 release가 2020-10-01. 공개 타입과 오류 처리 범위가 작고 유지보수·보안 부담이 큼 | 비교·fallback |
| `hwplib` | 1.1.10 | Java, Apache-2.0 | 장기간 축적된 HWP read/write 구현과 표·그림·머리말 사례, 2026-07에도 저장소 활동 | JVM 번들·프로세스 기동이 1초 목표와 작은 macOS 앱에 불리함 | differential oracle |
| `unhwp` | 0.6.0 | Rust/native, MIT | macOS arm64/x64 binary, section streaming, structured JSON과 자원 추출 | Markdown/추출 중심이고 page renderer가 아님. native binary의 서명·패키징·IPC가 추가됨 | 성능·구조 oracle |
| `OpenHWP` | release 없음 | Rust, MIT | HWP parser와 중간 표현을 분리한 방향 | npm/WASM 배포가 없고 초기 단계라 Han-Flow가 bridge를 소유해야 함 | 관찰 대상 |
| `pyhwp` | 0.1 계열 | Python, AGPL-3.0 | 오래된 HWP 5.0 분석·추출 구현 | Python runtime, AGPL 배포 조건, 현대 Electron 직접 통합 부적합 | 제품 후보 제외 |

`hwplib`, `unhwp` 같은 oracle은 사용자가 보는 앱에 번들하지 않는다. 후보 간 결과가 다를 때
텍스트 순서, 표 구조, 이미지 개수와 지원 불가 판정을 교차 확인하는 개발 도구로만 검토한다.

## 채택 실험

### 기준 fixture

첫 milestone은 저장소 밖의 private AIDA 삼쌍이다.

- 원본 `.hwp`
- 같은 문서를 변환한 `.hwpx`
- 한컴에서 출력한 기준 `.pdf`

본문이나 캡처는 로그와 저장소에 남기지 않는다. 페이지 수, section·문단·표·이미지 수,
페이지별 비공백 글자 수, overflow 수, 첫 화면 시간만 기록한다. 개인정보 없는 공개 HWP
fixture도 직접 만들어 고정 SHA-256, 두 parser의 구조 비교, production 앱과 PDF 검증에
사용한다.

### 점수표

| 항목 | 가중치 | 통과 기준 |
| --- | ---: | --- |
| 레이아웃 안정성 | 35 | page count 차이와 overflow가 설명 가능하고 표·이미지가 본문을 가리지 않음 |
| 콘텐츠 보존 | 25 | 보이는 텍스트, 문단 순서, 표 cell, 이미지 수가 HWPX/PDF 기준과 일치 |
| 기존 기능 재사용 | 15 | zoom, virtualized page, dark chrome, PDF 흐름을 유지 |
| 열기 성능 | 15 | 패키지 앱에서 첫 화면 1초 목표를 측정하고 p50/p95 기록 |
| 보안·유지보수 | 10 | worker 격리, 제한·취소 가능, 라이선스와 update 경로가 명확 |

총점뿐 아니라 콘텐츠 유실이나 임의 코드 실행 가능성이 있으면 탈락시킨다. 직접 SVG 경로가
채택되면 semantic 검색·접근성 데이터가 별도로 확보되는지도 확인한다.

최종 점수는 `@rhwp/core` 92점, `kordoc` 54점이다. rhwp는 7쪽·3구역·혼합 용지,
PDF 문자 99.08%, cold p95 614ms와 공통 viewer/PDF shell을 보존했다. kordoc은 adapter의
semantic text가 기준과 같지만 문단 102개·표 2개와 visual geometry가 부족해 production
renderer 탈락 조건에 해당한다. 세부 배점은 [ADR-0001](adr/0001-hwp-parser-roles.md)을
단일 결정 기록으로 사용한다.

### 실험 산출물

- production 채택 경로와 분리된 후보별 독립 probe
- 같은 JSON schema로 된 후보별 진단 결과
- AIDA와 공개 fixture의 비교표
- dependency, license, binary size, cold/warm timing 기록
- `docs/adr/0001-hwp-parser-roles.md`의 최종 결정 기록

## 목표 아키텍처

```text
macOS open-file / drop / dialog
  → format detector (magic + FileHeader)
  → DocumentImporter
      ├─ HwpxImporter → flow ViewerDocument
      └─ HwpImporter  → candidate adapter
  → read-only document boundary
  → page renderer / virtualization
  → shared PDF export
```

기존 flow `ViewerDocument`는 바꾸지 않고 HWP에 별도 `FixedPageDocument` variant를 추가했다.
ADR-0001에서 다음 두 역할을 확정했다.

- semantic adapter: HWP IR을 현재 `ViewerDocument`로 변환하고 기존 layout을 사용
- fixed-page adapter: 안전하게 정제된 페이지 표현을 별도 read-only page variant로 받고
  공통 zoom·virtualization·PDF shell을 사용

현재 format 분기는 파일 열기와 React loader에 최소 연결돼 있다. 다음 importer milestone에서
이를 `DocumentImporter` 경계로 모은다. 기존 `src/core/parser/hwp_parser.ts`는 CFB stream
이름만 출력하고 항상 실패하는 과거 prototype이므로 V2 구현으로 간주하지 않는다. 첫 구현
단계에서 격리하거나 제거한다.

## 보안 기준

HWP는 외부에서 받은 비신뢰 binary다. Electron 공식 보안 문서는 비신뢰 콘텐츠를 main 같은
unsandboxed process에서 읽거나 처리하지 말 것을 권고한다. 현재 main은 크기·CFB magic
preflight와 파일 읽기만 맡고, rhwp WASM의 document 생성·페이지 정보·SVG·text layout 처리는
renderer UI thread와 분리된 전용 Web Worker에서 실행한다. Worker와 adapter 사이에는 요청
ID가 있는 직렬화 가능한 read-only 결과만 오간다.

초기 제한값은 fixture 측정 전의 보수적인 정책이며 benchmark 결과로 조정한다.

- CFB magic과 `FileHeader` signature/version 검증
- 파일 200 MiB, 개별 stream 128 MiB, 총 inflate 1 GiB의 초기 상한
- sector/record/section 개수와 중첩 깊이 상한
- 30초 open·15초 page operation timeout과 Worker 강제 종료형 load ID 취소
- 암호·DRM·배포용 문서는 V2-1에서 지원하지 않고 분류된 오류 반환
- `Scripts`, OLE, 외부 링크를 실행하거나 자동으로 열지 않음
- SVG 경로는 script, event handler, 외부 URL을 허용하지 않는 정제 단계 통과
- IPC sender와 payload schema 검증
- Worker crash·timeout은 Worker를 종료하고 해당 문서 상태를 무효화하며 앱은 유지

## milestone

### V2-0 후보 bake-off

- [x] AIDA `.hwp` 공통 비노출 진단기와 HWPX `ViewerDocument` 자동 비교
- [x] `@rhwp/core` 첫 페이지·전체 페이지 SVG probe
- [x] `@rhwp/core`와 기준 PDF의 privacy-safe 페이지 정렬·문자 보존·대표 페이지 시각 검증
- [x] `kordoc` IR 구조 요약과 첫 gap 분석
- [x] `kordoc` `ViewerDocument` 최소 adapter probe
- [x] 주 visual 후보의 PDF 출력과 section별 자동 비교
- [x] 정확도·속도·bundle·license 비교 후 ADR-0001 승인

### V2-1 importer 경계와 안전한 열기

- [x] `.hwp` 확장자 분기와 200 MiB·CFB/`FileHeader` preflight
- [x] HWP `FileHeader` signature/version 감지
- [ ] `DocumentImporter`와 format-neutral IPC
- [x] parser Web Worker 격리, 강제 종료형 timeout·load cancellation과 기본 오류 taxonomy
- [x] Finder association, dialog, drop에 `.hwp` 추가
- [x] 암호·DRM·배포용·비지원 version·손상 문서 오류 UX

### V2-2 본문과 스타일

- [x] fixed-page SVG에서 문단·run·글꼴·크기·색·정렬·간격 보존
- [x] section, 용지, margin, header/footer/page number의 fixed-page 보존
- [x] 좌표형 run text layer와 페이지별 글자 수 회귀
- [x] `⌘F` 검색·하이라이트, DOM 선택과 페이지 접근성 계약

### V2-3 표와 이미지

- [x] fixed-page SVG에서 cell grid, 병합, margin, border/fill 보존
- [x] BinData 이미지와 크기·배치 보존
- [x] parser pagination 결과를 고정 페이지로 보존

### V2-4 성능과 PDF

- [x] 첫 페이지 우선 SVG queue와 세로·가로 혼합 페이지 가상화 계산
- [x] Worker 격리 후 패키지 앱 첫 화면 1초 이내(cold p95 614ms, 20회)
- [x] cold/warm 20회 p50/p95와 시작·문서 처리 구간 분리
- [x] AIDA HWP/HWPX cold 5회 peak working set과 V1 package 증가량
- [x] 혼합 방향 화면/PDF page count·용지 크기·텍스트 보존과 PNG 재렌더
- [x] 공개 HWP 생성 결정성·구조·앱·PDF `verify:hwp-matrix`를 V1 회귀 관문과 통합

### V2 완료 조건

- private AIDA `.hwp`가 crash 없이 열리고 표·이미지를 포함해 읽을 수 있음
- 같은 문서의 HWPX/PDF 기준과 차이가 정량화되어 known limitation에 기록됨
- 암호·DRM·배포용·손상 문서는 앱을 종료시키지 않고 정확한 오류를 보여줌
- `.hwpx` V1 회귀 테스트와 production matrix가 그대로 통과함
- 개인정보 없는 HWP fixture가 CI에서 parser·app·PDF 경로를 검증함

## 출처

모든 링크는 2026-07-27에 다시 확인했다.

### 규격과 보안

- [한글과컴퓨터, 한글 문서 파일 구조 5.0 revision 1.3](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf):
  CFB 기반 구조, `FileHeader`, HWPUNIT, stream, record, 압축·암호 플래그와 고지 문구
- [Microsoft, MS-CFB Compound File Binary File Format](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/50708a61-81d9-49c8-ab9c-43c98a795242):
  storage/stream 계층과 compound file 구조
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security):
  비신뢰 콘텐츠 격리, sandbox, context isolation, IPC 검증 권고
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process):
  별도 utility process 실행과 통신 API

### 후보 원 저장소와 배포

- [`edwardkim/rhwp`](https://github.com/edwardkim/rhwp),
  [`@rhwp/core` npm](https://www.npmjs.com/package/@rhwp/core),
  [releases](https://github.com/edwardkim/rhwp/releases)
- [`chrisryugj/kordoc`](https://github.com/chrisryugj/kordoc),
  [`kordoc` npm](https://www.npmjs.com/package/kordoc)
- [`hahnlee/hwp.js`](https://github.com/hahnlee/hwp.js),
  [`hwp.js` npm](https://www.npmjs.com/package/hwp.js)
- [`neolord0/hwplib`](https://github.com/neolord0/hwplib)
- [`iyulab/unhwp`](https://github.com/iyulab/unhwp),
  [releases](https://github.com/iyulab/unhwp/releases)
- [`openhwp/openhwp`](https://github.com/openhwp/openhwp)
- [`mete0r/pyhwp`](https://github.com/mete0r/pyhwp)

평가 재현성을 위해 lockfile의 kordoc 4.2.7을 유지한다. 2026-07-27 확인 시 upstream main은
4.2.9였으며 아직 Han-Flow probe 관문을 통과하지 않았으므로 이 문서의 평가 결과에 섞지 않는다.
