import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_FOOTNOTE_SETTINGS,
  paragraphFootnotes,
  ViewerDocument,
  ViewerFootnoteSettings,
  ViewerNote,
  ViewerObjectPlaceholder,
  ViewerParagraph,
  ViewerSection,
  ViewerText
} from '../../src/core/document/viewer_document'
import { formatNoteNumber } from '../../src/core/document/note_number'
import { listEditingAnchorContexts } from '../../src/core/editing/editing_capability'
import {
  footnoteAreaHeight,
  footnoteLineLength,
  footnoteLineThickness,
  sliceNoteParagraph,
  ViewerNoteMetrics,
  ViewerPageFootnote
} from '../../src/core/layout/footnote_layout'
import { LayoutMeasurements, paginateViewerSection, paginateViewerSectionsIncremental, ViewerPage } from '../../src/core/layout/pagination'
import { parseOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxReadablePackage } from '../../src/core/parser/package_reader'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { FootnoteAreaView } from '../../src/renderer/src/App'
import { displayOffsetToSource } from '../../src/renderer/src/footnote_measurement'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import { createLongFootnoteHwpx, LONG_FOOTNOTE_TEXTS } from '../fixtures/public/create_synthetic_hwpx'

const SECTION = 'Contents/section0.xml'
const PAGE_HEIGHT = 10000
const settings = DEFAULT_FOOTNOTE_SETTINGS
// 기본 각주 모양의 영역 고정 높이: 본문과 구분선 사이(850) + 구분선 0.12mm(34) + 구분선 아래(567).
const OVERHEAD = 850 + 34 + 567

const text = (value: string, anchor?: string): ViewerText => ({
  type: 'text',
  text: value,
  charStyleId: '0',
  ...(anchor ? { sourceAnchor: { sectionPath: SECTION, textNodeId: `${SECTION}#hp:t:${anchor}` } } : {})
})

function noteParagraph(id: string, content: ViewerText[], layoutHeight = 1000): ViewerParagraph {
  return { id, paraStyleId: '0', pageBreak: false, layoutHeight, content }
}

function note(index: number, paragraphs: ViewerParagraph[] = [noteParagraph(`n${index}:p0`, [text(`각주 ${index}`, `n${index}`)])]): ViewerNote {
  return { kind: 'footnote', marker: `${index})`, sourcePath: `${SECTION}#hp:footNote:${index}`, paragraphs }
}

function marker(item: ViewerNote): ViewerObjectPlaceholder {
  return { type: 'object-placeholder', kind: 'footnote', element: 'hp:footNote', sourcePath: item.sourcePath, flow: 'marker', label: '각주', marker: item.marker, note: item }
}

function block(id: string, notes: ViewerNote[] = [], layoutHeight = 2000): ViewerParagraph {
  return { id, paraStyleId: '0', pageBreak: false, layoutHeight, content: [text(`본문 ${id}`, id), ...notes.map(marker)] }
}

function section(blocks: ViewerParagraph[], footnoteSettings?: ViewerFootnoteSettings, extra: Partial<ViewerSection> = {}): ViewerSection {
  return { id: 'section-0', blocks, headers: [], footers: [], ...(footnoteSettings ? { footnoteSettings } : {}), ...extra }
}

/** 각주 높이와 `step`마다의 줄 경계(문단 하나, 글자 run 하나의 `step`글자마다)를 측정값처럼 만든다. */
function lineMetrics(item: ViewerNote, lines: number, lineHeight = 1000, charactersPerLine = 10): ViewerNoteMetrics {
  return {
    height: lines * lineHeight,
    paragraphTops: [0],
    breaks: Array.from({ length: lines - 1 }, (_, index) => ({
      y: (index + 1) * lineHeight,
      paragraph: 0,
      position: { content: 0, offset: (index + 1) * charactersPerLine }
    }))
  }
}

function measured(blocks: ViewerParagraph[], noteMetrics: Record<string, ViewerNoteMetrics> = {}): LayoutMeasurements {
  return { blockHeights: Object.fromEntries(blocks.map((item) => [item.id, item.layoutHeight])), tableRowHeights: {}, noteMetrics }
}

const pageOf = (pages: ViewerPage[], blockId: string) => pages.findIndex((page) => page.blocks.some((item) => item.id === blockId))
const notesOn = (page: ViewerPage): ViewerPageFootnote[] => page.footnotes?.flat() ?? []
const pieceText = (footnote: ViewerPageFootnote) =>
  footnote.pieces.map((piece) => piece.paragraph.content.map((item) => item.type === 'text' ? item.text : '').join('')).join('|')

describe('쪽 아래 각주 배치', () => {
  test('번호 표시가 놓인 쪽 아래에 각주를 두고 본문은 각주 영역만큼 줄어든다', () => {
    const first = note(1)
    const blocks = [block('b0'), block('b1'), block('b2', [first]), block('b3')]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks, { [first.sourcePath]: lineMetrics(first, 1) }))
    // b0~b2(6000) + 각주 영역(1451 + 1000) = 8451. b3(2000)를 더하면 10451로 넘쳐 다음 쪽에 간다.
    expect(pages.map((page) => page.blocks.map((item) => item.id))).toEqual([['b0', 'b1', 'b2'], ['b3']])
    expect(notesOn(pages[0]).map((footnote) => [footnote.note, footnote.marker, footnote.height, footnote.continued, footnote.continues])).toEqual([[first, '1)', 1000, false, false]])
    expect(pages[1].footnotes).toBeUndefined()
    expect(footnoteAreaHeight(settings, 1, 1000)).toBe(OVERHEAD + 1000)
  })

  test('각주가 들어가지 않는 쪽 끝의 번호 표시 문단은 각주와 함께 다음 쪽으로 넘어간다', () => {
    const last = note(1)
    const blocks = [block('b0'), block('b1'), block('b2'), block('b3', [last])]
    const withNote = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks, { [last.sourcePath]: lineMetrics(last, 1) }))
    expect(pageOf(withNote, 'b3')).toBe(1)
    expect(notesOn(withNote[1]).map((footnote) => footnote.note)).toEqual([last])
    expect(withNote[0].footnotes).toBeUndefined()
    // 각주가 없으면 같은 문단이 첫 쪽에 들어간다(8000 ≤ 10000).
    const plain = [block('b0'), block('b1'), block('b2'), block('b3')]
    expect(pageOf(paginateViewerSection(section(plain), 0, PAGE_HEIGHT, measured(plain)), 'b3')).toBe(0)
  })

  test('한 쪽보다 긴 각주는 줄 경계에서 나눠 다음 쪽 아래에 이어 놓고, 뒤 본문은 이어진 각주 다음 쪽으로 간다', () => {
    const content = '가'.repeat(150)
    const long = note(1, [noteParagraph('n1:p0', [text(content, 'n1')])])
    const blocks = [block('b0'), block('b1', [long]), block('b2')]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks, { [long.sourcePath]: lineMetrics(long, 15) }))
    // 1쪽: b0·b1(4000) + 영역 고정 1451 → 각주 4줄(4000). 2쪽: 각주 8줄(8000). 3쪽: 각주 3줄 + b2.
    expect(pages.map((page) => page.blocks.map((item) => item.id))).toEqual([['b0', 'b1'], [], ['b2']])
    const fragments = pages.map((page) => notesOn(page))
    expect(fragments.map((items) => items.map((footnote) => [footnote.height, footnote.continued, footnote.continues]))).toEqual([
      [[4000, false, true]],
      [[8000, true, true]],
      [[3000, true, false]]
    ])
    // 조각 글자를 이으면 원문 그대로이고, 줄 경계(10글자)에서만 나뉜다.
    expect(fragments.flat().map(pieceText)).toEqual([content.slice(0, 40), content.slice(40, 120), content.slice(120)])
    // 앞 조각은 원본 문단(편집용)과 잘라 그릴 높이를, 이어지는 조각은 편집 anchor 없는 글자만 가진다.
    const [head, middle, tail] = fragments.flat().map((footnote) => footnote.pieces[0])
    expect(head).toMatchObject({ part: 'head', clipHeight: 4000, source: long.paragraphs[0] })
    expect(head.paragraph.content).toEqual([{ type: 'text', text: content.slice(0, 40), charStyleId: '0' }])
    expect([middle.part, tail.part]).toEqual(['rest', 'rest'])
    expect([middle, tail].flatMap((piece) => piece.paragraph.content).every((item) => item.type === 'text' && !item.sourceAnchor)).toBe(true)
    // 각 쪽의 본문과 각주 영역 높이는 쪽 본문 높이를 넘지 않는다.
    pages.forEach((page) => {
      const items = notesOn(page)
      const used = page.blocks.reduce((sum, item) => sum + item.layoutHeight, 0) + footnoteAreaHeight(settings, items.length, items.reduce((sum, footnote) => sum + footnote.height, 0))
      expect(used).toBeLessThanOrEqual(PAGE_HEIGHT)
    })
  })

  test('각주 첫 줄도 들어가지 않으면 번호 표시 문단을 다음 쪽으로 넘기고 그 쪽에서 나눈다', () => {
    const long = note(1, [noteParagraph('n1:p0', [text('나'.repeat(150), 'n1')])])
    const blocks = [block('b0', [], 7000), block('b1', [long])]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks, { [long.sourcePath]: lineMetrics(long, 15) }))
    // 7000 + 2000 + 1451 + 1000 > 10000이므로 b1은 2쪽에서 시작한다.
    expect(pageOf(pages, 'b1')).toBe(1)
    expect(notesOn(pages[1])[0]).toMatchObject({ continued: false, continues: true, height: 6000 })
    expect(pages.flatMap(notesOn).slice(1).every((footnote) => footnote.continued)).toBe(true)
    expect(pages.flatMap(notesOn).at(-1)).toMatchObject({ continued: true, continues: false })
  })

  test('여러 각주는 번호 표시 순서대로 놓이고 각주 사이 간격을 센다', () => {
    const [first, second, third] = [note(1), note(2), note(3)]
    const blocks = [block('b0', [first, second], 1000), block('b1', [third], 1000)]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks))
    expect(pages).toHaveLength(1)
    expect(notesOn(pages[0]).map((footnote) => footnote.marker)).toEqual(['1)', '2)', '3)'])
    expect(footnoteAreaHeight(settings, 3, 3000)).toBe(OVERHEAD + 3000 + 2 * 283)
  })

  test('측정 전에는 각주 문단 경계에서만 나누고 나눈 문단은 온전한 편집 문단으로 한 번씩만 나온다', () => {
    const paragraphs = [0, 1, 2].map((index) => noteParagraph(`n1:p${index}`, [text(`문단 ${index}`, `n1p${index}`)], 4000))
    const long = note(1, paragraphs)
    const pages = paginateViewerSection(section([block('b0', [long])]), 0, PAGE_HEIGHT)
    const pieces = pages.flatMap(notesOn).flatMap((footnote) => footnote.pieces)
    expect(pieces.map((piece) => piece.part)).toEqual(['whole', 'whole', 'whole'])
    expect(pieces.map((piece) => piece.paragraph)).toEqual(paragraphs)
    expect(pages.flatMap(notesOn).map((footnote) => footnote.continued)).toEqual([false, true])
  })

  test('표 머리글 행처럼 같은 번호 표시가 되풀이돼도 각주 본문은 한 번만 놓는다', () => {
    const once = note(1)
    const blocks = [block('b0', [once]), block('b1', [once])]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks))
    expect(pages.flatMap(notesOn)).toHaveLength(1)
  })

  test('다단 구역은 각주를 번호 표시가 놓인 단 아래에 둔다', () => {
    const notes = [note(1), note(2)]
    const blocks = [block('b0', [notes[0]], 6000), block('b1', [], 3000), block('b2', [notes[1]], 3000)]
    const columnLayout = { type: 'NEWSPAPER', layout: 'LEFT', count: 2, sameSize: true, sameGap: 500, columns: [] }
    const pages = paginateViewerSection(section(blocks, undefined, { columnLayout }), 0, PAGE_HEIGHT, measured(blocks))
    expect(pages).toHaveLength(1)
    expect(pages[0].columns!.map((column) => column.map((item) => item.id))).toEqual([['b0'], ['b1', 'b2']])
    expect(pages[0].footnotes!.map((column) => column.map((footnote) => footnote.note))).toEqual([[notes[0]], [notes[1]]])
  })

  test('쪽마다 새로 매기는 번호(ON_PAGE)는 쪽 안 순서로 다시 매기고 본문 번호 표시도 바꾼다', () => {
    const onPage: ViewerFootnoteSettings = { ...settings, numbering: { type: 'ON_PAGE', newNum: 1 }, format: { ...settings.format, type: 'CIRCLED_DIGIT', suffixChar: '' } }
    const notes = [note(1), note(2), note(3)]
    const blocks = [block('b0', [notes[0]], 3000), block('b1', [notes[1]], 3000), block('b2', [notes[2]], 3000)]
    const pages = paginateViewerSection(section(blocks, onPage), 0, PAGE_HEIGHT, measured(blocks))
    expect(pages.map((page) => notesOn(page).map((footnote) => footnote.marker))).toEqual([['①', '②'], ['①']])
    const bodyMarkers = pages.map((page) => page.blocks.flatMap((item) => item.content)
      .filter((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder').map((item) => item.marker))
    expect(bodyMarkers).toEqual([['①', '②'], ['①']])
    // 원본 section의 번호 표시는 바꾸지 않는다.
    expect((blocks[2].content[1] as ViewerObjectPlaceholder).marker).toBe('3)')
  })

  test('각주가 든 section도 바뀌지 않으면 앞 pagination 결과를 그대로 쓴다', () => {
    const blocks = [block('b0', [note(1)]), block('b1')]
    const document = { page: { width: 10000, height: PAGE_HEIGHT, margin: { top: 0, right: 0, bottom: 0, left: 0 }, headerOffset: 0, footerOffset: 0 }, sections: [section(blocks)] }
    const measurements = measured(blocks)
    const first = paginateViewerSectionsIncremental(document, () => measurements)
    const second = paginateViewerSectionsIncremental(document, () => measurements, first.sections)
    expect(second.reused).toBe(1)
    expect(second.pages[0]).toBe(first.pages[0])
  })
})

describe('각주 조각과 영역 그리기', () => {
  test('문단 조각은 글자 run을 offset에서 자르고 편집 anchor·글머리 표시를 앞 조각에만 맞춰 둔다', () => {
    const paragraph: ViewerParagraph = { ...noteParagraph('p', [text('가나다', 'a'), text('라마', 'b')]), marker: '•' }
    const head = sliceNoteParagraph(paragraph, undefined, { content: 1, offset: 1 })
    const tail = sliceNoteParagraph(paragraph, { content: 1, offset: 1 })
    expect(head.content).toEqual([{ type: 'text', text: '가나다', charStyleId: '0' }, { type: 'text', text: '라', charStyleId: '0' }])
    expect(head.marker).toBe('•')
    expect(tail.content).toEqual([{ type: 'text', text: '마', charStyleId: '0' }])
    expect(tail.marker).toBeUndefined()
    expect(head.id).not.toBe(tail.id)
  })

  test('측정한 화면 글자 offset은 한컴 PUA 대체 글자를 원문 offset으로 되돌린다', () => {
    expect(displayOffsetToSource('가나다', 2)).toBe(2)
    // U+F012B는 화면에서 '(인)' 세 글자로 그린다. 원문에서는 surrogate pair 두 code unit이다.
    const text = `가\u{F012B}나`
    expect(displayOffsetToSource(text, 1)).toBe(1)
    expect(displayOffsetToSource(text, 2)).toBe(1)
    expect(displayOffsetToSource(text, 4)).toBe(3)
    expect(displayOffsetToSource(text, 5)).toBe(4)
  })

  test('구분선 길이·굵기와 각주 번호 모양', () => {
    expect(footnoteLineLength(settings, 30000)).toBe(10000)
    expect(footnoteLineLength({ ...settings, line: { ...settings.line, length: 5000 } }, 30000)).toBe(5000)
    expect(footnoteLineLength({ ...settings, line: { ...settings.line, length: 50000 } }, 30000)).toBe(30000)
    expect(footnoteLineThickness({ ...settings, line: { ...settings.line, type: 'NONE' } })).toBe(0)
    expect(footnoteLineThickness(settings)).toBe(34)
    expect(['DIGIT', 'CIRCLED_DIGIT', 'ROMAN_SMALL', 'LATIN_CAPITAL', 'HANGUL_SYLLABLE'].map((type) => formatNoteNumber(type, 4))).toEqual(['4', '④', 'iv', 'D', '라'])
  })

  test('각주 영역은 구분선 모양을 그리고, 나눈 각주는 편집 입력 칸이 앞 조각 하나에만 있다', () => {
    const content = '다'.repeat(150)
    const long = note(1, [noteParagraph('n1:p0', [text(content, 'n1')])])
    const blocks = [block('b0', [long])]
    const pages = paginateViewerSection(section(blocks), 0, PAGE_HEIGHT, measured(blocks, { [long.sourcePath]: lineMetrics(long, 15) }))
    const document = { page: { width: 10000, height: PAGE_HEIGHT, margin: { top: 0, right: 0, bottom: 0, left: 0 }, headerOffset: 0, footerOffset: 0 }, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {} } as unknown as ViewerDocument
    const dashed = { ...settings, line: { ...settings.line, type: 'DASH', color: '#FF0000' }, format: { ...settings.format, superscript: true } }
    const noop = () => undefined
    const editing = {
      pending: false, onCommit: noop, onComposingChange: noop, onSelectionChange: noop, onEditorSelectionChange: noop, onRangeCommit: noop,
      onSplitParagraph: noop, onMergeParagraph: noop, onParagraphStructureUnavailable: noop, onTableCellSelectionChange: noop
    }
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const views = pages.map((page) => renderToStaticMarkup(createElement(FootnoteAreaView, { footnotes: page.footnotes![0], settings: dashed, columnWidth: 9000, document })))
      // 기본 구분선 길이(-1)는 단 너비의 1/3: 9000 / 3 = 3000 HWPUNIT = 40px.
      expect(views[0]).toContain('width:40px')
      expect(views[0]).toContain('dashed #FF0000')
      expect(views[0]).toContain('class="viewer-note-number viewer-note-number-sup">1)</span>')
      // 이어지는 조각은 번호 칸 폭을 남기되 보이지 않게 한다.
      expect(views[1]).toContain('style="visibility:hidden" aria-hidden="true">1)</span>')
      expect(views.join('')).not.toContain('viewer-editable-text')
      const edited = pages.map((page) => renderToStaticMarkup(createElement(FootnoteAreaView, { footnotes: page.footnotes![0], settings, columnWidth: 9000, document, editing: editing as any })))
      const surfaces = edited.map((markup) => markup.split('aria-label="HWPX 각주·미주 편집"').length - 1)
      expect(surfaces).toEqual([1, 0, 0])
      // 앞 조각은 원본 문단 전체(원본 hp:t 입력 칸)를 앞 조각 높이(4000 HWPUNIT = 80px)로 잘라 그린다.
      expect(edited[0]).toContain('class="viewer-footnote-clip" style="height:80px"')
      expect(edited[0]).toContain(`data-source-text-node-id="${SECTION}#hp:t:n1"`)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('각주 모양 decoder', () => {
  const NS = 'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"'
  const HEADER = '<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:refList>' +
    '<hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000"/></hh:charProperties>' +
    '<hh:paraProperties><hh:paraPr id="0"><hh:align horizontal="LEFT"/></hh:paraPr></hh:paraProperties></hh:refList></hh:head>'
  const footNotePr = (numbering: string) => '<hp:footNotePr><hp:autoNumFormat type="ROMAN_SMALL" userChar="" prefixChar="[" suffixChar="]" supscript="1"/>' +
    '<hp:noteLine length="14000" type="DASH" width="0.4 mm" color="#0000FF"/><hp:noteSpacing betweenNotes="100" belowLine="200" aboveLine="300"/>' +
    `<hp:numbering type="${numbering}" newNum="3"/><hp:placement place="EACH_COLUMN" beneathText="1"/></hp:footNotePr>`
  const footnote = (number: number) => `<hp:ctrl><hp:footNote number="${number}"><hp:subList><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">` +
    `<hp:ctrl><hp:autoNum num="${number}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" suffixChar=")"/></hp:autoNum></hp:ctrl><hp:t>각주 ${number}</hp:t></hp:run></hp:p></hp:subList></hp:footNote></hp:ctrl>`
  const packageOf = (numbering: string): HwpxReadablePackage => {
    const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${NS}><hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:secPr>` +
      '<hp:pagePr width="10000" height="10000"><hp:margin left="1000" right="1000" top="1000" bottom="1000" header="0" footer="0"/></hp:pagePr>' +
      `${footNotePr(numbering)}</hp:secPr></hp:run></hp:p>` +
      `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>본문</hp:t>${footnote(7)}${footnote(8)}<hp:t/></hp:run></hp:p></hs:sec>`
    return {
      index: async () => ({ mimetype: 'application/hwp+zip', headerPath: 'Contents/header.xml', sectionPaths: [SECTION], sectionSizes: {}, resourcePaths: [] }),
      readOrderedXml: async (path) => parseOrderedXml(path === SECTION ? section : HEADER),
      readBuffer: async () => Buffer.alloc(0)
    }
  }

  test('구역 정의의 hp:footNotePr를 읽고, 이어 매기는 번호는 원본 번호를 쓴다', async () => {
    const document = await decodeViewerDocument(packageOf('CONTINUOUS'))
    expect(document.sections[0].footnoteSettings).toEqual({
      format: { type: 'ROMAN_SMALL', userChar: '', prefixChar: '[', suffixChar: ']', superscript: true },
      line: { type: 'DASH', length: 14000, widthMm: 0.4, color: '#0000FF' },
      spacing: { betweenNotes: 100, belowLine: 200, aboveLine: 300 },
      numbering: { type: 'CONTINUOUS', newNum: 3 },
      placement: { place: 'EACH_COLUMN', beneathText: true }
    })
    expect(document.sections[0].blocks.flatMap(paragraphFootnotes).map((item) => item.marker)).toEqual(['7)', '8)'])
    // 각주 본문 글자는 NOTE_TEXT로 편집할 수 있다.
    expect(listEditingAnchorContexts(document).filter((context) => context.structure === 'NOTE_TEXT').map((context) => context.text)).toEqual(['각주 7', '각주 8'])
  })

  test('구역마다 새로 매기는 번호(ON_SECTION)는 시작 번호부터 구역 각주 모양으로 센다', async () => {
    const document = await decodeViewerDocument(packageOf('ON_SECTION'))
    expect(document.sections[0].blocks.flatMap(paragraphFootnotes).map((item) => item.marker)).toEqual(['[iii]', '[iv]'])
    const markers = document.sections[0].blocks[1].content.filter((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder')
    expect(markers.map((item) => item.marker)).toEqual(['[iii]', '[iv]'])
  })
})

describe('긴 각주 합성 문서', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-long-footnote-'))
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('긴 각주는 문단 경계에서 나뉘어 이어지고 모든 각주가 번호 표시가 놓인 쪽에서 시작한다', async () => {
    const document = await decodeViewerDocument(await HwpxSourcePackage.open(createLongFootnoteHwpx(directory)))
    const notes = document.sections[0].blocks.flatMap(paragraphFootnotes)
    expect(notes.map((item) => item.marker)).toEqual(['1)', '2)', '3)', '4)', '5)'])
    expect(notes[0].paragraphs.map((paragraph) => paragraph.content.find((item) => item.type === 'text'))).toMatchObject([
      { text: expect.stringContaining(LONG_FOOTNOTE_TEXTS.longSentence(0)) },
      { text: LONG_FOOTNOTE_TEXTS.longTail }
    ])
    // 화면 측정처럼 긴 첫 문단을 쪽보다 길게(줄 100개) 준다.
    const metrics = {
      height: 100 * 1000 + 1000,
      paragraphTops: [0, 100 * 1000],
      breaks: [
        ...Array.from({ length: 99 }, (_, index) => ({ y: (index + 1) * 1000, paragraph: 0, position: { content: 0, offset: (index + 1) * 40 } })),
        { y: 100 * 1000, paragraph: 1 }
      ]
    }
    const pages = paginateViewerDocument(document, { blockHeights: {}, tableRowHeights: {}, noteMetrics: { [notes[0].sourcePath]: metrics } })
    const firstPages = new Map<string, number>()
    pages.forEach((page, index) => notesOn(page).forEach((footnote) => {
      if (!footnote.continued) firstPages.set(footnote.note.sourcePath, index)
    }))
    pages.forEach((page, index) => page.blocks.flatMap(paragraphFootnotes).forEach((item) => expect(firstPages.get(item.sourcePath)).toBe(index)))
    expect(pages.flatMap(notesOn).filter((footnote) => footnote.note === notes[0]).map((footnote) => footnote.pieces.map((piece) => piece.part))).toEqual([
      ['head'], ['rest', 'whole']
    ])
  })
})
