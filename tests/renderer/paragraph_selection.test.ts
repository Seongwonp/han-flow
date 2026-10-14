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

describe('쪽마다 되풀이되는 머리말·꼬리말 surface', () => {
  const headerScope = `${sectionPath}:sublist:HEADER_FOOTER_TEXT:header:p0`
  const headerA = `${sectionPath}#header:t:0`
  const headerB = `${sectionPath}#header:t:1`
  // 쪽 두 개에 같은 머리말(run 두 개)이 그려지고, 그 사이에 본문 surface가 있다.
  const repeated: ParagraphEditorSurface[] = [
    { textNodeId: headerA, textLength: 3, rangeScope: headerScope, instance: '0' },
    { textNodeId: headerB, textLength: 4, rangeScope: headerScope, instance: '0' },
    { textNodeId: `${sectionPath}#hp:t:0`, textLength: 3, rangeScope: topLevelScope, instance: '0' },
    { textNodeId: headerA, textLength: 3, rangeScope: headerScope, instance: '1' },
    { textNodeId: headerB, textLength: 4, rangeScope: headerScope, instance: '1' },
    { textNodeId: `${sectionPath}#hp:t:1`, textLength: 4, rangeScope: topLevelScope, instance: '1' }
  ]
  const collapsed = (textNodeId: string, offset: number) => ({
    sectionPath,
    anchorTextNodeId: textNodeId,
    anchorOffset: offset,
    focusTextNodeId: textNodeId,
    focusOffset: offset
  })

  test('run 하나뿐인 머리말 끝에서 ArrowRight는 다음 쪽의 같은 글자 처음으로 가지 않고 멈춘다', () => {
    const single = repeated.filter((surface) => surface.textNodeId !== headerB)
    expect(moveParagraphEditorSelection(single, headerA, 'next', collapsed(headerA, 3), false, '0')).toBeUndefined()
    expect(moveParagraphEditorSelection(single, headerA, 'next', collapsed(headerA, 3), false)).toBeUndefined()
    expect(moveParagraphEditorSelection(single, headerA, 'previous', collapsed(headerA, 0), false, '1')).toBeUndefined()
  })

  test('마지막 run 끝에서 ArrowRight·Shift+ArrowRight는 다음 쪽 머리말 첫 run으로 넘어가지 않는다', () => {
    for (const instance of ['0', '1', undefined]) {
      expect(moveParagraphEditorSelection(repeated, headerB, 'next', collapsed(headerB, 4), false, instance)).toBeUndefined()
      expect(moveParagraphEditorSelection(repeated, headerB, 'next', collapsed(headerB, 4), true, instance)).toBeUndefined()
    }
  })

  test('둘째 쪽 머리말 안에서도 run 사이 이동·확장은 한 머리말 안에서만 일어난다', () => {
    expect(moveParagraphEditorSelection(repeated, headerA, 'next', collapsed(headerA, 3), false, '1'))
      .toEqual(collapsed(headerB, 0))
    expect(moveParagraphEditorSelection(repeated, headerB, 'previous', collapsed(headerB, 0), false, '1'))
      .toEqual(collapsed(headerA, 3))
    expect(moveParagraphEditorSelection(repeated, headerA, 'previous', collapsed(headerA, 0), false, '1')).toBeUndefined()
    expect(moveParagraphEditorSelection(
      repeated,
      headerB,
      'previous',
      { ...collapsed(headerB, 2), focusOffset: 0 },
      true,
      '1'
    )).toEqual({ ...collapsed(headerB, 2), focusTextNodeId: headerA, focusOffset: 3 })
  })

  test('되풀이되지 않는 본문 surface는 쪽이 달라도 이어서 이동한다', () => {
    expect(moveParagraphEditorSelection(
      repeated,
      `${sectionPath}#hp:t:0`,
      'next',
      collapsed(`${sectionPath}#hp:t:0`, 3),
      false,
      '0'
    )).toEqual(collapsed(`${sectionPath}#hp:t:1`, 0))
  })
})
