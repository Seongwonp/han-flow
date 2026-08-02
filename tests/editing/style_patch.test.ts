import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxEditHistory } from '../../src/core/editing/history'
import {
  applyCharacterStyleCommand,
  applyParagraphStyleCommand,
  applyRestoreCharacterRunCommand,
  applyRestoreStyleCommand
} from '../../src/core/editing/style_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { EditTransaction, EditorSelection } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createRoundTripHwpx, roundTripSentinels } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'

function selection(textNodeId: string): EditorSelection {
  return {
    sectionPath,
    textNodeId,
    anchorOffset: 0,
    focusOffset: 0
  }
}

describe('HWPX 문단·글자 style patch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-style-'))
  const fixture = createRoundTripHwpx(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  async function sourceWithCounts(): Promise<HwpxSourcePackage> {
    const source = await HwpxSourcePackage.open(fixture)
    const headerPath = 'Contents/header.xml'
    const header = source
      .readEntry(headerPath)
      .toString('utf8')
      .replace('<hh:charProperties>', '<hh:charProperties itemCnt="1">')
      .replace('<hh:paraProperties>', '<hh:paraProperties itemCnt="4">')
    return source.withEntry(headerPath, Buffer.from(header))
  }

  function editableAnchor(source: HwpxSourcePackage) {
    const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === '')
    if (!anchor) throw new Error('공개 style fixture anchor가 없습니다.')
    return anchor
  }

  async function sourceWithEditableText(): Promise<HwpxSourcePackage> {
    const source = await sourceWithCounts()
    const xml = source
      .readEntry(sectionPath)
      .toString('utf8')
      .replace('<hp:t></hp:t>', '<hp:t>앞&lt;&amp;중간뒤</hp:t>')
    return source.withEntry(sectionPath, Buffer.from(xml))
  }

  test('원본 charPr를 복제해 굵기를 바꾸고 inverse로 header·section bytes를 복원한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const originalHeader = source.readEntry('Contents/header.xml')
    const originalSection = source.readEntry(sectionPath)
    const result = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      bold: false
    })

    expect(result.changed).toBe(true)
    expect(result.package.revision).toBe(source.revision + 2)
    expect(result.lossReport.modifiedEntries).toEqual(['Contents/header.xml', sectionPath])
    const header = result.package.readEntry('Contents/header.xml').toString('utf8')
    expect(header).toContain('<hh:charProperties itemCnt="2">')
    expect(header.match(/<hh:charPr\b/g)).toHaveLength(2)
    expect(header).toContain(roundTripSentinels.headerNode)
    const section = result.package.readEntry(sectionPath).toString('utf8')
    expect(section).toContain(roundTripSentinels.sectionNode)
    expect(section).toContain('<hp:run charPrIDRef="1"><hp:t></hp:t></hp:run>')

    const projected = await decodeViewerDocument(result.package)
    expect(projected.charStyles['1']).toMatchObject({ id: '1', bold: false })
    expect(projected.sections[0].blocks.at(-1)?.content[0]).toMatchObject({ charStyleId: '1' })

    const restored = applyRestoreStyleCommand(result.package, result.inverse!)
    expect(restored.package.readEntry('Contents/header.xml')).toEqual(originalHeader)
    expect(restored.package.readEntry(sectionPath)).toEqual(originalSection)
  })

  test('동일한 charPr가 있으면 definition을 늘리지 않고 reference만 재사용한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const first = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      bold: false
    })
    const backToBold = applyCharacterStyleCommand(first.package, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      bold: true
    })
    const headerBeforeReuse = backToBold.package.readEntry('Contents/header.xml')
    const reused = applyCharacterStyleCommand(backToBold.package, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      bold: false
    })

    expect(reused.package.readEntry('Contents/header.xml')).toEqual(headerBeforeReuse)
    expect(reused.lossReport.modifiedEntries).toEqual([sectionPath])
    expect(
      reused.package.readEntry(sectionPath).toString('utf8')
    ).toContain('<hp:run charPrIDRef="1"><hp:t></hp:t></hp:run>')
  })

  test('원본 charPr의 글자 크기와 색상만 바꾸고 범위·형식을 검증한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const originalHeader = source.readEntry('Contents/header.xml')
    const styled = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      height: 1200,
      color: '#aabbcc'
    })
    const projected = await decodeViewerDocument(styled.package)
    expect(projected.charStyles['1']).toMatchObject({
      height: 1200,
      color: '#AABBCC',
      bold: true
    })
    expect(styled.package.readEntry('Contents/header.xml').toString('utf8')).toContain(
      'height="1200" textColor="#AABBCC"'
    )
    if (styled.inverse?.type !== 'restore-style') throw new Error('style inverse가 없습니다.')
    expect(applyRestoreStyleCommand(styled.package, styled.inverse).package.readEntry('Contents/header.xml'))
      .toEqual(originalHeader)

    expect(() => applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      height: 499
    })).toThrow('5pt')
    expect(() => applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      color: 'red'
    })).toThrow('#RRGGBB')
  })

  test('기울임·밑줄·취소선을 OWPML 순서로 추가하고 해제와 inverse를 보존한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const originalHeader = source.readEntry('Contents/header.xml')
    const styled = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      italic: true,
      underline: true,
      strikeout: true
    })
    const header = styled.package.readEntry('Contents/header.xml').toString('utf8')
    const definition = header.match(/<hh:charPr id="1"[\s\S]*?<\/hh:charPr>/)?.[0]
    expect(definition).toBeDefined()
    expect(definition).toContain('<hh:italic/>')
    expect(definition).toContain('<hh:underline type="BOTTOM" shape="SOLID" color="#000000"/>')
    expect(definition).toContain('<hh:strikeout shape="SOLID" color="#000000"/>')
    expect(definition!.indexOf('<hh:italic/>')).toBeLessThan(definition!.indexOf('<hh:bold/>'))
    expect(definition!.indexOf('<hh:bold/>')).toBeLessThan(definition!.indexOf('<hh:underline'))
    expect(definition!.indexOf('<hh:underline')).toBeLessThan(definition!.indexOf('<hh:strikeout'))

    const projected = await decodeViewerDocument(styled.package)
    expect(projected.charStyles['1']).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      strikeout: true
    })
    if (styled.inverse?.type !== 'restore-style') throw new Error('style inverse가 없습니다.')
    expect(applyRestoreStyleCommand(styled.package, styled.inverse).package.readEntry('Contents/header.xml'))
      .toEqual(originalHeader)

    const disabled = applyCharacterStyleCommand(styled.package, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      italic: false,
      underline: false,
      strikeout: false
    })
    const disabledProjected = await decodeViewerDocument(disabled.package)
    expect(disabledProjected.charStyles['2']).toMatchObject({
      italic: false,
      underline: false,
      strikeout: false
    })
    expect(disabled.package.readEntry('Contents/header.xml').toString('utf8')).toContain(
      '<hh:underline type="NONE" shape="SOLID" color="#000000"/>'
    )
    expect(disabled.package.readEntry('Contents/header.xml').toString('utf8')).toContain(
      '<hh:strikeout shape="NONE" color="#000000"/>'
    )
  })

  test('hp:t 일부 선택을 세 run으로 나누고 entity 의미와 원본 bytes를 undo·redo한다', async () => {
    const source = await sourceWithEditableText()
    const anchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '앞<&중간뒤'
    )!
    const originalHeader = source.readEntry('Contents/header.xml')
    const originalSection = source.readEntry(sectionPath)
    const result = applyCharacterStyleCommand(source, {
      type: 'apply-character-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      bold: false,
      from: 1,
      to: 5
    })

    expect(result.changed).toBe(true)
    expect(result.inverse?.type).toBe('restore-character-run')
    expect(listHwpxTextAnchors(result.package, sectionPath).slice(anchor.ordinal, anchor.ordinal + 3))
      .toMatchObject([
        { text: '앞' },
        { text: '<&중간' },
        { text: '뒤' }
      ])
    const section = result.package.readEntry(sectionPath).toString('utf8')
    expect(section).toContain(
      '<hp:run charPrIDRef="0"><hp:t>앞</hp:t></hp:run>' +
      '<hp:run charPrIDRef="1"><hp:t>&lt;&amp;중간</hp:t></hp:run>' +
      '<hp:run charPrIDRef="0"><hp:t>뒤</hp:t></hp:run>'
    )
    const projected = await decodeViewerDocument(result.package)
    const content = projected.sections[0].blocks.at(-1)?.content
    expect(content).toMatchObject([
      { type: 'text', text: '앞', charStyleId: '0' },
      { type: 'text', text: '<&중간', charStyleId: '1' },
      { type: 'text', text: '뒤', charStyleId: '0' }
    ])

    if (result.inverse?.type !== 'restore-character-run') throw new Error('run inverse가 없습니다.')
    const restored = applyRestoreCharacterRunCommand(result.package, result.inverse)
    expect(restored.package.readEntry('Contents/header.xml')).toEqual(originalHeader)
    expect(restored.package.readEntry(sectionPath)).toEqual(originalSection)
    expect(restored.inverse?.type).toBe('restore-character-run')
    if (restored.inverse?.type !== 'restore-character-run') throw new Error('redo inverse가 없습니다.')
    const redone = applyRestoreCharacterRunCommand(restored.package, restored.inverse)
    expect(redone.package.readEntry(sectionPath)).toEqual(result.package.readEntry(sectionPath))
  })

  test('paraPr를 복제해 가운데 정렬하고 history undo·redo가 style definition까지 원복한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const originalHeader = source.readEntry('Contents/header.xml')
    const originalSection = source.readEntry(sectionPath)
    const caret = selection(anchor.textNodeId)
    const transaction: EditTransaction = {
      id: 'align-center',
      baseRevision: source.revision,
      commands: [
        {
          type: 'apply-paragraph-style',
          sectionPath,
          textNodeId: anchor.textNodeId,
          align: 'CENTER'
        }
      ],
      selectionBefore: caret,
      selectionAfter: caret,
      inputType: 'formatAlignCENTER',
      timestamp: 1
    }
    const history = new HwpxEditHistory(source)
    const committed = history.commit(transaction)

    expect(committed.changed).toBe(true)
    expect(history.package.readEntry('Contents/header.xml').toString('utf8')).toContain(
      '<hh:paraProperties itemCnt="5">'
    )
    expect(history.package.readEntry(sectionPath).toString('utf8')).toContain(
      '<hp:p paraPrIDRef="4">'
    )
    const projected = await decodeViewerDocument(history.package)
    expect(projected.paraStyles['4']).toMatchObject({ id: '4', align: 'CENTER' })
    expect(projected.sections[0].blocks.at(-1)?.paraStyleId).toBe('4')

    expect(history.undo()?.selection).toEqual(caret)
    expect(history.package.readEntry('Contents/header.xml')).toEqual(originalHeader)
    expect(history.package.readEntry(sectionPath)).toEqual(originalSection)
    history.redo()
    expect(history.package.readEntry('Contents/header.xml').toString('utf8')).toContain(
      '<hh:paraPr id="4">'
    )
  })

  test('줄 간격과 문단 앞뒤 간격을 복제된 paraPr에 기록하고 inverse로 원복한다', async () => {
    const counted = await sourceWithCounts()
    const preservedMargins = counted.readEntry('Contents/header.xml').toString('utf8')
      .replace('<hc:left value="0"/>', '<hc:left value="500"/>')
      .replace('<hc:right value="0"/>', '<hc:right value="600"/>')
    const source = counted.withEntry('Contents/header.xml', Buffer.from(preservedMargins))
    const anchor = editableAnchor(source)
    const originalHeader = source.readEntry('Contents/header.xml')
    const originalSection = source.readEntry(sectionPath)
    const result = applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      lineSpacing: 180,
      indent: -200,
      marginBefore: 200,
      marginAfter: 300
    })

    expect(result.changed).toBe(true)
    const header = result.package.readEntry('Contents/header.xml').toString('utf8')
    const definition = header.match(/<hh:paraPr id="4"[\s\S]*?<\/hh:paraPr>/)?.[0]
    expect(definition).toContain('<hh:lineSpacing value="180" type="PERCENT" unit="HWPUNIT"/>')
    expect(definition).toContain('<hc:intent value="-200" unit="HWPUNIT"/>')
    expect(definition).toContain('<hc:prev value="200" unit="HWPUNIT"/>')
    expect(definition).toContain('<hc:next value="300" unit="HWPUNIT"/>')
    const projected = await decodeViewerDocument(result.package)
    expect(projected.paraStyles['4']).toMatchObject({
      lineSpacing: 180,
      indent: -200,
      margin: { left: 500, right: 600, top: 200, bottom: 300 }
    })
    if (result.inverse?.type !== 'restore-style') throw new Error('문단 style inverse가 없습니다.')
    const restored = applyRestoreStyleCommand(result.package, result.inverse)
    expect(restored.package.readEntry('Contents/header.xml')).toEqual(originalHeader)
    expect(restored.package.readEntry(sectionPath)).toEqual(originalSection)

    expect(() => applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style', sectionPath, textNodeId: anchor.textNodeId, lineSpacing: 90
    })).toThrow('100%')
    expect(() => applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style', sectionPath, textNodeId: anchor.textNodeId, marginBefore: 7300
    })).toThrow('72pt')
    expect(() => applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style', sectionPath, textNodeId: anchor.textNodeId, indent: -7300
    })).toThrow('-72pt')
  })

  test('이미 같은 문단 정렬은 no-op이고 표 셀처럼 제한 밖 anchor는 거부한다', async () => {
    const source = await sourceWithCounts()
    const anchor = editableAnchor(source)
    const noOp = applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style',
      sectionPath,
      textNodeId: anchor.textNodeId,
      align: 'LEFT'
    })
    expect(noOp.changed).toBe(false)
    expect(noOp.package).toBe(source)

    const tableAnchor = listHwpxTextAnchors(source, sectionPath).find(
      (candidate) => candidate.text === '공개 헤더'
    )!
    expect(() =>
      applyCharacterStyleCommand(source, {
        type: 'apply-character-style',
        sectionPath,
        textNodeId: tableAnchor.textNodeId,
        bold: false
      })
    ).toThrow('최상위 일반 문단')
  })
})
