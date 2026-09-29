import type { HwpxSourcePackage } from '../parser/source_package'
import { parseSourceTree, serializeSourceTree, SourceTree } from './source_tree'

/**
 * package별 편집 source tree cache.
 *
 * `HwpxSourcePackage`는 불변이므로 package 객체(= 그 revision의 entry bytes)를 key로 entry 경로별 source tree를
 * 보관한다. section과 `Contents/header.xml`을 같은 방식으로 다룬다.
 *
 * tree를 고치는 command는 {@link takePackageTrees}로 원래 package에서 cache를 떼어 낸 뒤 tree를 제자리에서 고치고,
 * 새 package를 만든 다음 {@link putPackageTrees}로 cache를 옮긴다. 떼어 낸 뒤 실패하면 cache는 버려지고 원래
 * package는 다음 조회 때 다시 parse한다. 따라서 cache된 tree는 언제나 key package의 bytes와 같은 문자열로 직렬화된다.
 * tree를 쓰지 않는 command(표 문자열 patch)가 만든 package에는 cache가 없어 첫 조회 때 다시 parse한다.
 */

export type PackageTrees = Map<string, SourceTree>

const packageTrees = new WeakMap<HwpxSourcePackage, PackageTrees>()

function decodeUtf8Entry(sourcePackage: HwpxSourcePackage, path: string): string {
  const bytes = sourcePackage.readEntry(path)
  const xml = bytes.toString('utf8')
  if (!Buffer.from(xml, 'utf8').equals(bytes)) {
    throw new Error(
      /^Contents\/section\d+\.xml$/.test(path)
        ? 'UTF-8이 아닌 section XML은 아직 편집할 수 없습니다.'
        : `UTF-8이 아닌 XML은 아직 편집할 수 없습니다: ${path}`
    )
  }
  return xml
}

/** package entry의 source tree. 처음 조회할 때 parse해 package에 cache한다. */
export function packageEntryTree(sourcePackage: HwpxSourcePackage, path: string): SourceTree {
  let trees = packageTrees.get(sourcePackage)
  const cached = trees?.get(path)
  if (cached) return cached
  const tree = parseSourceTree(decodeUtf8Entry(sourcePackage, path))
  if (!trees) {
    trees = new Map()
    packageTrees.set(sourcePackage, trees)
  }
  trees.set(path, tree)
  return tree
}

/**
 * package의 tree cache를 떼어 낸다. 돌려받은 tree는 제자리에서 고쳐도 되고, 끝나면 {@link putPackageTrees}로
 * 새 package에 붙인다. cache가 없으면 빈 Map을 돌려준다.
 */
export function takePackageTrees(sourcePackage: HwpxSourcePackage): PackageTrees {
  const trees = packageTrees.get(sourcePackage) ?? new Map<string, SourceTree>()
  packageTrees.delete(sourcePackage)
  return trees
}

/** 고친 tree cache를 package에 붙인다. tree는 그 package의 entry bytes와 같은 문자열로 직렬화되어야 한다. */
export function putPackageTrees(sourcePackage: HwpxSourcePackage, trees: PackageTrees): void {
  packageTrees.set(sourcePackage, trees)
}

/** 고친 tree를 직렬화해 package entry bytes로 쓴다. 같은 bytes면 package가 그대로다. */
export function withSerializedTree(
  sourcePackage: HwpxSourcePackage,
  path: string,
  tree: SourceTree
): HwpxSourcePackage {
  return sourcePackage.withEntry(path, Buffer.from(serializeSourceTree(tree), 'utf8'))
}

/** test 전용: package의 cache를 지워 다음 조회가 다시 parse하게 한다. */
export function forgetPackageTrees(sourcePackage: HwpxSourcePackage): void {
  packageTrees.delete(sourcePackage)
}
