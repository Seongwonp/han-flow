# 변경 기록

## Unreleased

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
- private AIDA HWP 7쪽·혼합 용지·PDF 텍스트 99.08% 재검증
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

- private AIDA: 8페이지, 이미지 4개, overflow 0
- AIDA PDF: 8페이지 A4, 화면과 페이지별 글자 수 일치
- 공개 호환성 matrix: 기본, continuation, 이미지·rowSpan, 대형 progressive, 손상 package
- 대형 synthetic: 9,767페이지 중 DOM 12개 mount, overflow 0

### 알려진 제한

- 원문 글꼴이 없으면 대체 글꼴 metric으로 줄바꿈과 페이지별 분배가 달라질 수 있다.
- 한 문단 내부의 줄 단위 페이지 분할은 하지 않는다.
- 복잡한 `rowSpan`, 복수 overflow 셀과 단일 초대형 문단은 안전한 행 단위 fallback을 사용한다.
- `.hwp` 5.0 바이너리 직접 파싱과 편집은 v1 범위가 아니다.
- 현재 패키지는 서명·공증되지 않은 로컬 beta다.
