import { Dispatch, useReducer } from 'react'
import {
  documentStateReducer,
  editingStateReducer,
  initialDocumentState,
  initialEditingState,
  initialViewerState,
  RendererDocumentState,
  RendererEditingState,
  RendererViewerState,
  SliceAction,
  SliceUpdate,
  viewerStateReducer
} from './renderer_state'

function setField<State, Key extends keyof State>(
  dispatch: Dispatch<SliceAction<State>>,
  key: Key,
  update: SliceUpdate<State[Key]>
): void {
  dispatch({ type: 'set', key, update } as SliceAction<State>)
}

export function useRendererState() {
  const [documentState, documentDispatch] = useReducer(documentStateReducer, initialDocumentState)
  const [viewerState, viewerDispatch] = useReducer(viewerStateReducer, initialViewerState)
  const [editingState, editingDispatch] = useReducer(editingStateReducer, initialEditingState)

  return {
    ...documentState,
    ...viewerState,
    editing: editingState.session,
    editingSelection: editingState.selection,
    editingPending: editingState.pending,
    editingStatus: editingState.status,
    editingSelectionNotice: editingState.selectionNotice,
    setDocument: (update: SliceUpdate<RendererDocumentState['document']>) =>
      setField(documentDispatch, 'document', update),
    setFixedDocument: (update: SliceUpdate<RendererDocumentState['fixedDocument']>) =>
      setField(documentDispatch, 'fixedDocument', update),
    setFileName: (update: SliceUpdate<RendererDocumentState['fileName']>) =>
      setField(documentDispatch, 'fileName', update),
    setOpenedPath: (update: SliceUpdate<RendererDocumentState['openedPath']>) =>
      setField(documentDispatch, 'openedPath', update),
    setError: (update: SliceUpdate<RendererDocumentState['error']>) =>
      setField(documentDispatch, 'error', update),
    setErrorCode: (update: SliceUpdate<RendererDocumentState['errorCode']>) =>
      setField(documentDispatch, 'errorCode', update),
    setLoading: (update: SliceUpdate<RendererDocumentState['loading']>) =>
      setField(documentDispatch, 'loading', update),
    setFontResolutions: (update: SliceUpdate<RendererDocumentState['fontResolutions']>) =>
      setField(documentDispatch, 'fontResolutions', update),
    setLoadTiming: (update: SliceUpdate<RendererDocumentState['loadTiming']>) =>
      setField(documentDispatch, 'loadTiming', update),
    setSectionProgress: (update: SliceUpdate<RendererDocumentState['sectionProgress']>) =>
      setField(documentDispatch, 'sectionProgress', update),
    setBackgroundError: (update: SliceUpdate<RendererDocumentState['backgroundError']>) =>
      setField(documentDispatch, 'backgroundError', update),
    setZoom: (update: SliceUpdate<RendererViewerState['zoom']>) =>
      setField(viewerDispatch, 'zoom', update),
    setOverflowPages: (update: SliceUpdate<RendererViewerState['overflowPages']>) =>
      setField(viewerDispatch, 'overflowPages', update),
    setPrinting: (update: SliceUpdate<RendererViewerState['printing']>) =>
      setField(viewerDispatch, 'printing', update),
    setPdfStatus: (update: SliceUpdate<RendererViewerState['pdfStatus']>) =>
      setField(viewerDispatch, 'pdfStatus', update),
    setVisibleRange: (update: SliceUpdate<RendererViewerState['visibleRange']>) =>
      setField(viewerDispatch, 'visibleRange', update),
    setFixedPrintPages: (update: SliceUpdate<RendererViewerState['fixedPrintPages']>) =>
      setField(viewerDispatch, 'fixedPrintPages', update),
    setFixedFirstPageReady: (update: SliceUpdate<RendererViewerState['fixedFirstPageReady']>) =>
      setField(viewerDispatch, 'fixedFirstPageReady', update),
    setFixedFollowingPagesEnabled: (
      update: SliceUpdate<RendererViewerState['fixedFollowingPagesEnabled']>
    ) => setField(viewerDispatch, 'fixedFollowingPagesEnabled', update),
    setSearchOpen: (update: SliceUpdate<RendererViewerState['searchOpen']>) =>
      setField(viewerDispatch, 'searchOpen', update),
    setSearchQuery: (update: SliceUpdate<RendererViewerState['searchQuery']>) =>
      setField(viewerDispatch, 'searchQuery', update),
    setSearchResults: (update: SliceUpdate<RendererViewerState['searchResults']>) =>
      setField(viewerDispatch, 'searchResults', update),
    setActiveSearchResult: (update: SliceUpdate<RendererViewerState['activeSearchResult']>) =>
      setField(viewerDispatch, 'activeSearchResult', update),
    setSearching: (update: SliceUpdate<RendererViewerState['searching']>) =>
      setField(viewerDispatch, 'searching', update),
    setLayoutMeasurements: (update: SliceUpdate<RendererViewerState['layoutMeasurements']>) =>
      setField(viewerDispatch, 'layoutMeasurements', update),
    setEditing: (update: SliceUpdate<RendererEditingState['session']>) =>
      setField(editingDispatch, 'session', update),
    setEditingSelection: (update: SliceUpdate<RendererEditingState['selection']>) =>
      setField(editingDispatch, 'selection', update),
    setEditingPending: (update: SliceUpdate<RendererEditingState['pending']>) =>
      setField(editingDispatch, 'pending', update),
    setEditingStatus: (update: SliceUpdate<RendererEditingState['status']>) =>
      setField(editingDispatch, 'status', update),
    setEditingSelectionNotice: (
      update: SliceUpdate<RendererEditingState['selectionNotice']>
    ) => setField(editingDispatch, 'selectionNotice', update),
    resetEditing: () => editingDispatch({ type: 'reset' })
  }
}
