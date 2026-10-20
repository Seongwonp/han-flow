import { ViewerBorder, ViewerCellStyle, ViewerCharStyle, ViewerColumnLayout, ViewerContent, ViewerDiagnostic, ViewerDocument, DEFAULT_FOOTNOTE_SETTINGS, ViewerEquation, ViewerFootnoteSettings, ViewerHeaderFooter, ViewerImage, ViewerNote, ViewerObjectFlow, ViewerObjectKind, ViewerObjectPlaceholder, ViewerObjectPosition, ViewerShapeStyle, ViewerTextWrap, ViewerPageNumber, ViewerParagraph, ViewerParaStyle, ViewerSection, ViewerTable, ViewerTableCell } from '../document/viewer_document'
import { footnoteMarker } from '../document/note_number'
import { parseEquationScript } from '../document/equation_script'
import { countIncompleteObjectPlaceholders, OBJECT_KIND_LABELS, OBJECT_KIND_ORDER, OBJECT_PAGE_HEIGHT_RATIO } from '../document/object_placeholder'
import {
  ParagraphMetricAncestor,
  ParagraphMetricCandidate,
  paragraphMetricUnit,
  preferredParagraphMetric,
  requiredNamespaceOf,
  storedToHwpUnitScale
} from '../document/paragraph_margin_units'
import { contentOutOfFlow } from '../layout/object_position'
import { isRenderedStrikeShape } from './line_shape'
import { OrderedXmlNode, walkOrderedXml } from './ordered_xml'
import {
  EMPTY_PARAGRAPH_BLOCKING_CONTROLS,
  EMPTY_PARAGRAPH_RUN_CONTROLS,
  emptyParagraphAnchorId,
  tableCaretAnchorId
} from '../editing/empty_paragraph_anchor'
import { ParagraphStructureAccess, paragraphStructureViolation } from '../editing/paragraph_structure'
import { TableCaretAccess, tableCaretTarget } from '../editing/table_caret'
import { HwpxPackageIndex, HwpxReadablePackage } from './package_reader'
import { ImageResourceBudget } from './resource_budget'

const num = (value?: string): number => Number(value ?? 0)
const children = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => node.children.filter((child) => child.name === name)
const child = (node: OrderedXmlNode, name: string): OrderedXmlNode | undefined => children(node, name)[0]
const descendants = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => walkOrderedXml(node.children).filter((item) => item.name === name)

/**
 * 문단 모양 안 `name` node 후보와 각 node의 단위(자기 조상 경로 기준). 단위 규칙은 `paragraph_margin_units.ts`에 있고
 * 편집 쓰기(`style_patch.ts`)도 같은 규칙을 쓴다. paraPr 안 `hp:switch`가 여러 개(목록 heading용·여백용)여도 모두 본다.
 */
function paragraphMetricCandidates(paraPr: OrderedXmlNode, name: string): ParagraphMetricCandidate<OrderedXmlNode>[] {
  const candidates: ParagraphMetricCandidate<OrderedXmlNode>[] = []
  const visit = (node: OrderedXmlNode, ancestors: ParagraphMetricAncestor[]): void => {
    for (const item of node.children) {
      if (item.name === name) candidates.push({ node: item, unit: paragraphMetricUnit(ancestors) })
      else if (item.children.length) {
        visit(item, [...ancestors, { name: item.name, requiredNamespace: requiredNamespaceOf(item.attributes) }])
      }
    }
  }
  visit(paraPr, [])
  return candidates
}

/** viewer가 읽는 문단 모양 node(HwpUnitChar case 우선)와 저장 값 → HWPUNIT 배율. */
export function paragraphMetricNode(paraPr: OrderedXmlNode, name: string): { node: OrderedXmlNode; scale: number } | undefined {
  const preferred = preferredParagraphMetric(paragraphMetricCandidates(paraPr, name))
  const scale = preferred ? storedToHwpUnitScale(preferred.unit) : undefined
  return preferred && scale !== undefined ? { node: preferred.node, scale } : undefined
}
const textOf = (node: OrderedXmlNode | undefined): string => !node ? '' : walkOrderedXml(node.children).filter((item) => item.name === '#text').map((item) => item.text ?? '').join('')
const inlineTextOf = (node: OrderedXmlNode): string => node.children.map((item) => {
  if (item.name === '#text') return item.text ?? ''
  if (item.name === 'hp:lineBreak') return '\n'
  if (item.name === 'hp:tab') return '\t'
  return textOf(item)
}).join('')
const isEditableInlineText = (node: OrderedXmlNode): boolean => node.children.every(
  (item) => item.name === '#text' || item.name === 'hp:lineBreak' || item.name === 'hp:tab'
)
const box = (node?: OrderedXmlNode) => ({ top: num(node?.attributes.top), right: num(node?.attributes.right), bottom: num(node?.attributes.bottom), left: num(node?.attributes.left) })

export interface ViewerDecodeOptions {
  sectionPaths?: string[]
  resourcePaths?: string[]
}

/** 문단 style id → 글자 모양 id(`hh:style`의 `charPrIDRef`). run이 없는 빈 문단의 첫 글자 모양에 쓴다. */
export type ParagraphStyleCharacterIds = Readonly<Record<string, string>>

const isWhitespaceNode = (node: OrderedXmlNode): boolean => node.name === '#text' && /^[ \t\r\n]*$/.test(node.text ?? '')

/**
 * `hp:t`가 없는 빈 문단의 합성 caret 글자 모양. 빈 문단이 아니면 undefined.
 * 편집 코어(`text_patch.ts`의 `emptyParagraphTarget`)와 같은 규칙이다: 문단 자식은 `hp:run`·`hp:linesegarray`·공백,
 * run 자식은 `hp:secPr`·`hp:ctrl`(필드 시작·끝 제외)·공백뿐이어야 하고, 글자는 자식 element가 없는 마지막 run 또는 마지막
 * run에 들어간다. run이 없으면 문단 style의 `charPrIDRef`를 쓰고, style이 없으면 빈 문단으로 보지 않는다.
 */
export function emptyParagraphCaret(
  node: OrderedXmlNode,
  styleCharacterIds: ParagraphStyleCharacterIds
): { charStyleId: string } | undefined {
  if (node.name !== 'hp:p') return undefined
  if (!node.children.every((item) => item.name === 'hp:run' || item.name === 'hp:linesegarray' || isWhitespaceNode(item))) {
    return undefined
  }
  const runs = children(node, 'hp:run')
  const controlsOnly = runs.every((run) => run.children.every((item) =>
    isWhitespaceNode(item) ||
    (EMPTY_PARAGRAPH_RUN_CONTROLS.has(item.name) &&
      !(item.name === 'hp:ctrl' && walkOrderedXml(item.children).some((nested) => EMPTY_PARAGRAPH_BLOCKING_CONTROLS.has(nested.name))))
  ))
  if (!controlsOnly) return undefined
  if (runs.length) {
    const plain = runs.filter((run) => run.children.every((item) => item.name === '#text'))
    const run = plain[plain.length - 1] ?? runs[runs.length - 1]
    return { charStyleId: run.attributes.charPrIDRef ?? '0' }
  }
  const charStyleId = styleCharacterIds[node.attributes.styleIDRef ?? '0']
  return charStyleId === undefined ? undefined : { charStyleId }
}

/**
 * 한 section을 해석하는 동안 공유하는 상태.
 * - `sectionPath`: 편집 anchor를 붙일 section. 개체가 든 글상자·메모 본문, 필드 subList처럼 읽기 전용으로 되살리는 문단은
 *   undefined다. 각주·미주 본문, 머리말·꼬리말 문단, 글자만 든 글상자·메모 본문은 anchor를 붙인다(편집 노출 여부는 capability가 정한다).
 * - `sourceSection`: 자리 표시 `sourcePath`에 쓰는 section 경로(읽기 전용 문단에서도 유지한다).
 */
interface DecodeContext {
  sectionPath: string | undefined
  sourceSection: string | undefined
  styleCharacterIds: ParagraphStyleCharacterIds
  objectOrdinals: Map<OrderedXmlNode, number>
  notes: ViewerNote[]
  /** 구역의 각주 모양. 구역마다 새로 매기는 번호(`ON_SECTION`)는 decoder가 센다. */
  footnoteSettings?: ViewerFootnoteSettings
  /** 자리 표시 선언 높이 한도(HWPUNIT, 쪽 본문 높이의 일정 비율). 없으면 줄이지 않는다. */
  objectHeightLimit?: number
}

/** 선언 높이가 한도를 넘으면 너비·높이를 같은 비율로 줄인다. */
function fitObjectSize(
  size: { width: number; height: number } | undefined,
  limit: number | undefined
): { size?: { width: number; height: number }; fitted?: ViewerObjectPlaceholder['fitted'] } {
  if (!size || !limit || !(limit > 0) || size.height <= limit) return { size }
  const scale = limit / size.height
  return { size: { width: Math.round(size.width * scale), height: Math.round(limit) }, fitted: { declared: size, scale } }
}

const SHAPE_ELEMENTS = new Set([
  'hp:rect', 'hp:ellipse', 'hp:arc', 'hp:polygon', 'hp:curve', 'hp:line', 'hp:connectLine', 'hp:container', 'hp:textart'
])
const FORM_ELEMENTS = new Set([
  'hp:btn', 'hp:radioBtn', 'hp:checkBtn', 'hp:comboBox', 'hp:edit', 'hp:listBox', 'hp:scrollBar'
])
const OBJECT_ELEMENTS = new Set([
  ...SHAPE_ELEMENTS, ...FORM_ELEMENTS,
  'hp:equation', 'hp:chart', 'hp:ole', 'hp:video', 'hp:dutmal', 'hp:compose', 'hp:footNote', 'hp:endNote', 'hp:fieldBegin'
])
/**
 * run 바로 아래에서 decoder가 직접 다루거나(글자·표·그림, 머리말·꼬리말·쪽 번호는 section 단위로 따로 읽는다) 화면에 그릴
 * 것이 없는(구역·단 정의, 책갈피, 줄 배치 캐시) element. 보통 `hp:ctrl` 안에 있지만 run에 바로 두는 생성기도 있다.
 */
const HANDLED_RUN_CHILDREN = new Set([
  '#text', 'hp:t', 'hp:tbl', 'hp:pic', 'hp:tab', 'hp:lineBreak', 'hp:secPr', 'hp:ctrl', 'hp:switch', 'hp:linesegarray',
  'hp:header', 'hp:footer', 'hp:colPr', 'hp:pageNum', 'hp:pageNumCtrl', 'hp:pageHiding', 'hp:newNum', 'hp:autoNum',
  'hp:bookmark', 'hp:indexmark', 'hp:hiddenComment', 'hp:fieldEnd'
])

/** section 안 개체 element의 문서 순서 번호(같은 이름끼리 0부터). 자리 표시 `sourcePath`에 쓴다. */
function objectOrdinals(nodes: OrderedXmlNode[]): Map<OrderedXmlNode, number> {
  const counters = new Map<string, number>()
  const ordinals = new Map<OrderedXmlNode, number>()
  const visit = (node: OrderedXmlNode, parentName: string | undefined): void => {
    // 개체 element와, run 바로 아래의 모르는 `hp:*` element(알 수 없는 개체 자리 표시)에 번호를 붙인다.
    if (OBJECT_ELEMENTS.has(node.name) || (parentName === 'hp:run' && node.name.startsWith('hp:') && !HANDLED_RUN_CHILDREN.has(node.name))) {
      const next = counters.get(node.name) ?? 0
      counters.set(node.name, next + 1)
      ordinals.set(node, next)
    }
    for (const item of node.children) visit(item, node.name)
  }
  for (const node of nodes) visit(node, undefined)
  return ordinals
}

function objectSourcePath(node: OrderedXmlNode, context: DecodeContext): string {
  return `${context.sourceSection ?? ''}#${node.name}:${context.objectOrdinals.get(node) ?? 0}`
}

function declaredSize(node: OrderedXmlNode): { width: number; height: number } | undefined {
  const read = (item?: OrderedXmlNode) => item ? { width: num(item.attributes.width), height: num(item.attributes.height) } : undefined
  const current = read(child(node, 'hp:curSz'))
  const declared = read(child(node, 'hp:sz'))
  const original = read(child(node, 'hp:orgSz'))
  const positive = (size?: { width: number; height: number }) =>
    size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0 ? size : undefined
  const fallback = [declared, current, original].find((size) => size && Number.isFinite(size.width) && Number.isFinite(size.height) && (size.width > 0 || size.height > 0))
  return positive(current) ?? positive(declared) ?? positive(original) ?? fallback
}

const TEXT_WRAPS = new Set<ViewerTextWrap>(['SQUARE', 'TIGHT', 'THROUGH', 'TOP_AND_BOTTOM', 'BEHIND_TEXT', 'IN_FRONT_OF_TEXT'])
const VERT_REL = new Set(['PAPER', 'PAGE', 'PARA'])
const HORZ_REL = new Set(['PAPER', 'PAGE', 'COLUMN', 'PARA'])
const VERT_ALIGN = new Set(['TOP', 'CENTER', 'BOTTOM', 'INSIDE', 'OUTSIDE'])
const HORZ_ALIGN = new Set(['LEFT', 'CENTER', 'RIGHT', 'INSIDE', 'OUTSIDE'])

/** 위치 offset. 한/글은 음수를 32비트 부호 없는 수(예: 4294964867 = -2429)로 저장한다. */
export function signedHwpUnit(value?: string): number {
  const parsed = num(value)
  if (!Number.isFinite(parsed)) return 0
  return parsed >= 2 ** 31 && parsed < 2 ** 32 ? parsed - 2 ** 32 : parsed
}

/**
 * 글자처럼 취급하지 않는 개체(`hp:pos treatAsChar="0"`)의 원본 위치. 글자처럼 취급하거나 `hp:pos`·크기가 없으면 undefined다.
 * 모르는 기준·맞춤 값은 한/글 기본값(문단·위·왼쪽)으로, 모르는 배치는 자리 차지(`TOP_AND_BOTTOM`)로 읽는다.
 *
 * 크기는 한/글이 쪽 배치에 쓰는 개체 크기(`hp:sz`)를 먼저 쓰고, 없으면 `fallback`(그림·도형의 현재 크기)을 쓴다. 도형의 현재
 * 크기(`hp:curSz`)는 글상자 안 글에 맞춰 `hp:sz`보다 클 수 있는데, 한/글은 `hp:sz`로 본문 자리를 잡는다. 높이가 `limit`(쪽 본문
 * 높이의 일정 비율)을 넘으면 같은 비율로 줄인다.
 */
function objectPosition(
  node: OrderedXmlNode,
  fallback: { width: number; height: number } | undefined,
  limit?: number
): ViewerObjectPosition | undefined {
  const pos = child(node, 'hp:pos')
  if (!pos || pos.attributes.treatAsChar === '1') return undefined
  const declared = child(node, 'hp:sz')
  const layoutSize = declared && num(declared.attributes.width) > 0 && num(declared.attributes.height) > 0
    ? { width: num(declared.attributes.width), height: num(declared.attributes.height) }
    : fallback
  const size = fitObjectSize(layoutSize, limit).size
  if (!size) return undefined
  const width = Number.isFinite(size.width) ? Math.max(size.width, 0) : 0
  const height = Number.isFinite(size.height) ? Math.max(size.height, 0) : 0
  if (!(width > 0 || height > 0)) return undefined
  const attribute = (name: string, allowed: Set<string>, fallback: string) =>
    allowed.has(pos.attributes[name] ?? '') ? pos.attributes[name]! : fallback
  const wrap = node.attributes.textWrap as ViewerTextWrap | undefined
  return {
    wrap: wrap && TEXT_WRAPS.has(wrap) ? wrap : 'TOP_AND_BOTTOM',
    textFlow: node.attributes.textFlow ?? 'BOTH_SIDES',
    vertRelTo: attribute('vertRelTo', VERT_REL, 'PARA') as ViewerObjectPosition['vertRelTo'],
    horzRelTo: attribute('horzRelTo', HORZ_REL, 'PARA') as ViewerObjectPosition['horzRelTo'],
    vertAlign: attribute('vertAlign', VERT_ALIGN, 'TOP') as ViewerObjectPosition['vertAlign'],
    horzAlign: attribute('horzAlign', HORZ_ALIGN, 'LEFT') as ViewerObjectPosition['horzAlign'],
    vertOffset: signedHwpUnit(pos.attributes.vertOffset),
    horzOffset: signedHwpUnit(pos.attributes.horzOffset),
    flowWithText: pos.attributes.flowWithText === '1',
    allowOverlap: pos.attributes.allowOverlap === '1',
    zOrder: Number.isFinite(num(node.attributes.zOrder)) ? num(node.attributes.zOrder) : 0,
    width,
    height,
    outMargin: box(child(node, 'hp:outMargin'))
  }
}

const SHAPE_STROKE_NONE = new Set(['NONE', ''])

/** 도형·글상자의 선·채우기·꼭짓점(`hp:lineShape`·`hc:fillBrush`·`hc:startPt`/`hc:endPt`·`hc:pt`). 그릴 것이 없으면 undefined. */
function shapeStyle(node: OrderedXmlNode, size: { width: number; height: number } | undefined): ViewerShapeStyle | undefined {
  const style: ViewerShapeStyle = {}
  const line = child(node, 'hp:lineShape')
  const color = line?.attributes.color ?? ''
  const strokeWidth = num(line?.attributes.width)
  if (line && !SHAPE_STROKE_NONE.has(line.attributes.style ?? '') && /^#[0-9a-f]{6}$/iu.test(color) && strokeWidth > 0) {
    style.stroke = { color, width: strokeWidth, style: line.attributes.style ?? 'SOLID' }
  }
  const brush = child(node, 'hc:fillBrush')
  const winBrush = brush ? child(brush, 'hc:winBrush') : undefined
  const face = winBrush?.attributes.faceColor ?? ''
  // alpha는 투명도(0 불투명 ~ 255 투명)다.
  if (/^#[0-9a-f]{6}$/iu.test(face) && num(winBrush?.attributes.alpha) < 255) style.fill = face
  const original = child(node, 'hp:orgSz')
  const scaleX = size && num(original?.attributes.width) > 0 ? size.width / num(original!.attributes.width) : 1
  const scaleY = size && num(original?.attributes.height) > 0 ? size.height / num(original!.attributes.height) : 1
  const point = (item: OrderedXmlNode) => ({ x: num(item.attributes.x) * scaleX, y: num(item.attributes.y) * scaleY })
  if (node.name === 'hp:line') {
    const start = child(node, 'hc:startPt')
    const end = child(node, 'hc:endPt')
    if (start && end) style.points = [point(start), point(end)]
  } else if (node.name === 'hp:polygon') {
    const points = children(node, 'hc:pt').map(point)
    if (points.length >= 2) style.points = points
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

function objectFlow(node: OrderedXmlNode): ViewerObjectFlow {
  if (child(node, 'hp:pos')?.attributes.treatAsChar === '1') return 'inline'
  const wrap = node.attributes.textWrap
  return wrap === 'IN_FRONT_OF_TEXT' || wrap === 'BEHIND_TEXT' ? 'floating' : 'block'
}

const readOnly = (context: DecodeContext): DecodeContext => ({ ...context, sectionPath: undefined })

/** 글자만 든 subList가 가질 수 있는 element. */
const PLAIN_SUBLIST_ELEMENTS = new Set(['hp:p', 'hp:run', 'hp:t', 'hp:lineBreak', 'hp:tab', 'hp:linesegarray', 'hp:lineseg'])

/**
 * 글상자 글·메모 본문 subList가 글자만 든 문단으로 되어 있는지. 표·그림·도형·수식·각주·필드·제어 같은 개체가 하나라도 있으면
 * 글상자(메모) 전체를 읽기 전용으로 둔다(편집 anchor를 붙이지 않는다). 편집 코어는 같은 `hp:t` 순번 anchor로 글자를 고친다.
 */
export function isPlainTextSubList(subList: OrderedXmlNode | undefined): boolean {
  return Boolean(subList) && walkOrderedXml(subList!.children).every((node) => node.name === '#text' || PLAIN_SUBLIST_ELEMENTS.has(node.name))
}

/**
 * subList 문단. `editable`이 아니면 source anchor 없이 읽기 전용으로 해석한다. 각주·미주와 글자만 든 글상자·메모 본문은
 * 편집 anchor를 붙인다(읽기 전용 문단 안의 subList는 바깥 context가 이미 읽기 전용이라 계속 읽기 전용이다).
 */
function subListParagraphs(
  subList: OrderedXmlNode | undefined,
  id: string,
  context: DecodeContext,
  editable = false
): ViewerParagraph[] {
  const paragraphContext = editable ? context : readOnly(context)
  return subList
    ? children(subList, 'hp:p').map((paragraph, index) => decodeParagraph(paragraph, `${id}:p${index}`, paragraphContext))
    : []
}

/** 도형 글(`hp:drawText/hp:subList`) 문단. 묶음(`hp:container`)은 안쪽 도형의 글을 순서대로 모은다. */
function drawTextParagraphs(node: OrderedXmlNode, id: string, context: DecodeContext): ViewerParagraph[] {
  const drawText = child(node, 'hp:drawText')
  if (drawText) {
    const subList = child(drawText, 'hp:subList')
    return subListParagraphs(subList, id, context, isPlainTextSubList(subList))
  }
  if (node.name !== 'hp:container') return []
  return node.children
    .filter((item) => SHAPE_ELEMENTS.has(item.name))
    .flatMap((item, index) => drawTextParagraphs(item, `${id}:c${index}`, context))
}

const shapeComment = (node: OrderedXmlNode): string | undefined => {
  const comment = child(node, 'hp:shapeComment')
  const text = comment ? textOf(comment).trim() : ''
  return text || undefined
}

function placeholder(
  node: OrderedXmlNode,
  context: DecodeContext,
  kind: ViewerObjectKind,
  extra: Partial<ViewerObjectPlaceholder> = {}
): ViewerObjectPlaceholder {
  const { size, fitted } = fitObjectSize(declaredSize(node), context.objectHeightLimit)
  const position = objectPosition(node, size, context.objectHeightLimit)
  const shape = SHAPE_ELEMENTS.has(node.name) ? shapeStyle(node, position ?? size) : undefined
  return {
    type: 'object-placeholder',
    kind,
    element: node.name,
    sourcePath: objectSourcePath(node, context),
    flow: objectFlow(node),
    ...(size ? { size } : {}),
    label: OBJECT_KIND_LABELS[kind],
    ...(fitted ? { fitted } : {}),
    ...(position ? { position } : {}),
    ...(shape ? { shape } : {}),
    ...extra
  }
}

function formControlText(node: OrderedXmlNode): string | undefined {
  if (node.name === 'hp:edit') return textOf(child(node, 'hp:text')) || undefined
  if (node.name === 'hp:comboBox' || node.name === 'hp:listBox') return node.attributes.selectedValue || node.attributes.name || undefined
  return node.attributes.caption || node.attributes.name || undefined
}

function noteMarker(note: OrderedXmlNode, fallbackNumber: number): string {
  const autoNum = descendants(note, 'hp:autoNum')[0]
  const format = autoNum ? child(autoNum, 'hp:autoNumFormat') : undefined
  const number = autoNum?.attributes.num ?? note.attributes.number ?? String(fallbackNumber)
  const suffixCode = Number(note.attributes.suffixChar)
  const suffix = format
    ? format.attributes.suffixChar ?? ''
    : Number.isSafeInteger(suffixCode) && suffixCode > 0 ? String.fromCharCode(suffixCode) : ')'
  return `${format?.attributes.prefixChar ?? ''}${number}${suffix}`
}

/** 수식 script를 MathML 나무로 해석하고 글자 크기·색·기준선을 읽는다. 해석하지 못하면 undefined(script 글자 상자). */
function decodeEquation(node: OrderedXmlNode, script: string): ViewerEquation | undefined {
  const parsed = parseEquationScript(script)
  if (!parsed.ok) return undefined
  const baseUnit = Number(node.attributes.baseUnit)
  const baseLine = Number(node.attributes.baseLine)
  const color = node.attributes.textColor
  return {
    math: parsed.math,
    ...(Number.isFinite(baseUnit) && baseUnit >= 100 && baseUnit <= 100000 ? { baseUnit } : {}),
    ...(/^#[0-9a-f]{6}$/i.test(color ?? '') ? { color } : {}),
    ...(Number.isFinite(baseLine) && baseLine >= 0 && baseLine <= 100 ? { baseLine } : {})
  }
}

/** run 안 개체 하나를 자리 표시로 바꾼다. 개체가 아니면 undefined. */
function decodeObject(node: OrderedXmlNode, id: string, context: DecodeContext): ViewerObjectPlaceholder | undefined {
  if (node.name === 'hp:equation') {
    const script = child(node, 'hp:script')
    const text = script ? textOf(script).trim() : ''
    const equation = text ? decodeEquation(node, text) : undefined
    return placeholder(node, context, 'equation', { ...(text ? { fallbackText: text } : {}), ...(equation ? { equation } : {}) })
  }
  if (node.name === 'hp:chart') return placeholder(node, context, 'chart')
  if (node.name === 'hp:ole') {
    const comment = shapeComment(node)
    return placeholder(node, context, 'ole', comment ? { fallbackText: comment } : {})
  }
  if (node.name === 'hp:video') {
    const comment = shapeComment(node)
    return placeholder(node, context, 'video', comment ? { fallbackText: comment } : {})
  }
  if (node.name === 'hp:textart') {
    const text = (node.attributes.text ?? '').replace(/\u240D\u240A|\r\n|\u240D|\u240A/gu, '\n').trim()
    return placeholder(node, context, 'shape', { label: '글맵시', ...(text ? { fallbackText: text } : {}) })
  }
  if (SHAPE_ELEMENTS.has(node.name)) {
    const paragraphs = drawTextParagraphs(node, id, context)
    return paragraphs.length
      ? placeholder(node, context, 'text-box', { paragraphs })
      : placeholder(node, context, 'shape')
  }
  if (FORM_ELEMENTS.has(node.name)) {
    const text = formControlText(node)
    return placeholder(node, context, 'form-control', text ? { fallbackText: text } : {})
  }
  if (node.name === 'hp:dutmal') {
    const main = textOf(child(node, 'hp:mainText') ?? node)
    const sub = textOf(child(node, 'hp:subText'))
    return {
      ...placeholder(node, context, 'ruby', { fallbackText: main }),
      flow: 'marker',
      ...(sub ? { ruby: { text: sub, position: node.attributes.posType === 'BOTTOM' ? 'bottom' as const : 'top' as const } } : {})
    }
  }
  if (node.name === 'hp:compose') {
    const text = node.attributes.composeText
    return { ...placeholder(node, context, 'unknown', { label: '글자 겹치기', ...(text ? { fallbackText: text } : {}) }), flow: 'marker' }
  }
  return undefined
}

/** `hp:ctrl` 안 각주·미주·메모·본문을 숨기는 필드. 그 밖의 control(단·쪽 번호·필드 끝 등)은 undefined. */
function decodeControl(node: OrderedXmlNode, id: string, context: DecodeContext): ViewerObjectPlaceholder | undefined {
  if (node.name === 'hp:footNote' || node.name === 'hp:endNote') {
    const kind = node.name === 'hp:footNote' ? 'footnote' as const : 'endnote' as const
    const ordinal = context.notes.filter((note) => note.kind === kind).length
    const marker = kind === 'footnote' && context.footnoteSettings?.numbering.type === 'ON_SECTION'
      ? footnoteMarker(context.footnoteSettings, context.footnoteSettings.numbering.newNum + ordinal)
      : noteMarker(node, ordinal + 1)
    const sourcePath = objectSourcePath(node, context)
    // 각주·미주 본문은 section XML 안에 있어 같은 `hp:t` 순번으로 편집 anchor를 붙인다(쪽 아래 각주·구역 끝 미주에서 글자 편집).
    const note: ViewerNote = { kind, marker, sourcePath, paragraphs: subListParagraphs(child(node, 'hp:subList'), id, context, true) }
    context.notes.push(note)
    // 각주는 번호 표시가 놓인 쪽 아래에 그리도록 본문을 번호 표시에 함께 둔다. 미주는 구역 끝 목록에 모은다.
    return { type: 'object-placeholder', kind, element: node.name, sourcePath, flow: 'marker', label: OBJECT_KIND_LABELS[kind], marker, ...(kind === 'footnote' ? { note } : {}) }
  }
  if (node.name === 'hp:fieldBegin') {
    const subList = child(node, 'hp:subList')
    // 누름틀·하이퍼링크 등은 필드 안 글이 본문 run에 그대로 있어 화면에서 사라지지 않는다. 본문 밖 subList가 있는 필드만 표시한다.
    if (!subList) return undefined
    const kind = node.attributes.type === 'MEMO' ? 'memo' as const : 'field' as const
    return {
      type: 'object-placeholder',
      kind,
      element: node.name,
      sourcePath: objectSourcePath(node, context),
      flow: 'marker',
      label: OBJECT_KIND_LABELS[kind],
      // 메모 본문은 글자만 든 경우 글자를 고칠 수 있게 anchor를 붙인다. 그 밖의 필드 subList는 읽기 전용이다.
      paragraphs: subListParagraphs(subList, id, context, kind === 'memo' && isPlainTextSubList(subList))
    }
  }
  return undefined
}

function decodeRunItem(
  item: OrderedXmlNode,
  charStyleId: string,
  content: ViewerContent[],
  id: string,
  context: DecodeContext
): void {
  const { sectionPath } = context
  if (item.name === 'hp:t') {
    content.push({
      type: 'text',
      text: inlineTextOf(item),
      charStyleId,
      sourceAnchor:
        sectionPath !== undefined &&
        item.sourceOrdinal !== undefined &&
        isEditableInlineText(item)
          ? {
              sectionPath,
              textNodeId: `${sectionPath}#hp:t:${item.sourceOrdinal}`
            }
          : undefined
    })
    return
  }
  if (item.name === 'hp:tbl') return void content.push(decodeTable(item, `${id}:tbl${content.length}`, context))
  if (item.name === 'hp:pic') return void content.push(decodeImage(item, context))
  if (item.name === 'hp:tab') return void content.push({ type: 'text', text: '\t', charStyleId })
  if (item.name === 'hp:lineBreak') return void content.push({ type: 'text', text: '\n', charStyleId })
  if (item.name === 'hp:ctrl') {
    item.children.forEach((control) => {
      const decoded = decodeControl(control, `${id}:obj${content.length}`, context)
      if (decoded) content.push(decoded)
    })
    return
  }
  if (item.name === 'hp:switch') {
    // 차트는 `hp:case`(차트 namespace)와 `hp:default`(OLE 대체 그림)로 함께 저장된다. 차트가 있으면 차트로 표시하고,
    // 그 밖에는 모르는 namespace용 `hp:default`(없으면 첫 `hp:case`)를 run 자식처럼 읽는다.
    const branches = item.children.filter((branch) => branch.name === 'hp:case' || branch.name === 'hp:default')
    const chart = branches.flatMap((branch) => descendants(branch, 'hp:chart'))[0]
    if (chart) {
      const decoded = decodeObject(chart, `${id}:obj${content.length}`, context)!
      const fallback = decoded.size
        ? undefined
        : fitObjectSize(branches.flatMap((branch) => descendants(branch, 'hp:ole')).map(declaredSize).find(Boolean), context.objectHeightLimit)
      content.push(fallback?.size ? { ...decoded, size: fallback.size, ...(fallback.fitted ? { fitted: fallback.fitted } : {}) } : decoded)
      return
    }
    const branch = child(item, 'hp:default') ?? child(item, 'hp:case')
    branch?.children.forEach((nested) => decodeRunItem(nested, charStyleId, content, id, context))
    return
  }
  if (item.name === 'hp:footNote' || item.name === 'hp:endNote' || item.name === 'hp:fieldBegin') {
    // 보통 `hp:ctrl` 안에 있지만 run에 바로 둔 생성기도 같은 방식으로 읽는다.
    const control = decodeControl(item, `${id}:obj${content.length}`, context)
    if (control) content.push(control)
    return
  }
  const decoded = decodeObject(item, `${id}:obj${content.length}`, context)
  if (decoded) return void content.push(decoded)
  if (item.name.startsWith('hp:') && !HANDLED_RUN_CHILDREN.has(item.name)) {
    content.push({ ...placeholder(item, context, 'unknown'), fallbackText: item.name })
  }
}

/**
 * 자리 표시·그림이 본문 흐름에서 차지하는 높이(HWPUNIT). 글자처럼 놓인 개체(줄 안 그림 포함)는 가장 높은 것, 자리 차지 개체는 합.
 * 원본 위치 그림(`position`)은 배치(`object_position.ts`)가 높이를 정하므로 넣지 않는다.
 */
function objectLayoutHeight(content: readonly ViewerContent[]): number {
  let inline = 0
  let block = 0
  for (const item of content) {
    if (item.type === 'image' && !item.position && item.height) inline = Math.max(inline, item.height)
    if (item.type !== 'object-placeholder' || !item.size) continue
    if (item.flow === 'inline') inline = Math.max(inline, item.size.height)
    if (item.flow === 'block') block += item.size.height
  }
  return inline + block
}

/**
 * 쪽에 맞게 줄인 줄 흐름 개체(그림·자리 표시)가 줄인 높이의 합. 원본 줄 배치(`hp:lineseg`)에는 줄이기 전 높이가 남아 있으므로
 * 측정 전 쪽 나눔이 줄인 크기를 쓰도록 이만큼 뺀다.
 */
function fittedHeightReduction(content: readonly ViewerContent[]): number {
  return content.reduce((sum, item) => {
    if (item.type === 'image' && item.fitted && !item.position) return sum + item.fitted.declared.height - (item.height ?? 0)
    if (item.type === 'object-placeholder' && item.fitted && !item.position) return sum + item.fitted.declared.height - (item.size?.height ?? 0)
    return sum
  }, 0)
}

/** viewer ordered XML용 {@link ParagraphStructureAccess}(편집 코어와 같은 문단 구조 규칙). */
const orderedParagraphStructureAccess: ParagraphStructureAccess<OrderedXmlNode> = {
  elementName: (node) => node.name === '#text' ? undefined : node.name,
  children: (node) => node.children,
  isBlank: (node) => node.name === '#text' && !(node.text ?? '').trim()
}

/** viewer ordered XML용 {@link TableCaretAccess}(편집 코어와 같은 표 앞·뒤 caret 규칙). */
const orderedTableCaretAccess: TableCaretAccess<OrderedXmlNode> = orderedParagraphStructureAccess

/**
 * `topLevel`은 `hs:sec` 직속 문단이다. 표만 든 최상위 문단(`table_caret.ts`)이면 표 앞·뒤에 글자가 없는 쪽에 합성 caret
 * text를 표 content 앞·뒤로 둔다. 표 id는 합성 text를 빼고 센 위치로 정해 편집 전후 표 id가 caret 때문에 바뀌지 않게 한다.
 */
function decodeParagraph(
  node: OrderedXmlNode,
  id: string,
  context: DecodeContext,
  topLevel = false
): ViewerParagraph {
  const { sectionPath, styleCharacterIds } = context
  const content: ViewerContent[] = []
  const tableCaret = topLevel && sectionPath !== undefined && node.sourceParagraphOrdinal !== undefined
    ? tableCaretTarget(node, orderedTableCaretAccess)
    : undefined
  const caretText = (charStyleId: string, side: 'before' | 'after'): ViewerContent => ({
    type: 'text',
    text: '',
    charStyleId,
    sourceAnchor: { sectionPath: sectionPath!, textNodeId: tableCaretAnchorId(sectionPath!, node.sourceParagraphOrdinal!, side) }
  })
  children(node, 'hp:run').forEach((run) => {
    const charStyleId = run.attributes.charPrIDRef ?? '0'
    run.children.forEach((item) => {
      if (tableCaret && item === tableCaret.table) {
        const table = decodeTable(item, `${id}:tbl${content.length}`, context)
        if (tableCaret.before) content.push(caretText(charStyleId, 'before'))
        content.push(table)
        if (tableCaret.after) content.push(caretText(charStyleId, 'after'))
        return
      }
      decodeRunItem(item, charStyleId, content, id, context)
    })
  })
  // 빈 문단에는 첫 입력을 받을 빈 text와 합성 anchor를 둔다(`empty_paragraph_anchor.ts`).
  const emptyCaret = sectionPath !== undefined && node.sourceParagraphOrdinal !== undefined
    ? emptyParagraphCaret(node, styleCharacterIds)
    : undefined
  if (emptyCaret) {
    content.push({
      type: 'text',
      text: '',
      charStyleId: emptyCaret.charStyleId,
      sourceAnchor: { sectionPath: sectionPath!, textNodeId: emptyParagraphAnchorId(sectionPath!, node.sourceParagraphOrdinal!) }
    })
  }
  const lineSegments = children(child(node, 'hp:linesegarray') ?? node, 'hp:lineseg')
  const starts = lineSegments.map((segment) => num(segment.attributes.vertpos))
  const ends = lineSegments.map((segment) => num(segment.attributes.vertpos) + num(segment.attributes.vertsize))
  const measuredLayoutHeight = lineSegments.length ? Math.max(...ends) - Math.min(...starts) : 0
  // 용지·쪽 기준 개체와 글 앞·뒤 개체는 문단 흐름 밖(`object_position.ts`)이라 높이에 넣지 않는다. 표 셀·글상자·머리말 안 개체도
  // 그 칸 기준 원본 위치에 그린다(각주 안 개체만 줄 흐름 안에 남고 측정이 높이를 바로잡는다).
  const flowContent = content.filter((item) => !contentOutOfFlow(item))
  const tableLayoutHeight = flowContent.reduce(
    (maximum, item) => item.type === 'table' ? Math.max(maximum, item.height ?? 0) : maximum,
    0
  )
  const layoutHeight = Math.max(
    measuredLayoutHeight - fittedHeightReduction(flowContent),
    tableLayoutHeight,
    objectLayoutHeight(flowContent)
  )
  const layoutTop = lineSegments.length ? Math.min(...starts) : undefined
  const structureBlock = paragraphStructureViolation(node, orderedParagraphStructureAccess)?.block
  return {
    id,
    paraStyleId: node.attributes.paraPrIDRef ?? '0',
    pageBreak: node.attributes.pageBreak === '1',
    ...(node.attributes.columnBreak === '1' ? { columnBreak: true } : {}),
    layoutTop,
    layoutHeight,
    content,
    ...(structureBlock ? { structureBlock } : {})
  }
}

/**
 * 그림(`hp:pic`). 그리는 크기는 `hp:curSz`(없으면 `hp:sz`)다. 자리 표시와 같이 높이가 쪽 본문 한도(`objectHeightLimit`)를
 * 넘으면 너비·높이를 같은 비율로 줄이고(`fitted`), 원본 위치 그림의 배치 상자(`position`)도 같은 한도로 줄인다.
 */
function decodeImage(node: OrderedXmlNode, context: Pick<DecodeContext, 'objectHeightLimit'>): ViewerImage {
  const resource = descendants(node, 'hc:img')[0]
  const size = descendants(node, 'hp:curSz')[0] ?? child(node, 'hp:sz')
  const declared = size ? { width: num(size.attributes.width), height: num(size.attributes.height) } : undefined
  const { size: fittedSize, fitted } = fitObjectSize(declared, context.objectHeightLimit)
  const width = fittedSize?.width
  const height = fittedSize?.height
  const position = objectPosition(node, fittedSize ?? declaredSize(node), context.objectHeightLimit)
  return {
    type: 'image',
    resourceId: resource?.attributes.binaryItemIDRef,
    width,
    height,
    ...(fitted ? { fitted } : {}),
    ...(position ? { position } : {})
  }
}

function decodeTable(
  node: OrderedXmlNode,
  id: string,
  context: DecodeContext
): ViewerTable {
  const size = child(node, 'hp:sz')
  const rows = children(node, 'hp:tr').map((row, rowIndex) => ({
    cells: children(row, 'hp:tc').map((cell, cellIndex): ViewerTableCell => {
      const address = child(cell, 'hp:cellAddr')
      const span = child(cell, 'hp:cellSpan')
      const cellSize = child(cell, 'hp:cellSz')
      const subList = child(cell, 'hp:subList')
      const column = num(address?.attributes.colAddr ?? String(cellIndex))
      const actualRow = num(address?.attributes.rowAddr ?? String(rowIndex))
      return {
        row: actualRow,
        column,
        rowSpan: num(span?.attributes.rowSpan) || 1,
        columnSpan: num(span?.attributes.colSpan) || 1,
        width: num(cellSize?.attributes.width),
        height: num(cellSize?.attributes.height),
        margin: box(child(cell, 'hp:cellMargin')),
        borderFillId: cell.attributes.borderFillIDRef,
        verticalAlign: subList?.attributes.vertAlign,
        header: cell.attributes.header === '1',
        sourceCellId: `${id}:r${actualRow}c${column}`,
        paragraphs: subList
          ? children(subList, 'hp:p').map((p, index) =>
              decodeParagraph(p, `${id}:r${actualRow}c${column}:p${index}`, context)
            )
          : []
      }
    })
  }))
  const width = size ? num(size.attributes.width) : undefined
  const height = size ? num(size.attributes.height) : undefined
  const position = width !== undefined && height !== undefined ? objectPosition(node, { width, height }) : undefined
  return { type: 'table', id, rowCount: num(node.attributes.rowCnt) || rows.length, columnCount: num(node.attributes.colCnt), width, height, pageBreak: node.attributes.pageBreak, repeatHeader: node.attributes.repeatHeader === '1', rows, ...(position ? { position } : {}) }
}

function decodePageNumber(nodes: OrderedXmlNode[]): ViewerPageNumber | undefined {
  const all = walkOrderedXml(nodes)
  const pageNum = all.find((node) => node.name === 'hp:pageNum')
  if (!pageNum) return undefined
  const startNum = all.find((node) => node.name === 'hp:startNum')
  const visibility = all.find((node) => node.name === 'hp:visibility')
  const start = num(startNum?.attributes.page)
  return {
    position: pageNum.attributes.pos ?? 'BOTTOM_CENTER',
    formatType: pageNum.attributes.formatType ?? 'DIGIT',
    sideChar: pageNum.attributes.sideChar ?? '',
    start: start > 0 ? start : undefined,
    hiddenOnFirstPage: visibility?.attributes.hideFirstPageNum === '1'
  }
}

/** 구역 정의 첫 `hp:footNotePr`(각주 모양). 없으면 undefined(renderer·pagination이 한/글 기본값을 쓴다). */
function decodeFootnoteSettings(root: OrderedXmlNode | undefined): ViewerFootnoteSettings | undefined {
  // 구역 정의(`hp:secPr`)는 구역 첫 문단에 있다. 구역 전체를 다시 훑지 않는다.
  const first = root ? child(root, 'hp:p') : undefined
  const footNotePr = first ? descendants(first, 'hp:footNotePr')[0] : undefined
  if (!footNotePr) return undefined
  const defaults = DEFAULT_FOOTNOTE_SETTINGS
  const format = child(footNotePr, 'hp:autoNumFormat')?.attributes
  const line = child(footNotePr, 'hp:noteLine')?.attributes
  const spacing = child(footNotePr, 'hp:noteSpacing')?.attributes
  const numbering = child(footNotePr, 'hp:numbering')?.attributes
  const placement = child(footNotePr, 'hp:placement')?.attributes
  const length = (value: string | undefined, fallback: number) => {
    const parsed = Number(value)
    return value !== undefined && Number.isFinite(parsed) ? parsed : fallback
  }
  const numberingType = numbering?.type === 'ON_SECTION' || numbering?.type === 'ON_PAGE' ? numbering.type : 'CONTINUOUS'
  return {
    format: {
      type: format?.type ?? defaults.format.type,
      userChar: format?.userChar ?? defaults.format.userChar,
      prefixChar: format?.prefixChar ?? defaults.format.prefixChar,
      suffixChar: format?.suffixChar ?? defaults.format.suffixChar,
      superscript: format ? format.supscript === '1' : defaults.format.superscript
    },
    line: {
      type: line?.type ?? defaults.line.type,
      length: length(line?.length, defaults.line.length),
      // `width="0.12 mm"`처럼 단위가 붙는다.
      widthMm: Math.max(length(line?.width?.replace(/\s*mm$/i, ''), defaults.line.widthMm), 0),
      color: line?.color ?? defaults.line.color
    },
    spacing: {
      betweenNotes: Math.max(length(spacing?.betweenNotes, defaults.spacing.betweenNotes), 0),
      belowLine: Math.max(length(spacing?.belowLine, defaults.spacing.belowLine), 0),
      aboveLine: Math.max(length(spacing?.aboveLine, defaults.spacing.aboveLine), 0)
    },
    numbering: { type: numberingType, newNum: Math.max(Math.trunc(length(numbering?.newNum, 1)), 1) },
    placement: { place: placement?.place ?? defaults.placement.place, beneathText: placement?.beneathText === '1' }
  }
}

/** 문단(또는 node 목록) 안의 첫 `hp:colPr`. 머리말·꼬리말·글상자·표 셀(`hp:subList`) 안은 보지 않는다. */
function findColumnNode(items: readonly OrderedXmlNode[]): OrderedXmlNode | undefined {
  for (const item of items) {
    if (item.name === 'hp:header' || item.name === 'hp:footer' || item.name === 'hp:subList') continue
    if (item.name === 'hp:colPr') return item
    const nested = findColumnNode(item.children)
    if (nested) return nested
  }
  return undefined
}

/** `width="0.12 mm"`처럼 단위가 붙은 선 굵기(mm). */
function lineWidthMm(value: string | undefined): number {
  const parsed = Number(value?.replace(/\s*mm$/i, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.12
}

function decodeColumnNode(
  columnNode: OrderedXmlNode,
  source: string
): { columnLayout?: ViewerColumnLayout; diagnostics: ViewerDiagnostic[] } {
  const count = num(columnNode.attributes.colCount)
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
    return {
      diagnostics: [{
        source,
        code: 'HWPX_INVALID_COLUMN_LAYOUT',
        message: `다단 개수(${columnNode.attributes.colCount ?? '없음'})가 유효 범위(1~16)를 벗어나 단일 본문 흐름으로 표시합니다.`
      }]
    }
  }

  const line = child(columnNode, 'hp:colLine')
  // 단별 너비는 OWPML `hp:colSz`다. 예전 생성기의 `hp:col`도 같은 뜻으로 읽는다.
  const definitions = [...children(columnNode, 'hp:colSz'), ...children(columnNode, 'hp:col')]
  const columnLayout: ViewerColumnLayout = {
    type: columnNode.attributes.type ?? 'NEWSPAPER',
    layout: columnNode.attributes.layout ?? 'LEFT',
    count,
    sameSize: columnNode.attributes.sameSz !== '0',
    sameGap: num(columnNode.attributes.sameGap),
    columns: definitions.map((column) => ({
      width: num(column.attributes.width),
      gap: num(column.attributes.gap)
    })),
    ...(line && line.attributes.type && line.attributes.type !== 'NONE'
      ? { line: { type: line.attributes.type, widthMm: lineWidthMm(line.attributes.width), color: line.attributes.color ?? '#000000' } }
      : {})
  }
  const diagnostics: ViewerDiagnostic[] = []
  if (count > 1 && columnLayout.type === 'PARALLEL') {
    diagnostics.push({
      source,
      code: 'HWPX_PARALLEL_COLUMN_APPROXIMATED',
      message: `평행 다단 ${count}단은 단 나눔마다 다음 단으로, 마지막 단의 단 나눔은 같은 쪽 아래 새 줄로 옮기고 넘치는 글은 일반 다단처럼 이어 표시합니다.`
    })
  }
  if (count > 1 && !columnLayout.sameSize && columnLayout.columns.length !== count) {
    diagnostics.push({
      source,
      code: 'HWPX_COLUMN_DEFINITION_INCOMPLETE',
      message: `서로 다른 너비의 다단 정의가 ${count}개 중 ${columnLayout.columns.length}개만 있어 원본 단 너비를 완전히 복원할 수 없습니다.`
    })
  }
  return { columnLayout, diagnostics }
}

/**
 * 구역 최상위 문단마다 다단 정의(`hp:colPr`)를 읽는다. 처음 나온 정의는 구역 다단(`section`), 그 뒤 정의는 그 문단에서
 * 시작하는 새 다단 영역(`paragraphs`, 문단 순번별)이다.
 */
function decodeColumnLayouts(
  paragraphs: readonly OrderedXmlNode[],
  source: string
): { section?: ViewerColumnLayout; paragraphs: Map<number, ViewerColumnLayout>; diagnostics: ViewerDiagnostic[] } {
  const diagnostics: ViewerDiagnostic[] = []
  const byParagraph = new Map<number, ViewerColumnLayout>()
  let section: ViewerColumnLayout | undefined
  let found = false
  paragraphs.forEach((paragraph, index) => {
    const node = findColumnNode(paragraph.children)
    if (!node) return
    const decoded = decodeColumnNode(node, source)
    diagnostics.push(...decoded.diagnostics)
    if (!found) {
      found = true
      section = decoded.columnLayout
    } else if (decoded.columnLayout) {
      byParagraph.set(index, decoded.columnLayout)
    }
  })
  return { section, paragraphs: byParagraph, diagnostics }
}

function decodeHeaderFooters(
  nodes: OrderedXmlNode[],
  name: 'hp:header' | 'hp:footer',
  sectionIndex: number,
  context: DecodeContext
): ViewerHeaderFooter[] {
  return walkOrderedXml(nodes).filter((node) => node.name === name).map((node, controlIndex) => {
    const subList = child(node, 'hp:subList')
    const kind = name === 'hp:header' ? 'header' : 'footer'
    return {
      id: node.attributes.id ?? `s${sectionIndex}:${kind}${controlIndex}`,
      applyPageType: node.attributes.applyPageType ?? 'BOTH',
      paragraphs: subList
        ? children(subList, 'hp:p').map((paragraph, index) =>
            decodeParagraph(paragraph, `s${sectionIndex}:${kind}${controlIndex}:p${index}`, context)
          )
        : []
    }
  })
}

function decodeHeader(nodes: OrderedXmlNode[]) {
  const all = walkOrderedXml(nodes)
  const fonts: Record<string, string> = {}
  const hangul = all.find((node) => node.name === 'hh:fontface' && node.attributes.lang === 'HANGUL')
  hangul?.children.filter((node) => node.name === 'hh:font').forEach((font) => { fonts[font.attributes.id] = font.attributes.face })
  const charStyles: Record<string, ViewerCharStyle> = {}
  all.filter((node) => node.name === 'hh:charPr').forEach((style) => {
    const ref = child(style, 'hh:fontRef')?.attributes.hangul
    const underline = child(style, 'hh:underline')
    const strikeout = child(style, 'hh:strikeout')
    charStyles[style.attributes.id] = {
      id: style.attributes.id,
      height: num(style.attributes.height),
      color: style.attributes.textColor ?? '#000000',
      bold: Boolean(child(style, 'hh:bold')),
      italic: Boolean(child(style, 'hh:italic')),
      underline: Boolean(underline && underline.attributes.type !== 'NONE'),
      strikeout: Boolean(strikeout && isRenderedStrikeShape(strikeout.attributes.shape)),
      fontId: ref,
      fontFamily: ref ? fonts[ref] : undefined
    }
  })
  const paraStyles: Record<string, ViewerParaStyle> = {}
  const bullets = Object.fromEntries(all.filter((node) => node.name === 'hh:bullet').map((node) => [node.attributes.id, node.attributes.char ?? '•']))
  const numberings = Object.fromEntries(all.filter((node) => node.name === 'hh:numbering').map((node) => [node.attributes.id, children(node, 'hh:paraHead').map((head) => ({ pattern: textOf(head), format: head.attributes.numFormat ?? 'DIGIT' }))]))
  all.filter((node) => node.name === 'hh:paraPr').forEach((style) => {
    // HwpUnitChar `hp:case` 밖(직접 `hh:margin`, `hp:default`)의 문단 여백·들여쓰기는 HWPUNIT의 2배로 저장된다.
    const margin = paragraphMetricNode(style, 'hh:margin')
    const getValue = (name: string) => margin ? Math.round(num(child(margin.node, name)?.attributes.value) * margin.scale) : 0
    const heading = child(style, 'hh:heading')
    const level = num(heading?.attributes.level)
    const idRef = heading?.attributes.idRef ?? '0'
    const numbering = numberings[idRef]?.[level]
    paraStyles[style.attributes.id] = {
      id: style.attributes.id,
      align: child(style, 'hh:align')?.attributes.horizontal,
      lineSpacing: num(paragraphMetricNode(style, 'hh:lineSpacing')?.node.attributes.value),
      indent: getValue('hc:intent'),
      margin: { left: getValue('hc:left'), right: getValue('hc:right'), top: getValue('hc:prev'), bottom: getValue('hc:next') },
      tabPrId: style.attributes.tabPrIDRef,
      heading: heading ? { type: heading.attributes.type ?? 'NONE', idRef, level, bullet: bullets[idRef], numberPattern: numbering?.pattern, numberFormat: numbering?.format } : undefined
    }
  })
  const border = (node?: OrderedXmlNode): ViewerBorder => ({
    type: node?.attributes.type ?? 'NONE',
    widthMm: Number.parseFloat(node?.attributes.width ?? '0') || 0,
    color: node?.attributes.color ?? '#000000'
  })
  const cellStyles: Record<string, ViewerCellStyle> = {}
  all.filter((node) => node.name === 'hh:borderFill').forEach((style) => {
    const fill = descendants(style, 'hc:winBrush')[0]
    cellStyles[style.attributes.id] = {
      id: style.attributes.id,
      backgroundColor: fill?.attributes.faceColor,
      left: border(child(style, 'hh:leftBorder')),
      right: border(child(style, 'hh:rightBorder')),
      top: border(child(style, 'hh:topBorder')),
      bottom: border(child(style, 'hh:bottomBorder'))
    }
  })
  const styleCharacterIds: Record<string, string> = {}
  all.filter((node) => node.name === 'hh:style').forEach((style) => {
    const { id, charPrIDRef } = style.attributes
    if (id !== undefined && charPrIDRef !== undefined && !(id in styleCharacterIds)) styleCharacterIds[id] = charPrIDRef
  })
  return { fonts, charStyles, paraStyles, cellStyles, styleCharacterIds }
}

/**
 * 구역 끝 미주 목록. 쪽 사이에서 나눌 수 있게 미주 문단마다 block 하나를 만든다(문단이 없는 미주는 block 하나).
 * 첫 block id는 `${id}`, 다음은 `${id}:${순번}`이다. 문서 순서를 지킨다. 각주는 번호 표시가 놓인 쪽 아래에 그리므로
 * 여기에 넣지 않는다(`ViewerObjectPlaceholder.note`).
 * 높이는 줄 배치 캐시 합(없으면 1000)에 종류 제목 줄(1600)을 더한 추정값이다(화면 측정이 덮어쓴다).
 */
function noteListBlocks(notes: ViewerNote[], id: string): ViewerParagraph[] {
  const ordered = notes.filter((note) => note.kind === 'endnote')
  const blocks: ViewerParagraph[] = []
  let previousKind: ViewerNote['kind'] | undefined
  for (const note of ordered) {
    const parts = note.paragraphs.length ? note.paragraphs.map((paragraph) => [paragraph]) : [[]]
    parts.forEach((paragraphs, index) => {
      const heading = previousKind !== note.kind ? 1600 : 0
      const height = Math.max(paragraphs.reduce((sum, paragraph) => sum + paragraph.layoutHeight, 0), 1000)
      blocks.push({
        id: blocks.length ? `${id}:${blocks.length}` : id,
        paraStyleId: '0',
        pageBreak: false,
        layoutHeight: height + heading,
        content: [{
          type: 'note-list',
          notes: [{ ...note, paragraphs }],
          ...(previousKind ? { continuesKind: previousKind } : {}),
          ...(index > 0 ? { continuesNote: true } : {})
        }]
      })
      previousKind = note.kind
    })
  }
  return blocks
}

/** 구역마다 자리 표시 종류별 개수를 진단으로 남긴다. */
function objectPlaceholderDiagnostics(section: ViewerSection, source: string): ViewerDiagnostic[] {
  const counts = countIncompleteObjectPlaceholders({ sections: [section] })
  return OBJECT_KIND_ORDER.filter((kind) => counts[kind]).map((kind) => ({
    source,
    code: `HWPX_OBJECT_PLACEHOLDER_${kind.toUpperCase().replace(/-/g, '_')}`,
    message: `${OBJECT_KIND_LABELS[kind]} ${counts[kind]}개는 원본처럼 그리지 못해 자리 표시로 보여 줍니다. 원본 내용은 저장할 때 그대로 보존합니다.`
  }))
}

function applyParagraphMarkers(paragraphs: ViewerParagraph[], paraStyles: Record<string, ViewerParaStyle>): ViewerParagraph[] {
  const counters: Record<string, number> = {}
  return paragraphs.map((paragraph) => {
    const heading = paraStyles[paragraph.paraStyleId]?.heading
    let marker: string | undefined
    if (heading?.type === 'BULLET') marker = heading.bullet
    if (heading?.type === 'NUMBER') {
      const key = `${heading.idRef}:${heading.level}`
      counters[key] = (counters[key] ?? 0) + 1
      const token = `^${heading.level + 1}`
      marker = heading.numberPattern?.replace(token, String(counters[key])) || `${counters[key]}.`
    }
    const content = paragraph.content.map((item) => item.type === 'table' ? {
      ...item,
      rows: item.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, paragraphs: applyParagraphMarkers(cell.paragraphs, paraStyles) })) }))
    } : item)
    return { ...paragraph, marker, content }
  })
}

/** header.xml에서 읽은 style map과, section 해석이 쓰는 문단 style → 글자 모양 id. */
export interface ViewerHeaderProjection {
  fonts: ViewerDocument['fonts']
  charStyles: ViewerDocument['charStyles']
  paraStyles: ViewerDocument['paraStyles']
  cellStyles: ViewerDocument['cellStyles']
  styleCharacterIds: ParagraphStyleCharacterIds
}

export function decodeViewerHeader(nodes: OrderedXmlNode[]): ViewerHeaderProjection {
  return decodeHeader(nodes)
}

/** 첫 `hp:pagePr`가 정하는 쪽 크기와 자리 표시 선언 높이 한도. */
export interface ViewerPageGeometry {
  page: ViewerDocument['page']
  objectHeightLimit?: number
}

export function viewerPageGeometry(pagePr: OrderedXmlNode | undefined): ViewerPageGeometry {
  const margin = pagePr ? child(pagePr, 'hp:margin') : undefined
  // pagination(`pagination.ts`)과 같은 쪽 본문 높이. 자리 표시가 한 쪽을 넘지 않게 선언 높이를 줄이는 한도로 쓴다.
  const bodyHeight = num(pagePr?.attributes.height) - num(margin?.attributes.top) - num(margin?.attributes.bottom)
  return {
    page: { width: num(pagePr?.attributes.width), height: num(pagePr?.attributes.height), margin: box(margin), headerOffset: num(margin?.attributes.header), footerOffset: num(margin?.attributes.footer) },
    objectHeightLimit: bodyHeight > 0 ? Math.floor(bodyHeight * OBJECT_PAGE_HEIGHT_RATIO) : undefined
  }
}

/**
 * section XML 하나의 문서 수준 입력: 문서 순서 첫 `hp:pagePr`(쪽 크기는 이 값이 있는 첫 section이 정한다)와,
 * header에서 온 값을 읽는 문단 참조(`paraPrIDRef`는 목록 번호·글머리표, `styleIDRef`는 빈 문단 caret 글자 모양).
 * 속성이 없는 문단은 '0'을 쓰므로 '0'은 항상 넣는다. 증분 projection이 header 변경의 영향 범위를 정하는 데 쓴다.
 */
export interface ViewerSectionInputs {
  pagePr?: OrderedXmlNode
  paraStyleRefs: Set<string>
  styleRefs: Set<string>
}

export function viewerSectionInputs(nodes: OrderedXmlNode[]): ViewerSectionInputs {
  const inputs: ViewerSectionInputs = { paraStyleRefs: new Set(['0']), styleRefs: new Set(['0']) }
  const visit = (node: OrderedXmlNode): void => {
    if (!inputs.pagePr && node.name === 'hp:pagePr') inputs.pagePr = node
    const { paraPrIDRef, styleIDRef } = node.attributes
    if (paraPrIDRef !== undefined) inputs.paraStyleRefs.add(paraPrIDRef)
    if (styleIDRef !== undefined) inputs.styleRefs.add(styleIDRef)
    for (const item of node.children) visit(item)
  }
  nodes.forEach(visit)
  return inputs
}

/** section 하나의 해석 결과. 문서 진단은 다단 진단을 모든 section 순서대로 모은 뒤 자리 표시 진단을 잇는다. */
export interface DecodedViewerSection {
  path: string
  section: ViewerSection
  columnDiagnostics: ViewerDiagnostic[]
  placeholderDiagnostics: ViewerDiagnostic[]
}

/**
 * section XML 하나를 해석한다. 결과는 이 section의 XML, header projection(`styleCharacterIds`·문단 style의 `heading`),
 * 쪽 크기에서 온 `objectHeightLimit`에만 달려 있다. 각주 번호·목록 번호·개체 순번·`hp:t`·문단 순번은 모두 section 안에서 센다.
 */
export function decodeViewerSection(
  path: string,
  nodes: OrderedXmlNode[],
  header: ViewerHeaderProjection,
  objectHeightLimit: number | undefined
): DecodedViewerSection {
  const sectionIndex = Number(path.match(/section(\d+)\.xml$/)?.[1] ?? 0)
  const root = nodes.find((node) => node.name === 'hs:sec')
  const footnoteSettings = decodeFootnoteSettings(root)
  const context: DecodeContext = {
    sectionPath: path,
    sourceSection: path,
    styleCharacterIds: header.styleCharacterIds,
    objectOrdinals: objectOrdinals(nodes),
    notes: [],
    footnoteSettings,
    objectHeightLimit
  }
  const paragraphNodes = root ? children(root, 'hp:p') : []
  const columns = decodeColumnLayouts(paragraphNodes, path)
  const blocks = root
    ? applyParagraphMarkers(
        paragraphNodes.map((p, index) => {
          const paragraph = decodeParagraph(p, `s${sectionIndex}:p${index}`, context, true)
          const columnLayout = columns.paragraphs.get(index)
          return columnLayout ? { ...paragraph, columnLayout } : paragraph
        }),
        header.paraStyles
      )
    : []
  const section: ViewerSection = {
    id: `section-${sectionIndex}`,
    blocks: [...blocks, ...noteListBlocks(context.notes, `s${sectionIndex}:notes`)],
    pageNumber: decodePageNumber(nodes),
    columnLayout: columns.section,
    ...(footnoteSettings ? { footnoteSettings } : {}),
    headers: decodeHeaderFooters(nodes, 'hp:header', sectionIndex, context).map((control) => ({
      ...control,
      paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
    })),
    footers: decodeHeaderFooters(nodes, 'hp:footer', sectionIndex, context).map((control) => ({
      ...control,
      paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
    }))
  }
  return {
    path,
    section,
    columnDiagnostics: columns.diagnostics,
    placeholderDiagnostics: objectPlaceholderDiagnostics(section, path)
  }
}

/** `BinData/` 그림을 data URL용 base64로 읽는다(그림 resource 한도를 함께 검사). */
export async function decodeViewerResources(
  reader: HwpxReadablePackage,
  resourcePaths: readonly string[]
): Promise<ViewerDocument['resources']> {
  const imageBudget = new ImageResourceBudget()
  const resourceEntries: Array<[string, { id: string; path: string; mime: string; data: string }]> = []
  for (const path of resourcePaths) {
    const id = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
    const extension = path.split('.').pop()?.toLowerCase()
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension ?? 'png'}`
    const bytes = await reader.readBuffer(path)
    imageBudget.add(path, bytes)
    resourceEntries.push([id, { id, path, mime, data: bytes.toString('base64') }])
  }
  return Object.fromEntries(resourceEntries)
}

/** 첫 `hp:pagePr`가 있는 section(문서 순서)의 쪽 크기. */
export function documentPageGeometry(pagePrs: ReadonlyArray<OrderedXmlNode | undefined>): ViewerPageGeometry {
  return viewerPageGeometry(pagePrs.find((pagePr) => pagePr !== undefined))
}

/** 조각을 `decodeViewerDocument`와 같은 모양(같은 key 순서)의 문서로 모은다. */
export function assembleViewerDocument(
  geometry: ViewerPageGeometry,
  header: ViewerHeaderProjection,
  resources: ViewerDocument['resources'],
  sections: readonly DecodedViewerSection[]
): ViewerDocument {
  const { styleCharacterIds: _styleCharacterIds, ...styles } = header
  return {
    page: geometry.page,
    ...styles,
    resources,
    sections: sections.map((decoded) => decoded.section),
    diagnostics: [
      ...sections.flatMap((decoded) => decoded.columnDiagnostics),
      ...sections.flatMap((decoded) => decoded.placeholderDiagnostics)
    ]
  }
}

export async function decodeViewerDocument(reader: HwpxReadablePackage, knownIndex?: HwpxPackageIndex, options: ViewerDecodeOptions = {}): Promise<ViewerDocument> {
  const index = knownIndex ?? await reader.index()
  const sectionPaths = options.sectionPaths ?? index.sectionPaths
  const resourcePaths = options.resourcePaths ?? index.resourcePaths
  const header = decodeViewerHeader(await reader.readOrderedXml(index.headerPath))
  const sectionXml = await Promise.all(sectionPaths.map(async (path) => ({ path, nodes: await reader.readOrderedXml(path) })))
  const geometry = documentPageGeometry(sectionXml.map(({ nodes }) => viewerSectionInputs(nodes).pagePr))
  const sections = sectionXml.map(({ path, nodes }) => decodeViewerSection(path, nodes, header, geometry.objectHeightLimit))
  return assembleViewerDocument(geometry, header, await decodeViewerResources(reader, resourcePaths), sections)
}
