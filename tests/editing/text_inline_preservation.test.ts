import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyReplaceTextCommand,
  HwpxEditConflictError,
  listHwpxTextAnchors,
  ReplaceTextCommand,
  ReplaceTextResult
} from '../../src/core/editing/text_patch'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { EditorSelection } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

// 편집한 hp:t 안에서 범위 밖 원문(attribute 있는 inline `hp:tab`, `hp:lineBreak`, 비표준 entity 표기, 원문 CR/LF)을
// byte 그대로 보존하고, 실행 취소가 지운 범위의 원문 표기까지 복원하는지 확인한다.

const sectionPath = 'Contents/section0.xml'
const TAB = '<hp:tab width="3112" leader="0" type="1"/>'
const TAB_TEXT = `<hp:t>탭${TAB}뒤&#x41;&apos;&#13;&gt;</hp:t>`
const CRLF_TEXT = '<hp:t>줄<hp:lineBreak/>바꿈\r\n둘</hp:t>'

describe('hp:t 편집의 inline control·원문 표기 보존', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-inline-'))
  let original: HwpxSourcePackage
  let originalXml: string

  beforeAll(async () => {
    const base = await HwpxSourcePackage.open(createRoundTripHwpx(directory, 'inline.hwpx'))
    originalXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\r\n',
      '<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">\r\n',
      `<hp:p><hp:run>${TAB_TEXT}</hp:run></hp:p>\r\n`,
      `<hp:p><hp:run>${CRLF_TEXT}</hp:run></hp:p>\r\n`,
      '</hs:sec>\r\n'
    ].join('')
    original = base.withEntry(sectionPath, Buffer.from(originalXml, 'utf8'))
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function anchorId(ordinal: number): string {
    return `${sectionPath}#hp:t:${ordinal}`
  }

  function apply(
    sourcePackage: HwpxSourcePackage,
    ordinal: number,
    from: number,
    to: number,
    insert: string
  ): ReplaceTextResult {
    return applyReplaceTextCommand(sourcePackage, {
      type: 'replace-text',
      revision: sourcePackage.revision,
      sectionPath,
      textNodeId: anchorId(ordinal),
      from,
      to,
      insert
    })
  }

  function undo(result: ReplaceTextResult): HwpxSourcePackage {
    return applyReplaceTextCommand(result.package, { ...result.inverse, revision: result.package.revision }).package
  }

  function section(sourcePackage: HwpxSourcePackage): string {
    return sourcePackage.readEntry(sectionPath).toString('utf8')
  }

  test('anchor 논리 text는 hp:tab을 탭 문자로, 원문 CR/LF를 그대로 읽는다', () => {
    expect(listHwpxTextAnchors(original, sectionPath).map((anchor) => anchor.text)).toEqual([
      "탭\t뒤A'\r>",
      '줄\n바꿈\r\n둘'
    ])
  })

  test('빈 편집은 모든 위치에서 byte 단위로 같은 section을 만든다', () => {
    for (const [ordinal, length] of [[0, 7], [1, 7]] as const) {
      for (let offset = 0; offset <= length; offset += 1) {
        const result = apply(original, ordinal, offset, offset, '')
        expect(section(result.package)).toBe(originalXml)
        expect(result.inverse.insertSource).toBeUndefined()
        expect(section(undo(result))).toBe(originalXml)
      }
    }
  })

  test('hp:tab 앞·뒤 입력은 탭 attribute와 나머지 entity 표기를 그대로 둔다', () => {
    const before = apply(original, 0, 0, 0, 'X')
    expect(section(before.package)).toContain(`<hp:t>X탭${TAB}뒤&#x41;&apos;&#13;&gt;</hp:t>`)
    expect(section(undo(before))).toBe(originalXml)

    const after = apply(original, 0, 2, 2, 'Y')
    expect(after.anchor.text).toBe("탭\tY뒤A'\r>")
    expect(section(after.package)).toContain(`<hp:t>탭${TAB}Y뒤&#x41;&apos;&#13;&gt;</hp:t>`)
    expect(section(undo(after))).toBe(originalXml)

    // 원문 text node 한가운데 입력도 앞뒤 원문 표기를 자르지 않는다.
    const middle = apply(original, 0, 4, 4, '&')
    expect(section(middle.package)).toContain(`<hp:t>탭${TAB}뒤&#x41;&amp;&apos;&#13;&gt;</hp:t>`)
    expect(section(undo(middle))).toBe(originalXml)
  })

  test('hp:tab을 가로지르는 삭제는 그 element를 지우고 undo는 attribute까지 복원한다', () => {
    const deleted = apply(original, 0, 0, 3, '')
    expect(deleted.anchor.text).toBe("A'\r>")
    expect(section(deleted.package)).toContain('<hp:t>&#x41;&apos;&#13;&gt;</hp:t>')
    expect(section(deleted.package)).not.toContain('hp:tab')
    expect(deleted.inverse).toMatchObject({ from: 0, to: 0, insert: '탭\t뒤', insertSource: `탭${TAB}뒤` })
    expect(section(undo(deleted))).toBe(originalXml)

    // 탭만 치환해도 attribute 있는 원문 탭이 inverse로 돌아온다.
    const replaced = apply(original, 0, 1, 2, '-')
    expect(section(replaced.package)).toContain('<hp:t>탭-뒤&#x41;&apos;&#13;&gt;</hp:t>')
    expect(section(undo(replaced))).toBe(originalXml)
  })

  test('새로 넣는 탭·줄바꿈은 기존 기본 표기(&#9;, <hp:lineBreak/>)를 쓴다', () => {
    const inserted = apply(original, 0, 3, 3, '\t\n\r')
    expect(section(inserted.package)).toContain(`<hp:t>탭${TAB}뒤&#9;<hp:lineBreak/>&#13;&#x41;&apos;&#13;&gt;</hp:t>`)
    expect(inserted.inverse.insertSource).toBeUndefined()
    expect(section(undo(inserted))).toBe(originalXml)
  })

  test('편집 범위 밖 entity 표기는 그대로이고, 범위 안 entity는 undo가 원문 표기로 되살린다', () => {
    const replaced = apply(original, 0, 3, 4, 'B')
    expect(section(replaced.package)).toContain(`<hp:t>탭${TAB}뒤B&apos;&#13;&gt;</hp:t>`)
    expect(replaced.inverse).toMatchObject({ insert: 'A', insertSource: '&#x41;' })
    expect(section(undo(replaced))).toBe(originalXml)
  })

  test('원문 CR/LF는 편집 범위 밖이면 그대로 두고, 지웠다가 undo하면 원래 문자로 돌아온다', () => {
    const appended = apply(original, 1, 7, 7, 'X')
    expect(section(appended.package)).toContain('<hp:t>줄<hp:lineBreak/>바꿈\r\n둘X</hp:t>')
    expect(section(undo(appended))).toBe(originalXml)

    const deleted = apply(original, 1, 4, 6, '')
    expect(section(deleted.package)).toContain('<hp:t>줄<hp:lineBreak/>바꿈둘</hp:t>')
    expect(deleted.inverse).toMatchObject({ insert: '\r\n', insertSource: '\r\n' })
    expect(section(undo(deleted))).toBe(originalXml)

    const whole = apply(original, 1, 0, 7, '새')
    expect(section(whole.package)).toContain('<hp:t>새</hp:t>')
    expect(whole.inverse.insertSource).toBe('줄<hp:lineBreak/>바꿈\r\n둘')
    expect(section(undo(whole))).toBe(originalXml)
  })

  test('연속 편집을 역순으로 되돌리면 원래 bytes로 돌아온다(redo 포함)', () => {
    const steps: Array<[number, number, number, string]> = [
      [0, 2, 2, 'ㄱ'],
      [0, 0, 4, ''],
      [0, 0, 0, '\t'],
      [0, 0, 5, 'z'],
      [1, 3, 5, '\n'],
      [1, 0, 6, '']
    ]
    let current = original
    const history: ReplaceTextResult[] = []
    for (const [ordinal, from, to, insert] of steps) {
      const result = apply(current, ordinal, from, to, insert)
      history.push(result)
      current = result.package
    }
    const edited = section(current)
    const redo: ReplaceTextCommand[] = []
    for (const result of [...history].reverse()) {
      const undone = applyReplaceTextCommand(current, { ...result.inverse, revision: current.revision })
      redo.unshift(undone.inverse)
      current = undone.package
    }
    expect(section(current)).toBe(originalXml)
    for (const command of redo) current = applyReplaceTextCommand(current, { ...command, revision: current.revision }).package
    expect(section(current)).toBe(edited)
  })

  test('insertSource가 삽입할 논리 text와 다르거나 inline control이 아닌 표기면 거부한다', () => {
    const base = { type: 'replace-text' as const, revision: original.revision, sectionPath, textNodeId: anchorId(0), from: 0, to: 0 }
    expect(() => applyReplaceTextCommand(original, { ...base, insert: 'A', insertSource: '&#x42;' })).toThrow(HwpxEditConflictError)
    expect(() => applyReplaceTextCommand(original, { ...base, insert: '\t', insertSource: '<hp:tab></hp:tab>' })).toThrow(
      '되돌릴 hp:t 원문 표기'
    )
    expect(() => applyReplaceTextCommand(original, { ...base, insert: 'x', insertSource: '<hp:run/>' })).toThrow(HwpxEditConflictError)
    expect(() => applyReplaceTextCommand(original, { ...base, insert: 'x', insertSource: '<!-- x -->' })).toThrow(HwpxEditConflictError)
    // 실패한 command는 cache된 tree를 바꾸지 않는다.
    expect(section(apply(original, 0, 0, 0, '').package)).toBe(originalXml)
  })

  test('history undo·redo도 transaction inverse를 거쳐 원문 bytes를 복원한다', () => {
    const history = new HwpxEditHistory(original)
    const selection = (offset: number): EditorSelection => ({
      sectionPath,
      anchorTextNodeId: anchorId(0),
      anchorOffset: offset,
      focusTextNodeId: anchorId(0),
      focusOffset: offset
    })
    history.commit({
      id: 'delete-tab',
      baseRevision: original.revision,
      commands: [{ type: 'replace-text', sectionPath, textNodeId: anchorId(0), from: 0, to: 3, insert: '' }],
      selectionBefore: selection(3),
      selectionAfter: selection(0),
      inputType: 'deleteContentBackward',
      timestamp: 1
    })
    const edited = section(history.package)
    expect(edited).toContain('<hp:t>&#x41;&apos;&#13;&gt;</hp:t>')
    history.undo()
    expect(section(history.package)).toBe(originalXml)
    history.redo()
    expect(section(history.package)).toBe(edited)
  })
})
