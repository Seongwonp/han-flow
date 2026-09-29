import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { forgetPackageTrees, packageEntryTree, putPackageTrees, takePackageTrees } from '../../src/core/editing/package_trees'
import {
  applyReplaceParagraphFragmentCommand,
  MergeParagraphDirection,
  ParagraphPatchResult,
  planMergeParagraph,
  planReplaceParagraphSelection,
  planSplitParagraph,
  ReplaceParagraphFragmentCommand,
  selectionSpansParagraphs
} from '../../src/core/editing/paragraph_patch'
import {
  legacyApplyReplaceParagraphFragmentCommand,
  legacyPlanMergeParagraph,
  legacyPlanReplaceParagraphSelection,
  legacyPlanSplitParagraph,
  legacySelectionSpansParagraphs
} from '../../src/core/editing/paragraph_patch_legacy'
import { EditorSelection, createEditorSelection, normalizeEditorSelection } from '../../src/core/editing/selection'
import { decodeXmlEntities, nearestSourceAncestor, serializeSourceNode, SourceElement } from '../../src/core/editing/source_tree'
import {
  encodeHwpxTextContent,
  HwpxTextAnchor,
  listHwpxTextAnchors,
  locateHwpxTextElement
} from '../../src/core/editing/text_patch'
import { isSurrogateBoundarySafe, nearestAncestor, scanXmlElements } from '../../src/core/editing/xml_scan'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// 3단계 tree 전환 관문: 문단 분할(Enter)·경계 병합(Backspace·Delete)·여러 문단 범위 치환을 새 tree 경로(`paragraph_patch`)와
// 전환 전 문자열 경로(`paragraph_patch_legacy`)에 똑같이 계획·적용해 비교한다.
// - 오류: 종류·message가 같다.
// - 영향받는 `hp:t`(분할 대상, 범위 치환의 시작·끝)의 원문이 기본 표기(inline element·비표준 entity 없음)이면 command·section
//   bytes·revision·inverse·loss report·selection이 같다. 아니면 새 경로가 지우지 않은 부분의 원문 표기를 그대로 남긴 결과가
//   전환 전 결과에서 그 `hp:t` 내용만 원문 조각으로 바꾼 것과 같다.
// - 모든 경우 inverse가 원래 bytes를, 그 inverse가 편집 결과 bytes를 정확히 되살린다.
// 또 편집 가능한 모든 문단에 "가운데 Enter → 새 문단 맨 앞 Backspace"를 적용해 결과가 정책상 차이(`hp:linesegarray` 제거와
// 대상 run이 두 run으로 나뉜 것)만 남기고 나머지 bytes가 같음을 확인한다.

interface ManifestFixture {
  id: string
  source?: 'generator' | 'file'
  generator?: string
  fileName?: string
  file?: string
  options?: Record<string, unknown>
  expected: { outcome: string }
}

const publicRoot = join(__dirname, '../fixtures/public')
const manifest = JSON.parse(
  readFileSync(join(publicRoot, 'hwpx_corpus_manifest.json'), 'utf8')
) as { fixtures: ManifestFixture[] }
const openedFixtures = manifest.fixtures.filter((fixture) => fixture.expected.outcome === 'opened')

/** 같은 문단을 반복한 synthetic 대형 fixture만 differential 실행 시간 때문에 문단을 고르게 뽑는다. */
const LARGE_FIXTURE_PARAGRAPHS = 1_000
const LARGE_FIXTURE_SAMPLE = 40
const RANGE_INSERTS = ['', '삽입', '둘째\n줄']

type Command =
  | { kind: 'split'; selection: EditorSelection }
  | { kind: 'merge'; selection: EditorSelection; direction: MergeParagraphDirection }
  | { kind: 'range'; selection: EditorSelection; insert: string }

interface Plan {
  command: ReplaceParagraphFragmentCommand
  selectionAfter: EditorSelection
  affectedTextNodeIds?: readonly string[]
}

/** 한 section 안 편집 가능한 anchor를 가장 가까운 `hp:p`별로 묶은 것(문서 순서). */
interface ParagraphGroup {
  sectionPath: string
  anchors: HwpxTextAnchor[]
}

function attempt<T>(run: () => T): { value: T } | { error: Error } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: error as Error }
  }
}

function safeOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, offset))
  while (!isSurrogateBoundarySafe(text, value)) value -= 1
  return value
}

function paragraphGroups(sourcePackage: HwpxSourcePackage, sectionPath: string): ParagraphGroup[] {
  const groups = new Map<SourceElement, ParagraphGroup>()
  for (const anchor of listHwpxTextAnchors(sourcePackage, sectionPath)) {
    const located = locateHwpxTextElement(sourcePackage, sectionPath, anchor.textNodeId)!
    const paragraph = nearestSourceAncestor(located.element, 'hp:p')
    if (!paragraph) continue
    let group = groups.get(paragraph)
    if (!group) {
      group = { sectionPath, anchors: [] }
      groups.set(paragraph, group)
    }
    group.anchors.push(anchor)
  }
  return [...groups.values()]
}

function pick<T>(items: T[]): T[] {
  if (items.length <= LARGE_FIXTURE_PARAGRAPHS) return items
  const picked = new Set<number>()
  const step = items.length / LARGE_FIXTURE_SAMPLE
  for (let position = 0; picked.size < LARGE_FIXTURE_SAMPLE; position += step) picked.add(Math.floor(position))
  return [...picked].sort((left, right) => left - right).map((index) => items[index])
}

function paragraphMiddle(group: ParagraphGroup): { anchor: HwpxTextAnchor; offset: number } {
  const total = group.anchors.reduce((sum, anchor) => sum + anchor.text.length, 0)
  let remaining = Math.floor(total / 2)
  for (const anchor of group.anchors) {
    if (remaining <= anchor.text.length) return { anchor, offset: safeOffset(anchor.text, remaining) }
    remaining -= anchor.text.length
  }
  return { anchor: group.anchors[0], offset: 0 }
}

/** 문단 하나에 적용할 결정적 command 목록. `following`은 같은 section에서 뒤따르는 문단 묶음(범위 치환 끝). */
function commandsFor(group: ParagraphGroup, following: ParagraphGroup[]): Command[] {
  const { sectionPath } = group
  const first = group.anchors[0]
  const last = group.anchors[group.anchors.length - 1]
  const middle = paragraphMiddle(group)
  const commands: Command[] = [
    { kind: 'split', selection: createEditorSelection(sectionPath, first.textNodeId, 0) },
    { kind: 'split', selection: createEditorSelection(sectionPath, middle.anchor.textNodeId, middle.offset) },
    { kind: 'split', selection: createEditorSelection(sectionPath, last.textNodeId, last.text.length) },
    { kind: 'merge', selection: createEditorSelection(sectionPath, first.textNodeId, 0), direction: 'previous' },
    {
      kind: 'merge',
      selection: createEditorSelection(sectionPath, last.textNodeId, last.text.length),
      direction: 'next'
    }
  ]
  const startOffset = safeOffset(first.text, Math.floor(first.text.length / 2))
  for (const target of following.slice(0, 2)) {
    const end = target.anchors[0]
    for (const insert of RANGE_INSERTS) {
      commands.push({
        kind: 'range',
        insert,
        selection: {
          sectionPath,
          anchorTextNodeId: first.textNodeId,
          anchorOffset: startOffset,
          focusTextNodeId: end.textNodeId,
          focusOffset: safeOffset(end.text, Math.ceil(end.text.length / 2))
        }
      })
    }
  }
  return commands
}

function planTree(sourcePackage: HwpxSourcePackage, command: Command): Plan {
  if (command.kind === 'split') return planSplitParagraph(sourcePackage, command.selection)
  if (command.kind === 'merge') return planMergeParagraph(sourcePackage, command.selection, command.direction)
  return planReplaceParagraphSelection(sourcePackage, command.selection, command.insert)
}

function planLegacy(sourcePackage: HwpxSourcePackage, command: Command): Plan {
  if (command.kind === 'split') return legacyPlanSplitParagraph(sourcePackage, command.selection)
  if (command.kind === 'merge') return legacyPlanMergeParagraph(sourcePackage, command.selection, command.direction)
  return legacyPlanReplaceParagraphSelection(sourcePackage, command.selection, command.insert)
}

// ---------------------------------------------------------------------------
// 원문 표기 oracle(제품 코드와 독립): hp:t 내용 원문을 논리 offset에서 자른다.

const INLINE_CONTROL = /^<hp:(tab|lineBreak)\b[^>]*\/>/

/** `hp:t` 내용 원문을 논리 offset에서 자른 앞·뒤 원문. inline control은 한 글자이고, offset 위치의 control은 뒤에 속한다. */
function cutContent(content: string, offset: number): [string, string] {
  let logical = 0
  let index = 0
  while (index < content.length && logical < offset) {
    const control = content.slice(index).match(INLINE_CONTROL)
    if (control) {
      logical += 1
      index += control[0].length
    } else if (content[index] === '&') {
      const end = content.indexOf(';', index) + 1
      logical += decodeXmlEntities(content.slice(index, end)).length
      index = end
    } else {
      logical += 1
      index += 1
    }
  }
  if (logical !== offset) throw new Error('cutContent: offset이 원문 경계가 아닙니다.')
  return [content.slice(0, index), content.slice(index)]
}

/** section XML에서 N번째 hp:t 원문 내용(자기 닫힘이면 ''). */
function textContentAt(xml: string, ordinal: number): string {
  const span = scanXmlElements(xml).filter((candidate) => candidate.name === 'hp:t')[ordinal]
  return xml.slice(span.openEnd, span.closeStart)
}

/** fragment 안 hp:t 목록 가운데 `index`번째 내용 원문을 바꾼다(자기 닫힘이면 그대로). */
function replaceFragmentTextContents(fragment: string, contents: ReadonlyMap<number, string>): string {
  const texts = scanXmlElements(fragment).filter((span) => span.name === 'hp:t')
  let result = fragment
  for (const [index, content] of [...contents].sort((left, right) => right[0] - left[0])) {
    const span = texts[index]
    if (span.openEnd === span.end) continue
    result = result.slice(0, span.openEnd) + content + result.slice(span.closeStart)
  }
  return result
}

function ordinalOf(textNodeId: string): number {
  return Number(textNodeId.slice(textNodeId.lastIndexOf(':') + 1))
}

/** 경계 hp:t가 기본 표기(원문 내용 = 논리 text의 기본 escape)인지. */
function isDefaultSpelling(xml: string, anchor: HwpxTextAnchor): boolean {
  return textContentAt(xml, anchor.ordinal) === encodeHwpxTextContent(anchor.text)
}

describe('문단 분할·병합·범위 치환 tree differential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-paragraph-tree-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  const totals = {
    fixtures: 0,
    paragraphs: 0,
    commands: 0,
    rejected: 0,
    applied: 0,
    identical: 0,
    preserved: 0,
    undos: 0,
    redos: 0,
    byKind: {} as Record<string, number>,
    identityParagraphs: 0,
    identityRejected: 0,
    identityRemovedLinesegs: 0
  }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') {
      console.log(`HAN_FLOW_PARAGRAPH_TREE_DIFFERENTIAL ${JSON.stringify(totals)}`)
    }
  })

  function section(sourcePackage: HwpxSourcePackage, sectionPath: string): string {
    return sourcePackage.readEntry(sectionPath).toString('utf8')
  }

  /**
   * 경계 hp:t가 기본 표기가 아닐 때 새 경로가 만들어야 하는 교체 fragment: 전환 전 fragment에서 경계 hp:t 내용만
   * 원문 조각(지우지 않은 부분의 원문 표기 + 새 text의 기본 escape)으로 바꾼 것.
   */
  function preservedReplacement(
    base: HwpxSourcePackage,
    command: Command,
    legacyPlan: Plan
  ): { fragment: string; identical: boolean } {
    const xml = section(base, command.selection.sectionPath)
    const normalized = normalizeEditorSelection(base, command.selection)
    const anchors = listHwpxTextAnchors(base, command.selection.sectionPath)
    const startAnchor = anchors.find((anchor) => anchor.textNodeId === normalized.start.textNodeId)!
    const endAnchor = anchors.find((anchor) => anchor.textNodeId === normalized.end.textNodeId)!
    if (command.kind === 'merge') return { fragment: legacyPlan.command.replacementFragment, identical: true }
    const identical = isDefaultSpelling(xml, startAnchor) && isDefaultSpelling(xml, endAnchor)
    if (identical) return { fragment: legacyPlan.command.replacementFragment, identical }
    // 경계 hp:t는 첫 문단 fragment 안에서 (시작 문단의 대상 run 앞 hp:t 수)번째와 그다음이다.
    const spans = scanXmlElements(xml)
    const texts = spans.filter((span) => span.name === 'hp:t')
    const startText = texts[startAnchor.ordinal]
    const paragraph = nearestAncestor(startText, 'hp:p')!
    const before = texts.filter((span) => span.start >= paragraph.openEnd && span.start < startText.start).length
    const startContent = textContentAt(xml, startAnchor.ordinal)
    const endContent = textContentAt(xml, endAnchor.ordinal)
    const contents = new Map<number, string>()
    if (command.kind === 'split') {
      contents.set(before, cutContent(startContent, normalized.start.offset)[0])
      contents.set(before + 1, cutContent(startContent, normalized.end.offset)[1])
    } else {
      contents.set(before, cutContent(startContent, normalized.start.offset)[0] + encodeHwpxTextContent(command.insert))
      contents.set(before + 1, cutContent(endContent, normalized.end.offset)[1])
    }
    return {
      fragment: replaceFragmentTextContents(legacyPlan.command.replacementFragment, contents),
      identical
    }
  }

  function apply(sourcePackage: HwpxSourcePackage, command: ReplaceParagraphFragmentCommand): ParagraphPatchResult {
    return applyReplaceParagraphFragmentCommand(sourcePackage, command)
  }

  /** command 하나를 두 경로로 계획·적용·되돌리기·다시 적용하며 비교하고, 다음 command에 쓸 package(원문 bytes)를 돌려준다. */
  function compare(base: HwpxSourcePackage, command: Command): HwpxSourcePackage {
    const { sectionPath } = command.selection
    totals.commands += 1
    const originalXml = section(base, sectionPath)
    if (command.kind === 'range') {
      const legacySpans = attempt(() => legacySelectionSpansParagraphs(base, command.selection))
      const treeSpans = attempt(() => selectionSpansParagraphs(base, command.selection))
      if ('error' in legacySpans) expect('error' in treeSpans && treeSpans.error.message).toBe(legacySpans.error.message)
      else expect('value' in treeSpans && treeSpans.value).toBe(legacySpans.value)
    }
    const legacy = attempt(() => planLegacy(base, command))
    const tree = attempt(() => planTree(base, command))
    if ('error' in legacy) {
      expect('error' in tree ? { name: tree.error.constructor.name, message: tree.error.message } : 'no error').toEqual({
        name: legacy.error.constructor.name,
        message: legacy.error.message
      })
      if ('error' in tree) {
        expect((tree.error as { code?: string }).code).toBe((legacy.error as { code?: string }).code)
      }
      totals.rejected += 1
      return base
    }
    if ('error' in tree) throw tree.error
    const expected = preservedReplacement(base, command, legacy.value)
    expect(tree.value.selectionAfter).toEqual(legacy.value.selectionAfter)
    expect(tree.value.affectedTextNodeIds).toEqual(legacy.value.affectedTextNodeIds)
    expect(tree.value.command).toEqual({ ...legacy.value.command, replacementFragment: expected.fragment })

    const treeResult = apply(base, tree.value.command)
    const legacyResult = legacyApplyReplaceParagraphFragmentCommand(base, legacy.value.command)
    const treeXml = section(treeResult.package, sectionPath)
    const legacyXml = section(legacyResult.package, sectionPath)
    expect(treeResult.package.revision).toBe(legacyResult.package.revision)
    expect(treeResult.lossReport).toEqual(legacyResult.lossReport)
    if (expected.identical) {
      expect(treeXml === legacyXml).toBe(true)
      expect(treeResult.inverse).toEqual(legacyResult.inverse)
      totals.identical += 1
    } else {
      const at = originalXml.indexOf(tree.value.command.expectedFragment)
      expect(legacyXml.slice(0, at) === originalXml.slice(0, at)).toBe(true)
      expect(treeXml).toBe(originalXml.slice(0, at) + expected.fragment + originalXml.slice(at + tree.value.command.expectedFragment.length))
      // 경계 hp:t가 기본 표기가 아니어도 남는 조각이 기본 표기이면 결과가 전환 전과 같을 수 있다.
      if (treeXml === legacyXml) totals.identical += 1
      else totals.preserved += 1
    }
    totals.applied += 1
    totals.byKind[command.kind] = (totals.byKind[command.kind] ?? 0) + 1
    // 계획이 돌려준 selection은 결과 문서에서 유효하고, anchor 논리 text는 두 경로가 같다.
    normalizeEditorSelection(treeResult.package, tree.value.selectionAfter)
    expect(listHwpxTextAnchors(treeResult.package, sectionPath).map((anchor) => anchor.text)).toEqual(
      listHwpxTextAnchors(legacyResult.package, sectionPath).map((anchor) => anchor.text)
    )
    // tree에서 다시 만든 hp:t 색인·cache된 tree가 새로 parse한 결과와 같다.
    if (totals.applied % 5 === 0) {
      expect(serializeSourceNodeTree(treeResult.package, sectionPath)).toBe(treeXml)
      const cachedAnchors = listHwpxTextAnchors(treeResult.package, sectionPath)
      const cached = takePackageTrees(treeResult.package)
      expect(listHwpxTextAnchors(treeResult.package, sectionPath)).toEqual(cachedAnchors)
      putPackageTrees(treeResult.package, cached)
    }

    const undo = apply(treeResult.package, treeResult.inverse)
    expect(section(undo.package, sectionPath) === originalXml).toBe(true)
    totals.undos += 1
    const redo = apply(undo.package, undo.inverse)
    expect(section(redo.package, sectionPath) === treeXml).toBe(true)
    totals.redos += 1
    const back = apply(redo.package, redo.inverse)
    expect(section(back.package, sectionPath) === originalXml).toBe(true)
    return back.package
  }

  function serializeSourceNodeTree(sourcePackage: HwpxSourcePackage, sectionPath: string): string {
    const tree = packageEntryTree(sourcePackage, sectionPath)
    return tree.children.map((node) => serializeSourceNode(tree, node)).join('')
  }

  async function runDifferential(original: HwpxSourcePackage, sectionPaths: readonly string[]): Promise<void> {
    const all = sectionPaths.flatMap((sectionPath) => {
      const groups = paragraphGroups(original, sectionPath)
      return groups.map((group, index) => ({ group, following: groups.slice(index + 1, index + 3) }))
    })
    let current = original
    pick(all).forEach(({ group, following }, position) => {
      totals.paragraphs += 1
      // 주기적으로 cache를 지워 cache miss(첫 조회 parse) 경로도 섞는다.
      if (position % 7 === 3) forgetPackageTrees(current)
      for (const command of commandsFor(group, following)) current = compare(current, command)
    })
  }

  test('비교 대상에 synthetic·external fixture가 모두 있다', () => {
    expect(openedFixtures.length).toBe(34)
    expect(openedFixtures.filter((fixture) => fixture.source === 'file').length).toBeGreaterThanOrEqual(20)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: 문단 command가 전환 전 경로와 같은 오류·결과를 만들고(비기본 표기 hp:t는 원문 보존) undo·redo가 정확하다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      totals.fixtures += 1
      await runDifferential(original, index.sectionPaths)
    },
    600_000
  )

  test('inline hp:tab·비표준 entity·원문 CR/LF가 섞인 손 작성 section도 비교한다', async () => {
    const base = await HwpxSourcePackage.open(generators.createRoundTripHwpx(directory, 'paragraph-handwritten.hwpx'))
    const sectionPath = 'Contents/section0.xml'
    const TAB = '<hp:tab width="3112" leader="0" type="1"/>'
    const paragraph = (id: number, runs: string[]): string =>
      `<hp:p id="${id}" paraPrIDRef="0"><hp:run charPrIDRef="0">${runs.join('</hp:run><hp:run charPrIDRef="1">')}</hp:run>` +
      '<hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000"/></hp:linesegarray></hp:p>'
    const xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\r\n',
      '<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">\r\n',
      paragraph(1, [`<hp:t>탭${TAB}뒤&#x41;&apos;끝</hp:t>`, '<hp:t>둘째 run</hp:t>']),
      paragraph(2, [`<hp:t>앞${TAB}</hp:t>`]),
      paragraph(3, ['<hp:t>줄<hp:lineBreak/>바꿈\r\n셋&#13;</hp:t>', `<hp:t>${TAB}<hp:tab/>x</hp:t>`]),
      paragraph(4, ['<hp:t>기본 표기 &amp; 문단</hp:t>']),
      paragraph(5, ['<hp:t/>']),
      '\r\n</hs:sec>\r\n'
    ].join('')
    const source = base.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
    const before = totals.preserved
    await runDifferential(source, [sectionPath])
    expect(totals.preserved).toBeGreaterThan(before)
  })

  // -------------------------------------------------------------------------
  // 분할 뒤 병합 identity

  // 뒤 문단부터 처리하므로 대상 문단과 그 앞 bytes는 원래 section과 같다. 원래 section을 한 번만 scan해 그 위치를 쓴다.
  let lastScan: { xml: string; spans: ReturnType<typeof scanXmlElements>; texts: ReturnType<typeof scanXmlElements> } | undefined
  function scanned(xml: string): NonNullable<typeof lastScan> {
    if (lastScan?.xml !== xml) {
      const spans = scanXmlElements(xml)
      lastScan = { xml, spans, texts: spans.filter((span) => span.name === 'hp:t') }
    }
    return lastScan
  }

  /** 가운데 Enter → 새 문단 맨 앞 Backspace를 한 뒤 기대 bytes(원문에서 정책상 차이만 반영)와 비교한다. */
  function splitMergeIdentity(
    base: HwpxSourcePackage,
    group: ParagraphGroup,
    sourceXml: string
  ): HwpxSourcePackage {
    const { sectionPath } = group
    const middle = paragraphMiddle(group)
    const caret = createEditorSelection(sectionPath, middle.anchor.textNodeId, middle.offset)
    const split = attempt(() => planSplitParagraph(base, caret))
    if ('error' in split) {
      totals.identityRejected += 1
      return base
    }
    totals.identityParagraphs += 1
    const originalXml = section(base, sectionPath)
    const splitResult = apply(base, split.value.command)
    const merge = planMergeParagraph(splitResult.package, split.value.selectionAfter, 'previous')
    const merged = apply(splitResult.package, merge.command)
    const mergedXml = section(merged.package, sectionPath)

    // 기대값: 원문 문단에서 hp:linesegarray(와 문단 자식 사이·run 안 공백)를 빼고, 대상 run을 같은 run·hp:t tag의 두 run으로
    // 나눠 원래 hp:t 내용 원문을 가운데 offset에서 자른 두 조각을 담는다. 그 밖의 bytes는 원문과 같다.
    const { spans, texts } = scanned(sourceXml)
    const text = texts[middle.anchor.ordinal]
    const run = nearestAncestor(text, 'hp:run')!
    const paragraph = nearestAncestor(text, 'hp:p')!
    const children: typeof spans = []
    for (let index = spans.indexOf(paragraph) + 1; index < spans.length && spans[index].start < paragraph.end; index += 1) {
      if (spans[index].parent === paragraph) children.push(spans[index])
    }
    const slice = (start: number, end: number): string => sourceXml.slice(start, end)
    expect(originalXml.slice(0, paragraph.end) === sourceXml.slice(0, paragraph.end)).toBe(true)
    const [left, right] = cutContent(slice(text.openEnd, text.closeStart), middle.offset)
    const selfClosing = text.openEnd === text.end
    const textSource = (content: string): string =>
      selfClosing ? slice(text.start, text.end) : slice(text.start, text.openEnd) + content + slice(text.closeStart, text.end)
    const runSource = (content: string): string =>
      slice(run.start, run.openEnd) + textSource(content) + slice(run.closeStart, run.end)
    const expectedParagraph =
      slice(paragraph.start, paragraph.openEnd) +
      children
        .filter((child) => child.name === 'hp:run')
        .map((child) => (child === run ? runSource(left) + runSource(right) : slice(child.start, child.end)))
        .join('') +
      slice(paragraph.closeStart, paragraph.end)
    if (children.some((child) => child.name === 'hp:linesegarray')) totals.identityRemovedLinesegs += 1
    const expected = originalXml.slice(0, paragraph.start) + expectedParagraph + originalXml.slice(paragraph.end)
    expect(mergedXml === expected).toBe(true)

    // 두 단계를 되돌리면 원래 bytes다(실행 시간 때문에 일부 문단만 — 모든 command의 undo·redo는 위 differential이 확인한다).
    if (totals.identityParagraphs % 16 === 1) {
      const unmerged = apply(merged.package, merged.inverse)
      const unsplit = apply(unmerged.package, splitResult.inverse)
      expect(section(unsplit.package, sectionPath) === originalXml).toBe(true)
    }
    return merged.package
  }

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: 편집 가능한 모든 문단에서 Enter 뒤 Backspace가 정책상 차이 밖의 bytes를 바꾸지 않는다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      let current = original
      for (const sectionPath of index.sectionPaths) {
        // 뒤 문단부터 처리한다. 결과 package를 이어 쓰므로 앞 문단의 hp:t ordinal은 바뀌지 않는다.
        const sourceXml = section(original, sectionPath)
        for (const group of paragraphGroups(original, sectionPath).reverse()) {
          current = splitMergeIdentity(current, group, sourceXml)
        }
      }
    },
    600_000
  )

  test('differential이 분할·병합·범위 치환과 원문 보존 경로를 모두 거쳤다', () => {
    expect(totals.byKind.split).toBeGreaterThan(0)
    expect(totals.byKind.merge).toBeGreaterThan(0)
    expect(totals.byKind.range).toBeGreaterThan(0)
    expect(totals.rejected).toBeGreaterThan(0)
    expect(totals.preserved).toBeGreaterThan(0)
    expect(totals.identityParagraphs).toBeGreaterThan(0)
  })
})
