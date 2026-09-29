import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseSourceTree, serializeSourceTree } from '../../src/core/editing/source_tree'
import {
  applyReplaceTextCommand,
  forgetHwpxTextTree,
  HwpxTextAnchor,
  listHwpxTextAnchors,
  ReplaceTextCommand
} from '../../src/core/editing/text_patch'
import {
  legacyApplyReplaceTextCommand,
  legacyListHwpxTextAnchors
} from '../../src/core/editing/text_patch_legacy'
import { encodeHwpxTextContent } from '../../src/core/editing/text_patch'
import { isSurrogateBoundarySafe, scanXmlElements } from '../../src/core/editing/xml_scan'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// 1단계 tree 전환 관문.
// 1) identity: 열리는 모든 공개 fixture의 section XML과 header.xml이 parse → serialize 뒤 byte 단위로 같다.
// 2) differential: fixture마다 정해진 text 편집 순서를 새 tree 경로(`text_patch`)와 전환 전 문자열 경로
//    (`text_patch_legacy`)에 똑같이 적용한다. 전환 전 경로는 편집한 hp:t 전체를 논리 text에서 다시 쓰므로
//    원래 내용이 기본 표기(`encodeHwpxTextContent`)일 때만 원문을 보존한다. 그런 단계에서만 section XML
//    bytes·inverse·anchor가 같음을 단언하고, 기본 표기가 아닌 hp:t(attribute 있는 `hp:tab`, 비표준 entity,
//    CR/LF)는 tree 경로가 범위 밖 원문을 보존하는 새 동작을 따로 단언한다. inverse를 역순으로 적용하면 모든
//    경우 원래 bytes(`<hp:t/>` 포함)로 돌아온다. tree 경로는 cache된 tree를 이어 쓰므로 연속 편집(cache hit)과
//    첫 편집(cache miss)을 모두 거친다.
// 3) no-op identity: 모든 fixture의 모든 편집 가능 anchor에 빈 편집을 적용해도 section bytes가 그대로다.

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

/** fixture 하나에서 편집할 anchor 수 상한(큰 synthetic 문서의 실행 시간 제한용). 빈 `<hp:t/>`는 따로 더 고른다. */
const MAX_ANCHORS_PER_FIXTURE = 40
const MAX_EMPTY_ANCHORS_PER_FIXTURE = 16
const SPECIAL_INSERT = '&<>"\'😀\t줄1\n줄2\r끝'

type Edit = Pick<ReplaceTextCommand, 'from' | 'to' | 'insert'>

function safeOffset(text: string, offset: number): number {
  let value = Math.max(0, Math.min(text.length, offset))
  while (!isSurrogateBoundarySafe(text, value)) value -= 1
  return value
}

/** 현재 text 기준으로 다음 편집을 만든다. 각 단계는 앞 단계 결과 text 위에서 계산된다. */
const EDIT_STEPS: ReadonlyArray<(text: string) => Edit> = [
  () => ({ from: 0, to: 0, insert: 'A' }),
  (text) => ({ from: text.length, to: text.length, insert: 'Z' }),
  (text) => {
    const middle = safeOffset(text, Math.floor(text.length / 2))
    return { from: middle, to: middle, insert: SPECIAL_INSERT }
  },
  (text) => {
    const from = safeOffset(text, 1)
    return { from, to: safeOffset(text, Math.max(from, Math.min(text.length, from + 3))), insert: '' }
  },
  (text) => {
    const from = safeOffset(text, 2)
    return { from, to: safeOffset(text, text.length - 1), insert: '<&amp;>\t"x"' }
  },
  (text) => ({ from: 0, to: text.length, insert: '' }),
  (text) => ({ from: 0, to: text.length, insert: '\t\n😀 &' }),
  (text) => ({ from: 0, to: text.length, insert: '' })
]

function pickAnchors(anchors: Array<{ sectionPath: string; anchor: HwpxTextAnchor }>): typeof anchors {
  const picked = new Set<number>()
  const step = Math.max(1, anchors.length / MAX_ANCHORS_PER_FIXTURE)
  for (let position = 0; position < anchors.length && picked.size < MAX_ANCHORS_PER_FIXTURE; position += step) {
    picked.add(Math.floor(position))
  }
  if (anchors.length) picked.add(anchors.length - 1)
  let empties = 0
  anchors.forEach((entry, index) => {
    if (entry.anchor.text === '' && empties < MAX_EMPTY_ANCHORS_PER_FIXTURE) {
      picked.add(index)
      empties += 1
    }
  })
  return [...picked].sort((left, right) => left - right).map((index) => anchors[index])
}

describe('source tree identity와 text 편집 differential', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-text-tree-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  const totals = {
    fixtures: 0,
    identityEntries: 0,
    anchors: 0,
    selfClosingAnchors: 0,
    edits: 0,
    legacyEqualEdits: 0,
    divergentEdits: 0,
    undos: 0,
    noopAnchors: 0
  }

  /** `hp:t` ordinal의 현재 내용 원문(자기 닫힘이면 빈 문자열). */
  function textContentSource(sourcePackage: HwpxSourcePackage, sectionPath: string, ordinal: number): string {
    const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
    const element = scanXmlElements(xml).filter((span) => span.name === 'hp:t')[ordinal]
    return element.closeStart > element.openEnd ? xml.slice(element.openEnd, element.closeStart) : ''
  }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') {
      console.log(`HAN_FLOW_TEXT_TREE_DIFFERENTIAL ${JSON.stringify(totals)}`)
    }
  })

  /**
   * anchor 하나에 EDIT_STEPS를 차례로 적용하고 역순 inverse로 되돌리며 두 경로를 비교한다.
   * 편집 전 hp:t 내용이 기본 표기이면 전환 전 경로도 원문을 보존하므로 두 경로의 bytes·inverse·anchor가 같아야 한다.
   * 기본 표기가 아니면 전환 전 경로는 hp:t 전체를 기본 표기로 다시 써 원문을 잃으므로 비교하지 않고, tree 경로의
   * anchor·loss report만 같음을 확인한다. 되돌린 section은 언제나 원래 bytes와 같아야 한다.
   * 반환값은 편집 단계 가운데 전환 전 경로와 달라진 단계 수.
   */
  function runDifferential(original: HwpxSourcePackage, sectionPath: string, anchor: HwpxTextAnchor): number {
    const originalSection = original.readEntry(sectionPath)
    let treePackage = original
    let legacyPackage = original
    // 두 번째 anchor부터는 앞 anchor가 원래 package의 cache를 옮겨 갔으므로 다시 parse한다(cache miss 경로).
    forgetHwpxTextTree(original)
    let text = anchor.text
    const inverses: ReplaceTextCommand[] = []
    let divergent = 0
    totals.anchors += 1
    for (const step of EDIT_STEPS) {
      const edit = step(text)
      const base = { type: 'replace-text' as const, sectionPath, textNodeId: anchor.textNodeId, ...edit }
      const canonical = textContentSource(treePackage, sectionPath, anchor.ordinal) === encodeHwpxTextContent(text)
      const tree = applyReplaceTextCommand(treePackage, { ...base, revision: treePackage.revision })
      // 전환 전 경로는 매 단계 tree 경로와 같은 입력에서 시작한다(앞 단계가 달랐어도 비교 기준을 맞춘다).
      legacyPackage = treePackage
      const legacy = legacyApplyReplaceTextCommand(legacyPackage, { ...base, revision: legacyPackage.revision })
      expect(tree.package.revision).toBe(legacy.package.revision)
      expect(tree.anchor).toEqual(legacy.anchor)
      expect(tree.lossReport).toEqual(legacy.lossReport)
      if (canonical) {
        expect(tree.package.readEntry(sectionPath).equals(legacy.package.readEntry(sectionPath))).toBe(true)
        expect(tree.inverse).toEqual(legacy.inverse)
        totals.legacyEqualEdits += 1
      } else {
        // 기본 표기가 아닌 hp:t: inverse의 논리 범위는 같고, 원문 표기는 tree 경로만 `insertSource`로 들고 간다.
        const { insertSource: _insertSource, ...logical } = tree.inverse
        expect(logical).toEqual(legacy.inverse)
        divergent += 1
        totals.divergentEdits += 1
      }
      // cache에서 나온 anchor 목록이 새로 parse한 결과와 같다.
      expect(listHwpxTextAnchors(tree.package, sectionPath)).toEqual(
        legacyListHwpxTextAnchors(tree.package, sectionPath)
      )
      if (tree.inverse.restoreSelfClosingTag !== undefined) totals.selfClosingAnchors += 1
      inverses.unshift(tree.inverse)
      treePackage = tree.package
      text = tree.anchor.text
      totals.edits += 1
    }
    for (const inverse of inverses) {
      const canonical =
        inverse.insertSource === undefined &&
        textContentSource(treePackage, sectionPath, anchor.ordinal) === encodeHwpxTextContent(text)
      const tree = applyReplaceTextCommand(treePackage, { ...inverse, revision: treePackage.revision })
      if (canonical) {
        const legacy = legacyApplyReplaceTextCommand(treePackage, { ...inverse, revision: treePackage.revision })
        expect(tree.package.readEntry(sectionPath).equals(legacy.package.readEntry(sectionPath))).toBe(true)
      }
      treePackage = tree.package
      text = tree.anchor.text
      totals.undos += 1
    }
    expect(treePackage.readEntry(sectionPath).equals(originalSection)).toBe(true)
    expect(listHwpxTextAnchors(treePackage, sectionPath)).toEqual(legacyListHwpxTextAnchors(original, sectionPath))
    return divergent
  }

  test('비교 대상에 synthetic·external fixture가 모두 있다', () => {
    expect(openedFixtures.filter((fixture) => fixture.source === 'file').length).toBeGreaterThanOrEqual(20)
    expect(openedFixtures.filter((fixture) => fixture.source !== 'file').length).toBeGreaterThanOrEqual(5)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: section·header XML이 parse → serialize 뒤 byte 단위로 같다',
    async (_id, fixture) => {
      const sourcePackage = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await sourcePackage.index()
      totals.fixtures += 1
      for (const path of [index.headerPath, ...index.sectionPaths]) {
        const bytes = sourcePackage.readEntry(path)
        const xml = bytes.toString('utf8')
        expect(Buffer.from(serializeSourceTree(parseSourceTree(xml)), 'utf8').equals(bytes)).toBe(true)
        totals.identityEntries += 1
      }
    },
    60_000
  )

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: 기본 표기 hp:t의 text 편집이 전환 전 문자열 경로와 같은 bytes를 만들고 undo가 원문을 복원한다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      const all = index.sectionPaths.flatMap((sectionPath) =>
        legacyListHwpxTextAnchors(original, sectionPath).map((anchor) => ({ sectionPath, anchor }))
      )
      // 공개 corpus의 편집 가능 hp:t는 모두 기본 표기이므로 모든 단계가 전환 전 경로와 같다.
      for (const { sectionPath, anchor } of pickAnchors(all)) expect(runDifferential(original, sectionPath, anchor)).toBe(0)
    },
    120_000
  )

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: 모든 편집 가능 anchor에 빈 편집을 적용해도 section bytes가 그대로다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await original.index()
      for (const sectionPath of index.sectionPaths) {
        const originalSection = original.readEntry(sectionPath)
        let current = original
        for (const anchor of listHwpxTextAnchors(original, sectionPath)) {
          for (const offset of new Set([0, safeOffset(anchor.text, Math.floor(anchor.text.length / 2)), anchor.text.length])) {
            const result = applyReplaceTextCommand(current, {
              type: 'replace-text',
              revision: current.revision,
              sectionPath,
              textNodeId: anchor.textNodeId,
              from: offset,
              to: offset,
              insert: ''
            })
            expect(result.package.readEntry(sectionPath).equals(originalSection)).toBe(true)
            expect(result.anchor.text).toBe(anchor.text)
            current = result.package
          }
          totals.noopAnchors += 1
        }
      }
    },
    120_000
  )

  test('hp:tab·entity 표기·CRLF·편집 불가 형제가 섞인 section: 기본 표기만 전환 전 경로와 같고 undo는 모두 원문을 복원한다', async () => {
    const base = await HwpxSourcePackage.open(generators.createRoundTripHwpx(directory, 'differential-handmade.hwpx'))
    const sectionPath = 'Contents/section0.xml'
    const xml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\r\n',
      '<hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp">\r\n',
      '<hp:p><hp:run><hp:t>탭<hp:tab width="3112" leader="0" type="1"/>뒤&#x41;&apos;&#13;&gt;</hp:t></hp:run></hp:p>\r\n',
      "<hp:p><hp:run><hp:t a='1' /></hp:run><hp:run><hp:t>줄<hp:lineBreak/>바꿈\r\n둘</hp:t></hp:run></hp:p>\r\n",
      '<!-- note --><hp:p><hp:run><hp:t><![CDATA[x]]></hp:t><hp:t>&nbsp;</hp:t><hp:t><!-- c -->y</hp:t>',
      '<hp:t>ok</hp:t><hp:t><hp:tab></hp:tab></hp:t><hp:t/></hp:run></hp:p>\r\n',
      '</hs:sec>\r\n'
    ].join('')
    const original = base.withEntry(sectionPath, Buffer.from(xml, 'utf8'))
    const anchors = legacyListHwpxTextAnchors(original, sectionPath)
    // CDATA·사용자 정의 entity·comment·열린 hp:tab을 가진 hp:t는 두 경로 모두 anchor로 노출하지 않는다.
    expect(anchors.map((anchor) => anchor.ordinal)).toEqual([0, 1, 2, 6, 8])
    expect(listHwpxTextAnchors(original, sectionPath)).toEqual(anchors)
    const divergent = anchors.map((anchor) => runDifferential(original, sectionPath, anchor))
    // 기본 표기 anchor(빈 `<hp:t a='1' />`, `ok`, `<hp:t/>`)는 모든 단계가 전환 전 경로와 같다.
    // 기본 표기가 아닌 anchor는 원문 표기가 남아 있는 동안(전체 삭제 전까지)만 달라진다.
    expect(divergent).toEqual([5, 0, 5, 0, 0])

    // 전환 전 경로는 빈 편집에도 hp:t 전체를 기본 표기로 다시 썼다(`<hp:tab .../>` → `&#9;`, `&#x41;` → `A`).
    const noop = { type: 'replace-text' as const, sectionPath, textNodeId: anchors[0].textNodeId, from: 0, to: 0, insert: '' }
    const legacy = legacyApplyReplaceTextCommand(original, { ...noop, revision: original.revision })
    expect(legacy.package.readEntry(sectionPath).toString('utf8')).toContain("<hp:t>탭&#9;뒤A'&#13;&gt;</hp:t>")
    // tree 경로는 byte 단위로 그대로다.
    const edited = applyReplaceTextCommand(original, { ...noop, revision: original.revision })
    expect(edited.package.readEntry(sectionPath).equals(original.readEntry(sectionPath))).toBe(true)
  })

  test('빈 <hp:t/>를 펼치는 입력과 그 실행 취소도 differential 대상에 들어 있다', () => {
    expect(totals.edits).toBeGreaterThan(0)
    expect(totals.selfClosingAnchors).toBeGreaterThan(0)
  })
})
