import {
  editedStructuresForCommands,
  mergeEditedStructures
} from '../../src/core/editing/loss_policy'
import type { EditCommand } from '../../src/core/editing/transaction'

describe('HWPX structure loss policy', () => {
  test('command를 사용자에게 노출할 네 구조로 안정적인 순서에 분류한다', () => {
    const common = { sectionPath: 'Contents/section0.xml', textNodeId: 'text-0' }
    const commands = [
      { type: 'replace-paragraph-fragment' },
      { type: 'apply-paragraph-style' },
      { type: 'restore-style', target: 'character' },
      { type: 'replace-text' },
      { type: 'restore-character-run' }
    ].map((command) => ({ ...common, ...command })) as EditCommand[]

    expect(editedStructuresForCommands(commands)).toEqual([
      'text',
      'character-style',
      'paragraph-style',
      'paragraph-structure'
    ])
  })

  test('누적 구조는 중복 없이 고정된 안내 순서를 유지한다', () => {
    expect(mergeEditedStructures(
      ['paragraph-style', 'text'],
      ['character-style', 'text']
    )).toEqual(['text', 'character-style', 'paragraph-style'])
  })
})
