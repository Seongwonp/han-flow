# 사용자 경험(UX) 차별화 전략 및 개발 환경 설정

기존 HWP 뷰어의 고질적인 문제인 'UI 깨짐'과 '느린 로딩'을 해결하기 위한 Han-Flow만의 고유한 전략입니다.

## 1. UX 차별화 전략

### 1.1 하이브리드 렌더링 엔진 (Pixel-Perfect Layout)
- **문제**: 브라우저 기본 렌더링 엔진(HTML/CSS)만 사용 시 복잡한 표나 수식 레이아웃이 미세하게 틀어짐.
- **해결**: 본문 텍스트는 가독성을 위해 HTML로 렌더링하되, 복잡한 도형, 수식, 표 레이아웃은 **SVG 또는 Canvas 엔진**을 사용하여 HWPX 좌표계와 1:1 매칭 렌더링을 수행합니다. 이를 통해 어떤 해상도에서도 깨지지 않는 레이아웃을 보장합니다.

### 1.2 지능형 점진적 로딩 (Smart Incremental Loading)
- **문제**: 수백 페이지에 달하는 대용량 문서 로딩 시 앱이 프리징되거나 대기 시간이 길어짐.
- **해결**: 문서의 전체 구조를 빠르게 파싱하여 목차(Outline)와 첫 2~3페이지만 즉시 렌더링합니다. 나머지 페이지는 사용자의 스크롤 위치에 맞춰 **백그라운드 워커**에서 비동기적으로 로딩 및 캐싱하여 끊김 없는 열람 경험을 제공합니다.

### 1.3 macOS 네이티브 인터페이스 최적화
- **문제**: 기존 한글 뷰어들은 윈도우 스타일의 UI를 그대로 가져와 macOS 환경에서 이질감이 느껴짐.
- **해결**: macOS의 디자인 시스템(SF Pro 폰트, 투명도 효과, 제스처 등)을 적극 채용합니다. 트랙패드 핀치 투 줌(Pinch-to-zoom), 사이드바를 통한 빠른 문서 탐색, 다크 모드 네이티브 지원 등을 통해 '맥 전용 앱'다운 완성도를 제공합니다.

## 2. 개발 환경 설정 (package.json 의존성)

초기 프로젝트 구성에 필요한 핵심 라이브러리 리스트입니다.

### 2.1 Core Dependencies
- `electron`: 데스크톱 앱 프레임워크
- `typescript`: 정적 타입 시스템
- `unzipper`: HWPX(ZIP) 압축 해제
- `fast-xml-parser`: 고성능 XML 파싱
- `react` & `react-dom`: UI 컴포넌트 라이브러리
- `zustand`: 가벼운 상태 관리

### 2.2 Development Dependencies
- `vite`: 초고속 빌드 및 HMR
- `electron-vite`: Electron 전용 Vite 툴킷
- `jest` & `ts-jest`: 단위 테스트 프레임워크
- `eslint` & `prettier`: 코드 퀄리티 및 포맷팅

## 3. 초기화 명령어 예시
```bash
# 프로젝트 생성
npm init vite@latest han-flow -- --template react-ts
cd han-flow

# Electron 및 필수 라이브러리 설치
npm install electron unzipper fast-xml-parser zustand
npm install -D electron-vite jest ts-jest @types/jest
```
