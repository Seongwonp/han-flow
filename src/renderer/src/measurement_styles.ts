import type { ViewerCharStyle, ViewerDocument } from '../../core/document/viewer_document'
import {
  styleChangeIds,
  VIEWER_STYLE_MAP_NAMES,
  type ViewerDocumentPatch,
  type ViewerStyleIds
} from '../../core/document/viewer_document_patch'
import type { FontResolution } from '../../core/fonts/font_resolver'

/**
 * 문단·표·개체를 그릴 때 문서에서 읽는 값(측정·조판 입력). 문서 object 대신 이것만 넘겨, 편집 patch가 section만 바꿨을 때는 같은
 * object가 유지되어 memo한 section 측정 DOM이 다시 그려지지 않게 한다. `charStyles`의 글꼴 이름은 이 컴퓨터에서 찾은 글꼴이다.
 */
export type ViewerRenderStyles = Pick<ViewerDocument, 'page' | 'charStyles' | 'paraStyles' | 'cellStyles' | 'resources'>

/**
 * 글꼴 이름을 이 컴퓨터에서 찾은 글꼴로 바꾼 글자 모양. 원본 style object와 바꾼 글꼴 이름이 그대로인 id는 앞 결과 object를
 * 그대로 써서, 편집 patch가 바꾼 id만 새 object가 되게 한다(`MeasurementStylesTracker`가 id별 object로 바뀐 id를 가린다).
 */
export function resolveCharStyles(
  charStyles: ViewerDocument['charStyles'],
  fontResolutions: Record<string, FontResolution>,
  cache: WeakMap<ViewerCharStyle, ViewerCharStyle>
): ViewerDocument['charStyles'] {
  return Object.fromEntries(Object.entries(charStyles).map(([id, style]) => {
    const fontFamily = style.fontFamily ? fontResolutions[style.fontFamily]?.resolved ?? style.fontFamily : undefined
    const cached = cache.get(style)
    if (cached && cached.fontFamily === fontFamily) return [id, cached]
    const resolved = { ...style, fontFamily }
    cache.set(style, resolved)
    return [id, resolved]
  }))
}

/**
 * 측정값을 다시 쓸 수 있는 style 묶음의 표지(`key`). 편집 patch가 바꾼 style definition(`styleChanges`)은 그 id를 쓰는
 * section이 모두 새 object가 되므로(`restyledSections`) 표지를 그대로 두고 나머지 section 측정값을 다시 쓴다. 쪽 크기·resource가
 * 바뀌거나, patch가 알리지 않은 id의 style object가 바뀌면(글꼴 찾기 결과, 글꼴 목록이 바뀐 patch의 style map 전체) 새 표지를
 * 만들어 모든 section을 다시 잰다.
 */
export class MeasurementStylesTracker {
  private current?: { styles: ViewerRenderStyles; key: object }
  private attributed: ViewerStyleIds | 'all' = emptyIds()

  /** 적용한 편집 patch의 style 변경을 기억한다(다음 `keyFor`까지 여러 patch가 쌓일 수 있다). */
  notePatch(patch: Pick<ViewerDocumentPatch, 'styles' | 'styleChanges'>): void {
    if (this.attributed === 'all') return
    if (patch.styles) {
      this.attributed = 'all'
      return
    }
    const ids = styleChangeIds(patch.styleChanges)
    for (const name of VIEWER_STYLE_MAP_NAMES) for (const id of ids[name]) this.attributed[name].add(id)
  }

  /** 전체 문서로 바뀌었다(열기·편집 시작·refresh). 다음 표지는 새로 만든다. */
  reset(): void {
    this.current = undefined
    this.attributed = emptyIds()
  }

  keyFor(styles: ViewerRenderStyles): object {
    const current = this.current
    const attributed = this.attributed
    this.attributed = emptyIds()
    const key = current && compatibleStyles(current.styles, styles, attributed) ? current.key : {}
    this.current = { styles, key }
    return key
  }
}

function emptyIds(): ViewerStyleIds {
  return { charStyles: new Set(), paraStyles: new Set(), cellStyles: new Set() }
}

function compatibleStyles(previous: ViewerRenderStyles, next: ViewerRenderStyles, attributed: ViewerStyleIds | 'all'): boolean {
  if (previous === next) return true
  if (attributed === 'all' || previous.page !== next.page || previous.resources !== next.resources) return false
  return VIEWER_STYLE_MAP_NAMES.every((name) => {
    const before: Record<string, unknown> = previous[name]
    const after: Record<string, unknown> = next[name]
    if (before === after) return true
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[id] !== after[id] && !attributed[name].has(id)) return false
    }
    return true
  })
}
