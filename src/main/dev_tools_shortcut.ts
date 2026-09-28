type DevToolsKeyInput = Pick<Electron.Input, 'type' | 'key' | 'control' | 'meta' | 'shift' | 'alt'>

/**
 * 개발 빌드의 Windows·Linux는 기본 메뉴를 제거해 DevTools 메뉴 단축키도 사라지므로
 * 창 단위 before-input-event에서 F12와 Ctrl+Shift+I를 직접 처리한다.
 * macOS는 기본 메뉴의 ⌥⌘I가 남아 있으므로 대상이 아니다.
 */
export function isDevToolsShortcut(input: DevToolsKeyInput, platform: string): boolean {
  if (platform === 'darwin' || input.type !== 'keyDown') return false
  if (input.key === 'F12' && !input.control && !input.shift && !input.alt && !input.meta) return true
  return input.control && input.shift && !input.alt && !input.meta && input.key.toLowerCase() === 'i'
}
