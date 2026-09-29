import { isDevToolsShortcut } from '../../src/main/dev_tools_shortcut'

const input = (key: string, modifiers: Partial<{ control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
  type: 'keyDown',
  key,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...modifiers
})

describe('개발 빌드 DevTools 단축키', () => {
  test('Windows·Linux는 F12와 Ctrl+Shift+I만 DevTools로 본다', () => {
    for (const platform of ['win32', 'linux']) {
      expect(isDevToolsShortcut(input('F12'), platform)).toBe(true)
      expect(isDevToolsShortcut(input('I', { control: true, shift: true }), platform)).toBe(true)
      expect(isDevToolsShortcut(input('i', { control: true, shift: true }), platform)).toBe(true)
      expect(isDevToolsShortcut(input('i', { control: true }), platform)).toBe(false)
      expect(isDevToolsShortcut(input('I', { control: true, shift: true, alt: true }), platform)).toBe(false)
      expect(isDevToolsShortcut(input('F12', { control: true }), platform)).toBe(false)
      expect(isDevToolsShortcut({ ...input('F12'), type: 'keyUp' }, platform)).toBe(false)
    }
  })

  test('macOS는 기본 메뉴가 남아 있으므로 가로채지 않는다', () => {
    expect(isDevToolsShortcut(input('F12'), 'darwin')).toBe(false)
    expect(isDevToolsShortcut(input('I', { control: true, shift: true }), 'darwin')).toBe(false)
  })
})
