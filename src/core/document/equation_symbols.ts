/**
 * 한컴 수식 script(수식 버전 6.0) 명령 이름 → Unicode 기호 표.
 *
 * 출처: rhwp `src/renderer/equation/symbols.rs`(https://github.com/edwardkim/rhwp, commit `1a76570e`, v0.8.7)의
 * `GREEK_LOWER`·`GREEK_UPPER`·`SPECIAL_SYMBOLS`·`OPERATORS`·`BIG_OPERATORS`·`ARROWS`·`BRACKETS`·`FUNCTIONS`·`DECORATIONS`
 * 표와 대소문자 규칙(그리스 문자·화살표는 대소문자 구분, 나머지 기호는 대문자로 한 번 더 찾음). Copyright (c) 2025-2026
 * Edward Kim, MIT License. 고지는 THIRD_PARTY_NOTICES.md에 있다. rhwp 표의 LaTeX 공백 명령(QUAD 등)은 Han-Flow script
 * 해석에서 쓰지 않아 뺐고, 그리스 대문자는 한컴 수식 편집기가 쓰는 전체 대문자 이름(`ALPHA`)도 받는다.
 */

/** 그리스 소문자(대소문자 구분). */
const GREEK_LOWER: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
  rho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω'
}

/** 그리스 대문자. `Alpha`와 `ALPHA` 모두 받는다. */
const GREEK_UPPER_BASE: Readonly<Record<string, string>> = {
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ',
  Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ',
  Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω'
}
const GREEK_UPPER: Readonly<Record<string, string>> = {
  ...GREEK_UPPER_BASE,
  ...Object.fromEntries(Object.entries(GREEK_UPPER_BASE).map(([name, value]) => [name.toUpperCase(), value])),
  varupsilon: 'ϒ'
}

/** 글자처럼 쓰는 특수 기호(대문자 key, 대소문자 무시). */
const SPECIAL_SYMBOLS: Readonly<Record<string, string>> = {
  INF: '∞', ALEPH: 'ℵ', HBAR: 'ℏ', IMATH: 'ı', JMATH: 'ȷ', ELL: 'ℓ', LITER: 'ℓ', WP: '℘', IMAG: 'ℑ', IMAGE: 'ℑ',
  REIMAGE: 'ℜ', ANGSTROM: 'Å', MHO: '℧', OHM: 'Ω', TRIANGLE: '△', TRIANGLED: '▽', ANGLE: '∠', MSANGLE: '∡',
  SANGLE: '∢', RTANGLE: '⊾', BOT: '⊥', TOP: '⊤', LAPLACE: 'ℒ', CENTIGRADE: '℃', FAHRENHEIT: '℉', DEG: '°',
  PRIME: '′', LSLANT: '/', RSLANT: '\\', ATT: '@', HUND: '‰', THOU: '‱', WELL: '♯', BASE: '△', PARTIAL: '∂',
  EMPTYSET: '∅', NABLA: '∇', INFTY: '∞'
}

/** 줄임표(연산자 자리). */
const DOTS: Readonly<Record<string, string>> = { CDOTS: '⋯', LDOTS: '…', VDOTS: '⋮', DDOTS: '⋱', DOTS: '…' }

/** 연산·관계·집합·논리 기호(대문자 key, 대소문자 무시). */
const OPERATORS: Readonly<Record<string, string>> = {
  TIMES: '×', DIV: '÷', DIVDE: '÷', PLUSMINUS: '±', PM: '±', MINUSPLUS: '∓', MP: '∓', CDOT: '·', CIRC: '∘',
  BULLET: '•', AST: '∗', STAR: '★', DSUM: '⊞', NEQ: '≠', NE: '≠', LE: '≤', LEQ: '≤', GE: '≥', GEQ: '≥', LLL: '⋘',
  GGG: '⋙', LL: '≪', GG: '≫', APPROX: '≈', SIM: '∼', SIMEQ: '≃', CONG: '≅', EQUIV: '≡', ASYMP: '≍', DOTEQ: '≐',
  PROPTO: '∝', UNION: '∪', SMALLUNION: '∪', CUP: '∪', INTER: '∩', SMALLINTER: '∩', CAP: '∩', SUBSET: '⊂',
  SUPERSET: '⊃', SUPSET: '⊃', SUBSETEQ: '⊆', SUPSETEQ: '⊇', SQSUBSET: '⊏', SQSUPSET: '⊐', SQSUBSETEQ: '⊑',
  SQSUPSETEQ: '⊒', IN: '∈', NOTIN: '∉', OWNS: '∋', NI: '∋', PREC: '≺', SUCC: '≻', FORALL: '∀', EXIST: '∃',
  EXISTS: '∃', NEXISTS: '∄', LNOT: '¬', NEG: '¬', WEDGE: '∧', LAND: '∧', VEE: '∨', LOR: '∨', XOR: '⊻',
  THEREFORE: '∴', BECAUSE: '∵', IDENTICAL: '∷', VDASH: '⊢', HLEFT: '⊣', MODELS: '⊨', DAGGER: '†',
  DDAGGER: '‡', BIGCIRC: '○', DIAMOND: '◇', ISO: '⋄', PERP: '⊥', OPLUS: '⊕', OTIMES: '⊗', ODOT: '⊙',
  OMINUS: '⊖', ODIV: '⊘', OSLASH: '⊘', SQCUP: '⊔', SQCAP: '⊓', UPLUS: '⊎'
}

/** 위·아래 한계를 위아래에 두는 큰 연산자(대문자 key). */
const BIG_OPERATORS: Readonly<Record<string, string>> = {
  SUM: '∑', SMALLSUM: '∑', PROD: '∏', SMALLPROD: '∏', COPROD: '∐', SMCOPROD: '∐', AMALG: '∐', BIGCUP: '⋃',
  BIGCAP: '⋂', BIGSQCUP: '⨆', BIGSQCAP: '⨅', BIGUPLUS: '⨄', BIGWEDGE: '⋀', BIGVEE: '⋁', BIGOPLUS: '⨁',
  BIGOTIMES: '⨂', BIGODOT: '⨀', BIGOMINUS: '⊖', BIGODIV: '⊘'
}

/** 한계를 오른쪽 위·아래 첨자로 두는 적분 기호(대문자 key). */
const INTEGRALS: Readonly<Record<string, string>> = {
  INT: '∫', INTEGRAL: '∫', SMALLINT: '∫', DINT: '∬', IINT: '∬', TINT: '∭', IIINT: '∭', OINT: '∮', SMALLOINT: '∮',
  ODINT: '∯', OTINT: '∰'
}

/** 화살표(대소문자 구분: 소문자는 한 줄, 대문자는 두 줄 화살표). */
const ARROWS: Readonly<Record<string, string>> = {
  larrow: '←', rarrow: '→', uparrow: '↑', downarrow: '↓', lrarrow: '↔', udarrow: '↕', LARROW: '⇐', RARROW: '⇒',
  UPARROW: '⇑', DOWNARROW: '⇓', LRARROW: '⇔', UDARROW: '⇕', nwarrow: '↖', nearrow: '↗', swarrow: '↙',
  searrow: '↘', NWARROW: '↖', NEARROW: '↗', SWARROW: '↙', SEARROW: '↘', mapsto: '↦', hookleft: '↩',
  hookright: '↪', leftarrow: '←', rightarrow: '→', Leftarrow: '⇐', Rightarrow: '⇒', leftrightarrow: '↔',
  Leftrightarrow: '⇔', vert: '|', VERT: '‖'
}

/** 괄호 이름(대문자 key). */
const BRACKETS: Readonly<Record<string, string>> = {
  LBRACE: '{', RBRACE: '}', LCEIL: '⌈', RCEIL: '⌉', LFLOOR: '⌊', RFLOOR: '⌋', LANGLE: '⟨', RANGLE: '⟩'
}

/** 로마체로 쓰는 함수 이름(대소문자 구분). */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln',
  'lg', 'exp', 'det', 'dim', 'ker', 'hom', 'arg', 'gcd', 'lcm', 'max', 'min', 'mod', 'Pr'
])

/** 글자 장식(소문자 key, 대소문자 무시): 위·아래와 장식 기호. */
export const DECORATIONS: Readonly<Record<string, { mark: string; under?: boolean }>> = {
  hat: { mark: '^' }, check: { mark: 'ˇ' }, tilde: { mark: '~' }, acute: { mark: '´' }, grave: { mark: '`' },
  dot: { mark: '˙' }, ddot: { mark: '¨' }, bar: { mark: '¯' }, vec: { mark: '→' }, dyad: { mark: '↔' },
  arch: { mark: '⌢' }, under: { mark: '_', under: true }, underline: { mark: '_', under: true }, overline: { mark: '¯' }
}

export type EquationSymbolClass = 'identifier' | 'operator' | 'big-operator' | 'integral' | 'bracket'

export interface EquationSymbol {
  text: string
  kind: EquationSymbolClass
}

/**
 * 명령 이름의 기호. 그리스 문자·화살표는 원래 대소문자로만 찾고, 나머지는 대문자로 바꿔 찾는다(한컴 수식은 `times`와 `TIMES`가
 * 같다). 기호가 아니면 undefined.
 */
export function lookupEquationSymbol(name: string): EquationSymbol | undefined {
  const greek = GREEK_LOWER[name] ?? GREEK_UPPER[name]
  if (greek) return { text: greek, kind: 'identifier' }
  const arrow = ARROWS[name]
  if (arrow) return { text: arrow, kind: 'operator' }
  const upper = name.toUpperCase()
  if (SPECIAL_SYMBOLS[upper]) return { text: SPECIAL_SYMBOLS[upper], kind: 'identifier' }
  if (DOTS[upper]) return { text: DOTS[upper], kind: 'operator' }
  if (OPERATORS[upper]) return { text: OPERATORS[upper], kind: 'operator' }
  if (BIG_OPERATORS[upper]) return { text: BIG_OPERATORS[upper], kind: 'big-operator' }
  if (INTEGRALS[upper]) return { text: INTEGRALS[upper], kind: 'integral' }
  if (BRACKETS[upper]) return { text: BRACKETS[upper], kind: 'bracket' }
  return undefined
}

export const isEquationFunction = (name: string): boolean => FUNCTIONS.has(name)

/** script의 한컴 수식 사설 영역 기호(rhwp `EQUATION_PUA`): U+E04D는 조건부 확률 막대. */
export const EQUATION_PUA: Readonly<Record<string, string>> = { '': '|' }
