# Han-Flow 실행 계획

기준일: 2026-07-24

이 문서는 현재 작업 순서를 기록한다. 과거 editor prototype 계획은 현재 제품 범위가 아니며
[제품 비전과 로드맵](vision_and_roadmap.md)에서 V3로 다시 정의했다.

## 현재 milestone: V2-0 HWP parser bake-off

### 1. probe 계약

- [ ] production dependency와 기존 `.hwpx` 경로를 바꾸지 않는 실험 entry 작성
- [ ] 입력: 저장소 밖의 `.hwp` 절대 경로
- [ ] 출력: 본문 없는 JSON 진단
- [ ] 지표: parse/first-page/total 시간, page·section·paragraph·table·image 수, 오류 분류
- [ ] timeout, 취소와 임시 파일 정리

### 2. `@rhwp/core` probe

- [ ] WASM을 Electron production asset으로 제공하는 최소 실험
- [ ] AIDA page count와 첫 페이지 SVG 생성
- [ ] SVG의 script, event handler, 외부 URL 검사
- [ ] 전체 페이지 생성 시간, memory와 bundle 증가량 측정
- [ ] 기존 page virtualization/PDF shell 연결 가능성 기록

### 3. `kordoc` probe

- [ ] HWP `ParseResult.blocks`, images, metadata와 warnings 수집
- [ ] paragraph/run/table/image가 `ViewerDocument`에 필요한 정보를 갖는지 gap 표 작성
- [ ] AIDA의 HWPX decoder 결과와 구조 count 비교
- [ ] 직접 dependency와 필요한 HWP parser code만 분리하는 경우의 bundle 비교

### 4. 결정

- [ ] [V2 전략 점수표](hwp_v2_strategy.md#점수표) 작성
- [ ] main/fallback/oracle 역할 결정
- [ ] license와 third-party notice 확정
- [ ] architecture decision을 V2 전략 문서에 반영

## 다음 milestone: V2-1 importer 경계

V2-0 결정 전에는 시작하지 않는다.

- [ ] magic 기반 format detector
- [ ] `DocumentImporter`와 format-neutral IPC event
- [ ] HWP parser 전용 worker 또는 utility process
- [ ] 입력 제한, timeout, load cancellation
- [ ] `.hwp` Finder association, dialog, drop
- [ ] 암호·DRM·배포용·손상 입력 오류 UX
- [ ] 기존 `hwp_parser.ts` prototype 제거 또는 명시적 격리

## 매 milestone 공통 완료 규칙

1. 실제 fixture와 공개 synthetic fixture를 각각 통과한다.
2. 개인정보나 본문을 로그·캡처·commit에 남기지 않는다.
3. V1 test, build와 public production matrix가 회귀하지 않는다.
4. 구현과 같은 commit에서 관련 설계·결정 문서를 갱신한다.
5. 완료 조건을 만족한 논리 단위로 한국어 commit을 만든다.
