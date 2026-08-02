import { EditorSelection } from './transaction'

export interface TextSelection {
  anchorOffset: number
  focusOffset: number
}

export interface TextInputSnapshot {
  text: string
  selection: TextSelection
  inputType?: string
  isComposing?: boolean
  timestamp: number
}

export interface TextCommitIntent {
  from: number
  to: number
  insert: string
  selectionBefore: TextSelection
  selectionAfter: TextSelection
  inputType?: string
  compositionId?: string
  timestamp: number
}

interface CompositionBurst {
  baselineText: string
  baselineSelection: TextSelection
  latest: TextInputSnapshot
  compositionId: string
}

function cloneSelection(selection: TextSelection): TextSelection {
  return { ...selection }
}

function isSurrogateBoundary(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  )
}

function safePrefixLength(before: string, after: string): number {
  const limit = Math.min(before.length, after.length)
  let offset = 0
  while (offset < limit && before[offset] === after[offset]) offset += 1
  while (
    offset > 0 &&
    (!isSurrogateBoundary(before, offset) || !isSurrogateBoundary(after, offset))
  ) {
    offset -= 1
  }
  return offset
}

function safeSuffixLength(before: string, after: string, prefixLength: number): number {
  const limit = Math.min(before.length, after.length) - prefixLength
  let length = 0
  while (
    length < limit &&
    before[before.length - 1 - length] === after[after.length - 1 - length]
  ) {
    length += 1
  }
  while (
    length > 0 &&
    (!isSurrogateBoundary(before, before.length - length) ||
      !isSurrogateBoundary(after, after.length - length))
  ) {
    length -= 1
  }
  return length
}

export function diffTextInput(
  before: string,
  after: string,
  selectionBefore: TextSelection,
  selectionAfter: TextSelection,
  metadata: Pick<TextInputSnapshot, 'inputType' | 'timestamp'> & { compositionId?: string }
): TextCommitIntent | undefined {
  if (before === after) return undefined
  const from = safePrefixLength(before, after)
  const suffixLength = safeSuffixLength(before, after, from)
  return {
    from,
    to: before.length - suffixLength,
    insert: after.slice(from, after.length - suffixLength),
    selectionBefore: cloneSelection(selectionBefore),
    selectionAfter: cloneSelection(selectionAfter),
    inputType: metadata.inputType,
    compositionId: metadata.compositionId,
    timestamp: metadata.timestamp
  }
}

export class CompositionInputController {
  private baselineText: string
  private baselineSelection: TextSelection
  private composition:
    | {
        id: string
        text: string
        selection: TextSelection
        inputType?: string
      }
    | undefined
  private nextCompositionId = 1

  constructor(text: string, selection: TextSelection = { anchorOffset: 0, focusOffset: 0 }) {
    this.baselineText = text
    this.baselineSelection = cloneSelection(selection)
  }

  get isComposing(): boolean {
    return this.composition !== undefined
  }

  reset(text: string, selection: TextSelection): void {
    this.baselineText = text
    this.baselineSelection = cloneSelection(selection)
    this.composition = undefined
  }

  updateSelection(selection: TextSelection): void {
    if (!this.composition) this.baselineSelection = cloneSelection(selection)
  }

  compositionStart(text: string, selection: TextSelection): string {
    if (this.composition) return this.composition.id
    const id = `composition-${this.nextCompositionId++}`
    this.composition = {
      id,
      text,
      selection: cloneSelection(selection)
    }
    return id
  }

  input(snapshot: TextInputSnapshot): TextCommitIntent | undefined {
    if (this.composition || snapshot.isComposing) {
      if (!this.composition) this.compositionStart(this.baselineText, this.baselineSelection)
      this.composition!.text = snapshot.text
      this.composition!.selection = cloneSelection(snapshot.selection)
      this.composition!.inputType = snapshot.inputType ?? this.composition!.inputType
      return undefined
    }

    const intent = diffTextInput(
      this.baselineText,
      snapshot.text,
      this.baselineSelection,
      snapshot.selection,
      snapshot
    )
    this.baselineText = snapshot.text
    this.baselineSelection = cloneSelection(snapshot.selection)
    return intent
  }

  compositionEnd(snapshot: Omit<TextInputSnapshot, 'isComposing'>): TextCommitIntent | undefined {
    const composition = this.composition
    if (!composition) {
      return this.input({ ...snapshot, isComposing: false })
    }
    const intent = diffTextInput(
      this.baselineText,
      snapshot.text,
      this.baselineSelection,
      snapshot.selection,
      {
        inputType: snapshot.inputType ?? composition.inputType ?? 'insertCompositionText',
        compositionId: composition.id,
        timestamp: snapshot.timestamp
      }
    )
    this.baselineText = snapshot.text
    this.baselineSelection = cloneSelection(snapshot.selection)
    this.composition = undefined
    return intent
  }
}

export class CompositionCommitBuffer {
  private burst: CompositionBurst | undefined

  get pending(): boolean {
    return this.burst !== undefined
  }

  begin(
    text: string,
    selection: TextSelection,
    compositionId: string,
    timestamp: number
  ): void {
    if (this.burst) return
    this.burst = {
      baselineText: text,
      baselineSelection: cloneSelection(selection),
      latest: {
        text,
        selection: cloneSelection(selection),
        inputType: 'insertCompositionText',
        timestamp
      },
      compositionId
    }
  }

  update(snapshot: TextInputSnapshot): void {
    if (!this.burst) return
    this.burst.latest = {
      ...snapshot,
      selection: cloneSelection(snapshot.selection)
    }
  }

  flush(): TextCommitIntent | undefined {
    const burst = this.burst
    this.burst = undefined
    if (!burst) return undefined
    return diffTextInput(
      burst.baselineText,
      burst.latest.text,
      burst.baselineSelection,
      burst.latest.selection,
      {
        inputType: burst.latest.inputType ?? 'insertCompositionText',
        compositionId: burst.compositionId,
        timestamp: burst.latest.timestamp
      }
    )
  }

  clear(): void {
    this.burst = undefined
  }
}

export function toEditorSelection(
  sectionPath: string,
  textNodeId: string,
  selection: TextSelection
): EditorSelection {
  return {
    sectionPath,
    textNodeId,
    anchorOffset: selection.anchorOffset,
    focusOffset: selection.focusOffset
  }
}
