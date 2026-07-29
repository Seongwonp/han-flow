# V3 HWPX 편집 조사와 구현 전략

상태: V3-4 첫 slice 완료 — 제한된 paragraph IME surface와 packaged undo/redo 연결

기준일: 2026-07-29

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
| `src/renderer/src/store.ts` | 폐기 후보 | 실행 경로에서 import되지 않는다. `NormalizedDocument` 전체 deep copy history, `any`, `Date.now()` ID와 action 내부 store update를 사용한다. V3 store의 근거로 쓰지 않는다. |
| `src/shared/types.ts`의 `NormalizedDocument` | 참고만 유지 | 초기 parser/editor용 모델이다. 원본 package와 알 수 없는 XML을 소유하지 않아 저장 원본으로 부적합하다. |
| `src/core/parser/parser.ts`·`normalization.ts` | 격리 후보 | 현재 `DocumentImporter` 경로에서 사용되지 않는 초기 parser다. 조기 normalization으로 원본 구조가 손실된다. |
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
- 저장소 밖 AIDA HWPX도 본문을 출력하지 않는 같은 관문을 통과했다.
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
- 저장소 밖 AIDA HWPX도 본문을 출력하지 않고 한 text patch·Save As·재개봉과 원본 hash
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
- 공개 fixture와 AIDA 실문서에서 transaction·undo·redo·projection·Save As와 원본 hash
  불변을 검증했다.

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
- 패키지 AIDA 기준 8쪽·이미지 4개·overflow 0을 유지하며 composition commit → undo → redo를
  privacy-safe probe로 검증했다.

packaged probe에서 composition caret과 뒤→앞 범위 selection을 projection, undo, redo
단계마다 비교했다. AIDA에서 한 글자 삽입 후 2·3페이지 text 분배가 실제로 달라졌지만
source anchor focus와 caret, 8페이지·이미지 4개·overflow 0이 유지됐다.

남은 V3-4 관문은 [실제 macOS 두벌식 키보드 수동 matrix](v3_ime_manual_matrix.md)다.

2026-07-29 Save As UI 연결 결과:

- renderer에는 raw package나 임의 writer를 노출하지 않고 sender-bound session ID 하나로
  확인창, 목적지 선택과 검증 저장을 수행하는 main IPC만 제공한다.
- 사용자 확인창은 원본 불변, Preview stale 가능성과 unknown XML·이미지 보존 정책을 먼저
  알린다. 원본 경로와 기존 목적지는 저장 코어에서 거부한다.
- 저장 성공 뒤에만 history savepoint를 옮긴다. 저장 실패는 dirty와 기존 목적지를 바꾸지
  않으며 저장 뒤 undo는 dirty, redo로 savepoint에 돌아오면 clean이 된다.
- packaged AIDA에서 edit → Save As → dirty 해제 → 원본 SHA-256 불변 → 저장본 재열기
  8쪽·이미지 4개·overflow 0을 privacy-safe probe로 검증했다.

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

- 글자·문단 style command
- 새 style ID allocation과 header reference 무결성
- 표 cell text부터 시작해 행·열·병합을 별도 관문으로 확장
- 각 기능의 package/visual/PDF round-trip

### V3-6 저장 복구와 실사용 관문

- in-place save, backup, crash/fault injection
- stale preview·metadata 갱신 정책 확정
- 개인정보 없는 compatibility corpus
- 저장 결과를 Windows 한/글에서 다시 열어 검증
- V4 서명·공증 전 개인용 장기 사용

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
- [hancom-io, hwpx-owpml-model](https://github.com/hancom-io/hwpx-owpml-model):
  OWPML element 추출·저장 모델과 Apache-2.0 공개 구현
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
