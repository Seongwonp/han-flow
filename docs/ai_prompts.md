# AI 프롬프트 로그

이 문서는 'Han-Flow' 개발 과정에서 사용된 핵심 AI 프롬프트와 지시 사항을 기록합니다.

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
