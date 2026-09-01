import { EditorSelection } from './selection'

export interface CharacterStyleCapability {
  available: boolean
  reason?: 'NO_SELECTION' | 'MULTI_RUN_SELECTION'
}

export function characterStyleCapability(
  selection: EditorSelection | undefined
): CharacterStyleCapability {
  if (!selection) return { available: false, reason: 'NO_SELECTION' }
  if (selection.anchorTextNodeId !== selection.focusTextNodeId) {
    return { available: false, reason: 'MULTI_RUN_SELECTION' }
  }
  return { available: true }
}
