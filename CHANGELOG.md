# 변경 기록

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
