# Han-Flow 검증 이력

이 문서는 구현 완료 주장에 대응하는 재현 명령, 입력 범위, 정량 결과와 발견한 결함을 날짜별로
기록한다. 포트폴리오와 릴리스 회고에서는 이 문서를 요약 자료로 사용하고, 세부 설계 판단은
연결된 기준선·bake-off·ADR을 근거로 사용한다.

실사용 문서는 저장소 밖에 두며 파일명 외 본문·캡처·생성 PDF는 커밋하지 않는다. 자동화 로그도
페이지 수, 구조 count, 비공백 문자 수, 시간·메모리와 안정적 오류 코드만 남긴다. 공개
synthetic fixture는 생성 코드와 SHA-256 manifest를 함께 커밋한다.

## 2026-07-27 — HWP FileHeader 안전한 열기

관련 구현: `8c59b53` (`HWP 지원 불가 문서 오류 분류 추가`)

### 검증 환경

- macOS arm64
- Electron 28.3.3
- `@rhwp/core` 0.7.19, `kordoc` 4.2.7
- production `.app`: unsigned local package

### 실행과 결과

| 관문 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 테스트 | `npm test -- --runInBand` | 15 suites, 58 passed, 1 skipped |
| probe 테스트 | `npm run test:probe` | 8 passed |
| production build | `npm run build` | main/preload/renderer build 성공 |
| macOS package | `npm run package:mac` | arm64 `.app` 생성 성공 |
| HWP 정상·오류 matrix | `npm run verify:hwp-matrix` | 정상 fixture와 오류 5종 통과 |
| HWPX 공개 matrix | `npm run verify:matrix` | 5종 fixture 통과 |
| 배포 고지 | `npm run verify:notices` | Apache-2.0, rhwp MIT, notice 원문 일치 |
| private HWP 앱 | `npm run verify:app -- <private.hwp>` | 7쪽, mount 7, overflow 0 |
| private HWP PDF | `npm run verify:pdf -- <private.hwp>` | 7쪽, 혼합 용지, 문자 99.08% |

공개 HWP matrix는 `FileHeader`를 테스트 중에 변형해 다음 오류 코드가 production 앱에 그대로
표시되는지 확인했다.

- `HWP_ENCRYPTED`
- `HWP_DISTRIBUTION`
- `HWP_DRM`
- `HWP_UNSUPPORTED_VERSION`
- `HWP_CORRUPTED`

기존 HWPX 회귀 결과는 baseline 3쪽, cell continuation 2쪽, 이미지 12개·`rowSpan` fixture
1쪽, 80-section 대형 fixture 9,767쪽 중 DOM 12개 mount, 손상 package의 사용자 오류다.

### 검증 중 발견한 문제

오류 fixture를 연속 실행할 때 Electron이 종료 직후 `Session Storage`를 늦게 닫아 임시
디렉터리 삭제가 `ENOTEMPTY`로 실패할 수 있었다. 앱 판정과 정리 실패를 분리하기 위해 E2E
임시 디렉터리 삭제에 100ms 간격, 최대 5회의 제한된 재시도를 추가했다. 같은 전체 matrix
재실행으로 통과를 확인했다.

## 2026-07-27 — 개인정보 없는 HWP 회귀 관문과 PDF race

관련 구현:

- `191fed8` — 공개 HWP 회귀 매트릭스 추가
- `24f0df9` — HWP PDF 마지막 페이지 출력 대기 보강
- `72e5153` — V2 공개 HWP 검증 현황 문서화

공개 `synthetic-layout.hwp`는 HWP 5.0.3.2, 12,800 byte이며 SHA-256
`b665933da10ec276e8e21ddb1c9e6d2eec5440c9ac5d1bda9e5bc478bd136b9e`로 고정했다.

| 관찰 대상 | 결과 |
| --- | --- |
| 생성 결정성 | 재생성 결과와 고정 SHA-256 일치 |
| kordoc 구조 oracle | section 1, 표 1, 셀 9, 이미지/resource 1/1 |
| rhwp 렌더 | 2쪽, SVG 이미지 1, 위험 요소·속성 0 |
| production 앱 | 2쪽, 반복 머리말 2회, overflow 0 |
| production PDF | 2쪽 A4, 텍스트 보존율 98.6% |

private AIDA HWP 재검증에서 화면은 7쪽이지만 첫 PDF의 마지막 쪽 텍스트가 0자로 출력돼 전체
보존율이 92.1%까지 내려가는 race를 발견했다. 인쇄 준비를 렌더 요청 완료가 아니라 모든
fixed-page SVG의 실제 decode 완료(`naturalWidth > 0`)까지 기다리도록 변경했다. 수정 후
마지막 쪽은 424자, 전체는 99.08%로 회복했다.

## 2026-07-23 — V1 HWPX Release Candidate

상세 근거는 [V1 기준선](v1_baseline.md)과 [Release Candidate 체크리스트](release_checklist.md)에
있다.

- private AIDA HWPX: 8쪽, 이미지 4개, overflow 0
- 화면과 PDF 페이지별 비공백 문자 수 일치
- 15문단 표 cell continuation: 반복 header, 8+7 문단 분배
- 80-section synthetic: 9,767쪽 중 DOM 12개 mount
- 이미지 12개·`rowSpan=2` 공개 fixture와 손상 HWPX 오류 UX
- production Finder 열기, single-instance, drag-and-drop, pinch zoom, dark chrome와 PDF

## 포트폴리오에 사용할 수 있는 근거

- “빠르다”는 표현은 cold/warm 20회 p50/p95와 최대값으로 설명한다.
- “대형 문서를 지원한다”는 표현은 9,767쪽 중 DOM 12개 mount 결과로 설명한다.
- “PDF가 안정적이다”는 표현은 화면/PDF page size와 페이지별 문자 보존율, 실제로 발견해
  수정한 마지막 페이지 race로 설명한다.
- “안전하게 연다”는 표현은 main preflight, Worker timeout·취소, SVG 정제와 다섯
  `FileHeader` 오류 코드로 설명한다.
- “테스트가 있다”는 표현보다 private 실문서와 공개 결정적 fixture를 함께 사용하고 개인정보를
  결과에서 제거한 검증 설계를 설명한다.
