export type ShortcutAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'save'
  | 'undo'
  | 'redo'
  | 'search'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'

export type HistoryDirection = 'undo' | 'redo'

type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export const isMacPlatform = (platform: string | undefined): boolean => platform === 'darwin'

/** preload가 노출한 Electron `process.platform`. 테스트·비 Electron 환경에서는 빈 문자열이다. */
export function rendererPlatform(): string {
  const platform = (globalThis as { api?: { platform?: unknown } }).api?.platform
  return typeof platform === 'string' ? platform : ''
}

/**
 * macOS는 ⌘(metaKey), 그 밖의 OS는 Ctrl을 단축키 modifier로 쓴다.
 * macOS에서 Ctrl만 누른 조합과 Windows에서 Win 키 조합은 무시한다.
 * Windows·Linux의 Ctrl+Alt는 AltGr 문자 입력일 수 있으므로 단축키로 보지 않는다.
 */
export function shortcutModifierPressed(event: ShortcutKeyEvent, platform: string): boolean {
  if (isMacPlatform(platform)) return event.metaKey
  return event.ctrlKey && !event.metaKey && !event.altKey
}

export function resolveShortcut(event: ShortcutKeyEvent, platform: string): ShortcutAction | undefined {
  if (!shortcutModifierPressed(event, platform)) return undefined
  const key = event.key.toLocaleLowerCase()
  if (key === 'b') return 'bold'
  if (key === 'i') return 'italic'
  if (key === 'u') return 'underline'
  if (key === 's') return 'save'
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !isMacPlatform(platform) && !event.shiftKey) return 'redo'
  if (key === 'f') return 'search'
  if (event.key === '+' || event.key === '=') return 'zoomIn'
  if (event.key === '-') return 'zoomOut'
  if (event.key === '0') return 'zoomReset'
  return undefined
}

/** ribbon tooltip용 단축키 표기. 예: `shortcutLabel('Z', platform, { shift: true })` */
export function shortcutLabel(key: string, platform: string, options: { shift?: boolean } = {}): string {
  if (isMacPlatform(platform)) return `${options.shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${options.shift ? 'Shift+' : ''}${key}`
}

export function historyInputDirection(inputType: string): HistoryDirection | undefined {
  if (inputType === 'historyUndo') return 'undo'
  if (inputType === 'historyRedo') return 'redo'
  return undefined
}

/**
 * contentEditable의 브라우저 기본 undo/redo는 DOM을 직접 바꿔 새 편집으로 commit될 수 있다.
 * 기본 동작을 막고, IME 조합 중이 아니면 앱 transaction history로 보낸다.
 * history input을 처리했으면 true를 돌려준다.
 */
export function interceptHistoryInput(
  event: Pick<InputEvent, 'inputType' | 'preventDefault'>,
  composing: boolean,
  onHistory: ((direction: HistoryDirection) => void) | undefined
): boolean {
  const direction = historyInputDirection(event.inputType)
  if (!direction) return false
  event.preventDefault()
  if (!composing) onHistory?.(direction)
  return true
}
