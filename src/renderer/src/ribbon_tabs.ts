/** 리본 탭. 한/글·Office 순서를 따르되 지금 있는 control만 담는다. */
export const RIBBON_TABS = ['파일', '편집', '서식', '표', '보기'] as const

export type RibbonTab = typeof RIBBON_TABS[number]

/** 편집 중에만 쓸 수 있는 control을 담은 탭. */
const EDITING_ONLY_TABS: ReadonlySet<RibbonTab> = new Set(['서식', '표'])

export function isRibbonTab(value: unknown): value is RibbonTab {
  return typeof value === 'string' && (RIBBON_TABS as readonly string[]).includes(value)
}

/** 창을 처음 열었을 때의 탭. 편집 중이면 `서식`, 아니면 `파일`. */
export function initialRibbonTab(editing: boolean): RibbonTab {
  return editing ? '서식' : '파일'
}

/**
 * 편집 시작·종료 때 고를 탭. 사용자가 고른 탭은 그 밖의 경우 그대로 둔다.
 * - 편집을 시작하면 `서식`으로 옮긴다(가장 자주 쓰는 control).
 * - 편집이 끝났는데 편집 전용 탭(`서식`·`표`)에 있으면 `파일`로 돌아간다.
 * 표 안에 caret이 들어가도 탭을 바꾸지 않는다(대신 `표` 탭에 표시만 한다).
 */
export function ribbonTabAfterEditingChange(
  current: RibbonTab,
  wasEditing: boolean,
  isEditing: boolean
): RibbonTab {
  if (!wasEditing && isEditing) return '서식'
  if (wasEditing && !isEditing && EDITING_ONLY_TABS.has(current)) return '파일'
  return current
}

/**
 * WAI-ARIA tabs 패턴의 화살표 키 이동. ←/→는 순환하고 Home/End는 처음·마지막 탭으로 간다.
 * 탭 이동 키가 아니면 `undefined`.
 */
export function ribbonTabFromKey(current: RibbonTab, key: string): RibbonTab | undefined {
  const index = RIBBON_TABS.indexOf(current)
  if (key === 'ArrowRight') return RIBBON_TABS[(index + 1) % RIBBON_TABS.length]
  if (key === 'ArrowLeft') return RIBBON_TABS[(index - 1 + RIBBON_TABS.length) % RIBBON_TABS.length]
  if (key === 'Home') return RIBBON_TABS[0]
  if (key === 'End') return RIBBON_TABS[RIBBON_TABS.length - 1]
  return undefined
}
