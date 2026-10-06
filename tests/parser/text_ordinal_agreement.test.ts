import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listHwpxTextAnchors, listHwpxTextOrdinals } from '../../src/core/editing/text_patch'
import { forgetHwpxTextTree } from '../../src/core/editing/text_patch'
import { iterateXmlTokens } from '../../src/core/editing/xml_scan'
import { OrderedXmlNode, walkOrderedXml } from '../../src/core/parser/ordered_xml'
import { HwpxSourcePackage } from '../../src/core/parser/source_package'
import * as generators from '../fixtures/public/create_synthetic_hwpx'

// viewer decoder(fast-xml-parser 기반 ordered_xml의 sourceOrdinal)와 편집 tokenizer(text_patch)는
// 같은 `${sectionPath}#hp:t:N` anchor를 서로 다른 parser로 만든다. 둘이 어긋나면 화면에서 고른 run과
// 다른 hp:t가 patch되므로, 모든 공개 fixture에서 ordinal 목록과 편집 가능 text가 일치하는지 확인한다.
// 1단계 tree 전환 뒤 `text_patch`의 목록은 source tree(`source_tree.ts`)에서 나온다. 전환 전 편집 tokenizer는
// 2단계에서 지웠고, 문자열 patch용 `scanXmlElements`는 4단계 뒤 지웠다. 세 번째 참여자로 tokenizer(`iterateXmlTokens`)가
// 내는 hp:t 여는·자기 닫힘 token 순서를 비교한다.

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

const INLINE_CHILDREN: Readonly<Record<string, string>> = { 'hp:lineBreak': '\n', 'hp:tab': '\t' }

/** viewer_decoder의 isEditableInlineText·inlineTextOf와 같은 규칙으로 편집 가능한 hp:t text를 만든다. */
function viewerEditableText(node: OrderedXmlNode): string | undefined {
  let text = ''
  for (const child of node.children) {
    if (child.name === '#text') text += child.text ?? ''
    else if (INLINE_CHILDREN[child.name] !== undefined) text += INLINE_CHILDREN[child.name]
    else return undefined
  }
  return text
}

describe('hp:t ordinal 교차 parser 일치', () => {
  const directory = mkdtempSync(join(tmpdir(), 'han-flow-ordinal-agreement-'))
  const fixturePath = (fixture: ManifestFixture): string => {
    if (fixture.source === 'file') return join(publicRoot, fixture.file!)
    const create = (generators as unknown as Record<string, (directory: string, options?: unknown) => string>)[
      fixture.generator!
    ]
    return create(directory, fixture.options ?? fixture.fileName)
  }
  let selfClosingAnchors = 0

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('공개 corpus에 synthetic과 external fixture가 모두 있다', () => {
    expect(openedFixtures.filter((fixture) => fixture.source === 'file').length).toBeGreaterThanOrEqual(20)
    expect(openedFixtures.filter((fixture) => fixture.source !== 'file').length).toBeGreaterThanOrEqual(5)
  })

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: viewer decoder와 편집 tokenizer의 hp:t ordinal·text가 같다',
    async (_id, fixture) => {
      const sourcePackage = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await sourcePackage.index()
      for (const sectionPath of index.sectionPaths) {
        const viewerNodes = walkOrderedXml(await sourcePackage.readOrderedXml(sectionPath))
          .filter((node) => node.name === 'hp:t')
        expect(viewerNodes.map((node) => node.sourceOrdinal)).toEqual(
          listHwpxTextOrdinals(sourcePackage, sectionPath)
        )

        const viewerEditable = new Map(
          viewerNodes.flatMap((node) => {
            const text = viewerEditableText(node)
            return text === undefined ? [] : [[`${sectionPath}#hp:t:${node.sourceOrdinal}`, text] as const]
          })
        )
        const anchors = listHwpxTextAnchors(sourcePackage, sectionPath)
        expect(new Map(anchors.map((anchor) => [anchor.textNodeId, anchor.text]))).toEqual(viewerEditable)
        const raw = sourcePackage.readEntry(sectionPath).toString('utf8')
        selfClosingAnchors += (raw.match(/<hp:t(?:\s[^>]*)?\/>/g) ?? []).length
      }
    },
    60_000
  )

  test.each(openedFixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: source tree·tokenizer·viewer decoder의 hp:t ordinal이 같고 cache된 anchor가 새 parse와 같다',
    async (_id, fixture) => {
      const sourcePackage = await HwpxSourcePackage.open(fixturePath(fixture))
      const index = await sourcePackage.index()
      for (const sectionPath of index.sectionPaths) {
        const viewerOrdinals = walkOrderedXml(await sourcePackage.readOrderedXml(sectionPath))
          .filter((node) => node.name === 'hp:t')
          .map((node) => node.sourceOrdinal)
        const treeOrdinals = listHwpxTextOrdinals(sourcePackage, sectionPath)
        const xml = sourcePackage.readEntry(sectionPath).toString('utf8')
        expect(treeOrdinals).toEqual(
          [...iterateXmlTokens(xml)]
            .filter((token) => token.name === 'hp:t' && token.kind !== 'close')
            .map((_token, ordinal) => ordinal)
        )
        expect(treeOrdinals).toEqual(viewerOrdinals)
        const cached = listHwpxTextAnchors(sourcePackage, sectionPath)
        forgetHwpxTextTree(sourcePackage)
        expect(listHwpxTextAnchors(sourcePackage, sectionPath)).toEqual(cached)
      }
    },
    60_000
  )

  test('external corpus의 자기 닫힘 <hp:t/>도 비교 대상에 들어 있다', () => {
    expect(selfClosingAnchors).toBeGreaterThan(0)
  })
})
