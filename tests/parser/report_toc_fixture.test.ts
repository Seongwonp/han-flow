import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ViewerParagraph, ViewerTable, ViewerText } from '../../src/core/document/viewer_document'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { parseOrderedXml, walkOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { paginateViewerDocument } from '../../src/core/layout/pagination'
import {
  createReportTocHwpx,
  REPORT_TOC_NUMERIC_TEXTS,
  REPORT_TOC_PUA_MARKER
} from '../fixtures/public/create_synthetic_hwpx'

const paragraphText = (paragraph: ViewerParagraph): string => paragraph.content
  .filter((item): item is ViewerText => item.type === 'text')
  .map((item) => item.text)
  .join('')

describe('목차·표지 보고서 서식 회귀', () => {
  let directory: string
  let fixture: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'han-flow-report-toc-'))
    fixture = createReportTocHwpx(directory)
  })

  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('XML parser는 숫자처럼 보이는 본문 text를 바꾸지 않는다', () => {
    const texts = REPORT_TOC_NUMERIC_TEXTS.map((text) => `<hp:t>${text}</hp:t>`).join('')
    const nodes = walkOrderedXml(parseOrderedXml(`<hp:p xmlns:hp="urn:hp"><hp:run>${texts}</hp:run></hp:p>`))
    const parsed = nodes.filter((node) => node.name === 'hp:t').map((node) => node.children.map((child) => child.text).join(''))
    expect(parsed).toEqual([...REPORT_TOC_NUMERIC_TEXTS])
    // 속성 값도 문자열 그대로다.
    const [paragraph] = parseOrderedXml('<hp:p id="007" ratio="1.50"/>')
    expect(paragraph.attributes).toEqual({ id: '007', ratio: '1.50' })
  })

  test('목차 표의 번호 `1.`과 숫자만 든 문단, 사설 영역 글머리를 그대로 해석한다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const blocks = document.sections[0].blocks
    const tables = blocks.flatMap((paragraph) => paragraph.content.filter((item): item is ViewerTable => item.type === 'table'))
    expect(tables).toHaveLength(2)
    const toc = tables[1]
    expect(toc.rows.map((row) => paragraphText(row.cells[0].paragraphs[0]))).toEqual(['1.', '2.', '3.', '4.'])
    expect(toc.rows.map((row) => paragraphText(row.cells[2].paragraphs[0]))).toEqual(['1', '2', '3', '4'])
    const texts = blocks.map(paragraphText)
    for (const text of REPORT_TOC_NUMERIC_TEXTS.slice(4)) expect(texts).toContain(text)
    expect(texts.filter((text) => text.includes(REPORT_TOC_PUA_MARKER))).toHaveLength(2)
    // 표지·목차·본문은 명시적 쪽 나눔으로 3페이지가 된다.
    expect(paginateViewerDocument(document)).toHaveLength(3)
  })

  test('viewer text와 편집 source anchor text가 같다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(fixture))
    const viewerTexts: string[] = []
    const visit = (paragraphs: ViewerParagraph[]): void => {
      for (const paragraph of paragraphs) {
        for (const item of paragraph.content) {
          if (item.type === 'text' && item.text) viewerTexts.push(item.text)
          if (item.type === 'table') item.rows.forEach((row) => row.cells.forEach((cell) => visit(cell.paragraphs)))
        }
      }
    }
    visit(document.sections[0].blocks)
    const source = await HwpxSourcePackage.open(fixture)
    const anchors = listHwpxTextAnchors(source, 'Contents/section0.xml').map((anchor) => anchor.text)
    expect(viewerTexts).toEqual(anchors.filter(Boolean))
    expect(anchors).toEqual(expect.arrayContaining(['1.', '007', '1e3', '0x10', ' 12 ']))
  })
})
