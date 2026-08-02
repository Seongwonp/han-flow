import { CSSProperties, useEffect, useLayoutEffect, useRef } from 'react'
import {
  CompositionCommitBuffer,
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
  ariaLabel?: string
  desiredSelection?: TextSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
  onSelectionChange: (anchor: ViewerSourceAnchor, selection: TextSelection) => void
  onBoundaryNavigate?: (direction: 'previous' | 'next') => void
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
    const boundary =
      node.nodeType === Node.TEXT_NODE
        ? node.textContent?.length ?? 0
        : node.childNodes.length
    range.setEnd(node, Math.max(0, Math.min(nodeOffset, boundary)))
    return range.toString().length
  }
  return {
    anchorOffset: offset(selection.anchorNode, selection.anchorOffset),
    focusOffset: offset(selection.focusNode, selection.focusOffset)
  }
}

function selectionIsInside(element: HTMLElement): boolean {
  const selection = globalThis.getSelection()
  return Boolean(
    selection?.anchorNode &&
    selection.focusNode &&
    (selection.anchorNode === element || element.contains(selection.anchorNode)) &&
    (selection.focusNode === element || element.contains(selection.focusNode))
  )
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
  ariaLabel = 'HWPX 문단 편집',
  desiredSelection,
  onCommit,
  onComposingChange,
  onSelectionChange,
  onBoundaryNavigate
}: ParagraphInputSurfaceProps) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef(new CompositionInputController(text))
  const compositionBufferRef = useRef(new CompositionCommitBuffer())
  const compositionTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const boundaryNavigateRef = useRef(onBoundaryNavigate)
  const sourceAnchorRef = useRef(sourceAnchor)
  const onCommitRef = useRef(onCommit)
  const onComposingChangeRef = useRef(onComposingChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const restoringSelectionRef = useRef(false)
  const inputTypeRef = useRef<string | undefined>()
  boundaryNavigateRef.current = onBoundaryNavigate
  sourceAnchorRef.current = sourceAnchor
  onCommitRef.current = onCommit
  onComposingChangeRef.current = onComposingChange
  onSelectionChangeRef.current = onSelectionChange

  useLayoutEffect(() => {
    const element = elementRef.current
    const controller = controllerRef.current
    if (!element) return
    if (
      pending ||
      controller.isComposing ||
      compositionBufferRef.current.pending
    ) {
      return
    }
    const textChanged = element.textContent !== text
    if (textChanged) element.textContent = text
    const currentSelection = textSelection(element)
    const selectionInside = selectionIsInside(element)
    const selection = desiredSelection ?? currentSelection
    controller.reset(text, selection)
    const selectionChanged =
      desiredSelection &&
      (
        currentSelection.anchorOffset !== desiredSelection.anchorOffset ||
        currentSelection.focusOffset !== desiredSelection.focusOffset
      )
    if (
      desiredSelection &&
      (
        textChanged ||
        selectionChanged ||
        !selectionInside ||
        globalThis.document.activeElement !== element
      )
    ) {
      restoringSelectionRef.current = true
      try {
        if (globalThis.document.activeElement !== element) element.focus({ preventScroll: true })
        restoreSelection(element, desiredSelection)
      } finally {
        restoringSelectionRef.current = false
      }
    }
    if (!desiredSelection) return
    let restoreFrame: number | undefined
    const settleFrame = globalThis.requestAnimationFrame(() => {
      restoreFrame = globalThis.requestAnimationFrame(() => {
        if (!element.isConnected || pending) return
        restoringSelectionRef.current = true
        try {
          if (globalThis.document.activeElement !== element) element.focus({ preventScroll: true })
          restoreSelection(element, desiredSelection)
        } finally {
          restoringSelectionRef.current = false
        }
      })
    })
    return () => {
      globalThis.cancelAnimationFrame(settleFrame)
      if (restoreFrame !== undefined) globalThis.cancelAnimationFrame(restoreFrame)
    }
  }, [text, pending, desiredSelection?.anchorOffset, desiredSelection?.focusOffset])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    element.textContent = text
    element.contentEditable = 'plaintext-only'
    const controller = controllerRef.current
    const compositionBuffer = compositionBufferRef.current
    const read = () => ({
      text: element.textContent ?? '',
      selection: textSelection(element)
    })
    const clearCompositionTimer = () => {
      if (compositionTimerRef.current) clearTimeout(compositionTimerRef.current)
      compositionTimerRef.current = undefined
    }
    const flushCompositionBuffer = () => {
      clearCompositionTimer()
      const snapshot = {
        ...read(),
        inputType: inputTypeRef.current ?? 'insertCompositionText',
        timestamp: performance.now()
      }
      compositionBuffer.update(snapshot)
      const intent = compositionBuffer.flush()
      controller.reset(snapshot.text, snapshot.selection)
      onComposingChangeRef.current(false)
      if (intent) onCommitRef.current(sourceAnchorRef.current, intent)
    }
    const scheduleCompositionFlush = () => {
      clearCompositionTimer()
      compositionTimerRef.current = setTimeout(flushCompositionBuffer, 450)
    }
    const beforeInput = (event: InputEvent) => {
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault()
        return
      }
      inputTypeRef.current = event.inputType
      if (!controller.isComposing) {
        const selection = textSelection(element)
        controller.updateSelection(selection)
        onSelectionChangeRef.current(sourceAnchorRef.current, selection)
      }
    }
    const compositionStart = () => {
      clearCompositionTimer()
      const snapshot = read()
      controller.reset(snapshot.text, snapshot.selection)
      const compositionId = controller.compositionStart(snapshot.text, snapshot.selection)
      compositionBuffer.begin(
        snapshot.text,
        snapshot.selection,
        compositionId,
        performance.now()
      )
      onComposingChangeRef.current(true)
    }
    const input = (event: InputEvent) => {
      const snapshot = read()
      const intent = controller.input({
        ...snapshot,
        inputType: inputTypeRef.current ?? event.inputType,
        isComposing: event.isComposing,
        timestamp: performance.now()
      })
      if (compositionBuffer.pending) {
        compositionBuffer.update({
          ...snapshot,
          inputType: inputTypeRef.current ?? event.inputType,
          isComposing: event.isComposing,
          timestamp: performance.now()
        })
        if (!controller.isComposing && !event.isComposing) scheduleCompositionFlush()
      } else if (intent) {
        onCommitRef.current(sourceAnchorRef.current, intent)
      }
    }
    const compositionEnd = () => {
      const snapshot = read()
      const intent = controller.compositionEnd({
        ...snapshot,
        inputType: inputTypeRef.current ?? 'insertCompositionText',
        timestamp: performance.now()
      })
      if (compositionBuffer.pending) {
        compositionBuffer.update({
          ...snapshot,
          inputType: inputTypeRef.current ?? 'insertCompositionText',
          timestamp: performance.now()
        })
        scheduleCompositionFlush()
      } else {
        onComposingChangeRef.current(false)
        if (intent) onCommitRef.current(sourceAnchorRef.current, intent)
      }
    }
    const selectionChanged = () => {
      if (
        restoringSelectionRef.current ||
        globalThis.document.activeElement !== element ||
        controller.isComposing
      ) return
      const selection = textSelection(element)
      controller.updateSelection(selection)
      onSelectionChangeRef.current(sourceAnchorRef.current, selection)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (
        controller.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return
      }
      const selection = textSelection(element)
      if (selection.anchorOffset !== selection.focusOffset) return
      const textLength = element.textContent?.length ?? 0
      if (event.key === 'ArrowLeft' && selection.anchorOffset === 0) {
        event.preventDefault()
        boundaryNavigateRef.current?.('previous')
      } else if (event.key === 'ArrowRight' && selection.anchorOffset === textLength) {
        event.preventDefault()
        boundaryNavigateRef.current?.('next')
      }
    }
    const blur = () => {
      if (compositionBuffer.pending && !controller.isComposing) flushCompositionBuffer()
    }
    element.addEventListener('beforeinput', beforeInput)
    element.addEventListener('compositionstart', compositionStart)
    element.addEventListener('input', input)
    element.addEventListener('compositionend', compositionEnd)
    element.addEventListener('focus', selectionChanged)
    element.addEventListener('keyup', selectionChanged)
    element.addEventListener('mouseup', selectionChanged)
    element.addEventListener('keydown', keyDown)
    element.addEventListener('blur', blur)
    element.dataset.inputReady = 'true'
    return () => {
      clearCompositionTimer()
      element.removeEventListener('beforeinput', beforeInput)
      element.removeEventListener('compositionstart', compositionStart)
      element.removeEventListener('input', input)
      element.removeEventListener('compositionend', compositionEnd)
      element.removeEventListener('focus', selectionChanged)
      element.removeEventListener('keyup', selectionChanged)
      element.removeEventListener('mouseup', selectionChanged)
      element.removeEventListener('keydown', keyDown)
      element.removeEventListener('blur', blur)
      delete element.dataset.inputReady
      compositionBuffer.clear()
      onComposingChangeRef.current(false)
    }
  }, [sourceAnchor.sectionPath, sourceAnchor.textNodeId])

  return (
    <span
      ref={elementRef}
      className="viewer-editable-text"
      role="textbox"
      aria-label={ariaLabel}
      data-source-text-node-id={sourceAnchor.textNodeId}
      aria-multiline="false"
      spellCheck={false}
      suppressContentEditableWarning
      style={style}
    />
  )
}
