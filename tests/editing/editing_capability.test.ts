import { characterStyleCapability } from '../../src/core/editing/editing_capability'

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
})
