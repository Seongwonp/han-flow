import { createElement, CSSProperties, ReactNode, useLayoutEffect, useRef } from 'react'
import { MATH_ATTRIBUTES, MATH_TAGS, MathNode } from '../../core/document/equation_script'
import type { ViewerObjectPlaceholder } from '../../core/document/viewer_document'
import { hwpUnitToCssPx } from '../../core/layout/hwp_unit'

const ALLOWED_TAGS = new Set<string>(MATH_TAGS)
const ALLOWED_ATTRIBUTES = new Set<string>(MATH_ATTRIBUTES)
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

/** decoder가 만든 MathML 나무를 React element로. 알려진 tag·속성만 그린다. */
export function renderMathNode(node: MathNode, key?: number): ReactNode {
  if (typeof node === 'string') return node
  if (!ALLOWED_TAGS.has(node.tag)) return null
  const props: Record<string, unknown> = { key, ...(node.tag === 'math' ? { className: 'viewer-equation-math' } : {}) }
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (!ALLOWED_ATTRIBUTES.has(name)) continue
    if (name === 'class') props.className = value
    else if (name === 'data-eq-color') {
      if (COLOR_PATTERN.test(value)) props.style = { color: value }
    } else props[name] = value
  }
  return createElement(node.tag, props, ...node.children.map((child, index) => renderMathNode(child, index)))
}

/** 늘인 괄호·근호의 최대 배율. */
const MAX_STRETCH = 12
/** 선언 상자에 맞추는 배율 범위. */
const MIN_FIT_SCALE = 0.2
const MAX_FIT_SCALE = 1.5

interface Rect { top: number; bottom: number; left: number; right: number }

function unionRect(elements: Element[]): Rect | undefined {
  let result: Rect | undefined
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0 && rect.width <= 0) continue
    result = result
      ? { top: Math.min(result.top, rect.top), bottom: Math.max(result.bottom, rect.bottom), left: Math.min(result.left, rect.left), right: Math.max(result.right, rect.right) }
      : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
  }
  return result
}

/** 늘일 괄호(`fence`)는 같은 묶음의 다른 내용, 근호(`radical`)는 근호 안 내용 높이에 맞춘다. */
function stretchTarget(element: Element): Rect | undefined {
  if (element.getAttribute('data-eq-stretch') === 'radical') {
    const radicand = element.closest('.eq-radical')?.querySelector(':scope > .eq-radicand')
    return radicand ? unionRect([radicand]) : undefined
  }
  const parent = element.parentElement
  return parent ? unionRect(Array.from(parent.children).filter((child) => !child.hasAttribute('data-eq-stretch'))) : undefined
}

/**
 * 수식 배치: (1) 늘일 괄호·근호를 옆 내용 높이에 맞춰 CSS transform으로 늘이고(글꼴 MATH 표 없이도 같은 모양, 글자는 그대로라 PDF
 * 글자 수가 화면과 같다) (2) 선언 상자가 있으면 수식 전체를 상자에 맞춰 줄이거나 늘이고, 기준선(`baseLine`)이 상자의 같은 높이에
 * 오도록 놓는다(넘치면 상자 안으로 당긴다). 측정값은 상위 확대·축소(transform)를 나눠 상자 기준 CSS px로 쓴다.
 */
function layoutEquation(box: HTMLElement, position: HTMLElement, scaler: HTMLElement, probe: HTMLElement, baseLine: number, fit: boolean): void {
  position.style.left = '0px'
  position.style.top = '0px'
  scaler.style.removeProperty('zoom')
  delete box.dataset.equationScale
  const stretchers = Array.from(scaler.querySelectorAll<HTMLElement>('[data-eq-stretch]'))
  for (const element of stretchers) element.style.removeProperty('transform')
  const boxRect = box.getBoundingClientRect()
  const unit = box.offsetWidth > 0 && boxRect.width > 0 ? boxRect.width / box.offsetWidth : 1
  const plans: Array<[HTMLElement, string]> = []
  for (const element of stretchers) {
    const target = stretchTarget(element)
    const own = element.getBoundingClientRect()
    if (!target || own.height <= 0) continue
    const scale = Math.min((target.bottom - target.top) / own.height, MAX_STRETCH)
    if (scale <= 1.05) continue
    const shift = ((target.top + target.bottom) / 2 - (own.top + own.bottom) / 2) / unit
    plans.push([element, `translateY(${shift.toFixed(2)}px) scaleY(${scale.toFixed(3)})`])
  }
  for (const [element, transform] of plans) element.style.transform = transform
  if (!fit) return
  const math = scaler.firstElementChild
  if (!math) return
  const boxWidth = box.clientWidth
  const boxHeight = box.clientHeight
  // 상자 기준 CSS px로 잰 수식 크기·위치와 기준선 높이.
  const measure = () => {
    const rect = math.getBoundingClientRect()
    return {
      width: rect.width / unit,
      height: rect.height / unit,
      left: (rect.left - boxRect.left) / unit,
      top: (rect.top - boxRect.top) / unit,
      ascent: (probe.getBoundingClientRect().top - rect.top) / unit
    }
  }
  let size = measure()
  if (size.width <= 0 || size.height <= 0 || boxWidth <= 0 || boxHeight <= 0) return
  const clampScale = (value: number) => Math.min(Math.max(value, MIN_FIT_SCALE), MAX_FIT_SCALE)
  let scale = clampScale(Math.min(boxWidth / size.width, boxHeight / size.height))
  const applyScale = () => {
    if (Math.abs(scale - 1) > 0.01) {
      scaler.style.setProperty('zoom', scale.toFixed(4))
      box.dataset.equationScale = scale.toFixed(3)
    } else {
      scaler.style.removeProperty('zoom')
      delete box.dataset.equationScale
      scale = 1
    }
    size = measure()
  }
  applyScale()
  // 글자 glyph 크기는 배율에 꼭 비례하지 않으므로, 줄인 뒤에도 상자를 넘으면 한 번 더 줄인다.
  const overflow = Math.max(size.width / boxWidth, size.height / boxHeight)
  if (overflow > 1.001 && scale > MIN_FIT_SCALE) {
    scale = clampScale(scale / overflow * 0.995)
    applyScale()
  }
  const left = (boxWidth - size.width) / 2
  const wantedTop = boxHeight * baseLine / 100 - size.ascent
  const top = size.height <= boxHeight ? Math.min(Math.max(wantedTop, 0), boxHeight - size.height) : (boxHeight - size.height) / 2
  position.style.left = `${(left - size.left).toFixed(2)}px`
  position.style.top = `${(top - size.top).toFixed(2)}px`
}

/** 기준선 기본값(한/글 수식 상자에서 흔한 값). */
const DEFAULT_BASELINE = 85

/**
 * 해석한 수식(`item.equation`)을 MathML로 그린다. 상자는 선언 크기(`hp:sz`)이고 글자 크기는 `baseUnit`, 색은 `textColor`이다.
 * 글자처럼 취급한 수식은 상자 아래쪽 `100 - baseLine`% 만큼을 본문 기준선 아래에 둔다. 원본 script는 접근성 이름에 남긴다.
 */
export function EquationView({ item, positioned, common }: {
  item: ViewerObjectPlaceholder
  positioned: boolean
  common: Record<string, unknown>
}) {
  const equation = item.equation!
  const boxRef = useRef<HTMLSpanElement>(null)
  const positionRef = useRef<HTMLSpanElement>(null)
  const scalerRef = useRef<HTMLSpanElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const baseLine = equation.baseLine ?? DEFAULT_BASELINE
  const reserve = Boolean(item.size) && (item.flow === 'inline' || item.flow === 'block')
  const fit = positioned || reserve
  useLayoutEffect(() => {
    const run = () => {
      if (boxRef.current && positionRef.current && scalerRef.current && probeRef.current) {
        layoutEquation(boxRef.current, positionRef.current, scalerRef.current, probeRef.current, baseLine, fit)
      }
    }
    run()
    // 글꼴이 늦게 들어오면 크기가 바뀌므로 다시 맞춘다.
    let active = true
    void globalThis.document?.fonts?.ready.then(() => { if (active) run() })
    return () => { active = false }
  }, [equation, baseLine, fit, item.size?.width, item.size?.height])
  const width = item.size ? hwpUnitToCssPx(item.size.width) : 0
  const height = item.size ? hwpUnitToCssPx(item.size.height) : 0
  const style: CSSProperties = {
    color: equation.color ?? '#000000',
    fontSize: `${(equation.baseUnit ?? 1000) / 100}pt`,
    ...(positioned
      ? { width: '100%', height: '100%' }
      : reserve
      ? { width, height, verticalAlign: item.flow === 'inline' ? `${(-height * (100 - baseLine) / 100).toFixed(2)}px` : undefined }
      : {})
  }
  const script = item.fallbackText ?? ''
  return <span
    {...common}
    ref={boxRef}
    className={`viewer-equation viewer-object-${positioned ? 'block' : item.flow}${fit ? ' viewer-equation-fit' : ''}`}
    data-equation-rendered="true"
    data-object-fitted={item.fitted ? item.fitted.scale.toFixed(3) : undefined}
    role="math"
    aria-label={`수식: ${script}`}
    title={`수식: ${script}${item.fitted ? ' (원본 높이가 쪽보다 커서 줄여 표시합니다.)' : ''}`}
    style={style}
  >
    <span ref={positionRef} className="viewer-equation-position">
      <span ref={scalerRef} className="viewer-equation-scale">
        {renderMathNode(equation.math)}
        <span ref={probeRef} className="viewer-equation-probe" aria-hidden="true" />
      </span>
    </span>
  </span>
}
