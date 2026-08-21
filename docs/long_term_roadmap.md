# Han-Flow 장기 완성도 로드맵

상태: **Sprint 0 완료 — Sprint 1 외부 승인 준비**

기준일: 2026-08-21

## 1. 제품 계약

Han-Flow의 첫 안정판은 Windows와 Apple Silicon Mac에서 HWP/HWPX를 안전하게 열고,
검색·인쇄·PDF 변환을 제공하며, HWPX의 일반적인 텍스트와 서식을 원본 package 구조를
보존하면서 제한적으로 수정하는 경량 데스크톱 앱이다.

첫 안정판은 다음을 약속하지 않는다.

- `.hwp` 저장·편집
- 한/글과 픽셀 단위로 동일한 조판
- 매크로, OLE, DRM과 암호화 문서 실행·해제
- Word 수준의 자유로운 표·도형·양식 편집
- Intel Mac, iPhone과 iPad 지원

기능 이름보다 보존·호환성 범위를 먼저 공개한다. 현재 제품은 범용 오피스가 아니라
**HWP/HWPX 뷰어와 안전한 제한적 HWPX 편집 도구**로 설명한다.

## 2. 완료 판정 방식

단일 백분율은 범위가 달라질 때 실제 위험을 숨기므로 사용하지 않는다. 기능은 다음 상태를
순서대로 통과한다.

```text
조사 → 설계 → 코어 구현 → 단위 테스트 → production UI
     → 공개 fixture → 실제 문서 → 한/글 왕복 → OS별 검증 → 완료
```

`구현됨`과 `사용자 배포 가능`을 구분한다. private fixture나 과거 Mac에서 얻은 수치는
중요한 근거지만, 현재 commit에서 공개적으로 재현할 수 없으면 별도 검증으로 표시한다.

### 우선순위

- **P0**: 원본 손상, 데이터 유실, crash, resource exhaustion, 외부 콘텐츠 실행, IME 중복,
  한/글 복구 경고
- **P1**: selection·undo 오류, PDF 누락, 심각한 겹침·잘림, 설치·서명·공증, 기본 접근성
- **P2**: 픽셀 차이, 일부 글꼴 대체, 고급 표·도형 편집, 애니메이션과 시각 polish

## 3. 개발 환경 전략

Windows를 일상적인 주 개발 환경으로 사용한다. parser, source package, 편집 transaction,
React UI, public fixture와 Windows 한/글 왕복은 Windows에서 완결한다.

macOS 전용 관문은 CI와 실제 Apple Silicon Mac으로 분리한다.

- Windows CI: `npm ci`, Jest, parser probe, production build
- macOS CI: build와 package smoke
- 실제 Mac: 물리 IME, Finder 연결, 글꼴·PDF, Developer ID, 공증, Gatekeeper와 DMG 설치

Node.js 22와 npm 10을 저장소 개발 기준선으로 사용한다. clean clone의 `npm ci`가 실패하면
다른 검증보다 먼저 고친다.

## 4. 단계별 로드맵

### Sprint 0 — 재현 가능한 기준선과 P0 방어

예상: 2–4주

- [x] Node.js/npm version contract 추가
- [x] Windows CI 초안 추가
- [x] HWPX 보기·편집 공통 ZIP metadata preflight 적용
- [x] Electron sandbox와 명시적 context isolation 적용
- [x] 외부 navigation을 HTTPS로 제한
- [x] 미사용 updater 제거와 ZIP/XML production dependency audit 0건
- [x] clean Windows에서 `npm ci`, test, probe와 build 통과
- [x] main·preload·renderer를 모두 포함하는 독립 typecheck 설정과 CI 관문 추가
- [x] XML depth·node·text 상한 감사 및 adversarial fixture 추가
- [x] 이미지 decoded dimension·resource budget 추가
- [x] production/legacy 코드 inventory와 제거 결정
- [x] README·검증 이력의 자동 수치 재측정

완료 조건은 GitHub Actions Windows가 같은 commit의 install, test, probe와 build를
연속 통과하고 악성 package가 crash나 무제한 할당 없이 구조화된 오류로 끝나는 것이다.

### Sprint 1 — V3 제한 편집 외부 승인

예상: 4–6주

- [ ] Windows 한/글 WIN-01~08 실행
- [ ] 한/글에서 다시 저장한 파일을 Han-Flow로 역재개봉
- [ ] 실제 macOS 물리 두벌식 matrix 완료
- [x] 일반 문단·표 cell·style·dirty 보호를 Windows package 앱에서 재확인
- [ ] 실패 문서를 개인정보 없는 최소 fixture로 축소

원본 hash 불변, Han-Flow와 한/글 재개봉, 복구 경고 0과 필수 IME matrix를 모두 만족한
뒤에만 V3를 완료로 표시한다.

### Sprint 2 — 편집 기반 확장

예상: 6–10주

- [x] anchor/focus가 독립 text run을 가리키는 selection domain model과 정규화·검증
- [x] 모델 기반 multi-run range와 여러 run 치환·undo/redo 복원
- [ ] 공통 paragraph editing host 기반 native pointer selection
- 문단 split/merge, line break와 plain-text paste command
- capability·loss policy와 stale anchor UX
- transaction atomic rollback과 저장 revision 추적
- renderer의 문서·viewer·editor·IME 임시 상태 분리
- 거대한 화면 컴포넌트를 shell, ribbon, page와 input surface로 분할

완료 조건은 여러 run 치환, 문단 분할·병합, 여러 줄 붙여넣기와 undo/redo selection 복원이
공개 fixture와 실제 DOM에서 동일하게 동작하는 것이다.

### Sprint 3 — 실용적인 HWPX 편집 확대

예상: 8–14주

1. 여러 문단 선택, 찾기·바꾸기와 text editing
2. 기존 font-face 재사용을 우선하는 글꼴 family·글자 서식
3. 정렬·간격·들여쓰기·탭과 목록 유지
4. 여러 문단 표 cell, 행·열, 테두리·배경
5. 병합·분할·반복 머리글은 마지막에 별도 관문으로 진행

각 기능은 `Han-Flow 편집 → Han-Flow 재개봉 → 한/글 재개봉 → 한/글 저장 → Han-Flow
역재개봉`을 통과해야 완료다.

### Sprint 4 — 호환성 corpus와 렌더링 품질

예상: 6–10주, 다른 단계와 병행

개인정보 없는 30–50개 corpus를 일반 공문, 학교 문서, 표·이미지 중심, 혼합 용지, 다단,
머리말·꼬리말, 각주·수식·목록, 병합 표와 100페이지 이상 문서로 구성한다.

측정 지표:

- 열기 성공률과 crash·timeout
- first paint p50/p95, 전체 decode와 peak working set
- 페이지·section·표·cell·이미지 수
- 화면/PDF 비공백 문자 보존율과 overflow
- HWPX identity·single-edit·한/글 왕복 결과

초기 목표는 지원 corpus 열기 95% 이상, crash 0, 본문 문자 99% 이상 보존, 일반 문서 first
paint p95 1초 이내와 저장본 복구 경고 0이다. 글꼴 차이로 인한 페이지 수 차이는 내용
누락·겹침·잘림과 분리한다.

### Sprint 5 — Windows 배포 후보

예상: 4–6주

- Windows 11 x64 installer와 파일 연결
- 한/글 병행 설치, IME와 DPI 100/125/150/200%
- 다중 모니터, 시스템 글꼴 mapping과 PDF
- code signing과 SmartScreen 전략
- 설치·업데이트·제거와 rollback

### Sprint 6 — macOS 공개 배포

예상: 4–8주, Apple Silicon Mac 필수

- Developer ID Application과 release 전용 설정
- hardened runtime, 최소 entitlement와 secure timestamp
- arm64 DMG·ZIP, notarization, stapling과 Gatekeeper
- quarantine 상태의 깨끗한 계정에서 설치·첫 실행
- Finder 파일 연결, 물리 IME, 글꼴과 PDF 최종 검사
- artifact SHA-256, license와 known limitations 공개

### Sprint 7 — 외부 beta와 안정화

예상: 6–8주

alpha → beta → RC → stable 순으로 기능을 동결한다. 문서 원문은 자동 수집하지 않는다.
사용자가 동의한 앱·OS version, format, 크기 구간, 페이지 수, 오류 코드, 처리 시간과 crash
stack만 진단 정보 후보로 삼는다.

안정판은 4주 이상 치명적 데이터 손실 0, crash-free session 99.5% 이상, 저장 실패 시 원본
손상 0, 한/글 복구 경고 0과 blocker 없는 RC 2회를 목표로 한다.

### Sprint 8 — HWP 편집 재결정

1.0 안정화 전에는 `.hwp` writer를 만들지 않는다. 이후에도 HWP는 읽기 전용으로 유지하고
편집 시 HWPX 변환본으로 저장하는 방안을 우선 검토한다. 자체 binary writer는 CFB record,
DocInfo reference, BinData와 version별 왕복 corpus를 소유할 별도 프로젝트 규모로 판단한다.

## 5. release line

현재 `1.0.0-rc.1`은 공개 안정판이 아니라 개인 검증용 역사적 version이다. 공개 version 정책은
V3 외부 승인 뒤 결정하되, 기능 상태를 숨기지 않도록 release note에 `viewer stable`,
`HWPX editing beta`, `HWP read-only`를 각각 표시한다.

## 6. 변경 관리

각 milestone은 같은 변경에서 코드, 테스트, capability matrix와 문서를 갱신한다. 완료 기록에는
날짜, commit, 공개 fixture, 실행 명령, 결과와 남은 수동 관문을 남긴다. 성능 수치는 OS,
architecture, cold/warm과 표본 수 없이 단독으로 인용하지 않는다.
