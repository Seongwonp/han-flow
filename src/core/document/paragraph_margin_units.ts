/**
 * 문단 모양(`hh:paraPr`)의 여백·들여쓰기(`hh:margin` 안 `hc:intent`·`hc:left`·`hc:right`·`hc:prev`·`hc:next`) 단위 판정.
 *
 * 한/글은 HwpUnitChar namespace를 아는 reader용 `hp:switch/hp:case[@hp:required-namespace=HwpUnitChar]`에는 실제
 * HWPUNIT을, 그 namespace를 모르는 reader용 `hp:default`와 switch 없는 직접 `hh:margin`(HwpUnitChar 이전 저장 방식)에는
 * 같은 값의 2배를 적는다(예: case 1752 / default 3504). 직접 `hh:margin`은 문서 version과 관계없이 2배로 읽는다.
 * 지금까지의 판정도 version을 보지 않았고, 공개 fixture와 실사용 문서(HWPX 1.1 직접 margin, 1.4·1.5 switch)에서 같은
 * 결과다.
 *
 * viewer decoder(읽기)와 style patch(쓰기)가 이 모듈 하나로 각 node의 단위를 **자기 조상 경로**에서 정한다.
 * - 조상 중 HwpUnitChar가 아닌 namespace의 `hp:case`가 있으면 `unknown`: 단위를 알 수 없으므로 읽지 않고, 편집도 거부한다.
 * - 그 밖에 HwpUnitChar `hp:case` 안이면 `hwpunit`(×1).
 * - 그 밖(`hp:default` 안 또는 직접)은 `doubled`(×2).
 * 읽기는 `hwpunit` node를 먼저, 없으면 문서 순서상 첫 `doubled` node를 쓴다.
 */

export const HWP_UNIT_CHAR_NAMESPACE = 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar'

export type ParagraphMetricUnit = 'hwpunit' | 'doubled' | 'unknown'

/** paraPr 바로 아래부터 대상 node의 부모까지(바깥 → 안)의 조상 한 단계. */
export interface ParagraphMetricAncestor {
  name: string
  /** `hp:case`의 `required-namespace` 속성 값(prefix 무관) */
  requiredNamespace?: string
}

/** 속성 map에서 prefix와 관계없이 `required-namespace` 값을 찾는다. */
export function requiredNamespaceOf(attributes: Readonly<Record<string, string>>): string | undefined {
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'required-namespace' || name.endsWith(':required-namespace')) return value
  }
  return undefined
}

const isCase = (name: string): boolean => name === 'hp:case' || name.endsWith(':case')

export function paragraphMetricUnit(ancestors: readonly ParagraphMetricAncestor[]): ParagraphMetricUnit {
  let hwpUnitChar = false
  for (const ancestor of ancestors) {
    if (!isCase(ancestor.name)) continue
    if (ancestor.requiredNamespace !== HWP_UNIT_CHAR_NAMESPACE) return 'unknown'
    hwpUnitChar = true
  }
  return hwpUnitChar ? 'hwpunit' : 'doubled'
}

/** 저장 값 → 실제 HWPUNIT 배율. `unknown`은 undefined. */
export function storedToHwpUnitScale(unit: ParagraphMetricUnit): number | undefined {
  if (unit === 'hwpunit') return 1
  if (unit === 'doubled') return 0.5
  return undefined
}

/** 실제 HWPUNIT → 저장 값 배율. `unknown`은 undefined. */
export function hwpUnitToStoredScale(unit: ParagraphMetricUnit): number | undefined {
  if (unit === 'hwpunit') return 1
  if (unit === 'doubled') return 2
  return undefined
}

export interface ParagraphMetricCandidate<T> {
  node: T
  unit: ParagraphMetricUnit
}

/** viewer가 읽을 node: HwpUnitChar case, 없으면 문서 순서상 첫 2배 node. `unknown`만 있으면 undefined. */
export function preferredParagraphMetric<T>(
  candidates: readonly ParagraphMetricCandidate<T>[]
): ParagraphMetricCandidate<T> | undefined {
  return candidates.find((candidate) => candidate.unit === 'hwpunit') ??
    candidates.find((candidate) => candidate.unit === 'doubled')
}
