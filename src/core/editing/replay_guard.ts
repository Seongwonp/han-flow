import type { HwpxSourcePackage } from '../parser/source_package'
import { parseEmptyParagraphAnchorId, parseTableCaretAnchorId } from './empty_paragraph_anchor'
import { isNoteNumberControl, paragraphStructureViolation } from './paragraph_structure'
import { sourceParagraphStructureAccess } from './paragraph_patch'
import { parseSourceTree, serializeSourceNode, type SourceElement, type SourceNode, type SourceTree } from './source_tree'
import { resolveTableFragmentCommand } from './table_patch'
import { HwpxEditConflictError } from './text_patch'
import { parseEndnotePath, parseFootnotePath } from './footnote_patch'
import type { EditCommand, EditTransaction } from './transaction'

/*
 * 복구 기록 replay 검사. 기록 파일은 앱 밖에서 바뀔 수 있으므로, replay는 planner를 거치지 않는 대신 기록된 command가
 * live 편집이 만들 수 있는 모양인지 여기서 먼저 확인한다.
 *
 * - forward command 종류: 편집 엔진(`editing_engine.ts`)이 transaction에 넣는 것만. `restore-*`는 history가 만드는
 *   inverse 전용이라 기록의 forward command로 받지 않는다.
 * - 문단 fragment 교체: 교체 fragment는 `hp:p` element만 이어 붙인 것이고, 각 문단은 문단 구조 command의 공통 규칙
 *   ({@link paragraphStructureViolation}: `hp:run`·`hp:linesegarray`만, run마다 `hp:t` 하나와 `hp:lineBreak`·`hp:tab`)을
 *   통과해야 한다. planner(분할·병합·범위 치환)는 이 규칙을 통과한 문단에서만 fragment를 만든다. 각주·미주 첫 문단 나눔(복구 기록
 *   version 5부터)은 첫 문단 첫 run의 번호 control을 받되, 그 control 원문이 바꾸기 전 fragment에 그대로 있어야 한다(번호를 새로
 *   들이지 않는다).
 * - 표 fragment 교체: 교체 fragment는 `hp:tbl` element 하나이고, 바꾸기 전 표(`expectedFragment`, 적용 때 현재 원문과 같은지
 *   확인한다)에 없던 element 이름을 들이지 않으며, 표 뼈대·단순 텍스트 셀 element가 아닌 것(그림·수식·중첩 표·제어 등)의
 *   개수를 늘리지 않는다. 표 planner는 빈 행·열·셀을 단순 텍스트 셀에서만 복제하므로 이 범위 안이다.
 * - 표 변경 조각(`patch-table-fragment`, planner가 만드는 형식): 기록에는 표 원문이 없으므로 replay 직전 package에서 현재 표를
 *   찾아 길이·SHA-256을 맞춰 보고 조각을 적용한 결과 표에 위 표 fragment 규칙을 그대로 건다. 그 전에 command 모양(길이는 0 이상
 *   정수, SHA-256은 소문자 hex 64자, 조각은 `[offset, 지울 길이, 넣을 원문]` 배열, 교체 뒤 locator는 문자열)부터 본다. 그래서 이 command는 transaction의
 *   유일한 command여야 한다(planner의 표 transaction은 command 하나다). 이전 형식 `replace-table-fragment`는 복구 기록
 *   version 1과, version 1 기록을 복구해 이어 쓴 기록에서 읽는다.
 * - 글자 command(`replace-text`): 대상은 그 command section의 `hp:t` anchor(`#hp:t:N`), 빈 문단 합성 anchor(`#hp:p:N:empty`),
 *   표 앞·뒤 합성 anchor(`#hp:p:N:table-before|after`) 가운데 하나여야 하고, 범위는 0 이상 정수(`from <= to`), 입력은 문자열이다.
 *   inverse 전용 option(`restoreSelfClosingTag`·`insertSource`·`removeCreatedText`)은 live 편집의 forward command에 없으므로
 *   받지 않는다. 각주·미주·머리말·꼬리말·글상자·메모 글자도 같은 `#hp:t:N` anchor라 같은 규칙을 탄다. 대상 anchor가 실제로 있는지는
 *   적용할 때 편집 코어가 다시 본다.
 * - 각주 command(`insert-footnote`·`delete-footnote`, 복구 기록 version 4부터)와 미주 command(`insert-endnote`·`delete-endnote`,
 *   version 5부터): 모양만 보고(`assertFootnoteCommandShape`) 위치·번호 매기기 검사는 편집 코어가 적용할 때 한다(표 셀·글상자 안,
 *   머리말·꼬리말 거부도 코어가 본다). inverse 전용 `restore-footnote`는 forward로 받지 않는다.
 */

/** 편집 엔진이 forward transaction에 넣는 command 종류. */
export const FORWARD_EDIT_COMMAND_TYPES: ReadonlySet<EditCommand['type']> = new Set<EditCommand['type']>([
  'replace-text',
  'apply-character-style',
  'apply-paragraph-style',
  'apply-cell-style',
  'replace-paragraph-fragment',
  'replace-table-fragment',
  'patch-table-fragment',
  'insert-footnote',
  'delete-footnote',
  'insert-endnote',
  'delete-endnote'
])

/** 표 planner가 새로 만들 수 있는(개수가 늘 수 있는) 표 뼈대·단순 텍스트 셀 element. */
const TABLE_SKELETON_ELEMENTS: ReadonlySet<string> = new Set([
  'hp:tr',
  'hp:tc',
  'hp:cellAddr',
  'hp:cellSpan',
  'hp:cellSz',
  'hp:cellMargin',
  'hp:subList',
  'hp:p',
  'hp:run',
  'hp:t',
  'hp:lineBreak',
  'hp:tab',
  'hp:linesegarray',
  'hp:lineseg'
])

function parseFragment(xml: string, label: string): SourceTree {
  try {
    return parseSourceTree(xml)
  } catch {
    throw new HwpxEditConflictError(`복구 기록의 ${label} fragment가 올바른 XML이 아닙니다.`)
  }
}

/** fragment 최상위 node가 모두 `name` element인지 확인하고 돌려준다(사이 공백 text도 받지 않는다). */
function rootElements(tree: SourceTree, name: string, label: string): SourceElement[] {
  const roots = tree.children
  if (!roots.length || roots.some((node) => node.kind !== 'element' || node.name !== name)) {
    throw new HwpxEditConflictError(`복구 기록의 ${label} fragment에 허용하지 않는 콘텐츠가 있습니다.`)
  }
  return roots as SourceElement[]
}

function countElements(nodes: readonly SourceNode[], counts = new Map<string, number>()): Map<string, number> {
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1)
    countElements(node.children, counts)
  }
  return counts
}

function assertParagraphReplacement(expectedFragment: string, replacementFragment: string): void {
  const tree = parseFragment(replacementFragment, '문단')
  const access = sourceParagraphStructureAccess(tree)
  rootElements(tree, 'hp:p', '문단').forEach((paragraph, index) => {
    // 각주·미주 첫 문단의 번호 control은 첫 문단에서만, 바꾸기 전 fragment에 같은 원문이 있을 때만 받는다.
    const firstRun = paragraph.children.find((child): child is SourceElement => child.kind === 'element' && child.name === 'hp:run')
    const numbers = index === 0 && firstRun ? firstRun.children.filter((child) => isNoteNumberControl(child, access)) : []
    const numberRun = numbers.length > 0 && numbers.every((control) => expectedFragment.includes(serializeSourceNode(tree, control)))
    const violation = paragraphStructureViolation<SourceNode>(paragraph, access, { numberRun })
    if (violation) throw new HwpxEditConflictError(`복구 기록의 문단 fragment를 적용할 수 없습니다: ${violation.message}`)
  })
}

function assertTableReplacement(expectedFragment: string, replacementFragment: string): void {
  const replacement = parseFragment(replacementFragment, '표')
  if (rootElements(replacement, 'hp:tbl', '표').length !== 1) {
    throw new HwpxEditConflictError('복구 기록의 표 fragment는 표 하나여야 합니다.')
  }
  const before = countElements(parseFragment(expectedFragment, '표').children)
  for (const [name, count] of countElements(replacement.children)) {
    const previous = before.get(name)
    if (previous === undefined || (!TABLE_SKELETON_ELEMENTS.has(name) && count > previous)) {
      throw new HwpxEditConflictError(`복구 기록의 표 fragment가 원래 표에 없던 콘텐츠(${name})를 더합니다.`)
    }
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/** 기록에서 읽은 표 변경 조각 command의 필드 모양을 확인한다. 조각 범위·순서는 적용할 때 현재 표 원문 기준으로 다시 본다. */
function assertTableFragmentPatchShape(command: Extract<EditCommand, { type: 'patch-table-fragment' }>): void {
  const value = command as unknown as Record<string, unknown>
  const edits = value['edits']
  if (
    !Number.isSafeInteger(value['expectedLength']) ||
    (value['expectedLength'] as number) < 0 ||
    typeof value['expectedSha256'] !== 'string' ||
    !SHA256_HEX.test(value['expectedSha256']) ||
    (value['replacementTextNodeId'] !== undefined && typeof value['replacementTextNodeId'] !== 'string') ||
    !Array.isArray(edits) ||
    !edits.every((edit) =>
      Array.isArray(edit) &&
      edit.length === 3 &&
      Number.isSafeInteger(edit[0]) &&
      edit[0] >= 0 &&
      Number.isSafeInteger(edit[1]) &&
      edit[1] >= 0 &&
      typeof edit[2] === 'string'
    )
  ) {
    throw new HwpxEditConflictError('복구 기록의 표 변경 조각 형식이 올바르지 않습니다.')
  }
}

const INVERSE_ONLY_TEXT_OPTIONS = ['restoreSelfClosingTag', 'insertSource', 'removeCreatedText'] as const

function isTextAnchorOf(sectionPath: string, textNodeId: string): boolean {
  const prefix = `${sectionPath}#hp:t:`
  if (textNodeId.startsWith(prefix)) {
    const ordinal = Number(textNodeId.slice(prefix.length))
    return Number.isSafeInteger(ordinal) && ordinal >= 0 && `${prefix}${ordinal}` === textNodeId
  }
  const synthetic = parseEmptyParagraphAnchorId(textNodeId) ?? parseTableCaretAnchorId(textNodeId)
  return synthetic?.sectionPath === sectionPath
}

function assertTextCommandShape(command: Extract<EditCommand, { type: 'replace-text' }>): void {
  const value = command as unknown as Record<string, unknown>
  if (
    typeof value['sectionPath'] !== 'string' ||
    !/^Contents\/section\d+\.xml$/.test(value['sectionPath']) ||
    typeof value['textNodeId'] !== 'string' ||
    !isTextAnchorOf(value['sectionPath'], value['textNodeId']) ||
    !Number.isSafeInteger(value['from']) ||
    !Number.isSafeInteger(value['to']) ||
    (value['from'] as number) < 0 ||
    (value['to'] as number) < (value['from'] as number) ||
    typeof value['insert'] !== 'string'
  ) {
    throw new HwpxEditConflictError('복구 기록의 글자 command 형식이 올바르지 않습니다.')
  }
  if (INVERSE_ONLY_TEXT_OPTIONS.some((key) => value[key] !== undefined)) {
    throw new HwpxEditConflictError('복구 기록의 글자 command에 실행 취소 전용 option이 있습니다.')
  }
}

/**
 * 각주·미주 command 모양. 만들기는 그 section의 실제 `hp:t` anchor(`#hp:t:N`, 합성 caret 아님)와 0 이상 정수 offset, 지우기는 그
 * section의 각주(미주) 경로(`#hp:footNote:K`·`#hp:endNote:K`)와 selection 기준 anchor다. anchor·각주가 실제로 있는지와 번호 표시를
 * 둘 수 있는 문단인지는 적용할 때 편집 코어가 본다.
 */
function assertFootnoteCommandShape(
  command: Extract<EditCommand, { type: 'insert-footnote' | 'delete-footnote' | 'insert-endnote' | 'delete-endnote' }>
): void {
  const value = command as unknown as Record<string, unknown>
  const sectionPath = value['sectionPath']
  const textNodeId = value['textNodeId']
  const valid =
    typeof sectionPath === 'string' &&
    /^Contents\/section\d+\.xml$/.test(sectionPath) &&
    typeof textNodeId === 'string' &&
    isTextAnchorOf(sectionPath, textNodeId) &&
    (command.type === 'insert-footnote' || command.type === 'insert-endnote'
      ? textNodeId.startsWith(`${sectionPath}#hp:t:`) && Number.isSafeInteger(value['offset']) && (value['offset'] as number) >= 0
      : typeof value['notePath'] === 'string' &&
        (command.type === 'delete-footnote'
          ? parseFootnotePath(sectionPath, value['notePath'])
          : parseEndnotePath(sectionPath, value['notePath'])) !== undefined)
  if (!valid) throw new HwpxEditConflictError('복구 기록의 각주·미주 command 형식이 올바르지 않습니다.')
}

/**
 * 복구 기록의 transaction 하나를 replay해도 되는지 확인한다. 통과하지 못하면 HwpxEditConflictError를 던지고,
 * replay는 그 기록 전체를 실패(격리)로 처리한다. 적용 때 하는 검사(expected fragment 일치, selection, revision)는 그대로 돈다.
 * `sourcePackage`는 이 transaction을 적용할 package다. 표 변경 조각 command를 확인하려면 있어야 한다.
 */
export function assertReplayableTransaction(transaction: EditTransaction, sourcePackage?: HwpxSourcePackage): void {
  for (const command of transaction.commands) {
    if (!FORWARD_EDIT_COMMAND_TYPES.has(command.type)) {
      throw new HwpxEditConflictError(`복구 기록에 편집이 만들지 않는 command(${String(command.type)})가 있습니다.`)
    }
    if (command.type === 'replace-text') {
      assertTextCommandShape(command)
    } else if (
      command.type === 'insert-footnote' || command.type === 'delete-footnote' ||
      command.type === 'insert-endnote' || command.type === 'delete-endnote'
    ) {
      assertFootnoteCommandShape(command)
    } else if (command.type === 'replace-paragraph-fragment') {
      assertParagraphReplacement(command.expectedFragment, command.replacementFragment)
    } else if (command.type === 'replace-table-fragment') {
      assertTableReplacement(command.expectedFragment, command.replacementFragment)
    } else if (command.type === 'patch-table-fragment') {
      if (transaction.commands.length !== 1) {
        throw new HwpxEditConflictError('복구 기록의 표 변경 조각은 단독 transaction이어야 합니다.')
      }
      assertTableFragmentPatchShape(command)
      if (!sourcePackage) throw new HwpxEditConflictError('복구 기록의 표 변경 조각을 확인할 문서가 없습니다.')
      const { expectedFragment, replacementFragment } = resolveTableFragmentCommand(sourcePackage, command)
      assertTableReplacement(expectedFragment, replacementFragment)
    }
  }
}
