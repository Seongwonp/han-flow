# AI 프롬프트 로그

이 문서는 Han-Flow 개발에서 외부 AI에게 넘길 수 있는 현재 review prompt와 과거 prompt
기록을 함께 보관한다. 과거의 “editor 완성” 표현은 현재 제품 상태가 아니며
[제품 비전과 로드맵](vision_and_roadmap.md)을 기준으로 한다.

## V2-0 조사·설계 review prompt

Claude credit이 가능해지면 아래 내용을 그대로 전달한다. 이 단계에서는 코드와 git을
수정하지 않고 독립적인 반론과 누락 찾기에 집중한다.

```text
Han-Flow 프로젝트의 V2 HWP 5.0 parser 도입 설계를 검토해줘.

프로젝트 목표:
- macOS Electron 앱
- V1은 HWPX read-only viewer + PDF이며 로컬 RC 완료
- V2는 .hwp 5.0 read-only 열기와 PDF
- V3는 편집, V4는 사용자 배포
- HWP 5.0 전체 parser를 직접 구현하지 않고 기존 parser를 adapter로 사용
- 한컴과 pixel-perfect 동일 렌더링은 목표가 아님

반드시 먼저 읽을 파일:
- README.md
- docs/hwp_v2_strategy.md
- docs/vision_and_roadmap.md
- docs/execution_plan.md
- docs/architecture.md
- docs/v1_baseline.md
- package.json
- src/core/parser/hwp_parser.ts
- src/core/parser/viewer_decoder.ts
- src/core/document/viewer_document.ts
- src/main/index.ts

중요 제약:
- git add/commit/push/checkout 등 git 명령 금지
- 파일 수정 금지. review 결과만 답변
- private fixture의 본문, 개인정보와 캡처를 출력하지 말 것
- 공개 규격/저장소에서 확인하지 못한 지원 범위는 사실처럼 단정하지 말 것
- 기존 .hwpx V1 회귀를 깨뜨리는 대규모 통합을 당연시하지 말 것

현재 후보:
1. @rhwp/core 0.7.19: Rust/WASM, page SVG
2. kordoc 4.2.7: TypeScript, semantic IR
비교 oracle/fallback: hwp.js, hwplib, unhwp, OpenHWP

검토할 질문:
1. @rhwp/core fixed-page 경로와 kordoc semantic 경로의 비교가 공정한가?
2. AIDA .hwp/.hwpx/.pdf 삼쌍으로 후보를 고를 때 빠진 정확도 지표는 무엇인가?
3. SVG를 Electron에 표시할 때 XSS, 외부 URL, font/image resource 위험을 어떻게 차단해야 하나?
4. CFB/inflate/record parser를 worker 또는 utility process에 격리하는 설계에서 빠진 제한은 무엇인가?
5. 기존 ViewerDocument를 유지할지 fixed-page variant를 추가할지 결정하는 최소 실험은 무엇인가?
6. 후보 dependency의 license, 유지보수, bundle, cold-start 판단에 사실 오류나 빠진 항목이 있는가?
7. V2-0에서 하지 않아야 할 과도한 구현은 무엇인가?

답변 형식:
- 먼저 치명적 문제(P0/P1)를 근거와 함께
- 그 다음 후보별 장단점과 권고
- 누락된 fixture/측정 항목
- V2-0을 3~5개 작은 commit으로 나눈 제안
- 마지막에 “채택 전 반드시 확인할 질문” 목록
- 칭찬이나 일반론보다 반례와 실패 가능성을 우선
```

## 과거 prompt 기록

## 1. 프로젝트 초기 설정 프롬프트
- **일시**: 2026-06-06
- **내용**: HWPX 크로스 플랫폼 에디터 'Han-Flow' 개발을 위한 기술 아키텍처, 파싱 전략, UX 차별화 전략, 개발 환경 설정 요청.
- **핵심 요구사항**: 
    - Electron/TypeScript 기반
    - 파서, 렌더러, 상태관리자 분리
    - HWPX 구조 분석 파이프라인 제안
    - UI 깨짐 및 느린 로딩 해결 전략 3가지

## 2. HWPX 파싱 로직 설계 프롬프트
- **목적**: HWPX의 XML 구조를 효율적으로 JSON으로 변환하기 위한 로직 구현.
- **지시어**: "fast-xml-parser와 unzipper를 사용하여 스트리밍 방식으로 파싱하고, 스타일 정보를 ID 기반으로 매핑하는 TypeScript 코드를 작성해줘."

## 3. UX 전략 구체화 프롬프트
- **목적**: macOS 사용자에게 최적화된 경험 제공.
- **지시어**: "기존 뷰어와 차별화되는 macOS 전용 기능을 포함한 3가지 핵심 UX 전략을 제안해줘."


## References

- [1] 한글과컴퓨터. (n.d.). *HWP/OWPML 형식*. Retrieved from [https://developer.hancom.com/hwpx-owpml-model](https://developer.hancom.com/hwpx-owpml-model)
- [2] 한컴테크. (2025, 2월 26일). *한/글 문서 파일 형식 : HWPX 포맷 구조 살펴보기*. Retrieved from [https://tech.hancom.com/hwpxformat/](https://tech.hancom.com/hwpxformat/)


## 4. GitHub 저장소 연결 프롬프트
- **일시**: 2026-06-06
- **내용**: 사용자 제공 GitHub 저장소(`https://github.com/Seongwonp/han-flow.git`)에 프로젝트를 연결하고 초기 코드를 푸시하도록 요청.

## 5. HWPX 파서 및 정규화 모듈 구현 프롬프트
- **일시**: 2026-06-06
- **내용**: HWPX 파일의 ZIP 압축 해제, XML 파싱, 그리고 내부 데이터 모델로의 정규화 로직 구현 요청.
- **핵심 지시어**: "`parser.ts`에 `parseHWPX` 함수를 구현하고, `normalization.ts`로 정규화 로직을 분리하여 스타일 정보 및 본문 내용을 맵핑해줘. 테이블 셀 내부 단락 및 텍스트 런의 탭/줄바꿈 처리도 포함해줘."

## 6. 기본 렌더링 엔진 프로토타입 구현 프롬프트
- **일시**: 2026-06-06
- **내용**: 정규화된 HWPX 문서를 HTML/SVG/Canvas 요소로 렌더링하는 기본 프로토타입 구현 요청.
- **핵심 지시어**: "`renderer.ts` 파일에 `renderDocument` 함수를 구현하여 문서의 섹션, 단락, 텍스트 런을 HTML 요소로 렌더링하는 초기 로직을 작성해줘."
