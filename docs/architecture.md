# 기술 아키텍처 제안: Han-Flow

Han-Flow는 macOS 환경에 최적화된 고성능 HWPX 에디터로, Electron과 TypeScript를 기반으로 설계되었습니다. 성능과 확장성을 극대화하기 위해 **Modular First** 원칙을 준수하며, 파서, 렌더러, 상태관리자를 철저히 분리합니다.

## 1. 프로젝트 디렉토리 구조

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

## 2. 핵심 모듈 설계 원칙

### 2.1 Parser Module (HWPX to Internal Model)
- **역할**: ZIP 압축 해제 및 XML 스트림 파싱.
- **특징**: `Worker Threads`를 사용하여 대용량 문서 파싱 시 UI 블로킹 방지.
- **출처**: OWPML(KS X 6101) 표준 스키마 준수.

### 2.2 Renderer Engine (Internal Model to View)
- **역할**: 내부 JSON 모델을 시각적 요소로 변환.
- **특징**: 레이아웃 깨짐 방지를 위해 `Virtual DOM` 또는 `Canvas-based rendering` 선택적 적용. macOS의 Retina 디스플레이에 최적화된 고해상도 렌더링 지원.

### 2.3 State Manager (Document State)
- **역할**: 문서의 편집 상태, 히스토리(Undo/Redo), 스타일 캐시 관리.
- **특징**: 불필요한 리렌더링을 방지하기 위해 원자적(Atomic) 상태 업데이트 적용.

## 3. 기술 스택 요약

| 구분 | 기술 | 사유 |
| :--- | :--- | :--- |
| **Framework** | Electron | 크로스 플랫폼 지원 및 시스템 자원 접근 |
| **Language** | TypeScript | 정적 타입을 통한 안정성 및 대규모 프로젝트 유지보수 |
| **UI Library** | React | 컴포넌트 기반 UI 및 풍부한 에코시스템 |
| **State** | Zustand / Jotai | 가볍고 성능 중심적인 상태 관리 |
| **Build Tool** | Vite | 빠른 개발 피드백 및 빌드 속도 |
