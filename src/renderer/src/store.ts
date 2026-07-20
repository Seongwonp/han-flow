import { create } from 'zustand'
import { NormalizedDocument, NormalizedParagraph } from '../../shared/types'

interface DocumentState {
  doc: NormalizedDocument;
  isDirty: boolean;
  history: NormalizedDocument[]; // Add history
  historyPointer: number;      // Add historyPointer
  setDoc: (doc: NormalizedDocument) => void;
  setDirty: (dirty: boolean) => void;
  updateParagraph: (sectionIdx: number, paraIdx: number, content: string) => void;
  updateParagraphWithRuns: (sectionIdx: number, paraIdx: number, runs: any[]) => void;
  addParagraph: (sectionIdx: number, paraIdx: number) => string;
  removeParagraph: (sectionIdx: number, paraIdx: number) => void;
  updateParagraphStyle: (sectionIdx: number, paraIdx: number, styleId: string) => void;
  insertTable: (sectionIdx: number, paraIdx: number, rows: number, cols: number) => void;
  addRow: (sectionIdx: number, tableId: string, afterRowIdx: number) => void;
  addColumn: (sectionIdx: number, tableId: string, afterColIdx: number) => void;
  deleteRow: (sectionIdx: number, tableId: string, rowIdx: number) => void;
  deleteColumn: (sectionIdx: number, tableId: string, colIdx: number) => void;
  addEquation: (sectionIdx: number, paraIdx: number, script: string) => void;
  mergeCells: (sectionIdx: number, tableId: string, cellIds: string[]) => void;
  setCellBackgroundColor: (sectionIdx: number, tableId: string, cellIds: string[], color: string) => void;
  addPicture: (sectionIdx: number, paraIdx: number, imageData: { data: string, ext: string }) => void;
  createNewDocument: () => void;
  pushToHistory: (docState: NormalizedDocument) => void; // Add pushToHistory
  undo: () => void; // Add undo
  redo: () => void; // Add redo
}

export const useDocStore = create<DocumentState>((set, get) => ({
  doc: {
    metadata: { version: "1.0", id: "new-doc" },
    styles: { fontFaces: {}, borderFills: {}, charProperties: {}, paraProperties: {}, tabProperties: {}, numberingPeriods: {}, bullets: {} },
    binData: {},
    sections: [{ paragraphs: [{ id: "p1", styleId: "0", content: [{ type: "text", text: "", styleId: "0" }] }] }]
  },
  isDirty: false,
  history: [], // Initialize history
  historyPointer: -1, // Initialize historyPointer

  setDoc: (doc) => set((state) => {
    state.pushToHistory(state.doc); // Save current state before setting new doc
    return { doc, isDirty: false };
  }),
  setDirty: (isDirty) => set({ isDirty }),

  pushToHistory: (docState) => set((state) => {
    const { history, historyPointer } = state;
    // If we are not at the end of history, truncate it
    const newHistory = history.slice(0, historyPointer + 1);
    newHistory.push(JSON.parse(JSON.stringify(docState))); // Deep copy to avoid mutation issues
    // Limit history size to prevent excessive memory usage
    const MAX_HISTORY_SIZE = 100;
    if (newHistory.length > MAX_HISTORY_SIZE) {
      newHistory.shift(); // Remove the oldest state
    }
    return {
      history: newHistory,
      historyPointer: newHistory.length - 1,
      isDirty: true, // Any change makes it dirty
    };
  }),

  undo: () => set((state) => {
    const { history, historyPointer } = state;
    if (historyPointer > 0) {
      const newPointer = historyPointer - 1;
      return {
        doc: JSON.parse(JSON.stringify(history[newPointer])), // Restore previous state
        historyPointer: newPointer,
        isDirty: true,
      };
    }
    return state; // No undo possible
  }),

  redo: () => set((state) => {
    const { history, historyPointer } = state;
    if (historyPointer < history.length - 1) {
      const newPointer = historyPointer + 1;
      return {
        doc: JSON.parse(JSON.stringify(history[newPointer])), // Restore next state
        historyPointer: newPointer,
        isDirty: true,
      };
    }
    return state; // No redo possible
  }),

  // All state-modifying functions need to call pushToHistory first
  updateParagraph: (sIdx, pIdx, text) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const section = state.doc.sections[sIdx];
    if (!section) return state;
    const currentPara = section.paragraphs[pIdx];
    if (!currentPara) return state;
    
    if (currentPara.content.length === 1 && currentPara.content[0].type === 'text' && currentPara.content[0].text === text) {
      return state;
    }

    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      return {
        ...s,
        paragraphs: s.paragraphs.map((p, j) => {
          if (j !== pIdx) return p;
          return {
            ...p,
            content: [{ type: "text", text, styleId: p.content[0]?.styleId || "0" }]
          };
        })
      };
    });

    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  updateParagraphWithRuns: (sIdx: number, pIdx: number, runs: any[]) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      return {
        ...s,
        paragraphs: s.paragraphs.map((p, j) => {
          if (j !== pIdx) return p;
          return { ...p, content: runs };
        })
      };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  updateParagraphStyle: (sIdx, pIdx, styleId) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      return {
        ...s,
        paragraphs: s.paragraphs.map((p, j) => {
          if (j !== pIdx) return p;
          return { ...p, styleId };
        })
      };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  insertTable: (sIdx, pIdx, rows, cols) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      
      const tableCells: any[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: any[] = [];
        for (let c = 0; c < cols; c++) {
          row.push({
            id: `cell-${Date.now()}-${r}-${c}`,
            colSpan: 1,
            rowSpan: 1,
            styleId: "0",
            paragraphs: [{
              id: `p-cell-${Date.now()}-${r}-${c}`,
              styleId: "0",
              content: [{ type: "text", text: "", styleId: "0" }]
            }]
          });
        }
        tableCells.push(row);
      }

      const tableBlock = {
        id: `tbl-${Date.now()}`,
        styleId: "0",
        content: [{
          type: "table",
          id: `table-${Date.now()}`,
          width: 15000,
          height: 0,
          colCount: cols,
          rowCount: rows,
          cells: tableCells
        }]
      };

      const newParagraphs = [...s.paragraphs];
      newParagraphs.splice(pIdx + 1, 0, tableBlock as any);
      return { ...s, paragraphs: newParagraphs };
    });
    
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  addRow: (sIdx, tableId, afterRowIdx) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tableId) as any;
        if (!tableContent) return p;

        const newRow: any[] = [];
        const colCount = tableContent.cells[0].length;
        for (let c = 0; c < colCount; c++) {
          newRow.push({
            id: `cell-${Date.now()}-new-${c}`,
            colSpan: 1,
            rowSpan: 1,
            styleId: "0",
            paragraphs: [{
              id: `p-cell-${Date.now()}-new-${c}`,
              styleId: "0",
              content: [{ type: "text", text: "", styleId: "0" }]
            }]
          });
        }

        const newCells = [...tableContent.cells];
        newCells.splice(afterRowIdx + 1, 0, newRow);

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tableId ? { ...c, cells: newCells, rowCount: newCells.length } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  addColumn: (sIdx, tableId, afterColIdx) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tableId) as any;
        if (!tableContent) return p;

        const newCells = tableContent.cells.map((row: any[], rIdx: number) => {
          const newCell = {
            id: `cell-${Date.now()}-${rIdx}-new`,
            colSpan: 1,
            rowSpan: 1,
            styleId: "0",
            paragraphs: [{
              id: `p-cell-${Date.now()}-${rIdx}-new`,
              styleId: "0",
              content: [{ type: "text", text: "", styleId: "0" }]
            }]
          };
          const newRow = [...row];
          newRow.splice(afterColIdx + 1, 0, newCell);
          return newRow;
        });

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tableId ? { ...c, cells: newCells, colCount: newCells[0].length } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  deleteRow: (sIdx, tableId, rowIdx) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tableId) as any;
        if (!tableContent || tableContent.cells.length <= 1) return p; // Prevent deleting the last row

        const newCells = [...tableContent.cells];
        newCells.splice(rowIdx, 1);

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tableId ? { ...c, cells: newCells, rowCount: newCells.length } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  deleteColumn: (sIdx, tableId, colIdx) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tableId) as any;
        if (!tableContent || tableContent.cells[0].length <= 1) return p; // Prevent deleting the last column

        const newCells = tableContent.cells.map((row: any[]) => {
          const newRow = [...row];
          newRow.splice(colIdx, 1);
          return newRow;
        });

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tableId ? { ...c, cells: newCells, colCount: newCells[0].length } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  addParagraph: (sIdx, pIdx) => {
    const newId = "p" + Math.random().toString(36).substr(2, 9);
    set((state) => {
      state.pushToHistory(state.doc); // Save current state
      const newSections = state.doc.sections.map((s, i) => {
        if (i !== sIdx) return s;
        const newParagraphs = [...s.paragraphs];
        newParagraphs.splice(pIdx + 1, 0, {
          id: newId,
          styleId: "0",
          content: [{ type: "text", text: "", styleId: "0" }]
        });
        return { ...s, paragraphs: newParagraphs };
      });
      return { doc: { ...state.doc, sections: newSections }, isDirty: true };
    });
    return newId; // Return the actual newId
  },
  removeParagraph: (sIdx, pIdx) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      if (s.paragraphs.length <= 1) return s;
      const newParagraphs = s.paragraphs.filter((_, j) => j !== pIdx);
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  addEquation: (sIdx, pIdx, script) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p, j) => {
        if (j !== pIdx) return p;
        return {
          ...p,
          content: [...p.content, { type: "equation", id: `eq-${Date.now()}`, script, styleId: p.styleId || "0" }]
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  mergeCells: (sIdx, tblId, cellIds) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tblId) as any;
        if (!tableContent) return p;

        const targetCells: any[] = [];
        tableContent.cells.forEach((row: any[]) => {
          row.forEach(cell => {
            if (cellIds.includes(cell.id)) targetCells.push(cell);
          });
        });

        if (targetCells.length < 2) return p;

        const firstCell = targetCells[0];
        const mergedParagraphs = targetCells.flatMap(c => c.paragraphs);
        
        const newCells = tableContent.cells.map((row: any[]) => 
          row.filter(cell => !cellIds.includes(cell.id) || cell.id === firstCell.id)
             .map(cell => {
               if (cell.id === firstCell.id) {
                 return { ...cell, paragraphs: mergedParagraphs }; 
               }
               return cell;
             })
        ).filter((row: any[]) => row.length > 0);

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tblId ? { ...c, cells: newCells } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  setCellBackgroundColor: (sIdx, tblId, cellIds, color) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p) => {
        const tableContent = p.content.find(c => c.type === 'table' && (c as any).id === tblId) as any;
        if (!tableContent) return p;

        const newCells = tableContent.cells.map((row: any[]) => 
          row.map(cell => {
            if (cellIds.includes(cell.id)) {
              return { ...cell, backgroundColor: color };
            }
            return cell;
          })
        );

        return {
          ...p,
          content: p.content.map(c => (c as any).id === tblId ? { ...c, cells: newCells } : c)
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });
    return { doc: { ...state.doc, sections: newSections }, isDirty: true };
  }),
  addPicture: (sIdx, pIdx, { data, ext }) => set((state) => {
    state.pushToHistory(state.doc); // Save current state
    const binDataId = `bin-${Date.now()}`;
    const newBinData = {
      ...state.doc.binData,
      [binDataId]: { data, ext, mime: `image/${ext === 'jpg' ? 'jpeg' : ext}` }
    };

    const newSections = state.doc.sections.map((s, i) => {
      if (i !== sIdx) return s;
      const newParagraphs = s.paragraphs.map((p, j) => {
        if (j !== pIdx) return p;
        return {
          ...p,
          content: [...p.content, { 
            type: "image", 
            id: `img-${Date.now()}`, 
            binDataId, 
            width: 100, 
            height: 100, 
            styleId: "0" 
          } as any]
        };
      });
      return { ...s, paragraphs: newParagraphs };
    });

    return { doc: { ...state.doc, binData: newBinData, sections: newSections }, isDirty: true };
  }),
  createNewDocument: () => set((state) => {
    state.pushToHistory(state.doc); // Save current state before creating new doc
    return {
      doc: {
        metadata: { version: "1.0", id: "new-doc-" + Date.now() },
        styles: { fontFaces: {}, borderFills: {}, charProperties: {}, paraProperties: {}, tabProperties: {}, numberingPeriods: {}, bullets: {} },
        binData: {},
        sections: [{ paragraphs: [{ id: "p1", styleId: "0", content: [{ type: "text", text: "", styleId: "0" }] }] }]
      },
      isDirty: false
    };
  })
}));
