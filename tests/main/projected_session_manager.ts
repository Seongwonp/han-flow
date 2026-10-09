import type { ViewerDocument } from '../../src/core/document/viewer_document'
import { applyViewerDocumentPatch } from '../../src/core/document/viewer_document_patch'
import type { EditingActionResult } from '../../src/core/editing/editing_contract'
import type { EditingSessionManager } from '../../src/main/editing_session'

type Materialized<Result> = Result extends EditingActionResult ? Result & { document: ViewerDocument } : Result

/** `EditingSessionManager`와 같은 method를 가지되 편집 결과에 renderer처럼 patch를 적용한 전체 `document`를 붙인다. */
export type ProjectedEditingSessionManager = {
  [Key in keyof EditingSessionManager]: EditingSessionManager[Key] extends (...args: infer Args) => Promise<infer Result>
    ? (...args: Args) => Promise<Materialized<Result>>
    : EditingSessionManager[Key]
}

/**
 * renderer(`App.tsx`)가 하는 일을 test에서 흉내 낸다. 창(sender)마다 마지막 projection을 기억하고, 편집 결과가 patch면
 * `baseProjectionId`가 기억한 projection과 같은지 확인한 뒤 적용한다. 결과에는 그렇게 만든 전체 문서를 `document`로 붙인다.
 */
export function projectedSessionManager(manager: EditingSessionManager): ProjectedEditingSessionManager {
  const projections = new Map<number, { projectionId: number; document: ViewerDocument }>()
  const materialize = (senderId: number, value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value
    const result = value as Partial<EditingActionResult> & { projectionId?: number }
    if (result.patch) {
      const current = projections.get(senderId)
      if (!current || current.projectionId !== result.patch.baseProjectionId) {
        throw new Error(`편집 projection patch 기준이 다릅니다: ${current?.projectionId} → ${result.patch.baseProjectionId}`)
      }
      const document = applyViewerDocumentPatch(current.document, result.patch)
      projections.set(senderId, { projectionId: result.patch.projectionId, document })
      return { ...result, document }
    }
    if (result.document && typeof result.projectionId === 'number') {
      projections.set(senderId, { projectionId: result.projectionId, document: result.document })
    }
    return value
  }
  return new Proxy(manager, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver)
      if (typeof member !== 'function') return member
      return (...args: unknown[]) => {
        const returned = member.apply(target, args)
        return returned instanceof Promise && typeof args[0] === 'number'
          ? returned.then((value) => materialize(args[0] as number, value))
          : returned
      }
    }
  }) as unknown as ProjectedEditingSessionManager
}
