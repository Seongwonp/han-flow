import { HwpxSourcePackage } from '../parser/source_package'
import { EditorSelection, normalizeEditorSelection } from './selection'
import { EditingOperationError } from './editing_error'
import {
  encodeHwpxTextContent,
  HwpxEditConflictError,
  HwpxLossReport,
  listHwpxTextAnchors
} from './text_patch'

export interface ReplaceParagraphFragmentCommand {
  type: 'replace-paragraph-fragment'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
}

export interface SplitParagraphPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
}

export type MergeParagraphDirection = 'previous' | 'next'

export interface MergeParagraphPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
}

export interface ReplaceParagraphSelectionPlan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
  affectedTextNodeIds: readonly string[]
}

export interface ParagraphPatchResult {
  package: HwpxSourcePackage
  inverse: ReplaceParagraphFragmentCommand
  lossReport: HwpxLossReport
  changed: true
}

interface XmlElementSpan {
  name: string
  start: number
  openEnd: number
  closeStart: number
  end: number
  parent?: XmlElementSpan
}

interface OpenElement {
  name: string
  start: number
  openEnd: number
  parent?: XmlElementSpan
}

interface ParagraphContext {
  xml: string
  spans: XmlElementSpan[]
  textNode: XmlElementSpan
  run: XmlElementSpan
  paragraph: XmlElementSpan
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  throw new Error('끝나지 않은 XML tag가 있습니다.')
}

function scanXmlElements(xml: string): XmlElementSpan[] {
  const spans: XmlElementSpan[] = []
  const stack: OpenElement[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const close = xml.indexOf('-->', start + 4)
      if (close < 0) throw new Error('끝나지 않은 XML comment가 있습니다.')
      cursor = close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const close = xml.indexOf(']]>', start + 9)
      if (close < 0) throw new Error('끝나지 않은 XML CDATA가 있습니다.')
      cursor = close + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const close = xml.indexOf('?>', start + 2)
      if (close < 0) throw new Error('끝나지 않은 XML processing instruction이 있습니다.')
      cursor = close + 2
      continue
    }
    const end = findTagEnd(xml, start)
    const source = xml.slice(start, end)
    if (source.startsWith('<!')) {
      cursor = end
      continue
    }
    const closing = /^<\s*\//.test(source)
    const name = source.match(closing ? /^<\s*\/\s*([^\s>]+)/ : /^<\s*([^\s/>]+)/)?.[1]
    if (!name) throw new Error(`해석할 수 없는 XML tag가 있습니다: ${source.slice(0, 32)}`)
    const selfClosing = !closing && /\/\s*>$/.test(source)
    if (closing) {
      const open = stack.pop()
      if (!open || open.name !== name) throw new Error(`XML tag 순서가 올바르지 않습니다: ${name}`)
      spans.push({ name, start: open.start, openEnd: open.openEnd, closeStart: start, end, parent: open.parent })
    } else if (selfClosing) {
      const parent = stack[stack.length - 1]
      spans.push({
        name,
        start,
        openEnd: end,
        closeStart: end,
        end,
        parent: parent
          ? { name: parent.name, start: parent.start, openEnd: parent.openEnd, closeStart: -1, end: -1, parent: parent.parent }
          : undefined
      })
    } else {
      const parent = stack[stack.length - 1]
      stack.push({
        name,
        start,
        openEnd: end,
        parent: parent
          ? { name: parent.name, start: parent.start, openEnd: parent.openEnd, closeStart: -1, end: -1, parent: parent.parent }
          : undefined
      })
    }
    cursor = end
  }
  if (stack.length) throw new Error(`끝나지 않은 XML element가 있습니다: ${stack[stack.length - 1].name}`)
  const byStart = new Map(spans.map((span) => [span.start, span]))
  for (const span of spans) if (span.parent) span.parent = byStart.get(span.parent.start)
  return spans.sort((left, right) => left.start - right.start)
}

function nearestAncestor(span: XmlElementSpan, name: string): XmlElementSpan | undefined {
  let current = span.parent
  while (current) {
    if (current.name === name) return current
    current = current.parent
  }
  return undefined
}

function attribute(openTag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return openTag.match(new RegExp(`\\s${escaped}\\s*=\\s*(["'])(.*?)\\1`))?.[2]
}

function setAttribute(openTag: string, name: string, value: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(\\s${escaped}\\s*=\\s*)(["'])(.*?)\\2`)
  if (pattern.test(openTag)) {
    return openTag.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${value}${quote}`)
  }
  return openTag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`)
}

function targetOrdinal(sectionPath: string, textNodeId: string): number {
  const prefix = `${sectionPath}#hp:t:`
  if (!textNodeId.startsWith(prefix)) {
    throw new HwpxEditConflictError(`text anchor가 section과 일치하지 않습니다: ${textNodeId}`)
  }
  const ordinal = Number(textNodeId.slice(prefix.length))
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new HwpxEditConflictError(`text anchor ordinal이 올바르지 않습니다: ${textNodeId}`)
  }
  return ordinal
}

function locateParagraph(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string
): ParagraphContext {
  if (!listHwpxTextAnchors(sourcePackage, sectionPath).some((anchor) => anchor.textNodeId === textNodeId)) {
    throw new HwpxEditConflictError(`문단 anchor를 찾을 수 없습니다: ${textNodeId}`)
  }
  const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
  const spans = scanXmlElements(xml)
  const textNode = spans.filter((span) => span.name === 'hp:t')[targetOrdinal(sectionPath, textNodeId)]
  if (!textNode) throw new HwpxEditConflictError(`문단 anchor ordinal을 찾을 수 없습니다: ${textNodeId}`)
  const run = nearestAncestor(textNode, 'hp:run')
  const paragraph = nearestAncestor(textNode, 'hp:p')
  if (
    !run ||
    !paragraph ||
    run.parent?.start !== paragraph.start ||
    paragraph.parent?.name !== 'hs:sec'
  ) {
    throw new HwpxEditConflictError('최상위 일반 텍스트 문단만 나눌 수 있습니다.')
  }
  return { xml, spans, textNode, run, paragraph }
}

function assertSimpleParagraph(context: ParagraphContext): XmlElementSpan[] {
  const { xml, spans, paragraph } = context
  const children = spans.filter((span) => span.parent?.start === paragraph.start)
  if (children.some((span) => span.name !== 'hp:run' && span.name !== 'hp:linesegarray')) {
    throw new HwpxEditConflictError('제어·표·도형이 섞인 문단은 아직 나눌 수 없습니다.')
  }
  const runs = children.filter((span) => span.name === 'hp:run')
  if (!runs.length) throw new HwpxEditConflictError('텍스트 run이 없는 문단은 나눌 수 없습니다.')
  let paragraphCursor = paragraph.openEnd
  for (const child of children) {
    if (xml.slice(paragraphCursor, child.start).trim()) {
      throw new HwpxEditConflictError('알 수 없는 문단 콘텐츠가 있어 나눌 수 없습니다.')
    }
    paragraphCursor = child.end
  }
  if (xml.slice(paragraphCursor, paragraph.closeStart).trim()) {
    throw new HwpxEditConflictError('알 수 없는 문단 콘텐츠가 있어 나눌 수 없습니다.')
  }
  for (const run of runs) {
    const descendants = spans.filter((span) => span.start >= run.openEnd && span.end <= run.closeStart)
    const directTexts = descendants.filter((span) => span.name === 'hp:t' && span.parent?.start === run.start)
    if (
      directTexts.length !== 1 ||
      descendants.some((span) => !['hp:t', 'hp:lineBreak', 'hp:tab'].includes(span.name))
    ) {
      throw new HwpxEditConflictError('복합 run이 있는 문단은 아직 나눌 수 없습니다.')
    }
    const text = directTexts[0]
    if (
      xml.slice(run.openEnd, text.start).trim() ||
      xml.slice(text.end, run.closeStart).trim()
    ) {
      throw new HwpxEditConflictError('알 수 없는 run 콘텐츠가 있어 나눌 수 없습니다.')
    }
  }
  return runs
}

function nextParagraphOpenTag(xml: string, spans: XmlElementSpan[], paragraph: XmlElementSpan): string {
  let openTag = xml.slice(paragraph.start, paragraph.openEnd)
  for (const name of ['pageBreak', 'columnBreak']) {
    if (attribute(openTag, name) !== undefined) openTag = setAttribute(openTag, name, '0')
  }
  const id = attribute(openTag, 'id')
  if (id === undefined) return openTag
  if (!/^\d+$/.test(id)) throw new HwpxEditConflictError('숫자가 아닌 문단 ID는 아직 나누지 않습니다.')
  const ids = spans
    .filter((span) => span.name === 'hp:p')
    .map((span) => attribute(xml.slice(span.start, span.openEnd), 'id'))
    .filter((candidate): candidate is string => candidate !== undefined)
  if (ids.some((candidate) => !/^\d+$/.test(candidate))) {
    throw new HwpxEditConflictError('숫자가 아닌 문단 ID가 있는 section은 아직 나누지 않습니다.')
  }
  const numericIds = ids.map(Number)
  if (numericIds.some((candidate) => !Number.isSafeInteger(candidate))) {
    throw new HwpxEditConflictError('문단 ID가 안전한 정수 범위를 벗어났습니다.')
  }
  const nextId = numericIds.reduce((maximum, candidate) => Math.max(maximum, candidate), -1) + 1
  return setAttribute(openTag, 'id', String(nextId))
}

function changedTextRun(context: ParagraphContext, text: string): string {
  const { xml, run, textNode } = context
  return (
    xml.slice(run.start, run.openEnd) +
    xml.slice(textNode.start, textNode.openEnd) +
    encodeHwpxTextContent(text) +
    xml.slice(textNode.closeStart, textNode.end) +
    xml.slice(run.closeStart, run.end)
  )
}

function paragraphTextNodes(context: ParagraphContext): XmlElementSpan[] {
  return context.spans.filter(
    (span) =>
      span.name === 'hp:t' &&
      span.start >= context.paragraph.openEnd &&
      span.end <= context.paragraph.closeStart
  )
}

function textNodeIdForSpan(
  sectionPath: string,
  spans: XmlElementSpan[],
  target: XmlElementSpan
): string {
  const ordinal = spans.filter((span) => span.name === 'hp:t').findIndex(
    (span) => span.start === target.start
  )
  if (ordinal < 0) throw new HwpxEditConflictError('문단 text ordinal을 찾을 수 없습니다.')
  return `${sectionPath}#hp:t:${ordinal}`
}

export function planSplitParagraph(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): SplitParagraphPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (normalized.start.textNodeId !== normalized.end.textNodeId) {
    throw new HwpxEditConflictError('여러 run에 걸친 선택은 아직 문단 나눔을 지원하지 않습니다.')
  }
  const context = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const runs = assertSimpleParagraph(context)
  const anchor = listHwpxTextAnchors(sourcePackage, selection.sectionPath).find(
    (candidate) => candidate.textNodeId === normalized.start.textNodeId
  )!
  const targetIndex = runs.findIndex((run) => run.start === context.run.start)
  if (targetIndex < 0) throw new HwpxEditConflictError('문단의 대상 run을 찾을 수 없습니다.')

  const beforeRuns = runs.slice(0, targetIndex).map((run) => context.xml.slice(run.start, run.end))
  const afterRuns = runs.slice(targetIndex + 1).map((run) => context.xml.slice(run.start, run.end))
  const leftRun = changedTextRun(context, anchor.text.slice(0, normalized.start.offset))
  const rightRun = changedTextRun(context, anchor.text.slice(normalized.end.offset))
  const paragraphClose = context.xml.slice(context.paragraph.closeStart, context.paragraph.end)
  const firstParagraph =
    context.xml.slice(context.paragraph.start, context.paragraph.openEnd) +
    beforeRuns.join('') + leftRun + paragraphClose
  const secondParagraph =
    nextParagraphOpenTag(context.xml, context.spans, context.paragraph) +
    rightRun + afterRuns.join('') + paragraphClose
  const expectedFragment = context.xml.slice(context.paragraph.start, context.paragraph.end)
  const replacementFragment = firstParagraph + secondParagraph
  const rightTextNodeId = `${selection.sectionPath}#hp:t:${anchor.ordinal + 1}`
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: normalized.start.textNodeId,
      expectedFragment,
      replacementFragment
    },
    selectionAfter: {
      sectionPath: selection.sectionPath,
      anchorTextNodeId: rightTextNodeId,
      anchorOffset: 0,
      focusTextNodeId: rightTextNodeId,
      focusOffset: 0
    }
  }
}

export function planMergeParagraph(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection,
  direction: MergeParagraphDirection
): MergeParagraphPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (
    normalized.start.textNodeId !== normalized.end.textNodeId ||
    normalized.start.offset !== normalized.end.offset
  ) {
    throw new HwpxEditConflictError('문단 병합은 접힌 caret에서만 지원합니다.')
  }
  const current = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  assertSimpleParagraph(current)
  const currentTexts = paragraphTextNodes(current)
  const currentAnchor = listHwpxTextAnchors(sourcePackage, selection.sectionPath).find(
    (candidate) => candidate.textNodeId === normalized.start.textNodeId
  )!
  if (
    direction === 'previous' &&
    (currentTexts[0]?.start !== current.textNode.start || normalized.start.offset !== 0)
  ) {
    throw new HwpxEditConflictError('이전 문단 병합은 문단 맨 앞에서만 지원합니다.')
  }
  if (
    direction === 'next' &&
    (
      currentTexts[currentTexts.length - 1]?.start !== current.textNode.start ||
      normalized.start.offset !== currentAnchor.text.length
    )
  ) {
    throw new HwpxEditConflictError('다음 문단 병합은 문단 맨 끝에서만 지원합니다.')
  }

  const topLevelParagraphs = current.spans.filter(
    (span) => span.name === 'hp:p' && span.parent?.name === 'hs:sec'
  )
  const currentIndex = topLevelParagraphs.findIndex(
    (paragraph) => paragraph.start === current.paragraph.start
  )
  const neighborIndex = currentIndex + (direction === 'previous' ? -1 : 1)
  const neighborParagraph = topLevelParagraphs[neighborIndex]
  if (currentIndex < 0 || !neighborParagraph) {
    throw new EditingOperationError(
      'EDITING_NOT_APPLICABLE',
      '병합할 인접 문단이 없습니다.'
    )
  }
  const neighborText = current.spans.find(
    (span) =>
      span.name === 'hp:t' &&
      span.start >= neighborParagraph.openEnd &&
      span.end <= neighborParagraph.closeStart
  )
  if (!neighborText) throw new HwpxEditConflictError('인접 문단에 text anchor가 없습니다.')
  const neighbor = locateParagraph(
    sourcePackage,
    selection.sectionPath,
    textNodeIdForSpan(selection.sectionPath, current.spans, neighborText)
  )
  assertSimpleParagraph(neighbor)

  const first = direction === 'previous' ? neighbor : current
  const second = direction === 'previous' ? current : neighbor
  if (current.xml.slice(first.paragraph.end, second.paragraph.start).trim()) {
    throw new HwpxEditConflictError('두 문단 사이에 보존해야 할 콘텐츠가 있어 병합할 수 없습니다.')
  }
  const firstRuns = assertSimpleParagraph(first)
  const secondRuns = assertSimpleParagraph(second)
  const mergedFragment =
    current.xml.slice(first.paragraph.start, first.paragraph.openEnd) +
    firstRuns.map((run) => current.xml.slice(run.start, run.end)).join('') +
    secondRuns.map((run) => current.xml.slice(run.start, run.end)).join('') +
    current.xml.slice(first.paragraph.closeStart, first.paragraph.end)
  const expectedFragment = current.xml.slice(first.paragraph.start, second.paragraph.end)
  const locatorTextNodeId = textNodeIdForSpan(
    selection.sectionPath,
    current.spans,
    paragraphTextNodes(first)[0]
  )
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: locatorTextNodeId,
      expectedFragment,
      replacementFragment: mergedFragment
    },
    selectionAfter: { ...selection }
  }
}

export function selectionSpansParagraphs(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection
): boolean {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  if (normalized.start.textNodeId === normalized.end.textNodeId) return false
  try {
    const start = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
    const end = locateParagraph(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
    return start.paragraph.start !== end.paragraph.start
  } catch (reason) {
    if (reason instanceof HwpxEditConflictError) return false
    throw reason
  }
}

export function planReplaceParagraphSelection(
  sourcePackage: HwpxSourcePackage,
  selection: EditorSelection,
  insert: string
): ReplaceParagraphSelectionPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const start = locateParagraph(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const end = locateParagraph(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  if (start.paragraph.start === end.paragraph.start) {
    throw new HwpxEditConflictError('같은 문단 선택은 text range command를 사용해야 합니다.')
  }
  if (start.paragraph.start > end.paragraph.start) {
    throw new HwpxEditConflictError('정규화된 문단 선택 순서가 올바르지 않습니다.')
  }
  const topLevelParagraphs = start.spans.filter(
    (span) => span.name === 'hp:p' && span.parent?.name === 'hs:sec'
  )
  const startParagraphIndex = topLevelParagraphs.findIndex(
    (paragraph) => paragraph.start === start.paragraph.start
  )
  const endParagraphIndex = topLevelParagraphs.findIndex(
    (paragraph) => paragraph.start === end.paragraph.start
  )
  if (startParagraphIndex < 0 || endParagraphIndex <= startParagraphIndex) {
    throw new HwpxEditConflictError('여러 문단 selection 범위를 찾을 수 없습니다.')
  }
  const selectedParagraphs = topLevelParagraphs.slice(startParagraphIndex, endParagraphIndex + 1)
  const contexts = selectedParagraphs.map((paragraph) => {
    const text = start.spans.find(
      (span) =>
        span.name === 'hp:t' &&
        span.start >= paragraph.openEnd &&
        span.end <= paragraph.closeStart
    )
    if (!text) throw new HwpxEditConflictError('selection 문단에 text anchor가 없습니다.')
    const context = locateParagraph(
      sourcePackage,
      selection.sectionPath,
      textNodeIdForSpan(selection.sectionPath, start.spans, text)
    )
    assertSimpleParagraph(context)
    return context
  })
  for (let index = 1; index < contexts.length; index += 1) {
    if (start.xml.slice(contexts[index - 1].paragraph.end, contexts[index].paragraph.start).trim()) {
      throw new HwpxEditConflictError('선택 문단 사이에 보존해야 할 콘텐츠가 있습니다.')
    }
  }

  const startRuns = assertSimpleParagraph(start)
  const endRuns = assertSimpleParagraph(end)
  const startRunIndex = startRuns.findIndex((run) => run.start === start.run.start)
  const endRunIndex = endRuns.findIndex((run) => run.start === end.run.start)
  if (startRunIndex < 0 || endRunIndex < 0) {
    throw new HwpxEditConflictError('selection 경계 run을 찾을 수 없습니다.')
  }
  const anchors = listHwpxTextAnchors(sourcePackage, selection.sectionPath)
  const startAnchorIndex = anchors.findIndex(
    (anchor) => anchor.textNodeId === normalized.start.textNodeId
  )
  const endAnchorIndex = anchors.findIndex(
    (anchor) => anchor.textNodeId === normalized.end.textNodeId
  )
  const startAnchor = anchors[startAnchorIndex]
  const endAnchor = anchors[endAnchorIndex]
  if (!startAnchor || !endAnchor) throw new HwpxEditConflictError('selection text anchor를 찾을 수 없습니다.')

  const prefixRuns = startRuns
    .slice(0, startRunIndex)
    .map((run) => start.xml.slice(run.start, run.end))
  const suffixRuns = endRuns
    .slice(endRunIndex + 1)
    .map((run) => start.xml.slice(run.start, run.end))
  const changedStartRun = changedTextRun(
    start,
    startAnchor.text.slice(0, normalized.start.offset) + insert
  )
  const changedEndRun = changedTextRun(
    end,
    endAnchor.text.slice(normalized.end.offset)
  )
  const replacementFragment =
    start.xml.slice(start.paragraph.start, start.paragraph.openEnd) +
    prefixRuns.join('') +
    changedStartRun +
    changedEndRun +
    suffixRuns.join('') +
    start.xml.slice(start.paragraph.closeStart, start.paragraph.end)
  return {
    command: {
      type: 'replace-paragraph-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: normalized.start.textNodeId,
      expectedFragment: start.xml.slice(start.paragraph.start, end.paragraph.end),
      replacementFragment
    },
    selectionAfter: {
      sectionPath: selection.sectionPath,
      anchorTextNodeId: normalized.start.textNodeId,
      anchorOffset: normalized.start.offset + insert.length,
      focusTextNodeId: normalized.start.textNodeId,
      focusOffset: normalized.start.offset + insert.length
    },
    affectedTextNodeIds: anchors
      .slice(startAnchorIndex, endAnchorIndex + 1)
      .map((anchor) => anchor.textNodeId)
  }
}

export function applyReplaceParagraphFragmentCommand(
  sourcePackage: HwpxSourcePackage,
  command: ReplaceParagraphFragmentCommand
): ParagraphPatchResult {
  if (command.type !== 'replace-paragraph-fragment') throw new Error('지원하지 않는 문단 command입니다.')
  const context = locateParagraph(sourcePackage, command.sectionPath, command.textNodeId)
  const actual = context.xml.slice(
    context.paragraph.start,
    context.paragraph.start + command.expectedFragment.length
  )
  if (actual !== command.expectedFragment) {
    throw new HwpxEditConflictError('문단 fragment가 변경되어 command를 적용할 수 없습니다.')
  }
  const nextXml =
    context.xml.slice(0, context.paragraph.start) +
    command.replacementFragment +
    context.xml.slice(context.paragraph.start + command.expectedFragment.length)
  const nextPackage = sourcePackage.withEntry(command.sectionPath, Buffer.from(nextXml, 'utf8'))
  const entries = sourcePackage.listEntries()
  const hasPreview = entries.some((entry) => entry.path.startsWith('Preview/'))
  return {
    package: nextPackage,
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment
    },
    lossReport: {
      preservedEntries: entries.map((entry) => entry.path).filter((path) => path !== command.sectionPath),
      modifiedEntries: [command.sectionPath],
      regeneratedEntries: [],
      omittedEntries: [],
      unsupportedFeatures: [],
      previewStatus: hasPreview ? 'stale' : 'omitted'
    },
    changed: true
  }
}
