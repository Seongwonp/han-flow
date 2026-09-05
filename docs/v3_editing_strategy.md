# V3 HWPX 편집 조사와 구현 전략

상태: 자동 코드·macOS native IME smoke 완료 — 물리 입력 matrix와 Windows 한/글 외부 승인 대기

기준일: 2026-08-02

## 1. 목표와 범위

V3의 목표는 기존 read-only 뷰어에 임시 `contentEditable`을 붙이는 것이 아니다. HWPX
원본의 미지원 속성을 가능한 한 보존하면서 사용자가 수정한 범위만 안전하게 저장하고,
한국어 IME·selection·undo/redo가 깨지지 않는 편집 경계를 만드는 것이다.

V3의 첫 사용자 시나리오는 다음과 같다.

1. HWPX를 연다.
2. 일반 본문 문단의 텍스트를 수정한다.
3. 원본과 다른 경로에 저장한다.
4. 저장한 문서를 Han-Flow와 한/글에서 다시 연다.
5. 수정한 텍스트는 반영되고 표·이미지·스타일·머리말 등 수정하지 않은 구조는 유지된다.
6. 보존하지 못한 요소가 있다면 저장 전에 `LossReport`로 알린다.

V3에서 `.hwp`는 계속 읽기 전용이다. HWPX 저장이 안전하다는 근거를 먼저 만든 뒤에도
HWP binary 저장은 별도 결정으로 남긴다. 한컴오피스와 픽셀 단위로 같은 편집 화면을 만드는
것도 목표가 아니다.

## 2. 조사 결론

### 2.1 HWPX는 section XML 몇 개가 아니라 문서 package다

KS X 6101은 OWPML을 XML 기반의 개방된 HWP 콘텐츠 형식으로 정의하며, 다양한 reading
system과 생성 도구에서 의도대로 표현되고 다시 수정되는 것을 목표로 한다. 한국표준정보망의
이력상 최신 개정은 2024-10-30이다.

표준 상세 본문은 저장소에 포함하지 않았고 이번 조사에서 구매·열람하지 않았다. 따라서
Han-Flow가 KS X 6101 전체에 적합하다고 주장하지 않는다. 공개된 적용 범위, 한컴의 구조 설명,
Apache-2.0 OWPML reference model과 실제 fixture의 package 구조를 구현 근거로 사용하고,
지원 범위는 round-trip matrix로 한정한다.

한컴의 HWPX 구조 설명에 따르면 package에는 다음 요소가 함께 존재한다.

- `mimetype`: HWPX 형식 signature
- `version.xml`: 형식과 저장 환경 version
- `Contents/content.hpf`: metadata, manifest와 section 순서를 가진 spine
- `Contents/header.xml`: 글자·문단 모양, 호환성 설정과 변경 추적 정보
- `Contents/sectionN.xml`: 구역별 본문
- `BinData/`: 이미지와 OLE 등 binary resource
- `META-INF/`: container와 암호화 관련 정보
- `Preview/`: 미리보기 text와 image
- 선택적인 Scripts, 변경 추적, 문서 이력 등

따라서 normalized model에서 header와 section만 다시 생성하는 저장은 일반 HWPX의
round-trip이 아니다. V3는 원본 package의 모든 entry를 source snapshot으로 보유하고
수정 대상 entry만 교체해야 한다.

### 2.2 `ViewerDocument`는 편집 원본이 아니라 projection이다

현재 `ViewerDocument`는 렌더링과 pagination에 필요한 스타일·본문·resource만 가진다.
원본의 namespace, 알 수 없는 attribute·element, metadata, compatibility setting,
변경 추적과 package entry를 모두 소유하지 않는다. 이것은 빠르고 결정적인 뷰어 모델로는
올바른 선택이지만, 이 모델을 직렬화하면 알지 못하는 원본 정보가 사라진다.

V3는 다음 세 층을 분리한다.

```text
SourcePackage
  ├─ 모든 ZIP entry의 원본 bytes와 package metadata
  ├─ 수정 가능한 ordered XML
  └─ 알 수 없는 XML과 binary를 보존
          │
          ▼
EditableDocument
  ├─ 안정적인 source anchor
  ├─ command / transaction / selection
  └─ LossReport
          │
          ▼
ViewerDocument projection
  └─ 기존 pagination / renderer / PDF
```

`ViewerDocument`와 기존 read-only renderer는 재사용한다. 편집 command는
`ViewerDocument`를 직접 mutation하지 않고 source package에 적용되며, commit된 결과에서
필요한 projection만 다시 만든다.

### 2.3 IME 조합은 keydown 목록으로 처리할 수 없다

W3C UI Events는 IME 상태를 keyboard event만으로 판단할 수 없으며,
`compositionstart → compositionupdate* → compositionend` 순서를 정의한다. 조합 중에도
`beforeinput`, `compositionupdate`, DOM update, `input`이 반복될 수 있고
`KeyboardEvent.isComposing`이 true인 key event도 계속 발생한다.

따라서 다음을 V3 입력 계약으로 둔다.

- 조합 중 DOM은 browser input surface가 소유한다.
- 조합 중간값마다 source package, undo history와 전체 pagination을 갱신하지 않는다.
- `compositionend`에서 한 개의 transaction으로 commit한다.
- 조합 취소는 문서 command를 만들지 않는다.
- selection anchor와 활성 paragraph를 조합 중 React key 변경으로 remount하지 않는다.
- native `beforeinput`의 `inputType`, `data`, `isComposing`을 수집한다.
- React의 `onBeforeInput`은 현재 native event가 아니라 polyfill을 사용할 수 있으므로,
  정밀 입력 경계는 DOM ref의 `addEventListener('beforeinput', ...)`로 검증한다.

첫 vertical slice에서는 browser가 IME와 caret를 안정적으로 관리하는 paragraph 단위
plain-text input surface를 사용한다. 전체 문서를 하나의 자유로운 rich-text
`contentEditable` DOM으로 두지 않는다. 여러 run·문단에 걸친 rich selection이 필요해지는
단계에서 ProseMirror 같은 framework 도입을 다시 평가한다.

### 2.4 undo/redo는 전체 문서 snapshot이 아니라 transaction history다

ProseMirror의 공식 guide처럼 DOM event가 transaction을 만들고 transaction이 새 editor
state를 만드는 단방향 cycle을 참고한다. Han-Flow command는 최소한 다음 정보를 가진다.

```ts
interface EditTransaction {
  id: string
  commands: EditCommand[]
  selectionBefore: EditorSelection
  selectionAfter: EditorSelection
  inputType?: string
  compositionId?: string
  timestamp: number
}
```

selection은 한 text node에 종속되지 않는다.

```ts
interface EditorSelection {
  sectionPath: string
  anchorTextNodeId: string
  anchorOffset: number
  focusTextNodeId: string
  focusOffset: number
}
```

anchor와 focus 방향은 사용자의 드래그 방향 복원을 위해 유지하고, command 생성 시에만 ordered
`hp:t` 순서의 start/end로 정규화한다. 서로 다른 section을 가로지르는 선택은 이 단계의 범위가
아니다.

같은 문단에서 여러 run을 선택해 치환할 때는 첫 run의 선택 시작부터 끝까지 새 text로 바꾸고,
중간 run 전체와 마지막 run의 처음부터 선택 끝까지를 빈 text로 바꾼다. 이 command 배열은 한
transaction으로 적용하며 빈 `hp:t`와 각 run의 style 구조는 보존한다. 따라서 undo는 원래 text와
순방향·역방향 selection을 함께 복원하고, 저장은 선택되지 않은 XML 구조를 재작성하지 않는다.
cross-run IME composition은 OS별 실제 입력 검증 전까지 차단한다.

문단 모양 command는 글자 run의 단순성에 의존하지 않는다. source anchor가 최상위 일반 문단에
속하면 `hp:tab`이 포함된 run에서도 정렬·간격·첫 줄 들여쓰기를 적용할 수 있고, section에서는
문단의 `paraPrIDRef`만 교체한다. 새 paraPr는 원본의 `tabPrIDRef`와 `hh:heading`을 그대로
보존해야 하며 이 불변식이 깨지면 transaction을 거부한다. 탭 위치와 목록 definition 자체를
편집하는 command는 별도 호환성 관문 전까지 추가하지 않는다.

첫 command는 source text 범위를 바꾸는 형태다.

```ts
interface ReplaceTextCommand {
  type: 'replace-text'
  sectionPath: string
  textNodeId: string
  from: number
  to: number
  insert: string
}
```

각 command는 적용 결과와 inverse command를 만든다. undo는 inverse transaction,
redo는 원 transaction을 적용한다. 연속 입력 grouping은 시간만으로 추측하지 않고
`inputType`, selection 연속성, composition 경계를 함께 사용한다. 문서 전체를
`JSON.stringify/parse`로 100개 복제하는 과거 방식은 재사용하지 않는다.

### 2.5 저장은 원본 직접 덮어쓰기가 아니라 검증된 교체다

Node는 동시 `writeFile` 호출을 안전하지 않다고 명시하며 `rename` API를 제공한다. Apple의
`replaceItem`은 data loss를 막는 교체와 같은 디렉터리의 고유한 임시 위치 사용을 권고한다.
V3의 저장 순서는 다음과 같다.

1. 첫 단계는 `Save As`만 허용하고 원본 overwrite를 막는다.
2. 목적지와 같은 디렉터리에 고유한 임시 파일을 만든다.
3. package를 완성하고 write/close/flush를 기다린다.
4. 임시 package를 다시 열어 entry, mimetype, XML과 resource reference를 검증한다.
5. Han-Flow decoder로 다시 읽어 예상한 edit와 구조 count를 확인한다.
6. 검증을 통과한 파일만 목적지로 rename 또는 안전 교체한다.
7. 실패하면 목적지는 유지하고 임시 파일을 정리한다.
8. in-place save는 backup과 crash injection 관문을 통과한 뒤 별도로 연다.

## 3. 기존 코드 감사

| 파일 | 현재 판정 | 이유와 조치 |
| --- | --- | --- |
| 과거 renderer Zustand store | 삭제 완료 | 실행 경로에서 import되지 않고 전체 deep copy history, `any`, 시간 기반 ID와 action 내부 update를 사용해 Sprint 0에서 제거했다. |
| 과거 `NormalizedDocument`와 Zustand store | 삭제 완료 | 초기 parser/editor용 모델이며 원본 package와 unknown XML을 소유하지 않아 저장 원본으로 부적합하다. |
| 과거 `parser.ts`·`normalization.ts`·`renderer-engine` | 삭제 완료 | `DocumentImporter`에서 도달하지 않고 조기 normalization으로 원본 구조를 손실하므로 Sprint 0에서 제거했다. |
| 과거 `src/core/parser/serialization.ts` | 제거 완료 | header와 section만 새로 만들며 package entry·이미지·미지원 XML을 보존하지 않았다. 실제 OWPML attribute/구조와 다른 임시 표현도 포함했다. |
| 과거 main `hwpx:save` | 제거 완료 | renderer의 `any` payload를 받아 목적지에 직접 동기 write했다. `mimetype` 값도 `application/ovf+xml`로 잘못 기록했고 schema, sender, 원본 보호와 저장 후 검증이 없었다. |
| `HwpxPackageReader` | 확장해 재사용 | mimetype·필수 entry·section·resource index와 byte read는 검증됐다. 모든 entry snapshot, duplicate/path/size 제한과 compression metadata를 추가한다. |
| `ordered_xml.ts` | 확장 후보 | 자식 순서 보존은 V3에도 필요하다. source span과 serializer round-trip 가능성을 spike로 검증한다. |
| `viewer_decoder.ts`·`ViewerDocument` | 그대로 재사용 | 편집 원본이 아니라 read-only projection으로 유지한다. |
| pagination·renderer·PDF | 그대로 재사용 | commit된 projection을 표시하고 저장 전 visual regression에 사용한다. |

현재 저장 IPC는 UI에서 호출되지 않지만 preload에 노출되어 있다. V3 저장 경계를 만들기 전
삭제하거나 명시적인 experimental guard로 차단한다. 사용자가 실문서를 손실 저장할 수 있는
버튼은 round-trip 관문을 통과하기 전 추가하지 않는다.

## 4. V3 문서 모델

### 4.1 SourcePackage

```ts
interface SourcePackage {
  sourcePath: string
  entries: Map<string, SourceEntry>
  index: SourcePackageIndex
  revision: number
}

interface SourceEntry {
  path: string
  bytes: Uint8Array
  compression: 'stored' | 'deflate'
  crc32: number
  contentType?: string
}
```

필수 invariant:

- entry path는 정규화하고 절대 경로, `..`, NUL과 duplicate를 거부한다.
- entry 개수·개별 크기·전체 압축 해제 크기에 상한을 둔다.
- `mimetype`은 정확히 `application/hwp+zip`이며 저장 방식도 fixture에서 검증한다.
- 수정하지 않은 entry는 uncompressed content SHA-256이 같아야 한다.
- 알 수 없는 entry와 XML node는 기본적으로 보존한다.
- Scripts, OLE, 외부 link, encrypted manifest가 있으면 편집 가능 여부를 별도 policy로
  판정한다. 정책이 없는 위험 문서는 read-only로 열고 편집 진입을 막는다.

ZIP 전체 bytes가 동일할 필요는 없다. 다시 packing하면 entry 순서·timestamp·압축 결과가
달라질 수 있으므로, 동일성 기준은 package manifest, entry set, 각 entry의 원본 content
hash와 semantic decode 결과다.

### 4.2 Source anchor

`ViewerDocument`의 source 위치 기반 결정적 ID를 확장해 다음을 연결한다.

```text
section path
  → paragraph source ID
    → run source ID
      → text node source ID
        → UTF-16 offset range
```

첫 단계는 기존 `hp:t` 하나 안의 text replacement만 지원한다. 여러 run을 합치거나
paragraph를 분할하는 command는 text-only round-trip이 통과한 뒤 추가한다. anchor가
사라졌거나 revision이 다르면 command를 억지 적용하지 않고 conflict를 반환한다.

### 4.3 LossReport

```ts
interface LossReport {
  preservedEntries: string[]
  modifiedEntries: string[]
  regeneratedEntries: string[]
  omittedEntries: Array<{ path: string; reason: string }>
  unsupportedFeatures: Array<{
    code: string
    location?: string
    policy: 'preserved' | 'blocked' | 'removed'
  }>
  previewStatus: 'current' | 'stale' | 'omitted'
}
```

빈 `LossReport`를 “무손실”의 근거로 사용하려면 identity와 single-edit round-trip
matrix를 모두 통과해야 한다. 알 수 없는 node를 보존했다는 사실과 그 기능을 Han-Flow가
이해한다는 주장은 구분한다.

## 5. 입력 surface와 selection

첫 입력 surface의 원칙:

- 사용자가 활성화한 한 paragraph만 editing host가 된다.
- composition 중에는 local DOM value와 selection을 유지한다.
- document transaction commit 후에만 `ViewerDocument` projection과 pagination을 갱신한다.
- controlled input을 쓴다면 React 지침대로 `onChange`에서 DOM value를 동기 반영하고,
  전체 문서 렌더 state와 입력 중 local state를 분리한다.
- paste는 첫 단계에서 plain text만 허용하고 rich HTML은 실행하거나 보존하지 않는다.
- selection은 DOM node reference가 아니라 source anchor와 offset으로 저장한다.
- re-pagination 후 selection 복원에 실패하면 사용자에게 caret를 임의 위치로 옮기지 않고
  명시적인 conflict를 남긴다.

첫 IME matrix:

| 동작 | 기대 결과 |
| --- | --- |
| 두벌식으로 `한글` 입력 | 중간 자모가 history에 쌓이지 않고 실제 composition 경계별 완성 transaction만 생성 |
| 조합 중 Backspace | browser 조합 결과와 model commit 일치 |
| 조합 확정 후 Undo | 조합 단위로 한 번에 원복 |
| 조합 중 paragraph 외부 click | `compositionend` 또는 취소 결과가 한 번만 commit |
| 한/영 전환, Space, Enter | 중복 문자·caret jump 없음 |
| selection replacement | 선택 범위만 교체되고 inverse command가 원문 복원 |

단위 테스트에서는 event state machine과 grouping을 검증한다. production Electron E2E에서는
Chrome DevTools Protocol의 experimental `Input.imeSetComposition`을 보조 관문으로
실험할 수 있지만, protocol 안정성을 신뢰하지 않는다. 최종 관문에는 실제 macOS 한국어
두벌식 IME 수동 입력과 저장 후 재열기를 포함한다.

## 6. 단계별 구현 계획

### V3-0 조사와 편집 경계

- [x] 과거 editor/store/serializer 실행 경로 감사
- [x] OWPML package, IME, transaction과 안전 저장 1차 출처 조사
- [x] source-preserving 모델과 품질 관문 초안
- [ ] 기존 저장 IPC 제거 또는 experimental 차단

### V3-1 package preservation

- 모든 entry를 제한된 source snapshot으로 읽는 `HwpxSourcePackage`
- duplicate/path traversal/size/compression bomb 방어
- source package → 새 package identity round-trip
- entry set, content SHA-256, mimetype method와 decode 결과 비교
- 공개 fixture에 알 수 없는 namespace·attribute·entry sentinel 추가

완료 조건:

- 수정하지 않은 모든 entry content hash 일치
- unknown sentinel 100% 보존
- Han-Flow와 한/글에서 다시 열림
- 기존 HWPX production matrix 회귀 없음

2026-07-29 구현 결과:

- 사용되지 않던 `hwpx:save` preload/main IPC와 손실성 serializer를 제거했다.
- `HwpxSourcePackage`가 모든 entry의 원본 순서·bytes·compression·CRC를 보유한다.
- 10,000 entries, 개별 128 MiB, 전체 512 MiB 상한과 경로·duplicate·암호화·compression
  preflight를 적용했다.
- unknown XML·binary·directory sentinel 공개 fixture가 entry metadata와 SHA-256 identity
  round-trip을 통과했다.
- 저장소 밖 실사용 HWPX도 본문을 출력하지 않는 같은 관문을 통과했다.
- 재패킹 결과를 기존 Han-Flow reader로 다시 열었고 전체 Jest 75개와 9,767쪽 production
  matrix를 통과했다.

남은 외부 관문은 identity 결과의 Windows 한/글 재열기다. 사용자 저장 IPC와 편집 UI는
아직 노출하지 않는다.

### V3-2 text patch와 Save As

- `hp:t` source anchor와 `ReplaceTextCommand`
- XML escape, 공백, tab, line break와 빈 text node fixture
- 수정 section 외 entry content hash 유지
- `LossReport`와 저장 전 사용자 확인
- 같은 디렉터리 temp → reopen validation → rename

완료 조건:

- 공개 fixture 한 글자 수정·저장·재열기
- 수정 text와 기존 표·이미지·style·header/footer 구조 보존
- 원본 파일 hash 불변
- 잘못된 package는 목적지에 나타나지 않음

2026-07-29 구현 결과:

- UTF-8 원본 XML token scanner가 단순 `hp:t`의 content span과 section 내 ordinal 기반
  source ID를 만든다. section 전체 AST 재직렬화는 하지 않는다.
- `ReplaceTextCommand`는 package revision, anchor와 UTF-16 range를 검사하며 inverse command를
  반환한다. stale revision, surrogate pair 중간과 XML 1.0 금지 문자는 차단한다.
- entity, tab, line break, emoji와 빈 text node를 공개 fixture로 왕복하고 inverse 뒤 section
  bytes가 원본과 같은지 검증했다.
- `LossReport`는 수정 section, 보존 entry와 stale/omitted Preview 상태를 구분한다.
- `saveHwpxAs`는 같은 directory의 배타적 임시 파일을 flush한 뒤 package identity, 기존
  Han-Flow viewer decode와 semantic verifier를 재실행한다. 성공 결과만 hard link로 새
  목적지에 commit하며 원본과 기존 목적지는 덮어쓰지 않는다.
- 저장소 밖 실사용 HWPX도 본문을 출력하지 않고 한 text patch·Save As·재개봉과 원본 hash
  불변을 통과했다.

이 단계는 저장 코어의 vertical slice다. renderer IPC, 사용자 확인, selection과 입력 UI는
아직 연결하지 않으며 V3-3 transaction/history와 V3-4 IME 관문 뒤에 노출한다.

### V3-3 transaction과 history

- command apply/invert와 revision conflict
- composition/typing grouping
- selection before/after
- bounded delta history와 dirty/savepoint
- undo 후 저장, redo 후 저장 round-trip

2026-07-29 구현 결과:

- `EditTransaction`이 base revision, 최대 1,000 commands, 전후 UTF-16 selection,
  `inputType`, composition ID와 timestamp를 가진다.
- 여러 command는 evolving immutable package에 순서대로 적용되며 하나라도 실패하면 호출자
  source에는 부분 결과가 남지 않는다. inverse는 command 역순으로 원문 bytes를 복원한다.
- 수정된 `HwpxSourcePackage`가 `HwpxReadablePackage`를 구현해 파일 재작성 없이 기존
  `ViewerDocument` projection을 다시 생성한다.
- `HwpxEditHistory`는 전체 package snapshot 대신 forward/inverse delta만 기본 100 entries,
  추정 8 MiB 안에서 보유한다. 한 entry가 byte limit보다 크면 commit 자체를 거부한다.
- 같은 input type·anchor, 연속 selection, 1초 이내 timestamp와 composition 밖이라는 조건이
  모두 맞는 연속 입력만 한 undo 단위로 묶는다. command 1,000개에서 새 단위를 시작한다.
- logical state ID 기반 savepoint로 undo가 저장 상태에 돌아오면 dirty가 해제되며,
  undo 뒤 새 edit는 redo branch를 폐기한다.
- 공개 fixture와 저장소 밖 실사용 문서에서 transaction·undo·redo·projection·Save As와 원본 hash
  불변을 검증했다.

2026-09-01 hardening은 renderer caret 동기화를 위해 main이 먼저 호출하던 `setSelection`을
`commitSynchronized` 내부로 합쳤다. 중간 command conflict나 history byte limit이 발생하면
package뿐 아니라 selection, undo/redo stack, 추정 bytes와 dirty/savepoint도 호출 전 상태를
유지한다. 성공한 no-op은 selection만 이동하고 undo entry는 만들지 않는다.

history는 현재 immutable package의 `revision`과 마지막 검증 저장 성공 시점의 `savedRevision`을
별도로 보유한다. undo/redo는 package mutation revision을 계속 증가시키므로 두 숫자가 달라도
logical state ID가 savepoint와 같으면 clean이다. main IPC와 renderer 상태바는 두 revision과
dirty를 함께 전달해 이 차이를 숨기지 않는다.

2026-09-01 구조별 저장 정책 연결 결과:

- transaction command를 본문 텍스트, 글자 모양, 문단 모양, 문단 구조의 개인정보 없는 kind로
  분류하고 history entry에 전후 정책을 저장한다.
- grouping은 kind를 합치고 undo/redo는 정책도 같은 logical state로 복원한다. 실패·no-op은 정책을
  바꾸지 않으며 undo 뒤 새 branch는 취소된 branch의 분류를 남기지 않는다.
- 저장 전 확인과 dirty 종료 안내는 실제 변경 구조, targeted source edit, 손대지 않은 XML·이미지·
  package 보존과 Preview current/stale/omitted를 함께 표시한다.
- 문단 split·merge는 저장 후 Han-Flow와 한/글 재열기를 권고하는 `review` 구조로, 텍스트·글자·
  문단 모양은 `low`로 구분한다.
- `EditingSavedResult`는 확인에 사용한 동일한 `HwpxSaveLossPolicy`를 snapshot으로 반환하고 renderer는
  저장 revision, 파일명, 구조 목록과 Preview 결과를 함께 알린다.

2026-09-01 renderer 상태 소유권 분리 결과:

- `renderer_state.ts`가 document, viewer, editing의 초기 상태와 독립 reducer 계약을 정의한다.
- `use_renderer_state.ts`가 기존 화면 callback에 typed setter를 제공하고 `App.tsx`에서 수십 개의
  개별 `useState`와 편집 mirror ref 소유권을 제거한다.
- document는 projection·열기 lifecycle, viewer는 zoom·검색·PDF·layout, editing은 session·selection·
  pending·안내만 소유한다. 각 reducer update는 다른 slice를 초기화하지 않는다.
- IME composing과 transaction sequence는 동기 `EditingImeTransientState`로 격리해 shortcut·문서 교체
  보호가 비동기 render를 기다리지 않게 한다. 새 문서에서는 session과 함께 reset한다.
- reducer와 transient state 단위 테스트가 동시 pending update, reset, 고유 transaction ID와 최신
  session mirror를 검증한다.

2026-09-01 renderer 화면 책임 분할 결과:

- toolbar/search/zoom/PDF와 편집 ribbon은 `ViewerToolbar`, loading/error/empty 영역은 `ViewerStage`,
  HWP/HWPX 공통 page metadata와 virtualization spacer는 `ViewerPageStack`으로 옮겼다.
- revision, dirty 안내, progressive loading, font 대체, overflow와 성능 표시는 `ViewerStatusBar`가
  typed props로 조합한다.
- 새 표시 컴포넌트는 preload API와 source package에 접근하지 않으며 callback과 계산된 값만 받는다.
- `App`은 IPC·비동기 편집 orchestration과 실제 page content 조합만 맡는다. 기존 문단·표 재귀
  renderer와 `ParagraphInputSurface`의 selection·IME lifecycle은 그대로 유지한다.
- React 정적 markup 테스트로 ribbon disabled/pressed 경계, empty/page stage, virtual spacer와 상태
  표시를 검증하고 기존 measurement·composition 회귀를 함께 실행한다.

2026-09-01 기존 font-face 재사용 기반:

- 글꼴 선택은 HWPX header의 `HANGUL` font-face로 이미 선언된 ID·family만 표시한다.
- renderer는 family 이름 대신 선택 ID를 보내며 main IPC와 core가 형식 및 실제 header membership을
  각각 검증한다.
- font 변경도 기존 character style definition 복제·deduplication, 부분 run split과 inverse를 사용해
  undo/redo 및 Save As 보존 계약을 공유한다.
- 미선언 ID, 새 font-face 생성, font file 포함과 라이선스 판단은 지원하지 않는다.
- 공개 fixture 변형으로 두 번째 font-face 전환, decoder family projection, header exact inverse와
  미선언 ID 거부를 검증하고 ribbon에는 문서 글꼴 option만 노출한다.

V3-3까지는 DOM event와 한국어 IME를 연결하지 않았다. 이 경계를 유지한 V3-4 input
adapter가 composition 중간값을 history에 넣지 않고 `compositionend`에서 완성 transaction
하나만 commit한다.

### V3-4 한국어 IME와 selection

- paragraph input surface
- native composition/input event adapter
- caret·selection source anchor mapping
- re-pagination 뒤 selection 복원
- CDP 보조 E2E와 실제 macOS 두벌식 수동 matrix

2026-07-29 첫 구현 결과:

- ordered XML의 모든 `hp:t`에 section 내 ordinal을 부여하고 `ViewerText.sourceAnchor`로
  projection해 source scanner의 결정적 ID와 일치시켰다.
- browser가 composition 중 DOM을 소유한다. 중간 `input`은 source·history·pagination에
  반영하지 않고 `compositionend`에서 UTF-16 최소 diff 하나만 만든다.
- source package와 bounded history는 main process의 sender-bound session이 소유한다.
  renderer는 session ID와 제한된 text command만 IPC로 보내며 base revision은 실행 시점에
  main이 결정한다.
- 첫 UI는 완전히 로드된 HWPX의 최상위 문단 중 content가 source anchor를 가진 단일
  `ViewerText`인 경우만 `plaintext-only` surface로 연다. 표 cell, 머리말·꼬리말, 복합 run,
  line break와 `.hwp`는 읽기 전용이다.
- 저장소 밖 HWPX에서 페이지·이미지 보존과 overflow 0을 유지하며 composition commit → undo → redo를
  privacy-safe probe로 검증했다.

packaged probe에서 composition caret과 뒤→앞 범위 selection을 projection, undo, redo
단계마다 비교했다. 실사용 문서에서 입력 후 페이지 text 분배가 달라져도
source anchor focus와 caret, 페이지·이미지 보존과 overflow 0이 유지됐다.

2026-08-02에는 macOS `System Events`가 실제 두벌식 입력기에 key code를 전달하는 packaged
smoke를 추가했다. 공개 fixture의 일반 문단과 표 셀에서 스페이스바로 조합을 종료한 뒤
2초 동안 source transaction과 재투영을 기다리고, 재클릭 없이 두 번째 한글을 입력한다.
첫 실행은 본문·selection은 보존하지만 `activeElement`가 surface에서 빠지는 결함을 실제로
재현했다. 재투영이 안정된 다음 두 frame에 source anchor focus를 복원하고, 프로그램 복원 중
발생한 focus event가 과거 selection을 덮어쓰지 않도록 가드한 뒤 두 surface 모두 통과했다.

2026-08-02 확장 smoke에서는 조합 중 Backspace·Escape, 앞→뒤·뒤→앞 범위 치환과 실제
`⌘Z`·`⇧⌘Z`까지 연속 matrix로 통과했다. 실행마다 새 앱을 띄울 때 생긴 전면 창 경쟁은 OS로
앱을 활성화한 다음 CDP에서 source surface focus와 selection을 다시 확정하도록 probe를
보강했다. 남은 V3-4 관문은 문단 간 클릭과 연속 손 입력을 포함한
[실제 macOS 두벌식 키보드 수동 matrix](v3_ime_manual_matrix.md)다. OS-level 자동 key smoke를
물리 키보드 전체 승인으로 확대 해석하지 않는다.

2026-07-29 Save As UI 연결 결과:

- renderer에는 raw package나 임의 writer를 노출하지 않고 sender-bound session ID 하나로
  확인창, 목적지 선택과 검증 저장을 수행하는 main IPC만 제공한다.
- 사용자 확인창은 원본 불변, Preview stale 가능성과 unknown XML·이미지 보존 정책을 먼저
  알린다. 원본 경로와 기존 목적지는 저장 코어에서 거부한다.
- 저장 성공 뒤에만 history savepoint를 옮긴다. 저장 실패는 dirty와 기존 목적지를 바꾸지
  않으며 저장 뒤 undo는 dirty, redo로 savepoint에 돌아오면 clean이 된다.
- 저장소 밖 HWPX에서 edit → Save As → dirty 해제 → 원본 SHA-256 불변 → 저장본 재열기와
  구조 보존·overflow 0을 privacy-safe probe로 검증했다.

2026-07-29 dirty lifecycle 연결 결과:

- dialog, drag-and-drop과 Finder 전달은 새 import 전에 `editing:resolveDirty`를 호출한다.
- 창 닫기와 `⌘Q`는 main이 history dirty를 직접 확인해 renderer lifecycle과 무관하게
  Save As, discard, cancel을 처리한다.
- 비동기 결정 중 반복 close를 막는 상태와 승인된 close를 분리했다. 처음 구현에서는
  `resolvingClose`가 승인 후 두 번째 close까지 막는 결함을 packaged probe가 발견했고,
  `closeApproved` 우선 조건과 BrowserWindow `closed` 뒤 quit 재개로 수정했다.
- packaged discard는 새 파일 없이 종료되고 close-save는 원본 SHA-256 불변, 저장본 8쪽,
  overflow 0 재열기를 통과했다.

### V3-5 style과 표 편집

- [x] 단일 run 굵게와 최상위 일반 문단 정렬 command
- [x] 새 style ID allocation과 header reference 무결성
- [x] 단일 `hp:t` 내부 부분 selection의 run split
- [x] 일반 표 body cell의 단일 문단·단일 run text 편집
- [x] 글자 크기·색상과 여러 run 문단의 run별 입력 surface
- [x] macOS 실제 두벌식 OS-level key smoke
- [ ] 전체 물리 키보드 matrix와 Windows 한/글 재열기 외부 승인
- 글꼴 family와 행·열·병합은 후속 범위
- 각 기능의 package/visual/PDF round-trip

2026-07-29 공개 구현 비교 결과는
[HWP/HWPX 오픈소스 참고 프로젝트 검토](open_source_reference_review.md)에 분리했다.
Kordoc의 source-map splice와 재파싱 관문, Alhangeul의 macOS 제품·배포 운영,
hwp-mcp의 작은 ZIP mutation 구현을 비교했다. 첫 style slice는 임의 문자열 검색이나
첫 style 복제가 아니라 현재 source anchor, 실제 원본 style clone, 결정적 ID allocation과
header list/reference의 원자적 변경으로 구현한다. 세 저장소의 코드는 이번 조사에서
이식하지 않았고 새 dependency도 추가하지 않았다.

2026-07-29 첫 style slice 구현 결과:

- `ApplyCharacterStyleCommand`는 활성 source anchor가 속한 최상위 단일 run 전체의 굵기를
  바꾼다. `ApplyParagraphStyleCommand`는 같은 범위의 왼쪽·가운데·오른쪽·양쪽 정렬만
  허용한다.
- target run의 실제 `charPr` 또는 paragraph의 `paraPr`를 raw XML에서 찾아 unknown
  attribute·child를 보존한 채 복제한다. 같은 definition signature가 있으면 재사용하고,
  없으면 해당 collection의 숫자 ID 최대값 다음 값을 결정적으로 할당한다.
- `itemCnt`, 새 definition과 section reference를 한 transaction으로 갱신한다. inverse는
  reference와 추가 definition을 함께 제거해 header와 section 원본 bytes를 복원한다.
- 표 cell, 머리말·꼬리말, 복합 run은 IPC에서 source anchor를 직접 보내도 차단한다.
- renderer toolbar는 활성 editable surface가 있을 때만 굵게와 정렬 4종을 활성화한다.
  caret 이동도 다음 transaction의 selectionBefore로 동기화하며 `⌘B`를 지원한다.
- 저장소 밖 HWPX에서 text commit → 굵게 → 정렬 → 두 단계 undo/redo → Save As → 저장본
  재열기를 검증했다. 구조 보존·overflow 0과 원본 hash 불변을 유지했다.

2026-07-29 부분 selection slice 구현 결과:

- 선택 범위가 `hp:t` 일부이면 원본 run open/close와 text tag 속성을 보존한 채 좌·선택·우
  최대 3개 run으로 나눈다. 선택 구간만 새 `charPrIDRef`를 사용한다.
- XML entity가 있는 text는 decode된 UTF-16 경계로 선택을 검증하고 각 fragment를 다시
  escape해 문자 의미를 유지한다. surrogate pair 중간 선택은 차단한다.
- 분할 뒤 selection은 선택 run의 새 `hp:t` ordinal과 상대 offset으로 이동하며 역방향
  selection 방향도 유지한다.
- inverse는 예상 split fragment가 그대로인지 확인한 뒤 원본 run bytes와 추가 style
  definition을 함께 복원한다. redo는 같은 fragment를 다시 생성한다.
- renderer toolbar는 분할 뒤 새 source anchor의 굵기와 문단 정렬을 계속 표시한다.
  여러 run은 source anchor별 입력 surface를 유지하고 좌우 화살표로 인접 run 경계를
  이동한다. style 분할로 run 수가 바뀌면 stale DOM selection을 재사용하지 않는다.
- 저장소 밖 HWPX의 범위 교체 → 부분 굵게 → 정렬 → undo/redo → Save As → 저장본 재열기를
  검증했다. 구조 보존·overflow 0과 원본 hash 불변을 유지했다.

2026-07-30 표 cell text slice 구현 결과:

- decoder가 이미 모든 표 cell `hp:t`에 section ordinal source anchor를 부여하고
  `ReplaceTextCommand`가 위치와 무관하게 같은 inverse를 만들기 때문에 새 XML command를
  추가하지 않고 기존 transaction·IME·history를 재사용했다.
- renderer는 body cell 중 단일 문단·단일 `ViewerText`, `rowSpan=1`, `columnSpan=1`인
  경우에만 `HWPX 표 셀 편집` surface를 연다.
- 반복 머리글은 pagination에서 같은 source anchor가 여러 페이지에 나타날 수 있고,
  continuation fragment도 head·tail DOM이 원본 anchor를 공유한다. 이들과 병합 cell,
  여러 문단 cell은 중복 commit을 피하기 위해 명시적으로 읽기 전용 처리했다.
- 표 셀은 text 입력만 허용하며 굵게·문단 정렬 toolbar 대상에는 포함하지 않는다.
- 공개 baseline의 표 셀 범위 편집 → undo/redo → Save As → 3쪽·이미지 4개 재열기를
  production `.app`에서 검증했다. 같은 matrix의 continuation 2쪽, 병합/rowSpan 이미지
  12개, 9,767쪽 progressive 문서도 overflow 0을 유지했다.
행·열 추가, 병합·분할, 표 cell style 편집은 계속 별도 범위로 둔다.

2026-09-04 후속 slice에서는 병합·span·반복 머리글·continuation이 없는 body cell에 여러 문단이
있어도, 모든 문단이 source anchor 하나를 가진 단일 text run이면 편집할 수 있게 확장했다.
`TABLE_CELL_TEXT` context는 cell별 range scope를 공유한다. source paragraph locator는
`hp:tc > hp:subList > hp:p` ancestry와 header·cellSpan을 검증하고 같은 subList의 direct paragraph만
선택하므로 문단 횡단 치환·Enter·경계 병합을 안전하게 재사용한다. 다른 cell과 header/footer
subList는 core에서 다시 거부한다.

같은 날 다음 slice는 안전한 일반 body cell의 `borderFillIDRef` 편집을 열었다. 기존
`hh:borderFill`을 직접 바꾸지 않고 새 ID로 복제해 선택 셀에만 연결하므로 같은 style을 공유하는
다른 셀은 유지된다. UI는 단색 배경과 사방 테두리 색·두께·없음을 제공하고, core는 기존
`hc:winBrush`와 네 border가 모두 있는 경우에만 적용한다. header collection과 section reference는
단일 history transaction 및 exact inverse로 undo/redo한다. 저장 loss policy는 이 변경을
`table-cell-style`과 review 대상으로 분류해 Han-Flow·한/글 재열기를 권고한다. 행·열과
병합·분할은 주소·span·layout mutation이 필요하므로 다음 관문으로 남긴다.

표 구조의 첫 slice는 병합·중첩·복합 콘텐츠가 없는 직사각형 표의 현재 body 행 아래에 빈 행을
추가한다. `rowCnt`, direct row/cell 수, `cellAddr`와 `cellSpan`을 source에서 교차 검증한 다음 선택
행의 geometry·margin·borderFill과 text style을 복제한다. 새 셀의 text는 비우고 stale
`linesegarray`는 제거하며, 뒤쪽 행 주소와 table count·전체 높이를 table fragment transaction 하나로
바꾼다. selection anchor보다 뒤에 삽입하므로 기존 caret ordinal을 유지할 수 있다. exact inverse는
원본 table bytes를 보관한다. 행 삭제와 열 삽입은 selection anchor가 사라지거나 이동하므로 다음
slice에서 명시적인 selection projection 계획과 함께 구현한다.

후속 행 삭제 slice는 다음 body 행의 첫 text를 변경 후 selection으로 사용하고, 마지막 body 행을
삭제할 때는 이전 body 행으로 이동한다. 삭제된 text 수만큼 다음 anchor ordinal을 당겨 계산하며 이
살아남은 anchor를 inverse command의 locator로도 사용한다. 따라서 undo가 이미 사라진 선택 셀을
찾으려다 실패하지 않고 원래 table bytes와 selection을 함께 복구한다. 표 높이와 뒤쪽 row 주소도
같은 transaction에서 감소한다. 반복 머리글 및 마지막 하나뿐인 body 행 삭제는 차단한다.

다음 열 편집 slice는 선택 열의 대응 cell을 모든 direct row에서 동시에 추가하거나 삭제한다.
오른쪽 열 추가는 선택 열의 geometry·margin·style을 행별로 복제하되 text와 `linesegarray`를
비우고 paragraph ID를 다시 만든다. 삭제는 최소 두 열을 요구하며 같은 행의 다음 cell, 마지막
열이면 이전 cell로 selection을 옮긴다. 두 동작 모두 `colCnt`, 뒤쪽 `colAddr`와 표 `hp:sz`
너비를 같은 table fragment transaction에서 갱신한다.

열 mutation은 선택 body 행보다 앞선 모든 행에도 text node를 추가하거나 제거하므로 현재 anchor
ordinal이 행 편집과 달리 그대로 유지되지 않는다. mutation 전 행별 text 수와 선택 열 prefix를
기록하고 변경 후 살아남은 anchor를 inverse locator로 삼아 selection을 투영한다. 행마다 선택 열
너비가 다르거나 병합·span·중첩 표·복합 control·주소 불일치가 있으면 source를 바꾸지 않고
fail-closed한다. 반복 머리글은 선택 대상으로 열지 않지만 열 구조가 바뀔 때 대응 header cell은
같이 복제하거나 제거한다. 셀 병합·분할은 열 편집 검증 뒤의 별도 topology 관문으로 남긴다.

2026-09-05 오른쪽 열 추가 slice는 위 계약 중 insertion 경로를 구현했다. 선택 열 너비가 모든
direct row에서 같은지 확인한 뒤 대응 cell을 비워 복제하고, 선택 body 행보다 앞선 행에서
추가된 text 수만큼 source ordinal을 이동한다. 이 이동된 anchor가 inverse locator가 되므로
undo/redo에서도 원래 selection과 변경 후 selection을 각각 검증할 수 있다. 다중 열 공개 fixture,
main session, 리본과 Save As·재개봉을 통과했다. 현재 열 삭제와 삭제 후 이웃 cell 재배치는 다음
slice로 남긴다.

같은 날 현재 열 삭제 slice는 대응 cell을 모든 direct row에서 제거하고 뒤쪽 `colAddr`,
`colCnt`와 표 너비를 함께 감소시켰다. 중간 열은 같은 행의 오른쪽 cell, 마지막 열은 왼쪽 cell의
첫 text를 변경 후 selection과 inverse locator로 사용한다. target 앞에서 함께 삭제된 text 수를
원본 ordinal에서 빼므로 반복 머리글과 앞선 body 행이 있어도 정확한 anchor를 찾는다. 하나뿐인
열, 불균일 열 너비와 병합·span 구조는 source 변경 전에 차단한다. core, main session, 리본,
exact undo/redo와 Save As·재개봉을 통과해 단순 직사각형 표의 행·열 편집 기반을 닫았다.

### Sprint 2 inline 줄 나눔과 문단 구조 입력

OWPML의 줄 나눔은 새 문단이 아니라 `hp:t` 혼합 콘텐츠 내부의 `hp:lineBreak`다. source anchor는
plain XML text, `hp:lineBreak`, `hp:tab`을 각각 논리 텍스트, `\n`, `\t`로 읽고 UTF-16 offset을
유지한다. 편집 직렬화는 논리 `\n`을 `<hp:lineBreak/>`로 되돌린다. 알 수 없는 inline element나
entity가 있으면 기존 fail-closed 정책대로 source anchor를 노출하지 않는다.

Shift+Enter는 Chromium이 contentEditable 내부에 만드는 DOM 모양에 맡기지 않고
`insertLineBreak` transaction을 직접 생성한다. 여러 줄 plain-text paste도 같은 직렬화 경로를
사용한다. 일반 Enter는 서로 다른 `hp:p` 두 개를 만들어야 하고 stale `hp:linesegarray` 처리와
exact inverse가 필요하므로 별도 paragraph fragment command에서 구현한다.

첫 paragraph fragment slice는 최상위 일반 텍스트 문단을 대상으로 구현했다. Enter selection이
있는 경우 선택 범위를 제거하며 대상 run을 양쪽에 복제하고, 이전·이후 run은 각 문단에
분배한다. 두 문단의 빈 `hp:t`를 유지해 source anchor가 사라지지 않으며 두 fragment에서는
stale `hp:linesegarray`를 제거한다. inverse는 원래 문단 XML bytes 전체를 보관해 undo에서
정확히 복원한다. 숫자 문단 ID가 있으면 section 최대 ID 다음 값을 새 문단에 할당한다.

인접 문단 merge도 같은 paragraph fragment command에 연결했다. 다음 문단 첫 run의 offset 0에서
Backspace를 누르거나 이전 문단 마지막 run 끝에서 Delete를 누를 때만 실행한다. 결과는 앞 문단의
open tag와 문단 모양을 유지하고 두 문단의 모든 run을 순서대로 합치며, 양쪽 `linesegarray`는
제거한다. 두 입력 방향은 동일한 replacement fragment를 만들고 현재 caret의 text node ID와
offset을 유지한다. inverse는 사이 공백을 포함한 원래 두 문단 bytes를 복원한다.

이웃이 없으면 UI에서는 no-op로 처리한다. 인접 문단이 복합 구조이거나 두 문단 사이에 보존해야
할 XML element가 있으면 fail-closed 오류로 남긴다. 표 셀 구조 편집은 별도 cell scope 확장
뒤로 유지한다.

여러 문단 범위 치환 코어는 UI host보다 먼저 구현했다. 정규화된 시작·끝 anchor가 서로 다른
최상위 일반 문단에 있으면 기존 run별 text command 대신 paragraph fragment command 하나를
만든다. 시작 문단의 선택 앞 prefix와 입력 문자열, 끝 문단의 선택 뒤 suffix를 앞 문단 모양 아래
합치고 중간 문단을 제거한다. 시작 이전 run과 끝 이후 run은 원본 XML 그대로 유지하며 양 끝
경계 run의 char style도 각각 보존한다.

모든 선택 문단이 simple text 정책을 통과하고 문단 사이가 XML whitespace뿐일 때만 실행한다.
inverse는 시작부터 끝 문단까지 원문 bytes를 보관한다. 기존 표 셀·중첩 anchor 범위는 이
dispatcher 대상이 아니며 기존 multi-run text command 계약을 유지한다. main `commitRange`의
undo/redo·Save As와 renderer 공통 paragraph host까지 연결했다.

renderer의 `.viewer-pages`가 편집 중 공통 selection host가 된다. 각 editable surface에는 source
anchor와 range scope를 함께 표시한다. 같은 section의 최상위 일반 문단은 scope를 공유하므로
native pointer drag와 Shift+방향키가 문단·run 경계를 넘을 수 있다. 표 셀 문단은 문단별 고유
scope를 사용해 최상위 구조 치환에 섞이지 않는다. 선택은 native `::selection`으로 강조하고
입력·삭제·plain-text paste·조합 종료는 범위 전체를 `commitRange`로 보낸다. history 재투영 때는
공통 host에서 양 끝 source anchor를 찾아 방향과 offset을 복원한다.

2026-09-01에는 편집 오류를 Electron 기본 reject 문자열에 맡기지 않고 안정적인 IPC payload로
분류했다. payload는 오류 code, 사용자용 message, recoverable 여부와 `preserve`, `retry`,
`restart-session`, `none` 복구 정책만 가진다. 알 수 없는 내부 오류는 문서 경로나 원문을 전달하지
않고 일반화한다. preload가 payload를 고정 marker로 unwrap하고 renderer가 marker 위치와 무관하게
다시 읽으므로 Electron이 오류 접두 문구를 추가해도 code가 유지된다.

renderer는 conflict에서 변경이 적용되지 않았음을, save failure에서 dirty 변경이 유지됐음을
알린다. session expired와 history limit도 별도 상태로 표시하며 인접 문단이 없는 merge는
`EDITING_NOT_APPLICABLE` no-op로 처리한다. 첫 capability slice는 여러 source run selection에서
글자 모양 control과 단축키를 비활성화한다.

2026-09-01 후속 slice는 ViewerDocument의 editable anchor를 최상위 텍스트와 단순 표 셀로
분류하고 같은 문단·여러 run·여러 문단·cross-scope selection별로 text, character style,
paragraph style과 paragraph structure capability를 계산한다. 표 셀은 text와 내부 line break만
허용하고 Enter split, 경계 merge와 style control을 IPC 전에 차단한다.

모든 편집 결과 selection은 새 projection의 anchor와 text 길이에 다시 대조한다. offset은
surrogate pair를 가르지 않는 UTF-16 경계로 제한하고, 한 endpoint가 사라지면 남은 endpoint로
collapse하며 둘 다 사라지면 선택을 해제한다. conflict가 반환되면 `editing:refresh`로 main
session의 현재 document·revision·selection을 다시 받아 같은 복구를 적용하고 결과를 상태바에
남긴다. 구조별 loss policy는 다음 별도 slice로 유지한다.

구조 근거는 [한컴 HWP/OWPML 공개 자료](https://www.hancom.com/support/downloadCenter/hwpOwpml)와
[한컴 공식 OWPML 모델](https://github.com/hancom-io/hwpx-owpml-model)을 우선한다.

2026-07-30 V3 코드 완료 slice 구현 결과:

- `ApplyCharacterStyleCommand`는 기존 굵기와 같은 definition clone·reuse 경계에서
  `height` 500–7200 HWP 단위(5–72pt)와 `textColor` `#RRGGBB`를 함께 다룬다.
- renderer는 크기 증감과 native 색상 선택기를 제공하고 현재 source run의 값을 표시한다.
- 부분 style 뒤 생긴 여러 run을 각각 편집할 수 있으며 좌우 경계에서 selection을 인접
  source anchor로 옮긴다.
- 부분 글자 style과 문단 정렬을 함께 적용한 package를 Save As한 뒤 재개봉해 새 definition,
  section reference와 본문 fragment를 확인한다.
- 글꼴 family는 font-face ID·설치 font·라이선스 mapping을 함께 풀어야 하므로 V3에서
  제외한다. V3 저장 계약은 원본과 기존 목적지를 덮어쓰지 않는 검증형 Save As다.

### V3-6A 현실적인 편집 UX 기반

좁은 공개 fixture는 작은 byte 수로 pagination·표 continuation과 머리말·꼬리말을 빠르게
실행하기 위한 회귀 입력이며 실제 편집 화면의 대표가 아니다. 별도 A4 세로 fixture를
`59528 × 84189 HWPUNIT`, 사방 약 20mm 여백으로 생성해 편집 사용성 관문으로 사용한다.

편집 chrome은 52px 한 줄 toolbar 안의 25px style control에서 문서 제어와 `홈` 리본을 분리한
2단 구조로 바꾼다. 리본은 파일, 기록, 글자 모양, 문단 정렬 그룹과 최소 40px action을 사용한다.
현재 command·inverse·Save As가 검증된 기능만 노출하며, 글꼴 family·줄 간격·목록·표 구조
편집은 UI placeholder부터 만들지 않는다. packaged E2E는 활성 홈 탭, toolbar와 버튼
실측 크기, A4 범위 치환·selection·undo/redo와 overflow 0을 함께 판정한다.

### V3-6B 글자 장식 command

2026-08-02에는 기존 글자 style clone·reuse 경계에 기울임, 밑줄과 취소선을 추가했다.
한컴 공개 OWPML 모델의 `CharShapeType` 자식 순서인 `italic → bold → underline → strikeout`을
따라 새 요소를 삽입한다. 기울임은 빈 요소, 밑줄은 `type/shape/color`, 취소선은
`shape/color` 속성을 사용한다. 기존 장식 요소를 해제할 때는 알 수 없는 속성을 제거하지 않고
각 활성 판정 속성만 `NONE`으로 바꾼다.

동일 definition 재사용, 부분 selection run 분할과 byte 단위 inverse는 기존 command 계약을
그대로 사용한다. projection은 세 장식을 독립 boolean으로 내보내고 renderer는 underline과
line-through를 동시에 합성한다. 홈 리본과 `⌘I`·`⌘U`를 연결했으며 packaged A4 fixture에서
세 버튼 적용, Save As와 저장본 재열기를 통과했다.

### V3-6C 문단 간격 command

공식 `ParaShapeType` 순서에서 `margin`은 `lineSpacing`보다 앞에 위치한다. 줄 간격은
`type="PERCENT"`, 100–300의 정수 값과 `unit="HWPUNIT"`으로 제한했고, 문단 앞·뒤 간격은
`hh:margin` 안의 `hc:prev`·`hc:next`를 0–7200 HWPUNIT, 즉 UI 기준 0–72pt로 제한했다.
좌우 여백과 `hc:intent`, unknown attribute는 변경하지 않는다.

renderer는 기존 `ViewerParaStyle.lineSpacing`과 `margin.top/bottom` projection을 그대로 사용한다.
홈 리본에 줄 간격 10% 단위, 문단 앞·뒤 간격 1pt 단위 조절기를 추가했다. packaged A4
fixture에서 170%, 앞 1pt, 뒤 1pt를 차례로 적용한 뒤 Save As했고 원본 불변, 2쪽·이미지 3개,
overflow 0 재열기를 확인했다.

### V3-6D 첫 줄 들여쓰기·내어쓰기

한컴 공개 모델의 `CMargin`은 XML 이름 `hc:intent`를 내부 `Margin_Indent`에 연결한다. 이를
`ViewerParaStyle.indent`로 projection하고 CSS `text-indent`에 HWPUNIT 단위로 반영한다.
command 범위는 −7200–7200 HWPUNIT이며 음수는 첫 줄 내어쓰기, 양수는 첫 줄 들여쓰기다.

홈 리본은 1pt 단위 양방향 버튼과 현재 값을 표시한다. 기존 `hh:margin`의 left, right, prev,
next와 unknown XML은 그대로 보존한다. packaged A4 probe에서 −1pt 적용, 0pt 복귀, +1pt 적용을
차례로 수행했고 Save As 저장본에서 각 definition과 최종 +100 HWPUNIT를 확인했다.

### V3 외부 승인과 V4 이관

`npm run fixture:v3-windows`는 외부 승인 입력을 한 디렉터리와 단일 ZIP으로 만든다. 원본과
production identity Save As, 일반 문단의 모든 현재 style을 적용한 편집본, 표 body cell
편집본과 A4 기준 문서를 포함한다. manifest는 생성 commit과 각 HWPX SHA-256, macOS 사전
검증 결과를 기록하고 Windows PowerShell에서 전송 hash를 다시 검사한다. 이 자동화는 한/글
실기 판정을 대신하지 않으며 WIN-01~08이 모두 기록되기 전에는 V3 완료로 바꾸지 않는다.

- macOS 실제 두벌식 OS-level key smoke 통과 유지
- Backspace·Escape·범위 선택을 포함한 물리 키보드 입력 matrix
- 개인정보 없는 원본·편집 저장본을 Windows 한/글에서 다시 열어 검증
- stale Preview 안내와 원본 보호 Save As 정책 유지
- 통과 결과를 검증 이력에 기록한 뒤 V4 서명·공증으로 이관

## 7. 자동 검증 설계

### package identity

- entry path와 count
- 각 uncompressed entry SHA-256
- `mimetype` value와 stored method
- `content.hpf` manifest/spine reference
- header/section XML parse
- BinData reference와 실제 entry 존재

### semantic round-trip

- section, paragraph, run, table, cell, image와 resource count
- style ID와 reference 무결성
- 수정 text의 정확한 위치
- header/footer/page setting
- unknown sentinel 존재

### visual/PDF

- 기존 `verify:matrix`
- 저장한 fixture의 page count, overflow, image decode
- 화면과 PDF page count·비공백 문자 수
- 편집 전후 허용된 차이만 기록하는 privacy-safe delta

### fault injection

- package build 중 실패
- temp write/flush 실패
- reopen validation 실패
- rename 직전 종료
- rename 실패
- 같은 목적지에 중복 저장 요청

각 실패에서 원본과 기존 목적지 hash가 유지되고 임시 파일이 제한된 정리 정책을 따라야 한다.

## 8. 채택하지 않는 접근

- `ViewerDocument`를 직접 mutation하고 전체 HWPX를 재생성
- 과거 `NormalizedDocument`와 전체 deep-copy history 부활
- 조합 중 keystroke마다 전체 projection·pagination 수행
- 모든 문단을 한 개의 자유로운 rich `contentEditable` tree로 관리
- 저장 검증 없이 원본 경로에 직접 `writeZip`
- 알 수 없는 element를 조용히 삭제
- HWP binary 저장을 V3 HWPX 편집과 동시에 진행
- 한컴과 픽셀 단위 동일함을 저장 성공 기준으로 사용

## 9. 미결정 사항

다음 항목은 V3-1 spike 결과로 결정한다.

1. 기존 ordered XML에 source span을 추가할지, 별도 mutable ordered AST를 둘지
2. 바뀐 section 전체를 재직렬화할지 `hp:t` raw span만 patch할지
3. `Preview/PrvText.txt`와 `PrvImage.png`를 언제·어떻게 갱신할지
4. 변경 추적 정보를 보존만 할지, edit mode를 차단할지
5. Scripts/OLE/external link 문서의 편집 차단 범위
6. rich selection 단계에서 ProseMirror 같은 framework를 도입할지
7. macOS 안전 교체를 Node `rename`으로 충분히 검증할지 native helper가 필요한지

## 10. 출처

모든 링크는 2026-07-29에 확인했다.

### OWPML과 HWPX

- [한국표준정보망, KS X 6101 OWPML 문서 구조](https://www.kssn.net/search/stddetail.do?itemNo=K001010119985):
  적용 범위, 재수정·유통·기술 독립 목표와 2024-10-30 최신 개정 이력
- [한컴테크, HWPX 포맷 구조 살펴보기](https://tech.hancom.com/hwpxformat/):
  ZIP package, mimetype, version, content.hpf, header/section, BinData, META-INF, Scripts와 Preview 역할
- [한글과컴퓨터, HWPX 사용 권장 안내](https://www.hancom.com/news/notice/detail/10924):
  XML 기반 개방형 형식과 재가공·재수정 목적
- [한컴 개발자센터, 오픈소스](https://developer.hancom.com/opensources):
  한컴이 공개한 OWPML 모델과 검증 도구의 공식 배포 경로
- [hancom-io, hwpx-owpml-model](https://github.com/hancom-io/hwpx-owpml-model):
  OWPML element 추출·저장 모델, `CharShapeType` 자식 순서와 글자 장식 속성의 Apache-2.0 공개 구현
- [hancom-io, HWPX Document Validation Checker](https://github.com/hancom-io/dvc):
  글자·문단 모양, 표, 특수문자, border, 목록, style와 hyperlink 검증 사례

### Web 편집과 IME

- [W3C, UI Events](https://www.w3.org/TR/uievents/):
  composition event 순서, 조합 중 keyboard/input event와 `isComposing`
- [W3C, Input Events Level 2](https://www.w3.org/TR/input-events-2/):
  `beforeinput`, `inputType`, target range와 조합 중 input event 순서
- [W3C, Selection API](https://www.w3.org/TR/selection-api/):
  DOM selection과 range 경계
- [React, common DOM events](https://react.dev/reference/react-dom/components/common):
  composition handler와 React `onBeforeInput` polyfill 주의
- [React, textarea](https://react.dev/reference/react-dom/components/textarea):
  controlled value 동기 갱신과 caret remount 주의
- [ProseMirror guide](https://prosemirror.net/docs/guide/):
  model, transform, transaction, editor state와 view의 단방향 data flow
- [Chrome DevTools Protocol, Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/):
  experimental `imeSetComposition`과 `insertText`

### 저장과 Electron 보안

- [Node.js, File system](https://nodejs.org/api/fs.html):
  순차 write 요구, `FileHandle`, flush와 `fsPromises.rename`
- [Apple, FileManager.replaceItem](https://developer.apple.com/documentation/foundation/filemanager/replaceitemat%28_%3Awithitemat%3Abackupitemname%3Aoptions%3A%29):
  data loss를 피하는 교체와 같은 디렉터리의 고유한 임시 파일 권고
- [Electron, Security](https://www.electronjs.org/docs/latest/tutorial/security):
  비신뢰 콘텐츠 격리, IPC sender 검증과 최소 권한 API
- [Electron, Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation):
  renderer에 일반 IPC를 직접 노출하지 않고 메시지별 제한 API를 제공하는 원칙

### 비교한 공개 구현

- [HWP/HWPX 오픈소스 참고 프로젝트 검토](open_source_reference_review.md):
  Kordoc, Alhangeul for macOS와 hwp-mcp의 고정 commit, 라이선스, 적용·비채택 판단
