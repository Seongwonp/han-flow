import { HwpxEditConflictError as ReexportedConflictError } from '../../src/core/editing/text_patch'
import {
  buildLossReport,
  findTagEnd,
  HwpxEditConflictError,
  isSurrogateBoundarySafe,
  iterateXmlTokens
} from '../../src/core/editing/xml_scan'

function thrown(run: () => unknown): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('오류가 발생하지 않았습니다.')
}

describe('xml_scan helpers', () => {
  test('findTagEnd는 따옴표 안의 `>`를 건너뛴다', () => {
    expect(findTagEnd(`<a x="1>2" y='>'>rest`, 0)).toBe(17)
    const error = thrown(() => findTagEnd('<a x=">', 0))
    expect(error).not.toBeInstanceOf(HwpxEditConflictError)
    expect(error.message).toBe('끝나지 않은 XML tag가 있습니다.')
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
  })

  test('CDATA 본문의 `>`·markup·따옴표는 `]]>`까지 불투명 구간이다', () => {
    // 4단계 뒤 지운 표·셀 scanner(`cdata: 'as-tag'`)는 CDATA를 일반 `<!` tag로 보고 첫 `>`에서 끊어 안의 `<b/>`를
    // element로 읽었고, 짝 없는 따옴표 뒤를 attribute 따옴표 안으로 읽어 "끝나지 않은 XML tag"로 거부했다.
    expect([...iterateXmlTokens('<a><![CDATA[1>2 <b/>]]></a>')].map((token) => token.kind)).toEqual(['open', 'cdata', 'close'])
    expect([...iterateXmlTokens("<a><![CDATA[it's]]></a>")].map((token) => token.kind)).toEqual(['open', 'cdata', 'close'])
  })

  test.each([
    ['<a', '끝나지 않은 XML tag가 있습니다.'],
    ['<a><!-- x', '끝나지 않은 XML comment가 있습니다.'],
    ['<a><![CDATA[x</a>', '끝나지 않은 XML CDATA가 있습니다.'],
    ['<?xml x', '끝나지 않은 XML processing instruction이 있습니다.'],
    ['< >', '해석할 수 없는 XML tag가 있습니다: < >']
  ])('tokenizer 오류 message: %s', (xml, message) => {
    const error = thrown(() => [...iterateXmlTokens(xml)])
    expect(error).not.toBeInstanceOf(HwpxEditConflictError)
    expect(error.message).toBe(message)
  })

  test('짝이 맞지 않는 tag는 검사하지 않고 tokenizer 오류는 그 token에서 던진다', () => {
    expect([...iterateXmlTokens('</a><b>')].map((token) => token.kind)).toEqual(['close', 'open'])
    const iterator = iterateXmlTokens('<a></a><!-- x')
    expect(iterator.next().value).toMatchObject({ kind: 'open', name: 'a' })
    expect(iterator.next().value).toMatchObject({ kind: 'close', name: 'a' })
    expect(() => iterator.next()).toThrow('끝나지 않은 XML comment가 있습니다.')
  })
})
