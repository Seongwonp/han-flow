import { CSSProperties, useEffect, useLayoutEffect, useRef } from 'react'
import {
  CompositionCommitBuffer,
  CompositionInputController,
  TextCommitIntent,
  TextSelection
} from '../../core/editing/composition_input'
import { ViewerSourceAnchor } from '../../core/document/viewer_document'
import { EditorSelection } from '../../core/editing/selection'

interface ParagraphInputSurfaceProps {
  text: string
  sourceAnchor: ViewerSourceAnchor
  style?: CSSProperties
  pending: boolean
  restoreToken?: unknown
  ariaLabel?: string
  rangeScope: string
  desiredSelection?: TextSelection
  onCommit: (anchor: ViewerSourceAnchor, intent: TextCommitIntent) => void
  onComposingChange: (composing: boolean) => void
  onSelectionChange: (anchor: ViewerSourceAnchor, selection: TextSelection) => void
  onBoundaryNavigate?: (direction: 'previous' | 'next', selection: TextSelection) => void
  onBoundaryExtend?: (direction: 'previous' | 'next', selection: TextSelection) => void
  getRangeSelection?: () => EditorSelection | undefined
  onRangeCommit?: (
    selection: EditorSelection,
    insert: string,
    inputType: string,
    timestamp: number
  ) => void
  onSplitParagraph?: (selection: EditorSelection, timestamp: number) => void
  onMergeParagraph?: (
    selection: EditorSelection,
    direction: 'previous' | 'next',
    inputType: 'deleteContentBackward' | 'deleteContentForward',
    timestamp: number
  ) => void
  allowMergePrevious?: boolean
  allowMergeNext?: boolean
  allowParagraphStructure?: boolean
  onParagraphStructureUnavailable?: () => void
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
  restoreToken,
  ariaLabel = 'HWPX 문단 편집',
  rangeScope,
  desiredSelection,
  onCommit,
  onComposingChange,
  onSelectionChange,
  onBoundaryNavigate,
  onBoundaryExtend,
  getRangeSelection,
  onRangeCommit,
  onSplitParagraph,
  onMergeParagraph,
  allowMergePrevious = false,
  allowMergeNext = false,
  allowParagraphStructure = true,
  onParagraphStructureUnavailable
}: ParagraphInputSurfaceProps) {
  const elementRef = useRef<HTMLSpanElement>(null)
  const controllerRef = useRef(new CompositionInputController(text))
  const compositionBufferRef = useRef(new CompositionCommitBuffer())
  const compositionTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const rangeCompositionRef = useRef<EditorSelection>()
  const boundaryNavigateRef = useRef(onBoundaryNavigate)
  const boundaryExtendRef = useRef(onBoundaryExtend)
  const sourceAnchorRef = useRef(sourceAnchor)
  const onCommitRef = useRef(onCommit)
  const onComposingChangeRef = useRef(onComposingChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const getRangeSelectionRef = useRef(getRangeSelection)
  const onRangeCommitRef = useRef(onRangeCommit)
  const onSplitParagraphRef = useRef(onSplitParagraph)
  const onMergeParagraphRef = useRef(onMergeParagraph)
  const onParagraphStructureUnavailableRef = useRef(onParagraphStructureUnavailable)
  const restoringSelectionRef = useRef(false)
  const inputTypeRef = useRef<string | undefined>()
  boundaryNavigateRef.current = onBoundaryNavigate
  boundaryExtendRef.current = onBoundaryExtend
  sourceAnchorRef.current = sourceAnchor
  onCommitRef.current = onCommit
  onComposingChangeRef.current = onComposingChange
  onSelectionChangeRef.current = onSelectionChange
  getRangeSelectionRef.current = getRangeSelection
  onRangeCommitRef.current = onRangeCommit
  onSplitParagraphRef.current = onSplitParagraph
  onMergeParagraphRef.current = onMergeParagraph
  onParagraphStructureUnavailableRef.current = onParagraphStructureUnavailable

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
    const settleSelection = () => {
      if (
        !element.isConnected ||
        pending ||
        controller.isComposing ||
        compositionBufferRef.current.pending
      ) return
      restoringSelectionRef.current = true
      try {
        if (globalThis.document.activeElement !== element) element.focus({ preventScroll: true })
        restoreSelection(element, desiredSelection)
      } finally {
        restoringSelectionRef.current = false
      }
    }
    let restoreFrame: number | undefined
    const settleFrame = globalThis.requestAnimationFrame(() => {
      restoreFrame = globalThis.requestAnimationFrame(settleSelection)
    })
    const settleTimeout = globalThis.setTimeout(settleSelection, 120)
    const lateSettleTimeout = globalThis.setTimeout(settleSelection, 350)
    return () => {
      globalThis.cancelAnimationFrame(settleFrame)
      if (restoreFrame !== undefined) globalThis.cancelAnimationFrame(restoreFrame)
      globalThis.clearTimeout(settleTimeout)
      globalThis.clearTimeout(lateSettleTimeout)
    }
  }, [text, pending, restoreToken, desiredSelection?.anchorOffset, desiredSelection?.focusOffset])

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
    const commitBoundaryMerge = (
      inputType: 'deleteContentBackward' | 'deleteContentForward'
    ): boolean => {
      const direction = inputType === 'deleteContentBackward' ? 'previous' : 'next'
      if (
        (direction === 'previous' && !allowMergePrevious) ||
        (direction === 'next' && !allowMergeNext)
      ) return false
      const nativeSelection = textSelection(element)
      const modeledSelection = getRangeSelectionRef.current?.() ?? {
        sectionPath: sourceAnchorRef.current.sectionPath,
        anchorTextNodeId: sourceAnchorRef.current.textNodeId,
        anchorOffset: nativeSelection.anchorOffset,
        focusTextNodeId: sourceAnchorRef.current.textNodeId,
        focusOffset: nativeSelection.focusOffset
      }
      if (
        modeledSelection.anchorTextNodeId !== modeledSelection.focusTextNodeId ||
        modeledSelection.anchorOffset !== modeledSelection.focusOffset ||
        modeledSelection.focusTextNodeId !== sourceAnchorRef.current.textNodeId
      ) return false
      const boundary = direction === 'previous' ? 0 : element.textContent?.length ?? 0
      if (modeledSelection.focusOffset !== boundary) return false
      if (!allowParagraphStructure) {
        onParagraphStructureUnavailableRef.current?.()
        return true
      }
      onMergeParagraphRef.current?.(
        modeledSelection,
        direction,
        inputType,
        performance.now()
      )
      return Boolean(onMergeParagraphRef.current)
    }
    const beforeInput = (event: InputEvent) => {
      if (rangeCompositionRef.current) {
        event.preventDefault()
        return
      }
      if (event.inputType === 'insertParagraph') {
        event.preventDefault()
        if (event.isComposing || controller.isComposing) return
        if (!allowParagraphStructure) {
          onParagraphStructureUnavailableRef.current?.()
          return
        }
        const modeledSelection = getRangeSelectionRef.current?.()
        const selection = textSelection(element)
        onSplitParagraphRef.current?.(
          modeledSelection ?? {
            sectionPath: sourceAnchorRef.current.sectionPath,
            anchorTextNodeId: sourceAnchorRef.current.textNodeId,
            anchorOffset: selection.anchorOffset,
            focusTextNodeId: sourceAnchorRef.current.textNodeId,
            focusOffset: selection.focusOffset
          },
          performance.now()
        )
        return
      }
      const rangeSelection = getRangeSelectionRef.current?.()
      if (event.inputType === 'insertLineBreak') {
        event.preventDefault()
        if (event.isComposing || controller.isComposing) return
        if (rangeSelection && rangeSelection.anchorTextNodeId !== rangeSelection.focusTextNodeId) {
          onRangeCommitRef.current?.(
            rangeSelection,
            '\n',
            event.inputType,
            performance.now()
          )
          return
        }
        const selection = textSelection(element)
        const from = Math.min(selection.anchorOffset, selection.focusOffset)
        const to = Math.max(selection.anchorOffset, selection.focusOffset)
        onCommitRef.current(sourceAnchorRef.current, {
          from,
          to,
          insert: '\n',
          selectionBefore: selection,
          selectionAfter: { anchorOffset: from + 1, focusOffset: from + 1 },
          inputType: event.inputType,
          timestamp: performance.now()
        })
        return
      }
      if (
        rangeSelection &&
        rangeSelection.anchorTextNodeId !== rangeSelection.focusTextNodeId
      ) {
        event.preventDefault()
        if (event.isComposing || event.inputType === 'insertCompositionText') return
        const insert = event.inputType.startsWith('delete') ? '' : event.data ?? ''
        onRangeCommitRef.current?.(
          rangeSelection,
          insert,
          event.inputType || 'insertText',
          performance.now()
        )
        return
      }
      if (
        (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') &&
        commitBoundaryMerge(event.inputType)
      ) {
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
      const rangeSelection = getRangeSelectionRef.current?.()
      if (
        rangeSelection &&
        rangeSelection.anchorTextNodeId !== rangeSelection.focusTextNodeId
      ) {
        rangeCompositionRef.current = rangeSelection
        onComposingChangeRef.current(true)
        return
      }
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
    const input = (event: Event) => {
      if (!(event instanceof InputEvent)) return
      if (rangeCompositionRef.current) return
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
    const compositionEnd = (event: CompositionEvent) => {
      const rangeSelection = rangeCompositionRef.current
      if (rangeSelection) {
        rangeCompositionRef.current = undefined
        onComposingChangeRef.current(false)
        if (event.data) {
          onRangeCommitRef.current?.(
            rangeSelection,
            event.data,
            'insertCompositionText',
            performance.now()
          )
        }
        return
      }
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
        event.altKey
      ) {
        return
      }
      const selection = textSelection(element)
      const textLength = element.textContent?.length ?? 0
      if (event.key === 'Backspace' && commitBoundaryMerge('deleteContentBackward')) {
        event.preventDefault()
        return
      }
      if (event.key === 'Delete' && commitBoundaryMerge('deleteContentForward')) {
        event.preventDefault()
        return
      }
      if (event.shiftKey) {
        if (event.key === 'ArrowLeft' && selection.focusOffset === 0) {
          event.preventDefault()
          boundaryExtendRef.current?.('previous', selection)
        } else if (event.key === 'ArrowRight' && selection.focusOffset === textLength) {
          event.preventDefault()
          boundaryExtendRef.current?.('next', selection)
        }
        return
      }
      if (selection.anchorOffset !== selection.focusOffset) return
      if (event.key === 'ArrowLeft' && selection.anchorOffset === 0) {
        event.preventDefault()
        boundaryNavigateRef.current?.('previous', selection)
      } else if (event.key === 'ArrowRight' && selection.anchorOffset === textLength) {
        event.preventDefault()
        boundaryNavigateRef.current?.('next', selection)
      }
    }
    const blur = () => {
      if (compositionBuffer.pending && !controller.isComposing) flushCompositionBuffer()
    }
    const paste = (event: ClipboardEvent) => {
      if (controller.isComposing) return
      const insert = (event.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n')
      const rangeSelection = getRangeSelectionRef.current?.()
      event.preventDefault()
      if (rangeSelection && rangeSelection.anchorTextNodeId !== rangeSelection.focusTextNodeId) {
        onRangeCommitRef.current?.(
          rangeSelection,
          insert,
          'insertFromPaste',
          performance.now()
        )
        return
      }
      const selection = textSelection(element)
      const from = Math.min(selection.anchorOffset, selection.focusOffset)
      const to = Math.max(selection.anchorOffset, selection.focusOffset)
      onCommitRef.current(sourceAnchorRef.current, {
        from,
        to,
        insert,
        selectionBefore: selection,
        selectionAfter: {
          anchorOffset: from + insert.length,
          focusOffset: from + insert.length
        },
        inputType: 'insertFromPaste',
        timestamp: performance.now()
      })
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
    element.addEventListener('paste', paste)
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
      element.removeEventListener('paste', paste)
      delete element.dataset.inputReady
      compositionBuffer.clear()
      rangeCompositionRef.current = undefined
      onComposingChangeRef.current(false)
    }
  }, [sourceAnchor.sectionPath, sourceAnchor.textNodeId, allowParagraphStructure])

  return (
    <span
      ref={elementRef}
      className="viewer-editable-text"
      role="textbox"
      aria-label={ariaLabel}
      data-source-text-node-id={sourceAnchor.textNodeId}
      data-editor-range-scope={rangeScope}
      aria-multiline="true"
      spellCheck={false}
      suppressContentEditableWarning
      style={style}
    />
  )
}
