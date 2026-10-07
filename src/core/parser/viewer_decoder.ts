import { supportsViewerColumnFlow, ViewerBorder, ViewerCellStyle, ViewerCharStyle, ViewerColumnLayout, ViewerContent, ViewerDiagnostic, ViewerDocument, ViewerHeaderFooter, ViewerImage, ViewerNote, ViewerObjectFlow, ViewerObjectKind, ViewerObjectPlaceholder, ViewerPageNumber, ViewerParagraph, ViewerParaStyle, ViewerSection, ViewerTable, ViewerTableCell } from '../document/viewer_document'
import { countObjectPlaceholders, OBJECT_KIND_LABELS, OBJECT_KIND_ORDER } from '../document/object_placeholder'
import { isRenderedStrikeShape } from './line_shape'
import { OrderedXmlNode, walkOrderedXml } from './ordered_xml'
import {
  EMPTY_PARAGRAPH_BLOCKING_CONTROLS,
  EMPTY_PARAGRAPH_RUN_CONTROLS,
  emptyParagraphAnchorId
} from '../editing/empty_paragraph_anchor'
import { HwpxPackageIndex, HwpxReadablePackage } from './package_reader'
import { ImageResourceBudget } from './resource_budget'

const num = (value?: string): number => Number(value ?? 0)
const children = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => node.children.filter((child) => child.name === name)
const child = (node: OrderedXmlNode, name: string): OrderedXmlNode | undefined => children(node, name)[0]
const descendants = (node: OrderedXmlNode, name: string): OrderedXmlNode[] => walkOrderedXml(node.children).filter((item) => item.name === name)

function styleChild(node: OrderedXmlNode, name: string): OrderedXmlNode | undefined {
  const direct = child(node, name)
  if (direct) return direct
  const switchNode = child(node, 'hp:switch')
  const branch = child(switchNode ?? node, 'hp:case') ?? child(switchNode ?? node, 'hp:default')
  return branch ? descendants(branch, name)[0] : undefined
}
/**
 * 문단 모양 `hh:margin` 값의 배율.
 * 한/글은 HwpUnitChar namespace를 아는 reader용 `hp:switch/hp:case`에는 실제 HWPUNIT을, 그 밖의 직접
 * `hh:margin`(한/글 2018 이전 저장본)과 `hp:default`에는 같은 값의 2배를 적는다(예: case 1752 / default 3504).
 * 한/글 저장본의 `hp:lineseg`도 왼쪽 여백 6000을 `horzpos` 3000으로, 문단 앞 간격 1000을 줄 간격 500으로 배치한다.
 */
export function paragraphMarginScale(paraPr: OrderedXmlNode, margin: OrderedXmlNode | undefined): number {
  if (!margin) return 1
  const switchNode = child(paraPr, 'hp:switch')
  const caseNode = switchNode ? child(switchNode, 'hp:case') : undefined
  return caseNode && descendants(caseNode, 'hh:margin')[0] === margin ? 1 : 0.5
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
 * - `sectionPath`: 편집 anchor를 붙일 section. 글상자·각주·메모 본문처럼 읽기 전용으로 되살리는 문단은 undefined다.
 * - `sourceSection`: 자리 표시 `sourcePath`에 쓰는 section 경로(읽기 전용 문단에서도 유지한다).
 */
interface DecodeContext {
  sectionPath: string | undefined
  sourceSection: string | undefined
  styleCharacterIds: ParagraphStyleCharacterIds
  objectOrdinals: Map<OrderedXmlNode, number>
  notes: ViewerNote[]
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

function objectFlow(node: OrderedXmlNode): ViewerObjectFlow {
  if (child(node, 'hp:pos')?.attributes.treatAsChar === '1') return 'inline'
  const wrap = node.attributes.textWrap
  return wrap === 'IN_FRONT_OF_TEXT' || wrap === 'BEHIND_TEXT' ? 'floating' : 'block'
}

const readOnly = (context: DecodeContext): DecodeContext => ({ ...context, sectionPath: undefined })

function subListParagraphs(subList: OrderedXmlNode | undefined, id: string, context: DecodeContext): ViewerParagraph[] {
  return subList
    ? children(subList, 'hp:p').map((paragraph, index) => decodeParagraph(paragraph, `${id}:p${index}`, readOnly(context)))
    : []
}

/** 도형 글(`hp:drawText/hp:subList`) 문단. 묶음(`hp:container`)은 안쪽 도형의 글을 순서대로 모은다. */
function drawTextParagraphs(node: OrderedXmlNode, id: string, context: DecodeContext): ViewerParagraph[] {
  const drawText = child(node, 'hp:drawText')
  if (drawText) return subListParagraphs(child(drawText, 'hp:subList'), id, context)
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
  const size = declaredSize(node)
  return {
    type: 'object-placeholder',
    kind,
    element: node.name,
    sourcePath: objectSourcePath(node, context),
    flow: objectFlow(node),
    ...(size ? { size } : {}),
    label: OBJECT_KIND_LABELS[kind],
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

/** run 안 개체 하나를 자리 표시로 바꾼다. 개체가 아니면 undefined. */
function decodeObject(node: OrderedXmlNode, id: string, context: DecodeContext): ViewerObjectPlaceholder | undefined {
  if (node.name === 'hp:equation') {
    const script = child(node, 'hp:script')
    return placeholder(node, context, 'equation', script && textOf(script).trim() ? { fallbackText: textOf(script).trim() } : {})
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
    const marker = noteMarker(node, context.notes.filter((note) => note.kind === kind).length + 1)
    const sourcePath = objectSourcePath(node, context)
    context.notes.push({ kind, marker, sourcePath, paragraphs: subListParagraphs(child(node, 'hp:subList'), id, context) })
    return { type: 'object-placeholder', kind, element: node.name, sourcePath, flow: 'marker', label: OBJECT_KIND_LABELS[kind], marker }
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
      paragraphs: subListParagraphs(subList, id, context)
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
  if (item.name === 'hp:pic') return void content.push(decodeImage(item))
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
      const fallbackSize = decoded.size ?? branches.flatMap((branch) => descendants(branch, 'hp:ole')).map(declaredSize).find(Boolean)
      content.push(fallbackSize ? { ...decoded, size: fallbackSize } : decoded)
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

/** 자리 표시가 본문 흐름에서 차지하는 높이(HWPUNIT). 글자처럼 놓인 개체는 가장 높은 것, 자리 차지 개체는 합. */
function placeholderLayoutHeight(content: readonly ViewerContent[]): number {
  let inline = 0
  let block = 0
  for (const item of content) {
    if (item.type !== 'object-placeholder' || !item.size) continue
    if (item.flow === 'inline') inline = Math.max(inline, item.size.height)
    if (item.flow === 'block') block += item.size.height
  }
  return inline + block
}

function decodeParagraph(
  node: OrderedXmlNode,
  id: string,
  context: DecodeContext
): ViewerParagraph {
  const { sectionPath, styleCharacterIds } = context
  const content: ViewerContent[] = []
  children(node, 'hp:run').forEach((run) => {
    const charStyleId = run.attributes.charPrIDRef ?? '0'
    run.children.forEach((item) => decodeRunItem(item, charStyleId, content, id, context))
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
  const tableLayoutHeight = content.reduce(
    (maximum, item) => item.type === 'table' ? Math.max(maximum, item.height ?? 0) : maximum,
    0
  )
  const layoutHeight = Math.max(measuredLayoutHeight, tableLayoutHeight, placeholderLayoutHeight(content))
  const layoutTop = lineSegments.length ? Math.min(...starts) : undefined
  return {
    id,
    paraStyleId: node.attributes.paraPrIDRef ?? '0',
    pageBreak: node.attributes.pageBreak === '1',
    ...(node.attributes.columnBreak === '1' ? { columnBreak: true } : {}),
    layoutTop,
    layoutHeight,
    content
  }
}

function decodeImage(node: OrderedXmlNode): ViewerImage {
  const resource = descendants(node, 'hc:img')[0]
  const size = descendants(node, 'hp:curSz')[0] ?? child(node, 'hp:sz')
  return { type: 'image', resourceId: resource?.attributes.binaryItemIDRef, width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined }
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
  return { type: 'table', id, rowCount: num(node.attributes.rowCnt) || rows.length, columnCount: num(node.attributes.colCnt), width: size ? num(size.attributes.width) : undefined, height: size ? num(size.attributes.height) : undefined, pageBreak: node.attributes.pageBreak, repeatHeader: node.attributes.repeatHeader === '1', rows }
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

function decodeColumnLayout(
  nodes: OrderedXmlNode[],
  source: string
): { columnLayout?: ViewerColumnLayout; diagnostics: ViewerDiagnostic[] } {
  const findColumnNode = (items: OrderedXmlNode[]): OrderedXmlNode | undefined => {
    for (const item of items) {
      if (item.name === 'hp:header' || item.name === 'hp:footer' || item.name === 'hp:subList') continue
      if (item.name === 'hp:colPr') return item
      const nested = findColumnNode(item.children)
      if (nested) return nested
    }
    return undefined
  }
  const columnNode = findColumnNode(nodes)
  if (!columnNode) return { diagnostics: [] }

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

  const columnLayout: ViewerColumnLayout = {
    type: columnNode.attributes.type ?? 'NEWSPAPER',
    layout: columnNode.attributes.layout ?? 'LEFT',
    count,
    sameSize: columnNode.attributes.sameSz === '1',
    sameGap: num(columnNode.attributes.sameGap),
    columns: children(columnNode, 'hp:col').map((column) => ({
      width: num(column.attributes.width),
      gap: num(column.attributes.gap)
    }))
  }
  const diagnostics: ViewerDiagnostic[] = []
  if (count > 1 && !supportsViewerColumnFlow(columnLayout)) {
    diagnostics.push({
      source,
      code: 'HWPX_MULTI_COLUMN_LAYOUT_FALLBACK',
      message: `다단 ${count}단 속성은 보존했지만 현재 단별 흐름 조판은 지원하지 않아 단일 본문 흐름으로 표시합니다.`
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
    const marginNode = styleChild(style, 'hh:margin')
    // HwpUnitChar `hp:case` 밖(직접 `hh:margin`, `hp:default`)의 문단 여백·들여쓰기는 HWPUNIT의 2배로 저장된다.
    const marginScale = paragraphMarginScale(style, marginNode)
    const getValue = (name: string) => Math.round(num(child(marginNode ?? style, name)?.attributes.value) * marginScale)
    const heading = child(style, 'hh:heading')
    const level = num(heading?.attributes.level)
    const idRef = heading?.attributes.idRef ?? '0'
    const numbering = numberings[idRef]?.[level]
    paraStyles[style.attributes.id] = {
      id: style.attributes.id,
      align: child(style, 'hh:align')?.attributes.horizontal,
      lineSpacing: num(styleChild(style, 'hh:lineSpacing')?.attributes.value),
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

/** 구역 끝 각주·미주 목록 문단. 높이는 본문 줄 배치 캐시 합에 제목 줄을 더한 추정값이다(화면 측정이 덮어쓴다). */
function noteListBlock(notes: ViewerNote[], id: string): ViewerParagraph | undefined {
  if (!notes.length) return undefined
  const groups = new Set(notes.map((note) => note.kind)).size
  const bodyHeight = notes.reduce(
    (sum, note) => sum + Math.max(note.paragraphs.reduce((height, paragraph) => height + paragraph.layoutHeight, 0), 1000),
    0
  )
  return { id, paraStyleId: '0', pageBreak: false, layoutHeight: bodyHeight + groups * 1600, content: [{ type: 'note-list', notes }] }
}

/** 구역마다 자리 표시 종류별 개수를 진단으로 남긴다. */
function objectPlaceholderDiagnostics(section: ViewerSection, source: string): ViewerDiagnostic[] {
  const counts = countObjectPlaceholders({ sections: [section] })
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

export async function decodeViewerDocument(reader: HwpxReadablePackage, knownIndex?: HwpxPackageIndex, options: ViewerDecodeOptions = {}): Promise<ViewerDocument> {
  const index = knownIndex ?? await reader.index()
  const sectionPaths = options.sectionPaths ?? index.sectionPaths
  const resourcePaths = options.resourcePaths ?? index.resourcePaths
  const { styleCharacterIds, ...header } = decodeHeader(await reader.readOrderedXml(index.headerPath))
  const sectionXml = await Promise.all(sectionPaths.map(async (path) => ({ path, nodes: await reader.readOrderedXml(path) })))
  const sectionNodes = sectionXml.flatMap(({ nodes }) => walkOrderedXml(nodes))
  const pagePr = sectionNodes.find((node) => node.name === 'hp:pagePr')
  const margin = pagePr ? child(pagePr, 'hp:margin') : undefined
  const columnResults = sectionXml.map(({ path, nodes }) => decodeColumnLayout(nodes, path))
  const placeholderDiagnostics: ViewerDiagnostic[] = []
  const sections = sectionXml.map(({ path, nodes }, position) => {
    const sectionIndex = Number(path.match(/section(\d+)\.xml$/)?.[1] ?? 0)
    const root = nodes.find((node) => node.name === 'hs:sec')
    const context: DecodeContext = {
      sectionPath: path,
      sourceSection: path,
      styleCharacterIds,
      objectOrdinals: objectOrdinals(nodes),
      notes: []
    }
    const blocks = root
      ? applyParagraphMarkers(
          children(root, 'hp:p').map((p, index) => decodeParagraph(p, `s${sectionIndex}:p${index}`, context)),
          header.paraStyles
        )
      : []
    const noteList = noteListBlock(context.notes, `s${sectionIndex}:notes`)
    const section: ViewerSection = {
      id: `section-${sectionIndex}`,
      blocks: noteList ? [...blocks, noteList] : blocks,
      pageNumber: decodePageNumber(nodes),
      columnLayout: columnResults[position].columnLayout,
      headers: decodeHeaderFooters(nodes, 'hp:header', sectionIndex, context).map((control) => ({
        ...control,
        paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
      })),
      footers: decodeHeaderFooters(nodes, 'hp:footer', sectionIndex, context).map((control) => ({
        ...control,
        paragraphs: applyParagraphMarkers(control.paragraphs, header.paraStyles)
      }))
    }
    placeholderDiagnostics.push(...objectPlaceholderDiagnostics(section, path))
    return section
  })
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
  const resources = Object.fromEntries(resourceEntries)
  return {
    page: { width: num(pagePr?.attributes.width), height: num(pagePr?.attributes.height), margin: box(margin), headerOffset: num(margin?.attributes.header), footerOffset: num(margin?.attributes.footer) },
    ...header,
    resources,
    sections,
    diagnostics: [...columnResults.flatMap(({ diagnostics }) => diagnostics), ...placeholderDiagnostics]
  }
}
