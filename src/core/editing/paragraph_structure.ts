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

/** 문단 구조 command가 거부할 이유. 통과하면 undefined. */
export function paragraphStructureViolation<N>(
  paragraph: N,
  access: ParagraphStructureAccess<N>
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
  for (const run of runs) {
    const runItems = access.children(run)
    const directTexts = runItems.filter((item) => access.elementName(item) === 'hp:t')
    const foreign = hasForeignElement(run, access)
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
