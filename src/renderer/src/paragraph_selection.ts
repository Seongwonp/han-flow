import { EditorSelection } from '../../core/editing/selection'

const SOURCE_NODE_ATTRIBUTE = 'data-source-text-node-id'
const RANGE_SCOPE_ATTRIBUTE = 'data-editor-range-scope'

export interface ParagraphEditorSurface {
  textNodeId: string
  textLength: number
  rangeScope: string
}

export function paragraphEditorRangeScope(
  sectionPath: string,
  paragraphId: string,
  allowParagraphRange: boolean
): string {
  return allowParagraphRange
    ? `${sectionPath}:top-level`
    : `${sectionPath}:paragraph:${paragraphId}`
}

export function moveParagraphEditorSelection(
  surfaces: readonly ParagraphEditorSurface[],
  currentTextNodeId: string,
  direction: 'previous' | 'next',
  selection: EditorSelection,
  extend: boolean
): EditorSelection | undefined {
  const current = surfaces.find((surface) => surface.textNodeId === currentTextNodeId)
  if (!current) return undefined
  const scoped = surfaces.filter((surface) => surface.rangeScope === current.rangeScope)
  const currentIndex = scoped.findIndex((surface) => surface.textNodeId === currentTextNodeId)
  const target = scoped[currentIndex + (direction === 'previous' ? -1 : 1)]
  if (!target) return undefined
  const targetOffset = direction === 'previous' ? target.textLength : 0
  return extend
    ? {
        ...selection,
        focusTextNodeId: target.textNodeId,
        focusOffset: targetOffset
      }
    : {
        sectionPath: selection.sectionPath,
        anchorTextNodeId: target.textNodeId,
        anchorOffset: targetOffset,
        focusTextNodeId: target.textNodeId,
        focusOffset: targetOffset
      }
}

function sourceSurface(paragraph: HTMLElement, node: Node | null): HTMLElement | undefined {
  if (!node) return undefined
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const surface = element?.closest<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`)
  return surface && paragraph.contains(surface) ? surface : undefined
}

function textOffset(surface: HTMLElement, node: Node, nodeOffset: number): number {
  const range = globalThis.document.createRange()
  range.selectNodeContents(surface)
  const boundary = node.nodeType === Node.TEXT_NODE
    ? node.textContent?.length ?? 0
    : node.childNodes.length
  range.setEnd(node, Math.max(0, Math.min(nodeOffset, boundary)))
  return range.toString().length
}

function textPosition(surface: HTMLElement, requestedOffset: number): [Node, number] {
  const offset = Math.max(0, Math.min(requestedOffset, surface.textContent?.length ?? 0))
  const walker = globalThis.document.createTreeWalker(surface, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return [node, remaining]
    remaining -= length
    node = walker.nextNode()
  }
  const text = globalThis.document.createTextNode('')
  surface.append(text)
  return [text, 0]
}

export function readParagraphEditorSelection(
  host: HTMLElement,
  sectionPath: string,
  rangeScope?: string
): EditorSelection | undefined {
  const nativeSelection = globalThis.getSelection()
  if (!nativeSelection?.anchorNode || !nativeSelection.focusNode) return undefined
  const anchorSurface = sourceSurface(host, nativeSelection.anchorNode)
  const focusSurface = sourceSurface(host, nativeSelection.focusNode)
  const anchorTextNodeId = anchorSurface?.dataset.sourceTextNodeId
  const focusTextNodeId = focusSurface?.dataset.sourceTextNodeId
  if (!anchorSurface || !focusSurface || !anchorTextNodeId || !focusTextNodeId) return undefined
  const anchorScope = anchorSurface.dataset.editorRangeScope
  const focusScope = focusSurface.dataset.editorRangeScope
  if (!anchorScope || anchorScope !== focusScope || (rangeScope && anchorScope !== rangeScope)) {
    return undefined
  }
  return {
    sectionPath,
    anchorTextNodeId,
    anchorOffset: textOffset(anchorSurface, nativeSelection.anchorNode, nativeSelection.anchorOffset),
    focusTextNodeId,
    focusOffset: textOffset(focusSurface, nativeSelection.focusNode, nativeSelection.focusOffset)
  }
}

export function restoreParagraphEditorSelection(
  host: HTMLElement,
  selection: EditorSelection
): boolean {
  const surfaces = [...host.querySelectorAll<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`)]
  const anchorSurface = surfaces.find(
    (surface) => surface.dataset.sourceTextNodeId === selection.anchorTextNodeId
  )
  const focusSurface = surfaces.find(
    (surface) => surface.dataset.sourceTextNodeId === selection.focusTextNodeId
  )
  const nativeSelection = globalThis.getSelection()
  if (!anchorSurface || !focusSurface || !nativeSelection) return false
  if (
    !anchorSurface.matches(`[${RANGE_SCOPE_ATTRIBUTE}]`) ||
    anchorSurface.dataset.editorRangeScope !== focusSurface.dataset.editorRangeScope
  ) return false
  const [anchorNode, anchorOffset] = textPosition(anchorSurface, selection.anchorOffset)
  const [focusNode, focusOffset] = textPosition(focusSurface, selection.focusOffset)
  focusSurface.focus({ preventScroll: true })
  nativeSelection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
  return true
}

export function paragraphEditorSurfaces(host: HTMLElement): ParagraphEditorSurface[] {
  return [...host.querySelectorAll<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}][${RANGE_SCOPE_ATTRIBUTE}]`)]
    .flatMap((surface) => {
      const textNodeId = surface.dataset.sourceTextNodeId
      const rangeScope = surface.dataset.editorRangeScope
      return textNodeId && rangeScope
        ? [{ textNodeId, rangeScope, textLength: surface.textContent?.length ?? 0 }]
        : []
    })
}
