import { create } from 'zustand'
import { NormalizedDocument, NormalizedParagraph } from '../../shared/types'

interface DocumentState {
  doc: NormalizedDocument;
  setDoc: (doc: NormalizedDocument) => void;
  updateParagraph: (sectionIdx: number, paraIdx: number, content: string) => void;
  createNewDocument: () => void;
}

export const useDocStore = create<DocumentState>((set) => ({
  doc: {
    metadata: { version: "1.0", id: "new-doc" },
    styles: { fontFaces: {}, borderFills: {}, charProperties: {}, paraProperties: {}, tabProperties: {}, numberingPeriods: {}, bullets: {} },
    sections: [{ paragraphs: [{ id: "p1", content: [{ type: "text", text: "", styleId: "0" }] }] }]
  },
  setDoc: (doc) => set({ doc }),
  updateParagraph: (sIdx, pIdx, text) => set((state) => {
    // 이전 텍스트와 동일하면 업데이트 스킵 (리렌더링 방지)
    const currentText = (state.doc.sections[sIdx].paragraphs[pIdx].content[0] as any)?.text;
    if (currentText === text) return state;

    const newSections = [...state.doc.sections];
    const newParagraphs = [...newSections[sIdx].paragraphs];
    newParagraphs[pIdx] = {
      ...newParagraphs[pIdx],
      content: [{ type: "text", text, styleId: newParagraphs[pIdx].content[0]?.styleId || "0" }]
    };
    newSections[sIdx] = { ...newSections[sIdx], paragraphs: newParagraphs };
    return { doc: { ...state.doc, sections: newSections } };
  }),
  addParagraph: (sIdx, pIdx) => set((state) => {
    const newSections = [...state.doc.sections];
    const newParagraphs = [...newSections[sIdx].paragraphs];
    newParagraphs.splice(pIdx + 1, 0, {
      id: "p" + Math.random().toString(36).substr(2, 9),
      content: [{ type: "text", text: "", styleId: "0" }]
    });
    newSections[sIdx] = { ...newSections[sIdx], paragraphs: newParagraphs };
    return { doc: { ...state.doc, sections: newSections } };
  }),
  removeParagraph: (sIdx, pIdx) => set((state) => {
    const newSections = [...state.doc.sections];
    const newParagraphs = [...newSections[sIdx].paragraphs];
    
    // 최소 한 개의 단락은 유지
    if (newParagraphs.length <= 1) return state;
    
    newParagraphs.splice(pIdx, 1);
    newSections[sIdx] = { ...newSections[sIdx], paragraphs: newParagraphs };
    return { doc: { ...state.doc, sections: newSections } };
  }),
  createNewDocument: () => set({
    doc: {
      metadata: { version: "1.0", id: "new-doc-" + Date.now() },
      styles: { fontFaces: {}, borderFills: {}, charProperties: {}, paraProperties: {}, tabProperties: {}, numberingPeriods: {}, bullets: {} },
      sections: [{ paragraphs: [{ id: "p1", content: [{ type: "text", text: "", styleId: "0" }] }] }]
    }
  })
}))
