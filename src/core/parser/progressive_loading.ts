import { HwpxPackageIndex } from './package_reader'

export const PROGRESSIVE_SECTION_COUNT = 20
export const PROGRESSIVE_SECTION_BYTES = 2 * 1024 * 1024

export function shouldLoadProgressively(index: HwpxPackageIndex): boolean {
  return index.sectionPaths.length >= PROGRESSIVE_SECTION_COUNT ||
    index.sectionPaths.some((path) => (index.sectionSizes[path] ?? 0) >= PROGRESSIVE_SECTION_BYTES)
}
