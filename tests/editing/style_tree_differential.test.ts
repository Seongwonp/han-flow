import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  applyCellStyleCommand,
  applyRestoreCellStyleCommand,
  ApplyCellStyleCommand,
  CellStylePatchResult,
  RestoreCellStyleCommand
} from '../../src/core/editing/cell_style_patch'
import {
  legacyApplyCellStyleCommand,
  legacyApplyRestoreCellStyleCommand
} from '../../src/core/editing/cell_style_patch_legacy'
import { forgetPackageTrees, packageEntryTree, putPackageTrees, takePackageTrees } from '../../src/core/editing/package_trees'
import { serializeSourceTree } from '../../src/core/editing/source_tree'
import {
  applyCharacterStyleCommand,
  applyParagraphStyleCommand,
  applyRestoreCharacterRunCommand,
  applyRestoreStyleCommand,
  ApplyCharacterStyleCommand,
  ApplyParagraphStyleCommand,
  RestoreCharacterRunCommand,
  RestoreStyleCommand,
  StylePatchResult
} from '../../src/core/editing/style_patch'
import {
  legacyApplyCharacterStyleCommand,
  legacyApplyParagraphStyleCommand,
  legacyApplyRestoreCharacterRunCommand,
  legacyApplyRestoreStyleCommand
} from '../../src/core/editing/style_patch_legacy'
import { applyReplaceTextCommand, HwpxTextAnchor, listHwpxTextAnchors } from '../../src/core/editing/text_patch'
import { isSurrogateBoundarySafe } from '../../src/core/editing/xml_scan'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// 2단계 tree 전환 관문: 글자·문단·셀 모양 command를 새 tree 경로(`style_patch`·`cell_style_patch`)와 전환 전 문자열
// 경로(`*_legacy`)에 똑같이 적용해 매번 section·header bytes, revision, inverse, loss report, 오류(종류·message)가 같고,
// inverse로 되돌리면 원래 bytes로, 다시 적용하면 같은 결과로 돌아오는지 확인한다.
// 새 경로는 되돌린 package(원문과 같은 bytes, tree cache가 붙어 있음)를 다음 command의 입력으로 이어 써서 cache hit을,
// fixture마다 첫 command와 주기적인 cache 삭제로 cache miss를 함께 거친다.

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
const HEADER_PATH = 'Contents/header.xml'

/**
 * fixture 하나에서 비교할 anchor 수. 공개 corpus의 external fixture는 모두(최대 126개) 비교하고, 같은 문단을 반복한
 * synthetic 대형 fixture(large-progressive, 19,511 anchor)만 실행 시간 때문에 고르게 뽑는다.
 */
const LARGE_FIXTURE_ANCHORS = 1_000
const LARGE_FIXTURE_SAMPLE = 40

type StyleCommand = ApplyCharacterStyleCommand | ApplyParagraphStyleCommand | ApplyCellStyleCommand
type AnyResult = StylePatchResult | CellStylePatchResult
type AnyInverse = RestoreStyleCommand | RestoreCharacterRunCommand | RestoreCellStyleCommand

function safeOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, offset))
  while (!isSurrogateBoundarySafe(text, value)) value -= 1
  return value
}

/** anchor 하나에 적용할 결정적 style command 목록. */
function commandsFor(sectionPath: string, anchor: HwpxTextAnchor, fontId: string | undefined): StyleCommand[] {
  const base = { sectionPath, textNodeId: anchor.textNodeId }
  const character = (options: Omit<ApplyCharacterStyleCommand, 'type' | 'sectionPath' | 'textNodeId'>): StyleCommand => ({
    type: 'apply-character-style',
    ...base,
    ...options
  })
  const commands: StyleCommand[] = [
    character({ bold: true }),
    character({ bold: false }),
    character({ italic: true, underline: true }),
    character({ strikeout: true, height: 1500, color: '#12ab34' }),
    ...(fontId !== undefined ? [character({ fontId })] : [])
  ]
  const text = anchor.text
  if (text.length >= 3) {
    const from = safeOffset(text, 1)
    const to = safeOffset(text, text.length - 1)
    if (from < to) commands.push(character({ bold: true, from, to }), character({ underline: false, italic: true, from: 0, to }))
  }
  commands.push(
    { type: 'apply-paragraph-style', ...base, align: 'CENTER' },
    { type: 'apply-paragraph-style', ...base, lineSpacing: 180, marginBefore: 200, marginAfter: 100, indent: -300 },
    { type: 'apply-cell-style', ...base, backgroundColor: '#abcdef' },
    { type: 'apply-cell-style', ...base, borderColor: '#123456', borderWidth: 0.4, borderType: 'SOLID' }
  )
  return commands
}

function applyTree(sourcePackage: HwpxSourcePackage, command: StyleCommand): AnyResult {
  if (command.type === 'apply-character-style') return applyCharacterStyleCommand(sourcePackage, command)
  if (command.type === 'apply-paragraph-style') return applyParagraphStyleCommand(sourcePackage, command)
  return applyCellStyleCommand(sourcePackage, command)
}

function applyLegacy(sourcePackage: HwpxSourcePackage, command: StyleCommand): AnyResult {
  if (command.type === 'apply-character-style') return legacyApplyCharacterStyleCommand(sourcePackage, command)
  if (command.type === 'apply-paragraph-style') return legacyApplyParagraphStyleCommand(sourcePackage, command)
  return legacyApplyCellStyleCommand(sourcePackage, command)
}

function restoreTree(sourcePackage: HwpxSourcePackage, inverse: AnyInverse): AnyResult {
  if (inverse.type === 'restore-style') return applyRestoreStyleCommand(sourcePackage, inverse)
  if (inverse.type === 'restore-character-run') return applyRestoreCharacterRunCommand(sourcePackage, inverse)
  return applyRestoreCellStyleCommand(sourcePackage, inverse)
}

function restoreLegacy(sourcePackage: HwpxSourcePackage, inverse: AnyInverse): AnyResult {
  if (inverse.type === 'restore-style') return legacyApplyRestoreStyleCommand(sourcePackage, inverse)
  if (inverse.type === 'restore-character-run') return legacyApplyRestoreCharacterRunCommand(sourcePackage, inverse)
  return legacyApplyRestoreCellStyleCommand(sourcePackage, inverse)
}

function attempt<T>(run: () => T): { value: T } | { error: Error } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: error as Error }
  }
}

function pickAnchors<T>(anchors: T[]): T[] {
  if (anchors.length <= LARGE_FIXTURE_ANCHORS) return anchors
  const picked = new Set<number>()
  const step = anchors.length / LARGE_FIXTURE_SAMPLE
  for (let position = 0; picked.size < LARGE_FIXTURE_SAMPLE; position += step) picked.add(Math.floor(position))
  return [...picked].sort((left, right) => left - right).map((index) => anchors[index])
}

function firstHangulFontId(sourcePackage: HwpxSourcePackage): string | undefined {
  const header = sourcePackage.readEntry(HEADER_PATH).toString('utf8')
  const fontface = header.match(/<hh:fontface\b[^>]*\blang="HANGUL"[^>]*>([\s\S]*?)<\/hh:fontface>/)?.[1]
  return fontface?.match(/<hh:font\b[^>]*\bid="([^"]+)"/)?.[1]
}

describe('글자·문단·셀 모양 command tree differential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-style-tree-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  const totals = {
    fixtures: 0,
    anchors: 0,
    commands: 0,
    rejected: 0,
    unchanged: 0,
    changed: 0,
    headerChanged: 0,
    runSplits: 0,
    undos: 0,
    redos: 0,
    byType: {} as Record<string, number>
  }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') {
      console.log(`HAN_FLOW_STYLE_TREE_DIFFERENTIAL ${JSON.stringify(totals)}`)
    }
  })

  function expectSameEntries(tree: HwpxSourcePackage, legacy: HwpxSourcePackage, sectionPath: string): void {
    expect(tree.revision).toBe(legacy.revision)
    expect(tree.readEntry(sectionPath).equals(legacy.readEntry(sectionPath))).toBe(true)
    expect(tree.readEntry(HEADER_PATH).equals(legacy.readEntry(HEADER_PATH))).toBe(true)
  }

  /** command 하나를 두 경로에 적용·되돌리기·다시 적용하며 비교하고, 다음 command에 쓸 package(원문 bytes)를 돌려준다. */
  function compare(base: HwpxSourcePackage, original: HwpxSourcePackage, command: StyleCommand): HwpxSourcePackage {
    const { sectionPath } = command
    totals.commands += 1
    const legacy = attempt(() => applyLegacy(base, command))
    const tree = attempt(() => applyTree(base, command))
    if ('error' in legacy) {
      expect('error' in tree ? { name: tree.error.constructor.name, message: tree.error.message } : 'no error').toEqual({
        name: legacy.error.constructor.name,
        message: legacy.error.message
      })
      totals.rejected += 1
      return base
    }
    if ('error' in tree) throw tree.error
    expect(tree.value.changed).toBe(legacy.value.changed)
    expect(tree.value.inverse).toEqual(legacy.value.inverse)
    expect(tree.value.lossReport).toEqual(legacy.value.lossReport)
    expectSameEntries(tree.value.package, legacy.value.package, sectionPath)
    if (!tree.value.changed) {
      expect(tree.value.package).toBe(base)
      totals.unchanged += 1
      return base
    }
    totals.changed += 1
    totals.byType[command.type] = (totals.byType[command.type] ?? 0) + 1
    if (tree.value.lossReport.modifiedEntries.includes(HEADER_PATH)) totals.headerChanged += 1
    if (tree.value.inverse!.type === 'restore-character-run') {
      totals.runSplits += 1
      // run 분할은 hp:t 색인을 tree에서 다시 만든다. 그 anchor 목록이 section을 새로 parse한 결과와 같다.
      const cachedAnchors = listHwpxTextAnchors(tree.value.package, sectionPath)
      const cached = takePackageTrees(tree.value.package)
      expect(listHwpxTextAnchors(tree.value.package, sectionPath)).toEqual(cachedAnchors)
      putPackageTrees(tree.value.package, cached)
    }

    const treeUndo = restoreTree(tree.value.package, tree.value.inverse!)
    const legacyUndo = restoreLegacy(legacy.value.package, legacy.value.inverse!)
    expect(treeUndo.inverse).toEqual(legacyUndo.inverse)
    expect(treeUndo.lossReport).toEqual(legacyUndo.lossReport)
    expectSameEntries(treeUndo.package, legacyUndo.package, sectionPath)
    expect(treeUndo.package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
    expect(treeUndo.package.readEntry(HEADER_PATH).equals(original.readEntry(HEADER_PATH))).toBe(true)
    totals.undos += 1

    const treeRedo = restoreTree(treeUndo.package, treeUndo.inverse!)
    const legacyRedo = restoreLegacy(legacyUndo.package, legacyUndo.inverse!)
    expectSameEntries(treeRedo.package, legacyRedo.package, sectionPath)
    expect(treeRedo.package.readEntry(sectionPath).equals(tree.value.package.readEntry(sectionPath))).toBe(true)
    expect(treeRedo.package.readEntry(HEADER_PATH).equals(tree.value.package.readEntry(HEADER_PATH))).toBe(true)
    totals.redos += 1

    // 다시 되돌린 package(원문 bytes, tree cache 부착)를 다음 command의 입력으로 쓴다.
    const back = restoreTree(treeRedo.package, treeRedo.inverse!)
    expect(back.package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
    return back.package
  }

  test('비교 대상에 synthetic·external fixture가 모두 있다', () => {
    expect(openedFixtures.filter((fixture) => fixture.source === 'file').length).toBeGreaterThanOrEqual(20)
    expect(openedFixtures.filter((fixture) => fixture.source !== 'file').length).toBeGreaterThanOrEqual(5)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: style command가 전환 전 문자열 경로와 같은 section·header bytes·inverse·오류를 만들고 undo·redo가 원문을 복원한다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      const fontId = firstHangulFontId(original)
      const all = index.sectionPaths.flatMap((sectionPath) =>
        listHwpxTextAnchors(original, sectionPath).map((anchor) => ({ sectionPath, anchor }))
      )
      totals.fixtures += 1
      let current = original
      pickAnchors(all).forEach(({ sectionPath, anchor }, position) => {
        totals.anchors += 1
        // 주기적으로 cache를 지워 cache miss(첫 조회 parse) 경로도 섞는다.
        if (position % 7 === 3) forgetPackageTrees(current)
        for (const command of commandsFor(sectionPath, anchor, fontId)) current = compare(current, original, command)
      })
    },
    300_000
  )

  describe('differential이 드러낸 전환 전 경로의 잠재 버그(새 경로 동작을 단언)', () => {
    const sectionPath = 'Contents/section0.xml'

    async function roundTripPackage(
      editSection: (xml: string) => string,
      editHeader: (xml: string) => string = (xml) => xml
    ): Promise<HwpxSourcePackage> {
      const base = await HwpxSourcePackage.open(generators.createRoundTripHwpx(directory, 'style-divergence.hwpx'))
      return base
        .withEntry(sectionPath, Buffer.from(editSection(base.readEntry(sectionPath).toString('utf8'))))
        .withEntry(HEADER_PATH, Buffer.from(editHeader(base.readEntry(HEADER_PATH).toString('utf8'))))
    }

    function lastAnchor(sourcePackage: HwpxSourcePackage): HwpxTextAnchor {
      return listHwpxTextAnchors(sourcePackage, sectionPath).at(-1)!
    }

    function expectExactUndo(sourcePackage: HwpxSourcePackage, result: AnyResult): void {
      const undone = restoreTree(result.package, result.inverse!)
      expect(undone.package.readEntry(sectionPath).equals(sourcePackage.readEntry(sectionPath))).toBe(true)
      expect(undone.package.readEntry(HEADER_PATH).equals(sourcePackage.readEntry(HEADER_PATH))).toBe(true)
    }

    test('다른 attribute 값 안의 `charPrIDRef=...`를 reference로 읽지 않는다', async () => {
      // 최소 재현: <hp:run data="x charPrIDRef='7'" charPrIDRef="0">에 굵게 해제.
      // 전환 전: 정규식이 data 값 안의 '7'을 읽어 "hh:charPr reference를 찾을 수 없습니다: 7"로 거부.
      const source = await roundTripPackage((xml) =>
        xml.replace('<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>', `<hp:run data="x charPrIDRef='7'" charPrIDRef="0"><hp:t>본문</hp:t></hp:run>`)
      )
      const command: ApplyCharacterStyleCommand = {
        type: 'apply-character-style', sectionPath, textNodeId: lastAnchor(source).textNodeId, bold: false
      }
      expect(() => legacyApplyCharacterStyleCommand(source, command)).toThrow('reference를 찾을 수 없습니다: 7')
      const result = applyCharacterStyleCommand(source, command)
      expect(result.package.readEntry(sectionPath).toString('utf8')).toContain(
        `<hp:run data="x charPrIDRef='7'" charPrIDRef="1"><hp:t>본문</hp:t></hp:run>`
      )
      expectExactUndo(source, result)
    })

    test('다른 attribute 값 안의 `header=...`로 표 셀을 머리글로 오판하지 않는다', async () => {
      // 최소 재현: <hp:tc note="x header='1'" borderFillIDRef="1" header="0">에 배경색.
      // 전환 전: note 값 안의 header='1'을 읽어 "머리글 또는 병합된 표 셀"로 거부.
      const source = await roundTripPackage((xml) =>
        xml.replace(
          '<hp:tc borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="1"/>',
          `<hp:tc note="x header='1'" borderFillIDRef="1" header="0"><hp:cellAddr colAddr="0" rowAddr="1"/>`
        )
      )
      const anchor = listHwpxTextAnchors(source, sectionPath).find((candidate) => candidate.text === '긴 설명')!
      const command: ApplyCellStyleCommand = {
        type: 'apply-cell-style', sectionPath, textNodeId: anchor.textNodeId, backgroundColor: '#AABBCC'
      }
      expect(() => legacyApplyCellStyleCommand(source, command)).toThrow('머리글 또는 병합된 표 셀')
      const result = applyCellStyleCommand(source, command)
      expect(result.package.readEntry(sectionPath).toString('utf8')).toContain(
        `<hp:tc note="x header='1'" borderFillIDRef="2" header="0">`
      )
      expectExactUndo(source, result)
    })

    test('줄바꿈이 든 attribute 값을 제자리에서 바꾸고 같은 attribute를 중복으로 붙이지 않는다', async () => {
      // 최소 재현: <hh:charPr id="0" ... textColor="#12\n3456">에 글자색 #ABCDEF.
      // 전환 전: 정규식이 줄바꿈 값을 못 찾아 복제 definition에 textColor="#12\n3456" textColor="#ABCDEF"(중복 attribute,
      // 잘못된 XML)를 썼다.
      const source = await roundTripPackage(
        (xml) => xml.replace('<hp:t></hp:t>', '<hp:t>본문</hp:t>'),
        (xml) => xml.replace('textColor="#123456"', 'textColor="#12\n3456"')
      )
      const command: ApplyCharacterStyleCommand = {
        type: 'apply-character-style', sectionPath, textNodeId: lastAnchor(source).textNodeId, color: '#ABCDEF'
      }
      expect(legacyApplyCharacterStyleCommand(source, command).package.readEntry(HEADER_PATH).toString('utf8')).toContain(
        'textColor="#12\n3456" textColor="#ABCDEF"'
      )
      const header = applyCharacterStyleCommand(source, command).package.readEntry(HEADER_PATH).toString('utf8')
      expect(header).toContain('<hh:charPr id="1" height="1000" textColor="#ABCDEF">')
      expect(header.match(/textColor=/g)).toHaveLength(2)
      expectExactUndo(source, applyCharacterStyleCommand(source, command))
    })

    test('부분 선택 run 분할이 조각의 entity 원문 표기를 보존한다', async () => {
      // 최소 재현: <hp:t>앞&#x41;&apos;뒤</hp:t>의 [1, 3)에 굵게 해제.
      // 전환 전: 조각을 논리 text에서 다시 써 <hp:t>A'</hp:t>로 바꿨다(1단계 text 편집과 같은 종류의 표기 손실).
      const source = await roundTripPackage((xml) => xml.replace('<hp:t></hp:t>', '<hp:t>앞&#x41;&apos;뒤</hp:t>'))
      const command: ApplyCharacterStyleCommand = {
        type: 'apply-character-style', sectionPath, textNodeId: lastAnchor(source).textNodeId, bold: false, from: 1, to: 3
      }
      expect(legacyApplyCharacterStyleCommand(source, command).package.readEntry(sectionPath).toString('utf8')).toContain(
        `<hp:run charPrIDRef="1"><hp:t>A'</hp:t></hp:run>`
      )
      const result = applyCharacterStyleCommand(source, command)
      expect(result.package.readEntry(sectionPath).toString('utf8')).toContain(
        '<hp:run charPrIDRef="0"><hp:t>앞</hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>&#x41;&apos;</hp:t></hp:run>' +
          '<hp:run charPrIDRef="0"><hp:t>뒤</hp:t></hp:run>'
      )
      expect(listHwpxTextAnchors(result.package, sectionPath).slice(-3).map((anchor) => anchor.text)).toEqual(["앞", "A'", '뒤'])
      expectExactUndo(source, result)
    })
  })

  test('style command는 section·header tree cache를 새 package로 옮기고, 섞인 command 순서 뒤에도 tree가 bytes와 같다', async () => {
    const sectionPath = 'Contents/section0.xml'
    const base = await HwpxSourcePackage.open(generators.createRoundTripHwpx(directory, 'style-cache.hwpx'))
    const source = base.withEntry(
      sectionPath,
      Buffer.from(base.readEntry(sectionPath).toString('utf8').replace('<hp:t></hp:t>', '<hp:t>가나다라마</hp:t>'))
    )
    const anchor = listHwpxTextAnchors(source, sectionPath).at(-1)!
    const sectionTree = packageEntryTree(source, sectionPath)
    const headerTree = packageEntryTree(source, HEADER_PATH)
    const styled = applyCharacterStyleCommand(source, {
      type: 'apply-character-style', sectionPath, textNodeId: anchor.textNodeId, bold: false
    })
    // 같은 tree 객체를 제자리에서 고쳐 새 package에 붙였다(다시 parse하지 않음).
    expect(packageEntryTree(styled.package, sectionPath)).toBe(sectionTree)
    expect(packageEntryTree(styled.package, HEADER_PATH)).toBe(headerTree)

    const expectTreesMatchBytes = (sourcePackage: HwpxSourcePackage): void => {
      for (const path of [sectionPath, HEADER_PATH]) {
        expect(serializeSourceTree(packageEntryTree(sourcePackage, path))).toBe(sourcePackage.readEntry(path).toString('utf8'))
      }
    }
    // text 입력 → 부분 글자 style(run 분할) → 문단 style → 셀 style → text 입력을 이어 적용하고 역순으로 되돌린다.
    let current = styled.package
    const undo: Array<(sourcePackage: HwpxSourcePackage) => HwpxSourcePackage> = []
    const typed = applyReplaceTextCommand(current, {
      type: 'replace-text', revision: current.revision, sectionPath, textNodeId: anchor.textNodeId, from: 5, to: 5, insert: '바'
    })
    undo.unshift((pkg) => applyReplaceTextCommand(pkg, { ...typed.inverse, revision: pkg.revision }).package)
    current = typed.package
    expectTreesMatchBytes(current)
    for (const command of [
      { type: 'apply-character-style', sectionPath, textNodeId: anchor.textNodeId, italic: true, from: 1, to: 3 },
      { type: 'apply-paragraph-style', sectionPath, textNodeId: anchor.textNodeId, align: 'RIGHT' },
      {
        type: 'apply-cell-style',
        sectionPath,
        textNodeId: listHwpxTextAnchors(current, sectionPath).find((candidate) => candidate.text === '긴 설명')!.textNodeId,
        backgroundColor: '#010203'
      }
    ] as StyleCommand[]) {
      const result = applyTree(current, command)
      expect(result.changed).toBe(true)
      undo.unshift((pkg) => restoreTree(pkg, result.inverse!).package)
      current = result.package
      expectTreesMatchBytes(current)
    }
    const split = listHwpxTextAnchors(current, sectionPath).slice(-3).map((candidate) => candidate.text)
    expect(split).toEqual(['가', '나다', '라마바'])
    const last = listHwpxTextAnchors(current, sectionPath).at(-1)!
    const typedAgain = applyReplaceTextCommand(current, {
      type: 'replace-text', revision: current.revision, sectionPath, textNodeId: last.textNodeId, from: 0, to: 1, insert: '&'
    })
    undo.unshift((pkg) => applyReplaceTextCommand(pkg, { ...typedAgain.inverse, revision: pkg.revision }).package)
    current = typedAgain.package
    expectTreesMatchBytes(current)
    for (const step of undo) {
      current = step(current)
      expectTreesMatchBytes(current)
    }
    expect(current.readEntry(sectionPath).equals(styled.package.readEntry(sectionPath))).toBe(true)
    expect(current.readEntry(HEADER_PATH).equals(styled.package.readEntry(HEADER_PATH))).toBe(true)
  })

  test('differential이 글자·문단·셀 모양 변경, header definition 추가, run 분할을 모두 거쳤다', () => {
    expect(totals.byType['apply-character-style']).toBeGreaterThan(0)
    expect(totals.byType['apply-paragraph-style']).toBeGreaterThan(0)
    expect(totals.byType['apply-cell-style']).toBeGreaterThan(0)
    expect(totals.headerChanged).toBeGreaterThan(0)
    expect(totals.runSplits).toBeGreaterThan(0)
    expect(totals.rejected).toBeGreaterThan(0)
  })
})
