import { CSSProperties, useEffect, useLayoutEffect, useRef } from 'react'
import {
  CompositionInputController,
  TextCommitIntent,
  TextSelection
} from '../../core/editing/composition_input'
import { ViewerSourceAnchor } from '../../core/document/viewer_document'

interface ParagraphInputSurfaceProps {
  text: string
  sourceAnchor: ViewerSourceAnchor
  style?: CSSProperties
  pending: boolean
  desiredSelection?: TextSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
}

function textSelection(element: HTMLElement): TextSelection {
  const selection = globalThis.getSelection()
  if (!selection || !selection.anchorNode || !selection.focusNode) {
    const offset = element.textContent?.length ?? 0
    return { anchorOffset: offset, focusOffset: offset }
  }
  const offset = (node: Node, nodeOffset: number): number => {
    if (!element.contains(node) && node !== element) return element.textContent?.length ?? 0
    const range = globalThis.document.createRange()
    range.selectNodeContents(element)
    range.setEnd(node, nodeOffset)
    return range.toString().length
  }
  return {
    anchorOffset: offset(selection.anchorNode, selection.anchorOffset),
    focusOffset: offset(selection.focusNode, selection.focusOffset)
  }
}

function textPosition(element: HTMLElement, requestedOffset: number): [Node, number] {
  const offset = Math.max(0, Math.min(requestedOffset, element.textContent?.length ?? 0))
  const walker = globalThis.document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) return [node, remaining]
    remaining -= length
    node = walker.nextNode()
  }
  const text = globalThis.document.createTextNode('')
  element.append(text)
  return [text, 0]
}

function restoreSelection(element: HTMLElement, selection: TextSelection): void {
  const nativeSelection = globalThis.getSelection()
  if (!nativeSelection) return
  const [anchorNode, anchorOffset] = textPosition(element, selection.anchorOffset)
  const [focusNode, focusOffset] = textPosition(element, selection.focusOffset)
  nativeSelection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset)
}

export function ParagraphInputSurface({
  text,
  sourceAnchor,
  style,
  pending,
  desiredSelection,
  onCommit,
  onComposingChange
}: ParagraphInputSurfaceProps) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef(new CompositionInputController(text))
  const inputTypeRef = useRef<string | undefined>()

  useLayoutEffect(() => {
    const element = elementRef.current
    const controller = controllerRef.current
    if (!element || pending || controller.isComposing) return
    if (element.textContent !== text) element.textContent = text
    const selection = desiredSelection ?? textSelection(element)
    controller.reset(text, selection)
    if (desiredSelection) {
      if (globalThis.document.activeElement !== element) element.focus({ preventScroll: true })
      restoreSelection(element, desiredSelection)
    }
  }, [text, pending, desiredSelection?.anchorOffset, desiredSelection?.focusOffset])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    element.textContent = text
    element.contentEditable = 'plaintext-only'
    const controller = controllerRef.current
    const read = () => ({
      text: element.textContent ?? '',
      selection: textSelection(element)
    })
    const beforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault()
        return
      }
      inputTypeRef.current = event.inputType
      if (!controller.isComposing) controller.updateSelection(textSelection(element))
    }
    const compositionStart = () => {
      const snapshot = read()
      controller.reset(snapshot.text, snapshot.selection)
      controller.compositionStart(snapshot.text, snapshot.selection)
      onComposingChange(true)
    }
    const input = (event: InputEvent) => {
      const snapshot = read()
      const intent = controller.input({
        ...snapshot,
        inputType: inputTypeRef.current ?? event.inputType,
        isComposing: event.isComposing,
        timestamp: performance.now()
      })
      if (intent) onCommit(sourceAnchor, intent)
    }
    const compositionEnd = () => {
      const snapshot = read()
      const intent = controller.compositionEnd({
        ...snapshot,
        inputType: inputTypeRef.current ?? 'insertCompositionText',
        timestamp: performance.now()
      })
      onComposingChange(false)
      if (intent) onCommit(sourceAnchor, intent)
    }
    element.addEventListener('beforeinput', beforeInput)
    element.addEventListener('compositionstart', compositionStart)
    element.addEventListener('input', input)
    element.addEventListener('compositionend', compositionEnd)
    return () => {
      element.removeEventListener('beforeinput', beforeInput)
      element.removeEventListener('compositionstart', compositionStart)
      element.removeEventListener('input', input)
      element.removeEventListener('compositionend', compositionEnd)
      onComposingChange(false)
    }
  }, [sourceAnchor.sectionPath, sourceAnchor.textNodeId, onCommit, onComposingChange])

  return (
    <span
      ref={elementRef}
      className="viewer-editable-text"
      role="textbox"
      aria-label="HWPX 문단 편집"
      data-source-text-node-id={sourceAnchor.textNodeId}
      aria-multiline="false"
      spellCheck={false}
      suppressContentEditableWarning
      style={style}
    />
  )
}
