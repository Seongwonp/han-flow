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

/**
 * `start`의 `<`에서 시작하는 tag의 끝(`>` 다음 위치)을 찾는다.
 * 큰따옴표·작은따옴표 안의 `>`는 tag 끝으로 보지 않는다.
 */
export function findTagEnd(xml: string, start: number): number {
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

/**
 * markup token 종류.
 * - `open`/`close`/`self-close`: element tag
 * - `comment`: `<!-- ... -->`
 * - `cdata`: `<![CDATA[ ... ]]>`(본문은 `]]>`까지 불투명 구간)
 * - `pi`: `<? ... ?>`(XML 선언 포함)
 * - `declaration`: 그 밖의 `<!` tag(`<!DOCTYPE ...>` 등)
 */
export type XmlTokenKind = 'open' | 'close' | 'self-close' | 'comment' | 'cdata' | 'pi' | 'declaration'

/** raw XML 위 markup token 하나. token 사이의 문자열은 모두 text다. */
export interface XmlToken {
  kind: XmlTokenKind
  /** `<` 위치 */
  start: number
  /** token 바로 뒤 위치 */
  end: number
  /** element tag(`open`/`close`/`self-close`)의 이름 */
  name?: string
}

/**
 * raw XML의 markup token을 문서 순서대로 하나씩 돌려준다. token 사이 구간이 text다.
 * element 짝(여는·닫는 tag 순서)은 검사하지 않는다. 오류는 해당 token에 도달했을 때 던진다.
 * 편집 source tree(`source_tree.ts`)가 이 tokenizer로 section·header XML을 읽는다.
 */
export function* iterateXmlTokens(xml: string): Generator<XmlToken, void, undefined> {
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor)
    if (start < 0) break
    if (xml.startsWith('<!--', start)) {
      const close = xml.indexOf('-->', start + 4)
      if (close < 0) throw new Error('끝나지 않은 XML comment가 있습니다.')
      cursor = close + 3
      yield { kind: 'comment', start, end: cursor }
      continue
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const close = xml.indexOf(']]>', start + 9)
      if (close < 0) throw new Error('끝나지 않은 XML CDATA가 있습니다.')
      cursor = close + 3
      yield { kind: 'cdata', start, end: cursor }
      continue
    }
    if (xml.startsWith('<?', start)) {
      const close = xml.indexOf('?>', start + 2)
      if (close < 0) throw new Error('끝나지 않은 XML processing instruction이 있습니다.')
      cursor = close + 2
      yield { kind: 'pi', start, end: cursor }
      continue
    }
    const end = findTagEnd(xml, start)
    cursor = end
    if (xml.startsWith('<!', start)) {
      yield { kind: 'declaration', start, end }
      continue
    }
    const source = xml.slice(start, end)
    const closing = /^<\s*\//.test(source)
    const name = source.match(closing ? /^<\s*\/\s*([^\s>]+)/ : /^<\s*([^\s/>]+)/)?.[1]
    if (!name) throw new Error(`해석할 수 없는 XML tag가 있습니다: ${source.slice(0, 32)}`)
    const selfClosing = !closing && /\/\s*>$/.test(source)
    yield { kind: closing ? 'close' : selfClosing ? 'self-close' : 'open', start, end, name }
  }
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
