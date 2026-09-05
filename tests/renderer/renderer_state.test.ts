import {
  documentStateReducer,
  EditingImeTransientState,
  editingStateReducer,
  initialDocumentState,
  initialEditingState,
  initialViewerState,
  viewerStateReducer
} from '../../src/renderer/src/renderer_state'

describe('renderer state ownership', () => {
  test('문서와 viewer 전이는 서로의 상태를 소유하지 않는다', () => {
    const loading = documentStateReducer(initialDocumentState, {
      type: 'set',
      key: 'loading',
      update: true
    })
    const zoomed = viewerStateReducer(initialViewerState, {
      type: 'set',
      key: 'zoom',
      update: 1.25
    })

    expect(loading).toMatchObject({ loading: true, openedPath: null })
    expect(zoomed).toMatchObject({ zoom: 1.25, searchOpen: false })
    expect(initialDocumentState.loading).toBe(false)
    expect(initialViewerState.zoom).toBe(1)
  })

  test('편집 pending 함수 전이와 reset을 하나의 reducer 계약으로 처리한다', () => {
    const started = editingStateReducer(initialEditingState, {
      type: 'set',
      key: 'session',
      update: {
        sessionId: 'session-1',
        revision: 1,
        savedRevision: 0,
        canUndo: true,
        canRedo: false,
        isDirty: true
      }
    })
    const pending = editingStateReducer(started, {
      type: 'set',
      key: 'pending',
      update: (current) => current + 2
    })
    const settled = editingStateReducer(pending, {
      type: 'set',
      key: 'pending',
      update: (current) => Math.max(0, current - 1)
    })

    expect(settled).toMatchObject({ pending: 1, session: { sessionId: 'session-1' } })
    const selectedCell = editingStateReducer(settled, {
      type: 'set',
      key: 'tableCellSelection',
      update: {
        sectionPath: 'Contents/section0.xml',
        textNodeId: 'Contents/section0.xml#hp:t:0',
        tableId: 'table-0',
        sourceCellId: 'table-0:r0c0',
        row: 0,
        column: 0
      }
    })
    expect(selectedCell.tableCellSelection?.sourceCellId).toBe('table-0:r0c0')
    expect(editingStateReducer(selectedCell, { type: 'reset' })).toEqual(initialEditingState)
  })

  test('IME transient 상태는 render를 기다리지 않고 composing과 최신 session을 제공한다', () => {
    const transient = new EditingImeTransientState()
    const session = {
      sessionId: 'session-2',
      revision: 3,
      savedRevision: 2,
      canUndo: true,
      canRedo: false,
      isDirty: true
    }
    transient.synchronize(session, 2)
    transient.setComposing(true)

    expect(transient.currentSession).toBe(session)
    expect(transient.pendingCount).toBe(2)
    expect(transient.isComposing).toBe(true)
    expect(transient.nextTransactionId('ui')).toBe('ui-1')
    expect(transient.nextTransactionId('ui-range')).toBe('ui-range-2')

    transient.reset()
    expect(transient.currentSession).toBeNull()
    expect(transient.pendingCount).toBe(0)
    expect(transient.isComposing).toBe(false)
    expect(transient.nextTransactionId('ui')).toBe('ui-1')
  })
})
