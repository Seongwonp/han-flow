# Han-Flow V2 HWP 5.0 조사와 도입 전략

기준일: 2026-07-24

## 결론

V2의 목표는 `.hwp` 5.0 문서를 **읽기 전용으로 열고, 읽기 좋은 레이아웃으로 표시하고,
PDF로 내보내는 것**이다. Han-Flow가 HWP 5.0 레코드 전체를 직접 구현하지 않는다. 공개
규격은 후보 파서의 출력 검증, 보안 경계 정의, Han-Flow 문서 모델로의 adapter 작성에
사용한다.

현 시점의 1차 실험 후보는 다음 두 개다.

1. `@rhwp/core`: Rust/WASM 파서와 페이지 SVG renderer를 함께 사용해 레이아웃 보존 가능성을
   측정한다.
2. `kordoc`: TypeScript HWP 5.0 파서의 구조화된 IR을 Han-Flow `ViewerDocument`로
   정규화해 기존 pagination/renderer를 재사용할 수 있는지 측정한다.

아직 어느 쪽도 채택하지 않았다. private AIDA `.hwp`·동일 문서 `.hwpx`·기준 PDF 삼쌍과
공개 synthetic fixture를 같은 지표로 비교한 뒤 결정한다. 라이브러리의 README에 적힌 지원
범위는 후보 선정 근거일 뿐 Han-Flow의 호환성 보증으로 간주하지 않는다.

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
존재하는 구성물에 표시하도록 요구한다. V2 구현과 동시에 앱의 정보 화면에도 넣는다.

> 본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

## 후보 조사

버전과 저장소 활동은 2026-07-24에 공식 GitHub API와 npm registry로 다시 확인했다.

| 후보 | 확인 버전 | 런타임·라이선스 | 장점 | Han-Flow 관점의 위험 | 판정 |
| --- | --- | --- | --- | --- | --- |
| `@rhwp/core` | 0.7.19 | Rust/WASM, MIT | HWP/HWPX parse, page count, 페이지 SVG renderer 제공. macOS Electron renderer에서 별도 JVM 없이 실행 가능 | WASM 약 7 MB, 0.x API, 기존 semantic renderer를 우회할 수 있음. SVG 주입 경계와 PDF 일치 검증 필요 | **1차 layout 후보** |
| `kordoc` | 4.2.7 | TypeScript, MIT | Node 18+, CFB 기반 HWP parse, 문단·표·중첩 cell·이미지·일부 style을 구조화된 IR로 반환 | IR은 추출 중심이며 HWP 페이지 좌표·전체 문단/테두리 속성이 부족함. 현재 unpacked 약 11.1 MB이고 불필요한 기능 분리 확인 필요 | **1차 semantic 후보** |
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
페이지별 비공백 글자 수, overflow 수, 첫 화면 시간만 기록한다. 이후 개인정보 없는 공개
HWP fixture를 직접 만들어 CI에 추가한다.

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

### 실험 산출물

- 후보를 production dependency에 넣지 않는 독립 probe
- 같은 JSON schema로 된 후보별 진단 결과
- AIDA와 공개 fixture의 비교표
- dependency, license, binary size, cold/warm timing 기록
- `docs/hwp_v2_strategy.md`의 최종 ADR 갱신

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

후보 실험 전에는 `ViewerDocument`를 억지로 바꾸지 않는다. 결과에 따라 다음 중 하나를 ADR로
선택한다.

- semantic adapter: HWP IR을 현재 `ViewerDocument`로 변환하고 기존 layout을 사용
- fixed-page adapter: 안전하게 정제된 페이지 표현을 별도 read-only page variant로 받고
  공통 zoom·virtualization·PDF shell을 사용

format별 분기는 Electron main과 React component 곳곳에 퍼뜨리지 않고 `DocumentImporter`
경계 한 곳에 둔다. 기존 `src/core/parser/hwp_parser.ts`는 CFB stream 이름만 출력하고 항상
실패하는 과거 prototype이므로 V2 구현으로 간주하지 않는다. 첫 구현 단계에서 격리하거나
제거한다.

## 보안 기준

HWP는 외부에서 받은 비신뢰 binary다. Electron 공식 보안 문서는 비신뢰 콘텐츠를 main 같은
unsandboxed process에서 읽거나 처리하지 말 것을 권고한다. V2 parser는 main process가 아닌
전용 worker 또는 utility process에서 실행하고 renderer에는 직렬화 가능한 read-only 결과만
보낸다.

초기 제한값은 fixture 측정 전의 보수적인 정책이며 benchmark 결과로 조정한다.

- CFB magic과 `FileHeader` signature/version 검증
- 파일 200 MiB, 개별 stream 128 MiB, 총 inflate 1 GiB의 초기 상한
- sector/record/section 개수와 중첩 깊이 상한
- parse timeout과 load ID 기반 취소
- 암호·DRM·배포용 문서는 V2-1에서 지원하지 않고 분류된 오류 반환
- `Scripts`, OLE, 외부 링크를 실행하거나 자동으로 열지 않음
- SVG 경로는 script, event handler, 외부 URL을 허용하지 않는 정제 단계 통과
- IPC sender와 payload schema 검증
- crash·timeout은 앱 전체 종료가 아니라 해당 문서의 오류로 격리

## milestone

### V2-0 후보 bake-off

- [x] AIDA `.hwp` 공통 비노출 진단기와 HWPX/PDF 기준 수치 비교
- [x] `@rhwp/core` 첫 페이지·전체 페이지 SVG probe
- [x] `kordoc` IR 구조 요약과 첫 gap 분석
- [ ] 후보별 PDF 출력과 section별 자동 비교
- [ ] `kordoc` `ViewerDocument` 최소 adapter probe
- [ ] 정확도·속도·bundle·license 비교 후 하나의 ADR 작성

### V2-1 importer 경계와 안전한 열기

- [ ] magic 기반 HWP/HWPX 감지
- [ ] `DocumentImporter`와 format-neutral IPC
- [ ] parser worker 격리, 제한·취소·오류 taxonomy
- [ ] Finder association, dialog, drop에 `.hwp` 추가
- [ ] 암호·DRM·배포용·손상 문서 오류 UX

### V2-2 본문과 스타일

- [ ] 문단·run·글꼴·크기·색·정렬·간격
- [ ] section, 용지, margin, header/footer/page number
- [ ] 텍스트 순서와 페이지별 글자 수 회귀

### V2-3 표와 이미지

- [ ] cell grid, colSpan/rowSpan, margin, border/fill
- [ ] BinData 이미지와 크기·배치
- [ ] 다중 페이지 표의 보존 우선 fallback

### V2-4 성능과 PDF

- [ ] 첫 화면 우선 parse와 50페이지 이상 가상화
- [ ] cold/warm p50/p95와 peak memory
- [ ] 화면/PDF page count·페이지별 글자 수 일치
- [ ] `verify:hwp-matrix`를 V1 회귀 관문과 통합

### V2 완료 조건

- private AIDA `.hwp`가 crash 없이 열리고 표·이미지를 포함해 읽을 수 있음
- 같은 문서의 HWPX/PDF 기준과 차이가 정량화되어 known limitation에 기록됨
- 암호·DRM·배포용·손상 문서는 앱을 종료시키지 않고 정확한 오류를 보여줌
- `.hwpx` V1의 41개 테스트와 production matrix가 그대로 통과함
- 개인정보 없는 HWP fixture가 CI에서 parser·app·PDF 경로를 검증함

## 출처

모든 링크는 2026-07-24에 확인했다.

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
