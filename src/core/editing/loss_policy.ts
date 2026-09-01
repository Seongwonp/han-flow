import type { HwpxSourcePackage } from '../parser/source_package'
import type { EditCommand } from './transaction'

export type HwpxEditedStructure =
  | 'text'
  | 'character-style'
  | 'paragraph-style'
  | 'paragraph-structure'

export type HwpxPreviewStatus = 'current' | 'stale' | 'omitted'

export type HwpxLossPolicyNotice =
  | 'PREVIEW_STALE'
  | 'PREVIEW_OMITTED'
  | 'PARAGRAPH_STRUCTURE_CHANGED'

export interface HwpxStructureLossPolicy {
  structure: HwpxEditedStructure
  preservation: 'targeted-source-edit'
  compatibilityRisk: 'low' | 'review'
}

export interface HwpxSaveLossPolicy {
  structures: HwpxStructureLossPolicy[]
  untouchedContent: 'preserved'
  previewStatus: HwpxPreviewStatus
  notices: HwpxLossPolicyNotice[]
  reviewRecommended: boolean
}

const STRUCTURE_ORDER: HwpxEditedStructure[] = [
  'text',
  'character-style',
  'paragraph-style',
  'paragraph-structure'
]

function commandStructure(command: EditCommand): HwpxEditedStructure {
  if (command.type === 'replace-text') return 'text'
  if (command.type === 'apply-character-style' || command.type === 'restore-character-run') {
    return 'character-style'
  }
  if (command.type === 'apply-paragraph-style') return 'paragraph-style'
  if (command.type === 'restore-style') {
    return command.target === 'character' ? 'character-style' : 'paragraph-style'
  }
  return 'paragraph-structure'
}

export function mergeEditedStructures(
  ...groups: ReadonlyArray<readonly HwpxEditedStructure[]>
): HwpxEditedStructure[] {
  const structures = new Set(groups.flat())
  return STRUCTURE_ORDER.filter((structure) => structures.has(structure))
}

export function editedStructuresForCommands(
  commands: readonly EditCommand[]
): HwpxEditedStructure[] {
  return mergeEditedStructures(commands.map(commandStructure))
}

export function createSaveLossPolicy(
  sourcePackage: HwpxSourcePackage,
  editedStructures: readonly HwpxEditedStructure[]
): HwpxSaveLossPolicy {
  const structures = mergeEditedStructures(editedStructures)
  const hasPreview = sourcePackage
    .listEntries()
    .some((entry) => entry.path.startsWith('Preview/'))
  const previewStatus: HwpxPreviewStatus = !hasPreview
    ? 'omitted'
    : structures.length > 0
      ? 'stale'
      : 'current'
  const notices: HwpxLossPolicyNotice[] = []
  if (previewStatus === 'stale') notices.push('PREVIEW_STALE')
  if (previewStatus === 'omitted') notices.push('PREVIEW_OMITTED')
  if (structures.includes('paragraph-structure')) {
    notices.push('PARAGRAPH_STRUCTURE_CHANGED')
  }

  return {
    structures: structures.map((structure) => ({
      structure,
      preservation: 'targeted-source-edit',
      compatibilityRisk: structure === 'paragraph-structure' ? 'review' : 'low'
    })),
    untouchedContent: 'preserved',
    previewStatus,
    notices,
    reviewRecommended: notices.includes('PREVIEW_STALE') ||
      notices.includes('PARAGRAPH_STRUCTURE_CHANGED')
  }
}
