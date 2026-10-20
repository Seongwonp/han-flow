import type {
  BoxSpacing,
  ViewerImage,
  ViewerShapeFill,
  ViewerShapePart,
  ViewerShapeStroke,
  ViewerShapeStyle,
  ViewerUnitRect
} from '../document/viewer_document'
import type { OrderedXmlNode } from './ordered_xml'

/**
 * HWPX 도형(`hp:rect`·`hp:ellipse`·`hp:line`·`hp:polygon`·`hp:arc`·`hp:curve`·`hp:connectLine`·`hp:container`)과 그림(`hp:pic`)의 선·
 * 채우기·모양을 화면 모델(`ViewerShapeStyle`, `ViewerImage`의 자르기·효과)로 읽는 순수 함수 모음. 좌표는 모두 개체 상자 왼쪽 위 기준
 * HWPUNIT이다. 도형 원본 좌표(꼭짓점·중심·곡선 조각)는 원래 크기(`hp:orgSz`) 기준이라 그리는 크기에 맞춰 늘이거나 줄인다.
 */

const num = (value?: string): number => Number(value ?? 0)
const children = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => node.children.filter((item) => item.name === name)
const child = (node: OrderedXmlNode, name: string): OrderedXmlNode | undefined => node.children.find((item) => item.name === name)
/** `hc:`·`hp:` 어느 쪽 이름으로 저장해도 읽는다(생성기마다 namespace prefix가 다르다). */
const eitherChild = (node: OrderedXmlNode, local: string): OrderedXmlNode | undefined => child(node, `hc:${local}`) ?? child(node, `hp:${local}`)
const COLOR = /^#[0-9a-f]{6}$/iu

/** 한/글이 음수를 32비트 부호 없는 수로 저장한 좌표를 부호 있는 값으로 읽는다. */
function coordinate(value?: string): number {
  const parsed = num(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed >= 2 ** 31 && parsed < 2 ** 32 ? parsed - 2 ** 32 : parsed
}

export interface Point { x: number; y: number }
/** SVG `matrix(a b c d e f)`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function multiply(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}
export function apply(matrix: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]
function rotate(degrees: number): Matrix {
  const radians = degrees * Math.PI / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [cos, sin, -sin, cos, 0, 0]
}

/** path 명령(`M`·`L`·`C`·`Q`·`Z`)과 그 점. 행렬로 옮긴 뒤 SVG path 자료로 바꾼다. */
export type PathCommand = { op: 'M' | 'L' | 'C' | 'Q'; points: Point[] } | { op: 'Z'; points: [] }

const round = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Object.is(rounded, -0) ? 0 : rounded
}
export function serializePath(commands: readonly PathCommand[], matrix: Matrix = IDENTITY): string {
  return commands.map((command) => command.op === 'Z'
    ? 'Z'
    : `${command.op}${command.points.map((point) => {
        const moved = apply(matrix, point)
        return `${round(moved.x)} ${round(moved.y)}`
      }).join(' ')}`).join(' ')
}

/** 원·타원을 3차 Bézier 4개로 그릴 때의 조절점 비율. */
const KAPPA = 0.5522847498

/**
 * 중심 `center`에서 두 반지름 벡터 `u`(시작 쪽)·`v`(끝 쪽)로 만든 타원의 4분의 1 호(`center + u·cosθ + v·sinθ`, θ = 0 → 90°).
 * 한/글 호는 중심·두 축 끝점으로 저장하고 두 끝점 사이 4분의 1 타원을 그린다. 아핀 변환은 Bézier를 보존하므로 단위 원 4분의 1을
 * 그대로 옮긴다.
 */
function quarterArc(center: Point, start: Point, end: Point): PathCommand {
  const u = { x: start.x - center.x, y: start.y - center.y }
  const v = { x: end.x - center.x, y: end.y - center.y }
  return {
    op: 'C',
    points: [
      { x: start.x + KAPPA * v.x, y: start.y + KAPPA * v.y },
      { x: end.x + KAPPA * u.x, y: end.y + KAPPA * u.y },
      end
    ]
  }
}

function ellipseCommands(width: number, height: number): PathCommand[] {
  const center = { x: width / 2, y: height / 2 }
  const top = { x: width / 2, y: 0 }
  const right = { x: width, y: height / 2 }
  const bottom = { x: width / 2, y: height }
  const left = { x: 0, y: height / 2 }
  return [
    { op: 'M', points: [top] },
    quarterArc(center, top, right),
    quarterArc(center, right, bottom),
    quarterArc(center, bottom, left),
    quarterArc(center, left, top),
    { op: 'Z', points: [] }
  ]
}

function rectangleCommands(width: number, height: number, radius = 0): PathCommand[] {
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2)
  if (!(r > 0)) {
    return [
      { op: 'M', points: [{ x: 0, y: 0 }] },
      { op: 'L', points: [{ x: width, y: 0 }] },
      { op: 'L', points: [{ x: width, y: height }] },
      { op: 'L', points: [{ x: 0, y: height }] },
      { op: 'Z', points: [] }
    ]
  }
  const corner = (cx: number, cy: number, from: Point, to: Point) => quarterArc({ x: cx, y: cy }, from, to)
  return [
    { op: 'M', points: [{ x: r, y: 0 }] },
    { op: 'L', points: [{ x: width - r, y: 0 }] },
    corner(width - r, r, { x: width - r, y: 0 }, { x: width, y: r }),
    { op: 'L', points: [{ x: width, y: height - r }] },
    corner(width - r, height - r, { x: width, y: height - r }, { x: width - r, y: height }),
    { op: 'L', points: [{ x: r, y: height }] },
    corner(r, height - r, { x: r, y: height }, { x: 0, y: height - r }),
    { op: 'L', points: [{ x: 0, y: r }] },
    corner(r, r, { x: 0, y: r }, { x: r, y: 0 }),
    { op: 'Z', points: [] }
  ]
}

/** 사각형 모서리 곡률(`ratio`, 0~50%)을 짧은 변 기준 반지름으로. */
export function rectangleRadius(node: OrderedXmlNode, width: number, height: number): number {
  const ratio = num(node.attributes.ratio)
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(width, height) * Math.min(ratio, 50) / 100 : 0
}

const point = (node: OrderedXmlNode | undefined): Point | undefined =>
  node ? { x: coordinate(node.attributes.x), y: coordinate(node.attributes.y) } : undefined

export interface LeafGeometry {
  commands: PathCommand[]
  closed: boolean
  /** 열린 선의 시작·끝 방향: [끝점, 그 앞(뒤) 조절점]. 원래 좌표. */
  start?: [Point, Point]
  end?: [Point, Point]
}

/** 점 목록의 마지막 두 점이 같으면 그 앞 점까지 거슬러 화살표 방향을 잡는다. */
function direction(points: readonly Point[]): [Point, Point] | undefined {
  const tip = points[points.length - 1]
  if (!tip) return undefined
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index]
    if (Math.hypot(candidate.x - tip.x, candidate.y - tip.y) > 0.5) return [tip, candidate]
  }
  return undefined
}

function lastPoint(command: PathCommand): Point | undefined {
  return command.op === 'Z' ? undefined : command.points[command.points.length - 1]
}

/** 열린 path의 시작·끝 방향(Bézier는 조절점 쪽). */
function openEnds(commands: readonly PathCommand[]): Pick<LeafGeometry, 'start' | 'end'> {
  const drawn = commands.filter((command): command is Exclude<PathCommand, { op: 'Z' }> => command.op !== 'Z')
  if (drawn.length < 2) return {}
  const forward: Point[] = []
  for (const command of drawn) forward.push(...command.points)
  const start = direction([...forward].reverse())
  const end = direction(forward)
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) }
}

/**
 * 곡선(`hp:curve`)의 조각(`hp:seg type x1 y1 x2 y2`). 한/글은 곡선을 3차 Bézier 조절 다각형으로 저장하므로 이어지는 `CURVE` 조각
 * 셋을 Bézier 하나(시작점 → 조절점 둘 → 끝점)로, 남는 둘은 2차 Bézier, 하나는 직선으로 그린다. `LINE` 조각은 직선이다. 끝점이
 * 시작점과 같으면 닫힌 곡선으로 면을 채운다.
 */
export function curveCommands(node: OrderedXmlNode): PathCommand[] {
  const segments = children(node, 'hp:seg').map((segment) => ({
    curve: segment.attributes.type === 'CURVE',
    from: { x: coordinate(segment.attributes.x1), y: coordinate(segment.attributes.y1) },
    to: { x: coordinate(segment.attributes.x2), y: coordinate(segment.attributes.y2) }
  }))
  if (!segments.length) return []
  const commands: PathCommand[] = [{ op: 'M', points: [segments[0].from] }]
  let index = 0
  while (index < segments.length) {
    if (!segments[index].curve) {
      commands.push({ op: 'L', points: [segments[index].to] })
      index += 1
      continue
    }
    let run = 0
    while (index + run < segments.length && segments[index + run].curve && run < 3) run += 1
    const ends = segments.slice(index, index + run).map((segment) => segment.to)
    if (run === 3) commands.push({ op: 'C', points: ends })
    else if (run === 2) commands.push({ op: 'Q', points: ends })
    else commands.push({ op: 'L', points: ends })
    index += run
  }
  return commands
}

/** 연결선(`hp:connectLine`)의 꺾인 점(`hp:controlPoints/hp:point`). 시작·끝점과 같은 점은 뺀다. */
function connectorPoints(node: OrderedXmlNode, start: Point, end: Point): Point[] {
  const list = child(node, 'hp:controlPoints') ?? child(node, 'hc:controlPoints')
  if (!list) return []
  const near = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y) <= 1
  return list.children
    .filter((item) => item.name.endsWith(':point') || item.name.endsWith(':pt'))
    .map((item) => point(item)!)
    .filter((item) => !near(item, start) && !near(item, end))
}

/**
 * 연결선. `STRAIGHT_*`는 직선, `STROKE_*`는 꺾인 점을 지나는 꺾은선, `ARC_*`는 꺾인 점을 지나는 부드러운 곡선(Catmull-Rom을 3차
 * Bézier로)이다. 꺾인 점이 없으면 직선이다.
 */
function connectorCommands(node: OrderedXmlNode, start: Point, end: Point): PathCommand[] {
  const type = node.attributes.type ?? ''
  const middle = type.startsWith('STRAIGHT') ? [] : connectorPoints(node, start, end)
  const points = [start, ...middle, end]
  const commands: PathCommand[] = [{ op: 'M', points: [start] }]
  if (!type.startsWith('ARC') || points.length < 3) {
    for (const item of points.slice(1)) commands.push({ op: 'L', points: [item] })
    return commands
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(index - 1, 0)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(index + 2, points.length - 1)]
    commands.push({
      op: 'C',
      points: [
        { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        p2
      ]
    })
  }
  return commands
}

/**
 * 도형 하나의 모양(원래 크기 `width`×`height` 좌표). 그릴 수 없는 도형(꼭짓점이 모자란 다각형 등)은 undefined.
 */
export function leafGeometry(node: OrderedXmlNode, width: number, height: number): LeafGeometry | undefined {
  switch (node.name) {
    case 'hp:rect':
      return { commands: rectangleCommands(width, height, rectangleRadius(node, width, height)), closed: true }
    case 'hp:ellipse':
      return { commands: ellipseCommands(width, height), closed: true }
    case 'hp:line':
    case 'hp:connectLine': {
      const start = point(eitherChild(node, 'startPt'))
      const end = point(eitherChild(node, 'endPt'))
      if (!start || !end) return undefined
      const commands = node.name === 'hp:line'
        ? [{ op: 'M', points: [start] }, { op: 'L', points: [end] }] as PathCommand[]
        : connectorCommands(node, start, end)
      return { commands, closed: false, ...openEnds(commands) }
    }
    case 'hp:polygon': {
      const points = children(node, 'hc:pt').map((item) => point(item)!)
      if (points.length < 2) return undefined
      return {
        commands: [{ op: 'M', points: [points[0]] }, ...points.slice(1).map((item) => ({ op: 'L', points: [item] }) as PathCommand), { op: 'Z', points: [] }],
        closed: true
      }
    }
    case 'hp:arc': {
      const center = point(eitherChild(node, 'center'))
      const first = point(eitherChild(node, 'ax1'))
      const second = point(eitherChild(node, 'ax2'))
      if (!center || !first || !second) return undefined
      const type = node.attributes.type ?? 'NORMAL'
      const commands: PathCommand[] = [{ op: 'M', points: [first] }, quarterArc(center, first, second)]
      if (type === 'PIE') commands.push({ op: 'L', points: [center] }, { op: 'Z', points: [] })
      else if (type === 'CHORD') commands.push({ op: 'Z', points: [] })
      const closed = type === 'PIE' || type === 'CHORD'
      return { commands, closed, ...(closed ? {} : openEnds(commands)) }
    }
    case 'hp:curve': {
      const commands = curveCommands(node)
      if (commands.length < 2) return undefined
      const first = commands[0].points[0]
      const last = lastPoint(commands[commands.length - 1])
      const closed = Boolean(first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1)
      if (closed) commands.push({ op: 'Z', points: [] })
      return { commands, closed, ...(closed ? {} : openEnds(commands)) }
    }
    default:
      return undefined
  }
}

const SIZE_PATTERN = /^(SMALL|MEDIUM|LARGE)_(SMALL|MEDIUM|LARGE)$/u

/** 도형 선(`hp:lineShape`). 선 모양이 `NONE`이거나 색·굵기가 없으면 undefined. */
export function strokeOf(node: OrderedXmlNode): ViewerShapeStroke | undefined {
  const line = child(node, 'hp:lineShape')
  if (!line) return undefined
  const color = line.attributes.color ?? ''
  const width = num(line.attributes.width)
  const style = line.attributes.style ?? 'SOLID'
  if (style === 'NONE' || style === '' || !COLOR.test(color) || !(width > 0)) return undefined
  const stroke: ViewerShapeStroke = { color, width, style }
  if (line.attributes.endCap === 'ROUND' || line.attributes.endCap === 'FLAT') stroke.endCap = line.attributes.endCap
  const arrow = (value?: string) => value && value !== 'NORMAL' ? value : undefined
  const head = arrow(line.attributes.headStyle)
  const tail = arrow(line.attributes.tailStyle)
  if (head) stroke.headStyle = head
  if (tail) stroke.tailStyle = tail
  if (SIZE_PATTERN.test(line.attributes.headSz ?? '')) stroke.headSize = line.attributes.headSz
  if (SIZE_PATTERN.test(line.attributes.tailSz ?? '')) stroke.tailSize = line.attributes.tailSz
  if (line.attributes.headfill === '0') stroke.headFill = false
  if (line.attributes.tailfill === '0') stroke.tailFill = false
  const opacity = opacityOf(line.attributes.alpha)
  if (opacity !== undefined) stroke.opacity = opacity
  return stroke
}

/** 투명도(`alpha`, 0 불투명 ~ 255 투명; 0~1 소수로 쓴 생성기도 있다)를 불투명도로. 불투명이면 undefined. */
function opacityOf(alpha?: string): number | undefined {
  const value = num(alpha)
  if (!Number.isFinite(value) || value <= 0) return undefined
  const transparency = value <= 1 && alpha?.includes('.') ? value : Math.min(value, 255) / 255
  return Math.round((1 - transparency) * 1000) / 1000
}

const HATCH_STYLES = new Set(['HORIZONTAL', 'VERTICAL', 'BACK_SLASH', 'SLASH', 'CROSS', 'CROSS_DIAGONAL'])
const GRADIENT_TYPES = new Set(['LINEAR', 'RADIAL', 'CONICAL', 'SQUARE'])

/**
 * 면 채우기(`hc:fillBrush`). 그러데이션(`hc:gradation`)이 있으면 그것을, 아니면 단색·무늬(`hc:winBrush`)를 쓴다. 그림 채우기
 * (`hc:imgBrush`)는 그리지 않는다. 완전히 투명하거나 색이 없으면 undefined.
 */
export function fillOf(node: OrderedXmlNode): ViewerShapeFill | undefined {
  const brush = child(node, 'hc:fillBrush')
  if (!brush) return undefined
  const gradation = child(brush, 'hc:gradation')
  if (gradation) {
    const colors = children(gradation, 'hc:color').map((item) => item.attributes.value ?? '').filter((color) => COLOR.test(color))
    const type = gradation.attributes.type ?? 'LINEAR'
    if (colors.length >= 1 && GRADIENT_TYPES.has(type)) {
      const opacity = opacityOf(gradation.attributes.alpha)
      if (opacity === 0) return undefined
      const angle = num(gradation.attributes.angle)
      const clampPercent = (value: string | undefined, fallback: number) => {
        const parsed = num(value)
        return value !== undefined && Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : fallback
      }
      return {
        kind: 'gradient',
        type: type as 'LINEAR',
        angle: Number.isFinite(angle) ? angle : 0,
        centerX: clampPercent(gradation.attributes.centerX, 50),
        centerY: clampPercent(gradation.attributes.centerY, 50),
        colors: colors.length === 1 ? [colors[0], colors[0]] : colors,
        ...(opacity !== undefined ? { opacity } : {})
      }
    }
  }
  const winBrush = child(brush, 'hc:winBrush')
  if (!winBrush) return undefined
  const face = winBrush.attributes.faceColor ?? ''
  const opacity = opacityOf(winBrush.attributes.alpha)
  if (opacity === 0) return undefined
  const hatchStyle = winBrush.attributes.hatchStyle ?? ''
  const hatchColor = winBrush.attributes.hatchColor ?? ''
  if (HATCH_STYLES.has(hatchStyle) && COLOR.test(hatchColor)) {
    return { kind: 'hatch', color: COLOR.test(face) ? face : 'none', hatchColor, hatchStyle, ...(opacity !== undefined ? { opacity } : {}) }
  }
  if (!COLOR.test(face)) return undefined
  return { kind: 'solid', color: face, ...(opacity !== undefined ? { opacity } : {}) }
}

/** 도형이 원래 크기(`hp:orgSz`)에서 그리는 크기(`hp:curSz`, 없으면 `hp:sz`)로 늘어난 배율의 기준 크기. */
function originalSize(node: OrderedXmlNode, fallback: { width: number; height: number }): { width: number; height: number } {
  const original = child(node, 'hp:orgSz')
  const width = num(original?.attributes.width)
  const height = num(original?.attributes.height)
  return { width: width > 0 ? width : fallback.width, height: height > 0 ? height : fallback.height }
}

function currentSize(node: OrderedXmlNode): { width: number; height: number } | undefined {
  for (const name of ['hp:curSz', 'hp:sz', 'hp:orgSz']) {
    const size = child(node, name)
    const width = num(size?.attributes.width)
    const height = num(size?.attributes.height)
    if (width > 0 || height > 0) return { width: Math.max(width, 0), height: Math.max(height, 0) }
  }
  return undefined
}

/** 원래 크기 → 그리는 크기 배율. 원래 크기가 0인 축(가로선·세로선)은 1이다. */
function sizeScale(original: { width: number; height: number }, drawn: { width: number; height: number }): Matrix {
  return scale(original.width > 0 ? drawn.width / original.width : 1, original.height > 0 ? drawn.height / original.height : 1)
}

/** `hp:renderingInfo`의 행렬(`e1`~`e6`, 2×3 행 우선) 곱. 이동 행렬 뒤에 크기·회전 행렬 쌍이 묶음 깊이만큼 이어진다. */
export function renderingMatrix(node: OrderedXmlNode): Matrix | undefined {
  const info = child(node, 'hp:renderingInfo')
  if (!info) return undefined
  let result: Matrix | undefined
  for (const item of info.children) {
    if (!/:(transMatrix|scaMatrix|rotMatrix)$/u.test(item.name)) continue
    const value = (name: string) => num(item.attributes[name])
    const matrix: Matrix = [value('e1'), value('e4'), value('e2'), value('e5'), value('e3'), value('e6')]
    if (matrix.some((entry) => !Number.isFinite(entry))) return undefined
    result = result ? multiply(result, matrix) : matrix
  }
  return result
}

/**
 * 묶음 안 도형 하나가 놓이는 행렬(그 도형의 원래 크기 좌표 → 부모 묶음의 원래 크기 좌표). 위치(`hp:offset`), 원래 → 현재 크기,
 * 회전 중심(`hp:rotationInfo centerX`·`centerY`, 현재 크기 기준) 둘레의 회전(시계 방향)과 대칭(`hp:flip`)을 한/글처럼 대칭 → 회전
 * 순서로 붙인다. 위치·크기가 없으면 `hp:renderingInfo` 행렬을 쓴다.
 */
export function childPlacement(node: OrderedXmlNode): Matrix | undefined {
  const offset = child(node, 'hp:offset')
  const size = currentSize(node)
  if (!offset || !size) return renderingMatrix(node)
  const original = originalSize(node, size)
  const rotation = child(node, 'hp:rotationInfo')
  const flip = child(node, 'hp:flip')
  const angle = num(rotation?.attributes.angle)
  const centerX = rotation?.attributes.centerX !== undefined ? num(rotation.attributes.centerX) : size.width / 2
  const centerY = rotation?.attributes.centerY !== undefined ? num(rotation.attributes.centerY) : size.height / 2
  const flipX = flip?.attributes.horizontal === '1'
  const flipY = flip?.attributes.vertical === '1'
  let matrix = translate(coordinate(offset.attributes.x), coordinate(offset.attributes.y))
  if ((Number.isFinite(angle) && angle % 360 !== 0) || flipX || flipY) {
    matrix = multiply(matrix, translate(centerX, centerY))
    if (Number.isFinite(angle) && angle % 360 !== 0) matrix = multiply(matrix, rotate(angle))
    if (flipX || flipY) matrix = multiply(matrix, scale(flipX ? -1 : 1, flipY ? -1 : 1))
    matrix = multiply(matrix, translate(-centerX, -centerY))
  }
  return multiply(matrix, sizeScale(original, size))
}

const SHAPE_PART_ELEMENTS = new Set(['hp:rect', 'hp:ellipse', 'hp:line', 'hp:polygon', 'hp:arc', 'hp:curve', 'hp:connectLine'])
/** 묶음 안 도형 수 한도(깊은 묶음·큰 묶음이 화면을 멈추지 않게). */
const MAX_SHAPE_PARTS = 2000
const MAX_GROUP_DEPTH = 16

/**
 * 묶음 도형(`hp:container`)을 이루는 도형들을 묶음 개체 상자 좌표로 평탄하게 모은다. 안쪽 묶음은 그 묶음 위치·크기·회전·대칭을
 * 곱해 내려간다. 글맵시·그림·OLE 같은 안쪽 개체는 그리지 않는다.
 */
function groupParts(node: OrderedXmlNode, matrix: Matrix, parts: ViewerShapePart[], depth: number): void {
  if (depth > MAX_GROUP_DEPTH) return
  for (const item of node.children) {
    if (parts.length >= MAX_SHAPE_PARTS) return
    if (item.name !== 'hp:container' && !SHAPE_PART_ELEMENTS.has(item.name)) continue
    const placement = childPlacement(item)
    if (!placement) continue
    const placed = multiply(matrix, placement)
    if (item.name === 'hp:container') {
      groupParts(item, placed, parts, depth + 1)
      continue
    }
    const size = currentSize(item)
    const original = size ? originalSize(item, size) : undefined
    if (!original) continue
    const geometry = leafGeometry(item, original.width, original.height)
    if (!geometry) continue
    const stroke = strokeOf(item)
    const fill = geometry.closed ? fillOf(item) : undefined
    if (!stroke && !fill) continue
    const move = (pair?: [Point, Point]) => pair ? [apply(placed, pair[0]), apply(placed, pair[1])] as [Point, Point] : undefined
    const start = move(geometry.start)
    const end = move(geometry.end)
    parts.push({
      element: item.name,
      path: serializePath(geometry.commands, placed),
      closed: geometry.closed,
      ...(stroke ? { stroke } : {}),
      ...(fill ? { fill } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {})
    })
  }
}

const box = (node?: OrderedXmlNode): BoxSpacing => ({ top: num(node?.attributes.top), right: num(node?.attributes.right), bottom: num(node?.attributes.bottom), left: num(node?.attributes.left) })

/**
 * 도형·글상자의 선·채우기·모양. `size`는 그리는 크기(원본 위치 개체는 배치 상자, 줄 안 개체는 선언 크기)다. 그릴 것이 없으면
 * undefined.
 */
export function decodeShapeStyle(node: OrderedXmlNode, size: { width: number; height: number } | undefined): ViewerShapeStyle | undefined {
  const style: ViewerShapeStyle = {}
  const stroke = strokeOf(node)
  if (stroke) style.stroke = stroke
  const fill = fillOf(node)
  if (fill) {
    style.fillPaint = fill
    if (fill.kind === 'solid' || (fill.kind === 'hatch' && fill.color !== 'none')) style.fill = fill.color
  }
  const drawn = size ?? currentSize(node) ?? { width: 0, height: 0 }
  const original = originalSize(node, drawn)
  const toBox = sizeScale(original, drawn)
  if (node.name === 'hp:line' || node.name === 'hp:polygon') {
    const geometry = leafGeometry(node, original.width, original.height)
    if (geometry) {
      const points = geometry.commands.flatMap((command) => command.points)
      style.points = points.map((item) => apply(toBox, item))
    }
  } else if (node.name === 'hp:arc' || node.name === 'hp:curve' || node.name === 'hp:connectLine') {
    const geometry = leafGeometry(node, original.width, original.height)
    if (geometry) {
      style.path = serializePath(geometry.commands, toBox)
      style.closed = geometry.closed
      // 열린 선(호·곡선·연결선)은 면을 채우지 않는다.
      if (!geometry.closed) {
        delete style.fillPaint
        delete style.fill
      }
      if (geometry.start) style.start = [apply(toBox, geometry.start[0]), apply(toBox, geometry.start[1])]
      if (geometry.end) style.end = [apply(toBox, geometry.end[0]), apply(toBox, geometry.end[1])]
      // 연결선 종류의 화살표(`*_ONEWAY`는 끝, `*_BOTH`는 양쪽). 선 모양에 화살표가 따로 있으면 그것을 쓴다.
      const type = node.attributes.type ?? ''
      if (node.name === 'hp:connectLine' && style.stroke) {
        if ((type.endsWith('_ONEWAY') || type.endsWith('_BOTH')) && !style.stroke.tailStyle) style.stroke.tailStyle = 'ARROW'
        if (type.endsWith('_BOTH') && !style.stroke.headStyle) style.stroke.headStyle = 'ARROW'
      }
    }
  } else if (node.name === 'hp:container') {
    const parts: ViewerShapePart[] = []
    groupParts(node, toBox, parts, 0)
    if (parts.length) style.parts = parts
  }
  const drawText = child(node, 'hp:drawText')
  if (drawText) {
    const margin = child(drawText, 'hp:textMargin')
    if (margin) style.textMargin = box(margin)
    const subList = child(drawText, 'hp:subList')
    if (subList?.attributes.vertAlign) style.textVerticalAlign = subList.attributes.vertAlign
  }
  return Object.keys(style).length ? style : undefined
}

/**
 * 그림 자르기·그릴 자리(`hp:imgClip`·`hp:imgRect`·`hp:imgDim`). 자르기는 원본 그림 크기(`hp:imgDim dimwidth`·`dimheight`) 안의
 * 왼쪽·위·오른쪽·아래 경계라 그 비율로 보이는 부분을 정하고, 그릴 자리는 원래 크기(`hp:orgSz`) 안의 네 꼭짓점이라 그 비율로 개체
 * 상자 안 자리를 정한다. 경계가 뒤집혔거나(한/글이 원본 크기 없이 저장한 값) 원본 크기를 모르면 자르지 않는다. 자르지 않고 상자를
 * 다 채우면 undefined.
 */
export function pictureCrop(node: OrderedXmlNode): ViewerImage['crop'] {
  const full: ViewerUnitRect = { left: 0, top: 0, width: 1, height: 1 }
  let source = full
  const clip = child(node, 'hp:imgClip')
  const dimension = child(node, 'hp:imgDim')
  const dimWidth = num(dimension?.attributes.dimwidth)
  const dimHeight = num(dimension?.attributes.dimheight)
  if (clip && dimWidth > 0 && dimHeight > 0) {
    const left = num(clip.attributes.left)
    const right = num(clip.attributes.right)
    const top = num(clip.attributes.top)
    const bottom = num(clip.attributes.bottom)
    if ([left, right, top, bottom].every(Number.isFinite) && left >= 0 && top >= 0 && right > left && bottom > top) {
      const clamp = (value: number) => Math.min(Math.max(value, 0), 1)
      const x0 = clamp(left / dimWidth)
      const x1 = clamp(right / dimWidth)
      const y0 = clamp(top / dimHeight)
      const y1 = clamp(bottom / dimHeight)
      if (x1 > x0 && y1 > y0) source = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
    }
  }
  let frame = full
  const rect = child(node, 'hp:imgRect')
  const original = child(node, 'hp:orgSz')
  const orgWidth = num(original?.attributes.width)
  const orgHeight = num(original?.attributes.height)
  if (rect && orgWidth > 0 && orgHeight > 0) {
    const corners = ['pt0', 'pt1', 'pt2', 'pt3'].map((name) => point(eitherChild(rect, name))).filter((item): item is Point => Boolean(item))
    if (corners.length === 4) {
      const xs = corners.map((item) => item.x / orgWidth)
      const ys = corners.map((item) => item.y / orgHeight)
      const left = Math.min(...xs)
      const top = Math.min(...ys)
      const width = Math.max(...xs) - left
      const height = Math.max(...ys) - top
      if (width > 0 && height > 0 && [left, top, width, height].every(Number.isFinite)) frame = { left, top, width, height }
    }
  }
  const same = (a: ViewerUnitRect, b: ViewerUnitRect) =>
    Math.abs(a.left - b.left) < 0.001 && Math.abs(a.top - b.top) < 0.001 && Math.abs(a.width - b.width) < 0.001 && Math.abs(a.height - b.height) < 0.001
  if (same(source, full) && same(frame, full)) return undefined
  const rounded = (rect: ViewerUnitRect): ViewerUnitRect => ({
    left: Math.round(rect.left * 10000) / 10000,
    top: Math.round(rect.top * 10000) / 10000,
    width: Math.round(rect.width * 10000) / 10000,
    height: Math.round(rect.height * 10000) / 10000
  })
  return { frame: rounded(frame), source: rounded(source) }
}

/** 그림 효과(`hc:img bright`·`contrast`·`effect`·`alpha`). 원본 그대로면 undefined. */
export function pictureFilter(node: OrderedXmlNode): ViewerImage['filter'] {
  const image = child(node, 'hc:img')
  if (!image) return undefined
  const filter: NonNullable<ViewerImage['filter']> = {}
  const clampPercent = (value: number) => Math.min(Math.max(value, -100), 100)
  const brightness = num(image.attributes.bright)
  const contrast = num(image.attributes.contrast)
  if (Number.isFinite(brightness) && brightness !== 0) filter.brightness = clampPercent(brightness)
  if (Number.isFinite(contrast) && contrast !== 0) filter.contrast = clampPercent(contrast)
  if (image.attributes.effect === 'GRAY_SCALE' || image.attributes.effect === 'BLACK_WHITE') filter.effect = image.attributes.effect
  const opacity = opacityOf(image.attributes.alpha)
  if (opacity !== undefined) filter.opacity = opacity
  return Object.keys(filter).length ? filter : undefined
}
