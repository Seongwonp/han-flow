import type { HwpxSaveLossPolicy } from '../core/editing/loss_policy'

const editedStructureLabels = {
  text: '본문 텍스트',
  'character-style': '글자 모양',
  'paragraph-style': '문단 모양',
  'paragraph-structure': '문단 나누기·병합',
  'table-cell-style': '표 셀 모양',
  'table-structure': '표 행·열 구조'
} as const

export function editingLossPolicyDetail(policy: HwpxSaveLossPolicy): string {
  const structures = policy.structures
    .map(({ structure }) => editedStructureLabels[structure])
    .join(', ')
  const preview = policy.previewStatus === 'stale'
    ? 'Preview 미리보기는 갱신되지 않아 오래된 내용일 수 있습니다.'
    : policy.previewStatus === 'omitted'
      ? '이 문서에는 Preview 미리보기가 없습니다.'
      : 'Preview 미리보기는 현재 본문과 일치합니다.'
  const structureReview = policy.notices.includes('PARAGRAPH_STRUCTURE_CHANGED')
    ? ' 문단 구조가 바뀌었으므로 저장 후 Han-Flow와 한/글에서 재열기를 권장합니다.'
    : ''
  const paragraphStylePreservation = policy.structures.some(
    ({ structure }) => structure === 'paragraph-style'
  )
    ? ' 문단 모양 변경은 기존 탭 정의 참조와 글머리표·번호 매기기 구조를 유지합니다.'
    : ''
  const cellStyleReview = policy.notices.includes('TABLE_CELL_STYLE_CHANGED')
    ? ' 표 셀 모양은 새 borderFill 정의로 격리했으며 저장 후 Han-Flow와 한/글에서 재열기를 권장합니다.'
    : ''
  const tableStructureReview = policy.notices.includes('TABLE_STRUCTURE_CHANGED')
    ? ' 표 행·열 구조가 바뀌었으므로 저장 후 Han-Flow와 한/글에서 표 전체를 확인해 주세요.'
    : ''

  return (
    `현재 변경 구조: ${structures || '없음'}. ` +
    '선택한 구조만 원본 XML에서 수정하며, 손대지 않은 XML·이미지·package 항목은 보존합니다. ' +
    preview + paragraphStylePreservation + structureReview + cellStyleReview + tableStructureReview
  )
}
