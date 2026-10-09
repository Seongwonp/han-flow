import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { forgetPackageTrees, packageEntryTree } from '../../src/core/editing/package_trees'
import { EditorSelection } from '../../src/core/editing/selection'
import { serializeSourceTree } from '../../src/core/editing/source_tree'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import {
  AppliedResult,
  applyCommand,
  Case,
  casesByFamily as buildCasesByFamily,
  Family,
  FAMILIES,
  fixturePath as manifestFixturePath,
  ManifestFixture,
  openedFixtures
} from './golden_cases'

// 편집 command golden 회귀(tree 전환 뒤 legacy differential을 대신한다).
// 공개 corpus 38종마다 command family(text·style·paragraph·table)별로 결정적인 command 표본을 적용하고, 결과를
// `tests/editing/golden/<family>.json`의 기록과 비교한다. 기록은 바뀐 entry(section·header.xml)의 SHA-256(+ 계획이 돌려준
// selection), 거부면 오류 class·message, 바뀌지 않으면 `unchanged`다. 바뀐 모든 command는 inverse가 원래 bytes를, 그 inverse가
// 결과 bytes를 되살리는지(exact undo·redo) 확인한다. 되돌린 package를 다음 command에 이어 써서 tree cache hit와 주기적
// cache miss를 함께 거친다.
// 의도한 동작 변경 뒤 기록 갱신: `HAN_FLOW_UPDATE_GOLDEN=1 npx jest tests/editing/editing_golden.test.ts`

type Golden = Record<string, Record<string, string>>

const UPDATE = process.env.HAN_FLOW_UPDATE_GOLDEN === '1'
const goldenDirectory = join(__dirname, 'golden')
const EDITABLE_ENTRY = /^Contents\/(?:section\d+|header)\.xml$/

function ordinalOf(textNodeId: string): string {
  return textNodeId.slice(textNodeId.lastIndexOf(':') + 1)
}

function selectionLabel(selection: EditorSelection): string {
  return `${ordinalOf(selection.anchorTextNodeId)}:${selection.anchorOffset}-${ordinalOf(selection.focusTextNodeId)}:${selection.focusOffset}`
}

function sha256(...parts: Array<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

// ---------------------------------------------------------------------------

describe('편집 command golden 회귀', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-editing-golden-'))
  const fixturePath = (fixture: ManifestFixture): string => manifestFixturePath(directory, fixture)
  const stored = Object.fromEntries(FAMILIES.map((family) => {
    const path = join(goldenDirectory, `${family}.json`)
    return [family, existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Golden) : {}]
  })) as Record<Family, Golden>
  const actual = Object.fromEntries(FAMILIES.map((family) => [family, {} as Golden])) as Record<Family, Golden>
  const totals = { cases: 0, rejected: 0, unchanged: 0, changed: 0, undos: 0 }

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
    if (UPDATE) {
      mkdirSync(goldenDirectory, { recursive: true })
      for (const family of FAMILIES) {
        const ordered = Object.fromEntries(
          openedFixtures.filter((fixture) => actual[family][fixture.id]).map((fixture) => [fixture.id, actual[family][fixture.id]])
        )
        writeFileSync(join(goldenDirectory, `${family}.json`), `${JSON.stringify(ordered, null, 1)}\n`)
      }
    }
    if (process.env.HAN_FLOW_DIFFERENTIAL_SUMMARY === '1') console.log(`HAN_FLOW_EDITING_GOLDEN ${JSON.stringify(totals)}`)
  })

  /** case 하나를 적용·되돌리기·다시 적용하고 기록 문자열과 다음 case에 쓸 package(원문 bytes)를 돌려준다. */
  function run(base: HwpxSourcePackage, testCase: Case): { record: string; next: HwpxSourcePackage } {
    totals.cases += 1
    let built: ReturnType<Case['build']>
    let result: AppliedResult
    try {
      built = testCase.build(base)
      result = applyCommand(base, built.command)
    } catch (error) {
      totals.rejected += 1
      return { record: `! ${(error as Error).constructor.name}: ${(error as Error).message}`, next: base }
    }
    if (result.package === base || result.changed === false) {
      totals.unchanged += 1
      return { record: 'unchanged', next: base }
    }
    totals.changed += 1
    // 편집 command가 바꿀 수 있는 entry는 section과 header.xml뿐이다(그 밖의 entry는 loss report·identity test가 지킨다).
    const modified = result.package.listEntries()
      .map((entry) => entry.path)
      .filter((path) => EDITABLE_ENTRY.test(path) && !result.package.readEntry(path).equals(base.readEntry(path)))
    expect(modified.length).toBeGreaterThan(0)
    const parts: Array<string | Buffer> = []
    for (const path of modified) parts.push(path, '\0', result.package.readEntry(path), '\0')
    const selection = built.selectionAfter ? ` @${selectionLabel(built.selectionAfter)}` : ''
    // 결과 package에 붙은 tree cache가 bytes와 같다.
    for (const path of modified) {
      if (/^Contents\/section\d+\.xml$/.test(path) && totals.changed % 4 === 0) {
        expect(serializeSourceTree(packageEntryTree(result.package, path)) === result.package.readEntry(path).toString('utf8')).toBe(true)
      }
    }
    // exact undo·redo
    const undo = applyCommand(result.package, result.inverse!)
    for (const path of modified) expect(undo.package.readEntry(path).equals(base.readEntry(path))).toBe(true)
    const redo = applyCommand(undo.package, undo.inverse!)
    for (const path of modified) expect(redo.package.readEntry(path).equals(result.package.readEntry(path))).toBe(true)
    const back = applyCommand(redo.package, redo.inverse!)
    for (const path of modified) expect(back.package.readEntry(path).equals(base.readEntry(path))).toBe(true)
    totals.undos += 1
    return { record: `${modified.join(',')} ${sha256(...parts)}${selection}`, next: back.package }
  }

  test('golden 기록이 38종 fixture와 4개 family를 덮는다', () => {
    expect(openedFixtures.length).toBe(38)
    if (!UPDATE) for (const family of FAMILIES) expect(Object.keys(stored[family]).length).toBe(openedFixtures.length)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: family별 command 표본의 결과가 golden 기록과 같고 undo·redo가 정확하다',
    async (_id, fixture) => {
      const original = await HwpxSourcePackage.open(fixturePath(fixture))
      const casesByFamily: Record<Family, Case[]> = await buildCasesByFamily(original)
      let current = original
      let position = 0
      for (const family of FAMILIES) {
        const records: Record<string, string> = {}
        for (const testCase of casesByFamily[family]) {
          if (position++ % 7 === 3) forgetPackageTrees(current)
          const { record, next } = run(current, testCase)
          records[testCase.label] = record
          current = next
        }
        actual[family][fixture.id] = records
        if (!UPDATE) expect(records).toEqual(stored[family][fixture.id])
      }
    },
    120_000
  )

  test('표본이 적용·거부·변화 없음을 모두 거쳤다', () => {
    expect(totals.changed).toBeGreaterThan(0)
    expect(totals.rejected).toBeGreaterThan(0)
  })
})
