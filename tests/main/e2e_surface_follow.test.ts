import { findProjectedSurface, ProbeSurface } from '../../src/main/e2e_surface_follow'

interface FakeSurface extends ProbeSurface {
  name: string
}

const caretNode = { kind: 'caret-text-node' }

function surface(name: string, sourceTextNodeId: string, text: string, holdsCaret = false): FakeSurface {
  return {
    name,
    dataset: { sourceTextNodeId },
    textContent: text,
    contains: (node: unknown) => holdsCaret && node === caretNode
  }
}

describe('편집 E2E probe의 projection 뒤 surface 추적', () => {
  const section = 'Contents/section0.xml'

  test('일반 hp:t anchor는 같은 id에서 기대한 글자를 기다린다', () => {
    const before = [surface('a', `${section}#hp:t:3`, '보도자료')]
    expect(findProjectedSurface(before, `${section}#hp:t:3`, '보도자료시험', caretNode)).toBeUndefined()
    const after = [surface('a', `${section}#hp:t:3`, '보도자료시험', true)]
    expect(findProjectedSurface(after, `${section}#hp:t:3`, '보도자료시험', caretNode)?.name).toBe('a')
  })

  test('빈 문단 합성 anchor는 첫 입력 뒤 caret을 가진 새 hp:t anchor로 따라간다(D04 모양)', () => {
    const anchorId = `${section}#hp:p:13:empty`
    // projection 전: 합성 anchor가 아직 비어 있다.
    expect(findProjectedSurface([surface('empty', anchorId, '')], anchorId, '시험', caretNode)).toBeUndefined()
    // projection 뒤: 합성 anchor는 사라지고 뒤 hp:t ordinal이 밀린 새 surface가 생긴다.
    const projected = [
      surface('header', `${section}#hp:t:13`, '- 지식재산처 -'),
      surface('edited', `${section}#hp:t:14`, '시험', true),
      surface('body', `${section}#hp:t:15`, '지식재산처(처장)는')
    ]
    expect(findProjectedSurface(projected, anchorId, '시험', caretNode)?.name).toBe('edited')
  })

  test('caret이 새 anchor에 없거나 다른 section이면 찾지 않는다', () => {
    const anchorId = `${section}#hp:p:2:empty`
    expect(findProjectedSurface([surface('edited', `${section}#hp:t:1`, '시험')], anchorId, '시험', caretNode)).toBeUndefined()
    expect(findProjectedSurface([surface('edited', `${section}#hp:t:1`, '시험', true)], anchorId, '시험', null)).toBeUndefined()
    expect(findProjectedSurface([surface('other', 'Contents/section1.xml#hp:t:1', '시험', true)], anchorId, '시험', caretNode)).toBeUndefined()
  })

  test('renderer probe에 넣을 함수 원문은 바깥 이름을 참조하지 않는다', () => {
    const source = findProjectedSurface.toString()
    const standalone = new Function(`return (${source})`)() as typeof findProjectedSurface
    const anchorId = `${section}#hp:p:0:empty`
    expect(standalone([surface('edited', `${section}#hp:t:0`, '시험', true)], anchorId, '시험', caretNode)?.name).toBe('edited')
  })
})
