# Han-Flow

<p align="center">
  <img src="build/icon.png" width="160" alt="Han-Flow 앱 아이콘" />
</p>

<p align="center">
  macOS에서 HWPX와 HWP 5.0 문서를 빠르게 열어 읽고 PDF로 내보내는 데스크톱 도구
</p>

Han-Flow는 상용 오피스를 복제하는 프로젝트가 아닙니다. 공공기관과 학교에서 받은 한글
문서를 Mac에서 매주 실제로 열어볼 수 있는 작고 안정적인 도구를 목표로 합니다.

V1의 HWPX 뷰어와 V2의 HWP 5.0 읽기 품질 관문을 완료했습니다. V3에서는 HWPX 원본 package
보존, text patch·검증형 Save As와 transaction 기반 undo/redo 코어를 구현했고 제한된
plain-text 문단 편집 UI와 한국어 IME 입력 경계를 패키지 앱에 연결했습니다.
서명·공증을 포함한 사용자 배포는 V4에서 진행합니다. 현재 패키지 버전은
`1.0.0-rc.1`이고 V4 전까지는 서명되지 않은 개인용 macOS 빌드로 검증합니다.

## 현재 지원 범위

### HWPX

- OWPML XML 자식 순서를 보존하는 read-only 문서 모델
- 문단·글자 스타일, 표·병합 셀, 테두리·배경색과 이미지
- 목록, 구역별 머리말·꼬리말과 쪽 번호 재시작
- 실제 DOM 높이를 사용하는 2-pass pagination
- 긴 표 셀의 continuation 행과 반복 머리글
- Worker 기반 점진 decode와 페이지 가상화
- 원본 `hp:t` source anchor 기반의 제한된 단일 텍스트 문단 편집
- 조합 종료 단위 한국어 IME commit과 `⌘Z`·`⇧⌘Z`

### HWP 5.0

- `@rhwp/core` WASM 기반 fixed-page 화면과 PDF
- 첫 페이지 우선 렌더링과 전용 Web Worker 격리
- 좌표형 React text layer를 사용한 `⌘F` 검색·선택·접근성
- 세로·가로 혼합 용지와 페이지별 크기를 보존하는 PDF
- 200 MiB 제한, CFB·`FileHeader`·5.x version 사전 검사
- 암호·배포용·DRM·비지원 version·손상 문서의 구조화된 오류

### macOS 뷰어 UX

- Finder 열기와 single-instance 파일 전달
- 열기 대화상자와 드래그앤드롭
- 트랙패드 pinch zoom과 dark mode chrome
- 화면의 페이지 구조를 사용하는 PDF 내보내기

HWP와 HWPX는 preload에서 형식별 IPC를 노출하지 않습니다. main의 `DocumentImporter`가
공통 `document:import` 요청을 받아 HWP preflight 또는 HWPX 점진 decoder를 선택하고,
React loader는 성공·실패와 background 완료를 같은 계약으로 처리합니다.

## 처리 구조

```text
Finder / dialog / drop
          │
          ▼
  DocumentImporter
    ├─ HWPX package → ordered XML → ViewerDocument
    └─ HWP preflight → rhwp Worker → FixedPageDocument
          │
          ▼
 read-only page boundary
          │
          ▼
 React viewer → virtualization → PDF
```

HWP 5.0 레코드 parser를 처음부터 다시 구현하지 않았습니다. 비교 실험과 ADR을 거쳐
`@rhwp/core`를 production fixed-page engine으로, `kordoc`을 development-only semantic
oracle로 사용합니다. 자동 fallback은 두지 않습니다.

## 검증 결과

완료 주장은 단위 테스트만이 아니라 개인정보 없는 공개 fixture, 저장소 밖 실사용 기준 문서,
production `.app`과 다시 생성한 PDF를 함께 사용해 검증합니다. 최신 상세 이력은
[검증 이력](docs/verification_history.md)에 기록합니다.

### 자동 검증

| 관문 | 결과 |
| --- | ---: |
| Jest | 21 suites, 97 passed, 1 suite skipped |
| parser probe | 8 passed |
| production build | main/preload/renderer 성공 |
| macOS arm64 package | unsigned `.app` 생성 성공 |
| 배포 고지 | Apache-2.0, rhwp MIT, Third-Party Notices 일치 |

### 성능과 대형 문서

| 검증 | 결과 |
| --- | ---: |
| HWP cold open 20회 | p50 535ms / p95 614ms / max 722ms |
| HWP warm open 20회 | p50 203ms / p95 237ms |
| 대형 synthetic HWPX | 9,767페이지 |
| 대형 문서 실제 mount | DOM 12페이지 |
| 대형 문서 overflow | 0 |

열기 성능은 동일한 로컬 macOS arm64 환경의 패키지 앱에서 측정한 회귀 기준이며 모든 Mac의
절대 성능을 보장하는 수치는 아닙니다.

### HWP production matrix

개인정보 없는 고정 HWP는 자체 생성한 본문, 3×3 표, PNG 이미지와 반복 머리말로 구성하며
생성 코드와 SHA-256 manifest를 저장소에 함께 둡니다.

| 검증 | 결과 |
| --- | ---: |
| HWP version | 5.0.3.2 |
| 화면/PDF | 2쪽 / 2쪽 |
| 구조 oracle | 표 1개, 셀 9개, 이미지 1개 |
| 반복 머리말 | 2회 |
| PDF 텍스트 보존율 | 98.6% |
| 오류 입력 | 암호·배포용·DRM·비지원 version·손상 5종 통과 |

저장소 밖의 실사용 기준 HWP에서는 7쪽, 3개 구역, 세로·가로 혼합 용지와 overflow 0을
확인했습니다. PDF도 7쪽을 보존했고 Poppler 텍스트 추출 기준 전체 보존율은 99.08%였습니다.
이 검증 과정에서 마지막 페이지 이미지 decode 전에 인쇄가 시작되던 race를 발견해 수정했습니다.
파일명·본문·캡처와 생성 PDF는 공개 저장소에 포함하지 않습니다.

### HWPX production matrix

| fixture | 결과 |
| --- | --- |
| baseline | 3쪽, overflow 0 |
| 15문단 표 cell | 2쪽, 8+7 문단 분할, 반복 머리글 |
| 이미지·`rowSpan` | 이미지 12개, 1쪽, overflow 0 |
| large progressive | 9,767쪽 중 DOM 12개 mount |
| invalid package | crash 없는 사용자 오류 |

## 로드맵

| 단계 | 상태 | 범위 |
| --- | --- | --- |
| V1 — HWPX 뷰어 | 완료 | 읽기, 점진 로딩, PDF, macOS UX |
| V2 — HWP 5.0 읽기 | 완료 | fixed-page 화면·검색·PDF, 안전한 열기 |
| V3 — 편집 | 진행 중 | package 보존, HWPX editable model, IME, undo/redo, 안전 저장 |
| V4 — 사용자 배포 | 예정 | 서명·공증, 업데이트, 호환성 corpus, 릴리스 |

남은 위험과 예상 작업량을 반영한 계획용 추정치는 V1 100%, V2 100%, V3 46%, V4 5%이며
최종 배포 전체로는 약 64%입니다. V3 편집의 가중치가 가장 큽니다.

V3에서는 과거 `contentEditable` prototype을 완성된 기능으로 간주하지 않습니다. HWPX 원본
속성을 보존하는 editable model, command와 transaction, 한국어 IME composition,
selection·undo/redo와 crash-safe 저장을 별도 품질 관문으로 개발합니다. `.hwp` 저장은
V3의 기본 약속이 아닙니다. 현재는 모든 HWPX ZIP entry와 unknown XML·binary를 identity
round-trip하고 source anchor로 단일 `hp:t`를 수정한 뒤 검증된 새 파일로 저장하는 코어까지
구현됐습니다. 여러 command의 원자적 transaction, selection 복원, bounded undo/redo와
savepoint·dirty 상태도 검증했습니다. main-process 소유 편집 session과 제한된 IPC를 통해
최상위 단일 `ViewerText` 문단만 편집 UI에 연결했고, 패키지 앱에서 composition
commit·undo·redo를 검증했습니다. 저장 버튼은 아직 노출하지 않았습니다.

## 알려진 제한

- HWPX 편집은 최상위 단일 텍스트 문단만 지원하며 표·머리말·꼬리말·복합 run은 읽기 전용입니다.
- 편집 결과를 파일로 저장하는 UI는 아직 제공하지 않으므로 앱을 닫으면 변경 내용이 사라집니다.
- 한컴오피스와 픽셀 단위로 동일한 렌더링을 목표로 하지 않습니다.
- 원문 글꼴이 없으면 대체 글꼴 폭에 따라 HWPX 줄바꿈과 페이지 분배가 달라질 수 있습니다.
- 한 문단 내부의 줄 단위 페이지 분할은 아직 지원하지 않습니다.
- 복잡한 `rowSpan`과 단일 초대형 문단은 내용 보존을 우선한 fallback을 사용합니다.
- 암호·DRM·배포용 HWP는 해제하거나 렌더링하지 않고 분류된 오류를 표시합니다.
- 현재 macOS 패키지는 Developer ID 서명과 Apple notarization을 하지 않았습니다.

함초롬체는 제3자 앱 재배포 권한이 확인되지 않아 번들하지 않습니다. 시스템 설치본의
한글·영문 family 이름을 찾아 사용하며 자세한 근거는 [글꼴 전략](docs/font_strategy.md)에
기록했습니다.

## 개발

Node.js와 npm이 필요합니다.

```bash
npm install
npm run dev
```

프로덕션 빌드와 비서명 macOS 앱:

```bash
npm test -- --runInBand
npm run build
npm run package:mac
```

패키지는 `release/mac-arm64/Han-Flow.app`에 생성됩니다.

주요 회귀 관문:

```bash
npm run test:probe
npm run verify:notices
npm run verify:matrix
npm run verify:hwp-matrix
npm run verify:app -- /path/to/document.hwpx
npm run verify:app -- /path/to/document.hwp
npm run verify:pdf -- /path/to/document.hwpx
npm run verify:pdf -- /path/to/document.hwp
```

전체 RC 관문은 private reference HWPX 경로를 받아 test, package, HWPX/HWP 공개 matrix,
실사용 문서 smoke test와 PDF 검증을 순서대로 실행합니다.

```bash
npm run release:check -- /path/to/private-reference.hwpx
```

성능·메모리와 parser 비교 명령:

```bash
npm run benchmark:app -- /path/to/document.hwp
npm run benchmark:memory -- /path/to/document.hwp
npm run measure:package -- /path/to/v1/Han-Flow.app
npm run probe:hwp -- /path/to/document.hwp
npm run probe:hwp -- /path/to/document.hwp \
  --hwpx /path/to/reference.hwpx \
  --pdf /path/to/reference.pdf
```

검증 명령은 본문 대신 페이지·구조 count, 비공백 문자 수, timing과 안정적인 오류 코드만
출력합니다. 임시 visual state와 Electron user-data는 검증 종료 후 삭제합니다.

## 저장소 구조

```text
src/
├── main/          # 파일 열기, DocumentImporter, IPC와 PDF 출력
├── core/
│   ├── parser/    # HWPX source package 보존과 ordered XML decoder
│   ├── document/  # ViewerDocument, FixedPageDocument와 import 계약
│   ├── fonts/     # 시스템 글꼴 해석과 대체 진단
│   └── layout/    # 페이지·표 분할과 단위 변환
└── renderer/      # React flow/fixed-page renderer와 공통 viewer UI
tests/             # 공개 synthetic fixture 기반 회귀 테스트
scripts/           # 성능, 앱·PDF·라이선스 검증과 parser probe
docs/              # 아키텍처, 전략, ADR, 기준선과 검증 이력
```

## 문서

- [제품 비전과 V1–V4 로드맵](docs/vision_and_roadmap.md)
- [실행 계획](docs/execution_plan.md)
- [기술 아키텍처](docs/architecture.md)
- [파싱 전략](docs/parsing_strategy.md)
- [V3 HWPX 편집 조사와 구현 전략](docs/v3_editing_strategy.md)
- [V3 macOS 한국어 IME 수동 검증 matrix](docs/v3_ime_manual_matrix.md)
- [V2 HWP 5.0 조사와 도입 전략](docs/hwp_v2_strategy.md)
- [HWP parser bake-off](docs/hwp_v2_bakeoff.md)
- [ADR-0001: HWP parser와 renderer 역할](docs/adr/0001-hwp-parser-roles.md)
- [V1 기준선](docs/v1_baseline.md)
- [글꼴 전략과 라이선스 판단](docs/font_strategy.md)
- [Release Candidate 체크리스트](docs/release_checklist.md)
- [날짜별 검증 이력과 포트폴리오 근거](docs/verification_history.md)
- [변경 기록](CHANGELOG.md)

## HWP 5.0 규격 고지

본 제품은 한글과컴퓨터의 한/글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

Han-Flow는 한글과컴퓨터와 제휴하거나 한글과컴퓨터의 보증을 받은 제품이 아닙니다.

## 라이선스

Han-Flow는 [Apache License 2.0](LICENSE)으로 배포합니다. HWP parser를 포함한 배포 고지는
[Third-Party Notices](THIRD_PARTY_NOTICES.md)에 기록합니다.
