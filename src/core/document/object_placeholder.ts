import type {
  ViewerContent,
  ViewerDocument,
  ViewerObjectKind,
  ViewerObjectPlaceholder,
  ViewerParagraph,
  ViewerSection
} from './viewer_document'

/**
 * 원본 개체 자리 표시(`object-placeholder`)를 세고 한국어로 요약하는 순수 함수 모음.
 * renderer(상태 표시·배너)와 main(PDF 내보내기 확인 대화상자)이 같은 이름·순서를 쓴다.
 */

/**
 * 자리 표시(와 되살린 글)가 쪽 본문 높이 가운데 차지할 수 있는 최대 비율. 같은 문단의 글 줄·여백이 함께 들어갈 자리를 남긴다.
 * decoder는 선언 높이를, renderer는 되살린 글 높이를 이 한도에 맞춰 줄인다.
 */
export const OBJECT_PAGE_HEIGHT_RATIO = 0.85

export const OBJECT_KIND_ORDER: readonly ViewerObjectKind[] = [
  'equation',
  'chart',
  'ole',
  'text-box',
  'shape',
  'form-control',
  'video',
  'footnote',
  'endnote',
  'memo',
  'field',
  'ruby',
  'unknown'
]

export const OBJECT_KIND_LABELS: Readonly<Record<ViewerObjectKind, string>> = {
  equation: '수식',
  chart: '차트',
  ole: 'OLE 개체',
  'text-box': '글상자',
  shape: '도형',
  'form-control': '양식 컨트롤',
  video: '동영상',
  footnote: '각주',
  endnote: '미주',
  memo: '메모',
  field: '필드',
  ruby: '덧말',
  unknown: '알 수 없는 개체'
}

export type ObjectPlaceholderCounts = Partial<Record<ViewerObjectKind, number>>

function visitParagraphs(paragraphs: readonly ViewerParagraph[], visit: (item: ViewerObjectPlaceholder) => void): void {
  for (const paragraph of paragraphs) visitContent(paragraph.content, visit)
}

function visitContent(content: readonly ViewerContent[], visit: (item: ViewerObjectPlaceholder) => void): void {
  for (const item of content) {
    if (item.type === 'object-placeholder') {
      visit(item)
      if (item.paragraphs) visitParagraphs(item.paragraphs, visit)
      if (item.note) visitParagraphs(item.note.paragraphs, visit)
    } else if (item.type === 'table') {
      for (const row of item.rows) for (const cell of row.cells) visitParagraphs(cell.paragraphs, visit)
    } else if (item.type === 'note-list') {
      for (const note of item.notes) visitParagraphs(note.paragraphs, visit)
    }
  }
}

/**
 * section별 자리 표시 목록 cache. ViewerSection은 만든 뒤 바꾸지 않으므로(편집 projection patch는 바뀐 section을 새 object로
 * 바꾼다) section object를 key로 다시 세지 않는다.
 */
const sectionPlaceholders = new WeakMap<ViewerSection, readonly ViewerObjectPlaceholder[]>()

function placeholdersOf(section: ViewerSection): readonly ViewerObjectPlaceholder[] {
  const cached = sectionPlaceholders.get(section)
  if (cached) return cached
  const result: ViewerObjectPlaceholder[] = []
  const visit = (item: ViewerObjectPlaceholder) => { result.push(item) }
  visitParagraphs(section.blocks, visit)
  for (const control of [...section.headers, ...section.footers]) visitParagraphs(control.paragraphs, visit)
  sectionPlaceholders.set(section, result)
  return result
}

/** 문서(본문·표 셀·머리말·꼬리말·글상자·각주 본문)의 모든 자리 표시를 문서 순서로 모은다. */
export function collectObjectPlaceholders(document: Pick<ViewerDocument, 'sections'>): ViewerObjectPlaceholder[] {
  return document.sections.flatMap((section) => placeholdersOf(section))
}

/** 수식 script를 해석해 MathML로 그리는 수식인지. 이런 수식은 원본처럼 그리므로 "완전히 표시되지 않는 개체"에 넣지 않는다. */
export function isRenderedEquation(item: ViewerObjectPlaceholder): boolean {
  return item.kind === 'equation' && item.equation !== undefined
}

function countItems(items: readonly ViewerObjectPlaceholder[]): ObjectPlaceholderCounts {
  const counts: ObjectPlaceholderCounts = {}
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
  return Object.fromEntries(OBJECT_KIND_ORDER.filter((kind) => counts[kind]).map((kind) => [kind, counts[kind]]))
}

/** 종류별 원본 개체(자리 표시와 그려 낸 수식) 개수. 0개인 종류는 넣지 않고 key는 `OBJECT_KIND_ORDER` 순서다. */
export function countObjectPlaceholders(document: Pick<ViewerDocument, 'sections'>): ObjectPlaceholderCounts {
  return countItems(collectObjectPlaceholders(document))
}

/**
 * 화면에 완전히 표시되지 않는 개체의 종류별 개수(안내 배너·PDF 확인 대화상자·진단). MathML로 그려 낸 수식은 뺀다.
 */
export function countIncompleteObjectPlaceholders(document: Pick<ViewerDocument, 'sections'>): ObjectPlaceholderCounts {
  return countItems(collectObjectPlaceholders(document).filter((item) => !isRenderedEquation(item)))
}

export function totalObjectPlaceholders(counts: ObjectPlaceholderCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0)
}

/** 신뢰하지 않는 입력(IPC)에서 받은 개수 object를 검증해 알려진 종류의 양의 정수만 남긴다. */
export function sanitizeObjectPlaceholderCounts(value: unknown): ObjectPlaceholderCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const counts: ObjectPlaceholderCounts = {}
  for (const kind of OBJECT_KIND_ORDER) {
    const amount = source[kind]
    if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0) counts[kind] = amount
  }
  return counts
}

/** "수식 2, 글상자 1" 형식의 요약. */
export function formatObjectPlaceholderCounts(counts: ObjectPlaceholderCounts): string {
  return OBJECT_KIND_ORDER
    .filter((kind) => counts[kind])
    .map((kind) => `${OBJECT_KIND_LABELS[kind]} ${counts[kind]}`)
    .join(', ')
}

/** 상태 막대·배너 문구. 자리 표시가 없으면 undefined. */
export function objectPlaceholderNotice(counts: ObjectPlaceholderCounts): string | undefined {
  const total = totalObjectPlaceholders(counts)
  if (!total) return undefined
  return `이 문서에는 화면에 완전히 표시되지 않는 개체가 ${total}개 있습니다 (${formatObjectPlaceholderCounts(counts)})`
}

/** 종류별 설명 줄(배너 자세히 보기·PDF 확인 대화상자 detail). */
export function objectPlaceholderDetailLines(counts: ObjectPlaceholderCounts): string[] {
  const notes: Partial<Record<ViewerObjectKind, string>> = {
    equation: '해석하지 못한 수식 원문(script)을 상자 안에 글자로 보여 줍니다.',
    'text-box': '본문의 글상자는 원본 위치·선·면 색으로 그리고 글은 읽기 전용으로 보여 줍니다. 표 셀·머리말 안 글상자는 줄 안 상자로 보여 줍니다.',
    shape: '본문의 사각형·타원·선·다각형은 원본 위치에 선·면 색으로 그리고, 그 밖의 도형과 표 셀 안 도형은 크기만 맞춘 상자로 보여 줍니다.',
    footnote: '각주 내용은 번호가 놓인 쪽 아래에 보여 줍니다. 각주 모양(번호 모양·구분선·간격)은 구역 설정을 따르고 위치는 원본과 조금 다를 수 있습니다.',
    endnote: '미주 번호는 본문에, 미주 내용은 구역 끝에 모아 보여 줍니다.',
    memo: '메모 내용은 본문 안 작은 상자로 보여 줍니다.',
    ruby: '덧말은 본말 위·아래 작은 글자로 비슷하게 보여 줍니다.'
  }
  return OBJECT_KIND_ORDER
    .filter((kind) => counts[kind])
    .map((kind) => `${OBJECT_KIND_LABELS[kind]} ${counts[kind]}개${notes[kind] ? ` — ${notes[kind]}` : ''}`)
}
