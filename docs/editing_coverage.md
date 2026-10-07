# 편집 가능 비율 기준선 (2026-09-29)

실제 한/글 저장본에서 편집기가 얼마나 고칠 수 있는지 재는 도구와 첫 측정 결과입니다.
원본 JSON은 [`editing_coverage_2026-09-29.json`](editing_coverage_2026-09-29.json)(기준선),
[`editing_coverage_2026-09-29-after.json`](editing_coverage_2026-09-29-after.json)(아래 "개선 후")와
[`editing_coverage_2026-10-06.json`](editing_coverage_2026-10-06.json)(아래 "2026-10-06 빈 문단")과
[`editing_coverage_2026-10-07.json`](editing_coverage_2026-10-07.json)(아래 "2026-10-07 개체가 든 문단의 문단 구조", 가장 최근 측정)에 있습니다.
같은 날 앞선 "셀 모양" 측정은 그 변경을 담은 commit의 같은 파일에 있습니다.
다시 재려면 `npm run corpus:editing-coverage -- --output <file>`를 실행합니다(약 6초).

## 측정 방법

- `hwpx_corpus_manifest.json`에서 열리는 fixture마다 편집 세션과 같은 경로
  (`HwpxSourcePackage.open` → `decodeViewerDocument` → `editingCapabilities`)를 거칩니다.
- **textRuns**: section XML 원문의 모든 `hp:t`(표·머리말/꼬리말·글상자·각주·필드 안 포함).
  **anchored**: decoder가 source anchor를 붙인 run. **textEditable**: caret 선택의 `text`
  capability가 열리고 `text_patch`의 anchor 목록(`listHwpxTextAnchors`)에도 있는 run.
- **글자/문단 style·셀 style·표 구조**: capability가 열린 경우 실제 patch 함수
  (`applyCharacterStyleCommand`·`applyParagraphStyleCommand`·`applyCellStyleCommand`·
  `planInsertTableRowAfter`+`planInsertTableColumnAfter`)를 dry-run해 거부 여부를 봅니다.
  같은 구조 서명(본문 글자·lineseg 제외)의 문단/셀은 결과를 재사용합니다.
- **문단 구조**(2026-10-07 추가): 문단의 첫 편집 가능 run caret에서 `paragraphStructure` capability가 열리고
  `planSplitParagraph`(Enter)도 plan을 만들면 편집 가능입니다. capability는 열었는데 코어가 거부하면
  `paragraphStructureMismatch`로 따로 셉니다(UI가 Enter를 받고 오류로 끝나는 경우).
- **표 셀 편집 가능**: 셀에 직접 속한 `hp:t`가 하나 이상이고 모두 textEditable.
- **글자 가중**: 편집 가능 run의 공백 아닌 글자 / 전체 공백 아닌 글자.
- 보고서에는 개수와 고정 사유 code만 들어가고 본문·경로는 들어가지 않습니다(probe test가 확인).

## 합계

| 묶음 | runs | anchored | text 편집 | 글자 가중 | 글자 style | 문단 style | 표 셀 | 표 구조 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 합성 8종 | 19,575 | 100% | 99.9% | 99.97% | 99.7% | 99.6% (19,513/19,583) | 19/29 | 5/7 |
| 외부 한/글 26종 | 371 | 95.7% | 79.5% | 89.3% | 45.0% | 44.8% (178/397) | 45/66 (68.2%) | 13/19 |
| 합성 8종 · 개선 후 | 19,575 | 100% | 99.9% | 99.98% | 99.7% | 99.6% (19,513/19,583) | 29/29 | 5/7 |
| 외부 한/글 26종 · 개선 후 | 371 | 95.7% | 89.8% (333) | 92.8% | 46.9% | 49.4% (196/397) | 49/66 (74.2%) | 13/19 |
| 합성 8종 · 2026-10-06 셀 모양 | 19,575 | 100% | 99.9% | 99.98% | 99.9% | 99.9% (19,556/19,583) | 29/29 | 5/7 |
| 외부 한/글 26종 · 2026-10-06 셀 모양 | 371 | 95.7% | 89.8% (333) | 92.8% | 78.2% (290) | 79.1% (314/397) | 49/66 (74.2%) | 13/19 |
| 합성 8종 · 2026-10-06 빈 문단 | 19,575 | 100% | 99.9% | 99.98% | 99.9% | 99.9% (19,556/19,583) | 29/29 | 5/7 |
| 외부 한/글 26종 · 2026-10-06 빈 문단 | 371 | 95.7% | 89.8% (333) | 92.8% | 78.2% (290) | 90.2% (358/397) | 66/66 (100%) | 13/19 |

합성 합계는 `large-progressive`(19,511 run)가 지배하므로 판단 근거로는 외부 묶음을 씁니다.
외부 26종은 hwpxlib·python-hwpx의 기능별 소형 표본(총 1,147자)이라 실제 공문서 분포와는 다릅니다.

**개선 후**는 아래 "결론"의 1·2번을 반영한 측정입니다(같은 날, 같은 도구).

- 빈 `<hp:t/>` 수정: text 편집 +25 run(모두 본문 container). 빈 run이라 글자 가중은 그대로입니다.
- 표 셀 text 조건 분리: 병합·머리글·여러 run 셀 +13 run·+40자, 표 셀 45 → 49. 셀 style·표 구조는
  구조 조건을 그대로 두어 45·13/19에서 변하지 않습니다. 외부 표 셀 안 `hp:t` 120개가 모두 text 편집 가능해졌고
  남은 표 셀 거부는 `hp:t`가 없는 빈 셀(`NO_TEXT_NODE` 17)뿐입니다.
- 글자·문단 style이 늘어난 것은 새로 열린 빈 본문 run이 style dry-run 대상이 되었기 때문입니다.

## 2026-10-06 — 표 셀 안 글자·문단 모양

- **셀 모양**: 최상위 표의 셀(병합·머리글 셀 포함) `hp:subList` 직속 문단에 글자·문단 모양을 허용했습니다
  (`editing_capability.ts`의 `TABLE_CELL_STRUCTURE` 차단 제거, `style_patch.ts`의 `isStyleEditableParagraph`).
  외부 묶음 글자 style 174 → 290 run(+116), 문단 style 196 → 314 문단(+118)입니다. 셀 run 120개 가운데 4개는
  `hp:ctrl`이 섞인 복합 run이라 본문과 같은 이유(`복합 run`)로 계속 거부되어 그 사유가 39 → 43이 되었습니다.
  text·표 셀·표 구조 수치는 그대로입니다. 셀 안에 다시 든 표와 머리말·꼬리말·글상자 문단은 계속 거부합니다.
- 남은 최대 거부는 `hp:t`가 없는 문단(`NO_TEXT_NODE` 46)과 빈 셀(17)입니다.

## 2026-10-06 — 글자 칸이 없는 빈 문단·셀

- **합성 caret anchor**: `hp:t`가 없는 빈 문단에 `${sectionPath}#hp:p:${paragraphOrdinal}:empty` anchor를 붙입니다
  (`src/core/editing/empty_paragraph_anchor.ts`). `paragraphOrdinal`은 section 안 모든 `hp:p`의 문서 순서 번호이고,
  viewer decoder(`ordered_xml.ts`의 `sourceParagraphOrdinal`)·편집 source tree·tokenizer가 같은 번호를 내는지
  `text_ordinal_agreement.test.ts`가 공개 corpus 전체에서 확인합니다. `#hp:p:`·`:empty` 형식이라 `#hp:t:N`과 겹치지 않습니다.
- **빈 문단 규칙**: 문단 자식이 `hp:run`·`hp:linesegarray`뿐이고 run 자식이 `hp:secPr`·`hp:ctrl`(필드 시작·끝 제외)뿐이면
  빈 문단입니다. 첫 입력은 자식 없는 마지막 run(`<hp:run charPrIDRef="0"/>`), 없으면 마지막 run의 control 뒤에
  `<hp:t>…</hp:t>`를 넣습니다. 한/글(hwpxlib 표본)이 구역 첫 문단 글자를 `hp:secPr`·`hp:ctrl`과 같은 run 뒤쪽에 저장하는
  것을 따랐습니다. run이 없는 `<hp:p/>`(python-hwpx 표본)는 문단 style(`hh:style`)의 `charPrIDRef`로 새 run을 만듭니다.
  실행 취소는 만든 node를 떼고 펼친 자기 닫힘 tag를 되돌려 원래 bytes를 복원하고, transaction이 selection을 새 `#hp:t:N`으로 옮깁니다.
- **수치(외부 26종)**: `hp:t` 없는 문단 46개 가운데 44개가 첫 입력을 받습니다(`noTextParagraphsEditable`). 남은 2개는
  꼬리말(`EMPTY_PARAGRAPH: NOT_LISTED_HEADER_FOOTER`)과 decoder가 읽지 않는 글상자 문단(`NO_TEXT_NODE`)입니다.
  문단 style 314 → 358(79.1% → 90.2%), 표 셀 49 → 66/66(74.2% → 100%)입니다. text·글자 가중·글자 style 수치는 `hp:t` run
  기준이라 그대로입니다. 빈 문단에서는 글자 모양·문단 나눔/병합·셀 style·표 구조를 열지 않고(첫 입력 뒤 일반 anchor로 바뀝니다),
  빈 셀은 text 전용 셀로 둡니다.
- **범위 밖**: 표만 든 문단(합성 8종의 `NO_TEXT_NODE` 8, 외부의 표 옆 `<hp:t/>` 문단 `NOT_LISTED_PARAGRAPH_HAS_TABLE` 19)은
  표와 caret 위치를 함께 다뤄야 해서 이번에 열지 않았습니다.

## 2026-10-07 — 원본 개체 자리 표시(편집 수치 불변)

- decoder가 수식·글상자·도형·각주/미주·메모·덧말 등을 `object-placeholder`로 남기고 글상자·각주·메모 안 글을 읽기 전용
  문단으로 되살리도록 바꾼 뒤 `npm run corpus:editing-coverage`를 다시 쟀습니다. 합계와 fixture별 결과가 변경 전 측정과
  byte 단위로 같습니다(외부 371 run, text 89.8%, 글자 가중 92.8%, 글자 style 78.2%, 문단 style 90.2%, 표 셀 100%).
- 자리 표시는 편집 capability에서 건너뛰므로(`isObjectPlaceholder`) 같은 문단 글자 run의 편집 여부가 그대로이고,
  되살린 글은 source anchor가 없어 편집 대상이 아닙니다. 화면 기준으로는 외부 fixture의 글상자 53자가 다시 보입니다.

## 2026-10-07 — 개체가 든 문단의 문단 구조

- **불일치**: 문단 구조 capability(`editing_capability.ts`)는 개체 자리 표시를 빼고 글자만 보아 Enter·경계 병합·여러 문단
  범위를 열었지만, 편집 코어(`paragraph_patch.ts`)는 run 안에 `hp:t`·`hp:lineBreak`·`hp:tab` 밖의 element(수식·글상자·
  구역 정의·제어 등)가 있으면 거부했습니다. 새 지표로 재면 고치기 전 외부 26종 33문단·합성 3문단에서 capability가 열고 코어가
  거부했습니다(`paragraph_patch: 복합 run이 있는 문단은 아직 나눌 수 없습니다.`).
- **수정**: 판정을 `src/core/editing/paragraph_structure.ts` 하나로 모아 코어와 decoder가 함께 쓰고, decoder가
  `ViewerParagraph.structureBlock`을 채워 capability가 `PARAGRAPH_HAS_OBJECT`(또는 `PARAGRAPH_COMPLEX_RUN`)로 막습니다.
  인접 문단이 막힌 쪽 경계 병합과 그 문단을 가로지르는 여러 문단 범위도 같이 막고, 글자 입력·글자/문단 모양은 그대로 엽니다.
- **수치**: 문단 구조 편집 가능은 외부 270/397·합성 19,580/19,626 그대로이고 불일치가 33·3 → 0입니다. 막힌 문단의 사유는
  `capability: PARAGRAPH_HAS_OBJECT`(외부 33·합성 3)로 바뀌었습니다. 기존 지표(text·글자 가중·글자/문단 style·표 셀·표 구조)는
  변경 전 측정과 같습니다.
- **외부 28종**: 같은 날 OLE·양식 단추 표본(`ext-hwpxlib-ole`·`ext-hwpxlib-buttons`, hwpxlib Apache-2.0)을 개체 검증용으로
  반입한 뒤 다시 쟀습니다(JSON은 이 측정). 두 문서는 빈 `<hp:t/>` run 하나씩만 있어 runs 371 → 373, text 편집 333 → 335,
  문단 397 → 399, 문단 style 358 → 360이고 글자 style은 290 그대로(78.2% → 77.7%), 문단 구조 270/399·불일치 0입니다.

## 외부 fixture category별 (기준선)

| category | 종 | runs | text 편집 | 글자 가중 | 글자 style | 표 셀 | 표 구조 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-column-layout | 1 | 126 | 100% | 100% | 99.2% | - | - |
| table-pagination | 2 | 74 | 94.6% | 100% | 5.4% | 7/7 | 2/2 |
| form-fields | 2 | 41 | 43.9% | 59.8% | 14.6% | 2/3 | 2/3 |
| lists-and-numbering | 3 | 27 | 100% | 100% | 96.3% | - | - |
| table-basic | 1 | 27 | 81.5% | 88.9% | 3.7% | 21/24 | 0/1 |
| table-span | 4 | 22 | 45.5% | 54.4% | 0% | 7/18 | 1/4 |
| paragraph-layout | 1 | 17 | 47.1% | 100% | 0% | 8/8 | 8/8 |
| memos · footnotes-endnotes · inline-shapes | 3 | 19 | 36.8% | 75.5% | 5.3% | - | - |
| document-baseline · page-numbering | 2 | 9 | 77.8% | 100% | 44.4% | - | - |
| header-footer · change-tracking | 2 | 4 | 0% | 0% | 0% | - | - |
| equations · images · ruby-text · page-setup · cell-image-fill | 5 | 5 | 0% | - | 0% | 0/6 | 0/1 |

개선 후 달라진 category(text 편집 · 글자 가중 · 표 셀):
table-span 45.5% → 81.8% · 54.4% → 100% · 7/18 → 10/18, form-fields 43.9% → 78.0% · 59.8% → 75.9% · 2/3 → 3/3,
table-basic 81.5% → 88.9%, table-pagination 94.6% → 97.3%, paragraph-layout 47.1% → 52.9%,
memos 28.6% → 71.4%, footnotes-endnotes 33.3% → 66.7%, document-baseline 83.3% → 100%,
page-numbering 66.7% → 100%, header-footer 0% → 33.3%, equations·ruby-text·page-setup 0% → 100%(빈 run 1개씩).

## 주요 거부 사유 (외부 26종, 기준선)

개선 후 text 단계 거부는 `NOT_LISTED_PARAGRAPH_HAS_TABLE` 19·머리말/꼬리말 2·이미지 문단 1만 남았습니다.

| 단계 · 사유 | 건수 | 잃는 글자 | 발생 위치 |
| --- | ---: | ---: | --- |
| 글자·문단 style `TABLE_CELL_STRUCTURE` | 107·107 | - | `editing_capability.ts:256-262`(표 셀이면 style 차단), `style_patch.ts:125-126`(`hs:sec` 직속 문단만) |
| 문단 style `NO_TEXT_NODE`(빈 `<hp:run/>`·표만 든 문단) | 46 | - | 문단에 `hp:t`가 없어 caret anchor가 없음 |
| text `text_patch: text anchor를 찾을 수 없습니다` | 25 | 0 | `text_patch.ts:197-198` 자기 닫힘 `<hp:t/>`는 anchor를 만들지 않음 |
| 글자 style `복합 run` | 21 | - | `style_patch.ts:135`(첫 run의 `hp:secPr`/`hp:ctrl`, 필드 run) |
| text `NOT_LISTED_PARAGRAPH_HAS_TABLE` | 19 | 0 | `editing_capability.ts:57-64` 문단 전체가 text여야 함(표 옆 빈 `hp:t`) |
| 표 셀 `NO_TEXT_NODE`(빈 셀) | 17 | - | 셀 안 run에 `hp:t`가 없음 |
| anchor `DECODER_SKIPS_TEXT_BOX` | 11 | 53 | `viewer_decoder.ts:37-55` `hp:run` 직속 `hp:t`/`hp:tbl`만 decode |
| text `NOT_LISTED_CELL_MERGED` | 8 | 26 | `editing_capability.ts:88-95` 병합 셀은 text도 차단 |
| text `NOT_LISTED_CELL_PARAGRAPH_MULTI_RUN`·`SIBLING` | 5 | 14 | `editing_capability.ts:72`·`:103-105` 셀 문단은 run 1개만 |
| 기타: 머리말·꼬리말 2(9자), 각주 2(8자), 필드 2(6자), 변경 추적 혼합 1(7자) | 7 | 30 | `listEditingAnchorContexts`·decoder 범위 밖, `viewer_decoder.ts:25-27` |

## 결론 — tree 모델 전환의 첫 단위

1. **(반영됨) capability와 patch가 어긋나는 빈 `<hp:t/>`**: 25개 run은 capability가 text 편집을 허용하지만
   commit 때 `text_patch`가 거부합니다. 표 옆·빈 셀의 입력 칸이라 양식 채우기에 직결되므로,
   자기 닫힘 `hp:t`를 빈 anchor로 인정(필요 시 열린 태그로 확장)하는 수정이 가장 먼저입니다.
2. **(반영됨, 쪽을 넘어 나뉜 셀 조각은 계속 읽기 전용) 글자 기준 최대 단일 해제는 셀 text 조건 분리**: `tableContexts`의 병합·run 1개 조건은
   구조 편집용인데 text 입력까지 막습니다. text용 anchor만 풀면 patch 수정 없이 13 run·40자,
   글자 가중 89.3% → 92.8%, 표 셀 68.2% → 74.2%입니다(시험 적용으로 확인). **첫 해제로 권장**합니다.
3. **(반영됨, 2026-10-06) style은 표 셀 차단 하나가 절반을 막음**: capability와 `locateTextStyleContext`의 `hs:sec`
   조건을 셀 문단으로 넓히면 글자 style 45.0% → 최대 73.9%(+107 run)입니다.
4. **글상자·각주·필드는 decoder 범위 문제**: 글자 기준 최대 손실(글상자 53자)이지만 decoder·
   layout·anchor 모델을 함께 바꿔야 하므로 tree 모델의 "subList 일반화" 단계에서 다룹니다.
   (2026-10-07: 글상자 53자·각주/미주 본문·메모 내용은 화면에 **읽기 전용**으로 되살렸습니다. 편집 anchor는 여전히 없으므로
   이 문서의 편집 수치는 바뀌지 않았고 사유 code도 `DECODER_SKIPS_TEXT_BOX` 등 그대로입니다. 아래 절 참고.)
5. **(반영됨, 2026-10-06, 표만 든 문단 제외) 빈 run·빈 셀(`NO_TEXT_NODE` 46 문단·17 셀)**: caret을 둘 `hp:t`가 없어 입력 자체가 불가합니다.
   tree 모델에서 "빈 run에 text 삽입" 연산을 1급으로 두어야 양식 문서를 채울 수 있습니다.
