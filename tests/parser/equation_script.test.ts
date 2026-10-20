import { mathPlainText, mathToString, parseEquationScript, tokenizeEquation } from '../../src/core/document/equation_script'

/** test에서 읽기 쉽게 모든 `mo`·`mi`에 붙는 기본 속성과 바깥 `math`를 뺀 MathML. */
function mml(script: string): string {
  const result = parseEquationScript(script)
  if (!result.ok) throw new Error(`해석 실패(${script}): ${result.reason}`)
  return mathToString(result.math)
    .replace(/ mathvariant="normal"| stretchy="false"| lspace="0" rspace="0"| largeop="false" movablelimits="false"/g, '')
    .replace(/^<math>|<\/math>$/g, '')
}

const it_ = (name: string) => `<mi class="eq-it">${name}</mi>`
const fence = (text: string) => `<mo data-eq-stretch="fence">${text}</mo>`

describe('한컴 수식 script 해석', () => {
  test.each([
    // 분수: 중위 over는 바로 앞·뒤 요소만 묶고, 이어지면 왼쪽부터 묶는다.
    ['a over b', `<mfrac>${it_('a')}${it_('b')}</mfrac>`],
    ['a+b over c', `<mrow>${it_('a')}<mo>+</mo><mfrac>${it_('b')}${it_('c')}</mfrac></mrow>`],
    ['{a+b} over {c-d}', `<mfrac><mrow>${it_('a')}<mo>+</mo>${it_('b')}</mrow><mrow>${it_('c')}<mo>−</mo>${it_('d')}</mrow></mfrac>`],
    ['1 over 2 over 3', '<mfrac><mfrac><mn>1</mn><mn>2</mn></mfrac><mn>3</mn></mfrac>'],
    ['n atop k', `<mfrac linethickness="0">${it_('n')}${it_('k')}</mfrac>`],
    ['n choose k', `<mrow>${fence('(')}<mfrac linethickness="0">${it_('n')}${it_('k')}</mfrac>${fence(')')}</mrow>`],
    ['binom n k', `<mrow>${fence('(')}<mfrac linethickness="0">${it_('n')}${it_('k')}</mfrac>${fence(')')}</mrow>`],
    // 붙여 쓴 over 뒤 숫자(over2)는 떼어 읽는다.
    ['1 over2', '<mfrac><mn>1</mn><mn>2</mn></mfrac>'],
    // 근호: √ 글자와 윗줄 상자. root … of …는 왼쪽 위 지수.
    ['sqrt 2', '<mrow class="eq-radical"><mo class="eq-radical-sign" data-eq-stretch="radical">√</mo><mrow class="eq-radicand"><mn>2</mn></mrow></mrow>'],
    ['root 3 of 8', '<mrow class="eq-radical"><mmultiscripts class="eq-radical-index"><mo class="eq-radical-sign" data-eq-stretch="radical">√</mo><mprescripts/><none/><mn>3</mn></mmultiscripts><mrow class="eq-radicand"><mn>8</mn></mrow></mrow>'],
    ['root {n} of {x}', `<mrow class="eq-radical"><mmultiscripts class="eq-radical-index"><mo class="eq-radical-sign" data-eq-stretch="radical">√</mo><mprescripts/><none/>${it_('n')}</mmultiscripts><mrow class="eq-radicand">${it_('x')}</mrow></mrow>`],
    // 첨자
    ['x^2', `<msup>${it_('x')}<mn>2</mn></msup>`],
    ['x_i^2', `<msubsup>${it_('x')}${it_('i')}<mn>2</mn></msubsup>`],
    ['x^{n+1}', `<msup>${it_('x')}<mrow>${it_('n')}<mo>+</mo><mn>1</mn></mrow></msup>`],
    ['a sup 2 + b sub k', `<mrow><msup>${it_('a')}<mn>2</mn></msup><mo>+</mo><msub>${it_('b')}${it_('k')}</msub></mrow>`],
    ['x^2=4', `<mrow><msup>${it_('x')}<mn>2</mn></msup><mo>=</mo><mn>4</mn></mrow>`],
    // 괄호
    ['left ( x over 2 right )', `<mrow>${fence('(')}<mfrac>${it_('x')}<mn>2</mn></mfrac>${fence(')')}</mrow>`],
    ['left | x right |', `<mrow>${fence('|')}${it_('x')}${fence('|')}</mrow>`],
    ['left lbrace a right .', `<mrow>${fence('{')}${it_('a')}</mrow>`],
    ['left langle u right rangle', `<mrow>${fence('⟨')}${it_('u')}${fence('⟩')}</mrow>`],
    ['f(x)', `<mrow>${it_('f')}<mo>(</mo>${it_('x')}<mo>)</mo></mrow>`],
    // 행렬·cases·pile·eqalign
    ['matrix{a & b # c & d}', `<mrow><mtable class="eq-matrix"><mtr><mtd>${it_('a')}</mtd><mtd>${it_('b')}</mtd></mtr><mtr><mtd>${it_('c')}</mtd><mtd>${it_('d')}</mtd></mtr></mtable></mrow>`],
    ['pmatrix{1 & 0 # 0 & 1}', `<mrow>${fence('(')}<mtable class="eq-matrix"><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable>${fence(')')}</mrow>`],
    ['bmatrix{x # y}', `<mrow>${fence('[')}<mtable class="eq-matrix"><mtr><mtd>${it_('x')}</mtd></mtr><mtr><mtd>${it_('y')}</mtd></mtr></mtable>${fence(']')}</mrow>`],
    ['dmatrix{a & b # c & d}', `<mrow>${fence('|')}<mtable class="eq-matrix"><mtr><mtd>${it_('a')}</mtd><mtd>${it_('b')}</mtd></mtr><mtr><mtd>${it_('c')}</mtd><mtd>${it_('d')}</mtd></mtr></mtable>${fence('|')}</mrow>`],
    ['cases{1 & x>0 # 0 & x<=0}', `<mrow>${fence('{')}<mtable class="eq-cases"><mtr><mtd class="eq-left"><mn>1</mn></mtd><mtd class="eq-left"><mrow>${it_('x')}<mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr><mtr><mtd class="eq-left"><mn>0</mn></mtd><mtd class="eq-left"><mrow>${it_('x')}<mo>≤</mo><mn>0</mn></mrow></mtd></mtr></mtable></mrow>`],
    ['pile{a # c}', `<mtable class="eq-pile"><mtr><mtd class="eq-center">${it_('a')}</mtd></mtr><mtr><mtd class="eq-center">${it_('c')}</mtd></mtr></mtable>`],
    ['lpile{a # b}', `<mtable class="eq-pile"><mtr><mtd class="eq-left">${it_('a')}</mtd></mtr><mtr><mtd class="eq-left">${it_('b')}</mtd></mtr></mtable>`],
    ['rpile{a # b}', `<mtable class="eq-pile"><mtr><mtd class="eq-right">${it_('a')}</mtd></mtr><mtr><mtd class="eq-right">${it_('b')}</mtd></mtr></mtable>`],
    ['eqalign{x & = 1 # y & = 2}', `<mtable class="eq-lines"><mtr><mtd class="eq-right">${it_('x')}</mtd><mtd class="eq-left"><mrow><mo>=</mo><mn>1</mn></mrow></mtd></mtr><mtr><mtd class="eq-right">${it_('y')}</mtd><mtd class="eq-left"><mrow><mo>=</mo><mn>2</mn></mrow></mtd></mtr></mtable>`],
    ['x # y', `<mtable class="eq-lines"><mtr><mtd class="eq-left">${it_('x')}</mtd></mtr><mtr><mtd class="eq-left">${it_('y')}</mtd></mtr></mtable>`],
    // 큰 연산자: from/to와 _/^ 모두 한계. 합·곱은 위아래, 적분은 오른쪽 첨자.
    ['sum from {i=1} to {n} a_i', `<mrow><munderover><mo class="eq-large">∑</mo><mrow>${it_('i')}<mo>=</mo><mn>1</mn></mrow>${it_('n')}</munderover><msub>${it_('a')}${it_('i')}</msub></mrow>`],
    ['sum_k=1 ^n', `<munderover><mo class="eq-large">∑</mo><mrow>${it_('k')}<mo>=</mo><mn>1</mn></mrow>${it_('n')}</munderover>`],
    ['prod _{k=1} ^{n} k', `<mrow><munderover><mo class="eq-large">∏</mo><mrow>${it_('k')}<mo>=</mo><mn>1</mn></mrow>${it_('n')}</munderover>${it_('k')}</mrow>`],
    ['int from 0 to inf f', `<mrow><msubsup><mo class="eq-integral">∫</mo><mn>0</mn><mi>∞</mi></msubsup>${it_('f')}</mrow>`],
    ['int _0 ^1 f', `<mrow><msubsup><mo class="eq-integral">∫</mo><mn>0</mn><mn>1</mn></msubsup>${it_('f')}</mrow>`],
    ['oint', '<mo class="eq-integral">∮</mo>'],
    ['lim from {n -> inf} 1 over n', `<mrow><mrow><munder><mi>lim</mi><mrow>${it_('n')}<mo>→</mo><mi>∞</mi></mrow></munder><mspace width="0.17em"/></mrow><mfrac><mn>1</mn>${it_('n')}</mfrac></mrow>`],
    ['Lim _{x->0} f', `<mrow><mrow><munder><mi>Lim</mi><mrow>${it_('x')}<mo>→</mo><mn>0</mn></mrow></munder><mspace width="0.17em"/></mrow>${it_('f')}</mrow>`],
    // 그리스 문자·기호·화살표
    ['alpha beta ALPHA Gamma OMEGA omega', '<mrow><mi>α</mi><mi>β</mi><mi>Α</mi><mi>Γ</mi><mi>Ω</mi><mi>ω</mi></mrow>'],
    ['inf -> <= >= != TIMES cdot pm PLUSMINUS', '<mrow><mi>∞</mi><mo>→</mo><mo>≤</mo><mo>≥</mo><mo>≠</mo><mo>×</mo><mo>·</mo><mo>±</mo><mo>±</mo></mrow>'],
    ['x in A subset B', `<mrow>${it_('x')}<mo>∈</mo>${it_('A')}<mo>⊂</mo>${it_('B')}</mrow>`],
    ['larrow rarrow LARROW RARROW', '<mrow><mo>←</mo><mo>→</mo><mo>⇐</mo><mo>⇒</mo></mrow>'],
    ['timesm', `<mrow><mo>×</mo>${it_('m')}</mrow>`],
    ['x  y', `<mrow>${it_('x')}<mo>|</mo>${it_('y')}</mrow>`],
    // 함수 이름은 로마체이고 뒤에 작은 공백
    ['sin x + log_2 y + cos^2 theta', `<mrow><mrow><mi>sin</mi><mspace width="0.17em"/></mrow>${it_('x')}<mo>+</mo><mrow><msub><mi>log</mi><mn>2</mn></msub><mspace width="0.17em"/></mrow>${it_('y')}<mo>+</mo><mrow><msup><mi>cos</mi><mn>2</mn></msup><mspace width="0.17em"/></mrow><mi>θ</mi></mrow>`],
    // 글꼴: 묶음 끝까지 이어지고 묶음이 끝나면 돌아간다. 붙여 쓴 rmK도 나눈다.
    ['rm abc it def bold G', `<mrow><mi>abc</mi>${it_('def')}<mi class="eq-bold">G</mi></mrow>`],
    ['{rm m} s', `<mrow><mi>m</mi>${it_('s')}</mrow>`],
    ['rmK', '<mi>K</mi>'],
    ['bold 1', '<mn class="eq-bold">1</mn>'],
    // 공백·따옴표 글·한글
    ['a ~ b ` c', `<mrow>${it_('a')}<mspace width="0.3em"/>${it_('b')}<mspace width="0.08em"/>${it_('c')}</mrow>`],
    ['"단, x>0" 일 때', '<mrow><mtext>단, x&gt;0</mtext><mtext>일</mtext><mtext>때</mtext></mrow>'],
    // 장식
    ['hat a + bar b + vec v + under u', `<mrow><mover accent="true">${it_('a')}<mo class="eq-accent">^</mo></mover><mo>+</mo><mover accent="true">${it_('b')}<mo class="eq-accent">¯</mo></mover><mo>+</mo><mover accent="true">${it_('v')}<mo class="eq-accent">→</mo></mover><mo>+</mo><munder accentunder="true">${it_('u')}<mo class="eq-accent">_</mo></munder></mrow>`],
    ['COLOR{255,0,0}{x}', `<mrow data-eq-color="#ff0000">${it_('x')}</mrow>`]
  ])('%s', (script, expected) => {
    expect(mml(script)).toBe(expected)
  })

  test('공개 fixture(ext-hwpxlib-equation)의 script', () => {
    expect(mml('{"123"} over {123 sqrt {3466}} sum _{34} ^{12}')).toBe(
      '<mrow><mfrac><mtext>123</mtext><mrow><mn>123</mn><mrow class="eq-radical"><mo class="eq-radical-sign" data-eq-stretch="radical">√</mo><mrow class="eq-radicand"><mn>3466</mn></mrow></mrow></mrow></mfrac>' +
      '<munderover><mo class="eq-large">∑</mo><mn>34</mn><mn>12</mn></munderover></mrow>'
    )
  })

  test('모든 연산자는 늘이지 않고(stretchy="false") 변수는 CSS 기울임(mathvariant="normal")이다', () => {
    const result = parseEquationScript('x = {-b pm sqrt {b^2 - 4ac}} over {2a}')
    if (!result.ok) throw new Error(result.reason)
    const markup = mathToString(result.math)
    expect(markup).toMatch(/^<math><mrow><mi mathvariant="normal" class="eq-it">x<\/mi><mo stretchy="false">=<\/mo><mfrac>/)
    expect(markup.match(/<mo /g)?.length).toBe(markup.match(/<mo stretchy="false"/g)?.length)
    expect(markup.match(/<mi /g)?.length).toBe(markup.match(/<mi mathvariant="normal"/g)?.length)
    // 화면 글자(PDF 추출 글자와 같은 순서·개수): 근호도 글자 √로 남는다.
    expect(mathPlainText(result.math)).toBe('x=−b±√b2−4ac2a')
  })

  test.each([
    ['x over', '분모'],
    ['{a', '닫는 중괄호'],
    ['a}', '닫는 중괄호'],
    ['left ( a', 'right'],
    ['longdiv {3}{12}{4}', 'longdiv'],
    ['ladder{a}', 'ladder'],
    ['\\frac{a}{b}', 'LaTeX'],
    ['"unterminated', '따옴표'],
    ['', '비어'],
    ['   ', '비어'],
    ['sqrt', '인자'],
    ['from', 'from'],
    ['matrix a', '중괄호'],
    ['COLOR{1,2}{x}', 'COLOR'],
    ['{'.repeat(80) + 'x' + '}'.repeat(80), '깊']
  ])('해석하지 못하는 script는 ok: false(%s)', (script, reason) => {
    const result = parseEquationScript(script)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reason)
  })

  test('토큰: 공백 여부·여러 글자 기호·한글 묶음·붙여 쓴 명령', () => {
    expect(tokenizeEquation('a<=b -> c >>> d').map((token) => token.value)).toEqual(['a', '<=', 'b', '->', 'c', '>>>', 'd', ''])
    expect(tokenizeEquation('x_k=1').map((token) => [token.value, token.spaceBefore])).toEqual([['x', false], ['_', false], ['k', false], ['=', false], ['1', false], ['', false]])
    expect(tokenizeEquation('tanx 3.14 한글값').map((token) => [token.type, token.value])).toEqual([['word', 'tan'], ['word', 'x'], ['number', '3.14'], ['text', '한글값'], ['eof', '']])
    expect(tokenizeEquation('overlap alphabet').map((token) => token.value)).toEqual(['overlap', 'alphabet', ''])
  })

  test('아주 긴 script는 해석하지 않는다', () => {
    expect(parseEquationScript('x + '.repeat(3000)).ok).toBe(false)
  })

  test('악의적 script도 글자 수에 비례하는 시간 안에 끝난다', () => {
    const cases = [
      'sin'.repeat(2000) + 'qq',
      'sin'.repeat(33000) + 'qq',
      'x' + 'q'.repeat(100000),
      'sin'.repeat(80) + 'qq ' + 'sin'.repeat(80) + 'qq',
      'sinq '.repeat(3000),
      '{'.repeat(10000) + 'x' + '}'.repeat(10000),
      'left ( '.repeat(3000) + 'x' + ' right )'.repeat(3000)
    ]
    for (const script of cases) {
      const started = performance.now()
      parseEquationScript(script)
      expect(performance.now() - started).toBeLessThan(200)
    }
    // 붙여 쓴 명령 분리는 그대로다.
    expect(tokenizeEquation('sinsinx').map((token) => token.value)).toEqual(['sin', 'sin', 'x', ''])
    expect(tokenizeEquation('underlinex').map((token) => token.value)).toEqual(['underline', 'x', ''])
    expect(parseEquationScript('a'.repeat(256)).ok).toBe(true)
    expect(parseEquationScript('a'.repeat(257)).ok).toBe(false)
  })
})
