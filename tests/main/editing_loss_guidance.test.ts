import { editingLossPolicyDetail } from '../../src/main/editing_loss_guidance'

describe('editing loss policy user guidance', () => {
  test('변경 구조와 Preview stale, 손대지 않은 package 보존을 함께 알린다', () => {
    const detail = editingLossPolicyDetail({
      structures: [
        {
          structure: 'text',
          preservation: 'targeted-source-edit',
          compatibilityRisk: 'low'
        },
        {
          structure: 'paragraph-structure',
          preservation: 'targeted-source-edit',
          compatibilityRisk: 'review'
        }
      ],
      untouchedContent: 'preserved',
      previewStatus: 'stale',
      notices: ['PREVIEW_STALE', 'PARAGRAPH_STRUCTURE_CHANGED'],
      reviewRecommended: true
    })

    expect(detail).toContain('본문 텍스트, 문단 나누기·병합')
    expect(detail).toContain('손대지 않은 XML·이미지·package 항목은 보존')
    expect(detail).toContain('Preview 미리보기는 갱신되지 않아')
    expect(detail).toContain('한/글에서 재열기')
  })

  test('문단 모양 저장은 탭과 목록 구조 보존 범위를 함께 알린다', () => {
    const detail = editingLossPolicyDetail({
      structures: [
        {
          structure: 'paragraph-style',
          preservation: 'targeted-source-edit',
          compatibilityRisk: 'low'
        }
      ],
      untouchedContent: 'preserved',
      previewStatus: 'omitted',
      notices: ['PREVIEW_OMITTED'],
      reviewRecommended: false
    })

    expect(detail).toContain('문단 모양')
    expect(detail).toContain('기존 탭 정의 참조')
    expect(detail).toContain('글머리표·번호 매기기 구조를 유지')
  })

  test('표 셀 모양 저장은 격리 복제와 재열기 검토를 안내한다', () => {
    const detail = editingLossPolicyDetail({
      structures: [{
        structure: 'table-cell-style',
        preservation: 'targeted-source-edit',
        compatibilityRisk: 'review'
      }],
      untouchedContent: 'preserved',
      previewStatus: 'stale',
      notices: ['PREVIEW_STALE', 'TABLE_CELL_STYLE_CHANGED'],
      reviewRecommended: true
    })

    expect(detail).toContain('표 셀 모양')
    expect(detail).toContain('새 borderFill 정의로 격리')
    expect(detail).toContain('한/글에서 재열기')
  })

  test('표 구조 저장은 표 전체 재열기 확인을 안내한다', () => {
    const detail = editingLossPolicyDetail({
      structures: [{
        structure: 'table-structure',
        preservation: 'targeted-source-edit',
        compatibilityRisk: 'review'
      }],
      untouchedContent: 'preserved',
      previewStatus: 'stale',
      notices: ['PREVIEW_STALE', 'TABLE_STRUCTURE_CHANGED'],
      reviewRecommended: true
    })

    expect(detail).toContain('표 행·열 구조')
    expect(detail).toContain('표 전체를 확인')
  })
})
