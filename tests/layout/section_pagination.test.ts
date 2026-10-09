import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  supportsViewerColumnFlow,
  ViewerColumnLayout,
  ViewerDocument,
  ViewerParagraph,
  ViewerSection
} from '../../src/core/document/viewer_document'
import {
  fragmentTableBlock,
  LayoutMeasurements,
  paginateViewerDocument,
  paginateViewerSectionsIncremental,
  ViewerPage
} from '../../src/core/layout/pagination'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { fixturePath, openedFixtures } from '../editing/golden_cases'

/** section별 pagination 이전의 문서 단위 구현(변경 전 `paginateViewerDocument` 그대로). */
function legacyPaginate(document: ViewerDocument, measurements?: LayoutMeasurements): ViewerPage[] {
  const pages: ViewerPage[] = []
  const availableHeight = document.page.height - document.page.margin.top - document.page.margin.bottom
  let activeColumnLayout: ViewerColumnLayout | undefined
  let columnCount = 1
  let currentColumns: ViewerParagraph[][] = [[]]
  let columnIndex = 0
  let usedHeight = 0
  let currentSectionIndex = 0
  let sectionPageIndex = 0
  let previousLayoutTop: number | undefined
  let previousBlockFragmented = false
  const currentColumn = () => currentColumns[columnIndex]
  const resetPage = () => {
    currentColumns = Array.from({ length: columnCount }, () => [])
    columnIndex = 0
    usedHeight = 0
  }
  const flush = () => {
    const blocks = currentColumns.flat()
    if (blocks.length) {
      pages.push({
        blocks,
        ...(activeColumnLayout ? { columns: currentColumns.map((column) => [...column]), columnLayout: activeColumnLayout } : {}),
        sectionIndex: currentSectionIndex,
        sectionPageIndex
      })
      sectionPageIndex += 1
    }
    resetPage()
  }
  const advanceFlow = () => {
    if (columnIndex + 1 < columnCount) {
      columnIndex += 1
      usedHeight = 0
    } else {
      flush()
    }
    previousLayoutTop = undefined
  }
  document.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) flush()
    currentSectionIndex = sectionIndex
    sectionPageIndex = 0
    activeColumnLayout = supportsViewerColumnFlow(section.columnLayout) ? section.columnLayout : undefined
    columnCount = activeColumnLayout?.count ?? 1
    resetPage()
    previousLayoutTop = undefined
    previousBlockFragmented = false
    section.blocks.forEach((originalBlock) => {
      const sourceFlowRestart = Boolean(measurements && !previousBlockFragmented && currentColumn().length && originalBlock.layoutTop !== undefined && previousLayoutTop !== undefined && originalBlock.layoutTop < previousLayoutTop)
      if (originalBlock.pageBreak) flush()
      else if ((originalBlock.columnBreak || sourceFlowRestart) && activeColumnLayout) advanceFlow()
      else if (sourceFlowRestart) flush()
      const fragments = fragmentTableBlock(originalBlock, availableHeight - usedHeight, availableHeight, measurements)
      fragments.forEach((block, fragmentIndex) => {
        const measuredHeight = measurements?.blockHeights[block.id]
        const height = measuredHeight ?? block.layoutHeight
        if (fragmentIndex > 0 || (currentColumn().length && height > 0 && usedHeight + height > availableHeight)) advanceFlow()
        currentColumn().push(block)
        usedHeight += height
      })
      previousBlockFragmented = fragments.length > 1
      if (originalBlock.layoutTop !== undefined) previousLayoutTop = originalBlock.layoutTop
    })
  })
  flush()
  return pages
}

/** 화면 측정 대신 쓰는 결정적 측정값(문단·표 행 모두). section별 map과 문서 전체 map을 함께 만든다. */
function syntheticMeasurements(document: ViewerDocument): { flat: LayoutMeasurements; sections: LayoutMeasurements[] } {
  const flat: LayoutMeasurements = { blockHeights: {}, tableRowHeights: {} }
  const sections = document.sections.map((section) => {
    const own: LayoutMeasurements = { blockHeights: {}, tableRowHeights: {} }
    const visit = (paragraphs: readonly ViewerParagraph[]) => {
      for (const paragraph of paragraphs) {
        own.blockHeights[paragraph.id] = Math.round(paragraph.layoutHeight * 1.13) + 37
        for (const item of paragraph.content) {
          if (item.type !== 'table') continue
          item.rows.forEach((row, index) => {
            const height = Math.max(...row.cells.map((cell) => cell.height), 0)
            own.tableRowHeights[`${item.id}:r${row.cells[0]?.row ?? index}`] = Math.round(height * 1.21) + 11
            for (const cell of row.cells) visit(cell.paragraphs)
          })
        }
      }
    }
    visit(section.blocks)
    Object.assign(flat.blockHeights, own.blockHeights)
    Object.assign(flat.tableRowHeights, own.tableRowHeights)
    return own
  })
  return { flat, sections }
}

describe('section별 pagination', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-section-pagination-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: section별로 나눠 이어 붙인 쪽이 이전 문서 단위 pagination과 같다',
    async (_id, fixture) => {
      const document = await decodeViewerDocument(await HwpxSourcePackage.open(fixturePath(directory, fixture)))
      const { flat, sections } = syntheticMeasurements(document)
      expect(paginateViewerDocument(document)).toEqual(legacyPaginate(document))
      expect(paginateViewerDocument(document, flat)).toEqual(legacyPaginate(document, flat))
      // renderer처럼 section마다 따로 잰 측정값을 써도 같다.
      const incremental = paginateViewerSectionsIncremental(document, (index) => sections[index])
      expect(incremental.pages).toEqual(legacyPaginate(document, flat))

      // section 하나만 바뀌면 그 section만 다시 나누고 나머지 쪽 object는 그대로 쓴다.
      const target = Math.floor(document.sections.length / 2)
      const changedSection: ViewerSection = {
        ...document.sections[target],
        blocks: document.sections[target].blocks.map((block, index) => index === 0 ? { ...block, layoutHeight: block.layoutHeight + 5000 } : block)
      }
      const changed: ViewerDocument = { ...document, sections: document.sections.map((section, index) => index === target ? changedSection : section) }
      const changedMeasurements = syntheticMeasurements(changed)
      const measurementsOf = (index: number) => index === target ? changedMeasurements.sections[index] : sections[index]
      const next = paginateViewerSectionsIncremental(changed, measurementsOf, incremental.sections)
      expect(next.reused).toBe(document.sections.length - 1)
      expect(next.pages).toEqual(legacyPaginate(changed, changedMeasurements.flat))
      next.sections.forEach((section, index) => {
        if (index !== target) expect(section.pages).toBe(incremental.sections[index].pages)
      })
    },
    120_000
  )
})
