import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewerDocument, ViewerParagraph, ViewerText } from '../../src/core/document/viewer_document'
import {
  editingCapabilities,
  listEditingAnchorContexts,
  topLevelParagraphStructure
} from '../../src/core/editing/editing_capability'
import { planMergeParagraph, planSplitParagraph } from '../../src/core/editing/paragraph_patch'
import { applyReplaceTextCommand } from '../../src/core/editing/text_patch'
import { EditorSelection } from '../../src/core/editing/transaction'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { ParagraphView } from '../../src/renderer/src/App'
import { editingCapabilityStatus } from '../../src/renderer/src/editing_error_status'
import {
  createInlineObjectHwpx,
  createListMarkerHwpx,
  createReportTocHwpx,
  createRoundTripHwpx,
  createTableColumnHwpx,
  INLINE_OBJECT_TEXTS
} from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'
const externalDirectory = join(__dirname, '../fixtures/public/external')
const noop = () => undefined

const caret = (textNodeId: string, offset = 0): EditorSelection => ({
  sectionPath,
  anchorTextNodeId: textNodeId,
  anchorOffset: offset,
  focusTextNodeId: textNodeId,
  focusOffset: offset
})

function allParagraphs(document: ViewerDocument): ViewerParagraph[] {
  const visit = (paragraph: ViewerParagraph): ViewerParagraph[] => [
    paragraph,
    ...paragraph.content.flatMap((item) => item.type === 'table'
      ? item.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs.flatMap(visit)))
      : [])
  ]
  return document.sections.flatMap((section) => section.blocks.flatMap(visit))
}

function paragraphWith(document: ViewerDocument, text: string): ViewerParagraph {
  const found = allParagraphs(document).find((paragraph) =>
    paragraph.content.some((item) => item.type === 'text' && item.text === text))
  if (!found) throw new Error(`문단을 찾을 수 없습니다: ${text}`)
  return found
}

function anchorOf(paragraph: ViewerParagraph, text: string): string {
  const item = paragraph.content.find((candidate): candidate is ViewerText => candidate.type === 'text' && candidate.text === text)
  if (!item?.sourceAnchor) throw new Error(`anchor가 없습니다: ${text}`)
  return item.sourceAnchor.textNodeId
}

const attempt = (action: () => unknown): string | undefined => {
  try {
    action()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('개체가 든 문단의 문단 구조 capability', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-inline-object-'))
  const fixture = createInlineObjectHwpx(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('글자 입력은 열리고 Enter·병합·여러 문단 범위는 PARAGRAPH_HAS_OBJECT로 막힌다', async () => {
    const source = await HwpxSourcePackage.open(fixture)
    const document = await decodeViewerDocument(source)
    const equation = paragraphWith(document, INLINE_OBJECT_TEXTS.equationLead)
    const textBox = paragraphWith(document, INLINE_OBJECT_TEXTS.textBoxLead)
    const cellEquation = paragraphWith(document, INLINE_OBJECT_TEXTS.cellEquationLead)
    for (const paragraph of [equation, textBox, cellEquation]) {
      expect(paragraph.structureBlock).toBe('PARAGRAPH_HAS_OBJECT')
      expect(paragraph.content.some((item) => item.type === 'object-placeholder')).toBe(true)
    }
    expect(paragraphWith(document, INLINE_OBJECT_TEXTS.middle).structureBlock).toBeUndefined()

    for (const [paragraph, text] of [
      [equation, INLINE_OBJECT_TEXTS.equationLead],
      [equation, INLINE_OBJECT_TEXTS.equationTail],
      [textBox, INLINE_OBJECT_TEXTS.textBoxLead],
      [cellEquation, INLINE_OBJECT_TEXTS.cellEquationLead]
    ] as const) {
      const id = anchorOf(paragraph, text)
      const capabilities = editingCapabilities(document, caret(id, 1))
      expect(capabilities.text.available).toBe(true)
      expect(capabilities.characterStyle.available).toBe(true)
      expect(capabilities.paragraphStyle.available).toBe(true)
      expect(capabilities.paragraphStructure).toEqual({ available: false, reason: 'PARAGRAPH_HAS_OBJECT' })
      // capability가 막은 문단은 편집 코어도 거부한다(UI가 Enter를 열어 두고 코어 오류를 받는 경로가 없다).
      expect(attempt(() => planSplitParagraph(source, caret(id, 1)))).toBe('복합 run이 있는 문단은 아직 나눌 수 없습니다.')

      const typed = applyReplaceTextCommand(source, {
        type: 'replace-text', revision: source.revision, sectionPath, textNodeId: id, from: 0, to: 0, insert: '입력'
      })
      const reread = await decodeViewerDocument(typed.package)
      expect(allParagraphs(reread).flatMap((item) => item.content)).toContainEqual(
        expect.objectContaining({ type: 'text', text: `입력${text}` })
      )
    }

    // 개체 문단 양옆 일반 문단은 Enter는 되지만 그 문단 쪽 경계 병합은 막힌다.
    const structure = topLevelParagraphStructure(document)
    const before = paragraphWith(document, INLINE_OBJECT_TEXTS.before)
    const middle = paragraphWith(document, INLINE_OBJECT_TEXTS.middle)
    expect(structure.get(before.id)?.gate).toEqual({ mergeNext: 'PARAGRAPH_HAS_OBJECT', mergePrevious: 'PARAGRAPH_HAS_OBJECT' })
    expect(structure.get(middle.id)?.gate).toEqual({ mergePrevious: 'PARAGRAPH_HAS_OBJECT', mergeNext: 'PARAGRAPH_HAS_OBJECT' })
    expect(editingCapabilities(document, caret(anchorOf(middle, INLINE_OBJECT_TEXTS.middle))).paragraphStructure.available).toBe(true)
    const middleId = anchorOf(middle, INLINE_OBJECT_TEXTS.middle)
    expect(attempt(() => planSplitParagraph(source, caret(middleId, 2)))).toBeUndefined()
    expect(attempt(() => planMergeParagraph(source, caret(middleId, 0), 'previous'))).toBe('복합 run이 있는 문단은 아직 나눌 수 없습니다.')
    const cellPlain = paragraphWith(document, INLINE_OBJECT_TEXTS.cellPlain)
    const cellContext = listEditingAnchorContexts(document).find((context) => context.paragraphId === cellPlain.id)!
    expect(cellContext.structureGate).toEqual({ mergePrevious: 'PARAGRAPH_HAS_OBJECT' })

    // 개체 문단을 사이에 둔 여러 문단 범위는 같은 범위 scope가 아니어서 열리지 않는다.
    const range: EditorSelection = {
      sectionPath,
      anchorTextNodeId: anchorOf(before, INLINE_OBJECT_TEXTS.before),
      anchorOffset: 1,
      focusTextNodeId: middleId,
      focusOffset: 1
    }
    expect(editingCapabilities(document, range).text).toEqual({ available: false, reason: 'CROSS_STRUCTURE_SELECTION' })
    expect(editingCapabilityStatus('문단 나눔·병합', 'PARAGRAPH_HAS_OBJECT')).toContain('개체')
  })

  test('renderer 본문 문단도 capability와 같은 문단 구조 gate와 범위 scope를 쓴다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(fixture))
    const structure = topLevelParagraphStructure(document)
    const consoleError = jest.spyOn(console, 'error').mockImplementation((message: unknown, ...rest: unknown[]) => {
      if (String(message).includes('useLayoutEffect does nothing on the server')) return
      throw new Error([message, ...rest].map(String).join(' '))
    })
    const render = (paragraph: ViewerParagraph) => renderToStaticMarkup(createElement(ParagraphView as any, {
      paragraph,
      document,
      editing: {
        pending: false,
        allowMultipleRuns: true,
        allowParagraphRange: true,
        allowParagraphStructure: true,
        structureOf: (id: string) => structure.get(id),
        onCommit: noop,
        onComposingChange: noop,
        onSelectionChange: noop,
        onEditorSelectionChange: noop,
        onRangeCommit: noop,
        onSplitParagraph: noop,
        onMergeParagraph: noop,
        onParagraphStructureUnavailable: noop,
        onTableCellSelectionChange: noop
      }
    }))
    try {
      const equation = paragraphWith(document, INLINE_OBJECT_TEXTS.equationLead)
      const markup = render(equation)
      expect(markup).toContain('data-paragraph-structure-block="PARAGRAPH_HAS_OBJECT"')
      expect(markup).toContain(`data-editor-range-scope="${sectionPath}:paragraph:${equation.id}"`)
      // 글자 입력 surface는 그대로 둔다(수식 앞·뒤 글자 칸 2개).
      expect(markup.match(/class="viewer-editable-text"/g)).toHaveLength(2)
      const middle = paragraphWith(document, INLINE_OBJECT_TEXTS.middle)
      const middleMarkup = render(middle)
      expect(middleMarkup).not.toContain('data-paragraph-structure-block')
      const contexts = listEditingAnchorContexts(document)
      expect(middleMarkup).toContain(`data-editor-range-scope="${contexts.find((context) => context.paragraphId === middle.id)!.rangeScope}"`)
    } finally {
      consoleError.mockRestore()
    }
  })

  test('공개 corpus 전체에서 Enter capability와 편집 코어의 수락·거부가 같다', async () => {
    const paths = [
      fixture,
      createRoundTripHwpx(directory),
      createListMarkerHwpx(directory),
      createTableColumnHwpx(directory),
      createReportTocHwpx(directory),
      ...readdirSync(externalDirectory).filter((name) => name.endsWith('.hwpx')).map((name) => join(externalDirectory, name))
    ]
    let checked = 0
    let blocked = 0
    for (const path of paths) {
      const source = await HwpxSourcePackage.open(path)
      const document = await decodeViewerDocument(source)
      const contexts = listEditingAnchorContexts(document).filter((context) => context.sectionPath === sectionPath)
      for (const context of contexts) {
        const capability = editingCapabilities(document, caret(context.textNodeId))
        if (capability.paragraphStructure.reason === 'EMPTY_PARAGRAPH' || capability.paragraphStructure.reason === 'TABLE_CELL_STRUCTURE') continue
        const core = attempt(() => planSplitParagraph(source, caret(context.textNodeId)))
        checked += 1
        if (!capability.paragraphStructure.available) blocked += 1
        expect({ path, id: context.textNodeId, available: capability.paragraphStructure.available, core: core === undefined })
          .toEqual({ path, id: context.textNodeId, available: core === undefined, core: core === undefined })
        // 경계 병합: capability가 연 방향은 코어도 받아야 한다(인접 문단이 없는 끝 문단은 코어가 적용 없음으로 끝낸다).
        if (!capability.paragraphStructure.available) continue
        const paragraphStart = contexts.find((candidate) => candidate.paragraphId === context.paragraphId)
        if (!context.structureGate?.mergePrevious && paragraphStart?.textNodeId === context.textNodeId) {
          const merged = attempt(() => planMergeParagraph(source, caret(context.textNodeId), 'previous'))
          if (merged !== undefined) expect([path, context.textNodeId, merged]).toEqual([path, context.textNodeId, '병합할 인접 문단이 없습니다.'])
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    expect(blocked).toBeGreaterThan(0)
  })
})
