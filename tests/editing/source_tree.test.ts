import { attribute, setAttribute } from '../../src/core/editing/xml_scan'
import {
  collapseElementToSelfClosing,
  createSourceText,
  decodeXmlEntities,
  escapeXmlAttribute,
  findDescendantSourceElements,
  findFirstSourceElement,
  findSourceElements,
  getSourceAttribute,
  nearestSourceAncestor,
  parseSourceFragment,
  parseSourceTree,
  rawTextOffset,
  replaceSourceNode,
  setElementOpenTag,
  spliceSourceChildren,
  parseTagAttributes,
  readTagAttribute,
  replaceElementChildren,
  serializeSourceNode,
  serializeSourceTree,
  setSourceAttribute,
  SourceElement,
  textRaw,
  writeTagAttribute
} from '../../src/core/editing/source_tree'

const EDGE_CASES: Record<string, string> = {
  empty: '',
  textOnly: '  plain &amp; text  ',
  bom: '﻿<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\r\n<r/>\r\n',
  declarations: '<?xml version="1.0"?>\n<!DOCTYPE r>\n<!-- head -->\n<r>\n  <?pi data?>\n</r>\n<!-- tail -->\n',
  cdata: '<r><![CDATA[ <not> & "tags" ]]>after</r>',
  entities: '<r>&lt;a&gt; &amp; &quot;q&quot; &apos;s&apos; &#10;&#x1F600;&#9;</r>',
  selfClosingVariants: '<r><a/><b /><c\n  x="1"\n/><d x=\'2\'   /></r>',
  quotedGreaterThan: '<r a="x>y" b=\'p "q" >\'><t k="1/>">v</t></r>',
  whitespaceBetween: '<r>\n\t<p>\n\t\t<t>a</t>\n\t</p>\n</r>\n\n',
  closeTagSpaces: '<r ><p a="1" >x</p ></r\n>',
  unicode: '<hp:t>한글 😀 텍스트</hp:t>'
}

function onlyElement(xml: string, name: string): { tree: ReturnType<typeof parseSourceTree>; element: SourceElement } {
  const tree = parseSourceTree(xml)
  const [element] = findSourceElements(tree, name)
  if (!element) throw new Error(`element가 없습니다: ${name}`)
  return { tree, element }
}

describe('source tree 파싱과 identity 직렬화', () => {
  test.each(Object.entries(EDGE_CASES))('%s: 편집하지 않은 tree는 입력과 같은 문자열로 직렬화된다', (_name, xml) => {
    expect(serializeSourceTree(parseSourceTree(xml))).toBe(xml)
  })

  test('node 종류와 원문 범위를 보존한다', () => {
    const xml = EDGE_CASES.declarations
    const tree = parseSourceTree(xml)
    expect(tree.children.map((node) => node.kind)).toEqual(['pi', 'text', 'declaration', 'text', 'comment', 'text', 'element', 'text', 'comment', 'text'])
    const [root] = findSourceElements(tree, 'r')
    expect(root.children.map((node) => node.kind)).toEqual(['text', 'pi', 'text'])
    expect(serializeSourceNode(tree, root)).toBe('<r>\n  <?pi data?>\n</r>')
    const text = root.children[0]
    expect(text.kind === 'text' && textRaw(tree, text)).toBe('\n  ')
  })

  test('entity는 text node에 원문 표기로 남고 decodeXmlEntities로만 해석된다', () => {
    const { tree, element } = onlyElement(EDGE_CASES.entities, 'r')
    const [text] = element.children
    if (text.kind !== 'text') throw new Error('text node가 아닙니다.')
    expect(textRaw(tree, text)).toBe('&lt;a&gt; &amp; &quot;q&quot; &apos;s&apos; &#10;&#x1F600;&#9;')
    expect(decodeXmlEntities(textRaw(tree, text))).toBe('<a> & "q" \'s\' \n😀\t')
    expect(() => decodeXmlEntities('&nbsp;')).toThrow('지원하지 않는 XML entity')
    expect(() => decodeXmlEntities('a & b')).toThrow('해석할 수 없는 XML entity')
  })

  test('tag 짝이 맞지 않거나 닫히지 않으면 scanner와 같은 message로 거부한다', () => {
    expect(() => parseSourceTree('<a></b>')).toThrow('XML tag 순서가 올바르지 않습니다: b')
    expect(() => parseSourceTree('<a><b></b>')).toThrow('끝나지 않은 XML element가 있습니다: a')
    expect(() => parseSourceTree('<a><!-- x')).toThrow('끝나지 않은 XML comment가 있습니다.')
    expect(() => parseSourceTree('<a')).toThrow('끝나지 않은 XML tag가 있습니다.')
  })
})

describe('source tree 편집과 범위 보존 직렬화', () => {
  const xml = '<?xml version="1.0"?>\n<r a=\'1\'>\n  <p><t>one</t><t/></p>\n  <!-- keep -->\n  <p><t>two&amp;</t></p>\n</r>\n'

  test('바꾼 node만 다시 쓰고 나머지 byte는 원문 그대로 둔다', () => {
    const tree = parseSourceTree(xml)
    const [first] = findSourceElements(tree, 't')
    replaceElementChildren(tree, first, [createSourceText('ONE &lt;')])
    expect(serializeSourceTree(tree)).toBe(xml.replace('<t>one</t>', '<t>ONE &lt;</t>'))
    // dirty는 조상으로만 퍼지고 형제·다른 subtree는 원문 범위 복사 대상으로 남는다.
    expect(first.dirty && first.parent?.dirty && first.parent.parent?.dirty).toBe(true)
    const [, , second] = findSourceElements(tree, 't')
    expect(second.dirty).toBe(false)
  })

  test('자기 닫힘 element에 자식을 넣으면 같은 attribute로 펼치고, 원래 tag로 되돌릴 수 있다', () => {
    const tree = parseSourceTree('<r><t a="1" /></r>')
    const [empty] = findSourceElements(tree, 't')
    replaceElementChildren(tree, empty, [createSourceText('x')])
    expect(serializeSourceTree(tree)).toBe('<r><t a="1">x</t></r>')
    collapseElementToSelfClosing(empty, '<t a="1" />')
    expect(serializeSourceTree(tree)).toBe('<r><t a="1" /></r>')
    expect(() => collapseElementToSelfClosing(empty, '<t>')).toThrow('자기 닫힘 tag')
  })

  test('중간 형제를 바꾸면 앞뒤 원문 구간이 끊겨도 순서대로 복사한다', () => {
    const tree = parseSourceTree('<r>a<b/>c<d/>e</r>')
    const [root] = findSourceElements(tree, 'r')
    const next = root.children.slice()
    const [middle] = next.splice(2, 1, createSourceText('C'))
    replaceElementChildren(tree, root, next)
    expect(middle.parent).toBeUndefined()
    expect(root.children.every((child) => child.parent === root)).toBe(true)
    expect(serializeSourceTree(tree)).toBe('<r>a<b/>C<d/>e</r>')
  })

  test('여러 번 편집해도 dirty node는 최신 값으로, clean node는 원문으로 직렬화된다', () => {
    const tree = parseSourceTree(xml)
    const texts = findSourceElements(tree, 't')
    replaceElementChildren(tree, texts[0], [createSourceText('1')])
    replaceElementChildren(tree, texts[2], [createSourceText('3')])
    replaceElementChildren(tree, texts[0], [createSourceText('11')])
    expect(serializeSourceTree(tree)).toBe(
      xml.replace('<t>one</t>', '<t>11</t>').replace('<t>two&amp;</t>', '<t>3</t>')
    )
  })
})

describe('source tree attribute', () => {
  test('따옴표를 인식해 다른 attribute 값 안의 문자열과 겹치지 않는다', () => {
    const tag = '<hp:p note=\' id="9"\' id="3" alt="a>b">'
    // 정규식 기반 attribute()는 다른 값 안의 ` id="9"`를 먼저 잡는다(기존 모듈이 쓰는 동작은 그대로 둔다).
    expect(attribute(tag, 'id')).toBe('9')
    expect(readTagAttribute(tag, 'id')).toBe('3')
    expect(readTagAttribute(tag, 'note')).toBe(' id="9"')
    expect(readTagAttribute(tag, 'alt')).toBe('a>b')
    expect(readTagAttribute(tag, 'missing')).toBeUndefined()
    expect(parseTagAttributes(tag).map((item) => [item.name, item.quote])).toEqual([
      ['note', "'"],
      ['id', '"'],
      ['alt', '"']
    ])
  })

  test('줄바꿈이 든 값과 attribute 사이 줄바꿈을 읽는다', () => {
    const tag = '<a\n  first="line1\nline2"\n  second = \'x\'\n/>'
    expect(attribute(tag, 'first')).toBeUndefined()
    expect(readTagAttribute(tag, 'first')).toBe('line1\nline2')
    expect(readTagAttribute(tag, 'second')).toBe('x')
  })

  test('읽을 때 entity를 해석하고 쓸 때 escape한다', () => {
    const tag = '<a v="&lt;&amp;&quot;&#10;">'
    expect(readTagAttribute(tag, 'v')).toBe('<&"\n')
    expect(writeTagAttribute(tag, 'v', 'x & "y" <z>\t\n')).toBe('<a v="x &amp; &quot;y&quot; &lt;z&gt;&#9;&#10;">')
    expect(writeTagAttribute("<a v='1'>", 'v', `it's "ok"`)).toBe(`<a v='it&apos;s "ok"'>`)
    expect(readTagAttribute(writeTagAttribute('<a>', 'v', '\r\n\t<&>"\''), 'v')).toBe('\r\n\t<&>"\'')
    expect(escapeXmlAttribute('a\'b"', "'")).toBe('a&apos;b"')
    expect(() => writeTagAttribute('<a>', 'v', 'NUL\0')).toThrow('XML 1.0')
  })

  test('값을 바꿔도 다른 attribute의 표기·순서·공백은 그대로다', () => {
    const tag = '<hp:run  charPrIDRef=\'7\'\n  z="note charPrIDRef=&quot;1&quot;" >'
    expect(writeTagAttribute(tag, 'charPrIDRef', '12')).toBe('<hp:run  charPrIDRef=\'12\'\n  z="note charPrIDRef=&quot;1&quot;" >')
    // 없는 attribute는 기존 setAttribute와 같은 위치(끝 공백·`/>` 앞)에 덧붙인다.
    expect(writeTagAttribute('<a b="1"/>', 'c', 'v')).toBe(setAttribute('<a b="1"/>', 'c', 'v'))
    expect(writeTagAttribute('<a  />', 'c', 'v')).toBe(setAttribute('<a  />', 'c', 'v'))
    expect(writeTagAttribute('<a>', 'c', 'v')).toBe('<a c="v">')
    expect(() => writeTagAttribute('<a>', 'bad name', 'v')).toThrow('attribute 이름')
  })

  test('형식이 틀린 tag는 거부한다', () => {
    expect(() => parseTagAttributes('<a b>')).toThrow('해석할 수 없는 XML attribute')
    expect(() => parseTagAttributes('<a b=c>')).toThrow('해석할 수 없는 XML attribute')
    expect(() => parseTagAttributes('<a b="1"c="2">')).toThrow('해석할 수 없는 XML attribute')
    expect(() => parseTagAttributes('<a b="1>')).toThrow('해석할 수 없는 XML attribute')
  })

  test('element attribute를 바꾸면 여는 tag만 다시 쓰고 dirty로 표시한다', () => {
    const { tree, element } = onlyElement('<r><p id="1" s=\'x\'>body<b/></p><q/></r>', 'p')
    expect(getSourceAttribute(tree, element, 's')).toBe('x')
    setSourceAttribute(tree, element, 'id', '1')
    expect(element.dirty).toBe(false)
    setSourceAttribute(tree, element, 'id', '2&3')
    expect(serializeSourceTree(tree)).toBe('<r><p id="2&amp;3" s=\'x\'>body<b/></p><q/></r>')
    expect(getSourceAttribute(tree, element, 'id')).toBe('2&3')
    const [empty] = findSourceElements(tree, 'q')
    setSourceAttribute(tree, empty, 'n', 'v')
    expect(serializeSourceTree(tree)).toBe('<r><p id="2&amp;3" s=\'x\'>body<b/></p><q n="v"/></r>')
  })

  test('자식 splice·node 교체는 바뀐 부모만 다시 쓰고 남은 형제는 원문 그대로 둔다', () => {
    const source = '<r>\n  <c a=\'1\' >x</c >\n  <d/>\n  <e>&#x41;</e>\n</r>'
    const tree = parseSourceTree(source)
    const [root] = findSourceElements(tree, 'r')
    const [d] = findSourceElements(tree, 'd')
    replaceSourceNode(tree, d, parseSourceFragment('<n k="v">새 &amp; 값</n><!-- c -->'))
    expect(serializeSourceTree(tree)).toBe("<r>\n  <c a='1' >x</c >\n  <n k=\"v\">새 &amp; 값</n><!-- c -->\n  <e>&#x41;</e>\n</r>")
    const removed = spliceSourceChildren(tree, root, 0, 2, [])
    expect(removed).toHaveLength(2)
    expect(removed.every((node) => node.parent === undefined)).toBe(true)
    expect(serializeSourceTree(tree)).toBe('<r>\n  <n k="v">새 &amp; 값</n><!-- c -->\n  <e>&#x41;</e>\n</r>')
    // 조각에서 옮겨 온 node도 일반 node처럼 찾고 고칠 수 있다.
    const [inserted] = findSourceElements(tree, 'n')
    expect(inserted.parent).toBe(root)
    setSourceAttribute(tree, inserted, 'k', 'w')
    expect(serializeSourceTree(tree)).toBe('<r>\n  <n k="w">새 &amp; 값</n><!-- c -->\n  <e>&#x41;</e>\n</r>')
  })

  test('자기 닫힘 부모에 자식을 넣으면 펼친다', () => {
    const tree = parseSourceTree('<r><m a="1" /></r>')
    const [m] = findSourceElements(tree, 'm')
    spliceSourceChildren(tree, m, 0, 0, parseSourceFragment('<x/>'))
    expect(serializeSourceTree(tree)).toBe('<r><m a="1"><x/></m></r>')
  })

  test('여는 tag 원문 교체는 같은 이름·자기 닫힘 형태만 받는다', () => {
    const tree = parseSourceTree('<r><p id="1">t</p><q/></r>')
    const [p] = findSourceElements(tree, 'p')
    const [q] = findSourceElements(tree, 'q')
    setElementOpenTag(tree, p, "<p id='9' x=\"y\">")
    setElementOpenTag(tree, q, '<q z="1" />')
    expect(serializeSourceTree(tree)).toBe("<r><p id='9' x=\"y\">t</p><q z=\"1\" /></r>")
    expect(() => setElementOpenTag(tree, p, '<other>')).toThrow()
    expect(() => setElementOpenTag(tree, p, '<p/>')).toThrow()
    expect(() => setElementOpenTag(tree, q, '<q>')).toThrow()
  })

  test('문서 순서 첫 자손·모든 자손·가장 가까운 조상을 찾는다', () => {
    const tree = parseSourceTree('<r><a><b id="1"/><c><b id="2"/></c></a><b id="3"/></r>')
    const [root] = findSourceElements(tree, 'r')
    const [a] = findSourceElements(tree, 'a')
    expect(getSourceAttribute(tree, findFirstSourceElement(root, 'b')!, 'id')).toBe('1')
    expect(findDescendantSourceElements(a, 'b').map((node) => getSourceAttribute(tree, node, 'id'))).toEqual(['1', '2'])
    const nested = findDescendantSourceElements(a, 'b')[1]
    expect(nearestSourceAncestor(nested, 'a')).toBe(a)
    expect(nearestSourceAncestor(nested, 'missing')).toBeUndefined()
  })

  test('해석한 text offset을 entity 경계의 원문 offset으로 바꾼다', () => {
    const raw = '앞&#x41;&amp;&#x1F600;뒤'
    expect([0, 1, 2, 3, 5, 6].map((offset) => rawTextOffset(raw, offset))).toEqual([0, 1, 7, 12, 21, 22])
    expect(() => rawTextOffset(raw, 4)).toThrow('XML entity 중간')
    expect(() => rawTextOffset(raw, 7)).toThrow('원문을 벗어났습니다')
  })
})
