import type {
  ViewerContent,
  ViewerDocument,
  ViewerObjectKind,
  ViewerObjectPlaceholder,
  ViewerParagraph
} from './viewer_document'

/**
 * 원본 개체 자리 표시(`object-placeholder`)를 세고 한국어로 요약하는 순수 함수 모음.
 * renderer(상태 표시·배너)와 main(PDF 내보내기 확인 대화상자)이 같은 이름·순서를 쓴다.
 */

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
    } else if (item.type === 'table') {
      for (const row of item.rows) for (const cell of row.cells) visitParagraphs(cell.paragraphs, visit)
    } else if (item.type === 'note-list') {
      for (const note of item.notes) visitParagraphs(note.paragraphs, visit)
    }
  }
}

/** 문서(본문·표 셀·머리말·꼬리말·글상자·각주 본문)의 모든 자리 표시를 문서 순서로 모은다. */
export function collectObjectPlaceholders(document: Pick<ViewerDocument, 'sections'>): ViewerObjectPlaceholder[] {
  const result: ViewerObjectPlaceholder[] = []
  const visit = (item: ViewerObjectPlaceholder) => { result.push(item) }
  for (const section of document.sections) {
    visitParagraphs(section.blocks, visit)
    for (const control of [...section.headers, ...section.footers]) visitParagraphs(control.paragraphs, visit)
  }
  return result
}

/** 종류별 자리 표시 개수. 0개인 종류는 넣지 않고 key는 `OBJECT_KIND_ORDER` 순서다. */
export function countObjectPlaceholders(document: Pick<ViewerDocument, 'sections'>): ObjectPlaceholderCounts {
  const counts: ObjectPlaceholderCounts = {}
  for (const item of collectObjectPlaceholders(document)) counts[item.kind] = (counts[item.kind] ?? 0) + 1
  return Object.fromEntries(OBJECT_KIND_ORDER.filter((kind) => counts[kind]).map((kind) => [kind, counts[kind]]))
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
    equation: '수식 원문(script)을 상자 안에 글자로 보여 줍니다.',
    'text-box': '글상자 안 글은 보여 주지만 위치·모양은 원본과 다릅니다.',
    shape: '도형은 크기만 맞춘 상자로 보여 줍니다.',
    footnote: '각주 번호는 본문에, 각주 내용은 구역 끝에 모아 보여 줍니다.',
    endnote: '미주 번호는 본문에, 미주 내용은 구역 끝에 모아 보여 줍니다.',
    memo: '메모 내용은 본문 안 작은 상자로 보여 줍니다.',
    ruby: '덧말은 본말 위·아래 작은 글자로 비슷하게 보여 줍니다.'
  }
  return OBJECT_KIND_ORDER
    .filter((kind) => counts[kind])
    .map((kind) => `${OBJECT_KIND_LABELS[kind]} ${counts[kind]}개${notes[kind] ? ` — ${notes[kind]}` : ''}`)
}
