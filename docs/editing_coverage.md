# 편집 가능 비율 기준선 (2026-09-29)

실제 한/글 저장본에서 편집기가 얼마나 고칠 수 있는지 재는 도구와 첫 측정 결과입니다.
원본 JSON은 [`editing_coverage_2026-09-29.json`](editing_coverage_2026-09-29.json)에 있습니다.
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
- **표 셀 편집 가능**: 셀에 직접 속한 `hp:t`가 하나 이상이고 모두 textEditable.
- **글자 가중**: 편집 가능 run의 공백 아닌 글자 / 전체 공백 아닌 글자.
- 보고서에는 개수와 고정 사유 code만 들어가고 본문·경로는 들어가지 않습니다(probe test가 확인).

## 합계

| 묶음 | runs | anchored | text 편집 | 글자 가중 | 글자 style | 문단 style | 표 셀 | 표 구조 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 합성 8종 | 19,575 | 100% | 99.9% | 99.97% | 99.7% | 99.6% (19,513/19,583) | 19/29 | 5/7 |
| 외부 한/글 26종 | 371 | 95.7% | 79.5% | 89.3% | 45.0% | 44.8% (178/397) | 45/66 (68.2%) | 13/19 |

합성 합계는 `large-progressive`(19,511 run)가 지배하므로 판단 근거로는 외부 묶음을 씁니다.
외부 26종은 hwpxlib·python-hwpx의 기능별 소형 표본(총 1,147자)이라 실제 공문서 분포와는 다릅니다.

## 외부 fixture category별

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

## 주요 거부 사유 (외부 26종)

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

1. **capability와 patch가 어긋나는 빈 `<hp:t/>`**: 25개 run은 capability가 text 편집을 허용하지만
   commit 때 `text_patch`가 거부합니다. 표 옆·빈 셀의 입력 칸이라 양식 채우기에 직결되므로,
   자기 닫힘 `hp:t`를 빈 anchor로 인정(필요 시 열린 태그로 확장)하는 수정이 가장 먼저입니다.
2. **글자 기준 최대 단일 해제는 셀 text 조건 분리**: `tableContexts`의 병합·run 1개 조건은
   구조 편집용인데 text 입력까지 막습니다. text용 anchor만 풀면 patch 수정 없이 13 run·40자,
   글자 가중 89.3% → 92.8%, 표 셀 68.2% → 74.2%입니다(시험 적용으로 확인). **첫 해제로 권장**합니다.
3. **style은 표 셀 차단 하나가 절반을 막음**: capability와 `locateTextStyleContext`의 `hs:sec`
   조건을 셀 문단으로 넓히면 글자 style 45.0% → 최대 73.9%(+107 run)입니다.
4. **글상자·각주·필드는 decoder 범위 문제**: 글자 기준 최대 손실(글상자 53자)이지만 decoder·
   layout·anchor 모델을 함께 바꿔야 하므로 tree 모델의 "subList 일반화" 단계에서 다룹니다.
5. **빈 run·빈 셀(`NO_TEXT_NODE` 46 문단·17 셀)**: caret을 둘 `hp:t`가 없어 입력 자체가 불가합니다.
   tree 모델에서 "빈 run에 text 삽입" 연산을 1급으로 두어야 양식 문서를 채울 수 있습니다.
