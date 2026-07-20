# Han-Flow Vision & Roadmap: The Ultimate macOS HWP Solution

## 🌟 The Vision
Han-Flow is not just another viewer; it is a **Pro-grade HWP/HWPX Editor for macOS** designed to surpass all existing open-source and commercial alternatives. It combines the aesthetic elegance of native macOS applications with the robust document fidelity required for enterprise-level HWP compatibility.

---

## 🚀 The "Greedy" Feature List

### 1. Superior Editing Experience (The "Pro" Core)
- [x] **Uncontrolled Editor Engine**: Perfect cursor management and IME stability (Korean input).
- [x] **Undo/Redo Functionality**: Comprehensive history management for all document changes.
- [ ] **Advanced Equation Suite**: 
    - Real-time KaTeX rendering.
    - Bidirectional conversion: HWP Formula Script $\leftrightarrow$ LaTeX.
    - Visual WYSIWYG equation builder.
- [x] **Complex Table Engine**: 
    - Nested tables, complex cell merging, and multi-page table row splitting.
    - Conditional formatting and Excel-like cell functions.
    - **Implemented**: Cell merging, background color, row/column add/delete.

- [ ] **True Pagination (Page View)**: 
    - Real-time headers, footers, page numbers, and footnotes.
    - Multi-column layout support.

### 2. Perfect Windows Compatibility
- [ ] **100% OWPML (HWPX) Compliance**: Every attribute in the HWPX spec (styles, margins, borders) must be preserved.
- [ ] **Legacy HWP 5.0 Support**: Robust binary parsing using Rust-based backend for older files.
- [ ] **Font Parity**: Intelligent font mapping (e.g., mapping 'Batang' to high-quality macOS equivalents if missing).

### 3. Deep macOS Integration (The "Native" Edge)
- [ ] **Spotlight Search**: Content-level indexing for HWP/HWPX files (find text inside files from macOS search).
- [ ] **Quick Look Plugin**: High-fidelity spacebar previews in Finder.
- [ ] **Apple Silicon Native**: Universal build optimized for M1/M2/M3 chips with minimal RAM footprint.
- [x] **Native Gestures**: Pinch-to-zoom, smooth trackpad scrolling, and Handoff support.
- [x] **macOS native menu bar and shortcut mapping**: Implemented Ctrl/Cmd+A (Select All), Ctrl/Cmd+Z (Undo), Ctrl/Cmd+Y (Redo).

### 4. Hybrid Modern Workflow
- [ ] **Markdown/HTML Bridge**: 
    - Live-sync between HWPX and Markdown.
    - Export to clean, styled HTML5/CSS3.
- [ ] **AI Assistant**: 
    - Built-in LLM for draft generation, summarization, and automated "Hon-Mal" (Honorifics) correction.
- [ ] **Cloud Sync**: Seamless integration with iCloud, Google Drive, and OneDrive.

---

## 🛠️ Implementation Roadmap

### Phase 1: Foundation & Stability (Current)
- [x] Basic Electron + React + Zustand setup.
- [x] HWPX Parsing & Serialization.
- [x] Uncontrolled Input Fixes (No more cursor jumps!).
- [x] Basic Equation Rendering (KaTeX).

### Phase 2: Advanced Formatting
- [x] Table Editor (Cell merging, borders, fills).
- [x] Image & Shape (Drawing) object support.
- [ ] Paragraph Styles (H1, H2, Bullet points) UI integration.

### Phase 3: System Integration
- [x] macOS native menu bar and shortcut mapping.
- [ ] Spotlight indexing implementation.
- [ ] Universal Build (M-series optimization).

### Phase 4: Pro Features
- [ ] Footnotes and Endnotes.
- [ ] AI-assisted writing tools.
- [ ] Multi-document (Tabbed or Windowed) workflow.

---

## ⚖️ Competitive Comparison

| Feature | `rhwp` | `hop` | **Han-Flow** (Goal) |
| :--- | :--- | :--- | :--- |
| **Platform** | Web/WASM | Tauri (Multi) | **macOS Native Focus** |
| **UX Style** | Minimalist | Thin Shell | **Modern Ribbon + Pro UX** |
| **Math** | Static | Basic | **Interactive KaTeX + LaTeX** |
| **Search** | No | Basic | **System Spotlight (Content)** |
| **Layout** | Intermediate | Intermediate | **Advanced (Page View)** |

---

## 📌 Guiding Principles
1. **Never break a file**: Opening and saving an existing HWPX file must result in ZERO data loss of unhandled attributes.
2. **Speed is a feature**: Documents must load instantly; typing must have zero latency.
3. **Mac-First**: If a macOS system feature exists, we should support it.
