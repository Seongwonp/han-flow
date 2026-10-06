import { ViewerDocument, ViewerParagraph, ViewerText } from '../../src/core/document/viewer_document'
import {
  characterStyleCapability,
  editingCapabilities,
  listEditingAnchorContexts,
  reconcileEditingSelection
} from '../../src/core/editing/editing_capability'

const sectionPath = 'Contents/section0.xml'
const text = (ordinal: number, value: string, charStyleId = '0'): ViewerText => ({
  type: 'text',
  text: value,
  charStyleId,
  sourceAnchor: { sectionPath, textNodeId: `${sectionPath}#hp:t:${ordinal}` }
})
const paragraph = (id: string, content: ViewerParagraph['content']): ViewerParagraph => ({
  id,
  paraStyleId: '0',
  pageBreak: false,
  layoutHeight: 0,
  content
})
const document: ViewerDocument = {
  page: {
    width: 59528,
    height: 84189,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    headerOffset: 0,
    footerOffset: 0
  },
  fonts: {},
  charStyles: {},
  paraStyles: {},
  cellStyles: {},
  resources: {},
  diagnostics: [],
  sections: [{
    id: 'section-0',
    pageNumber: undefined,
    headers: [],
    footers: [],
    blocks: [
      paragraph('p0', [text(0, '첫😀'), text(1, '문단')]),
      paragraph('p1', [text(2, '둘째')]),
      paragraph('table-host', [{
        type: 'table',
        id: 'table0',
        rowCount: 1,
        columnCount: 4,
        repeatHeader: false,
        rows: [{ cells: [
          {
            row: 0,
            column: 0,
            rowSpan: 1,
            columnSpan: 1,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            borderFillId: '1',
            header: false,
            paragraphs: [paragraph('cell-p0', [text(3, '셀')])]
          },
          {
            row: 0,
            column: 1,
            rowSpan: 1,
            columnSpan: 1,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            borderFillId: '1',
            header: false,
            paragraphs: [
              paragraph('multi-cell-p0', [text(4, '첫 문단')]),
              paragraph('multi-cell-p1', [text(5, '둘째 문단')])
            ]
          },
          {
            row: 0,
            column: 2,
            rowSpan: 1,
            columnSpan: 2,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            header: false,
            paragraphs: [paragraph('merged-cell', [text(6, '병합')])]
          },
          {
            row: 0,
            column: 4,
            rowSpan: 1,
            columnSpan: 1,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            borderFillId: '1',
            header: true,
            paragraphs: [
              paragraph('header-cell-p0', [text(7, '머리')]),
              paragraph('header-cell-p1', [text(8, '글')])
            ]
          },
          {
            row: 0,
            column: 5,
            rowSpan: 1,
            columnSpan: 1,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            borderFillId: '1',
            header: false,
            paragraphs: [paragraph('multi-run-cell', [text(9, '앞'), text(10, '')])]
          },
          {
            row: 0,
            column: 6,
            rowSpan: 1,
            columnSpan: 1,
            width: 100,
            height: 100,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            header: false,
            splitBottom: true,
            paragraphs: [paragraph('split-cell', [text(11, '조각')])]
          }
        ] }]
      }])
    ]
  }]
}

const selection = (
  anchorOrdinal: number,
  anchorOffset: number,
  focusOrdinal = anchorOrdinal,
  focusOffset = anchorOffset
) => ({
  sectionPath,
  anchorTextNodeId: `${sectionPath}#hp:t:${anchorOrdinal}`,
  anchorOffset,
  focusTextNodeId: `${sectionPath}#hp:t:${focusOrdinal}`,
  focusOffset
})

describe('편집 capability', () => {
  test('selection이 없으면 글자 모양을 비활성화한다', () => {
    expect(characterStyleCapability(undefined)).toEqual({
      available: false,
      reason: 'NO_SELECTION'
    })
  })

  test('같은 source run 선택만 현재 글자 모양 범위로 허용한다', () => {
    const selection = {
      sectionPath: 'Contents/section0.xml',
      anchorTextNodeId: 'Contents/section0.xml#hp:t:1',
      anchorOffset: 1,
      focusTextNodeId: 'Contents/section0.xml#hp:t:1',
      focusOffset: 3
    }
    expect(characterStyleCapability(selection)).toEqual({ available: true })
    expect(characterStyleCapability({
      ...selection,
      focusTextNodeId: 'Contents/section0.xml#hp:t:2'
    })).toEqual({
      available: false,
      reason: 'MULTI_RUN_SELECTION'
    })
  })

  test('최상위 문단과 표 셀 text를 분리하고 병합·머리글·여러 run 셀은 text 전용으로, 나뉜 셀 조각은 제외한다', () => {
    expect(listEditingAnchorContexts(document).map((context) => [
      context.textNodeId,
      context.structure,
      context.cellStructureEditable
    ])).toEqual([
      [`${sectionPath}#hp:t:0`, 'TOP_LEVEL_TEXT', undefined],
      [`${sectionPath}#hp:t:1`, 'TOP_LEVEL_TEXT', undefined],
      [`${sectionPath}#hp:t:2`, 'TOP_LEVEL_TEXT', undefined],
      [`${sectionPath}#hp:t:3`, 'TABLE_CELL_TEXT', true],
      [`${sectionPath}#hp:t:4`, 'TABLE_CELL_TEXT', true],
      [`${sectionPath}#hp:t:5`, 'TABLE_CELL_TEXT', true],
      [`${sectionPath}#hp:t:6`, 'TABLE_CELL_TEXT', false],
      [`${sectionPath}#hp:t:7`, 'TABLE_CELL_TEXT', false],
      [`${sectionPath}#hp:t:8`, 'TABLE_CELL_TEXT', false],
      [`${sectionPath}#hp:t:9`, 'TABLE_CELL_TEXT', false],
      [`${sectionPath}#hp:t:10`, 'TABLE_CELL_TEXT', false]
    ])
  })

  test.each([
    ['병합 셀', 6],
    ['머리글 셀', 7],
    ['여러 run 셀', 9]
  ])('%s은 text·글자·문단 모양만 허용하고 셀 style·행열·문단 구조는 제한한다', (_label, ordinal) => {
    const capability = editingCapabilities(document, selection(ordinal, 1))
    expect(capability.selection.available).toBe(true)
    expect(capability.text.available).toBe(true)
    expect(capability.cellStyle).toEqual({ available: false, reason: 'TABLE_CELL_STRUCTURE' })
    expect(capability.paragraphStructure).toEqual({ available: false, reason: 'TABLE_CELL_STRUCTURE' })
    expect(capability.characterStyle).toEqual({ available: true })
    expect(capability.paragraphStyle).toEqual({ available: true })
  })

  test('표 셀의 글자 모양은 같은 run, 문단 모양은 같은 문단 선택에서만 연다', () => {
    const acrossRuns = editingCapabilities(document, selection(9, 0, 10, 0))
    expect(acrossRuns.characterStyle).toEqual({ available: false, reason: 'MULTI_RUN_SELECTION' })
    expect(acrossRuns.paragraphStyle).toEqual({ available: true })
    const acrossParagraphs = editingCapabilities(document, selection(4, 0, 5, 1))
    expect(acrossParagraphs.characterStyle).toEqual({ available: false, reason: 'MULTI_RUN_SELECTION' })
    expect(acrossParagraphs.paragraphStyle).toEqual({ available: false, reason: 'MULTI_PARAGRAPH_SELECTION' })
  })

  test('text 전용 셀은 같은 문단 안 run 사이만 선택하고 문단을 넘는 선택은 막는다', () => {
    expect(editingCapabilities(document, selection(9, 0, 10, 0)).text.available).toBe(true)
    expect(editingCapabilities(document, selection(7, 0, 8, 1)).text).toEqual({
      available: false,
      reason: 'CROSS_STRUCTURE_SELECTION'
    })
  })

  test('같은 문단 여러 run은 텍스트·문단 모양만 허용하고 글자 모양·구조 편집은 제한한다', () => {
    const capability = editingCapabilities(document, selection(0, 1, 1, 1))
    expect(capability.text.available).toBe(true)
    expect(capability.characterStyle).toEqual({
      available: false,
      reason: 'MULTI_RUN_SELECTION'
    })
    expect(capability.paragraphStyle.available).toBe(true)
    expect(capability.paragraphStructure.available).toBe(false)
  })

  test('여러 문단 selection은 텍스트 치환만 허용하고 문단 모양은 제한한다', () => {
    const capability = editingCapabilities(document, selection(0, 1, 2, 1))
    expect(capability.text.available).toBe(true)
    expect(capability.paragraphStyle).toEqual({
      available: false,
      reason: 'MULTI_PARAGRAPH_SELECTION'
    })
  })

  test('안전한 표 셀은 text·문단 구조·글자·문단 모양을 허용한다', () => {
    const capability = editingCapabilities(document, selection(3, 1))
    expect(capability.text.available).toBe(true)
    expect(capability.characterStyle).toEqual({ available: true })
    expect(capability.paragraphStyle).toEqual({ available: true })
    expect(capability.paragraphStructure.available).toBe(true)
    expect(capability.cellStyle.available).toBe(true)
    expect(capability.focus?.cellStyleId).toBe('1')
    expect(editingCapabilities(document, selection(3, 0, 4, 0)).cellStyle).toEqual({
      available: false,
      reason: 'CROSS_STRUCTURE_SELECTION'
    })
  })

  test('안전한 여러 문단 표 셀은 cell scope를 공유하고 횡단 text 치환을 허용한다', () => {
    const first = editingCapabilities(document, selection(4, 2))
    const second = editingCapabilities(document, selection(5, 3))
    expect(first.text.available).toBe(true)
    expect(second.text.available).toBe(true)
    expect(first.focus?.rangeScope).toBe(second.focus?.rangeScope)
    const across = editingCapabilities(document, selection(4, 0, 5, 1))
    expect(across.selection.available).toBe(true)
    expect(across.text.available).toBe(true)
    expect(across.paragraphStyle.reason).toBe('MULTI_PARAGRAPH_SELECTION')
    expect(across.paragraphStructure.reason).toBe('MULTI_RUN_SELECTION')
  })

  test('길어진 offset은 surrogate pair를 가르지 않는 경계로 보정한다', () => {
    expect(reconcileEditingSelection(document, selection(0, 2, 0, 99))).toEqual({
      status: 'CLAMPED',
      selection: selection(0, 1, 0, 3)
    })
  })

  test('한 endpoint가 사라지면 남은 위치로 접고 둘 다 사라지면 선택을 해제한다', () => {
    expect(reconcileEditingSelection(document, selection(99, 4, 2, 2))).toEqual({
      status: 'COLLAPSED',
      selection: selection(2, 2)
    })
    expect(reconcileEditingSelection(document, selection(98, 0, 99, 0))).toEqual({
      status: 'CLEARED'
    })
  })
})
