# Han-Flow 기술 아키텍처

Han-Flow는 V1의 읽기 전용 HWPX flow renderer와 V2의 HWP fixed-page renderer를 공통
macOS shell에 연결했다. 현재 production 경로는 편집 상태나 Undo/Redo를 관리하지 않고,
받은 문서를 빠르게 열어 레이아웃이 깨지지 않게 표시하고 PDF로 내보내는 데 집중한다.
V3 편집은 이 read-only 경계를 변경하지 않고 source package와 command layer를 별도로 둔다.

## 파이프라인

```text
macOS open-file / drag-and-drop / file dialog
  → Electron main process
  ├─ HWPX → HwpxPackageReader → ordered XML → flow ViewerDocument → block pagination
  └─ HWP  → size/CFB magic → dedicated Web Worker → @rhwp/core WASM
                                                    → FixedPageDocument
                                                    ├─ sanitized page SVG image
                                                    └─ positioned text run layer
  → shared React zoom / page virtualization / PDF shell
```

parser는 React와 CSS를 모르고 renderer는 ZIP/XML을 해석하지 않는다. 길이는 문서 모델에서
HWPUNIT 정수로 유지하고 화면 경계에서만 CSS px로 변환한다. 동일 입력은 source 위치 기반의
결정적 ID를 만들어 테스트와 캐시가 재현 가능해야 한다.

HWPX의 read-only와 editing source package는 같은 ZIP metadata preflight를 사용한다. ordered
XML parser 앞에서는 depth·node·text 예산과 DOCTYPE 금지를 적용한다. `BinData`는 순차적으로
읽으며 원본 byte와 raster header의 decoded dimension·pixel 예산을 함께 누적한다. 예산 초과나
손상 raster header는 renderer image decode 전에 importer의 구조화된 HWPX 오류로 끝난다.

## V3 편집 경계

V3는 `ViewerDocument`를 저장 원본으로 사용하지 않는다. HWPX의 모든 ZIP entry와 알 수 없는
XML을 보존하는 `SourcePackage`, command·transaction·selection을 가진
`EditableDocument`, 기존 `ViewerDocument` projection을 분리한다.

```text
SourcePackage → EditTransaction → EditableDocument
                                      │
                                      ▼
                              ViewerDocument projection
                                      │
                                      ▼
                         pagination / renderer / PDF
```

조합 중인 paragraph input surface는 browser가 소유하고 `compositionend`에서 한 transaction을
commit한다. 저장은 같은 디렉터리의 임시 package를 다시 열어 검증한 뒤 교체한다. 세부 모델,
기존 코드 폐기 판정과 품질 관문은
[V3 HWPX 편집 조사와 구현 전략](v3_editing_strategy.md)에 기록한다.

V3-1에서 `HwpxSourcePackage`를 구현했다. ZIP central directory를 먼저 검사해 절대 경로,
`..`, 역슬래시, NUL, duplicate, encrypted entry, 미지원 compression과 개수·개별·전체
압축 해제 크기 초과를 거부한다. 허용된 entry는 원본 순서, uncompressed bytes, CRC와
stored/deflate 방식을 source snapshot에 보유한다. `mimetype`은 정확한
`application/hwp+zip` bytes와 stored 방식을 모두 요구한다.

identity writer는 이 snapshot만 재패킹한다. ZIP timestamp나 압축 결과 bytes 자체는 동일성
기준이 아니며, entry 순서·경로·compression·CRC와 각 uncompressed content SHA-256을
재개봉 후 비교한다. V3-1 시점에는 이 writer를 사용자 저장 IPC에 노출하지 않았다.

V3-2의 `text_patch`는 UTF-8 section XML을 token 단위로 훑고 단순 `hp:t`의 source span과
문서 순서 기반 ID를 만든다. command는 package revision, text node ID와 DOM과 같은 UTF-16
범위를 함께 검증한다. target text content만 XML escape해 교체하므로 target 밖의 tag, attribute,
공백과 unknown node는 byte 단위로 유지된다. 복합 자식, 잘못된 entity, 비 UTF-8 XML,
surrogate pair 중간 범위와 stale revision은 수정하지 않고 conflict로 끝낸다.

`saveHwpxAs`는 원본 overwrite와 기존 목적지 overwrite를 모두 금지한다. 목적지와 같은
directory의 `wx` 임시 파일에 package를 쓰고 `fsync`한 다음, source package identity와 기존
Han-Flow decoder를 다시 통과시킨다. 추가 semantic verifier까지 성공한 뒤에만 hard link로
목적지 이름을 원자적으로 생성하고 임시 이름을 제거한다. V3-2 시점에는 이 코어를 preload에
노출하지 않았다.

V3-3의 `EditTransaction`은 base revision, command 배열, 전후 selection, `inputType`과
composition ID를 가진다. command는 순서대로 immutable package에 적용하며 중간 command가
실패하면 부분 package를 반환하지 않는다. 성공 transaction은 역순 inverse command와
`LossReport`를 만들고, 수정된 `HwpxSourcePackage` 자체를 기존 decoder의
`HwpxReadablePackage` 계약으로 다시 projection할 수 있다.

`HwpxEditHistory`는 package snapshot을 저장하지 않고 forward/inverse transaction만 최대
100 entries, 추정 8 MiB로 제한한다. 연속 타이핑은 같은 input type·text anchor, selection
연속성과 1초 이내 시간 창이 모두 맞고 composition 밖일 때만 묶는다. savepoint 직후에는
grouping하지 않아 undo가 저장 상태를 건너뛰지 않는다. dirty 판정은 계속 증가하는 package
revision이 아니라 logical state ID와 savepoint ID를 비교한다.

2026-09-01부터 history entry는 package delta와 함께 구조별 loss policy의 전후 상태도 가진다.
command는 본문 텍스트, 글자 모양, 문단 모양, 문단 구조로 분류하며 연속 입력 grouping은 구조
집합을 합친다. undo는 entry의 이전 정책, redo는 이후 정책을 복원하므로 취소된 편집이 저장
안내에 남지 않는다. 이 정책은 source path나 본문 없이 구조 kind와 안정적인 notice code만
노출한다. 손대지 않은 package 내용은 `preserved`, 수정 구조는 `targeted-source-edit`이며 문단
구조만 호환성 `review`, 나머지는 `low`다.

Sprint 2부터 `EditorSelection`은 section 하나와 독립적인 anchor/focus text node ID·UTF-16
offset을 가진다. 코어는 ordered `hp:t` 순서로 여러 run 범위를 정규화하고 역방향 여부를
보존하며, 없는 anchor와 surrogate pair 중간 offset을 거부한다. 같은 문단의 renderer surface는
run 경계의 Shift+방향키 selection을 이 모델로 확장한다. cross-run 입력은
첫 run의 선택 꼬리에 새 text를 넣고 중간 run 전체와 마지막 run의 선택 머리를 비우는 command
배열로 main에 보내며, 한 transaction으로 undo/redo한다. 빈 `hp:t`와 run style 구조는 손실 방지를
위해 유지한다. 독립 `contentEditable` host 사이의 native pointer selection은 Chromium이 한 host로
접으므로 공통 paragraph editing host 설계 전까지 지원하지 않는다. 글자 style command는 아직 한
run 범위만 적용한다.

V3-4에서 source package와 history의 실제 소유자를 Electron main으로 확정했다. 각
`webContents.id`에는 하나의 무작위 session ID만 연결되고 commit은 sender별 queue에서
직렬 실행된다. renderer는 source ZIP bytes나 revision을 소유하지 않으며 text node ID,
UTF-16 diff와 전후 selection만 보낸다. 창 종료나 새 문서 열기에서는 session을 폐기한다.

`ViewerText.sourceAnchor`는 section path와 ordered XML의 `hp:t` ordinal로 만든 결정적 ID다.
React의 `plaintext-only` surface는 composition 동안 browser DOM을 그대로 두고,
`compositionend`에서 한 transaction을 main에 보낸다. projection 응답이 돌아오기 전에는
낡은 React text로 DOM을 덮어쓰지 않으며 마지막 응답 뒤 selection을 복원한다. 현재 editable
surface는 최상위 text 문단의 source anchor별 run과 안전한 일반 body cell의 단일 run에
적용된다. 여러 run은 별도 surface로 source style을 유지하고 좌우 경계 navigation으로
연결한다. measurement tree, 반복·병합·continuation 표, 머리말·꼬리말과 HWP fixed page에는
적용하지 않는다.

V3-4 Save As는 renderer에 경로나 writer 단계를 조합할 권한을 주지 않는다.
`editing:saveAsDialog` 하나가 sender/session을 검증하고 Preview stale 경고, 네이티브 목적지
선택, `EditingSessionManager.saveAs`를 순서대로 수행한다. save manager는 sender별 transaction
queue에 저장을 넣어 진행 중 edit와 경쟁하지 않게 하며 `saveHwpxAs`가 성공한 뒤에만
`HwpxEditHistory.markSaved()`를 호출한다. 기존의 무제한 `dialog:saveFile`과
`dialog:confirmSave` preload API는 제거했다.

저장 확인창과 dirty 종료창은 session history의 현재 `HwpxSaveLossPolicy`를 읽어 실제 변경된
구조만 열거한다. Preview는 편집 구조가 남아 있고 entry가 존재하면 `stale`, 원문 상태로 undo한
경우 `current`, 원래 entry가 없으면 `omitted`다. 검증 저장 결과도 같은 policy snapshot을 반환해
renderer 완료 상태가 확인창과 다른 설명을 만들지 않게 한다.

dirty 문서 교체와 종료도 동일한 main 경계를 사용한다. renderer의 dialog·drop·Finder
`file:open` 경로는 새 import 전에 `editing:resolveDirty`를 호출하고, main의 BrowserWindow
`close` handler는 renderer가 응답할 수 없는 `⌘Q`와 창 닫기를 직접 보호한다. 선택지는
Save As, discard, cancel이며 Save As는 위와 같은 검증 writer를 재사용한다.

비동기 결정을 기다리는 동안 반복 close는 `resolvingClose`로 막지만, 결정 후 호출하는 두
번째 close는 `closeApproved`가 우선해 통과해야 한다. 앱 종료 요청을 처음 막은 경우에는
BrowserWindow `closed` 뒤 `app.quit()`을 재개해 macOS Dock에 빈 프로세스가 남지 않게 한다.

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
- HWP 200 MiB·CFB magic preflight와 byte 전달
- 작은 문서의 전체 decode 및 renderer IPC 전달
- 대형 문서 worker 생성·취소·오류 전달
- renderer 준비 완료 후 `webContents.printToPDF` 실행과 파일 저장

### Decoder worker

section이 20개 이상이거나 section 하나의 압축 전 크기가 2MiB 이상이면 worker thread를
사용한다. 첫 section 모델을 먼저 보내고 전체 모델은 별도 worker 작업으로 완성한다. load ID가
바뀌면 이전 worker를 종료하며 늦게 도착한 결과는 renderer가 무시한다. worker 오류가 발생해도
이미 표시한 첫 section은 유지하고 상태 표시줄에 나머지 페이지 오류를 노출한다.

### HWP Web Worker

renderer adapter는 HWP를 열 때 rhwp 전용 module Worker를 만들고 WASM과 검증된 HWP byte를
transfer한다. document 생성, 페이지 정보, SVG와 text layout 생성은 UI thread 밖에서만
실행한다. open은 30초, page SVG·text layout은 요청마다 15초 제한을 두며, 제한을 넘기거나
새 문서를 열면 Worker 자체를 종료해 동기 WASM 작업도 계속 실행되지 않게 한다.

모든 요청과 응답은 증가하는 ID로 연결한다. 늦은 응답은 버리고 Worker crash·timeout이면
진행 중 요청을 같은 분류 오류로 끝낸 뒤 열린 문서 상태와 cache를 무효화한다. Worker가
반환한 SVG는 script·event·외부 resource 검사와 5천만 문자 상한을 통과해야 하며, text
layout도 JSON parse 전에 같은 크기 상한을 적용하고 run·문자·좌표 범위를 다시 검사한다.

### Renderer

- HWPX `ViewerDocument`를 읽기 전용 flow page로 표시
- HWP `FixedPageDocument`의 세로·가로 용지와 section index를 보존
- HWP WASM과 약 7 MB asset을 `.hwp`를 열 때만 지연 로딩
- HWP 첫 페이지 SVG를 먼저 생성하고 짧은 유휴 구간 뒤 나머지 페이지를 순차 생성
- HWP SVG의 실행 요소·event attribute·외부 resource를 거부한 뒤 blob image로 표시
- SVG image가 표시된 뒤 React text layer를 붙여 `⌘F` 검색·선택·접근성 제공
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
gap을 제거한다. HWPX는 HWPUNIT 용지 크기를 inch로 변환한 단일 custom page size를 사용한다.
HWP fixed page는 각 article에 고유한 CSS named page와 px 용지 크기를 부여하고
`preferCSSPageSize`로 인쇄한다. 인쇄 flex container는 좌측 원점에 정렬해 가로 page가 첫 세로
page 폭을 기준으로 가운데 정렬되어 잘리는 것을 막는다. main process는 0 margin과 background
인쇄 옵션으로 `printToPDF`를 실행하고 완료 또는 오류 후 화면 가상화를 복원한다.
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
- `npm run verify:app -- <fixture.hwpx>` production 앱 smoke test
- `npm run verify:matrix` 공개 fixture production 회귀 matrix
- `npm run verify:pdf -- <fixture.hwp|fixture.hwpx>` 화면/PDF pagination·용지 크기와 Poppler 재렌더
- `npm run release:check -- <fixture.hwpx>` v1 RC 통합 관문
- 화면/PDF 페이지 수, overflow, font substitution 진단
- 선언 높이와 실제 DOM 높이를 결합한 2-pass pagination 회귀 테스트

production 번들의 반복 가능한 검증이 필요할 때만 `HAN_FLOW_E2E=1`을 설정한다. 이 모드에서는
개발용 visual capture, 앱 성능 측정과 고정 PDF 출력 경로를 패키지 앱에서도 사용할 수 있다. 환경 변수가
없는 일반 패키지 실행은 항상 macOS 저장 대화상자를 사용한다. overflow는 세로뿐 아니라
가로 `scrollWidth`도 검사하며, 표는 본문 너비를 넘지 않도록 축소한다.

visual E2E 상태는 본문 문자열을 기록하지 않고 페이지 수, 이미지 decode 상태, 페이지별
비공백 글자 수, overflow와 timing만 출력한다. HWP 검색 검증도 query 본문이나 일치 문장을
기록하지 않고 결과 page·occurrence·highlight 수, 선택 글자 수와 접근성 node 수만 남긴다.
E2E가 시작된 뒤 `app.getAppMetrics()`의 process working set을 50ms 간격으로 합산하고 현재값,
동시 sampled peak와 process별 lifetime peak 합계를 숫자로만 기록한다. macOS에서는 shared
page가 여러 process working set에 중복될 수 있으므로 고유 물리 메모리가 아니라 동일 환경의
회귀 지표로 사용한다.
같은 페이지별 글자 수를 Poppler PDF 추출 결과와 비교해 화면 pagination과 `printToPDF`
pagination이 일치하는지 검증한다.
`verify:app`은 별도 Electron user-data에서 패키지를 실행해 single-instance 충돌을 피하고,
JSON 상태를 읽은 뒤 임시 파일과 user-data를 제거한다.
`verify:matrix`는 공개 생성기를 재사용해 기본, cell continuation, 80-section progressive
fixture를 각각 격리 실행한다. 대형 문서는 전체 page count보다 mount된 `.viewer-page` 수가
작아야 통과하므로 50페이지 초과 virtualization 회귀도 함께 잡는다.
matrix에는 이미지 12개와 `rowSpan=2` 표, 필수 entry가 빠진 손상 package도 포함한다.
손상 입력은 오류 문구 자체를 수집하지 않고 사용자 오류가 비어 있지 않게 표시되는지만 검사한다.

`verify:pdf`는 production 앱의 고정 PDF 출력과 visual state를 같은 격리 실행에서 수집한다.
Poppler `pdfinfo`, `pdftotext`, `pdftoppm`으로 페이지 수, 각 page MediaBox에 대응하는 용지
크기, 페이지별 비공백 글자 수와 대표 PNG 재렌더를 검사한다. HWPX는 화면과 PDF의 페이지별
글자 수가 같아야 한다. HWP는 화면의 별도 text layer와 인쇄 SVG의 추출 경로가 다르므로 전체
98%, 각 page 96% 이상을 요구한다. 첫·중간·끝 page와 모든 가로 page를 PNG로 다시 만든다.

visual state는 고정 지연 직후 바로 읽지 않는다. background decode가 끝나고 DOM measurement가
완료된 뒤 전체·mount page signature가 250ms 간격으로 3회 같을 때만 상태를 확정한다. 대형
문서의 partial model → full model → measured pagination 전환 중간값을 최종 결과로 오인하지
않기 위한 안정성 계약이다.

## v1 이후

### V2 importer 경계

```text
file path
  → format detector (extension + magic + format signature)
  → DocumentImporter
      ├─ HwpxImporter → current flow ViewerDocument
      └─ HwpImporter  → selected parser adapter
  → read-only page boundary
  → shared macOS viewer shell and PDF export
```

V2는 `.hwp` 레코드 parser 전체를 직접 만들지 않는다. 저장소 밖 기준 문서 삼쌍 비교와 품질 관문
결과 `@rhwp/core`를 production fixed-page engine, `kordoc`을 development-only semantic
oracle로 확정했다. 자동 fallback은 두지 않으며 결정 근거는
[ADR-0001](adr/0001-hwp-parser-roles.md)에 있다.

현재 비신뢰 HWP binary는 main이 200 MiB 제한, CFB 무결성, `FileHeader` signature와 5.x
version을 확인한 뒤 전용 Web Worker로 전달한다. 암호·배포용·DRM·비지원 version·손상
container는 구조화된 오류 코드와 사용자 문구로 거부한다. rhwp document 생성과 모든 페이지
작업은 renderer UI thread 밖에서 실행하고
timeout·새 load는 Worker 강제 종료로 처리한다. WASM 컴파일을 위해 CSP
`wasm-unsafe-eval`만 추가했으며 외부 script는 계속 허용하지 않는다. SVG는 검증 후 blob
image 경계에서 표시한다. `containsScripts`는 진단하되 Scripts, OLE와 외부 link는 실행하지
않는다. HWP 결과와 HWPX 결과는 main의 `DocumentImporter`가 format-neutral
`document:import` IPC 계약으로 반환하며 preload와 React loader는 형식별 IPC를 노출하지
않는다. HWPX background 완료·오류도 같은 document event namespace를 사용한다.

현재 `@rhwp/core`의 페이지 표현이 우세해 read-only fixed-page variant를 추가했고 zoom,
virtualization과 진단 shell을 공유한다. 정제된 blob image 위에 renderer가 검증한 좌표형 text
run을 React로 렌더링한다. 따라서 SVG markup을 DOM에 주입하지 않으면서 검색·선택·접근성을
제공한다. 첫 page image의 `load`를 첫 화면 기준으로 삼고 text layer와 나머지 page는 그 뒤
불러온다. Worker 격리 후 cold 20회 첫 화면 p95는 614ms다. CSS named page 기반
mixed-orientation PDF도 page별 크기와
텍스트 보존, 대표 PNG 관문을 통과했다. Worker 격리 후 실사용 기준 HWP aggregate
working set peak p95는 647.6MiB이고 HWPX 기준선은 438.3MiB다. 격리 전 HWP p95보다
58.0MiB 증가한 비용은 다음 최적화 판단에 사용한다. 자세한 결정 기준과 출처는
[V2 HWP 5.0 조사와 도입 전략](hwp_v2_strategy.md)에 기록한다.

renderer에 bundle되는 `@rhwp/core`는 build-time dependency다. production `node_modules`에
같은 WASM을 다시 넣지 않고 Vite가 만든 단일 asset만 패키징한다. MIT license 원문은
`Contents/Resources/licenses/rhwp-MIT.txt`에, 배포 고지는 같은 디렉터리의
`THIRD_PARTY_NOTICES.md`에 포함한다. Han-Flow 자체 Apache-2.0 원문도
`Han-Flow-Apache-2.0.txt`로 함께 넣는다.

텍스트·표·이미지 편집과 안전한 HWPX 재저장은 V3 범위다. 사용자 배포·서명·공증은 V4
범위다. 기존 편집 prototype 코드는 현재 런타임 계약으로 간주하지 않는다.
