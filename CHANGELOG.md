# 변경 기록

## Unreleased

### Sprint 0 재현성과 P0 방어

- Node.js 22·npm 10 개발 계약과 Windows install/test/probe/build CI 추가
- 단일 완료율을 폐기하고 capability별 외부 승인까지 추적하는 장기 로드맵 추가
- HWPX read-only와 editing 경로의 entry·경로·암호화·압축 해제 제한 통합
- Electron renderer sandbox와 명시적 context isolation 활성화
- 새 창과 navigation의 외부 protocol을 HTTPS로 제한하고 정책 단위 테스트 추가
- 미사용 `electron-updater` 제거와 ZIP/XML production dependency 안전 버전 갱신
- production dependency audit 0 vulnerabilities 검증
- main·core·renderer 독립 TypeScript typecheck와 Windows CI 관문 추가
- CFB FileHeader·nullable window·PDF dialog·editable union·InputEvent 타입 오류 정리
- XML depth·node·text·DOCTYPE 사전 검사와 실제 깊이 폭탄 HWPX 회귀 fixture
- 이미지 개수·byte·decoded dimension·pixel budget과 dimension 폭탄 HWPX 회귀 fixture
- `BinData` resource를 순차적으로 읽어 일시적인 병렬 메모리 할당 제거
- production 진입점 기준 [legacy inventory](docs/legacy_inventory.md) 작성
- 손실성 초기 parser·normalization·renderer-engine·Zustand store와 구형 shared 타입 제거
- 미사용 `zustand`·`katex`·`@types/katex`·`react-icons` dependency 제거
- Windows x64 production `dir` package 명령과 OS별 V3 acceptance bundle 생성 지원

### V3 HWPX 편집 기반

- 과거 editor store·normalized model·serializer와 저장 IPC 감사
- KS X 6101·HWPX package, IME event, transaction과 안전 저장 1차 출처 조사
- source package·editable model·viewer projection 분리 전략
- loss report, 한국어 IME matrix와 단계별 round-trip 품질 관문
- 모든 HWPX entry의 bytes·compression·CRC를 보존하는 `HwpxSourcePackage`
- path traversal·duplicate·encrypted entry·압축 해제 크기 제한
- unknown XML·binary 공개 fixture와 entry SHA-256 identity round-trip
- 저장소 밖 실사용 HWPX의 privacy-safe identity 검증
- 잘못된 mimetype과 package 손실을 만들던 과거 serializer·저장 IPC 제거
- source span 기반 단일 `hp:t` text patch와 inverse command
- XML entity·공백·빈 node·Unicode boundary 검증
- preserved/modified entry와 Preview 상태를 구분하는 `LossReport`
- 임시 파일 flush·재개봉·viewer 검증 후 새 목적지에만 commit하는 Save As 코어
- 저장소 밖 실사용 HWPX 한 text patch·Save As와 원본 hash 불변 검증
- 여러 text command의 원자적 transaction과 역순 inverse
- transaction 결과의 기존 `ViewerDocument` projection 재생성
- snapshot 없는 100 entries·8 MiB bounded undo/redo history
- input type·selection·anchor·시간·composition 기반 typing grouping
- logical savepoint·dirty, undo branch와 redo 폐기
- 저장소 밖 실사용 HWPX transaction·undo·redo·Save As 검증
- source anchor 기반 `ApplyCharacterStyleCommand`와 `ApplyParagraphStyleCommand`
- 원본 style clone, 동일 definition 재사용과 결정적 style ID allocation
- `charProperties`·`paraProperties` item count와 section reference 원자적 변경
- 굵게와 문단 정렬 4종의 제한된 toolbar, `⌘B`와 selection 동기화
- style definition·reference를 함께 복원하는 undo/redo와 실사용 HWPX Save As 재열기 검증
- 단일 `hp:t` 부분 선택을 좌·선택·우 run으로 분할하는 글자 style command
- XML entity 의미와 선택 방향을 보존하는 새 source anchor 이동
- 분할 fragment와 추가 style definition을 byte 단위로 복원하는 undo/redo
- 저장소 밖 HWPX의 부분 선택·저장·재열기 E2E 관문
- 일반 표 body cell의 단일 문단·단일 run 텍스트 입력 surface
- 반복 머리글·병합·rowSpan·continuation cell의 중복 source anchor 편집 차단
- 공개 baseline 표 셀 undo/redo·Save As·재열기 검증
- 공개 HWPX matrix baseline에 표 셀 편집 release gate 추가
- 부분 style로 여러 run이 된 최상위 문단의 run별 입력 surface와 좌우 경계 이동
- style projection 뒤 stale DOM selection offset 방어와 run 수 변경 시 안전한 surface 재생성
- `ApplyCharacterStyleCommand`의 5–72pt 글자 크기와 `#RRGGBB` 글자색
- 글자 크기 증감·색상 선택 toolbar와 활성 source style 동기화
- 부분 글자 style·문단 정렬을 함께 적용한 package Save As·재개봉 통합 검증
- V3 자동 코드 관문 완료와 macOS 실제 두벌식·Windows 한/글 외부 승인 matrix 분리

### V2 HWP fixed-page

- HWP 페이지별 세로·가로 용지 크기를 보존하는 PDF 출력
- HWP PDF 페이지 크기·텍스트 보존·가로 페이지 PNG 자동 검증
- 기존 HWPX 화면/PDF 페이지별 글자 수 회귀 관문 유지
- HWP/HWPX cold peak working set과 V1 대비 package 증가량 측정
- 중복 rhwp WASM 제거와 MIT license resource 포함
- rhwp 파싱·페이지 처리를 전용 Web Worker로 분리
- 새 문서 열기 취소, Worker 강제 종료형 timeout과 crash 오류 격리
- Worker 격리 후 HWP cold/warm 20회 첫 화면 p95 614/237ms 검증
- Worker 격리 후 HWP cold 5회 aggregate working set peak p95 647.6MiB 기록
- ADR-0001에서 rhwp production visual engine과 kordoc development oracle 역할 확정
- HWP parser MIT 원문과 third-party notice를 production package에 포함
- package license·notice 원문 일치를 release gate에서 자동 검증
- 개인정보 없는 2쪽 HWP fixture와 결정적 SHA-256 manifest
- kordoc 구조 oracle·rhwp SVG·패키지 앱·PDF를 잇는 `verify:hwp-matrix`
- PDF 출력 전 모든 fixed-page SVG decode를 기다려 마지막 페이지 누락 race 수정
- 저장소 밖 실사용 HWP의 화면·PDF 텍스트 보존 재검증
- HWP CFB·FileHeader signature·5.x version main-process preflight
- 암호·배포용·DRM·비지원 version·손상 HWP 구조화 오류 코드와 사용자 안내
- 공개 HWP 변형 5종의 production 오류 E2E와 임시 저장소 정리 재시도
- 포트폴리오에 재사용할 수 있는 날짜별 검증 이력 문서
- HWP/HWPX를 하나의 `DocumentImporter`와 `document:import` IPC 계약으로 통합
- preload·React loader의 공통 성공·오류·background 완료 경계
- 항상 실패하던 과거 HWP CFB stream prototype 제거

## 1.0.0-rc.1 - 2026-07-23

Han-Flow의 첫 v1 Release Candidate다. macOS에서 HWPX를 빠르게 열어 읽고 같은 페이지 구조로
PDF를 내보내는 로컬 실사용 범위를 완성했다.

### 주요 기능

- ordered OWPML decode와 결정적 read-only 문서 모델
- 문단·글자 스타일, 표·병합 셀, 테두리·배경, 이미지 resource
- 머리말·꼬리말, 구역별 쪽 번호와 번호 재시작
- 실제 DOM 높이를 사용하는 2-pass pagination
- 표 셀 문단 continuation과 반복 header
- worker 기반 점진 decode와 50페이지 초과 page virtualization
- Finder 더블클릭, single-instance, drag-and-drop
- dark mode chrome, 트랙패드 pinch zoom, PDF 내보내기
- production 앱·PDF·공개 fixture 자동 검증
- background decode와 DOM measurement 완료를 기다리는 안정된 E2E 상태 수집

### 검증 기준

- 저장소 밖 실사용 HWPX: 페이지·이미지 보존과 overflow 0
- 실사용 HWPX PDF: 화면과 페이지별 글자 수 일치
- 공개 호환성 matrix: 기본, continuation, 이미지·rowSpan, 대형 progressive, 손상 package
- 대형 synthetic: 9,767페이지 중 DOM 12개 mount, overflow 0

### 알려진 제한

- 원문 글꼴이 없으면 대체 글꼴 metric으로 줄바꿈과 페이지별 분배가 달라질 수 있다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- 복잡한 `rowSpan`, 복수 overflow 셀과 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.
- `.hwp` 5.0 바이너리 직접 파싱과 편집은 v1 범위가 아니다.
- 현재 패키지는 서명·공증되지 않은 로컬 beta다.
