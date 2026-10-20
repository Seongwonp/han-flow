import { paragraphFootnotes, supportsViewerColumnFlow, ViewerColumnLayout, viewerColumnWidths, ViewerContent, ViewerDocument, ViewerNote, ViewerParagraph, ViewerSection, ViewerTable, ViewerTableRow } from '../document/viewer_document'
import { balancedColumnStarts, columnWidthKey } from './column_layout'
import { footnoteMarker } from '../document/note_number'
import { cellOccupiedHeight, findSplittableCell, ParagraphHeights, tableSupportsCellSplitting } from './cell_fragment'
import {
  estimatedNoteMetrics,
  fitNoteCursor,
  footnoteAreaHeight,
  noteCursorY,
  noteFragmentPieces,
  sectionFootnoteSettings,
  ViewerNoteMetrics,
  ViewerPageFootnote
} from './footnote_layout'
import { blockBandFlowKind, blockObjectBands, flowBlockEnd, mergePageBands, PageBand, pageBandsHeight, PageFrame, tableInFlow } from './object_position'

/**
 * 쪽 안 다단 영역 하나. 구역 중간에서 다단 정의가 바뀌면(`ViewerParagraph.columnLayout`) 한 쪽에 영역이 위에서부터 여럿 놓인다.
 * - `columnLayout`이 없으면 단이 하나다. `columns`는 흐름 순서(0번이 첫 단)다.
 * - `top`은 쪽 본문 위 끝에서 잰 영역 위 끝, `height`는 같은 쪽에서 뒤 영역이 이어지는 영역의 높이다(마지막 영역은 쪽 본문 끝까지라 없다).
 */
export interface ViewerColumnRegion {
  columnLayout?: ViewerColumnLayout
  columns: ViewerParagraph[][]
  top: number
  height?: number
}

export interface ViewerPage {
  blocks: ViewerParagraph[]
  /** 쪽 전체가 다단 영역 하나일 때의 단(흐름 순서)과 다단 정의. 영역이 여럿이면 `regions`를 쓴다. */
  columns?: ViewerParagraph[][]
  columnLayout?: ViewerColumnLayout
  /** 다단 영역이 둘 이상인 쪽의 영역(위에서부터). 각주(`footnotes`)는 마지막 영역의 단마다 놓는다. */
  regions?: ViewerColumnRegion[]
  /**
   * 쪽 아래 각주 조각. 단마다 하나씩(단이 하나면 `[0]`만) 있고, 각주가 없는 쪽은 undefined다. 본문은 이 높이만큼 줄어든다.
   */
  footnotes?: ViewerPageFootnote[][]
  /**
   * 이 쪽에 놓인 용지·쪽 기준 개체(자리 차지·글 옆 배치)가 쪽 본문에서 비우는 세로 띠(쪽 본문 기준, 합친 뒤 위에서부터).
   * 본문은 띠 높이만큼 줄어들고 renderer는 같은 띠를 본문 DOM에서 비운다(`pageBandLayout`). 띠가 없으면 undefined다.
   */
  bands?: PageBand[]
  sectionIndex: number
  sectionPageIndex: number
}

export interface LayoutMeasurements {
  blockHeights: Record<string, number>
  tableRowHeights: Record<string, number>
  /** 각주(`ViewerNote.sourcePath`)마다 화면에서 잰 높이와 나눌 수 있는 자리. 없으면 decoder 줄 배치 높이로 어림한다. */
  noteMetrics?: Record<string, ViewerNoteMetrics>
  /**
   * 다단 영역의 첫 단과 너비가 다른 단(서로 다른 너비 `hp:colSz`)에서 잰 높이. key는 단 너비(`columnWidthKey`)다. `blockHeights`·
   * `tableRowHeights`는 영역 첫 단 너비로 잰 값이고, 다른 너비 단에 놓는 block은 여기 값을 먼저 쓴다.
   */
  columnHeights?: Record<string, { blockHeights: Record<string, number>; tableRowHeights: Record<string, number> }>
}

/** 쪽의 다단 영역(위에서부터). 영역 정보가 없는 쪽은 `columns`(없으면 본문 전체)를 영역 하나로 본다. */
export function pageColumnRegions(page: Pick<ViewerPage, 'blocks' | 'columns' | 'columnLayout' | 'regions'>): ViewerColumnRegion[] {
  if (page.regions) return page.regions
  if (page.columns && page.columnLayout) return [{ columnLayout: page.columnLayout, columns: page.columns, top: 0 }]
  return [{ columns: [page.blocks], top: 0 }]
}

function declaredRowHeight(row: ViewerTableRow): number {
  return Math.max(...row.cells.map((cell) => Math.max(
    cell.height,
    cell.paragraphs.reduce((sum, paragraph) => sum + paragraph.layoutHeight, 0)
  )), 0)
}

function rowHeight(table: ViewerTable, row: ViewerTableRow, rowIndex: number, measurements?: LayoutMeasurements): number {
  if (row.fragmentHeight !== undefined && Number.isFinite(row.fragmentHeight)) return Math.max(row.fragmentHeight, 0)
  const sourceRow = row.cells[0]?.row ?? rowIndex
  return measurements?.tableRowHeights[`${table.id}:r${sourceRow}`] ?? declaredRowHeight(row)
}

/** 쪽 사이에서 나눌 수 있는 문단 흐름 안 표. 원본 위치로 그리는 흐름 밖·글 옆 표는 나누지 않는다(`object_position.ts`). */
function tableOf(block: ViewerParagraph): ViewerTable | undefined {
  return block.content.find((content): content is ViewerTable => tableInFlow(content))
}

function splitRow(row: ViewerTableRow, cellIndex: number, headParagraphs: ViewerParagraph[], tailParagraphs: ViewerParagraph[], heights: ParagraphHeights): [ViewerTableRow, ViewerTableRow] {
  const headCells = row.cells.map((cell, index) => ({
    ...cell,
    paragraphs: index === cellIndex ? headParagraphs : cell.paragraphs,
    splitBottom: true
  }))
  const tailCells = row.cells.map((cell, index) => ({
    ...cell,
    paragraphs: index === cellIndex ? tailParagraphs : [],
    splitTop: true
  }))
  return [
    { cells: headCells, fragmentHeight: Math.max(...headCells.map((cell) => cellOccupiedHeight(cell, heights)), 0) },
    { cells: tailCells, fragmentHeight: Math.max(...tailCells.map((cell) => cellOccupiedHeight(cell, heights)), 0) }
  ]
}

/** @internal section pagination 동치 test가 이전 문서 단위 pagination을 재현할 때 쓴다. */
export function fragmentTableBlock(block: ViewerParagraph, firstCapacity: number, pageCapacity: number, measurements?: LayoutMeasurements): ViewerParagraph[] {
  const table = tableOf(block)
  if (!table || table.pageBreak !== 'CELL' || table.rows.length < 2) return [block]
  const heights = table.rows.map((row, index) => rowHeight(table, row, index, measurements))
  const totalHeight = heights.reduce((sum, height) => sum + height, 0)
  const naturalBreakIndex = heights.findIndex((height, index) =>
    index > 0 &&
    heights[index - 1] > pageCapacity * 0.25 &&
    heights.slice(index).reduce((sum, value) => sum + value, 0) > pageCapacity * 0.25 &&
    height < heights[index - 1] * 0.5
  )
  if (measurements ? totalHeight <= firstCapacity : naturalBreakIndex < 0 && totalHeight <= pageCapacity) return [block]

  const fragments: ViewerParagraph[] = []
  const headerRows = table.repeatHeader ? table.rows.filter((row) => row.cells.some((cell) => cell.header)) : []
  const bodyRows = table.rows.filter((row) => !headerRows.includes(row))
  const allowsCellSplitting = Boolean(measurements && tableSupportsCellSplitting(table))
  let currentRows: ViewerTableRow[] = [...headerRows]
  let used = headerRows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
  let capacity = firstCapacity

  const flush = () => {
    if (!currentRows.length) return
    const fragmentIndex = fragments.length
    const rows = fragmentIndex > 0 ? [...headerRows, ...currentRows] : currentRows
    const fragmentHeight = rows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
    const fragmentTable: ViewerTable = { ...table, id: `${table.id}:fragment${fragmentIndex}`, rows, rowCount: rows.length, height: fragmentHeight }
    fragments.push({ ...block, id: `${block.id}:fragment${fragmentIndex}`, pageBreak: fragmentIndex > 0, layoutHeight: fragmentTable.height ?? 0, content: block.content.map((content) => content === table ? fragmentTable : content) })
    currentRows = []
    used = headerRows.reduce((sum, row, index) => sum + rowHeight(table, row, index, measurements), 0)
    capacity = pageCapacity
  }

  bodyRows.forEach((sourceRow, rowIndex) => {
    if (!measurements && rowIndex === naturalBreakIndex && currentRows.length) flush()
    let row = sourceRow
    while (true) {
      const height = rowHeight(table, row, table.rows.indexOf(sourceRow), measurements)
      if (used + height <= capacity) {
        currentRows.push(row)
        used += height
        break
      }

      const remaining = capacity - used
      const split = allowsCellSplitting && remaining > 0
        ? findSplittableCell(row, remaining, measurements!.blockHeights)
        : undefined
      if (split) {
        const [head, tail] = splitRow(row, split.cellIndex, split.head, split.tail, measurements!.blockHeights)
        currentRows.push(head)
        used += head.fragmentHeight ?? 0
        flush()
        row = tail
        continue
      }

      if (currentRows.length) {
        flush()
        continue
      }
      currentRows.push(row)
      used += height
      break
    }
  })
  flush()
  if (fragments.length < 2) return [block]
  // 표와 같은 문단에 든 다른 content(표 앞·뒤 글자 등)는 조각마다 되풀이하지 않는다. 표 앞 content는 첫 조각에,
  // 표 뒤 content는 마지막 조각에만 둔다(편집 입력 surface의 source anchor가 한 화면에 두 번 나오지 않게 한다).
  const tableIndex = block.content.indexOf(table)
  const last = fragments.length - 1
  return fragments.map((fragment, fragmentIndex) => ({
    ...fragment,
    content: fragment.content.filter((_content, index) =>
      index === tableIndex || (index < tableIndex ? fragmentIndex === 0 : fragmentIndex === last)
    )
  }))
}

export function paginateDocument(document: ViewerDocument): ViewerParagraph[][] {
  return paginateViewerDocument(document).map((page) => page.blocks)
}

export function paginateViewerDocument(document: ViewerDocument, measurements?: LayoutMeasurements): ViewerPage[] {
  const availableHeight = pageBodyHeight(document)
  return document.sections.flatMap((section, sectionIndex) =>
    paginateViewerSection(section, sectionIndex, availableHeight, measurements, document.page)
  )
}

/** pagination이 쓰는 쪽 본문 높이(HWPUNIT). */
export function pageBodyHeight(document: Pick<ViewerDocument, 'page'>): number {
  return document.page.height - document.page.margin.top - document.page.margin.bottom
}

/** 아직 쪽(단) 아래에 다 놓지 못한 각주와 다음 조각이 시작할 경계(`ViewerNoteMetrics.breaks` index, -1은 처음). */
interface PendingFootnote {
  note: ViewerNote
  metrics: ViewerNoteMetrics
  cursor: number
}

/** pagination 중인 쪽의 다단 영역. `ends`는 단마다 채운 높이(쪽 본문 위 끝 기준)다. */
interface RegionState {
  layout?: ViewerColumnLayout
  columns: ViewerParagraph[][]
  ends: number[]
  top: number
  /** 영역이 시작할 때까지 쪽에 놓인 개체 띠 높이. 그 뒤 띠는 영역의 모든 단에서 본문을 줄인다. */
  startBands: number
  /** 단 나눔·원본 줄 배치로 단을 넘겼는지. 그러면 원본 단 나눔을 그대로 두고 높이를 맞추지 않는다. */
  forced: boolean
  /** 이 영역의 단 아래에 각주가 놓였는지. 그러면 각주가 따라가야 하므로 높이를 맞추지 않는다. */
  hasNotes: boolean
  height?: number
}

/** 단이 여럿인 다단 정의만 다단 영역으로 쓴다. 한 단 정의(`colCount="1"`)는 단 하나다. */
function flowLayout(layout: ViewerColumnLayout | undefined): ViewerColumnLayout | undefined {
  return supportsViewerColumnFlow(layout) ? layout : undefined
}

/**
 * section 하나를 쪽으로 나눈다. section은 언제나 새 쪽에서 시작하고(앞 section의 남은 쪽을 먼저 내보낸다) 다단 상태·
 * 원본 줄 배치 위치도 section마다 처음부터 센다. 그래서 문서 pagination은 section별 결과를 이어 붙인 것과 같고,
 * 편집으로 section 하나만 바뀌면 그 section만 다시 나누면 된다(`paginateViewerSectionsIncremental`).
 *
 * 다단(`hp:colPr`)은 흐름 순서로 단을 채운다(배치 `LEFT`·`RIGHT`·`MIRROR`는 renderer가 단 위치만 바꾼다).
 * - 단 나눔(`columnBreak`)과 측정값이 있을 때 원본 줄 배치가 위로 되돌아가는 문단은 다음 단(마지막 단이면 다음 쪽)으로 간다.
 *   평행 다단(`PARALLEL`)의 마지막 단 단 나눔은 같은 쪽에서 가장 긴 단 아래에 같은 다단의 새 줄을 시작한다.
 * - 구역 중간의 새 다단 정의(`ViewerParagraph.columnLayout`)는 같은 쪽에서 앞 영역 아래에 새 영역을 시작한다. 앞 영역은 단 높이를
 *   고르게 맞춘다(배분). 배분 다단(`BALANCED_NEWSPAPER`)은 구역 끝 쪽에서도 맞춘다. 평행 다단, 단 나눔으로 단을 넘겼거나 각주가
 *   있는 영역은 맞추지 않는다.
 * - 서로 다른 너비 단은 그 단 너비로 잰 높이(`LayoutMeasurements.columnHeights`)를 쓴다.
 *
 * 각주는 번호 표시가 든 block이 놓인 단(단이 하나면 쪽) 아래에 둔다. 단의 본문 높이는 각주 영역(구분선·간격 포함)만큼 줄어든다.
 * - block과 각주가 함께 들어가지 않으면 block을 다음 쪽(단)으로 넘긴다.
 * - 각주가 빈 쪽에도 다 들어가지 않을 만큼 길면 block을 두고 각주 첫 줄부터 남은 자리만큼 놓은 뒤 나머지를 다음 쪽(단)
 *   아래 처음에 이어 놓는다(문단 경계·측정한 줄 경계에서 나눈다). 남은 각주가 있으면 다음 본문 block도 다음 쪽으로 간다.
 * - 쪽마다 새로 매기는 번호(`ON_PAGE`)는 쪽을 다 나눈 뒤 다시 매긴다(`renumberFootnotesByPage`).
 * - 한 쪽에 다단 영역이 여럿이면 각주는 마지막 영역의 단 아래에 둔다(앞 영역 단이 더 많으면 남는 단의 각주는 마지막 단에 모은다).
 */
export function paginateViewerSection(
  section: ViewerSection,
  sectionIndex: number,
  availableHeight: number,
  measurements?: LayoutMeasurements,
  page?: PageFrame
): ViewerPage[] {
  const pages: ViewerPage[] = []
  const settings = sectionFootnoteSettings(section.footnoteSettings)
  const bodyWidth = page ? page.width - page.margin.left - page.margin.right : undefined
  let regions: RegionState[] = []
  let currentNotes: ViewerPageFootnote[][] = [[]]
  let notesHeights: number[] = [0]
  let columnIndex = 0
  let usedHeight = 0
  // 이 쪽에 놓인 용지·쪽 기준 개체의 띠와 그 높이(겹친 부분은 한 번). 단마다 본문이 이만큼 줄어든다.
  let pageBands: PageBand[] = []
  let bandsHeight = 0
  // 다단이 없는 구역은 쪽 위 block 흐름(`flowBlockEnd`)으로 띠를 지난다. 띠는 글이 닿을 때만 자리를 쓰고, 글 옆 배치 띠(`wrap`)는
  // 개체 옆 남은 폭으로 글을 흘린다. 다단 구역은 띠 높이만큼 모든 단 본문을 줄인다(띠 폭 전체).
  const simpleFlow = Boolean(page) && !flowLayout(section.columnLayout) && !section.blocks.some((block) => flowLayout(block.columnLayout))
  let pageFlow: { height: number; kind: ReturnType<typeof blockBandFlowKind> }[] = []
  let mergedBands: PageBand[] = []
  let sectionPageIndex = 0
  let previousLayoutTop: number | undefined
  let previousBlockFragmented = false
  // 다단 영역에서 화면 높이가 원본보다 커 단(쪽)을 넘겼는지. 그러면 원본 줄 배치의 다음 단 시작(위로 되돌아감)은 이미 넘긴 단이
  // 받는다. 넘친 몇 문단만 든 거의 빈 단을 만들지 않는다.
  let spilled = false
  const pending: PendingFootnote[] = []
  // 표 머리글 행 되풀이처럼 같은 각주 번호 표시가 여러 조각에 나와도 각주 본문은 한 번만 놓는다.
  const placedNotes = new Set<string>()
  const region = () => regions[regions.length - 1]
  const currentColumn = () => region().columns[columnIndex]
  const columnNotes = () => currentNotes[columnIndex]
  const noteArea = (extraCount = 0, extraHeight = 0) =>
    footnoteAreaHeight(settings, columnNotes().length + extraCount, notesHeights[columnIndex] + extraHeight)
  const metricsOf = (note: ViewerNote) => measurements?.noteMetrics?.[note.sourcePath] ?? estimatedNoteMetrics(note)

  // 서로 다른 너비 단의 측정값. 영역 첫 단과 너비가 같으면 기본 측정값을 그대로 쓴다.
  const widthKeys = new Map<ViewerColumnLayout, string[]>()
  const variantMeasurements = new Map<string, LayoutMeasurements>()
  const measurementsAt = (layout: ViewerColumnLayout | undefined, column: number): LayoutMeasurements | undefined => {
    if (!measurements?.columnHeights || !layout || column <= 0 || bodyWidth === undefined) return measurements
    let keys = widthKeys.get(layout)
    if (!keys) {
      keys = viewerColumnWidths(bodyWidth, layout).widths.map(columnWidthKey)
      widthKeys.set(layout, keys)
    }
    const key = keys[column]
    const variant = key !== undefined && key !== keys[0] ? measurements.columnHeights[key] : undefined
    if (!variant) return measurements
    let merged = variantMeasurements.get(key)
    if (!merged) {
      merged = {
        ...measurements,
        blockHeights: { ...measurements.blockHeights, ...variant.blockHeights },
        tableRowHeights: { ...measurements.tableRowHeights, ...variant.tableRowHeights }
      }
      variantMeasurements.set(key, merged)
    }
    return merged
  }
  const heightIn = (block: ViewerParagraph, layout: ViewerColumnLayout | undefined, column: number) =>
    measurementsAt(layout, column)?.blockHeights[block.id] ?? block.layoutHeight
  const blockHeight = (block: ViewerParagraph) => heightIn(block, region().layout, columnIndex)

  const newRegion = (layout: ViewerColumnLayout | undefined, top: number): RegionState => {
    const count = layout?.count ?? 1
    return {
      ...(layout ? { layout } : {}),
      columns: Array.from({ length: count }, () => []),
      ends: Array.from({ length: count }, () => top),
      top,
      startBands: bandsHeight,
      forced: false,
      hasNotes: false
    }
  }
  /** 각주 칸을 단 수에 맞춘다. 단이 줄면 남는 칸의 각주는 마지막 칸에 모은다. */
  const resizeNoteSlots = (count: number) => {
    while (currentNotes.length < count) {
      currentNotes.push([])
      notesHeights.push(0)
    }
    if (currentNotes.length > count) {
      const extraNotes = currentNotes.splice(count).flat()
      const extraHeight = notesHeights.splice(count).reduce((sum, height) => sum + height, 0)
      currentNotes[count - 1].push(...extraNotes)
      notesHeights[count - 1] += extraHeight
    }
  }

  /** 남은 각주를 지금 단 아래에 들어가는 만큼 놓는다. 단이 비었으면 들어가지 않아도 한 조각은 놓는다(무한 반복 방지). */
  const fillNotes = () => {
    while (pending.length) {
      const item = pending[0]
      const space = availableHeight - usedHeight - noteArea(1)
      let cursor = fitNoteCursor(item.metrics, item.cursor, space)
      const columnEmpty = !currentColumn().length && !columnNotes().length
      if (cursor === item.cursor) {
        if (!columnEmpty) return
        cursor = item.cursor + 1
      }
      const height = noteCursorY(item.metrics, cursor) - noteCursorY(item.metrics, item.cursor)
      const continues = cursor < item.metrics.breaks.length
      columnNotes().push({
        note: item.note,
        marker: item.note.marker,
        pieces: noteFragmentPieces(item.note, item.metrics, item.cursor, cursor),
        continued: item.cursor >= 0,
        continues,
        height
      })
      notesHeights[columnIndex] += height
      region().hasNotes = true
      if (continues) {
        item.cursor = cursor
        return
      }
      pending.shift()
    }
  }
  const resetPage = (layout: ViewerColumnLayout | undefined) => {
    pageBands = []
    bandsHeight = 0
    pageFlow = []
    mergedBands = []
    regions = [newRegion(layout, 0)]
    const count = layout?.count ?? 1
    currentNotes = Array.from({ length: count }, () => [])
    notesHeights = Array.from({ length: count }, () => 0)
    columnIndex = 0
    usedHeight = 0
  }
  /** 영역 단 높이를 고르게 맞춘다(배분). 단 너비가 다르면 단마다 그 너비 높이로 잰다. */
  const balance = (target: RegionState) => {
    if (!target.layout || target.layout.type === 'PARALLEL' || target.forced || target.hasNotes) return
    const blocks = target.columns.flat()
    if (!blocks.length) return
    const layout = target.layout
    const starts = balancedColumnStarts(blocks.length, layout.count, (column, block) => heightIn(blocks[block], layout, column))
    const bandsDuring = bandsHeight - target.startBands
    target.columns = starts.map((start, column) => blocks.slice(start, starts[column + 1] ?? blocks.length))
    target.ends = target.columns.map((column, index) =>
      target.top + bandsDuring + column.reduce((sum, block) => sum + heightIn(block, layout, index), 0))
  }
  /** 지금 영역을 닫고 같은 쪽 아래에 새 영역을 시작한다. 빈 영역은 버리고 그 자리에서 새 영역을 시작한다. */
  const startRegion = (layout: ViewerColumnLayout | undefined, balanceCurrent: boolean) => {
    const current = region()
    current.ends[columnIndex] = usedHeight
    let top = current.top
    if (current.columns.some((column) => column.length)) {
      if (balanceCurrent) balance(current)
      const end = Math.max(...current.ends, current.top)
      current.height = end - current.top
      top = end
    } else {
      regions.pop()
    }
    regions.push(newRegion(layout, top))
    resizeNoteSlots(layout?.count ?? 1)
    columnIndex = 0
    usedHeight = top
    fillNotes()
  }
  const flush = () => {
    region().ends[columnIndex] = usedHeight
    const filled = regions.filter((item) => item.columns.some((column) => column.length))
    const kept = filled.length ? filled : [region()]
    const blocks = kept.flatMap((item) => item.columns.flat())
    const hasNotes = currentNotes.some((notes) => notes.length)
    const layout = region().layout
    if (blocks.length || hasNotes) {
      const single = kept.length === 1 ? kept[0] : undefined
      pages.push({
        blocks,
        ...(single
          ? single.layout ? { columns: single.columns.map((column) => [...column]), columnLayout: single.layout } : {}
          : {
              regions: kept.map((item, index): ViewerColumnRegion => ({
                ...(item.layout ? { columnLayout: item.layout } : {}),
                columns: item.columns.map((column) => [...column]),
                top: item.top,
                ...(index < kept.length - 1 && item.height !== undefined ? { height: item.height } : {})
              }))
            }),
        ...(hasNotes ? { footnotes: currentNotes.map((notes) => [...notes]) } : {}),
        ...(pageBands.length ? { bands: mergePageBands(pageBands) } : {}),
        sectionIndex,
        sectionPageIndex
      })
      sectionPageIndex += 1
    }
    resetPage(layout)
    fillNotes()
  }
  const advanceFlow = () => {
    const current = region()
    if (columnIndex + 1 < current.columns.length) {
      current.ends[columnIndex] = usedHeight
      columnIndex += 1
      usedHeight = current.top + (bandsHeight - current.startBands)
      fillNotes()
    } else {
      flush()
    }
    previousLayoutTop = undefined
  }
  /** 단 나눔·원본 줄 배치로 다음 단에 간다. 평행 다단의 마지막 단이면 같은 쪽 아래에 새 줄(같은 다단 영역)을 시작한다. */
  const breakColumn = () => {
    const current = region()
    current.forced = true
    spilled = false
    if (current.layout?.type === 'PARALLEL' && columnIndex + 1 >= current.columns.length) {
      startRegion(current.layout, false)
      previousLayoutTop = undefined
      return
    }
    advanceFlow()
  }
  // 남은 각주가 단을 다 채우고 있으면 본문 block은 다음 단·쪽으로 간다.
  const advanceWhileNotesPending = () => {
    while (pending.length) advanceFlow()
  }

  resetPage(flowLayout(section.columnLayout))
  section.blocks.forEach((originalBlock) => {
    const sourceFlowRestart = Boolean(measurements && !previousBlockFragmented && currentColumn().length && originalBlock.layoutTop !== undefined && previousLayoutTop !== undefined && originalBlock.layoutTop < previousLayoutTop)
    const multiColumn = Boolean(region().layout)
    if (originalBlock.columnLayout) {
      // 새 다단 정의: 쪽 나눔·원본에서 새 쪽이면 다음 쪽 위에서, 아니면 같은 쪽 앞 영역 아래에서 새 영역을 시작한다.
      if (originalBlock.pageBreak || sourceFlowRestart) flush()
      startRegion(flowLayout(originalBlock.columnLayout), true)
      spilled = false
    } else if (originalBlock.pageBreak) {
      flush()
      spilled = false
    } else if (originalBlock.columnBreak && multiColumn) breakColumn()
    else if (sourceFlowRestart && multiColumn && spilled) {
      // 넘쳐서 이미 다음 단으로 왔으면 원본의 단 시작을 지금 단이 받는다.
      region().forced = true
      spilled = false
      previousLayoutTop = undefined
    } else if (sourceFlowRestart && multiColumn) breakColumn()
    else if (sourceFlowRestart) flush()
    advanceWhileNotesPending()
    // 한 단 흐름에서 표 첫 조각은 아직 지나지 않은 띠를 건너뛴다고 보고 그 높이만큼 덜 채운다.
    const bandsAhead = simpleFlow ? mergedBands.reduce((sum, band) => sum + Math.max(band.bottom - Math.max(band.top, usedHeight), 0), 0) : 0
    const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight - bandsAhead - noteArea(), availableHeight, measurementsAt(region().layout, columnIndex))
    fragments.forEach((block, fragmentIndex) => {
      const notes = paragraphFootnotes(block).filter((note) => !placedNotes.has(note.sourcePath))
      const metrics = notes.map(metricsOf)
      const notesTotal = metrics.reduce((sum, item) => sum + item.height, 0)
      // 용지·쪽 기준 개체(자리 차지·글 옆 배치)는 그 block이 놓이는 쪽 본문에서 개체 띠만큼 자리를 더 쓴다.
      const blockBands = page ? blockObjectBands(block, page, simpleFlow) : []
      const bandsExtra = () => blockBands.length ? pageBandsHeight([...pageBands, ...blockBands]) - bandsHeight : 0
      const flowKind = simpleFlow ? blockBandFlowKind(block) : 'text'
      // 한 단 흐름: 이 block(과 그 띠)을 지금 쪽에 더했을 때 쪽 본문 흐름이 끝나는 위치. 띠가 새로 생기면 앞 block도 다시 흘린다.
      const flowEndWith = () => {
        const height = blockHeight(block)
        if (!blockBands.length) return flowBlockEnd(usedHeight, height, flowKind, mergedBands, bodyWidth ?? 0)
        const bands = mergePageBands([...pageBands, ...blockBands])
        return [...pageFlow, { height, kind: flowKind }].reduce((end, item) => flowBlockEnd(end, item.height, item.kind, bands, bodyWidth ?? 0), 0)
      }
      const endWith = () => simpleFlow ? flowEndWith() : usedHeight + blockHeight(block) + bandsExtra()
      if (fragmentIndex > 0) advanceFlow()
      else {
        // 쪽 위에서 시작한 빈 단은 언제나 받는다. 같은 쪽 아래 영역의 단은 들어갈 때까지 다음 단·쪽으로 넘긴다.
        for (let guard = 0; guard < 4096; guard += 1) {
          const blank = !currentColumn().length && !columnNotes().length
          if (blank && region().top <= 0) break
          const height = blockHeight(block)
          if (endWith() + noteArea(notes.length, notesTotal) <= availableHeight) break
          if (!currentColumn().length && height <= 0) break
          if (blank) {
            advanceFlow()
            spilled = Boolean(region().layout)
            continue
          }
          // 빈 단에 block과 각주가 다 들어가면 block을 넘긴다. 각주가 빈 단보다도 길면 각주 첫 조각이 여기에 들어갈 때만 둔다.
          const freshEnd = simpleFlow
            ? flowBlockEnd(0, height, flowKind, mergePageBands(blockBands), bodyWidth ?? 0)
            : height + pageBandsHeight(blockBands)
          const fitsFresh = freshEnd + footnoteAreaHeight(settings, notes.length, notesTotal) <= availableHeight
          const firstPiece = metrics[0] ? noteCursorY(metrics[0], 0) : 0
          const fitsPartially = notes.length > 0 && endWith() + noteArea(1, firstPiece) <= availableHeight
          if (!fitsFresh && fitsPartially) break
          advanceFlow()
          spilled = Boolean(region().layout)
          if (region().top <= 0) break
        }
      }
      advanceWhileNotesPending()
      const height = blockHeight(block)
      if (simpleFlow) {
        const end = flowEndWith()
        currentColumn().push(block)
        pageFlow.push({ height, kind: flowKind })
        if (blockBands.length) {
          pageBands.push(...blockBands)
          mergedBands = mergePageBands(pageBands)
          bandsHeight = pageBandsHeight(pageBands)
        }
        usedHeight = end
      } else {
        const extra = bandsExtra()
        currentColumn().push(block)
        if (blockBands.length) {
          pageBands.push(...blockBands)
          bandsHeight += extra
        }
        usedHeight += height + extra
      }
      notes.forEach((note, index) => {
        placedNotes.add(note.sourcePath)
        pending.push({ note, metrics: metrics[index], cursor: -1 })
      })
      fillNotes()
    })
    previousBlockFragmented = fragments.length > 1
    if (originalBlock.layoutTop !== undefined) previousLayoutTop = originalBlock.layoutTop
  })
  while (pending.length) flush()
  if (region().layout?.type === 'BALANCED_NEWSPAPER') {
    region().ends[columnIndex] = usedHeight
    balance(region())
  }
  flush()
  return settings.numbering.type === 'ON_PAGE' ? renumberFootnotesByPage(pages, (value) => footnoteMarker(settings, value)) : pages
}

function remarkContent(content: ViewerContent[], markers: ReadonlyMap<string, string>): ViewerContent[] {
  let changed = false
  const next = content.map((item): ViewerContent => {
    if (item.type === 'object-placeholder' && item.note && markers.has(item.sourcePath)) {
      changed = true
      const marker = markers.get(item.sourcePath)!
      return { ...item, marker, note: { ...item.note, marker } }
    }
    if (item.type === 'table') {
      let tableChanged = false
      const rows = item.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          const paragraphs = cell.paragraphs.map((paragraph) => {
            const remarked = remarkContent(paragraph.content, markers)
            if (remarked === paragraph.content) return paragraph
            tableChanged = true
            return { ...paragraph, content: remarked }
          })
          return tableChanged ? { ...cell, paragraphs } : cell
        })
      }))
      if (!tableChanged) return item
      changed = true
      return { ...item, rows }
    }
    return item
  })
  return changed ? next : content
}

/**
 * 쪽마다 새로 매기는 각주 번호(`ON_PAGE`). 쪽 안 각주 첫 조각 순서대로 1부터 매기고, 본문 번호 표시와 각주 조각 번호를 함께 바꾼다.
 * 앞 쪽에서 이어지는 조각은 앞 쪽 번호를 그대로 쓴다.
 */
export function renumberFootnotesByPage(pages: ViewerPage[], format: (value: number) => string): ViewerPage[] {
  const markers = new Map<string, string>()
  return pages.map((page) => {
    if (!page.footnotes) return page
    let counter = 0
    const footnotes = page.footnotes.map((notes) => notes.map((footnote) => {
      if (!footnote.continued) markers.set(footnote.note.sourcePath, format(++counter))
      const marker = markers.get(footnote.note.sourcePath) ?? footnote.marker
      return { ...footnote, marker, note: { ...footnote.note, marker } }
    }))
    const remark = (block: ViewerParagraph) => {
      const content = remarkContent(block.content, markers)
      return content === block.content ? block : { ...block, content }
    }
    const blocks = page.blocks.map(remark)
    const remap = (column: readonly ViewerParagraph[]) => column.map((block) => blocks[page.blocks.indexOf(block)] ?? remark(block))
    return {
      ...page,
      blocks,
      ...(page.columns ? { columns: page.columns.map(remap) } : {}),
      ...(page.regions ? { regions: page.regions.map((region) => ({ ...region, columns: region.columns.map(remap) })) } : {}),
      footnotes
    }
  })
}

/** section 하나의 pagination 결과와 그 입력. 입력 object가 모두 같으면 다음 pagination에서 그대로 쓴다. */
export interface SectionPagination {
  section: ViewerSection
  sectionIndex: number
  availableHeight: number
  measurements?: LayoutMeasurements
  /** 용지·쪽 기준 개체 위치를 정한 쪽 크기·여백(값으로 비교한다). */
  pageKey: string
  pages: ViewerPage[]
}

function pageFrameKey(page: PageFrame): string {
  return [page.width, page.height, page.margin.top, page.margin.right, page.margin.bottom, page.margin.left, page.headerOffset ?? 0].join(',')
}

/**
 * section별 측정값으로 문서를 나누되, 앞 결과(`previous`)에서 section·위치·쪽 크기·측정 object가 모두 같은 section은 다시
 * 나누지 않고 쪽 object를 그대로 쓴다. 결과는 같은 입력의 `paginateViewerSection`을 이어 붙인 것과 같다.
 */
export function paginateViewerSectionsIncremental(
  document: Pick<ViewerDocument, 'page' | 'sections'>,
  measurementsOf: (sectionIndex: number) => LayoutMeasurements | undefined,
  previous: readonly SectionPagination[] = []
): { pages: ViewerPage[]; sections: SectionPagination[]; reused: number } {
  const availableHeight = pageBodyHeight(document)
  const pageKey = pageFrameKey(document.page)
  let reused = 0
  const sections = document.sections.map((section, sectionIndex): SectionPagination => {
    const measurements = measurementsOf(sectionIndex)
    const cached = previous[sectionIndex]
    if (
      cached &&
      cached.section === section &&
      cached.sectionIndex === sectionIndex &&
      cached.availableHeight === availableHeight &&
      cached.pageKey === pageKey &&
      cached.measurements === measurements
    ) {
      reused += 1
      return cached
    }
    return {
      section,
      sectionIndex,
      availableHeight,
      measurements,
      pageKey,
      pages: paginateViewerSection(section, sectionIndex, availableHeight, measurements, document.page)
    }
  })
  return { pages: sections.flatMap((section) => section.pages), sections, reused }
}
