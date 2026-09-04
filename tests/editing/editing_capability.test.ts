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

  test('최상위 문단과 안전한 표 셀 text를 분리하고 병합 셀은 편집 대상에서 제외한다', () => {
    expect(listEditingAnchorContexts(document).map((context) => [
      context.textNodeId,
      context.structure
    ])).toEqual([
      [`${sectionPath}#hp:t:0`, 'TOP_LEVEL_TEXT'],
      [`${sectionPath}#hp:t:1`, 'TOP_LEVEL_TEXT'],
      [`${sectionPath}#hp:t:2`, 'TOP_LEVEL_TEXT'],
      [`${sectionPath}#hp:t:3`, 'TABLE_CELL_TEXT'],
      [`${sectionPath}#hp:t:4`, 'TABLE_CELL_TEXT'],
      [`${sectionPath}#hp:t:5`, 'TABLE_CELL_TEXT']
    ])
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

  test('안전한 표 셀은 text와 문단 구조를 허용하고 style은 제한한다', () => {
    const capability = editingCapabilities(document, selection(3, 1))
    expect(capability.text.available).toBe(true)
    expect(capability.characterStyle.reason).toBe('TABLE_CELL_STRUCTURE')
    expect(capability.paragraphStyle.reason).toBe('TABLE_CELL_STRUCTURE')
    expect(capability.paragraphStructure.available).toBe(true)
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
    expect(across.paragraphStyle.reason).toBe('TABLE_CELL_STRUCTURE')
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
