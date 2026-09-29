import { HwpxEditConflictError as ReexportedConflictError } from '../../src/core/editing/text_patch'
import {
  attribute,
  buildLossReport,
  findTagEnd,
  HwpxEditConflictError,
  isSurrogateBoundarySafe,
  iterateXmlTokens,
  nearestAncestor,
  replaceRange,
  sameOrdinalMessage,
  scanXmlElements,
  setAttribute,
  TABLE_SCAN_OPTIONS,
  targetOrdinal,
  XmlElementSpan,
  XmlScanOptions
} from '../../src/core/editing/xml_scan'

function names(spans: XmlElementSpan[]): string[] {
  return spans.map((span) => span.name)
}

function thrown(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('오류가 발생하지 않았습니다.')
}

const PLAIN: XmlScanOptions = {}

describe('xml_scan scanXmlElements', () => {
  test('element offset과 parent 연결을 시작 위치 순으로 돌려준다', () => {
    const xml = '<?xml version="1.0"?><!-- c --><r><p a="1>2"><t>x</t><t/></p></r>'
    for (const options of [PLAIN, TABLE_SCAN_OPTIONS]) {
      const spans = scanXmlElements(xml, options)
      expect(names(spans)).toEqual(['r', 'p', 't', 't'])
      const [root, paragraph, text, empty] = spans
      expect(xml.slice(paragraph.start, paragraph.openEnd)).toBe('<p a="1>2">')
      expect(xml.slice(text.openEnd, text.closeStart)).toBe('x')
      expect(empty.openEnd).toBe(empty.end)
      expect(empty.closeStart).toBe(empty.end)
      // self-closing element의 parent도 최종 배열 안의 같은 객체를 가리킨다.
      expect(empty.parent).toBe(paragraph)
      expect(text.parent).toBe(paragraph)
      expect(paragraph.parent).toBe(root)
      expect(nearestAncestor(empty, 'r')).toBe(root)
      expect(nearestAncestor(empty, 'missing')).toBeUndefined()
    }
  })

  // 분기 1: 오류 형식(errors). 표·셀 patch는 HwpxEditConflictError와 짧은 message를,
  // 문단·style patch는 Error와 상세 message를 던져 왔다.
  test.each([
    ['<a', '끝나지 않은 XML tag가 있습니다.', '끝나지 않은 XML tag가 있습니다.'],
    ['<a><!-- x', '끝나지 않은 XML comment가 있습니다.', '끝나지 않은 XML comment가 있습니다.'],
    ['<?xml x', '끝나지 않은 XML processing instruction이 있습니다.', '끝나지 않은 XML 선언이 있습니다.'],
    ['< >', '해석할 수 없는 XML tag가 있습니다: < >', '해석할 수 없는 XML tag가 있습니다.'],
    ['<a></b>', 'XML tag 순서가 올바르지 않습니다: b', 'XML tag 순서가 올바르지 않습니다.'],
    ['<a><b>', '끝나지 않은 XML element가 있습니다: b', '끝나지 않은 XML element가 있습니다.']
  ])('오류 형식 option: %s', (xml, plainMessage, conflictMessage) => {
    const plain = thrown(() => scanXmlElements(xml, PLAIN))
    expect(plain).not.toBeInstanceOf(HwpxEditConflictError)
    expect(plain.message).toBe(plainMessage)
    const conflict = thrown(() => scanXmlElements(xml, TABLE_SCAN_OPTIONS))
    expect(conflict).toBeInstanceOf(HwpxEditConflictError)
    expect(conflict.message).toBe(conflictMessage)
  })

  // 분기 2: CDATA 처리(cdata). 표·셀 scanner는 CDATA를 일반 `<!` tag로 보고 첫 `>`에서 끊었다.
  test('cdata as-tag는 CDATA 본문의 `>` 뒤를 markup으로 읽던 기존 동작을 재현한다', () => {
    const xml = '<a><![CDATA[1>2 <b/>]]></a>'
    expect(names(scanXmlElements(xml, PLAIN))).toEqual(['a'])
    expect(names(scanXmlElements(xml, TABLE_SCAN_OPTIONS))).toEqual(['a', 'b'])
  })

  test('cdata as-tag는 CDATA 본문의 따옴표를 attribute 따옴표로 읽던 기존 동작을 재현한다', () => {
    const xml = "<a><![CDATA[it's]]></a>"
    expect(names(scanXmlElements(xml, PLAIN))).toEqual(['a'])
    const error = thrown(() => scanXmlElements(xml, TABLE_SCAN_OPTIONS))
    expect(error).toBeInstanceOf(HwpxEditConflictError)
    expect(error.message).toBe('끝나지 않은 XML tag가 있습니다.')
  })

  test('닫히지 않은 CDATA는 skip이면 CDATA 오류, as-tag이면 element 오류가 된다', () => {
    const xml = '<a><![CDATA[x</a>'
    expect(thrown(() => scanXmlElements(xml, PLAIN)).message).toBe('끝나지 않은 XML CDATA가 있습니다.')
    expect(thrown(() => scanXmlElements(xml, TABLE_SCAN_OPTIONS)).message).toBe('끝나지 않은 XML element가 있습니다.')
  })

  test('두 option은 독립적으로 조합할 수 있다', () => {
    const conflictSkip = thrown(() => scanXmlElements('<a><![CDATA[x', { errors: 'conflict', cdata: 'skip' }))
    expect(conflictSkip).toBeInstanceOf(HwpxEditConflictError)
    expect(conflictSkip.message).toBe('끝나지 않은 XML CDATA가 있습니다.')
    expect(names(scanXmlElements('<a><![CDATA[1>2 <b/>]]></a>', { errors: 'plain', cdata: 'as-tag' }))).toEqual(['a', 'b'])
  })
})

describe('xml_scan helpers', () => {
  test('findTagEnd는 따옴표 안의 `>`를 건너뛰고 오류 형식을 따른다', () => {
    expect(findTagEnd(`<a x="1>2" y='>'>rest`, 0)).toBe(17)
    expect(thrown(() => findTagEnd('<a x=">', 0))).not.toBeInstanceOf(HwpxEditConflictError)
    expect(thrown(() => findTagEnd('<a x=">', 0, 'conflict'))).toBeInstanceOf(HwpxEditConflictError)
  })

  test('attribute/setAttribute는 따옴표 종류를 유지하고 없으면 끝에 덧붙인다', () => {
    expect(attribute(`<hp:p id='7' paraPrIDRef="3">`, 'id')).toBe('7')
    expect(attribute('<hp:p paraPrIDRef="3">', 'id')).toBeUndefined()
    expect(setAttribute(`<hp:p id='7'>`, 'id', '9')).toBe(`<hp:p id='9'>`)
    expect(setAttribute('<hh:borderFill/>', 'id', '4')).toBe('<hh:borderFill id="4"/>')
    expect(setAttribute('<hh:borderFill >', 'id', '4')).toBe('<hh:borderFill id="4" >')
  })

  test('attribute는 정규식 기반이라 다른 attribute 값 안의 문자열도 읽는다(현재 동작 고정)', () => {
    expect(attribute(`<a title=" id='x'" id="y">`, 'id')).toBe('x')
  })

  test('replaceRange', () => {
    expect(replaceRange('abcdef', 1, 3, 'XY')).toBe('aXYdef')
    expect(replaceRange('abc', 3, 3, '!')).toBe('abc!')
  })

  test('targetOrdinal은 호출부별 message를 유지한다', () => {
    const section = 'Contents/section0.xml'
    expect(targetOrdinal(section, `${section}#hp:t:12`)).toBe(12)
    expect(thrown(() => targetOrdinal(section, 'Contents/section1.xml#hp:t:1')).message).toBe(
      'text anchor가 section과 일치하지 않습니다: Contents/section1.xml#hp:t:1'
    )
    expect(thrown(() => targetOrdinal(section, `${section}#hp:t:-1`)).message).toBe(
      `text anchor ordinal이 올바르지 않습니다: ${section}#hp:t:-1`
    )
    const table = sameOrdinalMessage(() => '표 anchor가 올바르지 않습니다.')
    for (const id of ['x', `${section}#hp:t:1.5`]) {
      const error = thrown(() => targetOrdinal(section, id, table))
      expect(error).toBeInstanceOf(HwpxEditConflictError)
      expect(error.message).toBe('표 anchor가 올바르지 않습니다.')
    }
  })

  test('isSurrogateBoundarySafe는 surrogate pair 가운데만 거부한다', () => {
    const text = 'a😀b'
    expect([0, 1, 2, 3, 4].map((offset) => isSurrogateBoundarySafe(text, offset))).toEqual([true, true, false, true, true])
    expect(isSurrogateBoundarySafe(text, -1)).toBe(true)
  })

  test('buildLossReport는 Preview 여부로 previewStatus를 정하고 명시값을 우선한다', () => {
    const withPreview = { listEntries: () => [{ path: 'Contents/section0.xml' }, { path: 'Preview/PrvText.txt' }] }
    const withoutPreview = { listEntries: () => [{ path: 'Contents/section0.xml' }, { path: 'mimetype' }] }
    expect(buildLossReport(withPreview, ['Contents/section0.xml'])).toEqual({
      preservedEntries: ['Preview/PrvText.txt'],
      modifiedEntries: ['Contents/section0.xml'],
      regeneratedEntries: [],
      omittedEntries: [],
      unsupportedFeatures: [],
      previewStatus: 'stale'
    })
    expect(buildLossReport(withoutPreview, []).previewStatus).toBe('omitted')
    expect(buildLossReport(withPreview, [], 'current').previewStatus).toBe('current')
  })

  test('HwpxEditConflictError는 text_patch 경로에서도 같은 class다', () => {
    expect(ReexportedConflictError).toBe(HwpxEditConflictError)
    expect(new ReexportedConflictError('x').code).toBe('HWPX_EDIT_CONFLICT')
  })
})

describe('xml_scan iterateXmlTokens', () => {
  test('markup token 종류와 범위를 문서 순서대로 돌려주고 사이 구간은 text로 남긴다', () => {
    const xml = '<?xml version="1.0"?>\n<!DOCTYPE r><r a="x>y"><!-- c --><![CDATA[<b>]]>t&amp;<e/></r>'
    const tokens = [...iterateXmlTokens(xml)]
    expect(tokens.map((token) => [token.kind, token.name, xml.slice(token.start, token.end)])).toEqual([
      ['pi', undefined, '<?xml version="1.0"?>'],
      ['declaration', undefined, '<!DOCTYPE r>'],
      ['open', 'r', '<r a="x>y">'],
      ['comment', undefined, '<!-- c -->'],
      ['cdata', undefined, '<![CDATA[<b>]]>'],
      ['self-close', 'e', '<e/>'],
      ['close', 'r', '</r>']
    ])
    // CDATA를 일반 `<!` tag로 다루는 표 scanner 방식에서는 declaration으로 나온다.
    expect([...iterateXmlTokens('<![CDATA[x]]>', TABLE_SCAN_OPTIONS)].map((token) => token.kind)).toEqual(['declaration'])
  })

  test('짝이 맞지 않는 tag는 검사하지 않고 tokenizer 오류는 그 token에서 던진다', () => {
    expect([...iterateXmlTokens('</a><b>')].map((token) => token.kind)).toEqual(['close', 'open'])
    const iterator = iterateXmlTokens('<a></a><!-- x')
    expect(iterator.next().value).toMatchObject({ kind: 'open', name: 'a' })
    expect(iterator.next().value).toMatchObject({ kind: 'close', name: 'a' })
    expect(() => iterator.next()).toThrow('끝나지 않은 XML comment가 있습니다.')
    expect(thrown(() => [...iterateXmlTokens('<a', TABLE_SCAN_OPTIONS)])).toBeInstanceOf(HwpxEditConflictError)
  })
})
