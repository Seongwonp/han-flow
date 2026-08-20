import {
  isAllowedExternalUrl,
  isSameTrustedDocument
} from '../../src/main/external_navigation'

describe('external navigation policy', () => {
  test.each([
    'https://example.com/help',
    'https://developer.apple.com/documentation/'
  ])('HTTPS 외부 URL만 허용한다: %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  test.each([
    'http://example.com',
    'file:///tmp/document.html',
    'javascript:alert(1)',
    'data:text/html,test',
    'mailto:test@example.com',
    'not a url'
  ])('위험하거나 예상하지 않은 외부 protocol을 거부한다: %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })

  test('개발 서버에서는 같은 origin 안의 navigation만 내부에 유지한다', () => {
    expect(isSameTrustedDocument('http://localhost:5173/settings', 'http://localhost:5173/')).toBe(true)
    expect(isSameTrustedDocument('http://127.0.0.1:5173/', 'http://localhost:5173/')).toBe(false)
  })

  test('package file에서는 현재 renderer 문서 자체만 신뢰한다', () => {
    const current = 'file:///Applications/Han-Flow.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(isSameTrustedDocument(current, current)).toBe(true)
    expect(isSameTrustedDocument('file:///tmp/other.html', current)).toBe(false)
  })
})
