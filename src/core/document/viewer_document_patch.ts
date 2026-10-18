import type { ViewerDiagnostic, ViewerDocument, ViewerSection } from './viewer_document'

/** header.xml에서 오는 style map. 글꼴 목록이 바뀌는 등 바뀐 id를 section에 돌릴 수 없을 때만 통째로 patch에 담는다. */
export type ViewerStyleMaps = Pick<ViewerDocument, 'fonts' | 'charStyles' | 'paraStyles' | 'cellStyles'>

/** section이 화면에서 찾아 쓰는 style id. */
export type ViewerStyleMapName = 'charStyles' | 'paraStyles' | 'cellStyles'
export const VIEWER_STYLE_MAP_NAMES: readonly ViewerStyleMapName[] = ['charStyles', 'paraStyles', 'cellStyles']

/**
 * header.xml의 글자·문단·셀 모양 definition 가운데 바뀐 것만. 값이 null이면 그 id가 없어졌다(실행 취소가 더했던 definition을 지움).
 * 글꼴 목록(`fonts`)은 그대로일 때만 이 형태로 보낸다.
 */
export type ViewerStyleChanges = {
  [Name in ViewerStyleMapName]: Record<string, ViewerDocument[Name][string] | null>
}

export type ViewerStyleIds = Record<ViewerStyleMapName, Set<string>>

const STYLE_REFERENCE_KEYS: Record<string, ViewerStyleMapName> = {
  charStyleId: 'charStyles',
  paraStyleId: 'paraStyles',
  borderFillId: 'cellStyles'
}
const sectionStyleIdCache = new WeakMap<ViewerSection, ViewerStyleIds>()

/**
 * section이 참조하는 style id(본문·표 셀·머리말·꼬리말·각주·미주 문단의 `charStyleId`·`paraStyleId`, 셀의 `borderFillId`).
 * 화면은 이 id로만 style map을 찾으므로 여기 없는 id의 definition이 바뀌어도 이 section의 측정·쪽 나눔은 그대로다.
 * section object는 바꾸지 않으므로 object마다 한 번만 센다.
 */
export function sectionStyleIds(section: ViewerSection): ViewerStyleIds {
  let ids = sectionStyleIdCache.get(section)
  if (ids) return ids
  const found: ViewerStyleIds = { charStyles: new Set(), paraStyles: new Set(), cellStyles: new Set() }
  const stack: unknown[] = [section]
  while (stack.length) {
    const value = stack.pop()
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === 'object') stack.push(item)
      continue
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item && typeof item === 'object') stack.push(item)
      else if (typeof item === 'string' && key in STYLE_REFERENCE_KEYS) found[STYLE_REFERENCE_KEYS[key]].add(item)
    }
  }
  ids = found
  sectionStyleIdCache.set(section, ids)
  return ids
}

/** 바뀐 style definition id. `styleChanges`가 없으면 빈 집합이다. */
export function styleChangeIds(changes: ViewerStyleChanges | undefined): ViewerStyleIds {
  return {
    charStyles: new Set(Object.keys(changes?.charStyles ?? {})),
    paraStyles: new Set(Object.keys(changes?.paraStyles ?? {})),
    cellStyles: new Set(Object.keys(changes?.cellStyles ?? {}))
  }
}

export function referencesStyleIds(section: ViewerSection, ids: ViewerStyleIds): boolean {
  const used = sectionStyleIds(section)
  return VIEWER_STYLE_MAP_NAMES.some((name) => {
    for (const id of ids[name]) if (used[name].has(id)) return true
    return false
  })
}

function mergeStyleMap<T>(map: Record<string, T>, changes: Record<string, T | null> | undefined): Record<string, T> {
  const entries = Object.entries(changes ?? {})
  if (!entries.length) return map
  const next = { ...map }
  for (const [id, style] of entries) {
    if (style === null) delete next[id]
    else next[id] = style
  }
  return next
}

/**
 * 편집 projection 증분. 바로 앞 projection(`baseProjectionId`)에 적용하면 새 projection(`projectionId`)과 같은 문서가 된다.
 * 바뀌지 않은 section·style map·쪽 크기·그림 resource는 앞 문서의 object를 그대로 쓴다(React memo가 건너뛰도록).
 */
export interface ViewerDocumentPatch {
  baseProjectionId: number
  projectionId: number
  /** 새 문서의 section 수. 앞 문서와 다르면 patch로 만들지 않는다(전체 문서를 보낸다). */
  sectionCount: number
  sections: Array<{ index: number; section: ViewerSection }>
  /** 글꼴 목록이 바뀌어 바뀐 id를 section에 돌릴 수 없을 때의 style map 전체. renderer는 모든 section을 다시 잰다. */
  styles?: ViewerStyleMaps
  /**
   * 바뀐 글자·문단·셀 모양 definition만(`styles`와 함께 오지 않는다). 바뀌지 않은 id의 style object는 앞 문서 것을 그대로 쓴다.
   */
  styleChanges?: ViewerStyleChanges
  /**
   * `sections`에 없지만 `styleChanges`의 id를 참조하는 section 위치. 해석 결과는 그대로라 보내지 않고, renderer가 그 section
   * object만 새로 만들어(얕은 복사) 측정·쪽 나눔 cache가 그 section만 다시 하게 한다.
   */
  restyledSections?: number[]
  /** 문서 전체 진단(작다). section 진단이 바뀔 수 있어 항상 통째로 보낸다. */
  diagnostics: ViewerDiagnostic[]
}

export class ViewerDocumentPatchMismatchError extends Error {
  readonly code = 'VIEWER_DOCUMENT_PATCH_MISMATCH'
}

/** `document`에 patch를 불변 방식으로 적용한다. 바뀐 section만 새 object가 되고 나머지는 그대로 공유한다. */
export function applyViewerDocumentPatch(document: ViewerDocument, patch: ViewerDocumentPatch): ViewerDocument {
  if (document.sections.length !== patch.sectionCount) {
    throw new ViewerDocumentPatchMismatchError('편집 projection section 수가 현재 문서와 다릅니다.')
  }
  const sections = document.sections.slice()
  for (const { index, section } of patch.sections) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= sections.length) {
      throw new ViewerDocumentPatchMismatchError('편집 projection section 위치가 현재 문서와 맞지 않습니다.')
    }
    sections[index] = section
  }
  const patched = new Set(patch.sections.map(({ index }) => index))
  for (const index of patch.restyledSections ?? []) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= sections.length) {
      throw new ViewerDocumentPatchMismatchError('편집 projection style 영향 section 위치가 현재 문서와 맞지 않습니다.')
    }
    if (!patched.has(index)) sections[index] = { ...sections[index] }
  }
  return {
    page: document.page,
    fonts: patch.styles?.fonts ?? document.fonts,
    charStyles: patch.styles?.charStyles ?? mergeStyleMap(document.charStyles, patch.styleChanges?.charStyles),
    paraStyles: patch.styles?.paraStyles ?? mergeStyleMap(document.paraStyles, patch.styleChanges?.paraStyles),
    cellStyles: patch.styles?.cellStyles ?? mergeStyleMap(document.cellStyles, patch.styleChanges?.cellStyles),
    resources: document.resources,
    sections,
    diagnostics: patch.diagnostics
  }
}

/**
 * renderer가 받은 편집 projection patch를 지금 보이는 문서에 적용한다. 문서가 없거나 patch 기준(`baseProjectionId`)이 지금
 * projection과 다르거나(앞 응답을 놓침) section 수·위치가 맞지 않으면({@link ViewerDocumentPatchMismatchError}) undefined를
 * 돌려준다. 이때 호출자는 patch를 버리고 worker에서 전체 문서를 받아(refresh) 다시 맞춘다. 그 밖의 오류는 그대로 던진다.
 */
export function applyViewerDocumentPatchIfCurrent(
  document: ViewerDocument | null | undefined,
  projectionId: number | null | undefined,
  patch: ViewerDocumentPatch
): ViewerDocument | undefined {
  if (!document || projectionId !== patch.baseProjectionId) return undefined
  try {
    return applyViewerDocumentPatch(document, patch)
  } catch (reason) {
    if (reason instanceof ViewerDocumentPatchMismatchError) return undefined
    throw reason
  }
}
