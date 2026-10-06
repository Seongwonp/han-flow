# 사용자 경험(UX) 차별화 전략 및 개발 환경 설정

> 초기 prototype의 아이디어를 보존한 문서이며 현재 설계 근거로 사용하지 않는다.
> 아래의 pixel-perfect·hybrid canvas·outline 제안은 채택된 기능이 아니다. 현재 구현 상태와 범위는
> [제품 비전과 로드맵](vision_and_roadmap.md)을 기준으로 한다. V1은 read-only HWPX,
> V2는 read-only HWP 5.0, 편집 설계는
> [V3 HWPX 편집 전략](v3_editing_strategy.md), 공개 배포는 V4 범위다.
>
> 2026-09-28 기준 현재와 다른 점: 주 개발·자동 검증 환경은 Windows·Linux이고 macOS는 지원 OS
> 중 하나다(1.3의 "맥 전용 앱" 방향은 폐기). 단축키는 macOS ⌘, Windows·Linux Ctrl이다. 아래 표의
> `zustand`는 2026-08-21 제거했고 Electron은 44를 사용한다.

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

### 1.4 리본 탭 구성
한/글·Office처럼 리본을 기능별 탭으로 나누고, 지금 동작하는 control만 둡니다. 리본은 보기·편집 모드 모두 보이며
편집 전용 control은 편집 중이 아니면 꺼진 채 안내 문구를 보입니다.

| 탭 | group과 control |
| --- | --- |
| 파일 | 문서(열기·새 창), 저장(다른 이름으로 저장, `Ctrl/⌘+S`), 내보내기(PDF로 내보내기) |
| 편집 | 기록(실행 취소·다시 실행), 찾기(HWP fixed-page 문서에서만, `Ctrl/⌘+F`) |
| 서식 | 글자 모양(글꼴·굵게·기울임·밑줄·취소선·크기·색), 문단 정렬, 문단 간격(줄 간격·첫 줄·문단 앞·뒤) |
| 표 | 표 셀 모양(배경·선색·두께·선 없음), 표 구조(행·열 추가·삭제, 오른쪽 병합, 병합 셀 분할) |
| 보기 | 확대/축소(축소·현재 배율·확대·100%) |

- 기본 탭은 편집 중이면 `서식`, 아니면 `파일`입니다. 사용자가 고른 탭은 창별 renderer state로 기억하고(localStorage 아님),
  편집을 시작할 때 `서식`으로, 편집이 끝났는데 `서식`·`표`에 있으면 `파일`로만 옮깁니다.
- caret이 표 셀에 들어가도 탭을 자동으로 바꾸지 않습니다(입력 중 리본이 바뀌면 방해가 됨). 대신 `표` 탭에 주황 점과
  `커서가 표 안에 있습니다` tooltip을 붙입니다.
- `편집 시작`과 편집 상태 badge, 검색 입력창은 탭과 무관하게 상단 줄에 둡니다.
- 접근성: `role="tablist"`·`tab`·`tabpanel`, `aria-selected`·`aria-controls`·`aria-labelledby`, roving `tabindex`,
  ←/→(순환)·Home/End 탭 이동과 focus 이동. 리본 control은 40px 이상이고 누를 때 문서 caret을 빼앗지 않습니다.
- 단축키(`Ctrl/⌘+B·I·U·S·Z·Y·F·+·-·0`)는 선택한 탭과 무관하게 동작합니다.

## 2. 개발 환경 설정 (package.json 의존성)

초기 프로젝트 구성에 필요한 핵심 라이브러리 리스트입니다.

### 2.1 Core Dependencies

| 라이브러리 | 설명 |
| :--------- | :--- |
| `electron` | 데스크톱 앱 프레임워크 |
| `typescript` | 정적 타입 시스템 |
| `unzipper` | HWPX(ZIP) 압축 해제 |
| `fast-xml-parser` | 고성능 XML 파싱 |
| `react` & `react-dom` | UI 컴포넌트 라이브러리 |
| `zustand` | 가벼운 상태 관리 |

### 2.2 Development Dependencies

| 라이브러리 | 설명 |
| :--------- | :--- |
| `vite` | 초고속 빌드 및 HMR |
| `electron-vite` | Electron 전용 Vite 툴킷 |
| `jest` & `ts-jest` | 단위 테스트 프레임워크 |
| `eslint` & `prettier` | 코드 퀄리티 및 포맷팅 |

## 3. 초기화 명령어 예시
```bash
# 프로젝트 생성
npm init vite@latest han-flow -- --template react-ts
cd han-flow

# Electron 및 필수 라이브러리 설치
npm install electron unzipper fast-xml-parser zustand
npm install -D electron-vite jest ts-jest @types/jest
```


## References

- [1] 한글과컴퓨터. (n.d.). *HWP/OWPML 형식*. Retrieved from [https://developer.hancom.com/hwpx-owpml-model](https://developer.hancom.com/hwpx-owpml-model)
- [2] 한컴테크. (2025, 2월 26일). *한/글 문서 파일 형식 : HWPX 포맷 구조 살펴보기*. Retrieved from [https://tech.hancom.com/hwpxformat/](https://tech.hancom.com/hwpxformat/)
