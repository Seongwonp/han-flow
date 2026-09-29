# 편집 코어 tree 모델 전환 계획

상태: 진행 중 — XML scanner 통합(`src/core/editing/xml_scan.ts`)과 tree 전환 1단계(text)·2단계(style)·3단계(paragraph) 완료, 4단계(table) 미착수

실제 한/글 문서 편집 가능 비율 기준선과 우선 해제 순서: [편집 가능 비율 기준선](editing_coverage.md)

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

## 4-1. 1단계 완료 (text, 2026-09-29)

**옮긴 것**

- `src/core/editing/source_tree.ts`: section·header XML을 element·text·comment·PI·CDATA·선언 node로 읽는
  lossless tree. node마다 원문 범위(`start`/`openEnd`/`closeStart`/`end`)와 dirty 표시를 두고, serializer는
  dirty가 아닌 연속 형제를 원문 한 구간으로 복사하고 dirty node만 다시 쓴다. 편집하지 않은 tree는 입력과
  byte 단위로 같다. 자기 닫힘 펼치기(`replaceElementChildren`)·되돌리기(`collapseElementToSelfClosing`)가
  tree 연산이다. text node는 entity를 원문 표기로 들고 `decodeXmlEntities`로만 해석한다.
- tokenizer는 새로 만들지 않았다. `xml_scan.ts`에 token 단위 iterator(`iterateXmlTokens`)를 추가하고
  `scanXmlElements`와 source tree가 함께 쓴다(오류 message·CDATA 방식은 그대로).
- tree attribute는 따옴표를 인식해 다른 값 안의 `name="..."`·`>`·줄바꿈이 든 값을 정확히 나누고, 읽을 때
  entity를 해석하고 쓸 때 escape한다(`parseTagAttributes`·`readTagAttribute`·`writeTagAttribute`·
  `setSourceAttribute`). 기존 정규식 `attribute`/`setAttribute`는 아직 옮기지 않은 모듈을 위해 남겼다.
- `text_patch.ts`: `listHwpxTextOrdinals`·`listHwpxTextAnchors`·`applyReplaceTextCommand`가 tree에서
  `hp:t`를 ordinal로 찾아 자식 node를 바꾸고 직렬화한다. `<hp:t/>` 펼치기·`restoreSelfClosingTag` 복원,
  `hp:lineBreak`/`hp:tab` 혼합 콘텐츠 규칙, command·inverse 모양과 오류 code·message는 그대로다.
  `range_edit.ts`·`composition_input.ts`·`transaction.ts`·`history.ts`·`editing_session.ts`는 바꾸지 않았다.
- tree cache: package 객체(불변, revision과 bytes가 고정)별로 section tree·`hp:t` 목록·anchor 목록을
  보관한다. text command는 tree를 제자리에서 고친 뒤 cache를 새 package로 옮기므로 연속 입력과 selection 검증이
  section을 다시 parse하지 않는다. 다른 command가 만든 package에는 cache가 없어 첫 조회 때 다시 parse한다.
  anchor 목록은 고정(frozen) 배열로 돌려준다.
- 비교 oracle: 전환 전 문자열 구현을 `text_patch_legacy.ts`(internal, test 전용)로 보존했다.

**측정**

- identity: 열리는 공개 fixture 34종의 section 114개와 header 34개, 148 entry가 parse → serialize 뒤
  byte 단위로 같다(`tests/editing/text_tree_differential.test.ts`).
- differential: fixture마다 최대 40개(+빈 `<hp:t/>` 최대 16개) anchor, 총 362 anchor(자기 닫힘 펼치기 46)에
  처음·가운데·끝 삽입, 범위 삭제, `&`·`<`·`>`·따옴표·surrogate pair·tab·줄바꿈·CR 치환, 전체 삭제를 차례로
  2,896회 적용하고 inverse 2,896회로 되돌렸다. 매 단계 section bytes·revision·inverse·anchor·loss report가
  전환 전 경로와 같고, 되돌린 section은 원래 bytes(`<hp:t/>` 포함)와 같다. `hp:tab`·비표준 entity·CRLF·
  편집 불가 형제(CDATA·사용자 entity·comment)를 섞은 손 작성 section도 두 경로가 같다.
- 교차 parser: viewer decoder·source tree·전환 전 tokenizer의 `hp:t` ordinal과 편집 가능 anchor가 34종 전체에서 같다.
- keystroke 비용(`HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/text_edit_benchmark.test.ts`,
  large-progressive의 가장 큰 section 47,305 bytes·anchor 250개 가운데 run에 500자 입력, anchor 조회 → command →
  anchor 조회): 전환 전 평균 4.11ms(p50 3.82·p95 5.94) → 전환 후 1.16ms(p50 1.05·p95 1.87).
  `HwpxEditHistory.commit` 전체 경로는 1.24ms(p50 1.05·p95 1.80). 남은 비용은 새 section bytes 생성과
  `withEntry`의 CRC 계산이다.
- `npm run corpus:editing-coverage` 결과는 `editing_coverage_2026-09-29-after.json`과 같다(기능 변화 없음).

**differential이 드러낸 전환 전 경로의 버그 — 고침(2026-09-29)**

- 전환 전 경로는 편집한 `hp:t`의 내용을 논리 text에서 다시 써서, attribute가 있는 `<hp:tab width=".." leader=".." type=".."/>`을
  `&#9;`로 바꿔 탭 폭·채움 정보를 잃고, `&#x41;`·`&apos;`·원문 CR/LF 같은 비표준 표기를 기본 escape
  (`A`·`'`·`&#13;<hp:lineBreak/>`)로 바꿨다. 내용이 같은 빈 편집(`from = to`, `insert = ''`)도 마찬가지였고, undo는 원래 내용이
  기본 표기일 때만 원문 bytes로 돌아왔다. 최소 재현: `<hp:t>탭<hp:tab width="3112" leader="0" type="1"/>뒤&#x41;&apos;&#13;&gt;</hp:t>`에
  `from=0,to=0,insert=''` → `<hp:t>탭&#9;뒤A'&#13;&gt;</hp:t>`.
- **고침**: tree 경로가 `hp:t`의 자식 가운데 편집 범위에 걸친 text node만 바꾼다. 범위 밖 text의 원문 표기, inline `hp:tab`(attribute
  포함)·`hp:lineBreak`, 원문 CR/LF는 byte 그대로이고, 경계에 걸친 text node는 entity 경계에서 원문을 잘라 앞뒤 조각을 남긴다.
  빈 편집은 입력과 같은 bytes다. 새로 넣는 text는 전과 같이 기본 escape(`\t` → `&#9;`, `\n` → `<hp:lineBreak/>`)이고, 범위 안의
  `hp:tab`·`hp:lineBreak` element는 지운다. 지운 범위가 기본 표기가 아니면 inverse가 그 원문 표기를 `insertSource`(선택 field,
  history byte 예산에 포함)로 들고 가 undo가 모든 경우 원래 bytes를 복원한다. `insertSource`는 text와 자기 닫힘
  `hp:lineBreak`/`hp:tab`만 받고 해석한 논리 text가 `insert`와 다르면 거부한다.
- differential은 편집 전 `hp:t` 내용이 기본 표기인 단계에서만 전환 전 경로와 bytes·inverse가 같음을 단언한다. 공개 corpus 362 anchor
  2,896 편집은 모두 기본 표기라 전부 같고, 손 작성 section 5 anchor 40 편집 가운데 기본 표기가 아닌 10 편집만 달라지며(undo는 모두
  원래 bytes), 34종 전체의 편집 가능 anchor 19,945개에 처음·가운데·끝 빈 편집을 적용해도 section bytes가 그대로다
  (`tests/editing/text_inline_preservation.test.ts`, `text_tree_differential.test.ts`).
- 남은 것: 문단 분할·병합(`paragraph_patch.ts`)은 3단계 전까지 `rewriteHwpxTextElement`로 논리 text에서 다시 쓰므로 그 경로의
  `hp:t`는 여전히 기본 표기로 바뀐다. → 3단계에서 고침(4-3 참고).

**남은 것 (2단계: style)** — 2026-09-29 완료, 아래 4-2 참고.

## 4-2. 2단계 완료 (style, 2026-09-29)

**옮긴 것**

- `style_patch.ts`(글자: 굵게·기울임·밑줄·취소선·크기·색·한글 글꼴, 문단: 정렬·줄 간격·앞뒤 간격·첫 줄 들여쓰기)와
  `cell_style_patch.ts`(셀 배경·사방 테두리)가 section·header.xml source tree에서 동작한다. anchor의 `hp:t`에서 부모를 따라
  `hp:run`·`hp:p`(최상위 문단·단일 run 조건 포함)·`hp:subList`→`hp:tc`를 찾고, `cellSpan`·`header` 검사도 tree attribute로 한다.
- `charPrIDRef`·`paraPrIDRef`·`borderFillIDRef`와 collection `itemCnt`는 따옴표를 인식하는 `writeTagAttribute`·
  `setSourceAttribute`로 바꾼다. 새 definition은 원본 `hh:charPr`·`hh:paraPr`·`hh:borderFill`을 조각 tree로 복제해 자식 추가·삭제
  (OWPML 순서의 다음 형제 앞, 없으면 끝)와 attribute 변경으로 고친 뒤 collection 끝에 node로 붙인다(`parseSourceFragment`).
  같은 definition 재사용, 결정적 ID, `itemCnt` 규칙(글자·문단은 있을 때만 definition 수 + 1, 셀은 `itemCnt` + 1)은 그대로다.
- 부분 선택 run 분할은 run node를 좌·선택·우 run 조각으로 교체하고 그 section의 `hp:t` 색인만 버린다(다음 조회가 다시 parse하지
  않고 tree에서 새로 만든다). 전환 전과 같게 reference 변경과 분할을 서로 다른 revision으로 쓴다.
- inverse(`restore-style`·`restore-character-run`·`restore-cell-style`)의 모양, 저장하는 tag·조각 원문, 오류 code·message,
  capability 판단(viewer 모델 기준)은 그대로다. 복원도 tree 연산이다: reference tag는 `setElementOpenTag`로 원문 그대로 되돌리고,
  header 조각 제거는 collection 끝 node들의 원문이 조각과 byte 단위로 같을 때만(셀은 조각과 같은 직계 `hh:borderFill`) 뗀다.
- tree 연산 추가(`source_tree.ts`): `spliceSourceChildren`·`replaceSourceNode`·`setElementOpenTag`·`parseSourceFragment`·
  `findFirstSourceElement`·`findDescendantSourceElements`·`nearestSourceAncestor`·`rawTextOffset`.
- cache를 package 전체로 넓혔다(`package_trees.ts`): package 객체별로 entry 경로 → source tree를 두고 section과 header.xml을 같이
  보관한다. tree를 고치는 command(text·글자·문단·셀 모양)는 cache를 떼어 낸 뒤 고치고 새 package로 옮긴다. `hp:t` 색인은 tree별
  (`WeakMap`)로 따라간다. definition 비교 표기도 element별로 cache해 연속 모양 변경이 definition 전체를 다시 비교하지 않는다.
  header.xml이 UTF-8이 아니면 전환 전처럼 손실 있는 문자열로 고치지 않고 거부한다.
- 비교 oracle: 전환 전 문자열 구현을 `style_patch_legacy.ts`·`cell_style_patch_legacy.ts`(internal, test 전용)로 보존했다.
  `text_patch_legacy.ts`와 그 tokenizer는 삭제했다. 1단계 뒤 text 비교는 기본 표기 hp:t에서만 의미가 있으므로, text differential의
  oracle을 전환 전 경로의 명세(`scanXmlElements`로 찾은 hp:t 전체를 기본 표기로 다시 쓴 section, test 안의 짧은 함수)로 바꿔 유지했다.
  교차 parser test의 세 번째 참여자는 `scanXmlElements`다.

**측정**

- style differential(`tests/editing/style_tree_differential.test.ts`): 34종의 편집 가능 anchor 전체(같은 문단을 반복한 synthetic
  large-progressive 19,511개만 40개를 고르게 뽑음), 474 anchor × 글자 모양 5~7종(굵게 켜기·끄기, 기울임+밑줄, 취소선+크기+색,
  한글 글꼴, 부분 선택 굵게·기울임) + 문단 모양 2종(가운데 정렬, 줄 간격+앞뒤 간격+들여쓰기) + 셀 모양 2종(배경, 테두리 색·두께·종류)
  = 4,782 command. 거부 2,739건은 두 경로의 오류 종류·message가 같고, 변화 없음 331건, 변경 1,712건(글자 965·문단 570·셀 177,
  header definition 추가 1,696, run 분할 125)은 section·header bytes·revision·inverse·loss report가 같으며, undo 1,712회·redo
  1,712회도 두 경로가 같고 undo는 원래 bytes로 돌아온다. 새 경로는 되돌린 package를 다음 command에 이어 써서 cache hit와 주기적
  cache miss를 함께 거친다. run 분할 뒤 tree에서 다시 만든 anchor는 새 parse와 같다.
- text differential(명세 oracle): 2,936 편집 가운데 기본 표기 2,926회가 명세와 bytes·inverse가 같고, 손 작성 section의 비기본 표기
  10회만 원문 보존으로 다르다. 빈 편집 19,945 anchor byte identity, identity round-trip 148/148 entry는 그대로다.
- 글자 모양 toggle 비용(`HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/style_toggle_benchmark.test.ts`,
  large-progressive의 가장 큰 section 47,305 bytes·anchor 250개 가운데 run의 굵게를 200번 연속 켜고 끔, anchor 조회 → command →
  anchor 조회): 전환 전 평균 6.29ms(p50 6.17·p95 8.44) → 전환 후 1.51ms(p50 1.42·p95 2.43). `HwpxEditHistory.commit` 전체 경로는
  1.22ms(p50 1.07·p95 2.01). 남은 비용은 section bytes 생성과 `withEntry`의 CRC 계산이다.
- `npm run corpus:editing-coverage` 결과는 `editing_coverage_2026-09-29-after.json`과 같다(기능 변화 없음).

**differential이 드러낸 전환 전 경로의 잠재 버그(공개 corpus에는 없음, 새 경로 동작을 test로 고정)**

- 다른 attribute 값 안의 이름을 읽음: `<hp:run data="x charPrIDRef='7'" charPrIDRef="0">`에 굵게 해제 → 전환 전은 data 값 안의
  `'7'`을 reference로 읽어 "hh:charPr reference를 찾을 수 없습니다: 7"로 거부. 새 경로는 `charPrIDRef="1"`로 바꾸고 data는 그대로.
  같은 종류로 `<hp:tc note="x header='1'" ... header="0">`의 배경색은 전환 전이 머리글 셀로 오판해 거부했다.
- 줄바꿈이 든 attribute 값: `<hh:charPr id="0" ... textColor="#12␊3456">`에 글자색 → 전환 전은 값을 못 찾아 복제 definition에
  `textColor="#12␊3456" textColor="#ABCDEF"`(중복 attribute, 잘못된 XML)를 썼다. 새 경로는 제자리에서 바꾼다.
- 부분 선택 run 분할의 entity 표기: `<hp:t>앞&#x41;&apos;뒤</hp:t>`의 [1, 3)에 굵게 해제 → 전환 전은 가운데 조각을 `<hp:t>A'</hp:t>`로
  다시 썼다(1단계 text 버그와 같은 종류). 새 경로는 원문 조각 `&#x41;&apos;`를 그대로 쓴다. 공개 corpus의 분할은 모두 기본 표기라
  bytes가 같다.
- 코드상 차이(corpus 미해당): 정규식이 자기 닫힘 형태만 찾던 `hh:align`·`hc:intent`/`prev`/`next`는 형태와 무관하게 첫 element를
  찾고, `id`·`itemCnt`를 읽을 때 entity를 해석한다.

**남은 것 (3단계: paragraph, 그다음 4단계: table)** — 3단계는 2026-09-29 완료, 아래 4-3 참고.

- 문단 분할·병합·여러 문단 범위 치환(`paragraph_patch.ts`, `range_edit.ts`의 여러 문단 경로)을 tree 연산(`spliceSourceChildren`·
  `parseSourceFragment`)으로 옮긴다. 지금은 `rewriteHwpxTextElement`로 논리 text에서 다시 쓰므로 분할·병합된 `hp:t`의 inline
  `hp:tab` attribute·entity 표기가 기본 표기로 바뀐다. `hp:linesegarray` 처리 정책을 이 단계에서 확정한다. 문단 differential을
  만들면 `style_patch_legacy.ts`·`cell_style_patch_legacy.ts`를 삭제한다.
- 4단계에서 표(`table_patch.ts`) 행·열 추가/삭제·병합·분할과 topology whitelist를 tree 검사로 옮기고, 정규식 `attribute`/`setAttribute`와
  `replaceRange` 기반 planner를 제거한다. 문단·표 command가 만든 package에는 아직 tree cache가 없어 첫 조회 때 다시 parse한다.

## 4-3. 3단계 완료 (paragraph, 2026-09-29)

**옮긴 것**

- `paragraph_patch.ts`의 문단 분할(Enter, 선택 범위가 있으면 지우고 나눔)·경계 병합(문단 맨 앞 Backspace·맨 끝 Delete)·여러 문단
  범위 치환(최상위 section과 일반 표 body cell 하나 안)과 `range_edit.ts`가 넘기는 여러 문단 경로(`selectionSpansParagraphs`·
  `planReplaceParagraphSelection`)가 section source tree에서 동작한다. anchor의 `hp:t` element에서 부모를 따라 `hp:run`·`hp:p`·
  범위(`hs:sec`, `hp:subList`→`hp:tc`와 `hp:cellSpan`)를 찾고, 단순 문단 검사(`hp:run`·`hp:linesegarray`만, run마다 `hp:t` 하나와 공백)·
  인접 문단·문단 사이 콘텐츠 검사·새 문단 ID 계산(`id`·`pageBreak`·`columnBreak`는 `readTagAttribute`·`writeTagAttribute`)도 tree에서 한다.
- 교체 fragment는 손대지 않는 run·문단을 node의 현재 원문 표기로 쓰고, 분할·치환 경계의 `hp:t`는 `splitHwpxTextContent`(`text_patch.ts`)로
  원문을 논리 offset에서 잘라 남긴다(text node는 entity 경계에서 자르고, inline `hp:tab`·`hp:lineBreak` element는 통째로 앞 또는 뒤
  조각에 속하며 offset 위치의 control은 뒤 조각). 새로 넣는 text만 전과 같이 기본 escape다. `rewriteHwpxTextElement`는 삭제했다.
- 적용(`applyReplaceParagraphFragmentCommand`)은 `textNodeId`가 든 문단부터 이어지는 형제 node의 원문이 `expectedFragment`와 node
  경계에서 정확히 같을 때 그 node들을 `replacementFragment` 조각 tree(`parseSourceFragment`)로 바꾸고(`spliceSourceChildren`), 그
  section의 `hp:t` 색인만 버린 뒤 tree cache를 새 package로 옮긴다. 문단 command가 만든 package도 이제 cache가 있어 다음 조회가 다시
  parse하지 않는다. `hp:t` element → ordinal 조회(`hwpxTextOrdinal`)는 색인별 Map으로 한 번만 만든다.
- command·inverse 모양(`replace-paragraph-fragment`의 `expectedFragment`/`replacementFragment`), 오류 종류·code·message와 검사 순서,
  selection 결과(`selectionAfter`·`affectedTextNodeIds`), capability 판단은 그대로다. inverse는 전과 같이 바뀌기 전 fragment bytes를
  그대로 들고 있으므로 원래 bytes를 언제나 복원하고, history byte 예산 계산(두 fragment 길이)도 그대로다. 새 carriage는 필요 없었다.
- 비교 oracle: 전환 전 문자열 구현을 `paragraph_patch_legacy.ts`(internal, test 전용, `rewriteHwpxTextElement` 사본 포함)로 보존했다.
  `style_patch_legacy.ts`·`cell_style_patch_legacy.ts`는 style differential이 계속 쓰므로 4단계 뒤 함께 지운다.

**`hp:linesegarray` 정책(확정, 전환 전과 같음)**

- 분할·병합·범위 치환으로 새로 만든 문단(분할의 두 문단, 병합·치환 결과 문단)에는 `hp:linesegarray`를 쓰지 않는다. 줄 배치 cache는
  text·run 구성이 바뀌면 틀리므로 지워서 무효화하고, 한/글이 열 때 다시 계산한다. 새로 만든 문단은 `hp:run`만 이어 쓰므로 원래 문단
  자식 사이·run 안 `hp:t` 앞뒤의 공백 text도 쓰지 않는다(공개 corpus에는 없음). 영향받지 않은 문단의 `hp:linesegarray`는 그대로다.
- 한 문단 안 text 편집(`replace-text`)은 기존 값을 그대로 두고, 표 patch는 새로 만든 빈 cell에서 제거하는 정책도 그대로다.
- 실행 취소는 원래 fragment와 함께 `hp:linesegarray`를 되살린다.

**측정**

- 문단 differential(`tests/editing/paragraph_tree_differential.test.ts`): 34종의 편집 가능한 문단(anchor를 가장 가까운 `hp:p`로 묶음,
  synthetic large-progressive만 40개를 고르게 뽑음) 454개에 Enter(문단 처음·가운데·끝), 맨 앞 Backspace, 맨 끝 Delete,
  2·3문단에 걸친 범위 치환 × 삽입 3종(빈 text·일반 text·줄바꿈 포함)을 적용해 4,715 command. 거부 1,554건은 두 경로의 오류 종류·
  code·message가 같고, 적용 3,161건(분할 1,053·병합 536·범위 치환 1,572)은 계획(fragment·selection·affected anchor)·section bytes·
  revision·inverse·loss report가 전부 같다(공개 corpus의 경계 `hp:t`는 모두 기본 표기). 모든 적용에서 inverse가 원래 bytes를, 그
  inverse가 결과 bytes를 되살린다(undo 3,161·redo 3,161). 새 경로는 되돌린 package를 다음 command에 이어 써서 cache hit과 주기적
  cache miss를 함께 거치고, tree에서 다시 만든 anchor 색인은 새 parse와 같다.
- 손 작성 section(attribute 있는 `hp:tab`, `<hp:tab/>`, `&#x41;`·`&apos;`·`&#13;`, 원문 CR/LF, `<hp:t/>`): 46 command 가운데 거부 2,
  적용 44건 중 27건은 전환 전과 bytes가 같고 17건은 전환 전 결과에서 경계 `hp:t` 내용만 원문 조각으로 바뀐 것과 정확히 같다.
- 분할 뒤 병합 identity: 34종의 편집 가능한 모든 문단 19,925개(이 가운데 단순 문단이 아니라 분할을 거부한 110개 제외, 19,815개)에
  가운데 Enter → 새 문단 맨 앞 Backspace를 적용한 결과가 원래 section에서 (1) 그 문단의 `hp:linesegarray` 제거(19,806개 문단에
  있었음)와 (2) 대상 run이 같은 run·`hp:t` tag의 두 run으로 나뉘고 원래 `hp:t` 내용 원문이 가운데 offset에서 두 조각으로 잘린 것만
  다르고 나머지 bytes가 같다. 병합은 run을 합치지 않는다(전환 전과 같음 — 합치면 병합 뒤 selection이 가리키는 `hp:t`가 사라진다).
- identity round-trip 148/148 entry, text·style differential은 그대로다.
- Enter+Backspace 비용(`HAN_FLOW_BENCHMARK=1 npx jest --runInBand tests/performance/paragraph_split_merge_benchmark.test.ts`,
  large-progressive의 가장 큰 section 47,305 bytes·anchor 250개 가운데 문단에서 가운데 Enter와 새 문단 맨 앞 Backspace 200쌍, 한 쌍 =
  plan → 적용 → anchor 조회 두 번): 전환 전 평균 18.93ms(p50 18.28·p95 26.92) → 전환 후 5.37ms(p50 4.22·p95 12.42).
  `HwpxEditHistory.commit` 전체 경로는 4.52ms(p50 4.27·p95 7.16). 남은 비용은 section bytes 생성, `withEntry`의 JS CRC 계산(이 경로
  CPU 시간의 약 절반), 문단 command마다 `hp:t` 색인을 tree에서 다시 만드는 것이다.
- `npm run corpus:editing-coverage` 결과는 `editing_coverage_2026-09-29-after.json`과 같다(기능 변화 없음).

**전환 전 경로와 다른 동작**

- 경계 `hp:t` 원문 보존(의도한 수정): 최소 재현 `<hp:t>앞<hp:tab width="3112" leader="0" type="1"/>뒤&#x41;</hp:t>`의 offset 1에서
  Enter → 전환 전 둘째 문단 `<hp:t>&#9;뒤A</hp:t>`(tab 폭·채움 attribute와 entity 표기 손실), 새 경로 `<hp:t><hp:tab width="3112"
  leader="0" type="1"/>뒤&#x41;</hp:t>`. 범위 치환 `가<tab/>나<tab/>다`[3, …) ~ `라<tab/>마&apos;`[…, 2)에 `새\t글` → 전환 전
  `가&#9;나새&#9;글`·`마'`, 새 경로 `가<hp:tab …/>나새&#9;글`·`마&apos;`. 병합은 전환 전에도 run 원문을 그대로 이어 붙였으므로 같다.
- fragment 적용 조건(손으로 만든 command에만 해당): 전환 전은 문단 시작부터 `expectedFragment` 길이만큼의 원문 prefix만 비교했으므로
  fragment가 node 경계 중간에서 끝나도 적용했고, `replacementFragment`가 잘못된 XML이어도 그대로 썼다. 새 경로는 형제 node 경계와
  정확히 맞을 때만 적용하고(아니면 같은 "문단 fragment가 변경되어" 충돌), 교체 fragment가 올바른 XML이 아니면
  "문단 fragment가 올바른 XML이 아니어서 command를 적용할 수 없습니다."로 거부한다. planner가 만든 command와 inverse는 언제나 조건을 만족한다.
- 코드상 차이(corpus 미해당): `id`·`pageBreak`·`columnBreak`·`header`·`rowSpan`·`colSpan`을 따옴표를 인식해 읽고 entity를 해석한다(2단계와
  같은 종류). 문단 순서 비교는 원문 offset 대신 tree 위치로 한다.

**남은 것 (4단계: table, 그다음 정리)**

- 표(`table_patch.ts`) 행·열 추가/삭제, 셀 병합·분할과 topology whitelist를 tree 연산·tree 검사로 옮긴다. `colCnt`/`rowCnt`/`colAddr`
  재계산을 tree 위 함수로 만들고, 표 command가 만든 package에도 tree cache를 잇는다.
- 그 뒤 정규식 `attribute`/`setAttribute`·`replaceRange`·`nearestAncestor`·`targetOrdinal` 등 `scanXmlElements` 기반 helper와
  legacy 파일(`style_patch_legacy.ts`·`cell_style_patch_legacy.ts`·`paragraph_patch_legacy.ts`)과 그 differential의 legacy 비교를 삭제한다
  (differential은 명세 oracle로 바꿔 유지).

## 5. 위험

- **공백·entity 충실도**: fast-xml-parser는 entity를 해석하고 공백·따옴표 표기를 잃는다.
  dirty node를 다시 쓸 때 원문 표기(`&#10;` 대 `<hp:lineBreak/>`, 작은따옴표, attribute 순서)를
  재현하지 못하면 문자열 비교 test가 깨진다. 원문 slice를 node에 보관해 대응한다.
- **`hp:linesegarray` 무효화**: 줄 배치 cache는 text 변경 뒤 부정확해진다. 지금은 text patch가
  기존 값을 그대로 두고, 문단 patch는 새로 만든 문단에서, 표 patch는 새로 만든 빈 cell에서 제거한다
  (3단계에서 확정, 4-3 참고). 정책 변경은 별도 결정으로 분리한다.
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
