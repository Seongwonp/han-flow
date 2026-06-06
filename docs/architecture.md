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
Parser Module은 HWPX 파일의 ZIP 압축을 해제하고 내부의 XML 스트림을 파싱하는 역할을 담당합니다. 대용량 문서 파싱 시 UI 블로킹을 방지하기 위해 Worker Threads를 활용하며, OWPML(KS X 6101) 표준 스키마를 준수하여 정확한 파싱을 보장합니다.

### 2.2 Renderer Engine (Internal Model to View)
Renderer Engine은 파싱된 내부 JSON 모델을 시각적 요소로 변환하는 역할을 수행합니다. 레이아웃 깨짐을 방지하기 위해 Virtual DOM 또는 Canvas-based rendering을 선택적으로 적용하며, macOS의 Retina 디스플레이에 최적화된 고해상도 렌더링을 지원하여 사용자에게 쾌적한 시각적 경험을 제공합니다.

### 2.3 State Manager (Document State)
State Manager는 문서의 편집 상태, 변경 이력(Undo/Redo), 그리고 스타일 캐시를 효율적으로 관리합니다. 불필요한 리렌더링을 방지하기 위해 원자적(Atomic) 상태 업데이트를 적용하여 성능을 최적화합니다.

## 3. 기술 스택 요약

| 구분 | 기술 | 사유 |
| :--- | :--- | :--- |
| **Framework** | Electron | 크로스 플랫폼 지원 및 시스템 자원 접근 |
| **Language** | TypeScript | 정적 타입을 통한 안정성 및 대규모 프로젝트 유지보수 |
| **UI Library** | React | 컴포넌트 기반 UI 및 풍부한 에코시스템 |
| **State** | Zustand / Jotai | 가볍고 성능 중심적인 상태 관리 |
| **Build Tool** | Vite | 빠른 개발 피드백 및 빌드 속도 |


## References

- [1] 한글과컴퓨터. (n.d.). *HWP/OWPML 형식*. Retrieved from [https://developer.hancom.com/hwpx-owpml-model](https://developer.hancom.com/hwpx-owpml-model)
- [2] 한컴테크. (2025, 2월 26일). *한/글 문서 파일 형식 : HWPX 포맷 구조 살펴보기*. Retrieved from [https://tech.hancom.com/hwpxformat/](https://tech.hancom.com/hwpxformat/)
