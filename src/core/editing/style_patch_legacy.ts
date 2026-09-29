/**
 * @internal 2단계(tree 전환) 비교 oracle 전용 — 제품 코드에서 import하지 않는다.
 *
 * tree 모델로 옮기기 전 `style_patch.ts`의 문자열 구현(scanXmlElements span + 정규식 attribute + replaceRange)을
 * 그대로 보존한 사본이다. `tests/editing/style_tree_differential.test.ts`와 style benchmark가 새 tree 경로와 출력
 * bytes를 비교하는 데만 쓴다. 4단계(표) 전환 뒤 삭제한다.
 */
import { HwpxSourcePackage } from '../parser/source_package'
import type {
  ApplyCharacterStyleCommand,
  ApplyParagraphStyleCommand,
  ParagraphAlignment,
  RestoreCharacterRunCommand,
  RestoreStyleCommand,
  StylePatchResult
} from './style_patch'
import {
  escapeXmlText,
  HwpxEditConflictError,
  listHwpxTextAnchors
} from './text_patch'
import {
  attribute,
  buildLossReport,
  findTagEnd,
  isSurrogateBoundarySafe,
  nearestAncestor,
  replaceRange,
  scanXmlElements,
  setAttribute,
  targetOrdinal,
  XmlElementSpan
} from './xml_scan'

type HeaderStyleMutation = NonNullable<RestoreStyleCommand['headerMutation']>

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

function locateTextStyleContext(
  sourcePackage: HwpxSourcePackage,
  sectionPath: string,
  textNodeId: string,
  target: 'character' | 'paragraph'
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
  if (target === 'character' && (
    runDescendants.filter((span) => span.name === 'hp:t').length !== 1 ||
    runDescendants.some((span) => span.name !== 'hp:t')
  )) {
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

const characterChildOrder = [
  'fontRef', 'ratio', 'spacing', 'relSz', 'offset', 'italic', 'bold', 'underline',
  'strikeout', 'outline', 'shadow', 'emboss', 'engrave', 'supscript', 'subscript'
]

function characterChildPattern(name: string): RegExp {
  return new RegExp(`<hh:${name}(?:\\s[^>]*)?\\s*\\/>|<hh:${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/hh:${name}>`, 'g')
}

function insertCharacterChild(xml: string, name: string, fragment: string): string {
  const index = characterChildOrder.indexOf(name)
  for (const later of characterChildOrder.slice(index + 1)) {
    const match = characterChildPattern(later).exec(xml)
    if (match) return replaceRange(xml, match.index, match.index, fragment)
  }
  return xml.replace(/<\/hh:charPr>\s*$/, `${fragment}</hh:charPr>`)
}

function setEmptyCharacterChild(xml: string, name: 'italic' | 'bold', enabled: boolean): string {
  const withoutElement = xml.replace(characterChildPattern(name), '')
  return enabled ? insertCharacterChild(withoutElement, name, `<hh:${name}/>`): withoutElement
}

function setLineDecoration(
  xml: string,
  name: 'underline' | 'strikeout',
  enabled: boolean
): string {
  const pattern = characterChildPattern(name)
  const existing = xml.match(pattern)?.[0]
  if (existing) {
    const openEnd = findTagEnd(existing, 0)
    let openTag = existing.slice(0, openEnd)
    if (name === 'underline') {
      openTag = setAttribute(openTag, 'type', enabled ? 'BOTTOM' : 'NONE')
      if (enabled) openTag = setAttribute(openTag, 'shape', 'SOLID')
    } else {
      openTag = setAttribute(openTag, 'shape', enabled ? 'SOLID' : 'NONE')
    }
    return xml.replace(existing, openTag + existing.slice(openEnd))
  }
  if (!enabled) return xml
  const fragment = name === 'underline'
    ? '<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>'
    : '<hh:strikeout shape="SOLID" color="#000000"/>'
  return insertCharacterChild(xml, name, fragment)
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

function hangulFontIds(headerXml: string): Set<string> {
  const spans = scanXmlElements(headerXml)
  const fontface = spans.find((span) =>
    span.name === 'hh:fontface' &&
    attribute(headerXml.slice(span.start, span.openEnd), 'lang') === 'HANGUL'
  )
  if (!fontface) return new Set()
  return new Set(directChildren(spans, fontface, 'hh:font').map((font) =>
    attribute(headerXml.slice(font.start, font.openEnd), 'id')
  ).filter((id): id is string => id !== undefined))
}

function setCharacterFontRef(xml: string, fontId?: string): string {
  if (fontId === undefined) return xml
  const pattern = characterChildPattern('fontRef')
  const existing = xml.match(pattern)?.[0]
  if (existing) {
    const openEnd = findTagEnd(existing, 0)
    return xml.replace(
      existing,
      setAttribute(existing.slice(0, openEnd), 'hangul', fontId) + existing.slice(openEnd)
    )
  }
  return insertCharacterChild(xml, 'fontRef', `<hh:fontRef hangul="${fontId}"/>`)
}

function setAlignment(xml: string, align: ParagraphAlignment): string {
  const alignPattern = /<hh:align(?:\s[^>]*)?\s*\/>/
  const existing = xml.match(alignPattern)?.[0]
  if (existing) return xml.replace(existing, setAttribute(existing, 'horizontal', align))
  return insertParagraphChild(xml, 'align', `<hh:align horizontal="${align}"/>`)
}

const paragraphChildOrder = ['align', 'heading', 'breakSetting', 'margin', 'lineSpacing', 'border', 'autoSpacing']

function paragraphChildPattern(name: string): RegExp {
  return new RegExp(`<hh:${name}(?:\\s[^>]*)?\\s*\\/>|<hh:${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/hh:${name}>`)
}

function insertParagraphChild(xml: string, name: string, fragment: string): string {
  const index = paragraphChildOrder.indexOf(name)
  for (const later of paragraphChildOrder.slice(index + 1)) {
    const match = paragraphChildPattern(later).exec(xml)
    if (match) return replaceRange(xml, match.index, match.index, fragment)
  }
  return xml.replace(/<\/hh:paraPr>\s*$/, `${fragment}</hh:paraPr>`)
}

function setHwpValueElement(xml: string, name: 'intent' | 'prev' | 'next', value: number): string {
  const pattern = new RegExp(`<hc:${name}(?:\\s[^>]*)?\\s*\\/>`)
  const existing = xml.match(pattern)?.[0]
  if (existing) {
    return xml.replace(existing, setAttribute(setAttribute(existing, 'value', String(value)), 'unit', 'HWPUNIT'))
  }
  return xml.replace(/<\/hh:margin>\s*$/, `<hc:${name} value="${value}" unit="HWPUNIT"/></hh:margin>`)
}

function setParagraphMetrics(
  xml: string,
  options: Pick<ApplyParagraphStyleCommand, 'lineSpacing' | 'indent' | 'marginBefore' | 'marginAfter'>
): string {
  let mutated = xml
  if (options.indent !== undefined || options.marginBefore !== undefined || options.marginAfter !== undefined) {
    const pattern = paragraphChildPattern('margin')
    const existing = mutated.match(pattern)?.[0]
    let margin = existing ?? '<hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="0" unit="HWPUNIT"/><hc:next value="0" unit="HWPUNIT"/></hh:margin>'
    if (options.indent !== undefined) margin = setHwpValueElement(margin, 'intent', options.indent)
    if (options.marginBefore !== undefined) margin = setHwpValueElement(margin, 'prev', options.marginBefore)
    if (options.marginAfter !== undefined) margin = setHwpValueElement(margin, 'next', options.marginAfter)
    mutated = existing ? mutated.replace(existing, margin) : insertParagraphChild(mutated, 'margin', margin)
  }
  if (options.lineSpacing !== undefined) {
    const pattern = paragraphChildPattern('lineSpacing')
    const existing = mutated.match(pattern)?.[0]
    const lineSpacing = existing
      ? setAttribute(
          setAttribute(setAttribute(existing, 'type', 'PERCENT'), 'value', String(options.lineSpacing)),
          'unit',
          'HWPUNIT'
        )
      : `<hh:lineSpacing type="PERCENT" value="${options.lineSpacing}" unit="HWPUNIT"/>`
    mutated = existing
      ? mutated.replace(existing, lineSpacing)
      : insertParagraphChild(mutated, 'lineSpacing', lineSpacing)
  }
  return mutated
}

function assertParagraphStructurePreserved(before: string, after: string): void {
  const tabPrBefore = attribute(before.slice(0, findTagEnd(before, 0)), 'tabPrIDRef')
  const tabPrAfter = attribute(after.slice(0, findTagEnd(after, 0)), 'tabPrIDRef')
  const headingBefore = before.match(paragraphChildPattern('heading'))?.[0]
  const headingAfter = after.match(paragraphChildPattern('heading'))?.[0]
  if (tabPrBefore !== tabPrAfter || headingBefore !== headingAfter) {
    throw new HwpxEditConflictError('문단 모양 변경 중 탭 또는 목록 구조가 달라져 적용을 중단했습니다.')
  }
}

function insertionGap(headerXml: string, collection: StyleCollection): string {
  const last = collection.definitions[collection.definitions.length - 1]
  const gap = headerXml.slice(last.span.end, collection.span.closeStart)
  return /^\s*$/.test(gap) ? gap : ''
}

function noChange(sourcePackage: HwpxSourcePackage): StylePatchResult {
  return {
    package: sourcePackage,
    lossReport: buildLossReport(sourcePackage, []),
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
  const context = locateTextStyleContext(
    sourcePackage,
    options.sectionPath,
    options.textNodeId,
    options.target
  )
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
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function legacyApplyCharacterStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyCharacterStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-character-style') throw new Error('지원하지 않는 글자 style command입니다.')
  if (
    command.bold === undefined && command.italic === undefined && command.underline === undefined &&
    command.strikeout === undefined && command.height === undefined && command.color === undefined &&
    command.fontId === undefined
  ) {
    throw new Error('적용할 글자 style 값이 없습니다.')
  }
  if (command.bold !== undefined && typeof command.bold !== 'boolean') {
    throw new Error('굵게 style 값이 올바르지 않습니다.')
  }
  for (const [label, value] of [
    ['기울임', command.italic],
    ['밑줄', command.underline],
    ['취소선', command.strikeout]
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} style 값이 올바르지 않습니다.`)
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
  if (command.fontId !== undefined) {
    if (!command.fontId || !hangulFontIds(
      sourcePackage.readEntry('Contents/header.xml').toString('utf8')
    ).has(command.fontId)) {
      throw new Error('문서에 선언되지 않은 한글 글꼴은 적용할 수 없습니다.')
    }
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
      !isSurrogateBoundarySafe(anchor.text, offset)
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
      let mutated = command.italic === undefined
        ? definition
        : setEmptyCharacterChild(definition, 'italic', command.italic)
      mutated = command.bold === undefined ? mutated : setEmptyCharacterChild(mutated, 'bold', command.bold)
      mutated = command.underline === undefined
        ? mutated
        : setLineDecoration(mutated, 'underline', command.underline)
      mutated = command.strikeout === undefined
        ? mutated
        : setLineDecoration(mutated, 'strikeout', command.strikeout)
      return setCharacterFontRef(setCharacterStyleAttributes(mutated, command), command.fontId)
    }
  })
  if (!styled.changed || from === to || (from === 0 && to === anchor.text.length)) return styled

  const originalSectionXml = sourcePackage.readEntry(command.sectionPath).toString('utf8')
  const originalContext = locateTextStyleContext(
    sourcePackage,
    command.sectionPath,
    command.textNodeId,
    'character'
  )
  const originalRun = originalSectionXml.slice(originalContext.run.start, originalContext.run.end)
  const contentStart = originalContext.textNode.openEnd - originalContext.run.start
  const contentEnd = originalContext.textNode.closeStart - originalContext.run.start
  const runOpenEnd = originalContext.run.openEnd - originalContext.run.start
  const withText = (text: string, openTag?: string): string => {
    const run = originalRun.slice(0, contentStart) + escapeXmlText(text) + originalRun.slice(contentEnd)
    return openTag ? openTag + run.slice(runOpenEnd) : run
  }

  const styledSectionXml = styled.package.readEntry(command.sectionPath).toString('utf8')
  const styledContext = locateTextStyleContext(
    styled.package,
    command.sectionPath,
    command.textNodeId,
    'character'
  )
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

export function legacyApplyParagraphStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: ApplyParagraphStyleCommand
): StylePatchResult {
  if (command.type !== 'apply-paragraph-style') throw new Error('지원하지 않는 문단 style command입니다.')
  if (
    command.align === undefined && command.lineSpacing === undefined && command.indent === undefined &&
    command.marginBefore === undefined && command.marginAfter === undefined
  ) {
    throw new Error('적용할 문단 style 값이 없습니다.')
  }
  if (command.align !== undefined && !(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFY'] as const).includes(command.align)) {
    throw new Error('문단 정렬 style 값이 올바르지 않습니다.')
  }
  if (
    command.lineSpacing !== undefined &&
    (!Number.isInteger(command.lineSpacing) || command.lineSpacing < 100 || command.lineSpacing > 300)
  ) {
    throw new Error('줄 간격은 100%에서 300% 사이여야 합니다.')
  }
  for (const [label, value] of [
    ['문단 앞 간격', command.marginBefore],
    ['문단 뒤 간격', command.marginAfter]
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 7200)) {
      throw new Error(`${label}은 0pt에서 72pt 사이여야 합니다.`)
    }
  }
  if (
    command.indent !== undefined &&
    (!Number.isInteger(command.indent) || command.indent < -7200 || command.indent > 7200)
  ) {
    throw new Error('첫 줄 들여쓰기는 -72pt에서 72pt 사이여야 합니다.')
  }
  return applyStyleDefinition(sourcePackage, {
    ...command,
    target: 'paragraph',
    collectionName: 'hh:paraProperties',
    definitionName: 'hh:paraPr',
    referenceAttribute: 'paraPrIDRef',
    mutate: (definition) => {
      const aligned = command.align === undefined ? definition : setAlignment(definition, command.align)
      const mutated = setParagraphMetrics(aligned, command)
      assertParagraphStructurePreserved(definition, mutated)
      return mutated
    }
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

export function legacyApplyRestoreStyleCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreStyleCommand
): StylePatchResult {
  if (command.type !== 'restore-style') throw new Error('지원하지 않는 style 복원 command입니다.')
  const context = locateTextStyleContext(
    sourcePackage,
    command.sectionPath,
    command.textNodeId,
    command.target
  )
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
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}

export function legacyApplyRestoreCharacterRunCommand(
  sourcePackage: HwpxSourcePackage,
  command: RestoreCharacterRunCommand
): StylePatchResult {
  if (command.type !== 'restore-character-run') {
    throw new Error('지원하지 않는 글자 run 복원 command입니다.')
  }
  const context = locateTextStyleContext(
    sourcePackage,
    command.sectionPath,
    command.textNodeId,
    'character'
  )
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
    lossReport: buildLossReport(sourcePackage, modifiedEntries),
    changed: true
  }
}
