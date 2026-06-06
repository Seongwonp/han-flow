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


## [2026-06-06] HWPX 파서 핵심 로직 구현

### 완료된 작업
1.  **GitHub 원격 저장소 연결**: `https://github.com/Seongwonp/han-flow.git`에 프로젝트를 연결하고 초기 코드를 푸시했습니다.
2.  **HWPX 파서 핵심 로직 구현**: `src/core/parser/parser.ts` 파일에 `parseHWPX` 함수를 구현하여 HWPX 파일의 ZIP 압축을 해제하고 `header.xml`, `sectionN.xml` 파일들을 `fast-xml-parser`를 이용해 XML에서 JSON으로 변환하는 로직을 추가했습니다.
3.  **HWPX 타입 정의**: `src/shared/types.ts` 파일에 OWPML 표준 스키마를 기반으로 HWPX 문서 구조를 위한 TypeScript 인터페이스들을 정의했습니다.
4.  **스타일 맵핑 로직 추가**: `normalizeDocument` 함수에 `header.xml`에서 폰트, 테두리, 글자 모양, 단락 모양 등 다양한 스타일 정보를 추출하여 ID 기반으로 맵핑하는 로직을 추가했습니다.
5.  **본문 내용 정규화 초기 구현**: `sectionN.xml`에서 단락(`hp:p`), 텍스트 런(`hp:run`), 테이블(`hp:tbl`), 컨트롤(`hp:ctrl`)을 추출하여 `NormalizedDocument` 구조로 변환하는 초기 로직을 구현했습니다.

### 결정 사항
-   `normalizeDocument` 함수 내에서 스타일 정보는 ID를 키로 하는 Map 형태로 관리하여 빠른 참조가 가능하도록 했습니다.
-   본문 내용은 단락을 기준으로 정규화하며, 각 단락 내의 텍스트 런, 테이블, 컨트롤 등은 별도의 타입으로 정의하여 관리합니다.

### 다음 단계
-   스타일 맵핑 및 데이터 정규화 로직을 더욱 견고하게 다듬고, 누락된 필드나 복잡한 구조(예: 테이블 셀 내부의 단락)에 대한 처리를 추가합니다.
-   단위 테스트를 작성하여 파서의 정확성을 검증합니다.


## [2026-06-06] 스타일 맵핑 및 데이터 정규화 모듈 구현

### 완료된 작업
1.  **Normalization 모듈 분리**: `parser.ts`에 있던 `normalizeDocument` 함수를 `src/core/parser/normalization.ts` 파일로 분리하여 모듈성을 강화했습니다.
2.  **Normalization 로직 개선**: `normalizeDocument` 함수 내에서 테이블 셀 내부의 단락 처리 로직을 추가하고, 텍스트 런 내의 탭(`hp:tab`)과 줄바꿈(`hp:lineBreak`) 요소도 정규화된 텍스트로 변환하도록 개선했습니다.
3.  **Parser 모듈 업데이트**: `parser.ts` 파일에서 `normalizeDocument` 함수를 제거하고, `normalization.ts`에서 해당 함수를 import하여 사용하도록 수정했습니다.

### 결정 사항
-   HWPX 파싱 로직과 정규화 로직을 분리하여 코드의 가독성과 유지보수성을 높였습니다.
-   테이블과 같은 복잡한 구조 내의 콘텐츠도 재귀적으로 정규화하여 내부 모델의 일관성을 유지합니다.

### 다음 단계
-   기본 렌더링 엔진 프로토타입을 구현하여 정규화된 문서를 화면에 표시합니다.
-   스타일 적용 로직을 구체화하고, CSS 클래스 정의를 통해 렌더링 품질을 향상시킵니다.


## [2026-06-06] 기본 렌더링 엔진 프로토타입 구현

### 완료된 작업
1.  **렌더링 엔진 프로토타입 구현**: `src/core/renderer-engine/renderer.ts` 파일에 `renderDocument` 함수를 구현하여 정규화된 문서 객체를 HTML 요소로 변환하는 초기 로직을 작성했습니다.
2.  **기본 구조 렌더링**: 문서의 섹션과 단락을 `div` 및 `p` 태그로 렌더링하고, 텍스트 런의 내용을 `span` 태그로 표시하는 기본 기능을 포함했습니다.

### 결정 사항
-   초기 렌더링은 HTML 기반으로 진행하며, 복잡한 레이아웃(테이블, 컨트롤)은 TODO로 남겨두어 추후 Canvas/SVG 기반 렌더링과 통합할 예정입니다.
-   스타일 적용은 각 요소에 클래스를 부여하고 CSS를 통해 관리하는 방식으로 설계했습니다.

### 다음 단계
-   렌더링 엔진에 HWPX 스타일(글자 모양, 단락 모양 등)을 적용하는 로직을 구현합니다.
-   테이블 및 컨트롤과 같은 복잡한 요소의 렌더링을 구체화합니다.
-   개발 로그 및 AI 프롬프트 문서를 최종 업데이트하고, 전체 결과물을 사용자에게 전달합니다.


## [2026-06-06] 빌드 오류 해결 및 Electron 보일러플레이트 구축

### 완료된 작업
1.  **빌드 오류 해결**: `electron-vite` 설정 부재로 인한 빌드 오류를 `electron.vite.config.ts` 파일을 생성하여 해결했습니다.
2.  **Electron 보일러플레이트 구축**: Main Process(`src/main/index.ts`), Preload Script(`src/main/preload.ts`), Renderer Process(`src/renderer/index.html`, `src/renderer/src/main.tsx`)의 진입점과 기본 코드를 작성했습니다.
3.  **macOS 최적화 설정**: Main Process에서 `titleBarStyle: 'hiddenInset'` 설정을 통해 macOS 네이티브 앱과 유사한 상단 바 스타일을 적용했습니다.
4.  **빌드 검증**: `npm run build` 명령을 통해 Main, Preload, Renderer 프로세스가 모두 정상적으로 빌드됨을 확인했습니다.

### 결정 사항
-   의존성 문제로 인해 `@electron-toolkit/utils` 사용을 최소화하고, 필요한 기능은 직접 구현하거나 표준 Node.js/Electron API를 사용하도록 수정했습니다.
-   Vite와 React를 사용하여 현대적이고 빠른 렌더러 개발 환경을 구축했습니다.

### 다음 단계
-   구현된 HWPX 파서와 렌더링 엔진을 Electron UI에 통합합니다.
-   실제 HWPX 파일을 불러와 화면에 렌더링하는 기능을 구현합니다.


## [2026-06-06] 경로 설정 오류 해결 및 빌드 최적화

### 완료된 작업
1.  **경로 설정 오류 해결**: `electron-vite`가 빌드 결과물을 찾지 못하는 문제를 해결하기 위해 `electron.vite.config.ts`에서 각 프로세스별 `outDir`을 명시적으로 설정했습니다.
2.  **package.json 최적화**: `main` 경로를 명확히 하고, `build` 설정을 추가하여 출력 디렉토리 구조를 정리했습니다.
3.  **클린 빌드 검증**: 기존 빌드 결과물을 삭제하고 재빌드하여 `out/` 폴더 아래에 `main`, `preload`, `renderer` 결과물이 정상적으로 생성됨을 확인했습니다.

### 결정 사항
-   개발 및 빌드 시의 경로 혼선을 방지하기 위해 모든 출력 경로를 `out/` 디렉토리로 통일하고 명시적으로 관리합니다.

### 다음 단계
-   사용자 환경에서 `npm run dev` 실행 시 정상 작동 여부 확인.
-   HWPX 파일 선택 및 로딩 기능 구현 시작.


## [2026-06-06] 파일 열기 기능 및 엔진 연동

### 완료된 작업
1.  **IPC 통신 채널 구축**: 메인 프로세스와 렌더러 프로세스 간의 파일 열기(`dialog:openFile`) 및 파싱(`hwpx:parse`)을 위한 IPC 핸들러를 구축했습니다.
2.  **React UI 고도화**: `App.tsx`를 업데이트하여 파일 선택 버튼과 드래그 앤 드롭 기능을 추가했습니다.
3.  **엔진 연동**: UI에서 선택된 HWPX 파일을 메인 프로세스의 파서로 전달하고, 파싱된 JSON 데이터를 다시 UI로 받아와 화면에 렌더링하는 전체 파이프라인을 완성했습니다.
4.  **macOS 스타일링**: A4 용지 스타일의 뷰어 영역과 macOS 네이티브 느낌의 헤더를 구현했습니다.

### 결정 사항
-   보안 및 성능을 위해 파일 읽기와 파싱은 메인 프로세스에서 수행하고, 결과인 정규화된 JSON 데이터만 렌더러로 전달합니다.
-   드래그 앤 드롭 지원을 통해 macOS 사용자의 편의성을 높였습니다.

### 다음 단계
-   표(Table) 및 이미지(Image) 렌더링 기능을 구체화합니다.
-   스타일 정보(폰트, 크기, 정렬 등)를 실제 UI에 반영하는 로직을 강화합니다.
