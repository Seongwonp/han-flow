import { XMLParser } from 'fast-xml-parser'

export interface OrderedXmlNode {
  name: string
  attributes: Record<string, string>
  children: OrderedXmlNode[]
  text?: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: '',
  trimValues: false
})

function convert(entry: Record<string, unknown>): OrderedXmlNode {
  if ('#text' in entry) {
    return { name: '#text', attributes: {}, children: [], text: String(entry['#text'] ?? '') }
  }

  const name = Object.keys(entry).find((key) => key !== ':@')
  if (!name) throw new Error('이름이 없는 XML 노드입니다.')
  const rawChildren = entry[name]
  return {
    name,
    attributes: (entry[':@'] as Record<string, string> | undefined) ?? {},
    children: Array.isArray(rawChildren)
      ? rawChildren.map((child) => convert(child as Record<string, unknown>))
      : []
  }
}

export function parseOrderedXml(xml: Buffer | string): OrderedXmlNode[] {
  const parsed = parser.parse(xml) as Record<string, unknown>[]
  return parsed.map(convert)
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
