/**
 * @internal 1단계(tree 전환) 비교 oracle 전용 — 제품 코드에서 import하지 않는다.
 *
 * tree 모델로 옮기기 전 `text_patch.ts`의 문자열 구현(byte offset splice, 전용 tokenizer)을 그대로
 * 보존한 사본이다. `tests/editing/text_tree_differential.test.ts`와 교차 parser test가 새 tree 경로와
 * 출력 bytes를 비교하는 데만 쓴다. 2단계에서 삭제한다.
 */
import { HwpxSourcePackage } from '../parser/source_package'
import { buildLossReport, findTagEnd, HwpxEditConflictError, isSurrogateBoundarySafe } from './xml_scan'
import type { HwpxTextAnchor, ReplaceTextCommand, ReplaceTextResult } from './text_patch'

interface SourceTextNode extends HwpxTextAnchor {
  contentStart: number
  contentEnd: number
  /** `hp:t` element 전체(여는 tag부터 닫는 tag까지)의 offset 범위 */
  elementStart: number
  elementEnd: number
  /** 자기 닫힘 `<hp:t/>`이면 true. 이때 content 범위는 비어 있고 element 범위가 tag 하나다. */
  selfClosing: boolean
}

interface SourceTextElement {
  ordinal: number
  elementStart: number
  contentStart: number
  contentEnd: number
  elementEnd: number
  selfClosing: boolean
}

const SELF_CLOSING_END = /\s*\/\s*>$/

/** 자기 닫힘 `<hp:t .../>`를 같은 attribute의 여는 tag `<hp:t ...>`로 바꾼다. */
function expandSelfClosingTag(tag: string): string {
  return tag.replace(SELF_CLOSING_END, '>')
}

function isSelfClosingTextTag(tag: string): boolean {
  return /^<\s*hp:t(?=[\s/])/.test(tag) && SELF_CLOSING_END.test(tag)
}

const INLINE_TEXT_CONTROLS: Readonly<Record<string, string>> = {
  'hp:lineBreak': '\n',
  'hp:tab': '\t'
}

interface XmlToken {
  start: number
  end: number
  kind: 'open' | 'close' | 'self-close' | 'special'
  name?: string
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

function decodeHwpxTextContent(source: string): string {
  let decoded = ''
  let cursor = 0
  for (const token of tokenizeXml(source)) {
    decoded += decodeXmlText(source.slice(cursor, token.start))
    const control = token.name ? INLINE_TEXT_CONTROLS[token.name] : undefined
    if (token.kind !== 'self-close' || control === undefined) {
      throw new Error('지원하지 않는 hp:t 혼합 콘텐츠가 있습니다.')
    }
    decoded += control
    cursor = token.end
  }
  return decoded + decodeXmlText(source.slice(cursor))
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

function escapeXmlText(text: string): string {
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

/** HWPX hp:t의 논리 텍스트를 OWPML 혼합 콘텐츠로 직렬화한다. */
function encodeHwpxTextContent(text: string): string {
  return escapeXmlText(text).replace(/&#10;/g, '<hp:lineBreak/>')
}

function decodeUtf8(bytes: Buffer): string {
  const xml = bytes.toString('utf8')
  if (!Buffer.from(xml, 'utf8').equals(bytes)) {
    throw new Error('UTF-8이 아닌 section XML은 아직 편집할 수 없습니다.')
  }
  return xml
}

/**
 * section XML의 `hp:t` element를 문서 순서대로 훑는다. 자기 닫힘 `<hp:t/>`도 ordinal 하나를 차지한다.
 * ordinal 규칙은 viewer decoder(`ordered_xml.ts`의 `sourceOrdinal`)와 같아야 한다.
 */
function scanTextElements(xml: string): SourceTextElement[] {
  const result: SourceTextElement[] = []
  let active: { ordinal: number; elementStart: number; contentStart: number } | undefined
  for (const token of tokenizeXml(xml)) {
    if (!active) {
      if (token.name !== 'hp:t' || (token.kind !== 'open' && token.kind !== 'self-close')) continue
      const ordinal = result.length
      if (token.kind === 'open') {
        active = { ordinal, elementStart: token.start, contentStart: token.end }
      } else {
        result.push({
          ordinal,
          elementStart: token.start,
          contentStart: token.end,
          contentEnd: token.end,
          elementEnd: token.end,
          selfClosing: true
        })
      }
      continue
    }
    if (token.kind === 'close' && token.name === 'hp:t') {
      result.push({
        ordinal: active.ordinal,
        elementStart: active.elementStart,
        contentStart: active.contentStart,
        contentEnd: token.start,
        elementEnd: token.end,
        selfClosing: false
      })
      active = undefined
    }
  }
  if (active) throw new Error('끝나지 않은 hp:t node가 있습니다.')
  return result
}

function sourceTextNodes(sectionPath: string, xml: string): SourceTextNode[] {
  const result: SourceTextNode[] = []
  for (const element of scanTextElements(xml)) {
    try {
      // 한/글은 빈 입력 칸을 `<hp:t/>`로 저장한다. 빈 anchor로 노출하고 첫 입력 때 열린 tag로 펼친다.
      const text = element.selfClosing
        ? ''
        : decodeHwpxTextContent(xml.slice(element.contentStart, element.contentEnd))
      result.push({
        sectionPath,
        textNodeId: `${sectionPath}#hp:t:${element.ordinal}`,
        text,
        ...element
      })
    } catch {
      // 사용자 정의 entity나 알 수 없는 inline control은 안전하게 복원할 수 없으므로 노출하지 않는다.
    }
  }
  return result
}

/**
 * `hp:t` element를 주어진 논리 텍스트로 다시 쓴다.
 * `openTag`·`closeTag`는 원문 XML에서 잘라 낸 tag이고, 자기 닫힘 `<hp:t/>`이면 `closeTag`는 빈 문자열이다.
 * 자기 닫힘 tag는 text가 비어 있으면 원문 그대로 두고, 아니면 같은 attribute의 열린 tag로 펼친다.
 */
function rewriteHwpxTextElement(openTag: string, closeTag: string, text: string): string {
  if (!closeTag) {
    if (!isSelfClosingTextTag(openTag)) throw new HwpxEditConflictError('hp:t tag 형식이 올바르지 않습니다.')
    return text ? `${expandSelfClosingTag(openTag)}${encodeHwpxTextContent(text)}</hp:t>` : openTag
  }
  return openTag + encodeHwpxTextContent(text) + closeTag
}

/** section XML에 있는 모든 `hp:t`의 ordinal을 편집 tokenizer 기준 문서 순서대로 돌려준다(교차 parser 검증용). */
export function legacyListHwpxTextOrdinals(sourcePackage: HwpxSourcePackage, sectionPath: string): number[] {
  return scanTextElements(decodeUtf8(sourcePackage.readEntry(sectionPath))).map((element) => element.ordinal)
}

export function legacyListHwpxTextAnchors(sourcePackage: HwpxSourcePackage, sectionPath: string): readonly HwpxTextAnchor[] {
  if (!/^Contents\/section\d+\.xml$/.test(sectionPath)) {
    throw new Error(`HWPX section 경로가 아닙니다: ${sectionPath}`)
  }
  return sourceTextNodes(sectionPath, decodeUtf8(sourcePackage.readEntry(sectionPath))).map(
    ({ sectionPath: path, textNodeId, ordinal, text }) => ({ sectionPath: path, textNodeId, ordinal, text })
  )
}

function assertTextBoundary(text: string, offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) {
    throw new HwpxEditConflictError(`text 범위가 올바르지 않습니다: ${offset}`)
  }
  if (!isSurrogateBoundarySafe(text, offset)) {
    throw new HwpxEditConflictError('Unicode surrogate pair 중간은 편집할 수 없습니다.')
  }
}

export function legacyApplyReplaceTextCommand(
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
  let replacement: string
  let restoreSelfClosingTag: string | undefined
  if (sourceNode.selfClosing) {
    // `<hp:t/>` → `<hp:t>…</hp:t>`로 펼친다. inverse가 빈 text로 되돌릴 때 원래 tag bytes를 다시 쓴다.
    const selfClosingTag = xml.slice(sourceNode.elementStart, sourceNode.elementEnd)
    replacement = rewriteHwpxTextElement(selfClosingTag, '', nextText)
    if (nextText) restoreSelfClosingTag = selfClosingTag
  } else if (command.restoreSelfClosingTag !== undefined && nextText === '') {
    const openTag = xml.slice(sourceNode.elementStart, sourceNode.contentStart)
    if (
      !isSelfClosingTextTag(command.restoreSelfClosingTag) ||
      expandSelfClosingTag(command.restoreSelfClosingTag) !== openTag
    ) {
      throw new HwpxEditConflictError('되돌릴 빈 hp:t tag가 현재 원문과 일치하지 않습니다.')
    }
    replacement = command.restoreSelfClosingTag
  } else {
    replacement =
      xml.slice(sourceNode.elementStart, sourceNode.contentStart) +
      encodeHwpxTextContent(nextText) +
      xml.slice(sourceNode.contentEnd, sourceNode.elementEnd)
  }
  const nextXml = xml.slice(0, sourceNode.elementStart) + replacement + xml.slice(sourceNode.elementEnd)
  const nextPackage = sourcePackage.withEntry(command.sectionPath, Buffer.from(nextXml, 'utf8'))

  return {
    package: nextPackage,
    inverse: {
      type: 'replace-text',
      revision: nextPackage.revision,
      sectionPath: command.sectionPath,
      textNodeId: command.textNodeId,
      from: command.from,
      to: command.from + command.insert.length,
      insert: removed,
      ...(restoreSelfClosingTag !== undefined ? { restoreSelfClosingTag } : {})
    },
    anchor: {
      sectionPath: sourceNode.sectionPath,
      textNodeId: sourceNode.textNodeId,
      ordinal: sourceNode.ordinal,
      text: nextText
    },
    lossReport: buildLossReport(sourcePackage, [command.sectionPath])
  }
}
