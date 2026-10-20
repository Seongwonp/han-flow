/**
 * 문단 구조 command(Enter 분할·경계 병합·여러 문단 범위 치환)가 다룰 수 있는 문단인지 판정하는 공통 규칙.
 *
 * 편집 코어(`paragraph_patch.ts`, 편집 source tree)와 viewer decoder(`viewer_decoder.ts`, ordered XML → capability가 읽는
 * `ViewerParagraph.structureBlock`)가 같은 함수를 쓴다. 두 tree의 node 모양이 달라 접근자만 따로 넘긴다.
 *
 * 규칙(코어의 검사 순서와 오류 message 그대로):
 * 1. 문단 element 자식은 `hp:run`·`hp:linesegarray`뿐이어야 한다.
 * 2. `hp:run`이 하나 이상 있어야 한다.
 * 3. 문단 안 element가 아닌 node는 공백 text뿐이어야 한다.
 * 4. 각 run은 직속 `hp:t`가 정확히 하나이고, 모든 자손 element가 `hp:t`·`hp:lineBreak`·`hp:tab`이어야 한다.
 * 5. run 안 `hp:t` 밖 node는 공백 text뿐이어야 한다.
 *
 * 수식·글상자·그림·표·각주·구역 정의(`hp:secPr`)·`hp:ctrl` 같은 element가 문단이나 run 안에 있으면 `PARAGRAPH_HAS_OBJECT`,
 * 그 밖의 위반(빈 run, `hp:t` 여러 개, 알 수 없는 글 node)은 `PARAGRAPH_COMPLEX_RUN`이다.
 * 주석·CDATA는 viewer XML parser가 버리므로 decoder 쪽에서는 보이지 않는다(코어는 계속 거부한다).
 *
 * 예외(`numberRun`, 2026-10-20): 각주·미주 본문 첫 문단은 한/글이 번호 control(`hp:ctrl/hp:autoNum numType="FOOTNOTE|ENDNOTE"`)과
 * 글자를 첫 run에 함께 둔다. 이 문단만 첫 run의 `hp:t` 앞 번호 control을 받는다(나눔은 번호를 앞 문단에 남긴다).
 */

export const PARAGRAPH_RUN_CONTENT: ReadonlySet<string> = new Set(['hp:t', 'hp:lineBreak', 'hp:tab'])

export type ParagraphStructureBlock = 'PARAGRAPH_HAS_OBJECT' | 'PARAGRAPH_COMPLEX_RUN'

export interface ParagraphStructureViolation {
  block: ParagraphStructureBlock
  /** 코어가 던지는 오류 message(전환 전과 같은 문구) */
  message: string
}

export interface ParagraphStructureAccess<N> {
  /** element이면 이름, 아니면 undefined */
  elementName(node: N): string | undefined
  /** element attribute 값(번호 control의 `numType`을 본다) */
  attribute?(node: N, name: string): string | undefined
  children(node: N): readonly N[]
  /** element가 아닌 node가 공백 text뿐이면 true(주석·CDATA·PI는 false) */
  isBlank(node: N): boolean
}

function hasForeignElement<N>(node: N, access: ParagraphStructureAccess<N>): boolean {
  for (const item of access.children(node)) {
    const name = access.elementName(item)
    if (name === undefined) continue
    if (!PARAGRAPH_RUN_CONTENT.has(name) || hasForeignElement(item, access)) return true
  }
  return false
}

const elementChildren = <N>(node: N, access: Pick<ParagraphStructureAccess<N>, 'elementName' | 'children'>): N[] =>
  access.children(node).filter((item) => access.elementName(item) !== undefined)

/**
 * 각주·미주 번호 control인지: `hp:ctrl` 안에 `hp:autoNum`(numType `FOOTNOTE`·`ENDNOTE`) 하나뿐이고 그 안은 `hp:autoNumFormat`뿐이다.
 * `numType`을 읽을 수 없는 접근자(`attribute` 없음)는 이름만 본다.
 */
export function isNoteNumberControl<N>(
  node: N,
  access: Pick<ParagraphStructureAccess<N>, 'elementName' | 'children'> & { attribute?(node: N, name: string): string | undefined }
): boolean {
  if (access.elementName(node) !== 'hp:ctrl') return false
  const items = elementChildren(node, access)
  if (items.length !== 1 || access.elementName(items[0]) !== 'hp:autoNum') return false
  const numType = access.attribute?.(items[0], 'numType')
  if (access.attribute && numType !== 'FOOTNOTE' && numType !== 'ENDNOTE') return false
  return elementChildren(items[0], access).every((item) => access.elementName(item) === 'hp:autoNumFormat' && !elementChildren(item, access).length)
}

/** run 맨 앞(공백 text 사이)의 번호 control. 번호 control 뒤에 처음 오는 element가 `hp:t`일 때만 돌려준다. */
function leadingNumberControls<N>(run: N, access: ParagraphStructureAccess<N>): N[] {
  const controls: N[] = []
  for (const item of access.children(run)) {
    const name = access.elementName(item)
    if (name === undefined) {
      if (access.isBlank(item)) continue
      return []
    }
    if (isNoteNumberControl(item, access)) {
      controls.push(item)
      continue
    }
    return name === 'hp:t' ? controls : []
  }
  return []
}

export interface ParagraphStructureOptions {
  /** 각주·미주 본문 첫 문단: 첫 run의 `hp:t` 앞 번호 control을 받는다. */
  numberRun?: boolean
}

/** 문단 구조 command가 거부할 이유. 통과하면 undefined. */
export function paragraphStructureViolation<N>(
  paragraph: N,
  access: ParagraphStructureAccess<N>,
  options: ParagraphStructureOptions = {}
): ParagraphStructureViolation | undefined {
  const items = access.children(paragraph)
  const elements = items.filter((item) => access.elementName(item) !== undefined)
  if (elements.some((item) => access.elementName(item) !== 'hp:run' && access.elementName(item) !== 'hp:linesegarray')) {
    return { block: 'PARAGRAPH_HAS_OBJECT', message: '제어·표·도형이 섞인 문단은 아직 나눌 수 없습니다.' }
  }
  const runs = elements.filter((item) => access.elementName(item) === 'hp:run')
  if (!runs.length) return { block: 'PARAGRAPH_COMPLEX_RUN', message: '텍스트 run이 없는 문단은 나눌 수 없습니다.' }
  if (items.some((item) => access.elementName(item) === undefined && !access.isBlank(item))) {
    return { block: 'PARAGRAPH_COMPLEX_RUN', message: '알 수 없는 문단 콘텐츠가 있어 나눌 수 없습니다.' }
  }
  for (const [index, run] of runs.entries()) {
    const numberControls = options.numberRun && index === 0 ? leadingNumberControls(run, access) : []
    const runItems = access.children(run).filter((item) => !numberControls.includes(item))
    const directTexts = runItems.filter((item) => access.elementName(item) === 'hp:t')
    const foreign = runItems.some((item) => {
      const name = access.elementName(item)
      return name !== undefined && (!PARAGRAPH_RUN_CONTENT.has(name) || hasForeignElement(item, access))
    })
    if (directTexts.length !== 1 || foreign) {
      return {
        block: foreign ? 'PARAGRAPH_HAS_OBJECT' : 'PARAGRAPH_COMPLEX_RUN',
        message: '복합 run이 있는 문단은 아직 나눌 수 없습니다.'
      }
    }
    if (runItems.some((item) => item !== directTexts[0] && !access.isBlank(item))) {
      return { block: 'PARAGRAPH_COMPLEX_RUN', message: '알 수 없는 run 콘텐츠가 있어 나눌 수 없습니다.' }
    }
  }
  return undefined
}

/** 글자만 든 subList(글상자 글·메모 본문)가 가질 수 있는 element. viewer decoder와 편집 코어가 같은 규칙을 쓴다. */
export const PLAIN_SUBLIST_ELEMENTS: ReadonlySet<string> = new Set([
  'hp:p', 'hp:run', 'hp:t', 'hp:lineBreak', 'hp:tab', 'hp:linesegarray', 'hp:lineseg'
])

/**
 * subList가 글자만 든 문단으로 되어 있는지(`PLAIN_SUBLIST_ELEMENTS`). `allowNotes`면(글상자 글) 글자만 든 각주·미주
 * (`hp:ctrl` 안 `hp:footNote`·`hp:endNote` 하나 이상, 그 `hp:subList`도 글자와 첫 문단 번호 control뿐)도 받는다. 표·그림·도형·
 * 수식·필드·그 밖의 제어가 하나라도 있으면 false다.
 */
export function isPlainSubList<N>(
  subList: N,
  access: Pick<ParagraphStructureAccess<N>, 'elementName' | 'children'> & { attribute?(node: N, name: string): string | undefined },
  allowNotes = false
): boolean {
  const plain = (node: N, inNote: boolean): boolean => elementChildren(node, access).every((item) => {
    const name = access.elementName(item)!
    if (PLAIN_SUBLIST_ELEMENTS.has(name)) return plain(item, inNote)
    if (name !== 'hp:ctrl') return false
    if (inNote) return isNoteNumberControl(item, access)
    if (!allowNotes) return false
    const notes = elementChildren(item, access)
    return notes.length > 0 && notes.every((note) => {
      const noteName = access.elementName(note)
      const parts = elementChildren(note, access)
      return (noteName === 'hp:footNote' || noteName === 'hp:endNote') &&
        parts.length === 1 && access.elementName(parts[0]) === 'hp:subList' && plain(parts[0], true)
    })
  })
  return plain(subList, false)
}
