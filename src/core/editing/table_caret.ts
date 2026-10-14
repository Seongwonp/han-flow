/**
 * 표만 든 최상위 문단(표 anchor 문단)의 표 앞·뒤 caret 규칙.
 *
 * 한/글은 본문에 표를 넣으면 표를 문단 하나의 run 자식(`hp:run > hp:tbl`)으로 저장하고, 그 문단에는 글자가 없거나
 * 표 뒤에 빈 `<hp:t/>`만 둔다. 이런 문단에서 표 앞·뒤에 글을 쓰면 같은 run 안에서 표 앞(또는 뒤)에 `hp:t`가 생긴다
 * (`<hp:run><hp:t>앞</hp:t><hp:tbl>…</hp:tbl><hp:t>뒤</hp:t></hp:run>`). 편집 코어(`text_patch.ts`, source tree)와
 * viewer decoder(`viewer_decoder.ts`, ordered XML)가 같은 함수로 같은 판정을 내리도록 node 접근자만 따로 받는다.
 *
 * 규칙:
 * 1. `hs:sec` 직속 문단이다(호출하는 쪽이 확인한다). 표 셀·머리말·글상자 안 문단은 대상이 아니다.
 * 2. 문단 자식은 `hp:run`·`hp:linesegarray`와 공백 text뿐이다.
 * 3. run 자식은 `hp:tbl`·`hp:t`·구역/쪽 정의(`hp:secPr`·`hp:ctrl`·run에 바로 둔 머리말·꼬리말 등)와 공백 text뿐이고,
 *    `hp:tbl`은 문단 전체에 정확히 하나다. 각주·미주·필드가 든 `hp:ctrl`이 있으면 글자 위치가 모호하므로 대상이 아니다.
 * 4. 표보다 앞에 `hp:t`가 없으면 표 앞 caret(`before`), 표보다 뒤에 `hp:t`가 없으면 표 뒤 caret(`after`)을 연다. 이미
 *    `hp:t`가 있는 쪽은 그 `hp:t`의 일반 anchor로 편집한다(빈 `<hp:t/>`도 일반 anchor다).
 *
 * 문단 나눔·병합은 표가 든 문단이라 계속 막는다(`paragraph_structure.ts`의 `PARAGRAPH_HAS_OBJECT`).
 * 이 module은 renderer도 쓸 수 있도록 순수 함수만 둔다.
 */

export interface TableCaretAccess<N> {
  /** element이면 이름, 아니면 undefined */
  elementName(node: N): string | undefined
  children(node: N): readonly N[]
  /** element가 아닌 node가 공백 text뿐이면 true */
  isBlank(node: N): boolean
}

export interface TableCaretTarget<N> {
  /** 표가 든 run */
  run: N
  table: N
  /** 표 앞에 `hp:t`가 없어 합성 caret을 연다. */
  before: boolean
  /** 표 뒤에 `hp:t`가 없어 합성 caret을 연다. */
  after: boolean
}

/** run에 둘 수 있는 구역·쪽 정의(글자 위치와 무관한 제어). 보통 `hp:ctrl` 안에 있지만 run에 바로 두는 생성기도 있다. */
export const TABLE_CARET_RUN_CONTROLS: ReadonlySet<string> = new Set([
  'hp:secPr',
  'hp:ctrl',
  'hp:header',
  'hp:footer',
  'hp:colPr',
  'hp:pageNum',
  'hp:pageNumCtrl',
  'hp:pageHiding',
  'hp:newNum'
])

/** `hp:ctrl` 안에 있으면 표 앞·뒤 글자 위치가 각주 번호·필드 범위와 얽히므로 대상에서 빼는 control. */
export const TABLE_CARET_BLOCKING_CONTROLS: ReadonlySet<string> = new Set([
  'hp:footNote',
  'hp:endNote',
  'hp:fieldBegin',
  'hp:fieldEnd'
])

function containsBlockingControl<N>(node: N, access: TableCaretAccess<N>): boolean {
  for (const item of access.children(node)) {
    const name = access.elementName(item)
    if (name === undefined) continue
    if (TABLE_CARET_BLOCKING_CONTROLS.has(name) || containsBlockingControl(item, access)) return true
  }
  return false
}

/** 표 anchor 문단이면 표 run·표와 열 수 있는 caret 쪽을 돌려준다. 아니면 undefined. */
export function tableCaretTarget<N>(paragraph: N, access: TableCaretAccess<N>): TableCaretTarget<N> | undefined {
  let found: { run: N; table: N } | undefined
  let textBefore = false
  let textAfter = false
  for (const item of access.children(paragraph)) {
    const name = access.elementName(item)
    if (name === undefined) {
      if (!access.isBlank(item)) return undefined
      continue
    }
    if (name === 'hp:linesegarray') continue
    if (name !== 'hp:run') return undefined
    for (const runItem of access.children(item)) {
      const runItemName = access.elementName(runItem)
      if (runItemName === undefined) {
        if (!access.isBlank(runItem)) return undefined
        continue
      }
      if (runItemName === 'hp:tbl') {
        if (found) return undefined
        found = { run: item, table: runItem }
      } else if (runItemName === 'hp:t') {
        if (found) textAfter = true
        else textBefore = true
      } else if (!TABLE_CARET_RUN_CONTROLS.has(runItemName)) {
        return undefined
      } else if (runItemName === 'hp:ctrl' && containsBlockingControl(runItem, access)) {
        return undefined
      }
    }
  }
  return found ? { ...found, before: !textBefore, after: !textAfter } : undefined
}
