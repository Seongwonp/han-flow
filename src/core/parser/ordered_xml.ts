import { XMLParser } from 'fast-xml-parser'
import { validateXmlResourceBudget } from './resource_budget'

export interface OrderedXmlNode {
  name: string
  attributes: Record<string, string>
  children: OrderedXmlNode[]
  text?: string
  sourceOrdinal?: number
  /** `hp:p`의 section 안 문서 순서 번호(빈 문단 합성 anchor `#hp:p:N:empty`의 N). 편집 source tree와 같은 번호다. */
  sourceParagraphOrdinal?: number
}

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: '',
  trimValues: false
})

interface ConvertContext {
  textOrdinal: number
  paragraphOrdinal: number
}

function convert(entry: Record<string, unknown>, context: ConvertContext): OrderedXmlNode {
  if ('#text' in entry) {
    return { name: '#text', attributes: {}, children: [], text: String(entry['#text'] ?? '') }
  }

  const name = Object.keys(entry).find((key) => key !== ':@')
  if (!name) throw new Error('이름이 없는 XML 노드입니다.')
  const rawChildren = entry[name]
  const sourceOrdinal = name === 'hp:t' ? context.textOrdinal++ : undefined
  const sourceParagraphOrdinal = name === 'hp:p' ? context.paragraphOrdinal++ : undefined
  return {
    name,
    attributes: (entry[':@'] as Record<string, string> | undefined) ?? {},
    children: Array.isArray(rawChildren)
      ? rawChildren.map((child) => convert(child as Record<string, unknown>, context))
      : [],
    sourceOrdinal,
    ...(sourceParagraphOrdinal !== undefined ? { sourceParagraphOrdinal } : {})
  }
}

export function parseOrderedXml(xml: Buffer | string): OrderedXmlNode[] {
  const validatedXml = validateXmlResourceBudget(xml)
  const parsed = parser.parse(validatedXml) as Record<string, unknown>[]
  const context: ConvertContext = { textOrdinal: 0, paragraphOrdinal: 0 }
  return parsed.map((entry) => convert(entry, context))
}

export function walkOrderedXml(nodes: OrderedXmlNode[]): OrderedXmlNode[] {
  const result: OrderedXmlNode[] = []
  const visit = (node: OrderedXmlNode): void => {
    result.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}
