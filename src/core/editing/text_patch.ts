import { HwpxSourcePackage } from '../parser/source_package'

export interface HwpxTextAnchor {
  sectionPath: string
  textNodeId: string
  ordinal: number
  text: string
}

export interface ReplaceTextCommand {
  type: 'replace-text'
  revision: number
  sectionPath: string
  textNodeId: string
  from: number
  to: number
  insert: string
}

export interface HwpxLossReport {
  preservedEntries: string[]
  modifiedEntries: string[]
  regeneratedEntries: string[]
  omittedEntries: Array<{ path: string; reason: string }>
  unsupportedFeatures: Array<{
    code: string
    location?: string
    policy: 'preserved' | 'blocked' | 'removed'
  }>
  previewStatus: 'current' | 'stale' | 'omitted'
}

export interface ReplaceTextResult {
  package: HwpxSourcePackage
  inverse: ReplaceTextCommand
  anchor: HwpxTextAnchor
  lossReport: HwpxLossReport
}

export class HwpxEditConflictError extends Error {
  readonly code = 'HWPX_EDIT_CONFLICT'
}

interface SourceTextNode extends HwpxTextAnchor {
  contentStart: number
  contentEnd: number
}

interface XmlToken {
  start: number
  end: number
  kind: 'open' | 'close' | 'self-close' | 'special'
  name?: string
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index]
    if (quote) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index + 1
    }
  }
  throw new Error('끝나지 않은 XML tag가 있습니다.')
}

function tokenizeXml(xml: string): XmlToken[] {
  const tokens: XmlToken[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const close = xml.indexOf('-->', start + 4)
      if (close < 0) throw new Error('끝나지 않은 XML comment가 있습니다.')
      tokens.push({ start, end: close + 3, kind: 'special' })
      cursor = close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const close = xml.indexOf(']]>', start + 9)
      if (close < 0) throw new Error('끝나지 않은 XML CDATA가 있습니다.')
      tokens.push({ start, end: close + 3, kind: 'special' })
      cursor = close + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const close = xml.indexOf('?>', start + 2)
      if (close < 0) throw new Error('끝나지 않은 XML processing instruction이 있습니다.')
      tokens.push({ start, end: close + 2, kind: 'special' })
      cursor = close + 2
      continue
    }

    const end = findTagEnd(xml, start)
    const source = xml.slice(start, end)
    if (source.startsWith('<!')) {
      tokens.push({ start, end, kind: 'special' })
    } else {
      const closing = /^<\s*\//.test(source)
      const match = source.match(closing ? /^<\s*\/\s*([^\s>]+)/ : /^<\s*([^\s/>]+)/)
      if (!match) throw new Error(`해석할 수 없는 XML tag가 있습니다: ${source.slice(0, 32)}`)
      const selfClosing = !closing && /\/\s*>$/.test(source)
      tokens.push({
        start,
        end,
        kind: closing ? 'close' : selfClosing ? 'self-close' : 'open',
        name: match[1]
      })
    }
    cursor = end
  }
  return tokens
}

function decodeXmlText(source: string): string {
  let decoded = ''
  let cursor = 0
  const entityPattern = /&([^;]+);/g
  for (const match of source.matchAll(entityPattern)) {
    const index = match.index ?? 0
    const plain = source.slice(cursor, index)
    if (plain.includes('&')) throw new Error('해석할 수 없는 XML entity가 있습니다.')
    decoded += plain
    const entity = match[1]
    if (entity === 'amp') decoded += '&'
    else if (entity === 'lt') decoded += '<'
    else if (entity === 'gt') decoded += '>'
    else if (entity === 'quot') decoded += '"'
    else if (entity === 'apos') decoded += "'"
    else if (/^#\d+$/.test(entity)) decoded += String.fromCodePoint(Number(entity.slice(1)))
    else if (/^#x[\da-f]+$/i.test(entity)) decoded += String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    else throw new Error(`지원하지 않는 XML entity입니다: &${entity};`)
    cursor = index + match[0].length
  }
  const tail = source.slice(cursor)
  if (tail.includes('&')) throw new Error('해석할 수 없는 XML entity가 있습니다.')
  return decoded + tail
}

function isValidXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}

export function escapeXmlText(text: string): string {
  for (const character of text) {
    if (!isValidXmlCharacter(character.codePointAt(0)!)) {
      throw new Error('XML 1.0에서 허용하지 않는 문자가 포함되어 있습니다.')
    }
  }
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

function decodeUtf8(bytes: Buffer): string {
  const xml = bytes.toString('utf8')
  if (!Buffer.from(xml, 'utf8').equals(bytes)) {
    throw new Error('UTF-8이 아닌 section XML은 아직 편집할 수 없습니다.')
  }
  return xml
}

function sourceTextNodes(sectionPath: string, xml: string): SourceTextNode[] {
  const result: SourceTextNode[] = []
  let ordinal = 0
  let active: { ordinal: number; contentStart: number; complex: boolean } | undefined

  for (const token of tokenizeXml(xml)) {
    if (!active) {
      if (token.name !== 'hp:t' || (token.kind !== 'open' && token.kind !== 'self-close')) continue
      const currentOrdinal = ordinal
      ordinal += 1
      if (token.kind === 'open') {
        active = {
          ordinal: currentOrdinal,
          contentStart: token.end,
          complex: false
        }
      }
      continue
    }

    if (token.kind === 'close' && token.name === 'hp:t') {
      if (!active.complex) {
        try {
          const text = decodeXmlText(xml.slice(active.contentStart, token.start))
          result.push({
            sectionPath,
            textNodeId: `${sectionPath}#hp:t:${active.ordinal}`,
            ordinal: active.ordinal,
            text,
            contentStart: active.contentStart,
            contentEnd: token.start
          })
        } catch {
          // 사용자 정의 entity 등 의미를 안전하게 복원할 수 없는 node는 anchor로 노출하지 않는다.
        }
      }
      active = undefined
      continue
    }
    active.complex = true
  }
  if (active) throw new Error('끝나지 않은 hp:t node가 있습니다.')
  return result
}

export function listHwpxTextAnchors(sourcePackage: HwpxSourcePackage, sectionPath: string): readonly HwpxTextAnchor[] {
  if (!/^Contents\/section\d+\.xml$/.test(sectionPath)) {
    throw new Error(`HWPX section 경로가 아닙니다: ${sectionPath}`)
  }
  return sourceTextNodes(sectionPath, decodeUtf8(sourcePackage.readEntry(sectionPath))).map(
    ({ contentStart: _start, contentEnd: _end, ...anchor }) => anchor
  )
}

function assertTextBoundary(text: string, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new HwpxEditConflictError(`text 범위가 올바르지 않습니다: ${offset}`)
  }
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  ) {
    throw new HwpxEditConflictError('Unicode surrogate pair 중간은 편집할 수 없습니다.')
  }
}

export function applyReplaceTextCommand(
  sourcePackage: HwpxSourcePackage,
  command: ReplaceTextCommand
): ReplaceTextResult {
  if (command.type !== 'replace-text') throw new Error('지원하지 않는 HWPX 편집 command입니다.')
  if (command.revision !== sourcePackage.revision) {
    throw new HwpxEditConflictError(
      `문서 revision이 변경되었습니다: expected ${command.revision}, actual ${sourcePackage.revision}`
    )
  }

  const sectionBytes = sourcePackage.readEntry(command.sectionPath)
  const xml = decodeUtf8(sectionBytes)
  const sourceNode = sourceTextNodes(command.sectionPath, xml).find((node) => node.textNodeId === command.textNodeId)
  if (!sourceNode) throw new HwpxEditConflictError(`text anchor를 찾을 수 없습니다: ${command.textNodeId}`)
  assertTextBoundary(sourceNode.text, command.from)
  assertTextBoundary(sourceNode.text, command.to)
  if (command.from > command.to) throw new HwpxEditConflictError('text 범위의 시작이 끝보다 큽니다.')

  const removed = sourceNode.text.slice(command.from, command.to)
  const nextText = sourceNode.text.slice(0, command.from) + command.insert + sourceNode.text.slice(command.to)
  const nextXml = xml.slice(0, sourceNode.contentStart) + escapeXmlText(nextText) + xml.slice(sourceNode.contentEnd)
  const nextPackage = sourcePackage.withEntry(command.sectionPath, Buffer.from(nextXml, 'utf8'))
  const entries = sourcePackage.listEntries()
  const hasPreview = entries.some((entry) => entry.path.startsWith('Preview/'))

  return {
    package: nextPackage,
    inverse: {
      type: 'replace-text',
      revision: nextPackage.revision,
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      from: command.from,
      to: command.from + command.insert.length,
      insert: removed
    },
    anchor: {
      sectionPath: sourceNode.sectionPath,
      textNodeId: sourceNode.textNodeId,
      ordinal: sourceNode.ordinal,
      text: nextText
    },
    lossReport: {
      preservedEntries: entries.map((entry) => entry.path).filter((path) => path !== command.sectionPath),
      modifiedEntries: [command.sectionPath],
      regeneratedEntries: [],
      omittedEntries: [],
      unsupportedFeatures: [],
      previewStatus: hasPreview ? 'stale' : 'omitted'
    }
  }
}
