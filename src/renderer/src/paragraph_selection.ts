import { EditorSelection } from '../../core/editing/selection'

const SOURCE_NODE_ATTRIBUTE = 'data-source-text-node-id'

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
  paragraph: HTMLElement,
  sectionPath: string
): EditorSelection | undefined {
  const nativeSelection = globalThis.getSelection()
  if (!nativeSelection?.anchorNode || !nativeSelection.focusNode) return undefined
  const anchorSurface = sourceSurface(paragraph, nativeSelection.anchorNode)
  const focusSurface = sourceSurface(paragraph, nativeSelection.focusNode)
  const anchorTextNodeId = anchorSurface?.dataset.sourceTextNodeId
  const focusTextNodeId = focusSurface?.dataset.sourceTextNodeId
  if (!anchorSurface || !focusSurface || !anchorTextNodeId || !focusTextNodeId) return undefined
  return {
    sectionPath,
    anchorTextNodeId,
    anchorOffset: textOffset(anchorSurface, nativeSelection.anchorNode, nativeSelection.anchorOffset),
    focusTextNodeId,
    focusOffset: textOffset(focusSurface, nativeSelection.focusNode, nativeSelection.focusOffset)
  }
}

export function restoreParagraphEditorSelection(
  paragraph: HTMLElement,
  selection: EditorSelection
): boolean {
  const surfaces = [...paragraph.querySelectorAll<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`)]
  const anchorSurface = surfaces.find(
    (surface) => surface.dataset.sourceTextNodeId === selection.anchorTextNodeId
  )
  const focusSurface = surfaces.find(
    (surface) => surface.dataset.sourceTextNodeId === selection.focusTextNodeId
  )
  const nativeSelection = globalThis.getSelection()
  if (!anchorSurface || !focusSurface || !nativeSelection) return false
  const [anchorNode, anchorOffset] = textPosition(anchorSurface, selection.anchorOffset)
  const [focusNode, focusOffset] = textPosition(focusSurface, selection.focusOffset)
  focusSurface.focus({ preventScroll: true })
  nativeSelection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
  return true
}
