import { DECORATIONS, EQUATION_PUA, isEquationFunction, lookupEquationSymbol } from './equation_symbols'

/**
 * 한컴 수식 script(`hp:equation/hp:script`, 수식 버전 6.0)를 MathML 나무로 바꾼다.
 *
 * 문법은 eqn 계열이다. 중위 `over`·`atop`(분수), `sqrt`·`root … of …`(근호), `^`·`_`·`sup`·`sub`(첨자), `left … right …`(괄호),
 * `matrix`·`pmatrix`·`bmatrix`·`dmatrix`(칸 `&`, 줄 `#`), `cases`, `pile`·`lpile`·`rpile`, `eqalign`, `sum`·`int`·`prod`·`lim`과
 * `from`·`to`(또는 `_`·`^`) 한계, 그리스 문자·기호 이름, 글꼴(`rm`·`it`·`bold`), 공백(`~`·`` ` ``), 따옴표 글, 중괄호 묶음을 읽는다.
 * 토큰 나누기·붙여 쓴 명령 분리·첨자 operand 규칙은 rhwp `src/renderer/equation/tokenizer.rs`·`parser.rs`
 * (https://github.com/edwardkim/rhwp, commit `1a76570e`, MIT)를 참고했다. 고지는 THIRD_PARTY_NOTICES.md에 있다.
 *
 * 해석하지 못하는 구조(짝이 안 맞는 괄호, `ladder`·`longdiv` 같은 미지원 명령, LaTeX 명령 등)를 만나면 `ok: false`를 돌려주고,
 * 화면은 지금처럼 script 글자 상자로 보여 준다(글을 잃지 않는다).
 *
 * 만든 나무는 화면에서 글자 하나하나가 그대로 DOM 글자가 되도록 짠다. Chromium MathML이 글꼴의 MATH 표로 그리는 근호·늘인
 * 괄호 glyph는 DOM 글자에 없어 PDF 글자 수가 화면과 어긋나므로, 근호는 `√` 글자(`mo`)와 윗줄 상자로, 늘이는 괄호는 늘이지 않는
 * `mo`(renderer가 CSS transform으로 늘림, `data-eq-stretch`)로 그린다.
 */

export interface MathElement {
  tag: MathTag
  attrs?: Readonly<Record<string, string>>
  children: MathNode[]
}
export type MathNode = MathElement | string

export const MATH_TAGS = [
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'mfrac', 'msub', 'msup', 'msubsup', 'munder', 'mover',
  'munderover', 'mmultiscripts', 'mprescripts', 'none', 'mtable', 'mtr', 'mtd', 'mpadded'
] as const
export type MathTag = typeof MATH_TAGS[number]

/** MathML 나무에 쓰는 속성. renderer는 이 목록 밖 속성을 그리지 않는다. */
export const MATH_ATTRIBUTES = [
  'class', 'mathvariant', 'stretchy', 'largeop', 'movablelimits', 'accent', 'accentunder', 'linethickness', 'width',
  'lspace', 'rspace', 'data-eq-stretch', 'data-eq-color'
] as const

export type EquationParseResult =
  | { ok: true; math: MathElement }
  | { ok: false; reason: string }

class EquationParseError extends Error {}

const MAX_DEPTH = 48
const MAX_TOKENS = 4000

// ---------------------------------------------------------------------------------------------------------------------
// 토큰

type TokenType =
  | 'word' | 'number' | 'symbol' | 'text' | 'quoted' | 'lbrace' | 'rbrace' | 'sub' | 'sup'
  | 'space' | 'thin' | 'newline' | 'tab' | 'eof'

interface Token {
  type: TokenType
  value: string
  /** 앞에 일반 공백이 있었는지(첨자 operand 경계). */
  spaceBefore: boolean
}

/** 구조 명령(대문자). 붙여 쓴 이름을 나눌 때 키워드인지 판단한다. */
const STRUCTURE_WORDS = new Set([
  'OVER', 'ATOP', 'CHOOSE', 'SQRT', 'ROOT', 'OF', 'LEFT', 'RIGHT', 'MATRIX', 'PMATRIX', 'BMATRIX', 'DMATRIX',
  'VMATRIX', 'CASES', 'PILE', 'LPILE', 'RPILE', 'EQALIGN', 'LIM', 'FROM', 'TO', 'SUB', 'SUP', 'LSUB', 'LSUP',
  'BINOM', 'COLOR', 'REL', 'BUILDREL', 'RM', 'IT', 'BOLD'
])
/** 한컴 수식에 있지만 이 해석기가 그리지 못하는 명령(대문자). 만나면 script 상자로 대체한다. */
const UNSUPPORTED_WORDS = new Set([
  'LADDER', 'SLADDER', 'LONGDIV', 'BENZENE', 'BIGG', 'NOT', 'SMALLMATRIX', 'PHANTOM', 'VPHANTOM', 'HPHANTOM'
])

const FONT_WORDS: Readonly<Record<string, FontMode>> = { rm: 'rm', it: 'it', bold: 'bold' }

function isKeyword(word: string): boolean {
  const lower = word.toLowerCase()
  const upper = word.toUpperCase()
  return Boolean(lookupEquationSymbol(word)) || isEquationFunction(word) || isEquationFunction(lower) ||
    Boolean(DECORATIONS[lower]) || STRUCTURE_WORDS.has(upper) || UNSUPPORTED_WORDS.has(upper)
}

/** 붙여 써도 앞에서 떼어 내는 키워드(rhwp `GLUE_SAFE`). 그리스 문자·over·root·arg·max 등 변수와 겹치는 이름은 넣지 않는다. */
const GLUE_SAFE = new Set([
  'sinh', 'cosh', 'tanh', 'coth', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'overline', 'underline', 'bar', 'vec',
  'hat', 'tilde', 'dot', 'ddot', 'acute', 'grave', 'check', 'leq', 'geq', 'neq', 'triangle', 'angle', 'cap', 'cup',
  'cdots', 'ldots', 'vdots', 'ddots'
])

/** 단어 앞에 붙어 쓴 명령의 길이(나누지 않으면 undefined). `rmK`→`rm`, `over2`→`over`, `tanx`→`tan`. */
function gluedPrefix(word: string): number | undefined {
  for (const keyword of ['over', 'atop']) {
    if (word.length > keyword.length && word.slice(0, keyword.length).toLowerCase() === keyword) {
      const rest = word.slice(keyword.length)
      if (/^\d/.test(rest) || (/^[A-Za-z]/.test(rest) && /^[A-Za-z0-9]{1,2}$/.test(rest))) return keyword.length
    }
  }
  for (const keyword of ['bold', 'it', 'rm', 'times', 'sim', 'TIMES', 'SIM', 'RM', 'IT', 'BOLD', 'prime', 'PRIME']) {
    if (word.length > keyword.length && word.startsWith(keyword)) return keyword.length
  }
  for (const keyword of ['root', 'sqrt', 'ROOT', 'SQRT', 'GEQ', 'LEQ', 'GE', 'LE']) {
    if (word.startsWith(keyword) && /^\d/.test(word.slice(keyword.length))) return keyword.length
  }
  if (word.length < 3 || isKeyword(word)) return undefined
  for (let length = word.length - 1; length >= 2; length -= 1) {
    if (GLUE_SAFE.has(word.slice(0, length).toLowerCase())) return length
  }
  return undefined
}

export function tokenizeEquation(script: string): Token[] {
  const characters = Array.from(script)
  const tokens: Token[] = []
  let index = 0
  let spaceBefore = false
  const push = (type: TokenType, value: string) => {
    tokens.push({ type, value, spaceBefore })
    spaceBefore = false
    if (tokens.length > MAX_TOKENS) throw new EquationParseError('script가 너무 깁니다')
  }
  while (index < characters.length) {
    const character = characters[index]
    if (/\s/u.test(character)) {
      spaceBefore = true
      index += 1
      continue
    }
    const next = characters[index + 1] ?? ''
    const third = characters[index + 2] ?? ''
    if (character === '~') { push('space', character); index += 1; continue }
    if (character === '`') { push('thin', character); index += 1; continue }
    if (character === '#') { push('newline', character); index += 1; continue }
    if (character === '&') { push('tab', character); index += 1; continue }
    if (character === '{') { push('lbrace', character); index += 1; continue }
    if (character === '}') { push('rbrace', character); index += 1; continue }
    if (character === '_') { push('sub', character); index += 1; continue }
    if (character === '^') { push('sup', character); index += 1; continue }
    if (character === '\\') throw new EquationParseError('LaTeX 명령은 지원하지 않습니다')
    if (character === '"') {
      const end = characters.indexOf('"', index + 1)
      if (end < 0) throw new EquationParseError('닫는 따옴표가 없습니다')
      push('quoted', characters.slice(index + 1, end).join(''))
      index = end + 1
      continue
    }
    if ((character === '<' || character === '>') && next === character && third === character) {
      push('symbol', character.repeat(3)); index += 3; continue
    }
    const pair = character + next
    if (['->', '<=', '>=', '!=', '==', '<<', '>>'].includes(pair)) { push('symbol', pair); index += 2; continue }
    if (/[0-9]/.test(character)) {
      let end = index
      while (end < characters.length && /[0-9]/.test(characters[end])) end += 1
      if (characters[end] === '.' && /[0-9]/.test(characters[end + 1] ?? '')) {
        end += 1
        while (end < characters.length && /[0-9]/.test(characters[end])) end += 1
      }
      push('number', characters.slice(index, end).join(''))
      index = end
      continue
    }
    if (/[A-Za-z]/.test(character)) {
      let end = index
      while (end < characters.length && /[A-Za-z0-9]/.test(characters[end])) end += 1
      const word = characters.slice(index, end).join('')
      const length = gluedPrefix(word) ?? word.length
      push('word', word.slice(0, length))
      index += length
      continue
    }
    if (EQUATION_PUA[character]) { push('symbol', EQUATION_PUA[character]); index += 1; continue }
    if (character.charCodeAt(0) < 0x80) { push('symbol', character); index += 1; continue }
    // ASCII가 아닌 글자(한글 등)는 공백·ASCII 앞까지 한 글 토큰으로 묶는다.
    let end = index
    while (end < characters.length && characters[end].charCodeAt(0) >= 0x80 && !/\s/u.test(characters[end]) && !EQUATION_PUA[characters[end]]) end += 1
    push('text', characters.slice(index, end).join(''))
    index = end
  }
  tokens.push({ type: 'eof', value: '', spaceBefore })
  return tokens
}

// ---------------------------------------------------------------------------------------------------------------------
// MathML 나무 만들기

type FontMode = 'it' | 'rm' | 'bold'

const element = (tag: MathTag, children: MathNode[] = [], attrs?: Record<string, string>): MathElement =>
  attrs && Object.keys(attrs).length ? { tag, attrs, children } : { tag, children }

const row = (children: MathNode[]): MathElement => children.length === 1 && typeof children[0] !== 'string' ? children[0] : element('mrow', children)

const fontClass = (mode: FontMode, italic: boolean): string | undefined =>
  mode === 'bold' ? 'eq-bold' : mode === 'it' && italic ? 'eq-it' : undefined

const identifier = (text: string, mode: FontMode, italic = true): MathElement => {
  const className = fontClass(mode, italic)
  return element('mi', [text], { mathvariant: 'normal', ...(className ? { class: className } : {}) })
}

/** 연산자. 괄호를 포함해 Chromium이 글꼴 MATH 표로 늘이지 않게 `stretchy="false"`를 둔다. */
const operator = (text: string, attrs: Record<string, string> = {}): MathElement => element('mo', [text], { stretchy: 'false', ...attrs })

const SYMBOL_TEXT: Readonly<Record<string, string>> = {
  '-': '−', '->': '→', '<=': '≤', '>=': '≥', '!=': '≠', '==': '≡', '<<': '≪', '>>': '≫', '<<<': '⋘', '>>>': '⋙',
  "'": '′', '*': '∗'
}

const SPACE_WIDTH = { space: '0.3em', thin: '0.08em', tab: '0.6em' } as const

type MatrixStyle = 'plain' | 'paren' | 'bracket' | 'vert' | 'double-vert'
const MATRIX_STYLES: Readonly<Record<string, MatrixStyle>> = {
  MATRIX: 'plain', PMATRIX: 'paren', BMATRIX: 'bracket', DMATRIX: 'vert', VMATRIX: 'vert'
}
const MATRIX_FENCES: Readonly<Record<MatrixStyle, [string, string]>> = {
  plain: ['', ''], paren: ['(', ')'], bracket: ['[', ']'], vert: ['|', '|'], 'double-vert': ['‖', '‖']
}

/** 늘여 그릴 괄호(renderer가 옆 내용 높이에 맞춰 CSS transform으로 늘인다). 빈 괄호(`.`)는 그리지 않는다. */
function fence(text: string): MathElement[] {
  return text ? [operator(text, { 'data-eq-stretch': 'fence', lspace: '0', rspace: '0' })] : []
}

const fenced = (left: string, body: MathNode[], right: string): MathElement =>
  element('mrow', [...fence(left), ...body, ...fence(right)])

type Grid = MathNode[][][]

const cellsRow = (cells: MathNode[][], align?: (column: number) => string | undefined): MathElement =>
  element('mtr', cells.map((cell, column) => {
    const alignment = align?.(column)
    return element('mtd', [row(cell)], alignment ? { class: `eq-${alignment}` } : undefined)
  }))

function table(grid: Grid, align?: (column: number) => string | undefined, className?: string): MathElement {
  return element('mtable', grid.map((cells) => cellsRow(cells, align)), className ? { class: className } : undefined)
}

/** 줄(`#`)·칸(`&`)이 있는 묶음을 칸 맞춤 표로: 짝수 칸은 오른쪽, 홀수 칸은 왼쪽 맞춤(eqalign과 같다). */
function alignedLines(grid: Grid): MathElement {
  const columns = Math.max(...grid.map((cells) => cells.length))
  if (columns === 1) return table(grid, () => 'left', 'eq-lines')
  return table(grid, (column) => (column % 2 === 0 ? 'right' : 'left'), 'eq-lines')
}

// ---------------------------------------------------------------------------------------------------------------------
// parser

type Stop = 'eof' | 'rbrace' | 'right'

class EquationParser {
  private position = 0
  private depth = 0
  private mode: FontMode = 'it'
  /** 뒤에 작은 공백을 두는 함수 이름·lim. */
  private readonly functions = new WeakSet<MathElement>()

  constructor(private readonly tokens: Token[]) {}

  parse(): MathElement {
    const grid = this.parseGrid('eof')
    return element('math', [this.gridNode(grid, (cells) => alignedLines(cells))])
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]
  }

  private take(): Token {
    const token = this.peek()
    if (token.type !== 'eof') this.position += 1
    return token
  }

  private isWord(token: Token, ...names: string[]): boolean {
    return token.type === 'word' && names.includes(token.value.toUpperCase())
  }

  private enter(): void {
    this.depth += 1
    if (this.depth > MAX_DEPTH) throw new EquationParseError('수식 중첩이 너무 깊습니다')
  }

  private leave(): void {
    this.depth -= 1
  }

  /** 한 줄·한 칸뿐이면 그 내용, 줄·칸이 있으면 `multiple`로 만든 표. */
  private gridNode(grid: Grid, multiple: (grid: Grid) => MathElement): MathElement {
    if (grid.length === 1 && grid[0].length === 1) return row(grid[0][0])
    return multiple(grid)
  }

  /**
   * `stop`(끝·닫는 중괄호·`right`)까지 줄(`#`)과 칸(`&`)으로 나눈 내용. 중위 `over`·`atop`·`choose`는 칸의 바로 앞 요소와 바로 뒤
   * 요소를 묶는다. 글꼴 명령은 묶음 끝까지 이어지고, 묶음이 끝나면 앞 글꼴로 돌아간다.
   */
  private parseGrid(stop: Stop): Grid {
    this.enter()
    const savedMode = this.mode
    const grid: Grid = [[[]]]
    let infixRun = 0
    for (;;) {
      const token = this.peek()
      if (token.type === 'eof') {
        if (stop !== 'eof') throw new EquationParseError(stop === 'rbrace' ? '닫는 중괄호가 없습니다' : 'right가 없습니다')
        break
      }
      if (token.type === 'rbrace') {
        if (stop !== 'rbrace') throw new EquationParseError('여는 중괄호 없는 닫는 중괄호')
        this.take()
        break
      }
      if (stop === 'right' && this.isWord(token, 'RIGHT')) break
      const cells = grid[grid.length - 1]
      const items = cells[cells.length - 1]
      if (token.type === 'newline') { this.take(); grid.push([[]]); continue }
      if (token.type === 'tab') { this.take(); cells.push([]); continue }
      if (this.isWord(token, 'OVER', 'ATOP', 'CHOOSE')) {
        this.take()
        infixRun += 1
        if (infixRun > MAX_DEPTH) throw new EquationParseError('분수가 너무 많이 이어집니다')
        const kind = token.value.toUpperCase()
        const top = items.pop() ?? element('mrow')
        if (['eof', 'rbrace', 'newline', 'tab'].includes(this.peek().type)) throw new EquationParseError(`${token.value} 뒤에 분모가 없습니다`)
        const bottom = this.parseElement()
        if (!bottom) throw new EquationParseError(`${token.value} 뒤에 분모가 없습니다`)
        const fraction = element('mfrac', [top, bottom], kind === 'OVER' ? undefined : { linethickness: '0' })
        items.push(kind === 'CHOOSE' ? fenced('(', [fraction], ')') : fraction)
        continue
      }
      infixRun = 0
      const node = this.parseElement()
      if (node) items.push(node)
    }
    this.mode = savedMode
    this.leave()
    return grid
  }

  /** `{ … }` 묶음. 안에 줄·칸이 있으면 가운데 맞춘 쌓기로 그린다. */
  private parseGroup(): MathElement {
    this.take()
    const grid = this.parseGrid('rbrace')
    return this.gridNode(grid, (cells) => alignedLines(cells))
  }

  /** 첨자 operand·명령 인자: 묶음 하나나 요소 하나(뒤 첨자는 붙이지 않는다). */
  private parseOperand(): MathElement {
    const token = this.peek()
    if (token.type === 'eof' || token.type === 'rbrace' || token.type === 'newline' || token.type === 'tab') {
      throw new EquationParseError('인자가 없습니다')
    }
    const node = this.parsePrimary()
    if (!node) throw new EquationParseError('인자 자리에 글꼴 명령이 있습니다')
    return node
  }

  /** 아래 첨자·아래 한계 operand. 공백 없이 붙은 관계 기호는 이어 묶는다(`sum_k=1`, `lim_x->0`). */
  private parseLowerOperand(): MathElement {
    const items: MathNode[] = [this.parseOperand()]
    for (;;) {
      const token = this.peek()
      if (token.type !== 'symbol' || token.spaceBefore || !['=', '<', '>', '<=', '>=', '!=', '==', '->'].includes(token.value)) break
      this.take()
      items.push(operator(SYMBOL_TEXT[token.value] ?? token.value))
      items.push(this.parseOperand())
    }
    return row(items)
  }

  /** 요소 하나와 뒤 첨자. 글꼴 명령이면 글꼴만 바꾸고 undefined. */
  private parseElement(): MathElement | undefined {
    const token = this.peek()
    if (token.type === 'sub' || token.type === 'sup' || this.isWord(token, 'SUB', 'SUP')) {
      return this.parseScripts(element('mrow'))
    }
    const node = this.parsePrimary()
    if (!node) return undefined
    const scripted = this.parseScripts(node)
    return this.functions.has(node) ? element('mrow', [scripted, element('mspace', [], { width: '0.17em' })]) : scripted
  }

  /** 뒤에 오는 `_`·`^`(`sub`·`sup`)를 붙인다. 첨자 앞 1/4 공백(`` ` ``)은 넘긴다. */
  private parseScripts(base: MathElement): MathElement {
    let lower: MathElement | undefined
    let upper: MathElement | undefined
    for (;;) {
      let token = this.peek()
      if (token.type === 'thin') {
        const next = this.peek(1)
        if (next.type === 'sub' || next.type === 'sup' || this.isWord(next, 'SUB', 'SUP')) {
          this.take()
          token = this.peek()
        }
      }
      if (!lower && (token.type === 'sub' || this.isWord(token, 'SUB'))) {
        this.take()
        lower = this.parseLowerOperand()
      } else if (!upper && (token.type === 'sup' || this.isWord(token, 'SUP'))) {
        this.take()
        upper = this.parseOperand()
      } else {
        break
      }
    }
    if (lower && upper) return element('msubsup', [base, lower, upper])
    if (lower) return element('msub', [base, lower])
    if (upper) return element('msup', [base, upper])
    return base
  }

  /** 큰 연산자·lim의 한계: `_`·`from`은 아래, `^`·`to`는 위. */
  private parseLimits(): { lower?: MathElement; upper?: MathElement } {
    let lower: MathElement | undefined
    let upper: MathElement | undefined
    for (;;) {
      const token = this.peek()
      if (!lower && (token.type === 'sub' || this.isWord(token, 'SUB', 'FROM'))) {
        this.take()
        lower = this.parseLowerOperand()
      } else if (!upper && (token.type === 'sup' || this.isWord(token, 'SUP', 'TO'))) {
        this.take()
        upper = this.parseOperand()
      } else {
        break
      }
    }
    return { lower, upper }
  }

  private parsePrimary(): MathElement | undefined {
    const token = this.peek()
    switch (token.type) {
      case 'lbrace':
        return this.parseGroup()
      case 'number':
        this.take()
        return element('mn', [token.value], this.mode === 'bold' ? { class: 'eq-bold' } : undefined)
      case 'symbol': {
        this.take()
        return operator(SYMBOL_TEXT[token.value] ?? token.value)
      }
      case 'text':
        this.take()
        return element('mtext', [token.value], this.mode === 'bold' ? { class: 'eq-bold' } : undefined)
      case 'quoted':
        this.take()
        return element('mtext', [token.value], this.mode === 'bold' ? { class: 'eq-bold' } : undefined)
      case 'space':
      case 'thin':
        this.take()
        return element('mspace', [], { width: SPACE_WIDTH[token.type] })
      case 'word':
        this.take()
        this.enter()
        try {
          return this.parseWord(token.value)
        } finally {
          this.leave()
        }
      default:
        throw new EquationParseError(`예상하지 못한 ${token.value || token.type}`)
    }
  }

  private parseWord(word: string): MathElement | undefined {
    const upper = word.toUpperCase()
    const lower = word.toLowerCase()
    if (UNSUPPORTED_WORDS.has(upper)) throw new EquationParseError(`지원하지 않는 명령 ${word}`)
    if (FONT_WORDS[lower]) {
      this.mode = FONT_WORDS[lower]
      return undefined
    }
    switch (upper) {
      case 'SQRT':
      case 'ROOT':
        return this.parseRadical()
      case 'LEFT':
        return this.parseLeftRight()
      case 'CASES':
        return this.parseCases()
      case 'PILE':
      case 'LPILE':
      case 'RPILE': {
        const grid = this.parseBraceGrid(word)
        const align = upper === 'LPILE' ? 'left' : upper === 'RPILE' ? 'right' : 'center'
        return table(grid.map((cells) => [cells.flat()]), () => align, 'eq-pile')
      }
      case 'EQALIGN':
        return table(this.parseBraceGrid(word), (column) => (column % 2 === 0 ? 'right' : 'left'), 'eq-lines')
      case 'LIM': {
        const name = word === 'Lim' || word === 'LIM' ? 'Lim' : 'lim'
        const { lower: under } = this.parseLimits()
        const base = identifier(name, 'rm', false)
        const node = under ? element('munder', [base, under]) : base
        this.functions.add(node)
        return node
      }
      case 'BINOM': {
        const top = this.parseOperand()
        const bottom = this.parseOperand()
        return fenced('(', [element('mfrac', [top, bottom], { linethickness: '0' })], ')')
      }
      case 'COLOR':
        return this.parseColor()
      case 'REL':
      case 'BUILDREL': {
        const arrow = this.parseOperand()
        const over = this.parseOperand()
        if (upper === 'BUILDREL') return element('mover', [arrow, over])
        return element('munderover', [arrow, this.parseOperand(), over])
      }
      case 'LSUB':
      case 'LSUP': {
        const script = this.parseOperand()
        const base = this.parseOperand()
        return element('mmultiscripts', upper === 'LSUB'
          ? [base, element('mprescripts'), script, element('none')]
          : [base, element('mprescripts'), element('none'), script])
      }
      case 'OVER':
      case 'ATOP':
      case 'CHOOSE':
      case 'RIGHT':
      case 'OF':
      case 'FROM':
      case 'TO':
      case 'SUB':
      case 'SUP':
        throw new EquationParseError(`${word}의 자리가 맞지 않습니다`)
      default:
        break
    }
    if (MATRIX_STYLES[upper]) {
      const style = MATRIX_STYLES[upper]
      const [left, right] = MATRIX_FENCES[style]
      return fenced(left, [table(this.parseBraceGrid(word), undefined, 'eq-matrix')], right)
    }
    const decoration = DECORATIONS[lower]
    if (decoration) {
      const body = this.parseOperand()
      const mark = operator(decoration.mark, { class: 'eq-accent' })
      return decoration.under
        ? element('munder', [body, mark], { accentunder: 'true' })
        : element('mover', [body, mark], { accent: 'true' })
    }
    const symbol = lookupEquationSymbol(word)
    if (symbol) {
      if (symbol.kind === 'identifier') return identifier(symbol.text, this.mode, false)
      if (symbol.kind === 'bracket') return operator(symbol.text)
      if (symbol.kind === 'big-operator' || symbol.kind === 'integral') {
        const base = operator(symbol.text, { class: symbol.kind === 'integral' ? 'eq-integral' : 'eq-large', largeop: 'false', movablelimits: 'false' })
        const { lower: under, upper: over } = this.parseLimits()
        if (!under && !over) return base
        if (symbol.kind === 'integral') {
          return under && over ? element('msubsup', [base, under, over]) : element(under ? 'msub' : 'msup', [base, (under ?? over)!])
        }
        return under && over ? element('munderover', [base, under, over]) : element(under ? 'munder' : 'mover', [base, (under ?? over)!])
      }
      return operator(symbol.text)
    }
    if (isEquationFunction(word)) {
      const node = identifier(word, 'rm', false)
      this.functions.add(node)
      return node
    }
    return identifier(word, this.mode, true)
  }

  /** `{ … }` 인자를 줄·칸으로 나눈 내용(행렬·cases·pile·eqalign). */
  private parseBraceGrid(name: string): Grid {
    if (this.peek().type !== 'lbrace') throw new EquationParseError(`${name} 뒤에 중괄호가 없습니다`)
    this.take()
    const grid = this.parseGrid('rbrace')
    // 끝에 붙은 빈 줄(`a # b #`)은 버린다.
    while (grid.length > 1 && grid[grid.length - 1].every((cell) => cell.length === 0)) grid.pop()
    return grid
  }

  /** `sqrt x`, `root n of x`, `sqrt {n} of {x}`. 근호는 `√` 글자와 윗줄 상자로 그린다. */
  private parseRadical(): MathElement {
    const first = this.parseOperand()
    let index: MathElement | undefined
    let body = first
    if (this.isWord(this.peek(), 'OF')) {
      this.take()
      index = first
      body = this.parseOperand()
    }
    const sign = operator('√', { class: 'eq-radical-sign', 'data-eq-stretch': 'radical', lspace: '0', rspace: '0' })
    return element('mrow', [
      index ? element('mmultiscripts', [sign, element('mprescripts'), element('none'), index], { class: 'eq-radical-index' }) : sign,
      element('mrow', [body], { class: 'eq-radicand' })
    ], { class: 'eq-radical' })
  }

  /** `left ( … right )`. `.`은 빈 괄호. */
  private parseLeftRight(): MathElement {
    const left = this.readDelimiter()
    const grid = this.parseGrid('right')
    this.take()
    const right = this.readDelimiter()
    return fenced(left, [this.gridNode(grid, (cells) => alignedLines(cells))], right)
  }

  private readDelimiter(): string {
    const token = this.peek()
    if (token.type === 'lbrace' || token.type === 'rbrace') { this.take(); return token.value }
    if (token.type === 'symbol' && ['(', ')', '[', ']', '|', '.', '<', '>'].includes(token.value)) {
      this.take()
      return token.value === '.' ? '' : token.value === '<' ? '⟨' : token.value === '>' ? '⟩' : token.value
    }
    if (token.type === 'word') {
      const symbol = lookupEquationSymbol(token.value)
      if (symbol && (symbol.kind === 'bracket' || symbol.text === '|' || symbol.text === '‖')) {
        this.take()
        return symbol.text
      }
    }
    throw new EquationParseError('left·right 뒤에 괄호가 없습니다')
  }

  /** `cases{식 & 조건 # …}`: 왼쪽 중괄호와 왼쪽 맞춘 두 칸 표. */
  private parseCases(): MathElement {
    const grid = this.parseBraceGrid('cases').map((cells) => cells.length > 2 ? [cells[0], cells.slice(1).flat()] : cells)
    return fenced('{', [table(grid, () => 'left', 'eq-cases')], '')
  }

  /** `COLOR{R,G,B}{…}` 또는 `COLOR{R,G,B} 요소`. */
  private parseColor(): MathElement {
    if (this.take().type !== 'lbrace') throw new EquationParseError('COLOR 뒤에 중괄호가 없습니다')
    const values: number[] = []
    for (;;) {
      const token = this.take()
      if (token.type === 'rbrace') break
      if (token.type === 'number' && /^\d+$/.test(token.value)) values.push(Math.min(Number(token.value), 255))
      else if (!(token.type === 'symbol' && token.value === ',')) throw new EquationParseError('COLOR 값이 맞지 않습니다')
    }
    if (values.length !== 3) throw new EquationParseError('COLOR 값은 세 개여야 합니다')
    const color = `#${values.map((value) => value.toString(16).padStart(2, '0')).join('')}`
    return element('mrow', [this.parseOperand()], { 'data-eq-color': color })
  }
}

/** 한컴 수식 script를 MathML 나무로. 해석하지 못하면 `ok: false`. */
export function parseEquationScript(script: string): EquationParseResult {
  try {
    if (!script.trim()) return { ok: false, reason: 'script가 비어 있습니다' }
    const math = new EquationParser(tokenizeEquation(script)).parse()
    if (!hasVisibleText(math)) return { ok: false, reason: '그릴 글자가 없습니다' }
    return { ok: true, math }
  } catch (error) {
    if (error instanceof EquationParseError) return { ok: false, reason: error.message }
    throw error
  }
}

function hasVisibleText(node: MathNode): boolean {
  return typeof node === 'string' ? node.trim().length > 0 : node.children.some(hasVisibleText)
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** MathML 문자열(test·진단용). renderer는 같은 나무를 React element로 그린다. */
export function mathToString(node: MathNode): string {
  if (typeof node === 'string') return escapeXml(node)
  const attrs = Object.entries(node.attrs ?? {}).map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join('')
  return node.children.length
    ? `<${node.tag}${attrs}>${node.children.map(mathToString).join('')}</${node.tag}>`
    : `<${node.tag}${attrs}/>`
}

/** 나무의 글자를 문서 순서로 이어 붙인다(검색·접근성 이름 대신 쓸 수 있는 평문). */
export function mathPlainText(node: MathNode): string {
  return typeof node === 'string' ? node : node.children.map(mathPlainText).join('')
}
