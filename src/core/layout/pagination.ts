import { paragraphFootnotes, supportsViewerColumnFlow, ViewerColumnLayout, ViewerContent, ViewerDocument, ViewerNote, ViewerParagraph, ViewerSection, ViewerTable, ViewerTableRow } from '../document/viewer_document'
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
import { blockObjectBands, mergePageBands, PageBand, pageBandsHeight, PageFrame, tableInFlow } from './object_position'

export interface ViewerPage {
  blocks: ViewerParagraph[]
  columns?: ViewerParagraph[][]
  columnLayout?: ViewerColumnLayout
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

/**
 * section 하나를 쪽으로 나눈다. section은 언제나 새 쪽에서 시작하고(앞 section의 남은 쪽을 먼저 내보낸다) 다단 상태·
 * 원본 줄 배치 위치도 section마다 처음부터 센다. 그래서 문서 pagination은 section별 결과를 이어 붙인 것과 같고,
 * 편집으로 section 하나만 바뀌면 그 section만 다시 나누면 된다(`paginateViewerSectionsIncremental`).
 *
 * 각주는 번호 표시가 든 block이 놓인 단(단이 하나면 쪽) 아래에 둔다. 단의 본문 높이는 각주 영역(구분선·간격 포함)만큼 줄어든다.
 * - block과 각주가 함께 들어가지 않으면 block을 다음 쪽(단)으로 넘긴다.
 * - 각주가 빈 쪽에도 다 들어가지 않을 만큼 길면 block을 두고 각주 첫 줄부터 남은 자리만큼 놓은 뒤 나머지를 다음 쪽(단)
 *   아래 처음에 이어 놓는다(문단 경계·측정한 줄 경계에서 나눈다). 남은 각주가 있으면 다음 본문 block도 다음 쪽으로 간다.
 * - 쪽마다 새로 매기는 번호(`ON_PAGE`)는 쪽을 다 나눈 뒤 다시 매긴다(`renumberFootnotesByPage`).
 */
export function paginateViewerSection(
  section: ViewerSection,
  sectionIndex: number,
  availableHeight: number,
  measurements?: LayoutMeasurements,
  page?: PageFrame
): ViewerPage[] {
  const pages: ViewerPage[] = []
  const activeColumnLayout = supportsViewerColumnFlow(section.columnLayout) ? section.columnLayout : undefined
  const columnCount = activeColumnLayout?.count ?? 1
  const settings = sectionFootnoteSettings(section.footnoteSettings)
  let currentColumns: ViewerParagraph[][] = [[]]
  let currentNotes: ViewerPageFootnote[][] = [[]]
  let columnIndex = 0
  let usedHeight = 0
  let notesHeight = 0
  // 이 쪽에 놓인 용지·쪽 기준 개체의 띠와 그 높이(겹친 부분은 한 번). 단마다 본문이 이만큼 줄어든다.
  let pageBands: PageBand[] = []
  let bandsHeight = 0
  let sectionPageIndex = 0
  let previousLayoutTop: number | undefined
  let previousBlockFragmented = false
  const pending: PendingFootnote[] = []
  // 표 머리글 행 되풀이처럼 같은 각주 번호 표시가 여러 조각에 나와도 각주 본문은 한 번만 놓는다.
  const placedNotes = new Set<string>()
  const currentColumn = () => currentColumns[columnIndex]
  const columnNotes = () => currentNotes[columnIndex]
  const noteArea = (extraCount = 0, extraHeight = 0) =>
    footnoteAreaHeight(settings, columnNotes().length + extraCount, notesHeight + extraHeight)
  const metricsOf = (note: ViewerNote) => measurements?.noteMetrics?.[note.sourcePath] ?? estimatedNoteMetrics(note)
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
      notesHeight += height
      if (continues) {
        item.cursor = cursor
        return
      }
      pending.shift()
    }
  }
  const resetPage = () => {
    currentColumns = Array.from({ length: columnCount }, () => [])
    currentNotes = Array.from({ length: columnCount }, () => [])
    columnIndex = 0
    usedHeight = 0
    notesHeight = 0
    pageBands = []
    bandsHeight = 0
  }
  const flush = () => {
    const blocks = currentColumns.flat()
    const hasNotes = currentNotes.some((notes) => notes.length)
    if (blocks.length || hasNotes) {
      pages.push({
        blocks,
        ...(activeColumnLayout ? {
          columns: currentColumns.map((column) => [...column]),
          columnLayout: activeColumnLayout
        } : {}),
        ...(hasNotes ? { footnotes: currentNotes.map((notes) => [...notes]) } : {}),
        ...(pageBands.length ? { bands: mergePageBands(pageBands) } : {}),
        sectionIndex,
        sectionPageIndex
      })
      sectionPageIndex += 1
    }
    resetPage()
    fillNotes()
  }
  const advanceFlow = () => {
    if (columnIndex + 1 < columnCount) {
      columnIndex += 1
      usedHeight = bandsHeight
      notesHeight = 0
      fillNotes()
    } else {
      flush()
    }
    previousLayoutTop = undefined
  }
  // 남은 각주가 단을 다 채우고 있으면 본문 block은 다음 단·쪽으로 간다.
  const advanceWhileNotesPending = () => {
    while (pending.length) advanceFlow()
  }

  resetPage()
  section.blocks.forEach((originalBlock) => {
    const sourceFlowRestart = Boolean(measurements && !previousBlockFragmented && currentColumn().length && originalBlock.layoutTop !== undefined && previousLayoutTop !== undefined && originalBlock.layoutTop < previousLayoutTop)
    if (originalBlock.pageBreak) flush()
    else if ((originalBlock.columnBreak || sourceFlowRestart) && activeColumnLayout) advanceFlow()
    else if (sourceFlowRestart) flush()
    advanceWhileNotesPending()
    const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight - noteArea(), availableHeight, measurements)
    fragments.forEach((block, fragmentIndex) => {
      const measuredHeight = measurements?.blockHeights[block.id]
      const height = measuredHeight ?? block.layoutHeight
      const notes = paragraphFootnotes(block).filter((note) => !placedNotes.has(note.sourcePath))
      const metrics = notes.map(metricsOf)
      const notesTotal = metrics.reduce((sum, item) => sum + item.height, 0)
      // 용지·쪽 기준 개체(자리 차지·글 옆 배치)는 그 block이 놓이는 쪽 본문에서 개체 띠만큼 자리를 더 쓴다.
      const blockBands = page ? blockObjectBands(block, page) : []
      const bandsExtra = () => blockBands.length ? pageBandsHeight([...pageBands, ...blockBands]) - bandsHeight : 0
      if (fragmentIndex > 0) advanceFlow()
      else if (currentColumn().length || columnNotes().length) {
        const fits = usedHeight + height + bandsExtra() + noteArea(notes.length, notesTotal) <= availableHeight
        if (!fits && (currentColumn().length || height > 0)) {
          // 빈 단에 block과 각주가 다 들어가면 block을 넘긴다. 각주가 빈 단보다도 길면 각주 첫 조각이 여기에 들어갈 때만 둔다.
          const fitsFresh = height + pageBandsHeight(blockBands) + footnoteAreaHeight(settings, notes.length, notesTotal) <= availableHeight
          const firstPiece = metrics[0] ? noteCursorY(metrics[0], 0) : 0
          const fitsPartially = notes.length > 0 && usedHeight + height + bandsExtra() + noteArea(1, firstPiece) <= availableHeight
          if (fitsFresh || !fitsPartially) advanceFlow()
        }
      }
      advanceWhileNotesPending()
      const extra = bandsExtra()
      currentColumn().push(block)
      if (blockBands.length) {
        pageBands.push(...blockBands)
        bandsHeight += extra
      }
      usedHeight += height + extra
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
    return {
      ...page,
      blocks,
      ...(page.columns ? { columns: page.columns.map((column) => column.map((block) => blocks[page.blocks.indexOf(block)] ?? remark(block))) } : {}),
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
