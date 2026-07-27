# Han-Flow 실행 계획

기준일: 2026-07-27

이 문서는 현재 작업 순서를 기록한다. 과거 editor prototype 계획은 현재 제품 범위가 아니며
[제품 비전과 로드맵](vision_and_roadmap.md)에서 V3로 다시 정의했다.

## 현재 milestone: V2-0 HWP parser bake-off

### 1. probe 계약

- [x] production dependency와 기존 `.hwpx` 경로를 바꾸지 않는 실험 entry 작성
- [x] 입력: 저장소 밖의 `.hwp` 절대 경로
- [x] 출력: 본문 없는 JSON 진단
- [x] 지표: parse/first-page/total 시간, page·section·paragraph·table·image 수, 오류 분류
- [x] 60초 timeout과 signal 기반 취소

### 2. `@rhwp/core` probe

- [x] WASM을 hidden Electron renderer에서 초기화하는 독립 실험
- [x] AIDA page count와 전체 page SVG 생성
- [x] SVG의 script, event handler, 외부 URL 검사
- [x] 기준 PDF와 privacy-safe 페이지 그룹·문자 보존율 자동 비교
- [x] PDF 3·4페이지가 합쳐진 SVG를 PNG로 재렌더링해 겹침·잘림 없음 확인
- [ ] peak memory와 production package 증가량 측정
- [x] fixed-page variant로 기존 zoom·page virtualization shell 연결
- [x] 실제 AIDA HWP의 7페이지·3구역·세로/가로 용지·overflow 0 확인
- [ ] mixed-orientation PDF 출력 검증

### 3. `kordoc` probe

- [x] HWP `ParseResult.blocks`, images, metadata와 warnings 수집
- [x] 첫 paragraph/table/image gap 표 작성
- [x] AIDA의 HWPX decoder와 문서 전체 구조 count 자동 비교
- [x] `pageNumber` tag로 section 경계를 복원하고 병합 cell 중복을 제거하는 최소 adapter
- [x] AIDA adapter의 section·semantic text·image/resource 보존 가능성 판정
- [ ] 직접 dependency와 필요한 HWP parser code만 분리하는 경우의 bundle 비교

### 4. 결정

- [ ] [V2 전략 점수표](hwp_v2_strategy.md#점수표) 작성
- [ ] main/fallback/oracle 역할 결정
- [ ] license와 third-party notice 확정
- [ ] architecture decision을 V2 전략 문서에 반영

## 진행 중 milestone: V2-1 importer 경계

- [x] 확장자 분기와 CFB magic 기반 HWP preflight
- [ ] `DocumentImporter`와 format-neutral IPC event
- [ ] HWP parser 전용 worker 또는 utility process 격리
- [x] 200 MiB 입력 제한
- [ ] timeout, load cancellation
- [x] `.hwp` Finder association, dialog, drop
- [ ] 암호·DRM·배포용·손상 입력 오류 UX
- [ ] 기존 `hwp_parser.ts` prototype 제거 또는 명시적 격리

## 매 milestone 공통 완료 규칙

1. 실제 fixture와 공개 synthetic fixture를 각각 통과한다.
2. 개인정보나 본문을 로그·캡처·commit에 남기지 않는다.
3. V1 test, build와 public production matrix가 회귀하지 않는다.
4. 구현과 같은 commit에서 관련 설계·결정 문서를 갱신한다.
5. 완료 조건을 만족한 논리 단위로 한국어 commit을 만든다.
