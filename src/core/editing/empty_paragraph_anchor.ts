/**
 * 글자 칸(`hp:t`)이 없는 빈 문단의 합성 caret anchor.
 *
 * 한/글은 빈 문단·빈 셀을 `<hp:run charPrIDRef="0"/>`, 구역 정의만 든 run(`hp:secPr`·`hp:ctrl`), 또는 run이 아예
 * 없는 `<hp:p .../>`로 저장한다. 여기에는 caret을 둘 `hp:t`가 없으므로 viewer decoder와 편집 코어가 같은 규칙으로
 * 문단 하나에 합성 anchor `${sectionPath}#hp:p:${paragraphOrdinal}:empty`를 붙이고, 첫 입력 때 `hp:t`를 만든다.
 *
 * - `paragraphOrdinal`은 section XML 안 모든 `hp:p`(표 셀·머리말·글상자 안 포함)의 문서 순서(여는 tag 순서) 번호다.
 *   viewer decoder(`ordered_xml.ts`의 `sourceParagraphOrdinal`)와 편집 source tree(`findSourceElements`)가 같은
 *   번호를 낸다(`tests/parser/text_ordinal_agreement.test.ts`).
 * - `#hp:p:` 접두사와 `:empty` 접미사 때문에 `hp:t` anchor(`#hp:t:N`)와 겹칠 수 없다.
 * - 첫 입력이 `hp:t`를 만들면 문단은 더 이상 빈 문단이 아니므로 이 id는 사라지고, transaction이 selection을 새
 *   `#hp:t:N` anchor로 옮긴다. 실행 취소로 `hp:t`가 사라지면 같은 id가 다시 생긴다.
 *
 * 이 module은 renderer도 쓰므로 순수 함수만 둔다.
 */

const EMPTY_PARAGRAPH_ANCHOR = /^(.*)#hp:p:(0|[1-9]\d*):empty$/

/** 빈 문단에서 캐럿 위치로 허용하는 run 자식. 이 밖의 자식(표·그림·글상자 등)이 있으면 빈 문단이 아니다. */
export const EMPTY_PARAGRAPH_RUN_CONTROLS: ReadonlySet<string> = new Set(['hp:secPr', 'hp:ctrl'])

/** `hp:ctrl` 안에 있으면 글자를 뒤에 붙였을 때 필드 안·밖이 모호해지므로 빈 문단으로 보지 않는 control. */
export const EMPTY_PARAGRAPH_BLOCKING_CONTROLS: ReadonlySet<string> = new Set(['hp:fieldBegin', 'hp:fieldEnd'])

export function emptyParagraphAnchorId(sectionPath: string, paragraphOrdinal: number): string {
  return `${sectionPath}#hp:p:${paragraphOrdinal}:empty`
}

/** 합성 빈 문단 anchor id를 읽는다. 형식이 다르면 undefined. */
export function parseEmptyParagraphAnchorId(
  textNodeId: string
): { sectionPath: string; paragraphOrdinal: number } | undefined {
  const match = EMPTY_PARAGRAPH_ANCHOR.exec(textNodeId)
  if (!match) return undefined
  const paragraphOrdinal = Number(match[2])
  return Number.isSafeInteger(paragraphOrdinal) ? { sectionPath: match[1], paragraphOrdinal } : undefined
}

export function isEmptyParagraphAnchorId(textNodeId: string | undefined): boolean {
  return textNodeId !== undefined && parseEmptyParagraphAnchorId(textNodeId) !== undefined
}
