import { HwpxSourcePackage } from '../parser/source_package'
import { HwpxEditConflictError, HwpxLossReport, listHwpxTextAnchors } from './text_patch'
import {
  attribute,
  buildLossReport,
  nearestAncestor,
  replaceRange,
  sameOrdinalMessage,
  scanXmlElements,
  setAttribute,
  TABLE_SCAN_OPTIONS,
  targetOrdinal,
  XmlElementSpan
} from './xml_scan'

export type CellBorderType = 'NONE' | 'SOLID'

export interface ApplyCellStyleCommand {
  type: 'apply-cell-style'
  sectionPath: string
  textNodeId: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  borderType?: CellBorderType
}

interface BorderFillHeaderMutation {
  headerPath: string
  expectedCollectionOpenTag: string
  replacementCollectionOpenTag: string
  fragment: string
  action: 'insert' | 'remove'
}

export interface RestoreCellStyleCommand {
  type: 'restore-cell-style'
  sectionPath: string
  textNodeId: string
  expectedCellOpenTag: string
  replacementCellOpenTag: string
  headerMutation?: BorderFillHeaderMutation
}

export interface CellStylePatchResult {
  package: HwpxSourcePackage
  inverse?: RestoreCellStyleCommand
  lossReport: HwpxLossReport
  changed: boolean
}

const CELL_ORDINAL_MESSAGES = sameOrdinalMessage((textNodeId) => `표 셀 anchor가 올바르지 않습니다: ${textNodeId}`)

function directChild(spans: XmlElementSpan[], parent: XmlElementSpan, name: string): XmlElementSpan | undefined {
  return spans.find((span) => span.name === name && span.parent?.start === parent.start)
}

function safeCellContext(sourcePackage: HwpxSourcePackage, sectionPath: string, textNodeId: string) {
  if (!listHwpxTextAnchors(sourcePackage, sectionPath).some((anchor) => anchor.textNodeId === textNodeId)) {
    throw new HwpxEditConflictError(`표 셀 anchor를 찾을 수 없습니다: ${textNodeId}`)
  }
  const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
  const spans = scanXmlElements(xml, TABLE_SCAN_OPTIONS)
  const textNode = spans.filter((span) => span.name === 'hp:t')[targetOrdinal(sectionPath, textNodeId, CELL_ORDINAL_MESSAGES)]
  const paragraph = textNode && nearestAncestor(textNode, 'hp:p')
  const subList = paragraph && nearestAncestor(paragraph, 'hp:subList')
  const cell = subList && nearestAncestor(subList, 'hp:tc')
  if (!textNode || !paragraph || !subList || !cell || subList.parent?.start !== cell.start) {
    throw new HwpxEditConflictError('표 셀 모양은 일반 body 셀에서만 편집할 수 있습니다.')
  }
  const cellOpenTag = xml.slice(cell.start, cell.openEnd)
  const span = directChild(spans, cell, 'hp:cellSpan')
  const spanTag = span ? xml.slice(span.start, span.openEnd) : ''
  if (
    attribute(cellOpenTag, 'header') === '1' ||
    Number(attribute(spanTag, 'rowSpan') ?? '1') !== 1 ||
    Number(attribute(spanTag, 'colSpan') ?? '1') !== 1
  ) {
    throw new HwpxEditConflictError('머리글 또는 병합된 표 셀의 모양은 아직 편집할 수 없습니다.')
  }
  const borderFillId = attribute(cellOpenTag, 'borderFillIDRef')
  if (!borderFillId) throw new HwpxEditConflictError('표 셀 borderFill 참조가 없습니다.')
  return { xml, cell, cellOpenTag, borderFillId }
}

function validateColor(value: string | undefined, label: string): void {
  if (value !== undefined && !/^#[0-9A-F]{6}$/i.test(value)) {
    throw new HwpxEditConflictError(`${label}은 #RRGGBB 형식이어야 합니다.`)
  }
}

function mutateBorderFill(fragment: string, command: ApplyCellStyleCommand): string {
  const spans = scanXmlElements(fragment, TABLE_SCAN_OPTIONS)
  let result = fragment
  const replacements: Array<{ start: number; end: number; value: string }> = []
  const fill = spans.find((span) => span.name === 'hc:winBrush')
  if (command.backgroundColor !== undefined) {
    if (!fill) throw new HwpxEditConflictError('기존 단색 채우기가 없는 셀은 아직 배경색을 바꿀 수 없습니다.')
    replacements.push({ start: fill.start, end: fill.openEnd, value: setAttribute(fragment.slice(fill.start, fill.openEnd), 'faceColor', command.backgroundColor.toUpperCase()) })
  }
  for (const name of ['hh:leftBorder', 'hh:rightBorder', 'hh:topBorder', 'hh:bottomBorder']) {
    const border = spans.find((span) => span.name === name)
    if (!border && (command.borderColor !== undefined || command.borderWidth !== undefined || command.borderType !== undefined)) {
      throw new HwpxEditConflictError('사방 테두리 정의가 완전하지 않은 셀은 아직 편집할 수 없습니다.')
    }
    if (!border) continue
    let tag = fragment.slice(border.start, border.openEnd)
    if (command.borderColor !== undefined) tag = setAttribute(tag, 'color', command.borderColor.toUpperCase())
    if (command.borderWidth !== undefined) tag = setAttribute(tag, 'width', String(command.borderWidth))
    if (command.borderType !== undefined) tag = setAttribute(tag, 'type', command.borderType)
    replacements.push({ start: border.start, end: border.openEnd, value: tag })
  }
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = replaceRange(result, replacement.start, replacement.end, replacement.value)
  }
  return result
}

export function applyCellStyleCommand(sourcePackage: HwpxSourcePackage, command: ApplyCellStyleCommand): CellStylePatchResult {
  validateColor(command.backgroundColor, '셀 배경색')
  validateColor(command.borderColor, '셀 테두리색')
  if (command.borderWidth !== undefined && (!Number.isFinite(command.borderWidth) || command.borderWidth < 0.1 || command.borderWidth > 5)) {
    throw new HwpxEditConflictError('셀 테두리 두께는 0.1mm 이상 5mm 이하여야 합니다.')
  }
  if (command.backgroundColor === undefined && command.borderColor === undefined && command.borderWidth === undefined && command.borderType === undefined) {
    throw new HwpxEditConflictError('변경할 표 셀 모양이 없습니다.')
  }
  const context = safeCellContext(sourcePackage, command.sectionPath, command.textNodeId)
  const headerPath = 'Contents/header.xml'
  const header = sourcePackage.readEntry(headerPath).toString('utf8')
  const spans = scanXmlElements(header, TABLE_SCAN_OPTIONS)
  const collection = spans.find((span) => span.name === 'hh:borderFills')
  const definitions = collection
    ? spans.filter((span) => span.name === 'hh:borderFill' && span.parent?.start === collection.start)
    : []
  const sourceDefinition = definitions.find((definition) => attribute(header.slice(definition.start, definition.openEnd), 'id') === context.borderFillId)
  if (!collection || !sourceDefinition) throw new HwpxEditConflictError('참조된 borderFill 정의를 찾을 수 없습니다.')
  const originalFragment = header.slice(sourceDefinition.start, sourceDefinition.end)
  const desiredWithoutId = mutateBorderFill(originalFragment, command)
  if (desiredWithoutId === originalFragment) {
    return { package: sourcePackage, lossReport: buildLossReport(sourcePackage, []), changed: false }
  }
  const comparable = (fragment: string) => fragment.replace(/(<hh:borderFill\b[^>]*\bid\s*=\s*)(["']).*?\2/, '$1$2__ID__$2')
  const reused = definitions.find((definition) => comparable(header.slice(definition.start, definition.end)) === comparable(desiredWithoutId))
  const maxId = definitions.reduce((max, definition) => Math.max(max, Number(attribute(header.slice(definition.start, definition.openEnd), 'id')) || 0), 0)
  const nextId = reused ? attribute(header.slice(reused.start, reused.openEnd), 'id')! : String(maxId + 1)
  const desiredFragment = setAttribute(desiredWithoutId.slice(0, desiredWithoutId.indexOf('>') + 1), 'id', nextId) + desiredWithoutId.slice(desiredWithoutId.indexOf('>') + 1)
  const replacementCellOpenTag = setAttribute(context.cellOpenTag, 'borderFillIDRef', nextId)
  let currentPackage = sourcePackage
  let headerMutation: BorderFillHeaderMutation | undefined
  if (!reused) {
    const collectionOpenTag = header.slice(collection.start, collection.openEnd)
    const count = Number(attribute(collectionOpenTag, 'itemCnt') ?? definitions.length)
    if (!Number.isSafeInteger(count) || count < definitions.length) {
      throw new HwpxEditConflictError('borderFill collection 개수가 올바르지 않습니다.')
    }
    const replacementCollectionOpenTag = setAttribute(collectionOpenTag, 'itemCnt', String(count + 1))
    const nextHeader = replaceRange(
      replaceRange(header, collection.start, collection.openEnd, replacementCollectionOpenTag),
      collection.closeStart + replacementCollectionOpenTag.length - collectionOpenTag.length,
      collection.closeStart + replacementCollectionOpenTag.length - collectionOpenTag.length,
      desiredFragment
    )
    currentPackage = currentPackage.withEntry(headerPath, Buffer.from(nextHeader))
    headerMutation = { headerPath, expectedCollectionOpenTag: replacementCollectionOpenTag, replacementCollectionOpenTag: collectionOpenTag, fragment: desiredFragment, action: 'remove' }
  }
  const nextSection = replaceRange(context.xml, context.cell.start, context.cell.openEnd, replacementCellOpenTag)
  currentPackage = currentPackage.withEntry(command.sectionPath, Buffer.from(nextSection))
  return {
    package: currentPackage,
    inverse: {
      type: 'restore-cell-style',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedCellOpenTag: replacementCellOpenTag,
      replacementCellOpenTag: context.cellOpenTag,
      headerMutation
    },
    lossReport: buildLossReport(sourcePackage, headerMutation ? [headerPath, command.sectionPath] : [command.sectionPath]),
    changed: true
  }
}

export function applyRestoreCellStyleCommand(sourcePackage: HwpxSourcePackage, command: RestoreCellStyleCommand): CellStylePatchResult {
  const context = safeCellContext(sourcePackage, command.sectionPath, command.textNodeId)
  if (context.cellOpenTag !== command.expectedCellOpenTag) throw new HwpxEditConflictError('표 셀 모양 reference가 변경되어 undo/redo할 수 없습니다.')
  let currentPackage = sourcePackage
  const modified: string[] = []
  if (command.headerMutation) {
    const mutation = command.headerMutation
    const header = currentPackage.readEntry(mutation.headerPath).toString('utf8')
    const collectionIndex = header.indexOf(mutation.expectedCollectionOpenTag)
    if (collectionIndex < 0) throw new HwpxEditConflictError('borderFill collection이 변경되어 undo/redo할 수 없습니다.')
    let nextHeader = replaceRange(header, collectionIndex, collectionIndex + mutation.expectedCollectionOpenTag.length, mutation.replacementCollectionOpenTag)
    if (mutation.action === 'remove') {
      const fragmentIndex = nextHeader.indexOf(mutation.fragment)
      if (fragmentIndex < 0) throw new HwpxEditConflictError('추가한 borderFill을 찾을 수 없습니다.')
      nextHeader = replaceRange(nextHeader, fragmentIndex, fragmentIndex + mutation.fragment.length, '')
    } else {
      const collection = scanXmlElements(nextHeader, TABLE_SCAN_OPTIONS).find((span) => span.name === 'hh:borderFills')
      if (!collection) throw new HwpxEditConflictError('borderFill collection을 찾을 수 없습니다.')
      nextHeader = replaceRange(nextHeader, collection.closeStart, collection.closeStart, mutation.fragment)
    }
    currentPackage = currentPackage.withEntry(mutation.headerPath, Buffer.from(nextHeader))
    modified.push(mutation.headerPath)
  }
  const nextSection = replaceRange(context.xml, context.cell.start, context.cell.openEnd, command.replacementCellOpenTag)
  currentPackage = currentPackage.withEntry(command.sectionPath, Buffer.from(nextSection))
  modified.push(command.sectionPath)
  return {
    package: currentPackage,
    inverse: {
      type: 'restore-cell-style',
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      expectedCellOpenTag: command.replacementCellOpenTag,
      replacementCellOpenTag: command.expectedCellOpenTag,
      headerMutation: command.headerMutation ? {
        ...command.headerMutation,
        expectedCollectionOpenTag: command.headerMutation.replacementCollectionOpenTag,
        replacementCollectionOpenTag: command.headerMutation.expectedCollectionOpenTag,
        action: command.headerMutation.action === 'remove' ? 'insert' : 'remove'
      } : undefined
    },
    lossReport: buildLossReport(sourcePackage, modified),
    changed: true
  }
}
