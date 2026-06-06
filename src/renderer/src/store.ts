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
      id: "p" + Date.now(),
      content: [{ type: "text", text: "", styleId: "0" }]
    });
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
