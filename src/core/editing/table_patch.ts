import { HwpxSourcePackage } from '../parser/source_package'
import { EditorSelection, normalizeEditorSelection } from './selection'
import { HwpxEditConflictError, HwpxLossReport, listHwpxTextAnchors } from './text_patch'

export interface ReplaceTableFragmentCommand {
  type: 'replace-table-fragment'
  sectionPath: string
  textNodeId: string
  expectedFragment: string
  replacementFragment: string
}

export interface InsertTableRowPlan {
  command: ReplaceTableFragmentCommand
  selectionAfter: EditorSelection
}

interface XmlElementSpan {
  name: string
  start: number
  openEnd: number
  closeStart: number
  end: number
  parent?: XmlElementSpan
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined
  for (let index = start + 1; index < xml.length; index += 1) {
    const value = xml[index]
    if (quote) {
      if (value === quote) quote = undefined
    } else if (value === '"' || value === "'") quote = value
    else if (value === '>') return index + 1
  }
  throw new HwpxEditConflictError('끝나지 않은 XML tag가 있습니다.')
}

function scanXmlElements(xml: string): XmlElementSpan[] {
  const spans: XmlElementSpan[] = []
  const stack: Array<{ name: string; start: number; openEnd: number; parent?: XmlElementSpan }> = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4)
      if (end < 0) throw new HwpxEditConflictError('끝나지 않은 XML comment가 있습니다.')
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2)
      if (end < 0) throw new HwpxEditConflictError('끝나지 않은 XML 선언이 있습니다.')
      cursor = end + 2
      continue
    }
    const openEnd = findTagEnd(xml, start)
    const tag = xml.slice(start, openEnd)
    if (tag.startsWith('<!')) {
      cursor = openEnd
      continue
    }
    const closing = /^<\s*\//.test(tag)
    const name = tag.match(closing ? /^<\s*\/\s*([^\s>]+)/ : /^<\s*([^\s/>]+)/)?.[1]
    if (!name) throw new HwpxEditConflictError('해석할 수 없는 XML tag가 있습니다.')
    const selfClosing = !closing && /\/\s*>$/.test(tag)
    if (closing) {
      const open = stack.pop()
      if (!open || open.name !== name) throw new HwpxEditConflictError('XML tag 순서가 올바르지 않습니다.')
      spans.push({ name, start: open.start, openEnd: open.openEnd, closeStart: start, end: openEnd, parent: open.parent })
    } else if (selfClosing) {
      spans.push({ name, start, openEnd, closeStart: openEnd, end: openEnd, parent: stack.at(-1) as XmlElementSpan | undefined })
    } else {
      const parent = stack.at(-1)
      stack.push({
        name,
        start,
        openEnd,
        parent: parent ? { name: parent.name, start: parent.start, openEnd: parent.openEnd, closeStart: -1, end: -1, parent: parent.parent } : undefined
      })
    }
    cursor = openEnd
  }
  if (stack.length) throw new HwpxEditConflictError('끝나지 않은 XML element가 있습니다.')
  const byStart = new Map(spans.map((span) => [span.start, span]))
  spans.forEach((span) => { if (span.parent) span.parent = byStart.get(span.parent.start) })
  return spans.sort((left, right) => left.start - right.start)
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`\\s${escaped}\\s*=\\s*(["'])(.*?)\\1`))?.[2]
}

function setAttribute(tag: string, name: string, value: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(\\s${escaped}\\s*=\\s*)(["'])(.*?)\\2`)
  return pattern.test(tag)
    ? tag.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${value}${quote}`)
    : tag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`)
}

function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
}

function nearestAncestor(span: XmlElementSpan, name: string): XmlElementSpan | undefined {
  let current = span.parent
  while (current) {
    if (current.name === name) return current
    current = current.parent
  }
  return undefined
}

function directChildren(spans: XmlElementSpan[], parent: XmlElementSpan, name: string): XmlElementSpan[] {
  return spans.filter((span) => span.name === name && span.parent?.start === parent.start)
}

function targetOrdinal(sectionPath: string, textNodeId: string): number {
  const prefix = `${sectionPath}#hp:t:`
  const ordinal = textNodeId.startsWith(prefix) ? Number(textNodeId.slice(prefix.length)) : Number.NaN
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new HwpxEditConflictError('표 anchor가 올바르지 않습니다.')
  return ordinal
}

function locateTable(sourcePackage: HwpxSourcePackage, sectionPath: string, textNodeId: string) {
  if (!listHwpxTextAnchors(sourcePackage, sectionPath).some((anchor) => anchor.textNodeId === textNodeId)) {
    throw new HwpxEditConflictError('표 anchor를 찾을 수 없습니다.')
  }
  const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
  const spans = scanXmlElements(xml)
  const text = spans.filter((span) => span.name === 'hp:t')[targetOrdinal(sectionPath, textNodeId)]
  const cell = text && nearestAncestor(text, 'hp:tc')
  const row = cell && nearestAncestor(cell, 'hp:tr')
  const table = row && nearestAncestor(row, 'hp:tbl')
  if (!text || !cell || !row || !table || row.parent?.start !== table.start || cell.parent?.start !== row.start) {
    throw new HwpxEditConflictError('표 행 추가는 일반 표 셀에서만 지원합니다.')
  }
  return { xml, spans, text, cell, row, table }
}

function assertSimpleRectangularTable(context: ReturnType<typeof locateTable>): {
  rows: XmlElementSpan[]
  columnCount: number
  selectedRowIndex: number
  selectedRowHeight: number
} {
  const { xml, spans, table, row: selectedRow, cell: selectedCell } = context
  const tableTag = xml.slice(table.start, table.openEnd)
  const rowCount = Number(attribute(tableTag, 'rowCnt'))
  const columnCount = Number(attribute(tableTag, 'colCnt'))
  const rows = directChildren(spans, table, 'hp:tr')
  const tableSize = directChildren(spans, table, 'hp:sz')[0]
  const tableHeight = tableSize
    ? Number(attribute(xml.slice(tableSize.start, tableSize.openEnd), 'height'))
    : Number.NaN
  if (!Number.isSafeInteger(rowCount) || rowCount !== rows.length || !Number.isSafeInteger(columnCount) || columnCount < 1) {
    throw new HwpxEditConflictError('표 행·열 개수와 실제 구조가 일치하지 않습니다.')
  }
  if (!Number.isFinite(tableHeight) || tableHeight < 0) {
    throw new HwpxEditConflictError('표 전체 높이가 올바르지 않습니다.')
  }
  if (spans.some((span) => span.name === 'hp:tbl' && span.start > table.start && span.end < table.end)) {
    throw new HwpxEditConflictError('중첩 표가 있는 표에는 아직 행을 추가할 수 없습니다.')
  }
  let selectedRowHeight = 0
  rows.forEach((row, rowIndex) => {
    if (attribute(xml.slice(row.start, row.openEnd), 'id') !== undefined) {
      throw new HwpxEditConflictError('고유 ID가 있는 행은 아직 복제할 수 없습니다.')
    }
    const cells = directChildren(spans, row, 'hp:tc')
    if (cells.length !== columnCount) throw new HwpxEditConflictError('직사각형 표에만 행을 추가할 수 있습니다.')
    cells.forEach((cell, columnIndex) => {
      const cellTag = xml.slice(cell.start, cell.openEnd)
      if (attribute(cellTag, 'id') !== undefined) {
        throw new HwpxEditConflictError('고유 ID가 있는 셀은 아직 복제할 수 없습니다.')
      }
      const address = directChildren(spans, cell, 'hp:cellAddr')[0]
      const span = directChildren(spans, cell, 'hp:cellSpan')[0]
      const cellSize = directChildren(spans, cell, 'hp:cellSz')[0]
      const addressTag = address ? xml.slice(address.start, address.openEnd) : ''
      const spanTag = span ? xml.slice(span.start, span.openEnd) : ''
      if (
        !address || !span || !cellSize ||
        Number(attribute(addressTag, 'rowAddr')) !== rowIndex ||
        Number(attribute(addressTag, 'colAddr')) !== columnIndex ||
        Number(attribute(spanTag, 'rowSpan')) !== 1 ||
        Number(attribute(spanTag, 'colSpan')) !== 1
      ) throw new HwpxEditConflictError('병합·span 또는 불연속 주소가 있는 표에는 아직 행을 추가할 수 없습니다.')
      const cellHeight = Number(attribute(xml.slice(cellSize.start, cellSize.openEnd), 'height'))
      if (!Number.isFinite(cellHeight) || cellHeight < 0) {
        throw new HwpxEditConflictError('표 셀 높이가 올바르지 않습니다.')
      }
      if (row.start === selectedRow.start) selectedRowHeight = Math.max(selectedRowHeight, cellHeight)
      const subLists = directChildren(spans, cell, 'hp:subList')
      if (subLists.length !== 1) throw new HwpxEditConflictError('단순 텍스트 셀로 이루어진 표에만 행을 추가할 수 있습니다.')
      const paragraphs = directChildren(spans, subLists[0], 'hp:p')
      if (!paragraphs.length) throw new HwpxEditConflictError('빈 문단 구조가 없는 셀에는 행을 추가할 수 없습니다.')
      const content = spans.filter(
        (span) => span.start >= subLists[0].openEnd && span.end <= subLists[0].closeStart
      )
      if (content.some((span) => ![
        'hp:p', 'hp:run', 'hp:t', 'hp:linesegarray', 'hp:lineseg'
      ].includes(span.name))) {
        throw new HwpxEditConflictError('이미지·제어 문자 등 복합 콘텐츠가 있는 표에는 아직 행을 추가할 수 없습니다.')
      }
      paragraphs.forEach((paragraph) => {
        const runs = directChildren(spans, paragraph, 'hp:run')
        const texts = runs.flatMap((run) => directChildren(spans, run, 'hp:t'))
        if (runs.length !== 1 || texts.length !== 1) {
          throw new HwpxEditConflictError('복합 콘텐츠가 있는 표에는 아직 행을 추가할 수 없습니다.')
        }
      })
      if (cell.start === selectedCell.start && attribute(cellTag, 'header') === '1') {
        throw new HwpxEditConflictError('반복 머리글 행을 기준으로 행을 추가할 수 없습니다.')
      }
    })
  })
  const selectedRowIndex = rows.findIndex((row) => row.start === selectedRow.start)
  if (selectedRowIndex < 0) throw new HwpxEditConflictError('선택한 표 행을 찾을 수 없습니다.')
  return { rows, columnCount, selectedRowIndex, selectedRowHeight }
}

function cloneEmptyRow(context: ReturnType<typeof locateTable>, newRowIndex: number): string {
  const { xml, spans, row } = context
  const fragment = xml.slice(row.start, row.end)
  const localSpans = scanXmlElements(fragment)
  const replacements: Array<{ start: number; end: number; value: string }> = []
  for (const address of localSpans.filter((span) => span.name === 'hp:cellAddr')) {
    replacements.push({
      start: address.start,
      end: address.openEnd,
      value: setAttribute(fragment.slice(address.start, address.openEnd), 'rowAddr', String(newRowIndex))
    })
  }
  for (const text of localSpans.filter((span) => span.name === 'hp:t')) {
    replacements.push({ start: text.openEnd, end: text.closeStart, value: '' })
  }
  for (const lines of localSpans.filter((span) => span.name === 'hp:linesegarray')) {
    replacements.push({ start: lines.start, end: lines.end, value: '' })
  }
  const ids = spans.filter((span) => span.name === 'hp:p')
    .map((paragraph) => attribute(xml.slice(paragraph.start, paragraph.openEnd), 'id'))
    .filter((id): id is string => id !== undefined)
  if (ids.some((id) => !/^\d+$/.test(id))) throw new HwpxEditConflictError('숫자가 아닌 문단 ID가 있는 표에는 행을 추가할 수 없습니다.')
  let nextId = ids.map(Number).reduce((maximum, id) => Math.max(maximum, id), -1) + 1
  for (const paragraph of localSpans.filter((span) => span.name === 'hp:p')) {
    const tag = fragment.slice(paragraph.start, paragraph.openEnd)
    if (attribute(tag, 'id') !== undefined) {
      replacements.push({ start: paragraph.start, end: paragraph.openEnd, value: setAttribute(tag, 'id', String(nextId++)) })
    }
  }
  let result = fragment
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = replaceRange(result, replacement.start, replacement.end, replacement.value)
  }
  return result
}

export function planInsertTableRowAfter(sourcePackage: HwpxSourcePackage, selection: EditorSelection): InsertTableRowPlan {
  const normalized = normalizeEditorSelection(sourcePackage, selection)
  const context = locateTable(sourcePackage, selection.sectionPath, normalized.start.textNodeId)
  const endContext = locateTable(sourcePackage, selection.sectionPath, normalized.end.textNodeId)
  if (
    context.table.start !== endContext.table.start ||
    context.row.start !== endContext.row.start ||
    context.cell.start !== endContext.cell.start
  ) throw new HwpxEditConflictError('행 추가는 하나의 표 셀에서만 실행할 수 있습니다.')
  const { rows, selectedRowIndex, selectedRowHeight } = assertSimpleRectangularTable(context)
  const tableFragment = context.xml.slice(context.table.start, context.table.end)
  let replacement = tableFragment
  const tableStart = context.table.start
  const edits: Array<{ start: number; end: number; value: string }> = []
  const tableTag = context.xml.slice(context.table.start, context.table.openEnd)
  edits.push({ start: 0, end: context.table.openEnd - tableStart, value: setAttribute(tableTag, 'rowCnt', String(rows.length + 1)) })
  const tableSize = directChildren(context.spans, context.table, 'hp:sz')[0]
  const tableSizeTag = context.xml.slice(tableSize.start, tableSize.openEnd)
  const tableHeight = Number(attribute(tableSizeTag, 'height'))
  edits.push({
    start: tableSize.start - tableStart,
    end: tableSize.openEnd - tableStart,
    value: setAttribute(tableSizeTag, 'height', String(tableHeight + selectedRowHeight))
  })
  for (let index = selectedRowIndex + 1; index < rows.length; index += 1) {
    for (const cell of directChildren(context.spans, rows[index], 'hp:tc')) {
      const address = directChildren(context.spans, cell, 'hp:cellAddr')[0]
      const tag = context.xml.slice(address.start, address.openEnd)
      edits.push({
        start: address.start - tableStart,
        end: address.openEnd - tableStart,
        value: setAttribute(tag, 'rowAddr', String(index + 1))
      })
    }
  }
  const insertionPoint = rows[selectedRowIndex].end - tableStart
  edits.push({ start: insertionPoint, end: insertionPoint, value: cloneEmptyRow(context, selectedRowIndex + 1) })
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    replacement = replaceRange(replacement, edit.start, edit.end, edit.value)
  }
  return {
    command: {
      type: 'replace-table-fragment',
      sectionPath: selection.sectionPath,
      textNodeId: normalized.start.textNodeId,
      expectedFragment: tableFragment,
      replacementFragment: replacement
    },
    selectionAfter: { ...selection }
  }
}

function report(sourcePackage: HwpxSourcePackage, sectionPath: string): HwpxLossReport {
  const entries = sourcePackage.listEntries().map((entry) => entry.path)
  return {
    preservedEntries: entries.filter((path) => path !== sectionPath),
    modifiedEntries: [sectionPath],
    regeneratedEntries: [],
    omittedEntries: [],
    unsupportedFeatures: [],
    previewStatus: entries.some((path) => path.startsWith('Preview/')) ? 'stale' : 'omitted'
  }
}

export function applyReplaceTableFragmentCommand(sourcePackage: HwpxSourcePackage, command: ReplaceTableFragmentCommand) {
  const context = locateTable(sourcePackage, command.sectionPath, command.textNodeId)
  const current = context.xml.slice(context.table.start, context.table.end)
  if (current !== command.expectedFragment) throw new HwpxEditConflictError('표 구조가 변경되어 행 추가를 적용할 수 없습니다.')
  if (command.expectedFragment === command.replacementFragment) {
    return { package: sourcePackage, lossReport: report(sourcePackage, command.sectionPath), changed: false }
  }
  const nextXml = replaceRange(context.xml, context.table.start, context.table.end, command.replacementFragment)
  return {
    package: sourcePackage.withEntry(command.sectionPath, Buffer.from(nextXml)),
    inverse: {
      ...command,
      expectedFragment: command.replacementFragment,
      replacementFragment: command.expectedFragment
    },
    lossReport: report(sourcePackage, command.sectionPath),
    changed: true
  }
}
