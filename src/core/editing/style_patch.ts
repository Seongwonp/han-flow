import { HwpxSourcePackage } from '../parser/source_package'
import {
  escapeXmlText,
  HwpxEditConflictError,
  HwpxLossReport,
  listHwpxTextAnchors
} from './text_patch'

export type ParagraphAlignment = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFY'

export interface ApplyCharacterStyleCommand {
  type: 'apply-character-style'
  sectionPath: string
  textNodeId: string
  bold?: boolean
  height?: number
  color?: string
  from?: number
  to?: number
}

export interface ApplyParagraphStyleCommand {
  type: 'apply-paragraph-style'
  sectionPath: string
  textNodeId: string
  align: ParagraphAlignment
}

interface HeaderStyleMutation {
  headerPath: string
  collectionName: 'hh:charProperties' | 'hh:paraProperties'
  expectedCollectionOpenTag: string
  replacementCollectionOpenTag: string
  fragment: string
  action: 'insert' | 'remove'
}

export interface RestoreStyleCommand {
  type: 'restore-style'
  target: 'character' | 'paragraph'
  sectionPath: string
  textNodeId: string
  expectedReferenceTag: string
  replacementReferenceTag: string
  headerMutation?: HeaderStyleMutation
}

export interface RestoreCharacterRunCommand {
  type: 'restore-character-run'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
  headerMutation?: HeaderStyleMutation
}

export type StyleEditCommand =
  | ApplyCharacterStyleCommand
  | ApplyParagraphStyleCommand
  | RestoreStyleCommand
  | RestoreCharacterRunCommand

export interface StylePatchResult {
  package: HwpxSourcePackage
  inverse?: RestoreStyleCommand | RestoreCharacterRunCommand
  lossReport: HwpxLossReport
  changed: boolean
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

interface TextStyleContext {
  textNode: XmlElementSpan
  run: XmlElementSpan
  paragraph: XmlElementSpan
}

interface StyleDefinition {
  id: string
  span: XmlElementSpan
  xml: string
}

interface StyleCollection {
  span: XmlElementSpan
  openTag: string
  definitions: StyleDefinition[]
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
      if (!open || open.name !== name) {
        throw new Error(`XML tag 순서가 올바르지 않습니다: ${name}`)
      }
      spans.push({
        name,
        start: open.start,
        openEnd: open.openEnd,
        closeStart: start,
        end,
        parent: open.parent
      })
    } else if (selfClosing) {
      spans.push({
        name,
        start,
        openEnd: end,
        closeStart: end,
        end,
        parent: stack[stack.length - 1]
          ? {
              name: stack[stack.length - 1].name,
              start: stack[stack.length - 1].start,
              openEnd: stack[stack.length - 1].openEnd,
              closeStart: -1,
              end: -1,
              parent: stack[stack.length - 1].parent
            }
          : undefined
      })
    } else {
      const parent = stack[stack.length - 1]
      stack.push({
        name,
        start,
        openEnd: end,
        parent: parent
          ? {
              name: parent.name,
              start: parent.start,
              openEnd: parent.openEnd,
              closeStart: -1,
              end: -1,
              parent: parent.parent
            }
          : undefined
      })
    }
    cursor = end
  }

  if (stack.length) throw new Error(`끝나지 않은 XML element가 있습니다: ${stack[stack.length - 1].name}`)

  const byStart = new Map(spans.map((span) => [span.start, span]))
  for (const span of spans) {
    if (span.parent) span.parent = byStart.get(span.parent.start)
  }
  return spans.sort((left, right) => left.start - right.start)
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

function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
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

function nearestAncestor(span: XmlElementSpan, name: string): XmlElementSpan | undefined {
  let current = span.parent
  while (current) {
    if (current.name === name) return current
    current = current.parent
  }
  return undefined
}

function locateTextStyleContext(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string
): TextStyleContext {
  if (!listHwpxTextAnchors(sourcePackage, sectionPath).some((anchor) => anchor.textNodeId === textNodeId)) {
    throw new HwpxEditConflictError(`style anchor를 찾을 수 없습니다: ${textNodeId}`)
  }

  const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
  const ordinal = targetOrdinal(sectionPath, textNodeId)
  const textNodes = scanXmlElements(xml).filter((span) => span.name === 'hp:t')
  const textNode = textNodes[ordinal]
  if (!textNode) throw new HwpxEditConflictError(`style anchor ordinal을 찾을 수 없습니다: ${textNodeId}`)
  const run = nearestAncestor(textNode, 'hp:run')
  const paragraph = nearestAncestor(textNode, 'hp:p')
  if (!run || !paragraph || run.parent?.start !== paragraph.start || paragraph.parent?.name !== 'hs:sec') {
    throw new HwpxEditConflictError('첫 style 편집은 최상위 일반 문단의 단일 run만 지원합니다.')
  }
  const runDescendants = scanXmlElements(xml).filter(
    (span) => span.start >= run.openEnd && span.end <= run.closeStart
  )
  if (
    runDescendants.filter((span) => span.name === 'hp:t').length !== 1 ||
    runDescendants.some((span) => span.name !== 'hp:t')
  ) {
    throw new HwpxEditConflictError('복합 run은 아직 style을 편집할 수 없습니다.')
  }
  return { textNode, run, paragraph }
}

function directChildren(spans: XmlElementSpan[], parent: XmlElementSpan, name: string): XmlElementSpan[] {
  return spans.filter((span) => span.name === name && span.parent?.start === parent.start)
}

function styleCollection(
  headerXml: string,
  collectionName: 'hh:charProperties' | 'hh:paraProperties',
  definitionName: 'hh:charPr' | 'hh:paraPr'
): StyleCollection {
  const spans = scanXmlElements(headerXml)
  const collection = spans.find((span) => span.name === collectionName)
  if (!collection) throw new HwpxEditConflictError(`HWPX style collection이 없습니다: ${collectionName}`)
  const definitions = directChildren(spans, collection, definitionName).map((span) => {
    const xml = headerXml.slice(span.start, span.end)
    const id = attribute(headerXml.slice(span.start, span.openEnd), 'id')
    if (id === undefined) throw new HwpxEditConflictError(`${definitionName} ID가 없습니다.`)
    return { id, span, xml }
  })
  if (!definitions.length) throw new HwpxEditConflictError(`${definitionName} definition이 없습니다.`)
  return {
    span: collection,
    openTag: headerXml.slice(collection.start, collection.openEnd),
    definitions
  }
}

function definitionSignature(xml: string): string {
  const openEnd = findTagEnd(xml, 0)
  const openTag = setAttribute(xml.slice(0, openEnd), 'id', '__HAN_FLOW_STYLE_ID__')
  return (openTag + xml.slice(openEnd)).replace(/>\s+</g, '><').trim()
}

function nextStyleId(definitions: readonly StyleDefinition[]): string {
  const ids = new Set(definitions.map((definition) => definition.id))
  const numeric = definitions
    .map((definition) => Number(definition.id))
    .filter((id) => Number.isSafeInteger(id) && id >= 0)
  let next = numeric.length ? Math.max(...numeric) + 1 : 0
  while (ids.has(String(next))) next += 1
  return String(next)
}

function updateCollectionCount(openTag: string, nextCount: number): string {
  return attribute(openTag, 'itemCnt') === undefined
    ? openTag
    : setAttribute(openTag, 'itemCnt', String(nextCount))
}

function setDefinitionId(xml: string, id: string): string {
  const openEnd = findTagEnd(xml, 0)
  return setAttribute(xml.slice(0, openEnd), 'id', id) + xml.slice(openEnd)
}

function setBold(xml: string, bold: boolean): string {
  const boldPattern = /<hh:bold(?:\s[^>]*)?\s*\/>|<hh:bold(?:\s[^>]*)?>\s*<\/hh:bold>/g
  const withoutBold = xml.replace(boldPattern, '')
  if (!bold) return withoutBold
  return withoutBold.replace(/<\/hh:charPr>\s*$/, '<hh:bold/></hh:charPr>')
}

function setCharacterStyleAttributes(
  xml: string,
  options: Pick<ApplyCharacterStyleCommand, 'height' | 'color'>
): string {
  const openEnd = findTagEnd(xml, 0)
  let openTag = xml.slice(0, openEnd)
  if (options.height !== undefined) openTag = setAttribute(openTag, 'height', String(options.height))
  if (options.color !== undefined) openTag = setAttribute(openTag, 'textColor', options.color.toUpperCase())
  return openTag + xml.slice(openEnd)
}

function setAlignment(xml: string, align: ParagraphAlignment): string {
  const alignPattern = /<hh:align(?:\s[^>]*)?\s*\/>/
  const existing = xml.match(alignPattern)?.[0]
  if (existing) return xml.replace(existing, setAttribute(existing, 'horizontal', align))
  return xml.replace(/<\/hh:paraPr>\s*$/, `<hh:align horizontal="${align}"/></hh:paraPr>`)
}

function insertionGap(headerXml: string, collection: StyleCollection): string {
  const last = collection.definitions[collection.definitions.length - 1]
  const gap = headerXml.slice(last.span.end, collection.span.closeStart)
  return /^\s*$/.test(gap) ? gap : ''
}

function lossReport(
  sourcePackage: HwpxSourcePackage,
  modifiedEntries: string[]
): HwpxLossReport {
  const entries = sourcePackage.listEntries().map((entry) => entry.path)
  return {
    preservedEntries: entries.filter((path) => !modifiedEntries.includes(path)),
    modifiedEntries,
    regeneratedEntries: [],
    omittedEntries: [],
    unsupportedFeatures: [],
    previewStatus: entries.some((path) => path.startsWith('Preview/')) ? 'stale' : 'omitted'
  }
}

function noChange(sourcePackage: HwpxSourcePackage): StylePatchResult {
  return {
    package: sourcePackage,
    lossReport: lossReport(sourcePackage, []),
    changed: false
  }
}

function applyStyleDefinition(
  sourcePackage: HwpxSourcePackage,
  options: {
    sectionPath: string
    textNodeId: string
    target: 'character' | 'paragraph'
    collectionName: 'hh:charProperties' | 'hh:paraProperties'
    definitionName: 'hh:charPr' | 'hh:paraPr'
    referenceAttribute: 'charPrIDRef' | 'paraPrIDRef'
    mutate: (definitionXml: string) => string
  }
): StylePatchResult {
  const context = locateTextStyleContext(sourcePackage, options.sectionPath, options.textNodeId)
  const sectionXml = sourcePackage.readEntry(options.sectionPath).toString('utf8')
  const referenceSpan = options.target === 'character' ? context.run : context.paragraph
  const referenceTag = sectionXml.slice(referenceSpan.start, referenceSpan.openEnd)
  const currentId = attribute(referenceTag, options.referenceAttribute)
  if (currentId === undefined) {
    throw new HwpxEditConflictError(`${options.referenceAttribute}가 없는 문단은 아직 편집할 수 없습니다.`)
  }

  const headerPath = 'Contents/header.xml'
  const headerXml = sourcePackage.readEntry(headerPath).toString('utf8')
  const collection = styleCollection(headerXml, options.collectionName, options.definitionName)
  const base = collection.definitions.find((definition) => definition.id === currentId)
  if (!base) {
    throw new HwpxEditConflictError(`${options.definitionName} reference를 찾을 수 없습니다: ${currentId}`)
  }
  const mutatedBase = options.mutate(base.xml)
  if (definitionSignature(mutatedBase) === definitionSignature(base.xml)) return noChange(sourcePackage)

  const equivalent = collection.definitions.find(
    (definition) => definitionSignature(definition.xml) === definitionSignature(mutatedBase)
  )
  let nextHeaderXml = headerXml
  let headerMutation: HeaderStyleMutation | undefined
  let nextId: string

  if (equivalent) {
    nextId = equivalent.id
  } else {
    nextId = nextStyleId(collection.definitions)
    const definitionXml = setDefinitionId(mutatedBase, nextId)
    const gap = insertionGap(headerXml, collection)
    const fragment = definitionXml + gap
    const nextCollectionOpenTag = updateCollectionCount(collection.openTag, collection.definitions.length + 1)
    nextHeaderXml = replaceRange(
      nextHeaderXml,
      collection.span.start,
      collection.span.openEnd,
      nextCollectionOpenTag
    )
    const adjustedCloseStart =
      collection.span.closeStart + nextCollectionOpenTag.length - collection.openTag.length
    nextHeaderXml = replaceRange(nextHeaderXml, adjustedCloseStart, adjustedCloseStart, fragment)
    headerMutation = {
      headerPath,
      collectionName: options.collectionName,
      expectedCollectionOpenTag: nextCollectionOpenTag,
      replacementCollectionOpenTag: collection.openTag,
      fragment,
      action: 'remove'
    }
  }

  const nextReferenceTag = setAttribute(referenceTag, options.referenceAttribute, nextId)
  const nextSectionXml = replaceRange(
    sectionXml,
    referenceSpan.start,
    referenceSpan.openEnd,
    nextReferenceTag
  )
  let nextPackage = sourcePackage
  const modifiedEntries: string[] = []
  if (nextHeaderXml !== headerXml) {
    nextPackage = nextPackage.withEntry(headerPath, Buffer.from(nextHeaderXml, 'utf8'))
    modifiedEntries.push(headerPath)
  }
  nextPackage = nextPackage.withEntry(options.sectionPath, Buffer.from(nextSectionXml, 'utf8'))
  modifiedEntries.push(options.sectionPath)

  return {
    package: nextPackage,
    inverse: {
      type: 'restore-style',
      target: options.target,
      sectionPath: options.sectionPath,
      textNodeId: options.textNodeId,
      expectedReferenceTag: nextReferenceTag,
      replacementReferenceTag: referenceTag,
      headerMutation
    },
    lossReport: lossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function applyCharacterStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyCharacterStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-character-style') throw new Error('지원하지 않는 글자 style command입니다.')
  if (command.bold === undefined && command.height === undefined && command.color === undefined) {
    throw new Error('적용할 글자 style 값이 없습니다.')
  }
  if (command.bold !== undefined && typeof command.bold !== 'boolean') {
    throw new Error('굵게 style 값이 올바르지 않습니다.')
  }
  if (
    command.height !== undefined &&
    (!Number.isInteger(command.height) || command.height < 500 || command.height > 7200)
  ) {
    throw new Error('글자 크기는 5pt에서 72pt 사이여야 합니다.')
  }
  if (command.color !== undefined && !/^#[\da-f]{6}$/i.test(command.color)) {
    throw new Error('글자 색상은 #RRGGBB 형식이어야 합니다.')
  }
  const anchor = listHwpxTextAnchors(sourcePackage, command.sectionPath).find(
    (candidate) => candidate.textNodeId === command.textNodeId
  )
  if (!anchor) throw new HwpxEditConflictError(`style anchor를 찾을 수 없습니다: ${command.textNodeId}`)
  const from = command.from ?? 0
  const to = command.to ?? anchor.text.length
  for (const offset of [from, to]) {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > anchor.text.length ||
      (offset > 0 &&
        offset < anchor.text.length &&
        /[\uD800-\uDBFF]/.test(anchor.text[offset - 1]) &&
        /[\uDC00-\uDFFF]/.test(anchor.text[offset]))
    ) {
      throw new HwpxEditConflictError(`글자 style 범위가 올바르지 않습니다: ${offset}`)
    }
  }
  if (from > to) throw new HwpxEditConflictError('글자 style 범위의 시작이 끝보다 큽니다.')

  const styled = applyStyleDefinition(sourcePackage, {
    ...command,
    target: 'character',
    collectionName: 'hh:charProperties',
    definitionName: 'hh:charPr',
    referenceAttribute: 'charPrIDRef',
    mutate: (definition) => {
      const withBold = command.bold === undefined ? definition : setBold(definition, command.bold)
      return setCharacterStyleAttributes(withBold, command)
    }
  })
  if (!styled.changed || from === to || (from === 0 && to === anchor.text.length)) return styled

  const originalSectionXml = sourcePackage.readEntry(command.sectionPath).toString('utf8')
  const originalContext = locateTextStyleContext(sourcePackage, command.sectionPath, command.textNodeId)
  const originalRun = originalSectionXml.slice(originalContext.run.start, originalContext.run.end)
  const contentStart = originalContext.textNode.openEnd - originalContext.run.start
  const contentEnd = originalContext.textNode.closeStart - originalContext.run.start
  const runOpenEnd = originalContext.run.openEnd - originalContext.run.start
  const withText = (text: string, openTag?: string): string => {
    const run = originalRun.slice(0, contentStart) + escapeXmlText(text) + originalRun.slice(contentEnd)
    return openTag ? openTag + run.slice(runOpenEnd) : run
  }

  const styledSectionXml = styled.package.readEntry(command.sectionPath).toString('utf8')
  const styledContext = locateTextStyleContext(styled.package, command.sectionPath, command.textNodeId)
  const styledOpenTag = styledSectionXml.slice(styledContext.run.start, styledContext.run.openEnd)
  const fragments: string[] = []
  if (from > 0) fragments.push(withText(anchor.text.slice(0, from)))
  fragments.push(withText(anchor.text.slice(from, to), styledOpenTag))
  if (to < anchor.text.length) fragments.push(withText(anchor.text.slice(to)))
  const splitFragment = fragments.join('')
  const nextSectionXml = replaceRange(
    styledSectionXml,
    styledContext.run.start,
    styledContext.run.end,
    splitFragment
  )
  const nextPackage = styled.package.withEntry(
    command.sectionPath,
    Buffer.from(nextSectionXml, 'utf8')
  )
  return {
    ...styled,
    package: nextPackage,
    inverse: {
      type: 'restore-character-run',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedFragment: splitFragment,
      replacementFragment: originalRun,
      headerMutation: styled.inverse?.headerMutation
    }
  }
}

export function applyParagraphStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyParagraphStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-paragraph-style') throw new Error('지원하지 않는 문단 style command입니다.')
  if (!(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'] as const).includes(command.align)) {
    throw new Error('문단 정렬 style 값이 올바르지 않습니다.')
  }
  return applyStyleDefinition(sourcePackage, {
    ...command,
    target: 'paragraph',
    collectionName: 'hh:paraProperties',
    definitionName: 'hh:paraPr',
    referenceAttribute: 'paraPrIDRef',
    mutate: (definition) => setAlignment(definition, command.align)
  })
}

function applyHeaderStyleMutation(
  sourcePackage: HwpxSourcePackage,
  mutation?: HeaderStyleMutation
): {
  package: HwpxSourcePackage
  modifiedEntries: string[]
  inverse?: HeaderStyleMutation
} {
  if (!mutation) return { package: sourcePackage, modifiedEntries: [] }
  const headerXml = sourcePackage.readEntry(mutation.headerPath).toString('utf8')
  const collection = styleCollection(
    headerXml,
    mutation.collectionName,
    mutation.collectionName === 'hh:charProperties' ? 'hh:charPr' : 'hh:paraPr'
  )
  if (collection.openTag !== mutation.expectedCollectionOpenTag) {
    throw new HwpxEditConflictError('style collection count가 변경되어 안전하게 복원할 수 없습니다.')
  }
  let nextHeaderXml = replaceRange(
    headerXml,
    collection.span.start,
    collection.span.openEnd,
    mutation.replacementCollectionOpenTag
  )
  const delta = mutation.replacementCollectionOpenTag.length - mutation.expectedCollectionOpenTag.length
  const closeStart = collection.span.closeStart + delta
  if (mutation.action === 'remove') {
    const fragmentStart = nextHeaderXml.lastIndexOf(mutation.fragment, closeStart)
    if (fragmentStart < collection.span.start || fragmentStart + mutation.fragment.length !== closeStart) {
      throw new HwpxEditConflictError('추가한 style definition이 변경되어 안전하게 제거할 수 없습니다.')
    }
    nextHeaderXml = replaceRange(
      nextHeaderXml,
      fragmentStart,
      fragmentStart + mutation.fragment.length,
      ''
    )
  } else {
    nextHeaderXml = replaceRange(nextHeaderXml, closeStart, closeStart, mutation.fragment)
  }
  return {
    package: sourcePackage.withEntry(mutation.headerPath, Buffer.from(nextHeaderXml, 'utf8')),
    modifiedEntries: [mutation.headerPath],
    inverse: {
      ...mutation,
      expectedCollectionOpenTag: mutation.replacementCollectionOpenTag,
      replacementCollectionOpenTag: mutation.expectedCollectionOpenTag,
      action: mutation.action === 'remove' ? 'insert' : 'remove'
    }
  }
}

export function applyRestoreStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreStyleCommand
): StylePatchResult {
  if (command.type !== 'restore-style') throw new Error('지원하지 않는 style 복원 command입니다.')
  const context = locateTextStyleContext(sourcePackage, command.sectionPath, command.textNodeId)
  const sectionXml = sourcePackage.readEntry(command.sectionPath).toString('utf8')
  const referenceSpan = command.target === 'character' ? context.run : context.paragraph
  const currentReferenceTag = sectionXml.slice(referenceSpan.start, referenceSpan.openEnd)
  if (currentReferenceTag !== command.expectedReferenceTag) {
    throw new HwpxEditConflictError('style reference가 변경되어 안전하게 복원할 수 없습니다.')
  }
  const nextSectionXml = replaceRange(
    sectionXml,
    referenceSpan.start,
    referenceSpan.openEnd,
    command.replacementReferenceTag
  )

  const restoredHeader = applyHeaderStyleMutation(sourcePackage, command.headerMutation)
  let nextPackage = restoredHeader.package
  const modifiedEntries = [...restoredHeader.modifiedEntries]

  nextPackage = nextPackage.withEntry(command.sectionPath, Buffer.from(nextSectionXml, 'utf8'))
  modifiedEntries.push(command.sectionPath)
  return {
    package: nextPackage,
    inverse: {
      ...command,
      expectedReferenceTag: command.replacementReferenceTag,
      replacementReferenceTag: command.expectedReferenceTag,
      headerMutation: restoredHeader.inverse
    },
    lossReport: lossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function applyRestoreCharacterRunCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreCharacterRunCommand
): StylePatchResult {
  if (command.type !== 'restore-character-run') {
    throw new Error('지원하지 않는 글자 run 복원 command입니다.')
  }
  const context = locateTextStyleContext(sourcePackage, command.sectionPath, command.textNodeId)
  const sectionXml = sourcePackage.readEntry(command.sectionPath).toString('utf8')
  const actualFragment = sectionXml.slice(
    context.run.start,
    context.run.start + command.expectedFragment.length
  )
  if (actualFragment !== command.expectedFragment) {
    throw new HwpxEditConflictError('분할된 글자 run이 변경되어 안전하게 복원할 수 없습니다.')
  }
  const nextSectionXml = replaceRange(
    sectionXml,
    context.run.start,
    context.run.start + command.expectedFragment.length,
    command.replacementFragment
  )
  const restoredHeader = applyHeaderStyleMutation(sourcePackage, command.headerMutation)
  let nextPackage = restoredHeader.package.withEntry(
    command.sectionPath,
    Buffer.from(nextSectionXml, 'utf8')
  )
  const modifiedEntries = [...restoredHeader.modifiedEntries, command.sectionPath]
  return {
    package: nextPackage,
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment,
      headerMutation: restoredHeader.inverse
    },
    lossReport: lossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}
