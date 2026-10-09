# Han-Flow 기술 아키텍처

기준일: 2026-09-28

Han-Flow는 HWPX flow renderer, HWP fixed-page renderer와 제한적 HWPX 편집 계층을
Windows·macOS·Linux 공통 Electron 44 shell에 연결한다. production 경로는 읽기·검색·PDF뿐 아니라
main process가 소유하는 편집 session, transaction 기반 Undo/Redo, 구조별 loss policy와
검증형 Save As를 함께 관리한다. HWP는 계속 읽기 전용이며 HWPX 편집은 source package와
command layer를 화면용 `ViewerDocument`와 분리해 원본 package 보존 경계를 유지한다.

## 파이프라인

```text
OS file open / drag-and-drop / file dialog
  → Electron main process (창별 경로 허용목록)
  ├─ HWPX → HwpxPackageReader → decoder worker → ordered XML → flow ViewerDocument → block pagination
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
commit한다. 저장은 같은 디렉터리의 임시 package를 다시 열어 검증한 뒤 목적지에 원자적으로 게시한다. 세부 모델,
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

편집 command(text·글자/문단/셀 모양·문단 구조·표 구조)는 모두 section·header.xml을 원문 byte 범위를 보존하는 source tree
(`source_tree.ts`)로 읽어 node 연산으로 고친다. tree는 `xml_scan.ts`의 tokenizer(`iterateXmlTokens`) 하나로 element·text·
comment·PI·CDATA·선언 node를 만들고, 각 node가 원문 범위와 dirty 표시를 들고 있다. serializer는 dirty가 아닌 연속 형제를 원문
한 구간으로 복사하고 바뀐 node만 다시 쓰므로 target 밖의 tag·attribute 표기·공백·unknown node는 byte 단위로 유지된다.
attribute는 따옴표를 인식해 읽고(entity 해석) 쓸 때 escape한다(`readTagAttribute`·`writeTagAttribute`·`setSourceAttribute`).
command는 package revision, `${sectionPath}#hp:t:N` anchor(source tree의 N번째 `hp:t`, viewer decoder의 `sourceOrdinal`과 같은 순서)와
DOM과 같은 UTF-16 범위를 검증한다. 복합 자식, 잘못된 entity, 비 UTF-8 XML, surrogate pair 중간 범위와 stale revision은 수정하지 않고
conflict로 끝낸다.

- text: anchor의 `hp:t`에서 편집 범위에 걸친 text node만 바꾼다(inline `hp:tab`·`hp:lineBreak`·entity 원문 표기 보존).
- 글자·문단·셀 모양: `hp:run`·`hp:p`·`hp:tc`를 부모 관계로 찾아 reference attribute를 바꾸고, 복제한 `hh:charPr`·`hh:paraPr`·
  `hh:borderFill`을 header.xml tree의 collection 끝에 붙인다.
- 문단 분할·병합·여러 문단 범위 치환: `hp:p`·`hp:run`·`hp:t` node로 교체 fragment를 만들고, fragment에 해당하는 형제 node를 조각 tree로 바꾼다.
- 표 행·열 추가/삭제, 셀 병합·분할: `hp:tc`·`hp:tr`·`hp:tbl`에서 topology를 검사하고, 표 node를 작업용 tree로 복제해
  `rowCnt`/`colCnt`·주소·크기 attribute와 행·셀 node를 고친 교체 fragment로 표 node를 바꾼다.

inverse는 바뀌기 전 원문(tag·fragment·지운 text의 원문 표기)을 들고 있어 실행 취소가 원래 bytes를 복원한다. section·header tree는
package 객체별 cache(`package_trees.ts`)에 있고, tree를 고친 command가 새 package로 옮기므로 연속 편집은 entry를 다시 parse하지 않는다.
V3-2부터 tree 전환(2026-09-29 text ~ 2026-10-06 표 구조) 전까지는 command마다 XML 문자열을 다시 훑어 offset 범위를 문자열로 이어 붙이는 patch 경로를 썼다
(전환 과정과 그 경로의 잠재 버그는 [편집 코어 tree 모델 전환 계획](editing_core_refactor_plan.md) 참고).

`saveHwpxAs`는 목적지와 같은 directory의 `wx` 임시 파일에 package를 쓰고 `fsync`한 다음,
source package identity와 기존 Han-Flow decoder, semantic verifier를 다시 통과시킨 뒤에만 게시한다.
2026-09-28 기준 게시 정책은 다음과 같다.

- 원본과 열린 편집 session의 원본은 경로와 `dev`·`ino` 비교로 항상 거부한다.
- 저장 대화상자에서 교체를 확인하지 않았으면 hard link(`link`)로 게시한다. 확인 뒤 같은 이름이
  생겼다면 OS가 `EEXIST`로 원자적으로 거부한다. 성공하면 임시 이름만 지운다.
- 교체를 확인했으면(`overwrite`) 게시 직전에 정책을 다시 확인하고 `rename`으로 원자 교체한다.
- hard link를 지원하지 않는 파일 시스템(exFAT·FAT32·일부 SMB)에서는 재확인 후 `rename`으로
  물러서며, 확인과 rename 사이의 짧은 경쟁 구간이 남는다.
- POSIX에서는 게시 뒤 디렉터리를 `fsync`한다. 게시 파일 권한은 umask를 적용한 기본값이다.
- 목적지 판정은 `lstat`을 사용해 심볼릭 링크·폴더를 대화상자 단계에서 거부한다.
- PDF 내보내기도 같은 원자적 쓰기 도우미와 원본 보호를 사용한다.

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
위해 유지한다. 2026-08-22부터 공통 paragraph editing host가 native pointer drag selection을 모델
selection으로 읽으며, 같은 section의 최상위 문단은 scope를 공유하고 표 셀 문단은 cell별 scope로
격리한다. 글자 style command는 아직 한 run 범위만 적용한다.

V3-4에서 source package와 history의 실제 소유자를 Electron main으로 확정했다. 각
`webContents.id`에는 하나의 무작위 session ID만 연결되고 commit은 sender별 queue에서
직렬 실행된다. renderer는 source ZIP bytes나 revision을 소유하지 않으며 text node ID,
UTF-16 diff와 전후 selection만 보낸다. 창 종료나 새 문서 열기에서는 session을 폐기한다.

`ViewerText.sourceAnchor`는 section path와 ordered XML의 `hp:t` ordinal로 만든 결정적 ID다.
React의 `plaintext-only` surface는 composition 동안 browser DOM을 그대로 두고,
`compositionend`에서 한 transaction을 main에 보낸다. projection 응답이 돌아오기 전에는
낡은 React text로 DOM을 덮어쓰지 않으며 마지막 응답 뒤 selection을 복원한다. 현재 editable
surface는 최상위 text 문단의 source anchor별 run과, 모든 문단이 단일 run인 안전한 일반 body cell에
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

2026-09-01 renderer 상태는 `useRendererState` 아래 세 reducer로 분리했다. document slice는
`ViewerDocument`·fixed-page document·열기 진행과 진단·font projection을, viewer slice는 zoom·
virtual range·검색·PDF·layout 측정을, editing slice는 session history 표시·selection·pending·
사용자 안내를 소유한다. `App`은 typed setter adapter만 사용하므로 한 slice의 field update가 다른
slice를 암묵적으로 초기화하지 않는다.

IME 조합 여부는 keydown과 문서 교체 요청에서 React render보다 먼저 확인해야 하므로 별도의
`EditingImeTransientState`가 소유한다. 이 객체에는 composing flag, 최신 session/pending의 read-only
mirror와 session-local transaction sequence만 있고 문서 model이나 source text는 없다. 새 문서를
열 때 즉시 reset하며 reducer state와의 독립성, pending 함수 전이와 reset을 단위 테스트한다.

화면 조합도 같은 날짜에 `ViewerToolbar`, `ViewerStage`, `ViewerPageStack`, `ViewerStatusBar`로
분할했다. toolbar와 ribbon은 편집 command callback을 props로만 받고 IPC를 호출하지 않는다.
stage는 loading/error/empty 경계, page stack은 HWP/HWPX format metadata·zoom·virtual spacer,
status bar는 revision·진행률·진단 표시만 소유한다. `App`은 문서 열기와 편집 command의 비동기
orchestration 및 page content 조합에 집중한다. IME DOM lifecycle은 이미 분리된
`ParagraphInputSurface`에 남아 shell 재렌더가 composition buffer를 소유하지 않게 한다.

Sprint 3의 첫 글꼴 편집은 새 font-face writer가 아니다. decoder가 이미 projection한 HANGUL
font-face ID 목록을 ribbon에 제공하고, character style command는 선택된 ID가
`Contents/header.xml`의 HANGUL collection에 실제 존재하는지 다시 검증한다. 성공하면 기존
charPr 복제·signature deduplication·reference 교체와 inverse 경로를 사용한다. 시스템 font 목록과
family 문자열은 command에 들어가지 않으므로 renderer가 임의 package font를 만들 수 없다.

dirty 문서 교체와 종료도 동일한 main 경계를 사용한다. renderer의 dialog·drop·Finder
`file:open` 경로는 새 import 전에 `editing:resolveDirty`를 호출하고, main의 BrowserWindow
`close` handler는 renderer가 응답할 수 없는 앱 종료(macOS `⌘Q`)와 창 닫기를 직접 보호한다. 여러 창이
열려 있으면 닫히는 그 창을 dialog 부모와 close 대상으로 사용한다. 선택지는
Save As, discard, cancel이며 Save As는 위와 같은 검증 writer를 재사용한다.

비동기 결정을 기다리는 동안 반복 close는 `resolvingClose`로 막지만, 결정 후 호출하는 두
번째 close는 `closeApproved`가 우선해 통과해야 한다. 앱 종료 요청을 처음 막은 경우에는
BrowserWindow `closed` 뒤 `app.quit()`을 재개해 macOS Dock에 빈 프로세스가 남지 않게 한다.

paragraph style의 `heading`은 header의 bullet 문자 또는 numbering `paraHead` pattern과
결합한다. decoder가 동일 문단 목록 안에서 번호를 증가시켜 `ViewerParagraph.marker`를 만들고,
renderer는 marker를 본문 앞에 읽기 전용 텍스트로 표시한다. 현재 문자 bullet과 DIGIT 번호를
지원하며 다른 번호 체계는 원문 format 정보를 모델에 보존한 뒤 후속 formatter에서 확장한다.
문단 margin과 line spacing은 직접 자식뿐 아니라 paraPr 안 모든 `hp:switch`의 `hp:case`와
fallback `hp:default` 안에서도 읽어 동일한 `ViewerParaStyle`로 정규화한다. 각 `hh:margin`의 단위는
`src/core/document/paragraph_margin_units.ts`가 그 node의 조상 경로만으로 정한다: HwpUnitChar namespace
`hp:case` 안이면 실제 HWPUNIT, `hp:default` 안이나 직접 자식이면 2배 값, 다른 namespace `hp:case` 안이면 단위를
모르는 node다. viewer는 HwpUnitChar case를 먼저, 없으면 문서 순서상 첫 2배 node를 읽는다. 문단 모양 command는
같은 판정으로 case(×1)·default(×2)·직접(×2) representation을 모두 고치고 줄 간격(PERCENT)은 모든 representation을
같은 값으로 맞추며, 단위를 모르는 representation에 여백·줄 간격이 있으면 원본을 바꾸지 않고 거부한다.

문단 모양 command는 run 내부가 아니라 `paraPrIDRef`만 교체하므로 `hp:t` 안의 `hp:tab`을
수정하지 않는다. 원본 paraPr를 복제할 때 `tabPrIDRef`와 `hh:heading`의 raw 구조를 불변식으로
비교하고 하나라도 달라지면 적용을 중단한다. decoder는 `tabPrIDRef`를 `ViewerParaStyle.tabPrId`로
투영해 저장 후 검증할 수 있게 하며, 목록 marker projection은 복제된 heading을 그대로 사용한다.
이 계약은 기존 탭·목록의 보존만 뜻하며 탭 정의나 bullet·numbering definition 편집을 허용하지 않는다.

구역의 `hp:colPr`은 `ViewerSection.columnLayout`에 type, layout, 단 개수, 동일 너비 여부,
공통 간격과 개별 단 너비·간격으로 정규화한다. 잘못된 단 개수는 모델에 넣지 않고 안정적인
`HWPX_INVALID_COLUMN_LAYOUT` diagnostic을 남긴다. 동일 너비 `NEWSPAPER/LEFT`는 문단의
`columnBreak`, 단별 가용 높이와 source/DOM 측정 높이로 왼쪽 단→오른쪽 단→다음 페이지 순서의
`ViewerPage.columns`를 만든다. renderer 측정 폭도 `(본문 폭 - 전체 단 간격) / 단 수`로 계산하고
CSS grid에 같은 간격을 사용한다. 지원하지 않는 `PARALLEL`, `RIGHT`·`MIRROR`와 비동일 너비는
`HWPX_MULTI_COLUMN_LAYOUT_FALLBACK`을 남기고 단일 흐름으로 표시한다. 서로 다른 너비 선언 수가
단 개수와 다르면 별도 incomplete 진단을 추가해 구조 손실을 숨기지 않는다.

표 셀 text와 구조 편집 조건은 분리한다. pagination fragment를 제외한 모든 셀에서 source anchor만으로
이루어진 문단은 `TABLE_CELL_TEXT` context가 되어 text 입력·삭제·치환을 허용한다. 구조 command(행·열
추가/삭제, 병합·분할, 셀 style, 문단 나눔·병합)는 `cellStructureEditable`인 셀, 즉 병합·rowSpan·
columnSpan·반복 머리글이 아니고 모든 문단이 단일 text run인 body cell에서만 열리며 이런 셀의 문단은
cell별 range scope를 공유한다. 그 밖의 셀은 문단별 range scope를 받아 문단을 넘는 선택을 막는다. core paragraph locator는
`hp:tc > hp:subList > hp:p` ancestry와 header·cellSpan을 다시 검증한 뒤 같은 subList의 direct
paragraph만 범위 치환·분할·병합 대상으로 사용한다. 다른 cell이나 머리말·꼬리말 subList를
가로지르는 요청은 renderer scope와 core source 검사 양쪽에서 차단한다.

문단 구조 command(Enter 분할·경계 병합·여러 문단 범위)를 받을 수 있는 문단의 규칙은
`src/core/editing/paragraph_structure.ts` 하나에 있다. 문단 자식은 `hp:run`·`hp:linesegarray`, 각 run은 직속 `hp:t`
하나와 그 안의 `hp:lineBreak`·`hp:tab`뿐이어야 한다. 편집 코어(`paragraph_patch.ts`)는 source tree에, viewer decoder는
ordered XML에 같은 함수를 적용하고, decoder는 위반 사유를 `ViewerParagraph.structureBlock`(`PARAGRAPH_HAS_OBJECT`·
`PARAGRAPH_COMPLEX_RUN`)으로 남긴다. capability는 이 값으로 문단 구조를 막고, 막힌 문단 쪽 경계 병합과 그 문단을
가로지르는 여러 문단 범위도 막는다(막힌 문단은 문단 하나 scope, 그 뒤 문단은 새 구간 scope). renderer는
`topLevelParagraphStructure`·`cellParagraphStructure`로 같은 gate와 scope를 받아 Enter·Backspace·Delete를 코어에 보내지
않고 상태 막대에 이유를 알린다. 글자 입력·삭제와 글자·문단 모양은 그대로 허용한다.

표 셀 모양 command는 선택 anchor에서 `hp:tc` ancestry를 다시 찾고 header·cellSpan을 검증한다.
선택 셀이 참조하는 `hh:borderFill`을 새 ID로 복제한 뒤 단색 `hc:winBrush`와 사방 border 속성만
수정하고, 해당 `hp:tc`의 `borderFillIDRef`만 교체한다. 공유 원본 style과 다른 셀은 그대로
유지한다. header collection 삽입과 section reference 교체는 하나의 transaction이며 inverse가
두 entry의 원래 tag·fragment를 보관한다. 동일한 결과 style이 이미 있으면 새 정의를 만들지 않고
재사용한다. 불완전한 fill/border, 머리글·병합 셀은 renderer capability와 core 검사에서 차단한다.

첫 표 구조 command는 현재 body 행 아래에 빈 행을 추가한다. core는 표의 `rowCnt`·`colCnt`, direct
row/cell 수, 모든 `cellAddr`, `cellSpan=1`, 단순 text-only 셀을 서로 대조해 직사각형 표만 허용한다.
선택 행의 cell 크기·margin·borderFill과 문단·글자 모양을 복제하되 `hp:t` 내용과 stale
`linesegarray`는 제거한다. 새 행 이후의 `rowAddr`, table `rowCnt`와 `hp:sz` 전체 높이는 같은
table fragment transaction에서 갱신한다. decoder는 table 높이를 host 문단 layout의 하한으로
사용해 stale line segment가 새 행을 가리지 않게 한다. 고유 ID를 가진 row/cell, 중첩 표·이미지·제어 문자가 있는 표는 복제하지
않는다. inverse는 원래 table XML 전체를 보관해 section의 다른 콘텐츠는 건드리지 않고 되돌린다.

행 삭제도 같은 topology 검사와 table fragment command를 사용한다. 삭제할 row의 높이를
`hp:sz`에서 빼고 뒤쪽 주소를 당긴다. 삭제된 anchor로는 inverse가 표를 다시 찾을 수 없으므로,
다음 body 행 첫 text(마지막 행이면 이전 body 행)의 변경 후 ordinal을 미리 계산해 selection과 inverse
locator로 함께 전달한다. undo는 원래 table과 selection을 복구하고 redo는 다시 살아남은 anchor를
사용한다. 반복 머리글과 마지막 하나뿐인 body 행은 삭제하지 않는다.

## 프로세스 책임

### Electron main

- `webContents.id`별 창 목록과 `OpenPathRouter`: macOS `open-file`, Windows·Linux 명령줄·
  `second-instance` 경로를 작업 폴더 기준 절대 경로로 바꿔 포커스된 창(없으면 최근 창, 창이 없으면 새 창)에 전달
- 요청한 창에 연결한 열기·열기 방식 대화상자와 창별 `DocumentPathRegistry` 허용목록
- Windows·Linux는 기본 메뉴를 제거하고 단축키를 renderer가 처리(개발 빌드만 F12·Ctrl+Shift+I DevTools)
- 자체 HWPX UTI와 기존 한컴 HWPX UTI의 Finder 문서 연결
- HWPX 확장자와 패키지 필수 entry 검증
- HWP 200 MiB·CFB magic preflight와 byte 전달
- HWPX package index와 decoder worker 생성·취소·오류 전달(section 디코딩은 main thread에서 하지 않음)
- 창별 편집 session 목록·dirty 상태 거울·원본 경로, 저장 대화상자와 목적지 결정(`saveAsDestinationDecision`·원본 보호),
  닫기·문서 교체 dirty 확인. 편집 엔진(package·history·projection·Save As 검증)은 main thread에서 실행하지 않음
- renderer 준비 완료 후 `webContents.printToPDF` 실행과 파일 저장

### 원본 개체 자리 표시

viewer decoder(`src/core/parser/viewer_decoder.ts`)는 run 자식 가운데 글자(`hp:t`·탭·줄바꿈), 표, 그림만
그대로 모델로 옮긴다. 그 밖의 개체는 버리지 않고 `object-placeholder` content로 같은 문단 흐름 위치에 남긴다.
원본 좌표·회전·쪽 배치(글 앞·뒤, 쪽 기준 위치)와 개체 자체의 그림(수식 조판, 차트·OLE·도형 그리기)은 재현하지 않으며,
상자 크기는 선언 크기를 참고하되 쪽보다 크면 줄인다(아래). 각주·미주 본문은 쪽 아래가 아니라 구역 끝 목록에 둔다.

| 원본 element | kind | 화면 |
| --- | --- | --- |
| `hp:equation` | `equation` | "수식" 상자 + `hp:script` 원문(고정폭) |
| `hp:chart`(`hp:switch` 안 차트, OLE 대체본 크기 사용) | `chart` | "차트" 상자 |
| `hp:ole` | `ole` | "OLE 개체" 상자 + `hp:shapeComment` |
| `hp:rect`·`hp:ellipse`·`hp:arc`·`hp:polygon`·`hp:curve`·`hp:container`(안에 `hp:drawText`) | `text-box` | "글상자" 상자 + 되살린 읽기 전용 문단 |
| 같은 도형(글 없음)·`hp:line`·`hp:connectLine`·`hp:textart` | `shape` | "도형"/"글맵시" 상자 |
| `hp:btn`·`hp:radioBtn`·`hp:checkBtn`·`hp:comboBox`·`hp:edit`·`hp:listBox`·`hp:scrollBar` | `form-control` | "양식 컨트롤" 상자 + caption·값 |
| `hp:video` | `video` | "동영상" 상자 |
| `hp:ctrl/hp:footNote`·`hp:endNote` | `footnote`·`endnote` | 본문 위 첨자 번호, 본문은 구역 끝 `note-list` |
| `hp:ctrl/hp:fieldBegin type="MEMO"` | `memo` | 줄 안 "메모: …" 표시 |
| `hp:dutmal` | `ruby` | HTML ruby(본말 + 덧말) |
| 그 밖의 run 자식 `hp:*`(`hp:compose` 포함) | `unknown` | "알 수 없는 개체" 상자 |

- 크기는 `hp:curSz`(가로·세로가 모두 0보다 크면) → `hp:sz` → `hp:orgSz` 순서의 HWPUNIT이다. 흐름은
  `hp:pos treatAsChar="1"`이면 `inline`, `textWrap`이 `IN_FRONT_OF_TEXT`·`BEHIND_TEXT`이면 자리를 차지하지 않는
  `floating`, 그 밖은 `block`이다. 문단 `layoutHeight`는 줄 배치 캐시·표 높이와 함께 inline 최대 높이 + block 높이 합을
  반영하므로 무측정 첫 pagination도 자리를 잡고, 두 번째 pass는 DOM 실측을 쓴다.
- 선언 높이가 쪽 본문 높이의 85%(`OBJECT_PAGE_HEIGHT_RATIO`)를 넘으면 decoder가 너비·높이를 같은 비율로 줄이고 원래
  크기와 배율을 `fitted`에 남긴다. renderer는 이름표에 "(축소)"와 `data-object-fitted`를 붙이고, 되살린 글상자 글이 같은
  한도를 넘으면 layout effect에서 본문에 CSS `zoom`(`data-fit-scale`)을 걸어 글을 줄인다. `zoom`은 layout 크기도 줄이므로
  측정·pagination·PDF가 같은 높이를 보고 글자는 PDF에서도 추출된다. 한 문단이 쪽을 넘어 잘리거나 PDF에서 글이 빠지지 않게 하는
  표시상 조정이며 원본 크기는 저장할 때 그대로다.
- 구역 끝 각주·미주 목록은 각주·미주 문단마다 `note-list` block 하나(`s<N>:notes`, `s<N>:notes:<순번>`)로 만들어
  pagination이 각주 사이에서 쪽을 나눌 수 있다. 이어지는 block은 `continuesKind`(같은 종류 제목·구분선 생략)와
  `continuesNote`(같은 각주의 다음 문단, 번호 생략)를 가진다.
- `sourcePath`는 `${sectionPath}#${element}:${section 안 같은 이름 element의 문서 순서 번호}`다.
- 글상자·각주·메모 본문 문단은 `sectionPath` 없이 해석하므로 source anchor가 없다(읽기 전용). 자리 표시는
  `isObjectPlaceholder`로 편집 capability(`editing_capability.ts`)와 renderer `isEditableTextParagraph`에서 건너뛰므로
  같은 문단 글자 run의 편집 가능 여부는 자리 표시를 넣기 전과 같다(편집 coverage 수치 불변).
- 누름틀·하이퍼링크 등 본문 run에 글이 그대로 있는 필드는 자리 표시를 만들지 않는다.
- 구역마다 종류별 개수를 `HWPX_OBJECT_PLACEHOLDER_<KIND>` 진단으로 남기고, corpus 요약은 `placeholders`(종류별 개수)를
  manifest 기대값과 정확히 비교한다. renderer는 `countObjectPlaceholders`로 안내 배너("이 문서에는 화면에 완전히 표시되지
  않는 개체가 N개 있습니다 (…)")·상태 막대를 만들고, PDF 내보내기 요청에 개수를 실어 보내면 main이 저장 위치를 묻기 전에
  `dialog.showMessageBox`(창에 연결)로 [그래도 내보내기]/[취소]를 묻는다. E2E 경로(`HAN_FLOW_PDF_EXPORT_PATH`)는 묻지 않는다.

### Decoder worker

모든 HWPX section 디코딩은 heap 한도(`maxOldGenerationSizeMb` 1024)와 wall-clock timeout(120초)을
건 worker thread에서 실행한다. 두 한도는 worker 요청마다 따로 적용한다. section이 20개 이상이거나
section 하나의 압축 전 크기가 2MiB 이상이면 첫 section 모델을 먼저 보내고 전체 모델은 별도 worker
요청으로 완성하며, 그 밖의 문서는 한 번의 worker 요청으로 전체를 디코딩한다. load ID가
바뀌면 이전 worker를 종료하며 늦게 도착한 결과는 renderer가 무시한다. worker 오류가 발생해도
이미 표시한 첫 section은 유지하고 상태 표시줄에 나머지 페이지 오류를 노출한다.

### 편집 worker

HWPX 편집 엔진은 편집 session(=창)마다 worker thread 하나(`src/main/editing_worker.ts`)에서 실행한다.
worker가 `HwpxSourcePackage`(모든 entry 압축 해제), source tree cache(`package_trees.ts`), `HwpxEditHistory`,
transaction 적용, 증분 projection(`viewer_projection.ts`의 `ViewerProjectionCache`), Save As(임시 파일 쓰기·fsync·
재개봉 비교·viewer 디코딩·link/rename 게시)를 모두 소유한다(`src/main/editing_engine.ts`). main의
`EditingSessionManager`는 IPC 계약을 그대로 두고 요청을 structured clone 메시지(`editing_worker_protocol.ts`)로
넘기며, 응답에 실린 revision·savepoint·undo/redo·dirty 상태를 창별로 거울처럼 들고 있어 닫기 확인·원본 보호 목록을
동기적으로 답한다. package·history는 worker 밖으로 나오지 않고, renderer가 쓰는 projection과 상태만 돌아온다.
projection은 session 시작·refresh·fallback이면 전체 `ViewerDocument`(`projectionId`와 함께), 그 밖의 command·실행 취소·
다시 실행이면 바로 앞 projection에 대한 patch(`ViewerDocumentPatch`: `baseProjectionId`·`projectionId`·바뀐 section
`{ index, section }`·header.xml이 바뀌었을 때만 style map·문서 진단)다. 저장 목적지 결정(`saveAsDestinationDecision`, 원본·다른 session 원본 보호, 심볼릭 링크 거부)과
대화상자는 main에 남고, 결정된 목적지·교체 확인 여부·보호 경로·임시 파일 UUID만 worker에 넘긴다.

- 격리 방식: Node `worker_threads`. 별도 V8 heap에 `resourceLimits`(`maxOldGenerationSizeMb` 1536,
  `maxYoungGenerationSizeMb` 64, `EDITING_ENGINE_RESOURCE_LIMITS`)를 걸 수 있고, 초과하면 app abort 대신
  `ERR_WORKER_OUT_OF_MEMORY`로 끝나 구분할 수 있다. `terminate()`는 동기 무한 loop도 멈추며, fs 접근과 build·Jest
  실행 방식이 decoder worker와 같다. Electron `utilityProcess`는 process 단위 격리를 주지만 Electron 밖(Jest)에서
  실제 경로를 실행할 수 없고 process 기동 비용이 크며, 필요한 heap 한도·강제 종료·fs 접근을 `worker_threads`가 모두
  충족해 쓰지 않았다.
  같은 process 안 thread이므로 native crash(V8·zlib 결함)는 app 전체에 미치고, ZIP entry `Buffer`는 V8 heap 밖
  메모리라 `resourceLimits`에 잡히지 않는다. 그 크기는 `HwpxSourcePackage`의 entry 개수·개별·전체 압축 해제 한도로 묶는다.
- 요청별 wall-clock 한도(`EDITING_ENGINE_TIMEOUTS_MS`): 편집 시작 120초, command(text·style·문단·표·refresh·
  loss policy) 60초, 실행 취소·다시 실행 60초, 저장 180초. 넘으면 worker를 terminate하고
  `EDITING_ENGINE_TIMEOUT`, worker 비정상 종료는 `EDITING_ENGINE_CRASHED`, heap 한도 초과는
  `EDITING_RESOURCE_EXHAUSTED`로 끝낸다(recovery `restart-session`, 한국어 안내). 그 session은 즉시 지워져 dirty 확인·원본
  보호 목록에서도 빠지고, renderer는 편집 모드를 닫되 마지막 문서 화면은 그대로 두고 보기 모드로 돌아간다.
- 저장 중 강제 종료: 목적지는 검증을 마친 임시 파일을 hard link(새 파일)·rename(교체 확인)으로만 게시하므로 반쯤 쓴 목적지는
  생기지 않는다. worker의 `finally`가 돌지 못해 남은 임시 파일은 main이 worker 종료를 기다린 뒤 미리 정한 UUID 경로
  (`saveTemporaryPath`)로 지운다.
- 순서: main은 창별 queue(`enqueue`)로 한 창의 요청을 하나씩 보내고 worker도 도착 순서대로 처리한다. 다른 창의 session은
  각자 worker에서 병렬로 돈다. 편집을 끝내거나 창을 닫거나 다른 문서로 교체하면 worker를 종료하고 대기 요청은
  `EDITING_SESSION_EXPIRED`로 끝낸다. timeout·crash·OOM으로 끝난 session의 저장하지 않은 편집은 아래 복구 기록에서 되살린다.
- 증분 projection(`src/core/parser/viewer_projection.ts`): worker는 마지막으로 보낸 projection의 package·section별 해석
  결과·header style map·그림 resource를 들고 있고, 새 package와 entry bytes를 비교해(`changedEntryPathsSince`, command
  종류를 믿지 않으므로 실행 취소·다시 실행도 같은 규칙) 바뀐 entry만 다시 해석한다. section 해석(`decodeViewerSection`)은
  그 section XML, header의 `styleCharacterIds`·문단 style `heading`, 쪽 크기에서 온 자리 표시 높이 한도에만 달려 있다.
  각주·미주 번호, 목록 번호(`applyParagraphMarkers`), 개체 순번, `hp:t`·문단(빈 문단 anchor) 순번은 모두 section 안에서
  세고, 쪽 번호 이어 세기(`startNum`)·머리말·꼬리말 상속은 renderer가 쪽 목록에서 매번 다시 정한다(`page_decorations.ts`).
  - section XML이 바뀌면 그 section만 다시 해석한다.
  - header.xml이 바뀌면 style map을 다시 읽어 patch에 담고, `heading`(목록 번호·글머리표) 또는 `charPrIDRef`(빈 문단
    caret 글자 모양)가 바뀐 문단 style id를 `paraPrIDRef`·`styleIDRef`로 참조하는 section도 다시 해석한다. 글자·문단·셀
    모양 command는 새 id만 더하므로 보통 편집한 section만 해당한다.
  - 전체 다시 해석(전체 문서 응답): entry 목록(경로·순서)이 바뀌었을 때, section·header 밖 entry(그림·manifest 등)가
    바뀌었을 때, 문서 쪽 크기(첫 `hp:pagePr`)나 자리 표시 높이 한도가 바뀌었을 때. refresh(충돌 복구)도 처음부터 해석한다.
  - 동치 검사(`tests/parser/viewer_projection.test.ts`): 공개 corpus 38종에 golden 회귀와 같은 command 표본을
    적용·되돌리기·다시 적용·되돌리기한 4,049단계에서 patch를 앞 문서에 적용한 결과가 같은 package의
    `decodeViewerDocument`와 `toStrictEqual`로 같다(80 section large-progressive는 10단계마다와 마지막, 나머지는 매 단계 비교:
    3,893회). patch에 없는 section·style map·쪽·resource는 앞 문서 object를 그대로 쓴다. header 목록 번호 정의 변경과
    쪽 크기·그림 entry fallback은 따로 검사한다.
- renderer 적용: renderer는 마지막 `projectionId`와 문서를 ref로 들고, patch의 `baseProjectionId`가 같으면
  `applyViewerDocumentPatch`로 바뀐 section만 새 object로 바꾼다. 다르면(응답을 놓친 경우) patch를 버리고 refresh로 전체
  문서를 받아 다시 맞춘다. revision·selection 처리(`reconcileEditingSelection`)는 전과 같다.
- main thread에 남은 일: IPC 요청 검증과 경로 허용목록, worker 응답의 structured clone 역직렬화와 renderer IPC 직렬화(편집
  결과는 patch라 작다), 저장 목적지 `lstat`/`stat`, 대화상자. large-progressive(80 section, 5 MiB 그림)의 keystroke 하나
  commit은 전체 projection 경로(매번 전체 해석 + 전체 문서 clone, 결과 12.8 MB) p50 679ms에서 worker 증분 경로 p50 7.3ms
  (main 점유 0.75ms, 결과 75 KB)가 됐다(`HAN_FLOW_BENCHMARK=1 npx jest --runInBand
  tests/performance/editing_worker_benchmark.test.ts`, Linux x64 Jest 기준). 실행 취소·다시 실행은 p50 16ms다.

### 편집 복구 기록

저장하지 않은 편집은 worker 메모리에만 있으므로 앱 강제 종료·OS 종료·worker 중단(timeout·crash·OOM)에 대비해 session마다
복구 기록을 쓴다(`src/main/recovery_journal.ts`).

- 위치·권한: `app.getPath('userData')/recovery/<sessionId>/journal.hfj`. 폴더 0o700, 파일 0o600. session id는 소문자 UUID만
  받고 경로가 복구 폴더 바로 아래인지 확인한다(`recoveryJournalDirectory`). 폴더·파일이 링크이거나 일반 파일이 아니면 열지 않는다.
- 형식(version 1): 한 줄에 record 하나, `<JSON byte 길이>:<CRC-32 8자리 hex>:<JSON>\n`(CRC는 ZIP과 같은 `crc32` helper).
  첫 record는 header(형식·version, 앱 version, 원본 절대 경로, 원본 크기·수정 시각·SHA-256, session 시작 시각)다. 원본 지문은
  worker가 package를 읽으며 같은 파일에서 계산하고, 읽는 동안 크기·수정 시각이 바뀌면 편집을 시작하지 않는다. 그 뒤
  record는 history 순서대로 `commit`(history가 받아들인 forward `EditTransaction` 그대로: command·selection·inputType·
  compositionId·timestamp), `undo`, `redo`, `saved`(Save As 성공 지점)이며 모두 적용 뒤 package revision과 시각을 담는다.
  문서 bytes는 쓰지 않는다(command 안의 입력 글자·XML 조각만).
- 쓰는 곳: main. worker의 `EditingEngine`이 commit·undo·redo·markSaved를 할 때 record를 쌓고 같은 응답 message에 실어 보내면
  (`EditingWorkerResponse.journal`, 실패 응답 포함) `EditingSessionManager`가 `RecoveryJournalWriter`에 넘긴다. main에 두는
  이유는 worker가 timeout·OOM으로 강제 종료돼도 이미 응답한 편집은 main에 있어 하나도 잃지 않기 때문이다(worker 안에서 쓰면 마지막
  flush 뒤 편집을 worker와 함께 잃는다). 중단을 일으킨 요청은 응답이 없어 기록되지 않으므로 replay가 같은 중단을 되풀이하지 않는다.
- 내리는 정책: session이 dirty일 때만 파일이 있다. 처음 dirty가 되면 header와 지금까지의 모든 record로 파일을 만들고, 그 뒤로는
  덧붙인다. 저장 직후·원래 상태로 되돌려 dirty가 아니면 파일을 지우고 record는 메모리에 둔다(다시 dirty가 되면 처음부터 다시 쓴다).
  디스크 쓰기는 `write` + `fdatasync`(새 파일이면 폴더 fsync)이고, 쉬고 있다가 들어온 첫 편집은 바로, 빠르게 입력하는 동안은
  마지막 flush 뒤 500ms(`RECOVERY_FLUSH_INTERVAL_MS`)가 찰 때 모아서 내린다. 창 blur, Save As 전, 닫기 확인 전에는 바로 내린다.
  최악의 손실 구간은 앱 process 강제 종료·OS 종료 때 약 0.5초 + fdatasync 시간의 입력이다. worker 중단은 손실이 없다.
  쓰기는 비동기 fs라 main event loop를 막지 않는다.
- 지우는 때: 정상 종료(`stop`: 편집 끝내기·창 닫기·다른 문서 열기는 모두 저장 또는 [저장하지 않음]을 거친다), Save As 뒤 dirty가
  아니게 됐을 때(위 규칙), 복구 대화상자의 [버리기]. worker 중단·앱 강제 종료에서는 남긴다(`retain`).
- 저장 지점: Save As 뒤에도 session은 원본 package 위에서 계속 편집하므로 새 기준 파일로 기록을 다시 시작하지 않고 `saved`
  record를 남긴다. replay가 같은 지점에서 `markSaved`를 불러 savepoint·dirty·저장 이전으로의 실행 취소까지 그대로 되살린다.
- 읽기: 마지막 줄이 길이·CRC·줄바꿈 중 하나라도 맞지 않으면 쓰다 끊긴 꼬리로 보고 버린다. 깨진 record 뒤에 줄이 더 있으면
  손상이다. header 손상·중간 손상·구조 오류·크기(64 MiB)·record 수(100,000)·record 하나(16 MiB) 한도 초과는 실행하지 않고
  `quarantine-<id>-<시각>` 폴더로 옮긴다. 다른 형식 version은 손대지 않는다(그 version 앱이 열 수 있다). 쓰는 쪽도 한도에
  닿으면 기록을 멈추고 최신 상태를 담지 못하는 파일을 지운다.
- 복구(`EditingSessionManager.recover`): 새 worker로 원본을 열어 그 지문이 header와 같을 때만(다르면 `RecoverySourceChangedError`,
  기록 보관) `replay` 요청을 보낸다. worker는 live 편집과 같은 `commitSynchronized`·`undo`·`redo`·`markSaved` 경로로 record를
  차례로 적용하고 단계마다 기록된 revision과 비교한다. history grouping은 transaction timestamp로 정해지므로 같은 묶음이
  다시 만들어진다. replay는 worker의 heap 한도와 `replay` timeout(300초) 안에서 돌고, 실패·timeout·crash한 기록은 격리한다.
  성공하면 새 session 기록을 디스크에 내린 뒤 옛 기록을 지운다.
- 묻는 때(`index.ts`): 앱 시작(첫 창 load 뒤 남은 기록 목록, 시작하며 여는 문서의 기록은 제외), HWPX 문서를 열었을 때 같은 원본
  경로의 기록(가장 최근 하나), 편집 엔진이 중단된 직후(renderer가 "편집 세션 종료"로 보기 모드로 돌아간 뒤). 창을 부모로 한 대화상자가
  "저장하지 않은 편집 내용이 있습니다. 복구하시겠습니까?"와 마지막 변경 시각·편집 수를 보여 주고 [복구][버리기][나중에]를 받는다.
  원본이 바뀌었거나 없으면 복구할 수 없다고 알리고 [나중에][버리기]만 준다. [복구]는 main이 `recovery:start`로 원본 경로와 기록
  ID를 보내고, renderer가 원본을 열고(배경 로딩까지 끝난 뒤) `editing:recover`를 부른다. main은 자기가 보낸 기록만 받는다.
  결과는 편집 모드·dirty 상태이고 사용자가 확인한 뒤 다른 이름으로 저장한다. replay 실패는 격리 위치를 알리고 [보관][버리기]를 준다.
  E2E는 `HAN_FLOW_E2E_RECOVERY_ACTION`(recover·discard·later)으로 답한다.
- 한계: 창마다 session·기록이 따로라 여러 창이 같은 원본을 편집하다 함께 중단되면 기록이 여러 개 남고, 문서를 열 때는 가장
  최근 기록 하나만 묻는다(나머지는 앱 시작 때 묻는다). 복구는 같은 원본 bytes에만 하므로 원본을 다른 프로그램이 고친 뒤에는 복구할
  수 없다. 다른 앱 version이 만든 같은 형식 version 기록은 replay의 revision 검사로만 일치를 확인한다.

### 편집 화면 갱신(renderer)

- 편집 patch가 section만 바꾸면 style map·쪽·resource object가 그대로라 측정·조판 입력(`renderStyles`)도 그대로다.
  측정 DOM은 section마다 memo한 `MeasurementSection`이라 바뀐 section만 다시 그린다. 글꼴 목록이 바뀔 때만 글꼴을 다시 찾는다.
- 측정값(`DocumentLayoutMeasurements`)은 section마다 그 측정에 쓴 section object와 함께 둔다. 같은 style이고 글꼴이 모두
  준비돼 있으면 layout effect에서 바뀐 section만 그리기 전에 바로 재고(`measureDocumentLayout`), 글꼴을 내려받는 중이면
  `fonts.ready` 다음 frame에 다시 잰다. 전체 문서로 바뀌면(열기·편집 시작·refresh) 전처럼 측정값을 비우고 모두 다시 잰다.
- pagination은 section마다 새 쪽에서 시작하고 다단·원본 줄 위치 상태도 section마다 처음부터 세므로
  (`paginateViewerSection`) 문서 쪽 목록은 section별 결과를 이어 붙인 것과 같다. `paginateViewerSectionsIncremental`은
  section·위치·쪽 높이·측정 object가 그대로인 section의 쪽 object를 다시 쓴다(`tests/layout/section_pagination.test.ts`가
  이전 문서 단위 구현과 38종 fixture에서 비교). 쪽 번호·머리말·꼬리말 decoration은 쪽 목록에서 매번 다시 정하고, 가상화
  범위 계산도 전과 같다.
- 편집 capability·문단 구조·자리 표시 개수는 section object별 `WeakMap` cache로 바뀐 section만 다시 센다.
- 그림 data URL은 resource object마다 한 번만 만든다. 전에는 render마다 5 MiB base64를 이어 붙여 React가 이전 `src`와
  글자 단위로 비교했고, 그림이 든 꼬리말이 있는 쪽마다 수십 ms가 들었다.
- 패키지 앱 측정(`xvfb-run -a npm run benchmark:edit-latency`, large-progressive 15,004쪽, Linux x64 xvfb):
  한 글자 입력 event부터 편집 결과가 DOM에 반영될 때까지 p50 989ms → 31ms(p95 2,084ms → 44ms), 다음 frame까지
  p50 1,224ms → 41ms. 요청 왕복(편집 요청 시작부터 결과 도착) p50 594ms → 12ms, 결과 도착부터 DOM 반영 p50 310ms → 18ms.

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
- SVG image가 표시된 뒤 React text layer를 붙여 검색(macOS `⌘F`, 그 밖 `Ctrl+F`)·선택·접근성 제공
- `pageNum`을 본문 흐름과 분리된 쪽 번호 decoration으로 표시
- 구역별 `header/footer`를 페이지 위·아래 decoration으로 표시하고 `BOTH/EVEN/ODD` 선택
- 폰트 대체, 페이지 overflow, 로딩 시간 진단
- 시스템 함초롬체의 한글·영문 family 별칭 해석(글꼴 파일은 번들하지 않음)
- 50페이지 이하는 전체 DOM 렌더
- 50페이지 초과는 viewport 주변 page만 mount
- 트랙패드 pinch와 modifier(`⌘` 또는 `Ctrl`)+`+`/`-`/`0`을 50–200% zoom 상태로 통합
- 단축키 modifier는 preload가 노출한 `process.platform`으로 정한다. macOS는 `metaKey`, 그 밖은
  `ctrlKey`(Alt·Win 조합 제외)를 쓰고 Windows·Linux에는 `Ctrl+Y` redo를 더한다.
- `contentEditable`의 `historyUndo`·`historyRedo` 기본 동작은 막고 main history로 보낸다.
- package bytes와 history는 소유하지 않는다. HWPX 편집 surface는 `plaintext-only` 입력을 main
  편집 session의 transaction으로만 보내고, HWP fixed page는 편집하지 않는다.
- 글꼴 대체는 platform별 체인(Windows 맑은 고딕·바탕, macOS Apple 글꼴, Linux Noto)과 한/영 alias를 쓴다.

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
  ├─ small document → worker(full document) → render
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
없는 일반 패키지 실행은 항상 OS 저장 대화상자를 사용한다. overflow는 세로뿐 아니라
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
HWPX core와 production matrix, 고정 HWP matrix의 실행 대상은 상위 `fixture_catalog.json`에서
동일한 fixture ID로 선택한다. 각 형식 manifest가 catalog와 어긋나면 GUI 실행 전에 실패한다.
Windows는 `release/win-unpacked/Han-Flow.exe`, Linux는 `release/linux-unpacked/han-flow`, macOS는 `.app` 내부 실행 파일을
기본 production 경로로 쓴다. root 실행이나 `HAN_FLOW_NO_SANDBOX=1`이면 패키지 앱에 `--no-sandbox`를 붙인다.

`verify:pdf`는 production 앱의 고정 PDF 출력과 visual state를 같은 격리 실행에서 수집한다.
Poppler `pdfinfo`, `pdftotext`, `pdftoppm`으로 페이지 수, 각 page MediaBox에 대응하는 용지
크기, 페이지별 비공백 글자 수와 대표 PNG 재렌더를 검사한다. HWPX는 화면과 PDF의 페이지별
글자 수가 같아야 한다. HWP는 화면의 별도 text layer와 인쇄 SVG의 추출 경로가 다르므로 전체
98%, 각 page 96% 이상을 요구한다. 첫·중간·끝 page와 모든 가로 page를 PNG로 다시 만든다.

HWP 페이지 SVG는 `<img>`로 그리므로 Chromium PDF는 그 안의 글자를 원문 cluster(ActualText) 없이
기록하고, PDF ToUnicode를 글꼴 cmap에서만 만든다. Noto Sans/Serif CJK(함초롬바탕·돋움 대체 글꼴,
Linux CI의 `fonts-noto-cjk`)는 PDF에 Type 3 글꼴로 들어가며, `locl` GSUB가 고른 언어별 대체 glyph는
cmap에 없어 ToUnicode가 U+0000이 된다. 언어 선언이 없거나 영어 UI locale이면 ASCII 숫자가,
한국어이면 괄호·마침표·빗금이 화면과 PDF에 보이면서도 PDF 검색·복사·추출에서 빠진다.
`safeSvg`는 SVG root에 `font-feature-settings: "locl" 0`과 기본 `xml:lang="ko"`를 넣어 cmap 기본
glyph만 쓰게 한다. rhwp가 글자마다 `textLength`로 폭을 고정하므로 배치는 바뀌지 않는다. 공개 HWP
fixture는 이 경로의 숫자·문장 부호 줄을 담고 `verify:hwp-matrix`가 manifest의
`requiredPdfText`가 PDF 텍스트에 있는지 확인한다. rhwp가 가운뎃점(U+00B7)을 `<circle>`로 그리는
경우처럼 SVG에 글자로 남지 않는 문자는 여전히 추출되지 않으며 보존율 허용 범위에 포함된다.

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
  → shared desktop viewer shell and PDF export
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
`document:import`와 `editing:start`는 main이 그 창에 건넨 경로(열기 대화상자, OS 파일 열기,
명령줄)와 preload가 `document:registerDroppedPath`로 등록한 끌어 놓은 파일만 받는다. 심볼릭 링크를
푼 실제 경로가 창별 허용목록에 없거나 일반 문서 파일이 아니면 `DOCUMENT_PATH_NOT_ALLOWED`로 거부한다.

현재 `@rhwp/core`의 페이지 표현이 우세해 read-only fixed-page variant를 추가했고 zoom,
virtualization과 진단 shell을 공유한다. 정제된 blob image 위에 renderer가 검증한 좌표형 text
run을 React로 렌더링한다. 따라서 SVG markup을 DOM에 주입하지 않으면서 검색·선택·접근성을
제공한다. 첫 page image의 `load`를 첫 화면 기준으로 삼고 text layer와 나머지 page는 그 뒤
불러온다. 과거 macOS arm64(Electron 28) 측정에서 Worker 격리 후 cold 20회 첫 화면 p95는
614ms였으며 현재 commit에서는 재측정하지 못했다. CSS named page 기반
mixed-orientation PDF도 page별 크기와
텍스트 보존, 대표 PNG 관문을 통과했다. 같은 과거 macOS 측정에서 실사용 기준 HWP aggregate
working set peak p95는 647.6MiB, HWPX 기준선은 438.3MiB였다. 격리 전 HWP p95보다
58.0MiB 증가한 비용은 다음 최적화 판단에 사용한다. 자세한 결정 기준과 출처는
[V2 HWP 5.0 조사와 도입 전략](hwp_v2_strategy.md)에 기록한다.

renderer에 bundle되는 `@rhwp/core`는 build-time dependency다. production `node_modules`에
같은 WASM을 다시 넣지 않고 Vite가 만든 단일 asset만 패키징한다. MIT license 원문은
`Contents/Resources/licenses/rhwp-MIT.txt`에, 배포 고지는 같은 디렉터리의
`THIRD_PARTY_NOTICES.md`에 포함한다. Han-Flow 자체 Apache-2.0 원문도
`Han-Flow-Apache-2.0.txt`로 함께 넣는다.

텍스트·표·이미지 편집과 안전한 HWPX 재저장은 V3 범위다. 사용자 배포·서명·공증은 V4
범위다. 기존 편집 prototype 코드는 현재 런타임 계약으로 간주하지 않는다.
