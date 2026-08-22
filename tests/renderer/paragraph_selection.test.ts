import {
  moveParagraphEditorSelection,
  paragraphEditorRangeScope,
  ParagraphEditorSurface
} from '../../src/renderer/src/paragraph_selection'

const sectionPath = 'Contents/section0.xml'
const topLevelScope = `${sectionPath}:top-level`
const surfaces: ParagraphEditorSurface[] = [
  { textNodeId: `${sectionPath}#hp:t:0`, textLength: 3, rangeScope: topLevelScope },
  { textNodeId: `${sectionPath}#hp:t:1`, textLength: 4, rangeScope: topLevelScope },
  { textNodeId: `${sectionPath}#hp:t:2`, textLength: 5, rangeScope: topLevelScope },
  {
    textNodeId: `${sectionPath}#hp:t:3`,
    textLength: 6,
    rangeScope: `${sectionPath}:paragraph:table:r0c0:p0`
  }
]

describe('공통 paragraph editor host selection', () => {
  test('최상위 문단은 section scope를 공유하고 표 셀 문단은 고유 scope를 갖는다', () => {
    expect(paragraphEditorRangeScope(sectionPath, 'body:p0', true)).toBe(topLevelScope)
    expect(paragraphEditorRangeScope(sectionPath, 'table:r0c0:p0', false)).toBe(
      `${sectionPath}:paragraph:table:r0c0:p0`
    )
  })

  test('문단 경계 이동은 같은 scope의 다음 surface 첫 위치로 접힌다', () => {
    expect(moveParagraphEditorSelection(
      surfaces,
      `${sectionPath}#hp:t:0`,
      'next',
      {
        sectionPath,
        anchorTextNodeId: `${sectionPath}#hp:t:0`,
        anchorOffset: 3,
        focusTextNodeId: `${sectionPath}#hp:t:0`,
        focusOffset: 3
      },
      false
    )).toEqual({
      sectionPath,
      anchorTextNodeId: `${sectionPath}#hp:t:1`,
      anchorOffset: 0,
      focusTextNodeId: `${sectionPath}#hp:t:1`,
      focusOffset: 0
    })
  })

  test('Shift+Arrow 확장은 기존 anchor를 유지하며 여러 문단 focus만 이동한다', () => {
    const backward = {
      sectionPath,
      anchorTextNodeId: `${sectionPath}#hp:t:2`,
      anchorOffset: 2,
      focusTextNodeId: `${sectionPath}#hp:t:1`,
      focusOffset: 0
    }
    expect(moveParagraphEditorSelection(
      surfaces,
      `${sectionPath}#hp:t:1`,
      'previous',
      backward,
      true
    )).toEqual({
      ...backward,
      focusTextNodeId: `${sectionPath}#hp:t:0`,
      focusOffset: 3
    })
  })

  test('최상위 문단 selection은 표 셀의 다른 scope로 넘어가지 않는다', () => {
    const selection = {
      sectionPath,
      anchorTextNodeId: `${sectionPath}#hp:t:2`,
      anchorOffset: 5,
      focusTextNodeId: `${sectionPath}#hp:t:2`,
      focusOffset: 5
    }
    expect(moveParagraphEditorSelection(
      surfaces,
      `${sectionPath}#hp:t:2`,
      'next',
      selection,
      true
    )).toBeUndefined()
    expect(moveParagraphEditorSelection(
      surfaces,
      `${sectionPath}#hp:t:3`,
      'previous',
      { ...selection, anchorTextNodeId: `${sectionPath}#hp:t:3`, focusTextNodeId: `${sectionPath}#hp:t:3` },
      false
    )).toBeUndefined()
  })
})
