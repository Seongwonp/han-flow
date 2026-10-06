/** 편집 E2E probe가 다루는 입력 surface의 최소 형태(DOM element 또는 테스트용 객체). */
export interface ProbeSurface {
  dataset: { sourceTextNodeId?: string }
  textContent: string | null
  contains(node: unknown): boolean
}

/**
 * 편집 E2E probe가 입력한 surface를 projection 뒤에 다시 찾는다.
 *
 * 글자 칸 없는 빈 문단의 합성 anchor(`#hp:p:N:empty`)는 첫 입력이 `hp:t`를 만들면 사라지고, 편집 코어가
 * selection을 새 `#hp:t:M` anchor로 옮긴다(`src/core/editing/empty_paragraph_anchor.ts`). 이때 같은 id로만
 * 찾으면 영원히 찾지 못하므로, 같은 section의 `hp:t` surface 가운데 기대한 글자를 담고 현재 selection(caret)을
 * 가진 surface를 고른다. caret이 새 anchor에 없으면 renderer의 selection 복원이 틀린 것이므로 찾지 않는다.
 *
 * `index.ts`가 함수 원문을 renderer probe에 그대로 넣으므로 바깥 이름을 참조하지 않는 순수 함수로 둔다.
 */
export function findProjectedSurface<T extends ProbeSurface>(
  surfaces: readonly T[],
  anchorId: string,
  expectedText: string,
  selectionNode: unknown
): T | undefined {
  const exact = surfaces.find((surface) => surface.dataset.sourceTextNodeId === anchorId)
  if (exact) return exact.textContent === expectedText ? exact : undefined
  const emptyAnchor = /^(.*)#hp:p:(0|[1-9]\d*):empty$/.exec(anchorId)
  if (!emptyAnchor || selectionNode === null || selectionNode === undefined) return undefined
  const textPrefix = emptyAnchor[1] + '#hp:t:'
  return surfaces.find((surface) =>
    (surface.dataset.sourceTextNodeId ?? '').startsWith(textPrefix) &&
    surface.textContent === expectedText &&
    surface.contains(selectionNode)
  )
}
