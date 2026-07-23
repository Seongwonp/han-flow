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
  → React read-only page renderer + page decoration
```

parser는 React와 CSS를 모르고 renderer는 ZIP/XML을 해석하지 않는다. 길이는 문서 모델에서
HWPUNIT 정수로 유지하고 화면 경계에서만 CSS px로 변환한다. 동일 입력은 source 위치 기반의
결정적 ID를 만들어 테스트와 캐시가 재현 가능해야 한다.

paragraph style의 `heading`은 header의 bullet 문자 또는 numbering `paraHead` pattern과
결합한다. decoder가 동일 문단 목록 안에서 번호를 증가시켜 `ViewerParagraph.marker`를 만들고,
renderer는 marker를 본문 앞에 읽기 전용 텍스트로 표시한다. 현재 문자 bullet과 DIGIT 번호를
지원하며 다른 번호 체계는 원문 format 정보를 모델에 보존한 뒤 후속 formatter에서 확장한다.
문단 margin과 line spacing은 직접 자식뿐 아니라 `hp:switch`의 지원 가능한 `hp:case`와
fallback `hp:default` 안에서도 읽어 동일한 `ViewerParaStyle`로 정규화한다.

## 프로세스 책임

### Electron main

- macOS `open-file`, single-instance, 파일 대화상자 처리
- 자체 HWPX UTI와 기존 한컴 HWPX UTI의 Finder 문서 연결
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
- `pageNum`을 본문 흐름과 분리된 쪽 번호 decoration으로 표시
- 구역별 `header/footer`를 페이지 위·아래 decoration으로 표시하고 `BOTH/EVEN/ODD` 선택
- 폰트 대체, 페이지 overflow, 로딩 시간 진단
- 시스템 함초롬체의 한글·영문 family 별칭 해석(글꼴 파일은 번들하지 않음)
- 50페이지 이하는 전체 DOM 렌더
- 50페이지 초과는 viewport 주변 page만 mount
- 트랙패드 pinch와 `⌘+`/`⌘-`/`⌘0`을 50–200% zoom 상태로 통합
- 문서 mutation, 저장 history, `contentEditable` 금지

첫 화면은 OWPML `lineseg`와 셀 선언 높이를 사용하는 결정적 pagination으로 즉시 표시한다.
동시에 화면 밖 측정 레이어가 원본 block과 표 행을 현재 resolved font로 한 번 렌더링해 CSS
높이를 HWPUNIT으로 되돌린다. 두 번째 pagination은 실측 행이 남은 공간에 들어갈 때만 경험적
표 분할을 생략하고 `lineseg vertpos`가 되감기는 원본 페이지 경계를 적용한다. 실측 높이가
더 크면 내용 보존을 위해 행 단위 분할이 원본 경계보다 우선한다.

측정 모드의 `measurable` 표시는 top-level 문단에서 `TableView`와 각 셀의 `ParagraphView`까지
전파한다. 따라서 셀 문단은 페이지 전체 폭이 아니라 실제 colgroup과 셀 너비에서 줄바꿈된 DOM
높이를 가지며, 일반 화면 렌더에는 측정용 data attribute를 노출하지 않는다.

`cell_fragment`의 순수 함수는 셀 위·아래 padding과 문단별 실측 높이를 사용해 head/tail 후보를
계산한다. 첫 문단이 남은 공간에 들어가지 않거나 모든 문단이 들어가면 분할하지 않으며, 문단
참조와 순서를 그대로 보존한다. rowSpan 참여 행, 이전 rowSpan에 덮인 행, 동시에 둘 이상의 셀이
넘치는 행과 단일 초대형 문단은 기존 행 단위 pagination 또는 overflow 진단으로 fallback한다.
측정값이 있는 두 번째 pagination pass에서만 `fragmentTableBlock`에 연결하고, 무측정 첫 pass는
기존 행 단위 결과를 유지한다.

원본 셀은 결정적 `sourceCellId`를 가지며 pagination이 만들 continuation cell은 `splitTop`과
`splitBottom`을 사용할 수 있다. renderer는 잘린 위·아래 border와 padding을 제거하고 fragment의
원본 min-height를 해제하며 vertical-align을 top으로 고정한다. flag가 없는 원본 셀의 스타일은
기존과 동일하다. `full`, `head`, `tail`, 양쪽이 잘린 중간 조각은 서로 다른 React key를 사용한다.

부분 행은 원본 행의 DOM 실측값을 다시 참조하지 않고 `fragmentHeight`를 명시해 pagination 높이를
결정한다. `rowSpan > 1`인 셀이 하나라도 있는 표는 표 전체에서 셀 분할을 비활성화하고 기존 행
단위 pagination으로 fallback한다. 단 하나의 셀이 넘칠 때 head를 현재 fragment에 넣고 tail을
다음 fragment로 넘긴다. 짧은 이웃 셀의 내용은 head에만 두고 tail에는 빈 placeholder를 남겨
열 구조와 배경을 유지하며, 여러 페이지에 걸치면 잘린 padding을 다시 더하지 않고 반복 분할한다.
테두리 두께는 현재 문단 수용량 계산에 포함하지 않으므로 공개 fixture와 production 문서의 실제
overflow 진단으로 검증한다.

### PDF export

renderer는 PDF 준비 요청을 받으면 page virtualization을 잠시 해제하고 폰트와 이미지 decode,
React paint가 끝날 때까지 기다린다. print media에서는 toolbar, status bar, page shadow와 page
gap을 제거한다. main process는 HWPUNIT 용지 크기를 inch로 변환한 custom page size와 0 margin,
background 인쇄 옵션으로 `printToPDF`를 실행한다. 완료 또는 오류 후 화면 가상화를 복원한다.
쪽 번호는 화면과 PDF가 동일한 DOM을 사용하므로 두 출력에서 같은 위치와 값을 유지한다.
pagination 결과는 block 배열과 함께 section index와 section 내부 page index를 보존한다.
renderer는 이를 이용해 `startNum page > 0`에서 번호를 재시작하고, 새 정의가 없는 section은
앞 section의 쪽 번호와 header/footer를 이어받는다. header/footer의 `subList` 문단은 본문과
같은 문단·표·이미지 renderer를 쓰되 절대 위치 decoration으로 배치해 본문 pagination에는
영향을 주지 않는다.

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
- 선언 높이와 실제 DOM 높이를 결합한 2-pass pagination 회귀 테스트

production 번들의 반복 가능한 검증이 필요할 때만 `HAN_FLOW_E2E=1`을 설정한다. 이 모드에서는
개발용 visual capture, 앱 성능 측정과 고정 PDF 출력 경로를 패키지 앱에서도 사용할 수 있다. 환경 변수가
없는 일반 패키지 실행은 항상 macOS 저장 대화상자를 사용한다. overflow는 세로뿐 아니라
가로 `scrollWidth`도 검사하며, 표는 본문 너비를 넘지 않도록 축소한다.

## v1 이후

`.hwp` 바이너리 열람은 v2에서 기존 파서 활용을 검토한다. 텍스트·표·이미지 편집과 안전한
HWPX 재저장은 v3 범위다. 기존 편집 프로토타입 코드는 v1 런타임 계약으로 간주하지 않는다.
