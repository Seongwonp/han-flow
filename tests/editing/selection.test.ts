import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createEditorSelection,
  equalEditorSelections,
  isCollapsedEditorSelection,
  normalizeEditorSelection,
  validateEditorSelection
} from '../../src/core/editing/selection'
import { HwpxEditConflictError, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

describe('multi-run editor selection domain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-selection-'))
  const fixture = createRoundTripHwpx(directory)
  const sectionPath = 'Contents/section0.xml'

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('단일 run caret를 만들고 동등성을 비교한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, sectionPath)[0]
    const caret = createEditorSelection(sectionPath, anchor.textNodeId, 0)

    expect(isCollapsedEditorSelection(caret)).toBe(true)
    expect(equalEditorSelections(caret, { ...caret })).toBe(true)
    validateEditorSelection(source, caret)
  })

  test('서로 다른 run의 순방향·역방향 범위를 문서 순서로 정규화한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, sectionPath).filter((anchor) => anchor.text.length > 0)
    const first = anchors[0]
    const second = anchors[1]
    const forward = {
      sectionPath,
      anchorTextNodeId: first.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: second.textNodeId,
      focusOffset: 1
    }
    const backward = {
      sectionPath,
      anchorTextNodeId: second.textNodeId,
      anchorOffset: 1,
      focusTextNodeId: first.textNodeId,
      focusOffset: 1
    }

    expect(normalizeEditorSelection(source, forward)).toMatchObject({
      start: { textNodeId: first.textNodeId, offset: 1 },
      end: { textNodeId: second.textNodeId, offset: 1 },
      backward: false
    })
    expect(normalizeEditorSelection(source, backward)).toMatchObject({
      start: { textNodeId: first.textNodeId, offset: 1 },
      end: { textNodeId: second.textNodeId, offset: 1 },
      backward: true
    })
  })

  test('없는 run과 UTF-16 surrogate 중간 offset을 거부한다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const anchor = listHwpxTextAnchors(source, sectionPath)[0]
    expect(() =>
      validateEditorSelection(source, {
        ...createEditorSelection(sectionPath, anchor.textNodeId, 0),
        focusTextNodeId: 'missing-run'
      })
    ).toThrow(HwpxEditConflictError)

    const emojiSource = source.withEntry(
      sectionPath,
      Buffer.from(source.readEntry(sectionPath).toString('utf8').replace(anchor.text, `${anchor.text}😀`), 'utf8')
    )
    const emojiAnchor = listHwpxTextAnchors(emojiSource, sectionPath).find(
      (candidate) => candidate.text.endsWith('😀')
    )!
    expect(() =>
      validateEditorSelection(
        emojiSource,
        createEditorSelection(sectionPath, emojiAnchor.textNodeId, emojiAnchor.text.length - 1)
      )
    ).toThrow(HwpxEditConflictError)
  })
})
