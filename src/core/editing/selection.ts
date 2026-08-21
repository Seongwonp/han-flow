import { HwpxSourcePackage } from '../parser/source_package'
import { HwpxEditConflictError, listHwpxTextAnchors } from './text_patch'

export interface EditorSelection {
  sectionPath: string
  anchorTextNodeId: string
  anchorOffset: number
  focusTextNodeId: string
  focusOffset: number
}

export interface EditorSelectionPoint {
  textNodeId: string
  offset: number
}

export interface NormalizedEditorSelection {
  sectionPath: string
  start: EditorSelectionPoint
  end: EditorSelectionPoint
  backward: boolean
}

function isTextBoundary(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  )
}

export function createEditorSelection(
  sectionPath: string,
  textNodeId: string,
  anchorOffset: number,
  focusOffset = anchorOffset
): EditorSelection {
  return {
    sectionPath,
    anchorTextNodeId: textNodeId,
    anchorOffset,
    focusTextNodeId: textNodeId,
    focusOffset
  }
}

export function cloneEditorSelection(selection: EditorSelection): EditorSelection {
  return { ...selection }
}

export function equalEditorSelections(left: EditorSelection, right: EditorSelection): boolean {
  return (
    left.sectionPath === right.sectionPath &&
    left.anchorTextNodeId === right.anchorTextNodeId &&
    left.anchorOffset === right.anchorOffset &&
    left.focusTextNodeId === right.focusTextNodeId &&
    left.focusOffset === right.focusOffset
  )
}

export function isCollapsedEditorSelection(selection: EditorSelection): boolean {
  return (
    selection.anchorTextNodeId === selection.focusTextNodeId &&
    selection.anchorOffset === selection.focusOffset
  )
}

export function normalizeEditorSelection(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): NormalizedEditorSelection {
  const anchors = listHwpxTextAnchors(sourcePackage, selection.sectionPath)
  const anchorIndex = anchors.findIndex(
    (candidate) => candidate.textNodeId === selection.anchorTextNodeId
  )
  const focusIndex = anchors.findIndex(
    (candidate) => candidate.textNodeId === selection.focusTextNodeId
  )
  if (anchorIndex < 0) {
    throw new HwpxEditConflictError(`selection anchor를 찾을 수 없습니다: ${selection.anchorTextNodeId}`)
  }
  if (focusIndex < 0) {
    throw new HwpxEditConflictError(`selection focus를 찾을 수 없습니다: ${selection.focusTextNodeId}`)
  }

  const points = [
    { anchor: anchors[anchorIndex], offset: selection.anchorOffset },
    { anchor: anchors[focusIndex], offset: selection.focusOffset }
  ] as const
  for (const point of points) {
    if (
      !Number.isInteger(point.offset) ||
      point.offset < 0 ||
      point.offset > point.anchor.text.length ||
      !isTextBoundary(point.anchor.text, point.offset)
    ) {
      throw new HwpxEditConflictError(`selection 범위가 올바르지 않습니다: ${point.offset}`)
    }
  }

  const backward =
    anchorIndex > focusIndex ||
    (anchorIndex === focusIndex && selection.anchorOffset > selection.focusOffset)
  const anchorPoint = {
    textNodeId: selection.anchorTextNodeId,
    offset: selection.anchorOffset
  }
  const focusPoint = {
    textNodeId: selection.focusTextNodeId,
    offset: selection.focusOffset
  }
  return {
    sectionPath: selection.sectionPath,
    start: backward ? focusPoint : anchorPoint,
    end: backward ? anchorPoint : focusPoint,
    backward
  }
}

export function validateEditorSelection(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): void {
  normalizeEditorSelection(sourcePackage, selection)
}
