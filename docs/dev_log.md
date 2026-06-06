# Han-Flow 개발 로그

## [2026-06-06] 프로젝트 킥오프 및 초기 설계

### 완료된 작업
1.  **프로젝트 구조 설계**: Electron, TypeScript 기반의 모듈형 아키텍처 수립. `core`, `main`, `renderer`로 계층 분리.
2.  **HWPX 파싱 전략 수립**: `unzipper`와 `fast-xml-parser`를 활용한 스트리밍 파이프라인 설계 및 스타일 맵핑 JSON 스키마 정의.
3.  **UX 차별화 전략 정의**: 하이브리드 렌더링, 점진적 로딩, macOS 네이티브 최적화 전략 수립.
4.  **개발 환경 설정 리스트 작성**: 필수 의존성 라이브러리 선정.
5.  **문서화**: `architecture.md`, `parsing_strategy.md`, `ux_strategy.md`, `ai_prompts.md` 생성.

### 결정 사항
-   렌더링 엔진은 복잡한 레이아웃 보존을 위해 HTML/Canvas 하이브리드 방식을 채택함.
-   대용량 문서 처리를 위해 파싱 로직은 별도의 Worker Thread에서 실행하도록 설계함.

### 다음 단계
-   `package.json` 실제 생성 및 기본 Electron 보일러플레이트 코드 작성.
-   `header.xml` 파싱을 위한 상세 TypeScript 인터페이스 정의.
-   단위 테스트 환경(Jest) 구성.
