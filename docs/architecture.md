# Han-Flow v1 기술 아키텍처

Han-Flow v1은 macOS용 읽기 전용 HWPX 뷰어다. 편집 상태나 Undo/Redo를 관리하지 않고,
받은 문서를 빠르게 열어 레이아웃이 깨지지 않게 표시하고 PDF로 내보내는 데 집중한다.

## 파이프라인

```text
macOS open-file / drag-and-drop / file dialog
  → Electron main process
  → HwpxPackageReader (ZIP index, section size, resource entry)
  → ordered XML decoder
  → immutable ViewerDocument
  → block pagination
  → React read-only page renderer
```

parser는 React와 CSS를 모르고 renderer는 ZIP/XML을 해석하지 않는다. 길이는 문서 모델에서
HWPUNIT 정수로 유지하고 화면 경계에서만 CSS px로 변환한다. 동일 입력은 source 위치 기반의
결정적 ID를 만들어 테스트와 캐시가 재현 가능해야 한다.

## 프로세스 책임

### Electron main

- macOS `open-file`, single-instance, 파일 대화상자 처리
- HWPX 확장자와 패키지 필수 entry 검증
- 작은 문서의 전체 decode 및 renderer IPC 전달
- 대형 문서 worker 생성·취소·오류 전달
- renderer 준비 완료 후 `webContents.printToPDF` 실행과 파일 저장

### Decoder worker

section이 20개 이상이거나 section 하나의 압축 전 크기가 2MiB 이상이면 worker thread를
사용한다. 첫 section 모델을 먼저 보내고 전체 모델은 별도 worker 작업으로 완성한다. load ID가
바뀌면 이전 worker를 종료하며 늦게 도착한 결과는 renderer가 무시한다. worker 오류가 발생해도
이미 표시한 첫 section은 유지하고 상태 표시줄에 나머지 페이지 오류를 노출한다.

### Renderer

- `ViewerDocument`를 읽기 전용 A4 page로 표시
- 폰트 대체, 페이지 overflow, 로딩 시간 진단
- 50페이지 이하는 전체 DOM 렌더
- 50페이지 초과는 viewport 주변 page만 mount
- 문서 mutation, 저장 history, `contentEditable` 금지

### PDF export

renderer는 PDF 준비 요청을 받으면 page virtualization을 잠시 해제하고 폰트와 이미지 decode,
React paint가 끝날 때까지 기다린다. print media에서는 toolbar, status bar, page shadow와 page
gap을 제거한다. main process는 HWPUNIT 용지 크기를 inch로 변환한 custom page size와 0 margin,
background 인쇄 옵션으로 `printToPDF`를 실행한다. 완료 또는 오류 후 화면 가상화를 복원한다.

## 대형 문서 로딩

```text
package index
  ├─ small document → full decode → render
  └─ large document → worker(first section) → first paint
                    └→ worker(full document) → load ID 확인 → model 교체
                                              → viewport virtualization
```

현재 첫 단계도 image resource를 포함해 이미지 누락 없이 표시한다. 다음 최적화 후보는 첫
section에서 실제 참조한 resource만 먼저 읽는 것과, section 단위 모델을 순차적으로 합치는
방식이다. 정확도를 잃는 lazy loading은 도입하지 않는다.

## v1 품질 관문

- 공개 synthetic fixture 기반 parser/layout 회귀 테스트
- private 실사용 fixture와 reference PDF 시각 비교
- `npm test`, `npm run build`, `npm run package:mac`
- `npm run benchmark:decoder` 대형 문서 기준선
- 화면/PDF 페이지 수, overflow, font substitution 진단

## v1 이후

`.hwp` 바이너리 열람은 v2에서 기존 파서 활용을 검토한다. 텍스트·표·이미지 편집과 안전한
HWPX 재저장은 v3 범위다. 기존 편집 프로토타입 코드는 v1 런타임 계약으로 간주하지 않는다.
