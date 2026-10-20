import { CSSProperties, ReactNode, useId } from 'react'
import type { ViewerImage, ViewerObjectPlaceholder, ViewerShapeFill, ViewerShapeStroke, ViewerShapeStyle } from '../../core/document/viewer_document'
import { hwpUnitToCssPx } from '../../core/layout/hwp_unit'

/**
 * HWPX 도형을 SVG로 그린다(사각형·타원·선·다각형·호·곡선·연결선·묶음 도형). 좌표는 개체 상자 기준 HWPUNIT이고 SVG `viewBox`가
 * HWPUNIT을 CSS px로 바꾼다. 화면과 인쇄(PDF)가 같은 벡터 도형이다.
 */

/** SVG로 그릴 수 있는 도형 element. 묶음은 그릴 안쪽 도형(`parts`)이 있을 때만. */
const DRAWABLE_SHAPES = new Set(['hp:rect', 'hp:ellipse', 'hp:line', 'hp:polygon', 'hp:arc', 'hp:curve', 'hp:connectLine', 'hp:container'])

export function drawableShape(item: ViewerObjectPlaceholder): boolean {
  if (!DRAWABLE_SHAPES.has(item.element)) return false
  if (item.element === 'hp:container') return Boolean(item.shape?.parts?.length)
  if (item.element === 'hp:arc' || item.element === 'hp:curve' || item.element === 'hp:connectLine') return Boolean(item.shape?.path)
  return true
}

/** 화면에서 보이도록 선 굵기 최솟값(HWPUNIT, 약 0.5pt). */
const MIN_STROKE = 50

function strokeWidthOf(stroke: ViewerShapeStroke | undefined): number {
  return stroke ? Math.max(stroke.width, MIN_STROKE) : 0
}

/**
 * 선 모양을 SVG 점선 배열로(선 굵기 배수). 이중선 계열(`DOUBLE_SLIM`·`SLIM_THICK`·`THICK_SLIM`·`SLIM_THICK_SLIM`)과 물결선은 실선으로
 * 근사한다.
 */
export function strokeDashArray(style: string, width: number): string | undefined {
  const unit = Math.max(width, MIN_STROKE)
  const pattern: Record<string, number[]> = {
    DASH: [4, 2],
    DOT: [1, 1.5],
    DASH_DOT: [4, 2, 1, 2],
    DASH_DOT_DOT: [4, 2, 1, 2, 1, 2],
    LONG_DASH: [8, 3],
    CIRCLE: [0.01, 2]
  }
  const values = pattern[style]
  return values ? values.map((value) => Math.round(value * unit * 10) / 10).join(' ') : undefined
}

function strokeProps(stroke: ViewerShapeStroke | undefined): Record<string, string | number | undefined> {
  if (!stroke) return { stroke: 'none', strokeWidth: 0 }
  const width = strokeWidthOf(stroke)
  return {
    stroke: stroke.color,
    strokeWidth: width,
    strokeDasharray: strokeDashArray(stroke.style, width),
    // 원 점선은 둥근 끝이어야 점으로 보인다.
    strokeLinecap: stroke.style === 'CIRCLE' || stroke.endCap === 'ROUND' ? 'round' : 'butt',
    strokeLinejoin: stroke.endCap === 'ROUND' ? 'round' : 'miter',
    strokeOpacity: stroke.opacity
  }
}

const HATCH_SPACING = 400
const HATCH_LINES: Record<string, string> = {
  HORIZONTAL: `M0 ${HATCH_SPACING / 2} H${HATCH_SPACING}`,
  VERTICAL: `M${HATCH_SPACING / 2} 0 V${HATCH_SPACING}`,
  SLASH: `M0 ${HATCH_SPACING} L${HATCH_SPACING} 0`,
  BACK_SLASH: `M0 0 L${HATCH_SPACING} ${HATCH_SPACING}`,
  CROSS: `M0 ${HATCH_SPACING / 2} H${HATCH_SPACING} M${HATCH_SPACING / 2} 0 V${HATCH_SPACING}`,
  CROSS_DIAGONAL: `M0 ${HATCH_SPACING} L${HATCH_SPACING} 0 M0 0 L${HATCH_SPACING} ${HATCH_SPACING}`
}

/** 채우기 하나의 SVG 정의(그러데이션·무늬)와 `fill` 값. */
function paintOf(fill: ViewerShapeFill | undefined, id: string): { defs?: ReactNode; fill: string; fillOpacity?: number } {
  if (!fill) return { fill: 'none' }
  if (fill.kind === 'solid') return { fill: fill.color, fillOpacity: fill.opacity }
  if (fill.kind === 'hatch') {
    return {
      fill: `url(#${id})`,
      fillOpacity: fill.opacity,
      defs: <pattern id={id} data-fill-kind="hatch" data-hatch-style={fill.hatchStyle} patternUnits="userSpaceOnUse" width={HATCH_SPACING} height={HATCH_SPACING}>
        {fill.color !== 'none' && <rect width={HATCH_SPACING} height={HATCH_SPACING} fill={fill.color} />}
        <path d={HATCH_LINES[fill.hatchStyle]} stroke={fill.hatchColor} strokeWidth={28} fill="none" />
      </pattern>
    }
  }
  const stops = fill.colors.map((color, index) => <stop key={index} offset={fill.colors.length > 1 ? index / (fill.colors.length - 1) : 0} stopColor={color} />)
  // 선형은 0도가 왼쪽 → 오른쪽이고 시계 방향으로 돈다. 원형·원뿔·사각형은 중심에서 바깥으로 퍼지는 원형으로 그린다.
  const defs = fill.type === 'LINEAR'
    ? <linearGradient id={id} data-fill-kind="gradient" data-gradient-type="LINEAR" x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform={fill.angle ? `rotate(${fill.angle} 0.5 0.5)` : undefined}>{stops}</linearGradient>
    : <radialGradient id={id} data-fill-kind="gradient" data-gradient-type={fill.type} cx={fill.centerX / 100} cy={fill.centerY / 100} r={0.75}>{stops}</radialGradient>
  return { fill: `url(#${id})`, fillOpacity: fill.opacity, defs }
}

const ARROW_BASE: Record<string, number> = { SMALL: 280, MEDIUM: 420, LARGE: 600 }

/** 화살표 크기(`폭_길이`)를 HWPUNIT 폭·길이로. 선이 굵으면 함께 커진다. */
function arrowSize(size: string | undefined, strokeWidth: number): { width: number; length: number } {
  const [width, length] = (size ?? 'MEDIUM_MEDIUM').split('_')
  return {
    width: (ARROW_BASE[width] ?? ARROW_BASE.MEDIUM) + strokeWidth * 2,
    length: (ARROW_BASE[length] ?? ARROW_BASE.MEDIUM) + strokeWidth * 2
  }
}

type Point = { x: number; y: number }
const format = (value: number) => Math.round(value * 10) / 10

/**
 * 선 끝 화살표 하나. `tip`이 선 끝점이고 `from`에서 `tip` 쪽을 향한다. 화살·창·오목 화살은 끝점이 꼭짓점이고, 마름모·원·사각형은
 * 끝점이 가운데다. `EMPTY_*`와 속 채우지 않음은 흰 바탕에 선으로만 그린다.
 */
export function arrowHead(style: string, tip: Point, from: Point, size: { width: number; length: number }, color: string, strokeWidth: number, filled = true): ReactNode {
  const distance = Math.hypot(tip.x - from.x, tip.y - from.y)
  if (!(distance > 0)) return null
  const dx = (tip.x - from.x) / distance
  const dy = (tip.y - from.y) / distance
  const nx = -dy
  const ny = dx
  const at = (along: number, across: number) => `${format(tip.x + dx * along + nx * across)} ${format(tip.y + dy * along + ny * across)}`
  const half = size.width / 2
  const solid = filled && !style.startsWith('EMPTY_')
  const paint = { fill: solid ? color : '#FFFFFF', stroke: color, strokeWidth: Math.max(strokeWidth / 2, 20), strokeLinejoin: 'miter' as const }
  const common = { 'data-arrow': style, className: 'viewer-shape-arrow' }
  switch (style) {
    case 'ARROW':
      return <path {...common} d={`M${at(0, 0)} L${at(-size.length, half)} L${at(-size.length, -half)} Z`} {...paint} />
    case 'CONCAVE_ARROW':
      return <path {...common} d={`M${at(0, 0)} L${at(-size.length, half)} L${at(-size.length * 0.65, 0)} L${at(-size.length, -half)} Z`} {...paint} />
    case 'SPEAR':
      return <path {...common} d={`M${at(-size.length, half)} L${at(0, 0)} L${at(-size.length, -half)}`} fill="none" stroke={color} strokeWidth={Math.max(strokeWidth, MIN_STROKE)} />
    case 'EMPTY_DIAMOND':
    case 'FILLED_DIAMOND':
      return <path {...common} d={`M${at(size.length / 2, 0)} L${at(0, half)} L${at(-size.length / 2, 0)} L${at(0, -half)} Z`} {...paint} />
    case 'EMPTY_CIRCLE':
    case 'FILLED_CIRCLE':
      return <ellipse {...common} cx={format(tip.x)} cy={format(tip.y)} rx={format(size.length / 2)} ry={format(half)} transform={`rotate(${format(Math.atan2(dy, dx) * 180 / Math.PI)} ${format(tip.x)} ${format(tip.y)})`} {...paint} />
    case 'EMPTY_BOX':
    case 'FILLED_BOX':
      return <path {...common} d={`M${at(size.length / 2, half)} L${at(size.length / 2, -half)} L${at(-size.length / 2, -half)} L${at(-size.length / 2, half)} Z`} {...paint} />
    default:
      return null
  }
}

/** 열린 선의 시작(`headStyle`)·끝(`tailStyle`) 화살표. */
function arrowHeads(stroke: ViewerShapeStroke | undefined, start?: [Point, Point], end?: [Point, Point]): ReactNode[] {
  if (!stroke) return []
  const width = strokeWidthOf(stroke)
  const heads: ReactNode[] = []
  if (stroke.headStyle && start) heads.push(<g key="head" data-arrow-end="head">{arrowHead(stroke.headStyle, start[0], start[1], arrowSize(stroke.headSize, width), stroke.color, width, stroke.headFill !== false)}</g>)
  if (stroke.tailStyle && end) heads.push(<g key="tail" data-arrow-end="tail">{arrowHead(stroke.tailStyle, end[0], end[1], arrowSize(stroke.tailSize, width), stroke.color, width, stroke.tailFill !== false)}</g>)
  return heads
}

/** 도형 하나(최상위 도형)의 SVG 요소. 사각형·타원은 기본 요소로, 나머지는 path로 그린다. */
function figure(element: string, shape: ViewerShapeStyle, width: number, height: number, paint: Record<string, unknown>): ReactNode {
  if (element === 'hp:ellipse') return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...paint} />
  if (element === 'hp:line') {
    return <line x1={shape.points?.[0]?.x ?? 0} y1={shape.points?.[0]?.y ?? 0} x2={shape.points?.[1]?.x ?? width} y2={shape.points?.[1]?.y ?? 0} {...paint} fill="none" />
  }
  if (element === 'hp:polygon' && shape.points?.length) return <polygon points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')} {...paint} />
  if (shape.path) return <path d={shape.path} {...paint} fill={shape.closed ? paint.fill as string : 'none'} />
  return <rect x={0} y={0} width={width} height={height} {...paint} />
}

/** SVG id에 쓸 수 있는 글자만 남긴다(React `useId`는 쌍점을 쓴다). */
const svgId = (value: string) => `hf${value.replace(/[^A-Za-z0-9_-]/gu, '')}`

/**
 * 도형을 원본 선·채우기로 그린다. `width`·`height`는 그리는 상자(HWPUNIT)다. 굵은 선·화살표가 잘리지 않게 SVG 상자를 넓히고
 * `overflow: visible`로 둔다. 선 굵기는 화면에서 보이도록 0.5pt 이상이다.
 */
export function ShapeView({ item, width: boxWidth, height: boxHeight, style: extraStyle }: {
  item: ViewerObjectPlaceholder
  width?: number
  height?: number
  style?: CSSProperties
}) {
  const baseId = svgId(useId())
  const width = Math.max(boxWidth ?? item.position?.width ?? item.size?.width ?? 1, 1)
  const height = Math.max(boxHeight ?? item.position?.height ?? item.size?.height ?? 1, 1)
  const shape = item.shape ?? {}
  const parts = item.element === 'hp:container' ? shape.parts ?? [] : undefined
  const widest = parts
    ? parts.reduce((max, part) => Math.max(max, strokeWidthOf(part.stroke)), 0)
    : strokeWidthOf(shape.stroke)
  // 굵은 선·높이 0인 가로선도 잘리지 않게 SVG 상자를 선 굵기 절반만큼 넓히고 그만큼 왼쪽 위로 옮긴다.
  const pad = widest / 2
  const defs: ReactNode[] = []
  let body: ReactNode
  if (parts) {
    body = parts.map((part, index) => {
      const paint = paintOf(part.closed ? part.fill : undefined, `${baseId}p${index}`)
      if (paint.defs) defs.push(<g key={`d${index}`}>{paint.defs}</g>)
      return <g key={index} data-shape-part={part.element}>
        <path d={part.path} fill={paint.fill} fillOpacity={paint.fillOpacity} {...strokeProps(part.stroke)} />
        {!part.closed && arrowHeads(part.stroke, part.start, part.end)}
      </g>
    })
  } else {
    const paint = paintOf(shape.fillPaint, `${baseId}f`)
    if (paint.defs) defs.push(<g key="d">{paint.defs}</g>)
    const open = item.element === 'hp:line' || ((item.element === 'hp:arc' || item.element === 'hp:curve' || item.element === 'hp:connectLine') && !shape.closed)
    const lineEnds = item.element === 'hp:line' && shape.points?.length === 2
      ? { start: [shape.points[0], shape.points[1]] as [Point, Point], end: [shape.points[1], shape.points[0]] as [Point, Point] }
      : { start: shape.start, end: shape.end }
    body = <>
      {figure(item.element, shape, width, height, { fill: paint.fill, fillOpacity: paint.fillOpacity, ...strokeProps(shape.stroke) })}
      {open && arrowHeads(shape.stroke, lineEnds.start, lineEnds.end)}
    </>
  }
  return <svg
    className="viewer-shape"
    data-object-kind={item.kind === 'text-box' ? undefined : item.kind}
    data-object-element={item.element}
    data-source-path={item.kind === 'text-box' ? undefined : item.sourcePath}
    data-shape-element={item.element}
    role="img"
    aria-label={item.label}
    width={hwpUnitToCssPx(width + pad * 2)}
    height={hwpUnitToCssPx(height + pad * 2)}
    viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
    style={{ ...(pad ? { marginLeft: -hwpUnitToCssPx(pad), marginTop: -hwpUnitToCssPx(pad) } : {}), ...extraStyle }}
    overflow="visible"
  >{defs.length ? <defs>{defs}</defs> : null}{body}</svg>
}

/** 그림 효과(`ViewerImage.filter`)를 CSS filter·불투명도로. */
export function pictureFilterCss(filter: ViewerImage['filter']): CSSProperties | undefined {
  if (!filter) return undefined
  const parts = [
    filter.effect === 'GRAY_SCALE' || filter.effect === 'BLACK_WHITE' ? 'grayscale(1)' : '',
    // 흑백은 회색조에 대비를 크게 올려 근사한다.
    filter.effect === 'BLACK_WHITE' ? 'contrast(4)' : '',
    filter.brightness ? `brightness(${Math.round((1 + filter.brightness / 100) * 1000) / 1000})` : '',
    filter.contrast ? `contrast(${Math.round((1 + filter.contrast / 100) * 1000) / 1000})` : ''
  ].filter(Boolean)
  const css: CSSProperties = {}
  if (parts.length) css.filter = parts.join(' ')
  if (filter.opacity !== undefined) css.opacity = filter.opacity
  return Object.keys(css).length ? css : undefined
}

/**
 * 자른 그림(`ViewerImage.crop`). 개체 상자 안 그림 자리(`frame`)를 넘치는 부분을 숨긴 상자에, 원본 가운데 보이는 부분(`source`)이 그
 * 자리를 채우도록 그림 전체를 늘여 옮겨 둔다. 상자 크기는 감싼 요소(100%)를 따른다.
 */
export function CroppedPicture({ src, crop, style, className, imageStyle, attributes }: {
  src: string
  crop: NonNullable<ViewerImage['crop']>
  style?: CSSProperties
  className?: string
  imageStyle?: CSSProperties
  /** E2E용 `data-*` 속성. */
  attributes?: Record<string, string | undefined>
}) {
  const { frame, source } = crop
  const percent = (value: number) => `${Math.round(value * 100000) / 1000}%`
  return <span className={`viewer-image-crop${className ? ` ${className}` : ''}`} data-image-crop={`${source.left} ${source.top} ${source.width} ${source.height}`} {...attributes} style={style}>
    <span className="viewer-image-crop-frame" style={{ left: percent(frame.left), top: percent(frame.top), width: percent(frame.width), height: percent(frame.height) }}>
      <img
        className="viewer-image-cropped"
        src={src}
        style={{
          left: percent(-source.left / source.width),
          top: percent(-source.top / source.height),
          width: percent(1 / source.width),
          height: percent(1 / source.height),
          ...imageStyle
        }}
      />
    </span>
  </span>
}

/** 그림 테두리(`ViewerImage.border`)를 상자 안쪽 테두리로. */
export function pictureBorderCss(border: ViewerShapeStroke | undefined): CSSProperties | undefined {
  if (!border) return undefined
  const width = Math.max(hwpUnitToCssPx(border.width), 0.75)
  const style = border.style === 'DOT' || border.style === 'CIRCLE' ? 'dotted' : strokeDashArray(border.style, border.width) ? 'dashed' : 'solid'
  return { boxShadow: `inset 0 0 0 ${width}px ${border.color}`, ...(style !== 'solid' ? { outline: `${width}px ${style} ${border.color}`, outlineOffset: -width, boxShadow: undefined } : {}) }
}
