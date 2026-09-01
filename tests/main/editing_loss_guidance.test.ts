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
})
