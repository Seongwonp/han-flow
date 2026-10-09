import type { ViewerDiagnostic, ViewerDocument, ViewerSection } from './viewer_document'

/** header.xml에서 오는 style map. 글자·문단·셀 모양 command가 header.xml을 바꿨을 때만 patch에 담는다. */
export type ViewerStyleMaps = Pick<ViewerDocument, 'fonts' | 'charStyles' | 'paraStyles' | 'cellStyles'>

/**
 * 편집 projection 증분. 바로 앞 projection(`baseProjectionId`)에 적용하면 새 projection(`projectionId`)과 같은 문서가 된다.
 * 바뀌지 않은 section·style map·쪽 크기·그림 resource는 앞 문서의 object를 그대로 쓴다(React memo가 건너뛰도록).
 */
export interface ViewerDocumentPatch {
  baseProjectionId: number
  projectionId: number
  /** 새 문서의 section 수. 앞 문서와 다르면 patch로 만들지 않는다(전체 문서를 보낸다). */
  sectionCount: number
  sections: Array<{ index: number; section: ViewerSection }>
  styles?: ViewerStyleMaps
  /** 문서 전체 진단(작다). section 진단이 바뀔 수 있어 항상 통째로 보낸다. */
  diagnostics: ViewerDiagnostic[]
}

export class ViewerDocumentPatchMismatchError extends Error {
  readonly code = 'VIEWER_DOCUMENT_PATCH_MISMATCH'
}

/** `document`에 patch를 불변 방식으로 적용한다. 바뀐 section만 새 object가 되고 나머지는 그대로 공유한다. */
export function applyViewerDocumentPatch(document: ViewerDocument, patch: ViewerDocumentPatch): ViewerDocument {
  if (document.sections.length !== patch.sectionCount) {
    throw new ViewerDocumentPatchMismatchError('편집 projection section 수가 현재 문서와 다릅니다.')
  }
  const sections = document.sections.slice()
  for (const { index, section } of patch.sections) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= sections.length) {
      throw new ViewerDocumentPatchMismatchError('편집 projection section 위치가 현재 문서와 맞지 않습니다.')
    }
    sections[index] = section
  }
  return {
    page: document.page,
    fonts: patch.styles?.fonts ?? document.fonts,
    charStyles: patch.styles?.charStyles ?? document.charStyles,
    paraStyles: patch.styles?.paraStyles ?? document.paraStyles,
    cellStyles: patch.styles?.cellStyles ?? document.cellStyles,
    resources: document.resources,
    sections,
    diagnostics: patch.diagnostics
  }
}
