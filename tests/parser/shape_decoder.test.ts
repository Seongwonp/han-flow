import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ViewerImage, ViewerObjectPlaceholder, ViewerParagraph } from '../../src/core/document/viewer_document'
import { parseOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxPackageReader } from '../../src/core/parser/package_reader'
import { childPlacement, curveCommands, decodeShapeStyle, fillOf, pictureCrop, pictureFilter, serializePath, strokeOf } from '../../src/core/parser/shape_decoder'
import { decodeViewerDocument, lineSpacingOf } from '../../src/core/parser/viewer_decoder'
import { createShapeHwpx, SHAPE_FIXTURE_EXPECTED, SHAPE_LINE_SPACINGS } from '../fixtures/public/create_synthetic_hwpx'

const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"'
const node = (xml: string) => {
  const root = parseOrderedXml(`<root ${NS}>${xml}</root>`)
  return root[0].children.find((item) => item.name !== '#text')!
}

/** path 자료의 점 좌표 상자(조절점 포함). */
function pathBox(path: string) {
  const numbers = path.replace(/[MLCQZ]/gu, ' ').trim().split(/\s+/u).filter(Boolean).map(Number)
  const xs = numbers.filter((_, index) => index % 2 === 0)
  const ys = numbers.filter((_, index) => index % 2 === 1)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

describe('도형 선·채우기', () => {
  test('선 모양·끝 모양·화살표·불투명도를 읽고 NONE은 선 없음이다', () => {
    expect(strokeOf(node('<hp:arc><hp:lineShape color="#112233" width="57" style="DASH_DOT" endCap="ROUND" headStyle="SPEAR" tailStyle="FILLED_CIRCLE" headSz="SMALL_LARGE" tailSz="LARGE_LARGE" tailfill="0" alpha="51"/></hp:arc>'))).toEqual({
      color: '#112233', width: 57, style: 'DASH_DOT', endCap: 'ROUND', headStyle: 'SPEAR', tailStyle: 'FILLED_CIRCLE', headSize: 'SMALL_LARGE', tailSize: 'LARGE_LARGE', tailFill: false, opacity: 0.8
    })
    expect(strokeOf(node('<hp:arc><hp:lineShape color="#112233" width="57" style="NONE"/></hp:arc>'))).toBeUndefined()
    expect(strokeOf(node('<hp:arc><hp:lineShape color="#112233" width="57" style="SOLID" headStyle="NORMAL"/></hp:arc>'))).toEqual({ color: '#112233', width: 57, style: 'SOLID' })
  })

  test('단색·무늬·그러데이션 채우기, 완전히 투명하면 없음', () => {
    expect(fillOf(node('<hp:rect><hc:fillBrush><hc:winBrush faceColor="#FF0000" hatchColor="#000000" alpha="0"/></hc:fillBrush></hp:rect>'))).toEqual({ kind: 'solid', color: '#FF0000' })
    expect(fillOf(node('<hp:rect><hc:fillBrush><hc:winBrush faceColor="#FF0000" alpha="255"/></hc:fillBrush></hp:rect>'))).toBeUndefined()
    expect(fillOf(node('<hp:rect><hc:fillBrush><hc:winBrush faceColor="none" hatchColor="#0000FF" hatchStyle="SLASH" alpha="0"/></hc:fillBrush></hp:rect>'))).toEqual({ kind: 'hatch', color: 'none', hatchColor: '#0000FF', hatchStyle: 'SLASH' })
    expect(fillOf(node('<hp:rect><hc:fillBrush><hc:gradation type="RADIAL" angle="0" centerX="20" centerY="80" alpha="0"><hc:color value="#FFFFFF"/><hc:color value="#000000"/><hc:color value="#FF0000"/></hc:gradation></hc:fillBrush></hp:rect>'))).toEqual({
      kind: 'gradient', type: 'RADIAL', angle: 0, centerX: 20, centerY: 80, colors: ['#FFFFFF', '#000000', '#FF0000']
    })
  })
})

describe('도형 모양', () => {
  test('호는 중심·두 축 끝점의 4분의 1 타원이고 부채꼴은 중심으로, 활꼴은 두 끝점으로 닫는다', () => {
    const arc = (type: string) => node(`<hp:arc type="${type}"><hp:orgSz width="4000" height="2000"/><hp:curSz width="8000" height="4000"/><hp:lineShape color="#000000" width="57" style="SOLID" tailStyle="ARROW"/><hc:center x="0" y="2000"/><hc:ax1 x="0" y="0"/><hc:ax2 x="4000" y="2000"/></hp:arc>`)
    const normal = decodeShapeStyle(arc('NORMAL'), { width: 8000, height: 4000 })!
    // 원래 크기 4000×2000 → 그리는 크기 8000×4000(2배).
    expect(normal.path).toBe('M0 0 C4418.3 0 8000 1790.9 8000 4000')
    expect(normal.closed).toBe(false)
    expect(normal.end).toEqual([{ x: 8000, y: 4000 }, { x: 8000, y: expect.closeTo(1791, 0) }])
    expect(decodeShapeStyle(arc('PIE'), { width: 8000, height: 4000 })!.path).toMatch(/L0 4000 Z$/u)
    expect(decodeShapeStyle(arc('CHORD'), { width: 8000, height: 4000 })!).toMatchObject({ closed: true, path: expect.stringMatching(/8000 4000 Z$/u) })
  })

  test('곡선 조각은 CURVE 셋이 3차 Bézier, 둘은 2차, LINE은 직선이다', () => {
    const curve = node('<hp:curve><hp:seg type="CURVE" x1="0" y1="100" x2="10" y2="0"/><hp:seg type="CURVE" x1="10" y1="0" x2="20" y2="0"/><hp:seg type="CURVE" x1="20" y1="0" x2="30" y2="100"/><hp:seg type="LINE" x1="30" y1="100" x2="40" y2="100"/><hp:seg type="CURVE" x1="40" y1="100" x2="50" y2="50"/><hp:seg type="CURVE" x1="50" y1="50" x2="60" y2="100"/></hp:curve>')
    expect(serializePath(curveCommands(curve))).toBe('M0 100 C10 0 20 0 30 100 L40 100 Q50 50 60 100')
  })

  test('닫힌 곡선은 면을 채우고 열린 곡선은 채우지 않는다', () => {
    const closed = node('<hp:curve><hp:orgSz width="100" height="100"/><hp:curSz width="100" height="100"/><hp:lineShape color="#000000" width="57" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#00FF00" alpha="0"/></hc:fillBrush><hp:seg type="LINE" x1="0" y1="0" x2="100" y2="0"/><hp:seg type="LINE" x1="100" y1="0" x2="0" y2="100"/><hp:seg type="LINE" x1="0" y1="100" x2="0" y2="0"/></hp:curve>')
    expect(decodeShapeStyle(closed, { width: 100, height: 100 })).toMatchObject({ closed: true, fillPaint: { kind: 'solid' } })
    const open = node('<hp:curve><hp:orgSz width="100" height="100"/><hp:curSz width="100" height="100"/><hp:lineShape color="#000000" width="57" style="SOLID"/><hc:fillBrush><hc:winBrush faceColor="#00FF00" alpha="0"/></hc:fillBrush><hp:seg type="LINE" x1="0" y1="0" x2="100" y2="0"/></hp:curve>')
    const openStyle = decodeShapeStyle(open, { width: 100, height: 100 })!
    expect(openStyle.closed).toBe(false)
    expect(openStyle.fillPaint).toBeUndefined()
  })

  test('연결선은 종류대로 화살표를 붙이고 꺾은선·곡선은 꺾인 점을 지난다', () => {
    const connector = (type: string) => node(`<hp:connectLine type="${type}"><hp:orgSz width="100" height="100"/><hp:curSz width="100" height="100"/><hp:lineShape color="#000000" width="57" style="SOLID" headStyle="NORMAL" tailStyle="NORMAL"/><hp:startPt x="0" y="0"/><hp:endPt x="100" y="100"/><hp:controlPoints><hp:point x="0" y="0" type="3"/><hp:point x="100" y="0" type="2"/><hp:point x="100" y="100" type="26"/></hp:controlPoints></hp:connectLine>`)
    expect(decodeShapeStyle(connector('STRAIGHT_BOTH'), undefined)).toMatchObject({ path: 'M0 0 L100 100', stroke: { headStyle: 'ARROW', tailStyle: 'ARROW' } })
    expect(decodeShapeStyle(connector('STROKE_ONEWAY'), undefined)).toMatchObject({ path: 'M0 0 L100 0 L100 100', stroke: { tailStyle: 'ARROW' } })
    expect(decodeShapeStyle(connector('STROKE_ONEWAY'), undefined)!.stroke!.headStyle).toBeUndefined()
    expect(decodeShapeStyle(connector('ARC_NOARROW'), undefined)!.path).toMatch(/^M0 0 C/u)
  })

  test('묶음 안 도형은 위치·크기·회전·대칭을 곱해 묶음 상자 좌표로 평탄하게 모은다', () => {
    const group = node(`<hp:container><hp:orgSz width="200" height="100"/><hp:curSz width="400" height="200"/>
      <hp:rect><hp:offset x="0" y="0"/><hp:orgSz width="100" height="50"/><hp:curSz width="100" height="50"/><hp:rotationInfo angle="90" centerX="50" centerY="25"/><hp:lineShape color="#000000" width="57" style="SOLID"/></hp:rect>
      <hp:container><hp:offset x="100" y="50"/><hp:orgSz width="100" height="50"/><hp:curSz width="100" height="50"/><hp:flip horizontal="1" vertical="0"/>
        <hp:line><hp:offset x="0" y="0"/><hp:orgSz width="100" height="50"/><hp:curSz width="100" height="50"/><hp:lineShape color="#000000" width="57" style="SOLID" tailStyle="ARROW"/><hc:startPt x="0" y="0"/><hc:endPt x="100" y="50"/></hp:line>
      </hp:container>
      <hp:pic><hp:offset x="0" y="0"/><hp:orgSz width="10" height="10"/></hp:pic>
    </hp:container>`)
    const style = decodeShapeStyle(group, { width: 400, height: 200 })!
    expect(style.parts).toHaveLength(2)
    // 100×50 사각형을 가운데(50, 25) 둘레로 90도 → x 25~75, y -25~75 → 2배.
    expect(pathBox(style.parts![0].path)).toEqual({ left: 50, top: -50, right: 150, bottom: 150 })
    // 좌우 대칭한 안쪽 묶음의 선: (100,50)~(200,100) 칸에서 (200,50) → (100,100) → 2배.
    expect(style.parts![1].path).toBe('M400 100 L200 200')
    expect(style.parts![1].end).toEqual([{ x: 200, y: 200 }, { x: 400, y: 100 }])
    expect(style.parts![1].stroke?.tailStyle).toBe('ARROW')
  })

  test('위치가 없는 안쪽 도형은 renderingInfo 행렬을 쓴다', () => {
    const child = node('<hp:rect><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="10" e4="0" e5="1" e6="20"/><hc:scaMatrix e1="2" e2="0" e3="0" e4="0" e5="3" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo></hp:rect>')
    expect(childPlacement(child)).toEqual([2, 0, 0, 3, 10, 20])
  })
})

describe('그림 자르기·효과', () => {
  test('imgClip을 imgDim 비율로, imgRect를 orgSz 비율로 읽는다', () => {
    const picture = node('<hp:pic><hp:orgSz width="1000" height="500"/><hp:imgRect><hc:pt0 x="100" y="0"/><hc:pt1 x="900" y="0"/><hc:pt2 x="900" y="500"/><hc:pt3 x="100" y="500"/></hp:imgRect><hp:imgClip left="1000" right="3000" top="0" bottom="2000"/><hp:imgDim dimwidth="4000" dimheight="4000"/></hp:pic>')
    expect(pictureCrop(picture)).toEqual({ frame: { left: 0.1, top: 0, width: 0.8, height: 1 }, source: { left: 0.25, top: 0, width: 0.5, height: 0.5 } })
  })

  test('자르지 않았거나 경계가 뒤집혔거나 원본 크기를 모르면 자르지 않는다', () => {
    expect(pictureCrop(node('<hp:pic><hp:orgSz width="100" height="100"/><hp:imgClip left="0" right="4000" top="0" bottom="4000"/><hp:imgDim dimwidth="4000" dimheight="4000"/></hp:pic>'))).toBeUndefined()
    // 한/글이 원본 크기 없이 저장한 뒤집힌 경계(오른쪽 0, 위 > 아래).
    expect(pictureCrop(node('<hp:pic><hp:orgSz width="100" height="100"/><hp:imgClip left="0" right="0" top="15660" bottom="4380"/></hp:pic>'))).toBeUndefined()
    expect(pictureCrop(node('<hp:pic><hp:imgClip left="10" right="20" top="0" bottom="20"/></hp:pic>'))).toBeUndefined()
  })

  test('밝기·대비·회색조·불투명도', () => {
    expect(pictureFilter(node('<hp:pic><hc:img bright="-20" contrast="30" effect="GRAY_SCALE" alpha="0"/></hp:pic>'))).toEqual({ brightness: -20, contrast: 30, effect: 'GRAY_SCALE' })
    expect(pictureFilter(node('<hp:pic><hc:img bright="0" contrast="0" effect="REAL_PIC" alpha="0"/></hp:pic>'))).toBeUndefined()
  })
})

describe('줄 간격 종류', () => {
  test('백분율은 값 그대로, 고정·여백·최소는 HWPUNIT(HwpUnitChar case는 그대로, 그 밖은 2배 저장)', () => {
    expect(lineSpacingOf(node('<hh:paraPr><hh:lineSpacing type="PERCENT" value="180"/></hh:paraPr>'))).toEqual({ lineSpacing: 180 })
    expect(lineSpacingOf(node('<hh:paraPr><hh:lineSpacing type="FIXED" value="4800" unit="HWPUNIT"/></hh:paraPr>'))).toEqual({ lineSpacing: 2400, lineSpacingType: 'FIXED' })
    expect(lineSpacingOf(node('<hh:paraPr><hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"><hh:lineSpacing type="BETWEEN_LINES" value="600"/></hp:case><hp:default><hh:lineSpacing type="BETWEEN_LINES" value="1200"/></hp:default></hp:switch></hh:paraPr>'))).toEqual({ lineSpacing: 600, lineSpacingType: 'BETWEEN_LINES' })
    expect(lineSpacingOf(node('<hh:paraPr><hh:lineSpacing type="SOMETHING" value="150"/></hh:paraPr>'))).toEqual({ lineSpacing: 150 })
  })
})

describe('도형 합성 문서', () => {
  let directory: string
  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), 'han-flow-shapes-')) })
  afterAll(() => rmSync(directory, { recursive: true, force: true }))

  test('호·곡선·연결선·묶음 도형·자른 그림·회전 안 함 그림·줄 간격 종류를 읽는다', async () => {
    const document = await decodeViewerDocument(await HwpxPackageReader.open(createShapeHwpx(directory)))
    const content = document.sections[0].blocks.flatMap((block: ViewerParagraph) => block.content)
    const shapes = content.filter((item): item is ViewerObjectPlaceholder => item.type === 'object-placeholder' && item.kind === 'shape')
    for (const expected of SHAPE_FIXTURE_EXPECTED.shapes) {
      const shape = shapes.find((item) => item.element === expected.element && item.position?.horzOffset === expected.x && item.position.vertOffset === expected.y)
      expect(shape?.position).toMatchObject({ width: expected.width, height: expected.height })
      const paths = shape!.shape!.parts?.map((part) => part.path) ?? [shape!.shape!.path!]
      expect(paths).toHaveLength(expected.parts.length)
    }
    const group = shapes.find((item) => item.element === 'hp:container')!
    expect(group.shape!.parts!.map((part) => part.element)).toEqual(['hp:rect', 'hp:ellipse', 'hp:line'])
    expect(group.shape!.parts![1].fill).toMatchObject({ kind: 'gradient', type: 'RADIAL' })
    // 줄 안 부채꼴도 도형으로 그린다(위치 없음, 선언 크기).
    expect(shapes.find((item) => item.element === 'hp:arc' && !item.position)).toMatchObject({ flow: 'inline', size: { width: 3000, height: 2000 }, shape: { closed: true } })

    const images = content.filter((item): item is ViewerImage => item.type === 'image')
    expect(images[0].crop).toEqual({ frame: { left: 0, top: 0, width: 1, height: 1 }, source: { left: 0.25, top: 0, width: 0.5, height: 0.5 } })
    expect(images[1]).toMatchObject({ rotateImage: false, transform: { rotation: 30 }, border: { color: '#C00000' } })
    expect(images[1].crop).toBeUndefined()

    for (const item of SHAPE_LINE_SPACINGS) {
      expect(document.paraStyles[String(item.id)]).toMatchObject({ lineSpacing: item.value, lineSpacingType: item.type })
    }
  })
})
