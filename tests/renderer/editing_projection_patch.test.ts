import type { ViewerDocument, ViewerSection } from '../../src/core/document/viewer_document'
import {
  applyViewerDocumentPatchIfCurrent,
  type ViewerDocumentPatch
} from '../../src/core/document/viewer_document_patch'

// renderer(App.tsx)가 편집 결과 patch를 적용하는 규칙. 맞지 않는 patch는 편집 실패가 아니라 refresh 신호(undefined)다.
const section = (name: string) => ({ name } as unknown as ViewerSection)
const document: ViewerDocument = {
  page: { width: 10000, height: 10000, margin: { top: 0, right: 0, bottom: 0, left: 0 }, headerOffset: 0, footerOffset: 0 },
  fonts: {}, charStyles: {}, paraStyles: {}, cellStyles: {}, resources: {}, diagnostics: [],
  sections: [section('a'), section('b')]
}
const patch = (overrides: Partial<ViewerDocumentPatch> = {}): ViewerDocumentPatch => ({
  baseProjectionId: 3,
  projectionId: 4,
  sectionCount: 2,
  sections: [{ index: 1, section: section('b2') }],
  diagnostics: [],
  ...overrides
})

describe('편집 projection patch 적용', () => {
  test('기준 projection이 같고 모양이 맞으면 바뀐 section만 새로 적용한다', () => {
    const next = applyViewerDocumentPatchIfCurrent(document, 3, patch())!
    expect(next.sections[0]).toBe(document.sections[0])
    expect(next.sections[1]).toEqual(section('b2'))
  })

  test('기준이 다르거나 section 수·위치가 맞지 않으면 다시 맞추라고(undefined) 알린다', () => {
    expect(applyViewerDocumentPatchIfCurrent(null, 3, patch())).toBeUndefined()
    expect(applyViewerDocumentPatchIfCurrent(document, 2, patch())).toBeUndefined()
    // ViewerDocumentPatchMismatchError: 예전에는 편집 실패(recoverEditingFailure)로 흘러 화면을 다시 맞추지 않았다.
    expect(applyViewerDocumentPatchIfCurrent(document, 3, patch({ sectionCount: 3 }))).toBeUndefined()
    expect(applyViewerDocumentPatchIfCurrent(document, 3, patch({ sections: [{ index: 5, section: section('x') }] })))
      .toBeUndefined()
  })
})
