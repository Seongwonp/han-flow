import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import {
  applyReplaceParagraphFragmentCommand,
  ParagraphPatchResult,
  planMergeParagraph,
  planReplaceParagraphSelection,
  planSplitParagraph,
  ReplaceParagraphFragmentCommand
} from '../../src/core/editing/paragraph_patch'
import { planReplaceSelection } from '../../src/core/editing/range_edit'
import { createEditorSelection, EditorSelection } from '../../src/core/editing/selection'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

// 문단 분할·병합·범위 치환이 지우지 않은 부분의 inline `hp:tab`(attribute 포함)·`hp:lineBreak`·entity 표기를 원문 그대로
// 남기는지, 실행 취소가 원래 bytes를 복원하는지 확인한다. 3단계 전환 전 문자열 경로는 경계 hp:t를 논리 text에서
// 다시 써 `<hp:tab .../>`를 `&#9;`로 바꿨다(그 출력은 각 test의 주석에 적는다).

const sectionPath = 'Contents/section0.xml'
const TAB = '<hp:tab width="3112" leader="0" type="1"/>'
const LINESEG = '<hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray>'

describe('문단 구조 편집의 inline control·원문 표기 보존', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-paragraph-inline-'))
  let base: HwpxSourcePackage

  beforeAll(async () => {
    base = await HwpxSourcePackage.open(createRoundTripHwpx(directory, 'paragraph-inline.hwpx'))
  })

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  function withParagraphs(...paragraphs: string[]): HwpxSourcePackage {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">' +
      paragraphs.join('') +
      '</hs:sec>'
    return base.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
  }

  function section(sourcePackage: HwpxSourcePackage): string {
    return sourcePackage.readEntry(sectionPath).toString('utf8')
  }

  function id(ordinal: number): string {
    return `${sectionPath}#hp:t:${ordinal}`
  }

  /** 결과를 적용하고 inverse가 원래 bytes를, 그 inverse가 결과 bytes를 되살리는지 확인한다. */
  function applyExact(source: HwpxSourcePackage, command: ReplaceParagraphFragmentCommand): ParagraphPatchResult {
    const result = applyReplaceParagraphFragmentCommand(source, command)
    const undone = applyReplaceParagraphFragmentCommand(result.package, result.inverse)
    expect(section(undone.package)).toBe(section(source))
    const redone = applyReplaceParagraphFragmentCommand(undone.package, undone.inverse)
    expect(section(redone.package)).toBe(section(result.package))
    return result
  }

  const tabParagraph = `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>앞${TAB}뒤&#x41;</hp:t></hp:run>${LINESEG}</hp:p>`

  test('hp:tab 앞에서 Enter: tab과 뒤 원문이 새 문단으로 그대로 옮겨 간다', () => {
    const source = withParagraphs(tabParagraph)
    // 논리 text '앞\t뒤A' — offset 1은 tab 바로 앞이다.
    const plan = planSplitParagraph(source, createEditorSelection(sectionPath, id(0), 1))
    const result = applyExact(source, plan.command)
    expect(section(result.package)).toContain(
      '<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>앞</hp:t></hp:run></hp:p>' +
        `<hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${TAB}뒤&#x41;</hp:t></hp:run></hp:p>`
    )
    // 전환 전: 뒤 문단을 <hp:t>&#9;뒤A</hp:t>로 다시 써 tab 폭·채움 attribute를 잃었다.
    expect(listHwpxTextAnchors(result.package, sectionPath).map((anchor) => anchor.text)).toEqual(['앞', '\t뒤A'])
  })

  test('hp:tab 뒤에서 Enter: tab은 앞 문단 끝에 원문 그대로 남는다', () => {
    const source = withParagraphs(tabParagraph)
    const result = applyExact(source, planSplitParagraph(source, createEditorSelection(sectionPath, id(0), 2)).command)
    expect(section(result.package)).toContain(
      `<hp:t>앞${TAB}</hp:t></hp:run></hp:p><hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>뒤&#x41;</hp:t>`
    )
  })

  test('hp:tab을 선택하고 Enter: 선택한 tab만 지우고 양쪽 원문은 그대로다', () => {
    const source = withParagraphs(tabParagraph)
    const plan = planSplitParagraph(source, createEditorSelection(sectionPath, id(0), 1, 2))
    const result = applyExact(source, plan.command)
    expect(section(result.package)).toContain(
      '<hp:t>앞</hp:t></hp:run></hp:p><hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>뒤&#x41;</hp:t>'
    )
    expect(section(result.package)).not.toContain('hp:tab')
    // 실행 취소는 attribute 있는 tab을 포함한 원래 문단 bytes를 되살린다(inverse fragment가 원문을 들고 있다).
    expect(result.inverse.replacementFragment).toContain(TAB)
  })

  test('첫 문단이 hp:tab으로 끝나는 두 문단 병합: tab과 두 run 원문이 그대로다', () => {
    const source = withParagraphs(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>제목${TAB}</hp:t></hp:run>${LINESEG}</hp:p>`,
      `<hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="1"><hp:t>&#x31;쪽</hp:t></hp:run>${LINESEG}</hp:p>`
    )
    const backward = planMergeParagraph(source, createEditorSelection(sectionPath, id(1), 0), 'previous')
    const forward = planMergeParagraph(source, createEditorSelection(sectionPath, id(0), 3), 'next')
    expect(backward.command).toEqual(forward.command)
    // 병합은 전환 전에도 run 원문을 그대로 이어 붙였으므로 command가 같았다.
    const result = applyExact(source, backward.command)
    expect(section(result.package)).toContain(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>제목${TAB}</hp:t></hp:run>` +
        '<hp:run charPrIDRef="1"><hp:t>&#x31;쪽</hp:t></hp:run></hp:p></hs:sec>'
    )
    expect(backward.selectionAfter).toEqual(createEditorSelection(sectionPath, id(1), 0))
  })

  test('hp:tab을 가로질러 지우는 여러 문단 범위 치환: 범위 밖 tab·entity는 그대로, 범위 안 tab은 지운다', () => {
    const source = withParagraphs(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>가${TAB}나${TAB}다</hp:t></hp:run>${LINESEG}</hp:p>`,
      `<hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="1"><hp:t>중간</hp:t></hp:run>${LINESEG}</hp:p>`,
      `<hp:p id="3" paraPrIDRef="0"><hp:run charPrIDRef="2"><hp:t>라${TAB}마&apos;</hp:t></hp:run>${LINESEG}</hp:p>`
    )
    // '가\t나\t다'의 offset 3('나' 뒤, 둘째 tab 앞)부터 '라\t마''의 offset 2(tab 뒤)까지 '새\t글'로 바꾼다.
    const selection: EditorSelection = {
      sectionPath,
      anchorTextNodeId: id(0),
      anchorOffset: 3,
      focusTextNodeId: id(2),
      focusOffset: 2
    }
    const plan = planReplaceSelection(source, selection, '새\t글')
    expect(plan.commands).toHaveLength(1)
    const command = plan.commands[0] as ReplaceParagraphFragmentCommand
    expect(command).toEqual(planReplaceParagraphSelection(source, selection, '새\t글').command)
    const result = applyExact(source, command)
    expect(section(result.package)).toContain(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>가${TAB}나새&#9;글</hp:t></hp:run>` +
        '<hp:run charPrIDRef="2"><hp:t>마&apos;</hp:t></hp:run></hp:p></hs:sec>'
    )
    // 전환 전: 남은 조각을 논리 text에서 다시 써 앞 tab을 &#9;로, &apos;를 '로 바꿨다
    // (<hp:t>가&#9;나새&#9;글</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>마'</hp:t>).
    expect(plan.selectionAfter).toEqual(createEditorSelection(sectionPath, id(0), 6))
    expect(plan.affectedTextNodeIds).toEqual([id(0), id(1), id(2)])
  })

  test('Enter 뒤 Backspace: 두 run으로 나뉜 것과 hp:linesegarray 제거만 남고 hp:t 원문은 byte 그대로다', () => {
    const source = withParagraphs(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>앞${TAB}가&#x41;<hp:lineBreak/>뒤</hp:t></hp:run>${LINESEG}</hp:p>`
    )
    const split = planSplitParagraph(source, createEditorSelection(sectionPath, id(0), 3))
    const splitResult = applyExact(source, split.command)
    const merge = planMergeParagraph(splitResult.package, split.selectionAfter, 'previous')
    const merged = applyExact(splitResult.package, merge.command)
    const run = (content: string): string => `<hp:run charPrIDRef="0"><hp:t>${content}</hp:t></hp:run>`
    expect(section(merged.package)).toBe(
      section(source).replace(
        `${run(`앞${TAB}가&#x41;<hp:lineBreak/>뒤`)}${LINESEG}`,
        run(`앞${TAB}가`) + run('&#x41;<hp:lineBreak/>뒤')
      )
    )
    // 전환 전 경로는 같은 두 단계에서 tab과 &#x41;를 기본 표기로 바꿨다(run('앞&#9;가') + run('A<hp:lineBreak/>뒤')).

    // history로 두 단계를 되돌리면 원래 bytes다.
    const history = new HwpxEditHistory(source)
    const caret = createEditorSelection(sectionPath, id(0), 3)
    history.setSelection(caret)
    history.commit({
      id: 'split', baseRevision: source.revision, commands: [split.command], selectionBefore: caret,
      selectionAfter: split.selectionAfter, inputType: 'insertParagraph', timestamp: 1
    })
    history.commit({
      id: 'merge', baseRevision: history.package.revision, commands: [merge.command],
      selectionBefore: split.selectionAfter, selectionAfter: merge.selectionAfter, inputType: 'deleteContentBackward',
      timestamp: 10_000
    })
    expect(section(history.package)).toBe(section(merged.package))
    expect(history.undo()?.selection).toEqual(split.selectionAfter)
    expect(history.undo()?.selection).toEqual(caret)
    expect(section(history.package)).toBe(section(source))
  })

  test('기본 표기 문단의 Enter 뒤 Backspace는 전환 전 경로와 같은 bytes를 쓴다', () => {
    const source = withParagraphs(
      `<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>가나&amp;다</hp:t></hp:run>${LINESEG}</hp:p>`
    )
    const caret = createEditorSelection(sectionPath, id(0), 2)
    const split = applyReplaceParagraphFragmentCommand(source, planSplitParagraph(source, caret).command)
    // 3단계 전환 전 경로의 출력과 같은 bytes(기본 표기 hp:t는 두 경로가 같았다).
    expect(section(split.package)).toContain(
      '<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>가나</hp:t></hp:run></hp:p>' +
        '<hp:p id="2" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>&amp;다</hp:t></hp:run></hp:p></hs:sec>'
    )
    const after = createEditorSelection(sectionPath, id(1), 0)
    const merged = applyReplaceParagraphFragmentCommand(split.package, planMergeParagraph(split.package, after, 'previous').command)
    expect(section(merged.package)).toContain(
      '<hp:p id="1" paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>가나</hp:t></hp:run>' +
        '<hp:run charPrIDRef="0"><hp:t>&amp;다</hp:t></hp:run></hp:p></hs:sec>'
    )
  })

  test('fragment가 node 경계와 맞지 않거나 교체 fragment가 올바른 XML이 아니면 적용하지 않는다', () => {
    const source = withParagraphs(tabParagraph)
    const plan = planSplitParagraph(source, createEditorSelection(sectionPath, id(0), 1))
    const truncated = { ...plan.command, expectedFragment: plan.command.expectedFragment.slice(0, -3) }
    expect(() => applyReplaceParagraphFragmentCommand(source, truncated)).toThrow('문단 fragment가 변경되어')
    const broken = { ...plan.command, replacementFragment: '<hp:p><hp:run>' }
    expect(() => applyReplaceParagraphFragmentCommand(source, broken)).toThrow('올바른 XML이 아니어서')
    expect(section(source)).toContain(tabParagraph)
  })
})
