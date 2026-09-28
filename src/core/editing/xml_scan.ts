import type { HwpxSourcePackage } from '../parser/source_package'
import type { HwpxLossReport } from './text_patch'

/**
 * 편집 command가 적용될 원본 위치가 기대와 달라졌을 때 던지는 오류.
 *
 * 편집 코어 모듈 사이의 import cycle을 피하려고 leaf module인 여기에 정의하고,
 * 기존 공개 경로(`./text_patch`)는 그대로 re-export한다.
 */
export class HwpxEditConflictError extends Error {
  readonly code = 'HWPX_EDIT_CONFLICT'
}

/** raw XML 문자열 위의 element 하나가 차지하는 UTF-16 offset 범위. */
export interface XmlElementSpan {
  name: string
  /** `<` 위치 */
  start: number
  /** 여는 tag 바로 뒤 위치. self-closing이면 `end`와 같다. */
  openEnd: number
  /** 닫는 tag의 `<` 위치. self-closing이면 `end`와 같다. */
  closeStart: number
  /** 닫는 tag 바로 뒤 위치 */
  end: number
  parent?: XmlElementSpan
}

/**
 * 오류 형식.
 * - `'plain'`: `Error`를 던지고 tag 이름·원문 일부를 message에 덧붙인다(문단·style patch 방식).
 * - `'conflict'`: `HwpxEditConflictError`를 던지고 상세 정보 없는 짧은 message를 쓴다(표·셀 style patch 방식).
 */
export type XmlScanErrorMode = 'plain' | 'conflict'

export interface XmlScanOptions {
  /** 기본값 `'plain'`. {@link XmlScanErrorMode} 참고. */
  errors?: XmlScanErrorMode
  /**
   * `<![CDATA[ ... ]]>` 처리 방식. 기본값 `'skip'`.
   * - `'skip'`: `]]>`까지 불투명 구간으로 건너뛰고, 닫히지 않으면 오류를 던진다.
   * - `'as-tag'`: CDATA를 일반 `<!` tag처럼 {@link findTagEnd}로 끝을 찾아 건너뛴다.
   *   CDATA 본문에 `>`나 따옴표가 있으면 경계를 잘못 잡는 기존 표·셀 scanner 동작을 그대로 재현하기 위한 값이다.
   */
  cdata?: 'skip' | 'as-tag'
}

/**
 * 표 구조·셀 style patch가 써 온 scanner 동작.
 * 충돌 오류(`HwpxEditConflictError`)와 짧은 message, CDATA를 일반 `<!` tag로 다루는 방식을 유지한다.
 */
export const TABLE_SCAN_OPTIONS: Readonly<XmlScanOptions> = Object.freeze({ errors: 'conflict', cdata: 'as-tag' })

function scanError(mode: XmlScanErrorMode, message: string): Error {
  return mode === 'conflict' ? new HwpxEditConflictError(message) : new Error(message)
}

/**
 * `start`의 `<`에서 시작하는 tag의 끝(`>` 다음 위치)을 찾는다.
 * 큰따옴표·작은따옴표 안의 `>`는 tag 끝으로 보지 않는다.
 */
export function findTagEnd(xml: string, start: number, errors: XmlScanErrorMode = 'plain'): number {
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
  throw scanError(errors, '끝나지 않은 XML tag가 있습니다.')
}

interface OpenElement {
  name: string
  start: number
  openEnd: number
  parent?: XmlElementSpan
}

function provisionalParent(open: OpenElement | undefined): XmlElementSpan | undefined {
  return open
    ? { name: open.name, start: open.start, openEnd: open.openEnd, closeStart: -1, end: -1, parent: open.parent }
    : undefined
}

/**
 * raw XML을 훑어 모든 element의 offset 범위를 시작 위치 순으로 돌려준다.
 * comment, processing instruction, `<!` 선언은 element로 보지 않는다.
 * 각 span의 `parent`는 최종적으로 같은 배열 안의 span 객체를 가리킨다.
 */
export function scanXmlElements(xml: string, options: XmlScanOptions = {}): XmlElementSpan[] {
  const errors = options.errors ?? 'plain'
  const detailed = errors === 'plain'
  const spans: XmlElementSpan[] = []
  const stack: OpenElement[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const close = xml.indexOf('-->', start + 4)
      if (close < 0) throw scanError(errors, '끝나지 않은 XML comment가 있습니다.')
      cursor = close + 3
      continue
    }
    if ((options.cdata ?? 'skip') === 'skip' && xml.startsWith('<![CDATA[', start)) {
      const close = xml.indexOf(']]>', start + 9)
      if (close < 0) throw scanError(errors, '끝나지 않은 XML CDATA가 있습니다.')
      cursor = close + 3
      continue
    }
    if (xml.startsWith('<?', start)) {
      const close = xml.indexOf('?>', start + 2)
      if (close < 0) {
        throw scanError(errors, detailed ? '끝나지 않은 XML processing instruction이 있습니다.' : '끝나지 않은 XML 선언이 있습니다.')
      }
      cursor = close + 2
      continue
    }
    const end = findTagEnd(xml, start, errors)
    const source = xml.slice(start, end)
    if (source.startsWith('<!')) {
      cursor = end
      continue
    }
    const closing = /^<\s*\//.test(source)
    const name = source.match(closing ? /^<\s*\/\s*([^\s>]+)/ : /^<\s*([^\s/>]+)/)?.[1]
    if (!name) {
      throw scanError(errors, detailed ? `해석할 수 없는 XML tag가 있습니다: ${source.slice(0, 32)}` : '해석할 수 없는 XML tag가 있습니다.')
    }
    const selfClosing = !closing && /\/\s*>$/.test(source)
    if (closing) {
      const open = stack.pop()
      if (!open || open.name !== name) {
        throw scanError(errors, detailed ? `XML tag 순서가 올바르지 않습니다: ${name}` : 'XML tag 순서가 올바르지 않습니다.')
      }
      spans.push({ name, start: open.start, openEnd: open.openEnd, closeStart: start, end, parent: open.parent })
    } else if (selfClosing) {
      spans.push({ name, start, openEnd: end, closeStart: end, end, parent: provisionalParent(stack[stack.length - 1]) })
    } else {
      stack.push({ name, start, openEnd: end, parent: provisionalParent(stack[stack.length - 1]) })
    }
    cursor = end
  }
  if (stack.length) {
    throw scanError(
      errors,
      detailed ? `끝나지 않은 XML element가 있습니다: ${stack[stack.length - 1].name}` : '끝나지 않은 XML element가 있습니다.'
    )
  }
  const byStart = new Map(spans.map((span) => [span.start, span]))
  for (const span of spans) if (span.parent) span.parent = byStart.get(span.parent.start)
  return spans.sort((left, right) => left.start - right.start)
}

/** `span`의 조상 중 이름이 `name`인 가장 가까운 element. */
export function nearestAncestor(span: XmlElementSpan, name: string): XmlElementSpan | undefined {
  let current = span.parent
  while (current) {
    if (current.name === name) return current
    current = current.parent
  }
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 여는 tag 문자열에서 attribute 값을 읽는다(entity는 해석하지 않는다).
 * 정규식 기반이므로 다른 attribute 값 안의 ` name="..."` 문자열이나 줄바꿈이 들어간 값은 정확히 다루지 못한다.
 */
export function attribute(openTag: string, name: string): string | undefined {
  return openTag.match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`))?.[2]
}

/**
 * 여는 tag 문자열의 attribute 값을 바꾸거나, 없으면 tag 끝에 ` name="value"`로 덧붙인다.
 * 기존 따옴표 종류는 유지하며 `value`는 escape하지 않는다.
 */
export function setAttribute(openTag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`)
  if (pattern.test(openTag)) {
    return openTag.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${value}${quote}`)
  }
  return openTag.replace(/(\s*\/?>)$/, ` ${name}="${value}"$1`)
}

export function replaceRange(source: string, start: number, end: number, replacement: string): string {
  return source.slice(0, start) + replacement + source.slice(end)
}

export interface TargetOrdinalMessages {
  /** `textNodeId`가 `${sectionPath}#hp:t:`로 시작하지 않을 때 */
  sectionMismatch: (textNodeId: string) => string
  /** ordinal이 음이 아닌 safe integer가 아닐 때 */
  invalidOrdinal: (textNodeId: string) => string
}

/** 문단·style patch가 쓰는 기본 message. */
export const TEXT_ANCHOR_ORDINAL_MESSAGES: TargetOrdinalMessages = {
  sectionMismatch: (textNodeId) => `text anchor가 section과 일치하지 않습니다: ${textNodeId}`,
  invalidOrdinal: (textNodeId) => `text anchor ordinal이 올바르지 않습니다: ${textNodeId}`
}

/** 두 경우 모두 같은 message를 쓰는 호출부를 위한 helper. */
export function sameOrdinalMessage(message: (textNodeId: string) => string): TargetOrdinalMessages {
  return { sectionMismatch: message, invalidOrdinal: message }
}

/** `${sectionPath}#hp:t:N` 형식 anchor에서 section 안 `hp:t` 순번 N을 꺼낸다. */
export function targetOrdinal(
  sectionPath: string,
  textNodeId: string,
  messages: TargetOrdinalMessages = TEXT_ANCHOR_ORDINAL_MESSAGES
): number {
  const prefix = `${sectionPath}#hp:t:`
  if (!textNodeId.startsWith(prefix)) throw new HwpxEditConflictError(messages.sectionMismatch(textNodeId))
  const ordinal = Number(textNodeId.slice(prefix.length))
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new HwpxEditConflictError(messages.invalidOrdinal(textNodeId))
  }
  return ordinal
}

/**
 * `offset`이 UTF-16 surrogate pair 가운데가 아니면 true.
 * 문자열 양 끝과 범위 밖 offset은 검사하지 않고 true로 본다.
 */
export function isSurrogateBoundarySafe(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  )
}

/**
 * 원본 package의 entry 목록을 기준으로 loss report를 만든다.
 * `previewStatus`를 생략하면 `Preview/` entry가 있을 때 `'stale'`, 없으면 `'omitted'`다.
 */
export function buildLossReport(
  sourcePackage: Pick<HwpxSourcePackage, 'listEntries'>,
  modifiedEntries: string[],
  previewStatus?: HwpxLossReport['previewStatus']
): HwpxLossReport {
  const entries = sourcePackage.listEntries().map((entry) => entry.path)
  return {
    preservedEntries: entries.filter((path) => !modifiedEntries.includes(path)),
    modifiedEntries,
    regeneratedEntries: [],
    omittedEntries: [],
    unsupportedFeatures: [],
    previewStatus: previewStatus ?? (entries.some((path) => path.startsWith('Preview/')) ? 'stale' : 'omitted')
  }
}
