export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === 'https:'
  } catch {
    return false
  }
}

export function isSameTrustedDocument(rawUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(rawUrl)
    const current = new URL(currentUrl)
    if (target.protocol !== current.protocol) return false
    if (current.protocol === 'file:') return target.href === current.href
    return target.origin === current.origin
  } catch {
    return false
  }
}
