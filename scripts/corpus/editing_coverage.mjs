import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixtureSource, prepareCorpusFixture, validateCorpusManifest } from './public_corpus.mjs'
import { loadGenerator, loadTypeScriptModule, publicFixtureRoot } from './corpus_runtime.mjs'

// 편집 세션과 같은 경로(HwpxSourcePackage.open → decodeViewerDocument → editingCapabilities →
// patch module dry-run)로 문서마다 실제로 편집 가능한 text run·문단·표 셀·표 비율을 잰다.
// 보고서에는 개수와 고정 사유 code만 남기고 문서 본문·경로는 넣지 않는다.

export const COVERAGE_MARKER = 'HAN_FLOW_EDITING_COVERAGE'
export const CONTAINERS = ['body', 'tableCell', 'headerFooter', 'note', 'textBox', 'field']
const INLINE_TEXT_CHILDREN = new Set(['#text', 'hp:tab', 'hp:lineBreak'])
const SPECIAL_CONTAINERS = {
  'hp:header': 'headerFooter',
  'hp:footer': 'headerFooter',
  'hp:footNote': 'note',
  'hp:endNote': 'note',
  'hp:drawText': 'textBox',
  'hp:fieldBegin': 'field'
}
const DECODER_SKIP_CODES = {
  note: 'DECODER_SKIPS_FOOTNOTE_ENDNOTE',
  textBox: 'DECODER_SKIPS_TEXT_BOX',
  field: 'DECODER_SKIPS_FIELD_SUBLIST',
  headerFooter: 'DECODER_SKIPS_HEADER_FOOTER',
  tableCell: 'DECODER_SKIPS_TABLE_CELL',
  body: 'DECODER_SKIPS_BODY'
}

let editingCore

function loadEditingCore() {
  if (editingCore) return editingCore
  editingCore = {
    HwpxSourcePackage: loadTypeScriptModule('src/core/parser/source_package.ts').HwpxSourcePackage,
    decodeViewerDocument: loadTypeScriptModule('src/core/parser/viewer_decoder.ts').decodeViewerDocument,
    ...loadTypeScriptModule('src/core/editing/editing_capability.ts'),
    listHwpxTextAnchors: loadTypeScriptModule('src/core/editing/text_patch.ts').listHwpxTextAnchors,
    ...loadTypeScriptModule('src/core/editing/style_patch.ts'),
    applyCellStyleCommand: loadTypeScriptModule('src/core/editing/cell_style_patch.ts').applyCellStyleCommand,
    ...loadTypeScriptModule('src/core/editing/table_patch.ts')
  }
  return editingCore
}

const nonWhitespace = (text) => (text.match(/\S/gu) ?? []).length
const deepText = (node) => node.name === '#text' ? node.text ?? '' : node.children.map(deepText).join('')

// patch module 오류 message를 문서 내용 없이 안정적인 code로 줄인다.
// `: ` 뒤(anchor id, tag 일부 등 가변 정보)를 버리고 첫 문장만 남긴다.
export function normalizeRejection(module, error) {
  const message = error instanceof Error ? error.message : String(error)
  const head = message.split(': ')[0]
  const sentence = head.match(/^.*?[.。](?=\s|$)/u)?.[0] ?? head
  return `${module}: ${sentence.trim()}`
}

function collapsed(sectionPath, textNodeId) {
  return { sectionPath, anchorTextNodeId: textNodeId, anchorOffset: 0, focusTextNodeId: textNodeId, focusOffset: 0 }
}

function attempt(module, action) {
  try {
    action()
    return undefined
  } catch (error) {
    return normalizeRejection(module, error)
  }
}

// 본문 글자와 줄 배치 캐시(hp:linesegarray)를 뺀 subtree 구조 서명. style·셀 style patch의 수락/거부는
// 대상 문단(또는 셀)의 element 구조·속성과 문서 전역 header에만 의존하므로, 서명이 같으면 dry-run 결과도 같다.
// patch module은 명령마다 section 전체를 다시 훑기 때문에(O(section)) 이 memo 없이는 큰 문서가 O(run²)이 된다.
const signatures = new WeakMap()
export function structureSignature(node) {
  if (signatures.has(node)) return signatures.get(node)
  const attributes = Object.keys(node.attributes).sort().map((key) => `${key}=${JSON.stringify(node.attributes[key])}`)
  const inner = node.children
    .filter((item) => item.name !== 'hp:linesegarray' && !(item.name === '#text' && node.name === 'hp:t'))
    .map((item) => item.name === '#text' ? '#' : structureSignature(item))
  const signature = `<${node.name} ${attributes.join(' ')}>${inner.join('')}</>`
  signatures.set(node, signature)
  return signature
}

// section XML 원본에서 모든 hp:t와 그 소속(문단·셀·표·컨테이너)을 문서 순서대로 모은다.
function collectRawStructure(sectionPath, nodes, structure) {
  const visit = (node, context) => {
    let next = context
    if (SPECIAL_CONTAINERS[node.name] && !context.special) next = { ...next, special: SPECIAL_CONTAINERS[node.name] }
    if (node.name === 'hp:tbl') {
      const table = { cells: [] }
      structure.tables.push(table)
      next = { ...next, table }
    } else if (node.name === 'hp:tc') {
      const cell = { runs: [], node }
      structure.cells.push(cell)
      next.table?.cells.push(cell)
      next = { ...next, cell, inCell: true }
    } else if (node.name === 'hp:p') {
      const paragraph = { sectionPath, runs: [], node, parentName: context.parentName }
      structure.paragraphs.push(paragraph)
      next = { ...next, paragraph }
    } else if (node.name === 'hp:t') {
      const mixedChildren = [...new Set(
        node.children.filter((item) => !INLINE_TEXT_CHILDREN.has(item.name)).map((item) => item.name)
      )].sort()
      const run = {
        sectionPath,
        textNodeId: `${sectionPath}#hp:t:${node.sourceOrdinal}`,
        container: context.special ?? (context.inCell ? 'tableCell' : 'body'),
        characters: nonWhitespace(deepText(node)),
        mixedChildren,
        paragraph: context.paragraph,
        indexInParagraph: context.paragraph?.runs.length ?? -1
      }
      structure.runs.push(run)
      context.paragraph?.runs.push(run)
      context.cell?.runs.push(run)
      return
    }
    next = { ...next, parentName: node.name }
    for (const item of node.children) visit(item, next)
  }
  for (const node of nodes) visit(node, {})
}

// viewer_decoder가 방문하는 hp:t 위치를 그대로 따라가 "decoder가 아예 보지 않는" run을 구분한다.
function decoderReach(sectionPath, nodes) {
  const reached = new Set()
  const paragraph = (node) => {
    for (const run of node.children.filter((item) => item.name === 'hp:run')) {
      for (const item of run.children) {
        if (item.name === 'hp:t') reached.add(`${sectionPath}#hp:t:${item.sourceOrdinal}`)
        if (item.name === 'hp:tbl') {
          for (const row of item.children.filter((child) => child.name === 'hp:tr')) {
            for (const cell of row.children.filter((child) => child.name === 'hp:tc')) {
              const subList = cell.children.find((child) => child.name === 'hp:subList')
              subList?.children.filter((child) => child.name === 'hp:p').forEach(paragraph)
            }
          }
        }
      }
    }
  }
  const root = nodes.find((node) => node.name === 'hs:sec')
  root?.children.filter((node) => node.name === 'hp:p').forEach(paragraph)
  const walk = (node) => {
    if (node.name === 'hp:header' || node.name === 'hp:footer') {
      const subList = node.children.find((child) => child.name === 'hp:subList')
      subList?.children.filter((child) => child.name === 'hp:p').forEach(paragraph)
    }
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return reached
}

// listEditingAnchorContexts가 anchor를 빼는 조건을 decode 결과 위에서 재현해 사유 code를 붙인다.
function paragraphExclusion(paragraph, prefix) {
  if (!paragraph.content.length) return `${prefix}EMPTY_PARAGRAPH`
  if (paragraph.content.some((item) => item.type === 'table')) return `${prefix}PARAGRAPH_HAS_TABLE`
  if (paragraph.content.some((item) => item.type === 'image')) return `${prefix}PARAGRAPH_HAS_IMAGE`
  if (paragraph.content.some((item) => item.type === 'text' && !item.sourceAnchor)) {
    return `${prefix}PARAGRAPH_HAS_UNANCHORED_INLINE`
  }
  return undefined
}

function listingExclusions(document) {
  const reasons = new Map()
  const mark = (paragraph, reason) => {
    for (const item of paragraph.content) {
      if (item.type === 'text' && item.sourceAnchor && !reasons.has(item.sourceAnchor.textNodeId)) {
        reasons.set(item.sourceAnchor.textNodeId, reason)
      }
      if (item.type === 'table') markTable(item, reason === 'HEADER_FOOTER' ? reason : 'NESTED_TABLE')
    }
  }
  const markTable = (table, reason) => {
    for (const row of table.rows) for (const cell of row.cells) for (const paragraph of cell.paragraphs) mark(paragraph, reason)
  }
  // 표 셀 text는 셀 구조(병합·머리글·run 수)와 무관하게 문단 단위로 anchor를 연다. 쪽을 넘어 나뉜 셀 조각만 통째로 뺀다.
  const topLevelTable = (table) => {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        for (const paragraph of cell.paragraphs) {
          mark(paragraph, cell.splitTop || cell.splitBottom ? 'CELL_SPLIT' : paragraphExclusion(paragraph, 'CELL_') ?? 'UNKNOWN')
        }
      }
    }
  }
  for (const section of document.sections) {
    for (const paragraph of section.blocks) {
      const excluded = paragraphExclusion(paragraph, '')
      for (const item of paragraph.content) if (item.type === 'table') topLevelTable(item)
      mark(paragraph, excluded ?? 'UNKNOWN')
    }
    for (const control of [...section.headers, ...section.footers]) {
      for (const paragraph of control.paragraphs) mark(paragraph, 'HEADER_FOOTER')
    }
  }
  return reasons
}

function anchoredIds(document) {
  const ids = new Set()
  const paragraph = (value) => {
    for (const item of value.content) {
      if (item.type === 'text' && item.sourceAnchor) ids.add(item.sourceAnchor.textNodeId)
      if (item.type === 'table') for (const row of item.rows) for (const cell of row.cells) cell.paragraphs.forEach(paragraph)
    }
  }
  for (const section of document.sections) {
    section.blocks.forEach(paragraph)
    for (const control of [...section.headers, ...section.footers]) control.paragraphs.forEach(paragraph)
  }
  return ids
}

function emptyRejections() {
  return { anchor: {}, text: {}, charStyle: {}, paraStyle: {}, tableCell: {}, tableStructure: {} }
}

function count(histogram, key, amount = 1) {
  histogram[key] = (histogram[key] ?? 0) + amount
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)))
}

function emptyContainerCounts() {
  return Object.fromEntries(CONTAINERS.map((container) => [container, { textRuns: 0, textEditable: 0 }]))
}

// 하나의 HWPX 경로를 열어 편집 가능 범위를 센다. 반환 값에는 개수와 사유 code만 있다.
export async function measureEditingCoverage(path) {
  const core = loadEditingCore()
  const sourcePackage = await core.HwpxSourcePackage.open(path)
  const document = await core.decodeViewerDocument(sourcePackage)
  const index = await sourcePackage.index()
  const structure = { runs: [], paragraphs: [], cells: [], tables: [] }
  const reached = new Set()
  for (const sectionPath of index.sectionPaths) {
    const nodes = await sourcePackage.readOrderedXml(sectionPath)
    collectRawStructure(sectionPath, nodes, structure)
    for (const id of decoderReach(sectionPath, nodes)) reached.add(id)
  }
  const anchored = anchoredIds(document)
  const exclusions = listingExclusions(document)
  const listed = new Set(core.listEditingAnchorContexts(document).map((context) => context.textNodeId))
  // editingCapabilities는 호출마다 문서 전체 anchor 목록을 다시 만든다. anchor 목록은 section마다 독립적이므로
  // 대상 section 하나만 담은 view로 호출해 결과는 같게 두고 대형 문서의 O(run²) 비용만 줄인다.
  const sectionViews = new Map(index.sectionPaths.map((sectionPath, position) => [
    sectionPath,
    { ...document, sections: document.sections[position] ? [document.sections[position]] : [] }
  ]))
  const rejections = emptyRejections()
  const dryRuns = new Map()
  const memoAttempt = (key, module, action) => {
    if (!dryRuns.has(key)) dryRuns.set(key, attempt(module, action))
    return dryRuns.get(key)
  }
  const runKey = (kind, run) =>
    `${kind}|${run.paragraph?.parentName}|${run.indexInParagraph}|${run.paragraph ? structureSignature(run.paragraph.node) : ''}`
  const anchorCache = new Map()
  const textAnchors = (sectionPath) => {
    if (!anchorCache.has(sectionPath)) {
      let ids
      try {
        ids = new Set(core.listHwpxTextAnchors(sourcePackage, sectionPath).map((anchor) => anchor.textNodeId))
      } catch {
        ids = new Set()
      }
      anchorCache.set(sectionPath, ids)
    }
    return anchorCache.get(sectionPath)
  }
  const mixedContentChildren = {}
  const lostCharacters = {}
  const byContainer = emptyContainerCounts()
  const metrics = {
    textRuns: structure.runs.length,
    anchored: 0,
    textEditable: 0,
    charStyleEditable: 0,
    paragraphs: structure.paragraphs.length,
    paraStyleEditable: 0,
    tableCells: structure.cells.length,
    tableCellsEditable: 0,
    tableCellStyleEditable: 0,
    tables: structure.tables.length,
    tableStructureEditable: 0,
    characters: 0,
    editableCharacters: 0
  }

  // 1) text run: anchor → capability → text_patch dry-run → 글자 style
  const runState = new Map()
  for (const run of structure.runs) {
    const state = { textEditable: false, reason: undefined, capabilities: undefined }
    runState.set(run.textNodeId, state)
    metrics.characters += run.characters
    byContainer[run.container].textRuns += 1
    if (!anchored.has(run.textNodeId)) {
      state.reason = !reached.has(run.textNodeId)
        ? DECODER_SKIP_CODES[run.container]
        : run.mixedChildren.length ? 'DECODER_MIXED_INLINE_CONTENT' : 'DECODER_NO_SOURCE_ANCHOR'
      for (const name of run.mixedChildren) count(mixedContentChildren, name)
      count(rejections.anchor, state.reason)
      count(lostCharacters, state.reason, run.characters)
      continue
    }
    metrics.anchored += 1
    const selection = collapsed(run.sectionPath, run.textNodeId)
    const capabilities = core.editingCapabilities(sectionViews.get(run.sectionPath), selection)
    state.capabilities = capabilities
    if (!capabilities.text.available) {
      state.reason = !listed.has(run.textNodeId)
        ? `NOT_LISTED_${exclusions.get(run.textNodeId) ?? 'UNKNOWN'}`
        : `capability: ${capabilities.text.reason}`
      count(rejections.text, state.reason)
      count(lostCharacters, state.reason, run.characters)
      continue
    }
    // applyReplaceTextCommand가 caret 위치(0..0) 편집을 거부하는 경우는 text_patch의 anchor 목록에 없을 때뿐이다.
    // 같은 목록(listHwpxTextAnchors)을 section마다 한 번만 만들어 확인한다.
    state.reason = textAnchors(run.sectionPath).has(run.textNodeId)
      ? undefined
      : 'text_patch: text anchor를 찾을 수 없습니다'
    if (state.reason) {
      count(rejections.text, state.reason)
      count(lostCharacters, state.reason, run.characters)
      continue
    }
    state.textEditable = true
    metrics.textEditable += 1
    metrics.editableCharacters += run.characters
    byContainer[run.container].textEditable += 1

    const characterReason = !capabilities.characterStyle.available
      ? `capability: ${capabilities.characterStyle.reason}`
      : memoAttempt(runKey('char', run), 'style_patch', () => {
          const current = document.charStyles[capabilities.focus?.charStyleId ?? '']
          core.applyCharacterStyleCommand(sourcePackage, {
            type: 'apply-character-style',
            sectionPath: run.sectionPath,
            textNodeId: run.textNodeId,
            bold: !current?.bold
          })
        })
    if (characterReason) count(rejections.charStyle, characterReason)
    else metrics.charStyleEditable += 1
  }

  // 2) 문단: 첫 편집 가능 run을 caret 위치로 삼아 문단 style을 dry-run한다.
  for (const paragraph of structure.paragraphs) {
    const ownRuns = paragraph.runs
    const target = ownRuns.find((run) => runState.get(run.textNodeId).textEditable)
    let reason
    if (!ownRuns.length) reason = 'NO_TEXT_NODE'
    else if (!target) reason = `BLOCKED_BY_TEXT: ${runState.get(ownRuns[0].textNodeId).reason}`
    else {
      const capabilities = runState.get(target.textNodeId).capabilities
      reason = !capabilities.paragraphStyle.available
        ? `capability: ${capabilities.paragraphStyle.reason}`
        : memoAttempt(runKey('para', target), 'style_patch', () => {
            const align = document.paraStyles[capabilities.focus?.paraStyleId ?? '']?.align
            core.applyParagraphStyleCommand(sourcePackage, {
              type: 'apply-paragraph-style',
              sectionPath: target.sectionPath,
              textNodeId: target.textNodeId,
              align: align === 'CENTER' ? 'LEFT' : 'CENTER'
            })
          })
    }
    if (reason) count(rejections.paraStyle, reason)
    else metrics.paraStyleEditable += 1
  }

  // 3) 표 셀: 셀에 직접 속한 hp:t가 모두 편집 가능해야 셀 글자를 고칠 수 있다.
  const cellAnchor = new Map()
  for (const cell of structure.cells) {
    const blocked = cell.runs.find((run) => !runState.get(run.textNodeId).textEditable)
    let reason
    if (!cell.runs.length) reason = 'NO_TEXT_NODE'
    else if (blocked) reason = `BLOCKED_BY_TEXT: ${runState.get(blocked.textNodeId).reason}`
    if (reason) {
      count(rejections.tableCell, reason)
      continue
    }
    metrics.tableCellsEditable += 1
    const run = cell.runs[0]
    const capabilities = runState.get(run.textNodeId).capabilities
    if (capabilities.cellStyle.available) {
      cellAnchor.set(cell, run)
      const styleReason = memoAttempt(`cell|${structureSignature(cell.node)}`, 'cell_style_patch', () => core.applyCellStyleCommand(sourcePackage, {
        type: 'apply-cell-style',
        sectionPath: run.sectionPath,
        textNodeId: run.textNodeId,
        borderType: 'SOLID'
      }))
      if (!styleReason) metrics.tableCellStyleEditable += 1
    }
  }

  // 4) 표 구조: 안전한 셀 하나를 골라 행 추가·열 추가 plan을 모두 만들 수 있는지 확인한다.
  for (const table of structure.tables) {
    const cell = table.cells.find((candidate) => cellAnchor.has(candidate))
    let reason
    if (!cell) reason = 'NO_SAFE_CELL_SELECTION'
    else {
      const run = cellAnchor.get(cell)
      const selection = collapsed(run.sectionPath, run.textNodeId)
      reason = attempt('table_patch', () => core.planInsertTableRowAfter(sourcePackage, selection)) ??
        attempt('table_patch', () => core.planInsertTableColumnAfter(sourcePackage, selection))
    }
    if (reason) count(rejections.tableStructure, reason)
    else metrics.tableStructureEditable += 1
  }

  return {
    ...metrics,
    byContainer,
    mixedContentChildren: sortedObject(mixedContentChildren),
    nonEditableCharactersByReason: sortedObject(lostCharacters),
    rejectionReasons: Object.fromEntries(
      Object.entries(rejections).map(([stage, histogram]) => [stage, sortedObject(histogram)])
    )
  }
}

const SUM_KEYS = [
  'textRuns', 'anchored', 'textEditable', 'charStyleEditable', 'paragraphs', 'paraStyleEditable',
  'tableCells', 'tableCellsEditable', 'tableCellStyleEditable', 'tables', 'tableStructureEditable',
  'characters', 'editableCharacters'
]

const ratio = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null

function withRatios(metrics) {
  return {
    ...metrics,
    ratios: {
      anchored: ratio(metrics.anchored, metrics.textRuns),
      textEditable: ratio(metrics.textEditable, metrics.textRuns),
      charStyleEditable: ratio(metrics.charStyleEditable, metrics.textRuns),
      paraStyleEditable: ratio(metrics.paraStyleEditable, metrics.paragraphs),
      tableCellsEditable: ratio(metrics.tableCellsEditable, metrics.tableCells),
      tableStructureEditable: ratio(metrics.tableStructureEditable, metrics.tables),
      characterWeighted: ratio(metrics.editableCharacters, metrics.characters)
    }
  }
}

export function aggregateCoverage(entries) {
  const total = Object.fromEntries(SUM_KEYS.map((key) => [key, 0]))
  const byContainer = emptyContainerCounts()
  const rejections = emptyRejections()
  const mixed = {}
  const lost = {}
  for (const entry of entries) {
    for (const [reason, amount] of Object.entries(entry.nonEditableCharactersByReason)) count(lost, reason, amount)
    for (const key of SUM_KEYS) total[key] += entry[key]
    for (const container of CONTAINERS) {
      byContainer[container].textRuns += entry.byContainer[container].textRuns
      byContainer[container].textEditable += entry.byContainer[container].textEditable
    }
    for (const [name, amount] of Object.entries(entry.mixedContentChildren)) count(mixed, name, amount)
    for (const [stage, histogram] of Object.entries(entry.rejectionReasons)) {
      for (const [reason, amount] of Object.entries(histogram)) count(rejections[stage], reason, amount)
    }
  }
  const top = Object.entries(rejections)
    .flatMap(([stage, histogram]) => Object.entries(histogram).map(([reason, amount]) => ({ stage, reason, count: amount })))
    .sort((left, right) => right.count - left.count || left.stage.localeCompare(right.stage) || left.reason.localeCompare(right.reason))
  return withRatios({
    fixtures: entries.length,
    ...total,
    byContainer,
    mixedContentChildren: sortedObject(mixed),
    nonEditableCharactersByReason: sortedObject(lost),
    rejectionReasons: Object.fromEntries(Object.entries(rejections).map(([stage, histogram]) => [stage, sortedObject(histogram)])),
    topRejectionReasons: top.slice(0, 15)
  })
}

export function createEditingCoverageReport(manifest, results) {
  const fixtures = results.map(({ metrics, ...rest }) => metrics ? { ...rest, ...withRatios(metrics) } : rest)
  const measured = (predicate) => results.filter((result) => result.metrics && predicate(result)).map((result) => result.metrics)
  const categories = [...new Set(results.filter((result) => result.source === 'file').map((result) => result.category))].sort()
  return {
    schemaVersion: 1,
    suite: manifest.suite,
    fixtureCount: results.length,
    measuredCount: results.filter((result) => result.metrics).length,
    totals: {
      all: aggregateCoverage(measured(() => true)),
      synthetic: aggregateCoverage(measured((result) => result.source === 'generator')),
      external: aggregateCoverage(measured((result) => result.source === 'file'))
    },
    externalByCategory: Object.fromEntries(categories.map((category) => {
      const {
        rejectionReasons: _r, topRejectionReasons: _t, mixedContentChildren: _m, byContainer: _b,
        nonEditableCharactersByReason: _n, ...summary
      } =
        aggregateCoverage(measured((result) => result.source === 'file' && result.category === category))
      return [category, summary]
    })),
    fixtures
  }
}

// manifest 순서대로 fixture를 열어 측정한다. 열리지 않는 fixture(거부 기대 포함)는 outcome만 남긴다.
export async function measureCorpusEditingCoverage(manifest, { generator, directory, publicRoot = publicFixtureRoot }) {
  const results = []
  for (const fixture of manifest.fixtures) {
    const base = { id: fixture.id, category: fixture.category, source: fixtureSource(fixture) }
    if (fixture.expected.outcome !== 'opened') {
      results.push({ ...base, outcome: 'skipped' })
      continue
    }
    try {
      const path = prepareCorpusFixture(fixture, { generator, directory, publicRoot })
      results.push({ ...base, outcome: 'measured', metrics: await measureEditingCoverage(path) })
    } catch (error) {
      results.push({ ...base, outcome: 'failed', errorType: error instanceof Error ? error.name : 'UnknownError' })
    }
  }
  return results
}

const percent = (value) => value === null ? '   -  ' : `${(value * 100).toFixed(1).padStart(5)}%`

export function formatCoverageTable(report) {
  const header = ['fixture'.padEnd(34), 'runs', 'anch  ', 'text  ', 'char  ', 'para  ', 'cells ', 'tbl   ', 'chars '].join(' ')
  const line = (label, value) => [
    label.slice(0, 34).padEnd(34),
    String(value.textRuns).padStart(4),
    percent(value.ratios.anchored),
    percent(value.ratios.textEditable),
    percent(value.ratios.charStyleEditable),
    percent(value.ratios.paraStyleEditable),
    percent(value.ratios.tableCellsEditable),
    percent(value.ratios.tableStructureEditable),
    percent(value.ratios.characterWeighted)
  ].join(' ')
  const rows = [header]
  for (const fixture of report.fixtures) {
    rows.push(fixture.ratios ? line(fixture.id, fixture) : `${fixture.id.padEnd(34)} ${fixture.outcome}`)
  }
  rows.push('-'.repeat(header.length))
  for (const [label, value] of Object.entries(report.totals)) rows.push(line(`TOTAL ${label}`, value))
  rows.push('', 'top rejection reasons (all):')
  for (const item of report.totals.all.topRejectionReasons.slice(0, 10)) {
    rows.push(`  ${String(item.count).padStart(5)}  [${item.stage}] ${item.reason}`)
  }
  return rows.join('\n')
}

async function main() {
  const outputArgument = process.argv.indexOf('--output')
  const outputPath = outputArgument >= 0 && process.argv[outputArgument + 1]
    ? resolve(process.argv[outputArgument + 1])
    : undefined
  const manifest = validateCorpusManifest(
    JSON.parse(await readFile(resolve(publicFixtureRoot, 'hwpx_corpus_manifest.json'), 'utf8'))
  )
  const directory = await mkdtemp(join(tmpdir(), 'han-flow-editing-coverage-'))
  try {
    const results = await measureCorpusEditingCoverage(manifest, { generator: loadGenerator(), directory })
    const report = createEditingCoverageReport(manifest, results)
    if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(COVERAGE_MARKER, JSON.stringify(report))
    console.error(formatCoverageTable(report))
    if (results.some((result) => result.outcome === 'failed')) process.exitCode = 1
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
