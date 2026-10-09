import type { ViewerDocument } from '../document/viewer_document'
import type { ViewerDocumentPatch } from '../document/viewer_document_patch'
import type { OrderedXmlNode } from './ordered_xml'
import type { HwpxPackageIndex } from './package_reader'
import type { HwpxSourcePackage } from './source_package'
import {
  assembleViewerDocument,
  decodeViewerDocument,
  decodeViewerHeader,
  decodeViewerResources,
  decodeViewerSection,
  documentPageGeometry,
  type DecodedViewerSection,
  type ViewerHeaderProjection,
  type ViewerPageGeometry,
  viewerSectionInputs
} from './viewer_decoder'

/*
 * 편집 session의 증분 projection. 편집 command·실행 취소·다시 실행 뒤 바뀐 package entry만 다시 해석하고 나머지 section·
 * header style map·그림 resource는 앞 projection의 object를 그대로 쓴다. 결과는 언제나 같은 package를
 * `decodeViewerDocument`로 처음부터 해석한 문서와 같다(`tests/parser/viewer_projection.test.ts`가 공개 corpus로 확인한다).
 *
 * 다시 해석하는 범위(규칙):
 * - 바뀐 entry는 앞·뒤 package의 entry bytes를 비교해 정한다(command 종류를 믿지 않으므로 undo·redo도 같은 규칙이다).
 * - section XML이 바뀌면 그 section만 다시 해석한다. 각주·미주 번호, 목록 번호, 개체·`hp:t`·문단 순번은 모두 section
 *   안에서 세므로 다른 section에 번지지 않는다. 쪽 번호 이어 세기·머리말·꼬리말 상속은 renderer가 쪽 목록에서 매번 다시 정한다.
 * - header.xml이 바뀌면 header style map을 다시 읽어 patch에 담고, section 해석이 header에서 읽는 값(문단 style의
 *   `heading` → 목록 번호·글머리표, 문단 style의 `charPrIDRef` → 빈 문단 caret 글자 모양)이 바뀐 id를 참조하는 section도
 *   다시 해석한다. 새로 만든 style id만 늘었다면 그 id를 쓰는 section(편집한 section)만 해당한다.
 * - 전체 다시 해석(patch 대신 전체 문서): entry 목록(경로·순서)이 달라졌을 때, section·header 밖 entry(그림·manifest 등)가
 *   바뀌었을 때, 문서 쪽 크기(첫 `hp:pagePr`)나 그에서 온 자리 표시 높이 한도가 바뀌었을 때.
 */

interface CachedSection {
  decoded: DecodedViewerSection
  pagePr?: OrderedXmlNode
  paraStyleRefs: Set<string>
  styleRefs: Set<string>
}

export type ViewerProjectionFallback = 'initial' | 'refresh' | 'entry-list' | 'non-section-entry' | 'page-geometry'

export interface ViewerProjectionResult {
  projectionId: number
  document: ViewerDocument
  /** 앞 projection에 적용할 증분. 없으면 전체 문서(`document`)를 보낸다. */
  patch?: ViewerDocumentPatch
  fallback?: ViewerProjectionFallback
  /** 이번에 다시 해석한 section 수와 header 해석 여부(측정·test용). */
  decodedSections: number
  headerDecoded: boolean
}

const sameGeometry = (left: ViewerPageGeometry, right: ViewerPageGeometry): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** section 해석이 header에서 읽는 값이 바뀐 문단 style id(`heading`)와 style id(`charPrIDRef`). */
function changedHeaderInputs(
  before: ViewerHeaderProjection,
  after: ViewerHeaderProjection
): { paraStyles: Set<string>; styles: Set<string> } {
  const paraStyles = new Set<string>()
  for (const id of new Set([...Object.keys(before.paraStyles), ...Object.keys(after.paraStyles)])) {
    if (JSON.stringify(before.paraStyles[id]?.heading) !== JSON.stringify(after.paraStyles[id]?.heading)) paraStyles.add(id)
  }
  const styles = new Set<string>()
  for (const id of new Set([...Object.keys(before.styleCharacterIds), ...Object.keys(after.styleCharacterIds)])) {
    if (before.styleCharacterIds[id] !== after.styleCharacterIds[id]) styles.add(id)
  }
  return { paraStyles, styles }
}

const intersects = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  for (const value of right) if (left.has(value)) return true
  return false
}

interface ProjectionState {
  sourcePackage: HwpxSourcePackage
  index: HwpxPackageIndex
  header: ViewerHeaderProjection
  sections: CachedSection[]
  geometry: ViewerPageGeometry
  resources: ViewerDocument['resources']
  document: ViewerDocument
  projectionId: number
}

export class ViewerProjectionCache {
  private nextProjectionId = 1
  private state!: ProjectionState

  private constructor() {}

  static async open(sourcePackage: HwpxSourcePackage): Promise<{ cache: ViewerProjectionCache; result: ViewerProjectionResult }> {
    const cache = new ViewerProjectionCache()
    const result = await cache.rebuild(sourcePackage, 'initial')
    return { cache, result }
  }

  get projectionId(): number {
    return this.state.projectionId
  }

  /** `sourcePackage`의 projection. cache가 그 package의 것이면 다시 해석하지 않는다(capability 검사용, cache를 바꾸지 않는다). */
  async documentFor(sourcePackage: HwpxSourcePackage): Promise<ViewerDocument> {
    return sourcePackage === this.state.sourcePackage ? this.state.document : decodeViewerDocument(sourcePackage)
  }

  /** 처음부터 다시 해석한다(session 시작·refresh·fallback). */
  async rebuild(sourcePackage: HwpxSourcePackage, fallback: ViewerProjectionFallback): Promise<ViewerProjectionResult> {
    const index = await sourcePackage.index()
    const header = decodeViewerHeader(await sourcePackage.readOrderedXml(index.headerPath))
    const parsed = await Promise.all(index.sectionPaths.map(async (path) => ({ path, nodes: await sourcePackage.readOrderedXml(path) })))
    const inputs = parsed.map(({ nodes }) => viewerSectionInputs(nodes))
    const geometry = documentPageGeometry(inputs.map((input) => input.pagePr))
    const sections = parsed.map(({ path, nodes }, position): CachedSection => ({
      decoded: decodeViewerSection(path, nodes, header, geometry.objectHeightLimit),
      ...inputs[position]
    }))
    const resources = await decodeViewerResources(sourcePackage, index.resourcePaths)
    const document = assembleViewerDocument(geometry, header, resources, sections.map((section) => section.decoded))
    this.state = { sourcePackage, index, header, sections, geometry, resources, document, projectionId: this.nextProjectionId++ }
    return {
      projectionId: this.state.projectionId,
      document,
      fallback,
      decodedSections: sections.length,
      headerDecoded: true
    }
  }

  /** `sourcePackage`(보통 편집 history의 현재 package)로 projection을 옮긴다. 가능하면 앞 projection에 대한 patch를 만든다. */
  async update(sourcePackage: HwpxSourcePackage): Promise<ViewerProjectionResult> {
    const state = this.state
    const changed = sourcePackage.changedEntryPathsSince(state.sourcePackage)
    if (!changed) return this.rebuild(sourcePackage, 'entry-list')
    const sectionPositions = new Map(state.index.sectionPaths.map((path, position) => [path, position]))
    const headerChanged = changed.includes(state.index.headerPath)
    if (changed.some((path) => path !== state.index.headerPath && !sectionPositions.has(path))) {
      return this.rebuild(sourcePackage, 'non-section-entry')
    }
    const dirty = new Set(changed.filter((path) => sectionPositions.has(path)).map((path) => sectionPositions.get(path)!))
    let header = state.header
    if (headerChanged) {
      header = decodeViewerHeader(await sourcePackage.readOrderedXml(state.index.headerPath))
      const affected = changedHeaderInputs(state.header, header)
      if (affected.paraStyles.size || affected.styles.size) {
        state.sections.forEach((section, position) => {
          if (intersects(section.paraStyleRefs, affected.paraStyles) || intersects(section.styleRefs, affected.styles)) {
            dirty.add(position)
          }
        })
      }
    }
    const positions = [...dirty].sort((left, right) => left - right)
    const parsed = await Promise.all(positions.map(async (position) => {
      const path = state.index.sectionPaths[position]
      const nodes = await sourcePackage.readOrderedXml(path)
      return { position, path, nodes, inputs: viewerSectionInputs(nodes) }
    }))
    const pagePrs = state.sections.map((section) => section.pagePr)
    for (const { position, inputs } of parsed) pagePrs[position] = inputs.pagePr
    if (!sameGeometry(documentPageGeometry(pagePrs), state.geometry)) return this.rebuild(sourcePackage, 'page-geometry')

    const sections = state.sections.slice()
    for (const { position, path, nodes, inputs } of parsed) {
      sections[position] = {
        decoded: decodeViewerSection(path, nodes, header, state.geometry.objectHeightLimit),
        ...inputs
      }
    }
    const document = assembleViewerDocument(state.geometry, header, state.resources, sections.map((section) => section.decoded))
    const projectionId = this.nextProjectionId++
    this.state = { ...state, sourcePackage, header, sections, document, projectionId }
    return {
      projectionId,
      document,
      patch: {
        baseProjectionId: state.projectionId,
        projectionId,
        sectionCount: sections.length,
        sections: positions.map((position) => ({ index: position, section: sections[position].decoded.section })),
        ...(headerChanged
          ? { styles: { fonts: header.fonts, charStyles: header.charStyles, paraStyles: header.paraStyles, cellStyles: header.cellStyles } }
          : {}),
        diagnostics: document.diagnostics
      },
      decodedSections: positions.length,
      headerDecoded: headerChanged
    }
  }
}
