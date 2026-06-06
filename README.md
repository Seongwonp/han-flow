# Han-Flow: HWPX Cross-Platform Editor

![Han-Flow Logo](https://raw.githubusercontent.com/Seongwonp/han-flow/main/docs/assets/han-flow-logo.png) <!-- 로고 이미지는 추후 추가 예정 -->

## 🚀 프로젝트 소개

Han-Flow는 macOS 환경에 최적화된 고성능 HWPX 크로스 플랫폼 에디터입니다. 기존 HWP 뷰어의 고질적인 문제인 'UI 깨짐'과 '느린 로딩'을 해결하고, 사용자에게 더 직관적이고 쾌적한 문서 열람 및 편집 경험을 제공하는 것을 목표로 합니다.

## ✨ 주요 기능 및 차별점

-   **레이아웃 무결성**: HWPX 표준(OWPML)을 준수하는 정밀한 파싱 및 하이브리드 렌더링 엔진(HTML + SVG/Canvas)을 통해 macOS 환경에서 레이아웃 깨짐 현상을 최소화합니다.
-   **고성능 로딩**: 지능형 점진적 로딩(Smart Incremental Loading) 전략을 적용하여 대용량 문서도 빠르게 초기 화면을 표시하고, 백그라운드에서 나머지 콘텐츠를 비동기적으로 로딩합니다.
-   **macOS 최적화 UX**: macOS의 디자인 시스템과 네이티브 기능을 적극 활용하여 트랙패드 제스처, 다크 모드 지원 등 맥 사용자에게 익숙하고 편리한 사용자 경험을 제공합니다.
-   **모듈화된 아키텍처**: 파서, 렌더러, 상태 관리자를 철저히 분리하여 높은 확장성과 유지보수성을 확보했습니다.

## 🛠️ 기술 스택

Han-Flow는 다음과 같은 기술 스택을 기반으로 개발됩니다.

| 구분 | 기술 | 설명 |
| :--- | :--- | :--- |
| **프레임워크** | Electron | 크로스 플랫폼 데스크톱 애플리케이션 개발 |
| **언어** | TypeScript | 정적 타입 지원으로 안정성 및 생산성 향상 |
| **UI 라이브러리** | React | 컴포넌트 기반의 선언적 UI 구축 |
| **상태 관리** | Zustand / Jotai | 가볍고 유연한 전역 상태 관리 |
| **빌드 도구** | Vite, Electron-Vite | 빠른 개발 서버 및 최적화된 빌드 환경 제공 |
| **HWPX 파싱** | `unzipper`, `fast-xml-parser` | HWPX 파일 압축 해제 및 XML 데이터 파싱 |

## 📦 프로젝트 구조

```text
han-flow/
├── src/
│   ├── main/               # Electron Main Process (OS API, File I/O)
│   ├── renderer/           # Electron Renderer Process (React/Vue UI)
│   ├── shared/             # 공용 타입 및 유틸리티
│   └── core/               # 핵심 비즈니스 로직 (플랫폼 독립적)
│       ├── parser/         # HWPX (XML) -> JSON 변환 엔진
│       ├── renderer-engine/# JSON -> Canvas/SVG/HTML 렌더링 로직
│       └── state/          # 문서 상태 관리 (CRDT 또는 Immutable State)
├── docs/                   # 개발 문서 및 로그
├── tests/                  # 단위 및 통합 테스트
├── package.json
└── tsconfig.json
```

## ⚙️ 개발 환경 설정 및 실행 방법

### 1. 프로젝트 클론

```bash
git clone https://github.com/Seongwonp/han-flow.git
cd han-flow
```

### 2. 의존성 설치

```bash
npm install
# 또는 yarn install / pnpm install
```

### 3. 개발 모드 실행

```bash
npm run dev
```

### 4. 빌드

```bash
npm run build
```

## 🤝 기여 방법

Han-Flow 프로젝트에 기여하고 싶으시다면, 언제든지 Pull Request를 보내주세요. 버그 리포트, 기능 제안 등 모든 형태의 기여를 환영합니다.

## 📄 라이선스

이 프로젝트는 [MIT License](LICENSE)를 따릅니다. <!-- LICENSE 파일은 추후 추가 예정 -->

## 📞 문의

프로젝트 관련 문의는 [Seongwonp](https://github.com/Seongwonp)에게 연락 바랍니다.
