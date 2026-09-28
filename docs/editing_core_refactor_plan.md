# 편집 코어 tree 모델 전환 계획

상태: 제안 — 1단계(XML scanner 통합, `src/core/editing/xml_scan.ts`) 완료, tree 전환 미착수

## 1. 현재 구조

- **byte offset 위 문자열 patch**: 모든 편집 command는 section·header XML 원문 문자열을
  `scanXmlElements`로 훑어 element offset(`start`/`openEnd`/`closeStart`/`end`)을 얻고,
  `replaceRange`로 해당 범위만 바꾼 새 entry를 만든다. 손대지 않은 byte는 그대로 남기
  때문에 Save As identity round-trip이 쉽게 보장된다.
- **ordinal 기반 anchor**: 편집 위치는 `${sectionPath}#hp:t:N`, 즉 section 안 N번째 `hp:t`다.
  구조가 바뀌는 command(문단 분할·표 행/열)는 anchor ordinal을 다시 계산해 selection을 옮긴다.
- **parser가 둘**: 화면용은 `src/core/parser/ordered_xml.ts`(fast-xml-parser `preserveOrder`)로
  `ViewerDocument`를 만들고, 편집용은 손으로 쓴 tokenizer(`xml_scan.ts`, `text_patch.ts`의
  `tokenizeXml`)가 같은 원문을 다시 읽는다. 두 해석이 `hp:t` 순번에서 일치한다는 가정이
  편집 가능 여부 판단(`editing_capability.ts`)과 command 적용 사이의 계약이다.
- **command마다 네 조각**: scanner로 문맥 찾기 → planner(`plan*`)가 교체 fragment 작성 →
  문자열 비교로 검증되는 inverse(`expectedFragment`/`replacementFragment`, header mutation) →
  capability 판단. `history.ts`는 inverse 문자열 길이로 undo 예산을 잰다.

## 2. 한계

1. **topology별 whitelist**: 표 편집은 "병합 없는 직사각형", 셀 style은 "일반 body 셀"처럼
   문자열 패턴이 확실한 경우만 허용한다. 새 topology는 scanner 조건과 fail-closed 분기를
   파일마다 추가해야 한다(`table_patch.ts` 1,000줄 이상).
2. **기능 하나에 네 곳 수정**: 찾기·바꾸기, 여러 문단 style, 각주 등은 모두 scanner·planner·
   inverse·capability를 각각 써야 하고, 서로 다른 해석이 어긋날 위험이 기능 수에 비례한다.
3. **inverse가 fragment 전체 복사**: 표 한 칸 수정의 undo가 표 전체 문자열이 되어 history
   byte 예산(기본 8 MiB)을 빨리 소모한다.
4. **정규식 attribute 처리**: `attribute`/`setAttribute`가 정규식이라 다른 값 안의 문자열,
   줄바꿈 포함 값, entity를 정확히 다루지 못한다(후속 과제로 기록).

## 3. 목표 구조

- **단일 가변 ordered tree**: `ordered_xml.ts`의 `OrderedXmlNode`를 편집 가능한 tree로 확장한다.
  각 node는 원문 범위(`sourceStart`/`sourceEnd`, 여는 tag 원문, attribute 원문 순서·따옴표)를 들고,
  변경 여부(dirty) 표시를 가진다.
- **범위 보존 serializer 하나**: dirty가 아닌 subtree는 원문 byte 범위를 그대로 복사하고,
  dirty node만 다시 쓴다. 바뀌지 않은 attribute는 원문 표기를 유지한다.
- **command = tree 연산**: `setText`, `setAttribute`, `insertChild`, `removeChild`, `moveChildren`
  같은 소수의 연산으로 command를 표현하고, 각 연산이 구조적 inverse(삭제한 subtree, 이전 값)를
  돌려준다. undo 비용은 바뀐 node 크기에 비례한다.
- **capability를 tree에서 도출**: 편집 가능 여부와 anchor를 화면 모델과 같은 tree에서 계산해
  parser 두 벌 사이의 ordinal 계약을 없앤다.

## 4. 이전 순서

각 단계는 기존 문자열 command와 새 tree command를 같은 입력으로 돌려 출력 XML 문자열이
byte 단위로 같음을 확인한 뒤 교체한다. 단계마다 Save As identity·single-edit round-trip과
`verify:matrix`의 편집 + Save As 경로를 통과해야 다음으로 넘어간다.

1. **text** (`text_patch.ts`, `range_edit.ts`, `composition_input.ts`): `hp:t` 내용과
   `hp:lineBreak`/`hp:tab` 혼합 콘텐츠만 다룬다. serializer의 범위 보존을 가장 작게 검증한다.
2. **style** (`style_patch.ts`, `cell_style_patch.ts`): header collection의 `itemCnt`, 정의 재사용,
   run 분할을 tree 연산으로 바꾼다. header·section 두 entry 동시 변경의 inverse를 검증한다.
3. **paragraph** (`paragraph_patch.ts`): 문단 분할·병합·여러 문단 치환. `hp:linesegarray` 처리
   정책을 이 단계에서 확정한다.
4. **table** (`table_patch.ts`): 행·열 추가/삭제, 병합·분할. `colCnt`/`rowCnt`/`colAddr` 재계산을
   tree 위 함수로 옮기고 topology whitelist를 tree 검사로 대체한다.

전환 중에는 `xml_scan.ts`를 문자열 command와 비교 oracle 양쪽이 공유한다.

## 5. 위험

- **공백·entity 충실도**: fast-xml-parser는 entity를 해석하고 공백·따옴표 표기를 잃는다.
  dirty node를 다시 쓸 때 원문 표기(`&#10;` 대 `<hp:lineBreak/>`, 작은따옴표, attribute 순서)를
  재현하지 못하면 문자열 비교 test가 깨진다. 원문 slice를 node에 보관해 대응한다.
- **`hp:linesegarray` 무효화**: 줄 배치 cache는 text 변경 뒤 부정확해진다. 지금은 text patch가
  기존 값을 그대로 두고, 표 patch는 새로 만든 빈 cell에서 제거한다. tree 전환은 이 처리를
  그대로 재현하고, 정책 변경은 별도 결정으로 분리한다.
- **undo history 예산**: 구조적 inverse는 subtree 참조를 들고 있어 byte 추정이 달라진다.
  `history.ts`의 추정 함수(`headerMutationBytes` 등)를 tree inverse에 맞게 다시 정의하고,
  기존 한도(100 entry, 8 MiB) 동작을 test로 고정한 뒤 바꾼다.
- **성능**: 큰 section(수만 문단)에서 tree 전체 재구성은 비싸다. 편집 세션 동안 tree를
  유지하고 변경된 entry만 직렬화한다.
- **이중 구현 기간**: 단계별 병행 동안 두 경로가 어긋날 수 있으므로 비교 test를 CI 관문으로 둔다.

## 6. 완료 조건

- `tests/editing/*`의 기존 XML 문자열 단언이 모두 새 serializer 출력으로 그대로 통과한다.
- 편집하지 않은 package의 identity round-trip이 모든 entry에서 byte 단위로 같다.
- `decodeViewerDocument` 왕복 test, `verify:corpus`, `verify:matrix`(편집 + Save As)가 통과한다.
- 문자열 patch 경로(`replaceRange` 기반 planner)와 편집용 두 번째 tokenizer가 제거된다.
- 새 편집 기능 하나를 추가할 때 tree 연산 조합과 capability 규칙만 쓰면 된다.
