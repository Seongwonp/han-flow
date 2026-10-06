import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { editingCapabilities } from '../../src/core/editing/editing_capability'
import { HwpxEditHistory } from '../../src/core/editing/history'
import { applyCharacterStyleCommand, applyParagraphStyleCommand } from '../../src/core/editing/style_patch'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditCommand, EditorSelection, EditTransaction } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createCompatibilityHwpx } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'
const headerPath = 'Contents/header.xml'

// images-rowspan fixture의 merged-table: 머리글 행(H1, H2), rowSpan=2 병합 셀(R), 일반 셀(A, B).
// 셀 글자를 여러 글자로 늘려 부분 선택을 확인하고, B 셀에는 표를 하나 더 넣어 셀 안 표가 계속 거부되는지 본다.
function createFixture(directory: string): string {
  const path = createCompatibilityHwpx(directory, 'table-cell-style.hwpx')
  const zip = new AdmZip(path)
  const section = zip.readAsText(sectionPath)
  const nested =
    '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>바깥</hp:t></hp:run></hp:p>' +
    '<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:tbl id="nested-table" rowCnt="1" colCnt="1"><hp:sz width="3000" height="1000"/>' +
    '<hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="3000" height="1000"/>' +
    '<hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>안쪽</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>'
  const next = section
    .replace('<hp:t>A</hp:t>', '<hp:t>일반 셀 글자</hp:t>')
    .replace('<hp:t>R</hp:t>', '<hp:t>병합 셀 글자</hp:t>')
    .replace('<hp:t>H1</hp:t>', '<hp:t>머리글 셀 글자</hp:t>')
    .replace('<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>B</hp:t></hp:run></hp:p>', nested)
  expect(next).toContain('nested-table')
  zip.updateFile(sectionPath, Buffer.from(next))
  const header = zip.readAsText(headerPath)
    .replace('<hh:charProperties>', '<hh:charProperties itemCnt="1">')
    .replace('<hh:paraProperties>', '<hh:paraProperties itemCnt="4">')
  zip.updateFile(headerPath, Buffer.from(header))
  zip.writeZip(path)
  return path
}

function caret(textNodeId: string, anchorOffset: number, focusOffset = anchorOffset): EditorSelection {
  return { sectionPath, anchorTextNodeId: textNodeId, anchorOffset, focusTextNodeId: textNodeId, focusOffset }
}

function transaction(source: HwpxSourcePackage, command: EditCommand, selection: EditorSelection): EditTransaction {
  return {
    id: `style-${command.type}`,
    baseRevision: source.revision,
    commands: [command],
    selectionBefore: selection,
    selectionAfter: selection,
    inputType: 'formatBold',
    timestamp: 1
  }
}

describe('표 셀 안 글자·문단 모양', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-table-cell-style-'))
  const fixture = createFixture(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  async function open() {
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, sectionPath)
    const anchor = (text: string) => {
      const found = anchors.find((candidate) => candidate.text === text)
      if (!found) throw new Error(`anchor 없음: ${text}`)
      return found
    }
    return {
      source,
      anchor,
      section: source.readEntry(sectionPath),
      header: source.readEntry(headerPath)
    }
  }

  const cells = [
    ['일반 셀', '일반 셀 글자'],
    ['병합 셀', '병합 셀 글자'],
    ['머리글 셀', '머리글 셀 글자']
  ] as const

  test.each(cells)('%s caret에서 capability가 글자·문단 모양을 연다', async (_label, text) => {
    const { source, anchor } = await open()
    const document = await decodeViewerDocument(source)
    const capability = editingCapabilities(document, caret(anchor(text).textNodeId, 1))
    expect(capability.focus?.structure).toBe('TABLE_CELL_TEXT')
    expect(capability.characterStyle).toEqual({ available: true })
    expect(capability.paragraphStyle).toEqual({ available: true })
  })

  test.each(cells)('%s run 전체 굵게·크기·색이 새 charPr로 들어가고 undo·redo가 bytes를 그대로 되돌린다', async (_label, text) => {
    const { source, anchor, section, header } = await open()
    const target = anchor(text)
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: target.textNodeId,
      bold: false,
      height: 1500,
      color: '#12ab34'
    }, caret(target.textNodeId, 0, text.length)))

    const editedHeader = history.package.readEntry(headerPath).toString('utf8')
    expect(editedHeader).toContain('<hh:charProperties itemCnt="2">')
    expect(editedHeader).toMatch(/<hh:charPr id="1" height="1500" textColor="#12AB34"><hh:fontRef hangul="0"\/><\/hh:charPr>/)
    expect(history.package.readEntry(sectionPath).toString('utf8')).toContain(`<hp:run charPrIDRef="1"><hp:t>${text}</hp:t></hp:run>`)
    const projected = await decodeViewerDocument(history.package)
    expect(projected.charStyles['1']).toMatchObject({ bold: false, height: 1500, color: '#12AB34' })

    const edited = { section: history.package.readEntry(sectionPath), header: history.package.readEntry(headerPath) }
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(section)
    expect(history.package.readEntry(headerPath)).toEqual(header)
    history.redo()
    expect(history.package.readEntry(sectionPath)).toEqual(edited.section)
    expect(history.package.readEntry(headerPath)).toEqual(edited.header)
  })

  test.each(cells)('%s 부분 선택은 run을 셋으로 나누고 undo가 원래 run 하나를 되살린다', async (_label, text) => {
    const { source, anchor, section, header } = await open()
    const target = anchor(text)
    const from = text.indexOf('셀')
    const result = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: target.textNodeId,
      bold: false,
      from,
      to: from + 1
    })
    expect(result.inverse?.type).toBe('restore-character-run')
    const xml = result.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain(
      `<hp:run charPrIDRef="0"><hp:t>${text.slice(0, from)}</hp:t></hp:run>` +
      '<hp:run charPrIDRef="1"><hp:t>셀</hp:t></hp:run>' +
      `<hp:run charPrIDRef="0"><hp:t>${text.slice(from + 1)}</hp:t></hp:run>`
    )
    const document = await decodeViewerDocument(result.package)
    const anchors = listHwpxTextAnchors(result.package, sectionPath)
    const styled = anchors.find((candidate) => candidate.text === '셀')!
    expect(editingCapabilities(document, caret(styled.textNodeId, 0, 1)).characterStyle.available).toBe(true)

    // 편집 세션처럼 selectionAfter는 가운데로 나뉜 새 run을 가리킨다.
    const history = new HwpxEditHistory(source)
    history.commit({
      ...transaction(source, {
        type: 'apply-character-style',
        sectionPath,
        textNodeId: target.textNodeId,
        bold: false,
        from,
        to: from + 1
      }, caret(target.textNodeId, from, from + 1)),
      selectionAfter: caret(`${sectionPath}#hp:t:${target.ordinal + 1}`, 0, 1)
    })
    expect(history.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(section)
    expect(history.package.readEntry(headerPath)).toEqual(header)
  })

  test.each(cells)('%s 문단 정렬·줄 간격·간격·들여쓰기가 새 paraPr로 들어가고 undo가 정확하다', async (_label, text) => {
    const { source, anchor, section, header } = await open()
    const target = anchor(text)
    const history = new HwpxEditHistory(source)
    history.commit(transaction(source, {
      type: 'apply-paragraph-style',
      sectionPath,
      textNodeId: target.textNodeId,
      align: 'CENTER',
      lineSpacing: 200,
      marginBefore: 300,
      marginAfter: 100,
      indent: -200
    }, caret(target.textNodeId, 1)))

    const editedHeader = history.package.readEntry(headerPath).toString('utf8')
    expect(editedHeader).toContain('<hh:paraProperties itemCnt="5">')
    const xml = history.package.readEntry(sectionPath).toString('utf8')
    expect(xml).toContain(`<hp:p paraPrIDRef="4"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`)
    // 다른 셀 문단은 그대로다.
    expect(xml.match(/paraPrIDRef="4"/g)).toHaveLength(1)
    const projected = await decodeViewerDocument(history.package)
    expect(projected.paraStyles['4']).toMatchObject({
      align: 'CENTER',
      lineSpacing: 200,
      indent: -200,
      margin: { top: 300, bottom: 100 }
    })

    history.undo()
    expect(history.package.readEntry(sectionPath)).toEqual(section)
    expect(history.package.readEntry(headerPath)).toEqual(header)
    history.redo()
    expect(history.package.readEntry(sectionPath).toString('utf8')).toBe(xml)
  })

  test('셀 안에 다시 든 표의 문단은 글자·문단 모양 모두 거부하고 바깥 셀 문단은 허용한다', async () => {
    const { source, anchor } = await open()
    const inner = anchor('안쪽')
    for (const apply of [
      () => applyCharacterStyleCommand(source, { type: 'apply-character-style', sectionPath, textNodeId: inner.textNodeId, bold: false }),
      () => applyParagraphStyleCommand(source, { type: 'apply-paragraph-style', sectionPath, textNodeId: inner.textNodeId, align: 'RIGHT' })
    ]) {
      expect(apply).toThrow(HwpxEditConflictError)
      expect(apply).toThrow('최상위 표 셀 직속 문단')
    }
    expect(applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor('바깥').textNodeId,
      bold: false
    }).changed).toBe(true)

    // decoder·capability도 셀 안 표의 text를 편집 대상으로 내놓지 않는다.
    const document = await decodeViewerDocument(source)
    expect(editingCapabilities(document, caret(inner.textNodeId, 0)).selection).toEqual({
      available: false,
      reason: 'STALE_SELECTION'
    })
  })
})
