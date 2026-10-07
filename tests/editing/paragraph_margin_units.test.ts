import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  HWP_UNIT_CHAR_NAMESPACE,
  paragraphMetricUnit,
  preferredParagraphMetric
} from '../../src/core/document/paragraph_margin_units'
import { applyParagraphStyleCommand } from '../../src/core/editing/style_patch'
import { listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import { decodeViewerDocument } from '../../src/core/parser/viewer_decoder'
import { createRoundTripHwpx } from '../fixtures/public/create_synthetic_hwpx'

const sectionPath = 'Contents/section0.xml'
const headerPath = 'Contents/header.xml'
const UNKNOWN_NAMESPACE = 'http://example.invalid/hwpml/unknown'

const margin = (left: number, intent = 0, prev = 0, next = 0): string =>
  `<hh:margin><hc:intent value="${intent}" unit="HWPUNIT"/><hc:left value="${left}" unit="HWPUNIT"/>` +
  `<hc:right value="0" unit="HWPUNIT"/><hc:prev value="${prev}" unit="HWPUNIT"/><hc:next value="${next}" unit="HWPUNIT"/></hh:margin>`
const hwpUnitCase = (body: string): string => `<hp:case hp:required-namespace="${HWP_UNIT_CHAR_NAMESPACE}">${body}</hp:case>`
const unknownCase = (body: string): string => `<hp:case hp:required-namespace="${UNKNOWN_NAMESPACE}">${body}</hp:case>`
const fallback = (body: string): string => `<hp:default>${body}</hp:default>`
const switched = (...branches: string[]): string => `<hp:switch>${branches.join('')}</hp:switch>`

interface Variant {
  name: string
  /** paraPr id="0"의 직접 `hh:margin` 자리에 넣을 XML. 실제 왼쪽 여백은 1000 HWPUNIT이다. */
  xml: string
  /** 문서 순서상 각 `hh:margin` representation의 저장 배율(실제 HWPUNIT 기준). 0은 단위를 몰라 건드리지 않는 node. */
  scales: number[]
}

const variants: Variant[] = [
  { name: '직접 margin만', xml: margin(2000), scales: [2] },
  { name: 'switch(case+default)', xml: switched(hwpUnitCase(margin(1000)), fallback(margin(2000))), scales: [1, 2] },
  {
    name: 'switch 두 개(목록 heading용 모르는 namespace case + 여백 switch)',
    xml: switched(unknownCase('<hh:heading type="OUTLINE" idRef="0" level="1"/>'), fallback('')) +
      switched(hwpUnitCase(margin(1000)), fallback(margin(2000))),
    scales: [1, 2]
  },
  {
    name: '모르는 namespace case가 먼저 오는 switch(case 두 개)',
    xml: switched(unknownCase('<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>'), hwpUnitCase(margin(1000)), fallback(margin(2000))),
    scales: [1, 2]
  },
  { name: '직접 margin과 switch가 함께 있는 paraPr', xml: margin(2000) + switched(hwpUnitCase(margin(1000)), fallback(margin(2000))), scales: [2, 1, 2] },
  {
    name: '중첩 switch',
    xml: switched(hwpUnitCase(switched(hwpUnitCase(margin(1000)), fallback(margin(1000)))), fallback(margin(2000))),
    scales: [1, 1, 2]
  }
]

describe('문단 여백 단위 판정(읽기·쓰기 공통)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-margin-units-'))
  const fixture = createRoundTripHwpx(directory)

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  async function sourceWithMargin(xml: string): Promise<HwpxSourcePackage> {
    const source = await HwpxSourcePackage.open(fixture)
    const header = source.readEntry(headerPath).toString('utf8')
      .replace('<hh:paraProperties>', '<hh:paraProperties itemCnt="4">')
      .replace(/(<hh:paraPr id="0">[\s\S]*?)<hh:margin>[\s\S]*?<\/hh:margin>/, `$1${xml}`)
    expect(header).toContain(xml)
    return source.withEntry(headerPath, Buffer.from(header))
  }

  const anchorOf = (source: HwpxSourcePackage) => {
    const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === '')
    if (!anchor) throw new Error('공개 fixture anchor가 없습니다.')
    return anchor
  }

  const definition = (source: HwpxSourcePackage, id: string): string =>
    source.readEntry(headerPath).toString('utf8').match(new RegExp(`<hh:paraPr id="${id}"[\\s\\S]*?</hh:paraPr>`))?.[0] ?? ''
  const values = (xml: string, name: string): number[] =>
    [...xml.matchAll(new RegExp(`<hc:${name} value="(-?\\d+)"`, 'g'))].map((match) => Number(match[1]))

  test('조상 경로만으로 단위를 정한다', () => {
    expect(paragraphMetricUnit([])).toBe('doubled')
    expect(paragraphMetricUnit([{ name: 'hp:switch' }, { name: 'hp:default' }])).toBe('doubled')
    expect(paragraphMetricUnit([{ name: 'hp:switch' }, { name: 'hp:case', requiredNamespace: HWP_UNIT_CHAR_NAMESPACE }])).toBe('hwpunit')
    expect(paragraphMetricUnit([{ name: 'hp:switch' }, { name: 'hp:case', requiredNamespace: UNKNOWN_NAMESPACE }])).toBe('unknown')
    expect(paragraphMetricUnit([{ name: 'hp:switch' }, { name: 'hp:case' }])).toBe('unknown')
    expect(paragraphMetricUnit([
      { name: 'hp:switch' }, { name: 'hp:case', requiredNamespace: HWP_UNIT_CHAR_NAMESPACE },
      { name: 'hp:switch' }, { name: 'hp:default' }
    ])).toBe('hwpunit')
    expect(preferredParagraphMetric([
      { node: 'direct', unit: 'doubled' }, { node: 'unknown', unit: 'unknown' }, { node: 'case', unit: 'hwpunit' }
    ])?.node).toBe('case')
    expect(preferredParagraphMetric([{ node: 'unknown', unit: 'unknown' }])).toBeUndefined()
  })

  test.each(variants)('$name: 읽기·편집·다시 읽기에서 모든 representation이 같은 실제 값을 가리킨다', async ({ xml, scales }) => {
    const source = await sourceWithMargin(xml)
    expect((await decodeViewerDocument(source)).paraStyles['0'].margin.left).toBe(1000)

    const result = applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style',
      sectionPath,
      textNodeId: anchorOf(source).textNodeId,
      indent: -300,
      marginBefore: 200,
      marginAfter: 100
    })
    expect(result.changed).toBe(true)
    const edited = definition(result.package, '4')
    expect(values(edited, 'intent')).toEqual(scales.map((scale) => -300 * scale))
    expect(values(edited, 'prev')).toEqual(scales.map((scale) => 200 * scale))
    expect(values(edited, 'next')).toEqual(scales.map((scale) => 100 * scale))
    expect(values(edited, 'left')).toEqual(scales.map((scale) => 1000 * scale))

    const reread = (await decodeViewerDocument(result.package)).paraStyles['4']
    expect(reread).toMatchObject({ indent: -300, margin: { left: 1000, top: 200, bottom: 100 } })
  })

  test('단위를 모르는 namespace case 안의 여백은 읽지 않고, 편집은 원본을 바꾸지 않고 거부한다', async () => {
    const source = await sourceWithMargin(switched(unknownCase(margin(7777)), hwpUnitCase(margin(1000)), fallback(margin(2000))))
    expect((await decodeViewerDocument(source)).paraStyles['0'].margin.left).toBe(1000)
    const before = source.readEntry(headerPath)
    expect(() => applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style', sectionPath, textNodeId: anchorOf(source).textNodeId, indent: -300
    })).toThrow('알 수 없는 형식의 문단 여백')
    expect(source.readEntry(headerPath)).toEqual(before)
  })

  test('줄 간격은 case·default·직접 representation을 모두 같은 PERCENT 값으로 맞춘다', async () => {
    const lineSpacing = (value: number) => `<hh:lineSpacing type="PERCENT" value="${value}" unit="HWPUNIT"/>`
    const source = await sourceWithMargin(switched(hwpUnitCase(margin(1000) + lineSpacing(130)), fallback(margin(2000) + lineSpacing(130))))
    const result = applyParagraphStyleCommand(source, {
      type: 'apply-paragraph-style', sectionPath, textNodeId: anchorOf(source).textNodeId, lineSpacing: 180
    })
    const edited = definition(result.package, '4')
    expect([...edited.matchAll(/<hh:lineSpacing[^>]*value="(\d+)"/g)].map((match) => Number(match[1]))).toEqual([180, 180, 180])
    expect((await decodeViewerDocument(result.package)).paraStyles['4'].lineSpacing).toBe(180)
  })

  test('공개 python-hwpx 문서: heading switch 뒤의 여백 switch도 읽는다', async () => {
    const source = await HwpxSourcePackage.open(join(__dirname, '../fixtures/public/external/ext-pyhwpx-paragraph-margins.hwpx'))
    const header = source.readEntry(headerPath).toString('utf8')
    const outline = header.match(/<hh:paraPr id="16"[\s\S]*?<\/hh:paraPr>/)?.[0] ?? ''
    // 첫 switch는 목록 heading(2016/paragraph namespace)이고 여백은 두 번째 switch에 있다.
    expect(outline.indexOf('2016/paragraph')).toBeLessThan(outline.indexOf('HwpUnitChar'))
    expect((await decodeViewerDocument(source)).paraStyles['16']).toMatchObject({ lineSpacing: 160, margin: { left: 9000 } })
  })
})
