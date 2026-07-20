import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useDocStore } from './store'
import { generateGlobalStyles, StyleResolver } from '../../core/renderer-engine/renderer'
import { 
  FaSave, FaFolderOpen, FaFileMedical, FaBold, FaItalic, FaUnderline, 
  FaStrikethrough, FaAlignLeft, FaAlignCenter, FaAlignRight, FaTable, FaImage,
  FaShareAlt, FaPrint, FaRegClipboard, FaCut, FaFont, FaFillDrip, FaHighlighter,
  FaCogs, FaSearch, FaShieldAlt, FaChartBar, FaFileAlt, FaPlus, FaMinus
} from 'react-icons/fa'

import 'katex/dist/katex.min.css'
import katex from 'katex'

// 한글 수식 스크립트를 LaTeX로 변환하는 유틸리티
const hwpScriptToLatex = (hwpScript: string) => {
  if (!hwpScript) return '';
  let latex = hwpScript
    .replace(/OVER/g, ' \\over ')
    .replace(/SQRT/g, '\\sqrt')
    .replace(/SUM/g, '\\sum')
    .replace(/INT/g, '\\int')
    .replace(/alpha/g, '\\alpha')
    .replace(/beta/g, '\\beta')
    .replace(/gamma/g, '\\gamma')
    .replace(/delta/g, '\\delta')
    .replace(/epsilon/g, '\\epsilon')
    .replace(/zeta/g, '\\zeta')
    .replace(/eta/g, '\\eta')
    .replace(/theta/g, '\\theta')
    .replace(/iota/g, '\\iota')
    .replace(/kappa/g, '\\kappa')
    .replace(/lambda/g, '\\lambda')
    .replace(/mu/g, '\\mu')
    .replace(/nu/g, '\\nu')
    .replace(/xi/g, '\\xi')
    .replace(/omicron/g, '\\omicron')
    .replace(/pi/g, '\\pi')
    .replace(/rho/g, '\\rho')
    .replace(/sigma/g, '\\sigma')
    .replace(/tau/g, '\\tau')
    .replace(/upsilon/g, '\\upsilon')
    .replace(/phi/g, '\\phi')
    .replace(/chi/g, '\\chi')
    .replace(/psi/g, '\\psi')
    .replace(/omega/g, '\\omega')
    .replace(/LEFT/g, '\\left')
    .replace(/RIGHT/g, '\\right')
    .replace(/times/g, '\\times')
    .replace(/div/g, '\\div')
    .replace(/matrix/g, '\\begin{matrix}')
    .replace(/#/g, '\\\\')
    .replace(/&/g, '&')
    .replace(/{/g, '{')
    .replace(/}/g, '}')
  
  return latex
}

// 수식 변환 및 렌더링 컴포넌트
const EquationRenderer = ({ script }: { script: string }) => {
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      try {
        katex.render(hwpScriptToLatex(script), containerRef.current, {
          throwOnError: false,
          displayMode: false
        })
      } catch (err) {
        containerRef.current.innerText = script
      }
    }
  }, [script])

  return <span ref={containerRef} className="hwp-equation" contentEditable={false} />
}

// 수식 편집기 모달 컴포넌트
const EquationEditorModal = ({ isOpen, onClose, onSave, initialScript = '' }: any) => {
  const [script, setScript] = useState(initialScript)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (previewRef.current) {
      try {
        katex.render(hwpScriptToLatex(script), previewRef.current, {
          throwOnError: false,
          displayMode: true
        })
      } catch (e) {}
    }
  }, [script])

  if (!isOpen) return null

  const templates = [
    { name: '분수', script: 'a OVER b' },
    { name: '루트', script: 'SQRT{x}' },
    { name: '합계', script: 'SUM_{i=1}^{n} a_i' },
    { name: '적분', script: 'INT_{a}^{b} f(x)dx' },
    { name: '그리스', script: 'alpha + beta = gamma' },
    { name: '행렬', script: 'matrix{a&b#c&d}' },
    { name: '리미트', script: 'lim_{n -> INF}' }
  ]

  return (
    <div className="modal-overlay">
      <div className="modal-content equation-editor">
        <div className="modal-header">
          <h3>수식 편집기</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="template-grid">
            {templates.map(t => (
              <button key={t.name} className="template-item" onClick={() => setScript(s => s + ' ' + t.script)}>
                {t.name}
              </button>
            ))}
          </div>
          <textarea 
            className="script-input"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="한글 수식 스크립트를 입력하세요..."
          />
          <div className="preview-label">미리보기</div>
          <div ref={previewRef} className="math-preview"></div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>취소</button>
          <button className="btn-save" onClick={() => { onSave(script); onClose(); }}>문서에 삽입</button>
        </div>
      </div>
    </div>
  )
}

// 이미지 렌더링 컴포넌트
const ImageRenderer = ({ img, binData }: { img: any, binData: any }) => {
  const data = binData[img.binDataId];
  if (!data) return <div className="hwp-image-placeholder">이미지를 찾을 수 없음</div>;

  return (
    <div 
      className="hwp-image-wrapper" 
      style={{ width: img.width + 'mm', height: img.height + 'mm' }}
    >
      <img 
        src={`data:${data.mime};base64,${data.data}`} 
        alt="HWP Image" 
        style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
      />
    </div>
  );
}

// 테이블 렌더링 컴포넌트
const TableRenderer = ({ tbl, updateParagraph, updateParagraphWithRuns, addParagraph, removeParagraph, updateParagraphStyle, insertTable, sIdx, onSelectionChange, binData, addRow, addColumn, deleteRow, deleteColumn }: any) => {
  const [selectedCells, setSelectedCells] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, rowIdx: number, colIdx: number } | null>(null)
  const { mergeCells } = useDocStore()

  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(tbl.id, selectedCells)
    }
  }, [selectedCells, tbl.id, onSelectionChange])

  const onCellClick = (e: React.MouseEvent, cellId: string) => {
    if (e.shiftKey) {
      setSelectedCells(prev => prev.includes(cellId) ? prev.filter(id => id !== cellId) : [...prev, cellId])
    } else {
      setSelectedCells([cellId])
    }
  }

  const handleContextMenu = (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx })
  }

  const onMerge = () => {
    if (selectedCells.length > 1) {
      mergeCells(sIdx, tbl.id, selectedCells)
      setSelectedCells([])
    }
    setContextMenu(null)
  }

  const onAddRow = (after: boolean) => {
    if (contextMenu) {
      addRow(sIdx, tbl.id, after ? contextMenu.rowIdx : contextMenu.rowIdx - 1);
    }
    setContextMenu(null);
  };

  const onAddColumn = (after: boolean) => {
    if (contextMenu) {
      addColumn(sIdx, tbl.id, after ? contextMenu.colIdx : contextMenu.colIdx - 1);
    }
    setContextMenu(null);
  };

  const onDeleteRow = () => {
    if (contextMenu) {
      deleteRow(sIdx, tbl.id, contextMenu.rowIdx);
    }
    setContextMenu(null);
  };

  const onDeleteColumn = () => {
    if (contextMenu) {
      deleteColumn(sIdx, tbl.id, contextMenu.colIdx);
    }
    setContextMenu(null);
  };

  return (
    <div className="table-wrapper" onClick={() => setContextMenu(null)}>
      <table 
        className="hwp-table" 
        style={{ width: tbl.width > 0 ? tbl.width / 100 + 'mm' : '100%' }}
      >
        <tbody>
          {tbl.cells.map((row: any, rIdx: number) => (
            <tr key={rIdx}>
              {row.map((cell: any, colIdx: number) => (
                <td 
                  key={cell.id} 
                  className={`hwp-td ${selectedCells.includes(cell.id) ? 'selected' : ''}`}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  style={{ backgroundColor: cell.backgroundColor || 'transparent' }}
                  onClick={(e) => onCellClick(e, cell.id)}
                  onContextMenu={(e) => handleContextMenu(e, rIdx, colIdx)}
                >
                  {cell.paragraphs.map((para: any, pIdx: number) => (
                    <ParagraphItem
                      key={para.id}
                      p={para}
                      sIdx={sIdx}
                      pIdx={pIdx}
                      updateParagraph={updateParagraph}
                      updateParagraphWithRuns={updateParagraphWithRuns}
                      addParagraph={addParagraph}
                      updateParagraphStyle={updateParagraphStyle}
                      insertTable={insertTable}
                      removeParagraph={removeParagraph}
                      binData={binData}
                    />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {contextMenu && (
        <div className="slash-menu" style={{ top: contextMenu.y, left: contextMenu.x, position: 'fixed' }}>
          {selectedCells.length > 1 && <div className="menu-item" onClick={onMerge}>셀 병합</div>}
          <div className="menu-item" onClick={() => onAddRow(false)}>위에 줄 추가</div>
          <div className="menu-item" onClick={() => onAddRow(true)}>아래에 줄 추가</div>
          <div className="menu-item" onClick={() => onAddColumn(false)}>왼쪽에 칸 추가</div>
          <div className="menu-item" onClick={() => onAddColumn(true)}>오른쪽에 칸 추가</div>
          <div className="menu-item" onClick={onDeleteRow}>줄 삭제</div>
          <div className="menu-item" onClick={onDeleteColumn}>칸 삭제</div>
          <div className="menu-item" onClick={() => setContextMenu(null)}>취소</div>
        </div>
      )}
    </div>
  )
}

// 개별 단락 컴포넌트
const ParagraphItem = React.memo(({ p, sIdx, pIdx, updateParagraph, updateParagraphWithRuns, addParagraph, removeParagraph, updateParagraphStyle, insertTable, binData }: any) => {
  const pRef = useRef<HTMLDivElement>(null)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const isComposing = useRef(false)
  const isFocused = useRef(false)
  // 마지막으로 동기화된 문서 ID와 내용을 추적하여 불필요한 초기화를 방지
  const lastDocId = useRef(p.id)
  
  // 현재 단락의 HTML을 생성하는 헬퍼
  const getHTMLContent = useCallback(() => {
    if (p.content.length === 0) return ""
    return p.content.map((c: any) => {
      if (c.type === 'text') {
        return `<span class="char-style-${c.styleId}">${c.text || ''}</span>`
      } else if (c.type === 'equation') {
        return `<span class="hwp-equation" data-script="${c.script}" contenteditable="false"></span>`
      } else if (c.type === 'image') {
        return `<span class="hwp-image-placeholder" data-img-id="${c.id}" data-bin-id="${c.binDataId}" data-width="${c.width}" data-height="${c.height}" contenteditable="false"></span>`
      }
      return ""
    }).join('')
  }, [p.content])

  // DOM 구조를 분석하여 HWPX Run 배열로 변환
  const syncDOMToRuns = useCallback(() => {
    if (!pRef.current) return;
    
    const runs: any[] = [];
    const nodes = Array.from(pRef.current.childNodes);
    
    if (nodes.length === 0) {
      runs.push({ type: 'text', text: "", styleId: "0" });
    } else {
      nodes.forEach(node => {
        if (node.nodeType === 3) {
          runs.push({ type: 'text', text: node.textContent || "", styleId: "0" });
        } else if (node.nodeType === 1) {
          const el = node as HTMLElement;
          if (el.classList.contains('hwp-equation')) {
            runs.push({
              type: 'equation',
              id: `eq-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              script: el.getAttribute('data-script') || "",
              styleId: p.styleId || "0"
            });
          } else if (el.classList.contains('hwp-image-placeholder')) {
            runs.push({
              type: 'image',
              id: el.getAttribute('data-img-id') || `img-${Date.now()}`,
              binDataId: el.getAttribute('data-bin-id') || "0",
              width: parseInt(el.getAttribute('data-width') || "100"),
              height: parseInt(el.getAttribute('data-height') || "100"),
              styleId: p.styleId || "0"
            });
          } else {
            let charStyleId = "0";
            const charMatch = Array.from(el.classList).find(c => c.startsWith('char-style-'));
            if (charMatch) charStyleId = charMatch.replace('char-style-', '');
            
            runs.push({ 
              type: 'text', 
              text: el.innerText || "", 
              styleId: charStyleId 
            });
          }
        }
      });
    }

    updateParagraphWithRuns(sIdx, pIdx, runs);
  }, [sIdx, pIdx, p.styleId, updateParagraphWithRuns]);

  // 외부(다른 단락 편집 등)에 의해 상태가 변했을 때만 DOM 업데이트
  useEffect(() => {
    if (pRef.current && !isFocused.current) {
      const html = getHTMLContent()
      if (pRef.current.innerHTML !== html || lastDocId.current !== p.id) {
        pRef.current.innerHTML = html
        lastDocId.current = p.id
        
        // 수식 렌더링 강제 트리거
        pRef.current.querySelectorAll('.hwp-equation').forEach((el: any) => {
          const script = el.getAttribute('data-script');
          if (script) {
            try {
              katex.render(hwpScriptToLatex(script), el, { throwOnError: false });
            } catch (e) {}
          }
        });

        // 이미지 렌더링 강제 트리거
        pRef.current.querySelectorAll('.hwp-image-placeholder').forEach((el: any) => {
          const binId = el.getAttribute('data-bin-id');
          const width = el.getAttribute('data-width');
          const height = el.getAttribute('data-height');
          const data = binData[binId];
          if (data) {
            el.innerHTML = `<img src="data:${data.mime};base64,${data.data}" style="width:${width}mm;height:${height}mm;object-fit:contain;" />`;
          }
        });
      }
    }
  }, [p.id, p.content, getHTMLContent, binData])

  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    // 입력 중에는 절대로 syncDOMToRuns를 호출하지 않음 (상태 업데이트 -> 리렌더링 -> 커서 유실 루프 차단)
    const text = pRef.current?.innerText || ''
    
    // 슬래시 메뉴 표시 여부만 로컬 상태로 관리
    if (text.endsWith('/') || text.endsWith('#')) {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) { 
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        setMenuPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX })
        setShowSlashMenu(true)
      }
    } else if (showSlashMenu) {
      setShowSlashMenu(false)
    }
  }

  const handleBlockConvert = (text: string) => {
    if (text.startsWith('# ')) {
      updateParagraphStyle(sIdx, pIdx, 'h1')
      const newText = text.substring(2)
      if (pRef.current) pRef.current.innerText = newText
      return true
    } else if (text.startsWith('## ')) {
      updateParagraphStyle(sIdx, pIdx, 'h2')
      const newText = text.substring(3)
      if (pRef.current) pRef.current.innerText = newText
      return true
    } else if (text.startsWith('- ') || text.startsWith('* ')) {
      updateParagraphStyle(sIdx, pIdx, 'bullet')
      const newText = text.substring(2)
      if (pRef.current) pRef.current.innerText = newText
      return true
    }
    return false
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const text = pRef.current?.innerText || ''
      handleBlockConvert(text)
      e.preventDefault()
      
      // 엔터를 누르는 순간 지금까지의 내용을 글로벌 상태에 저장
      syncDOMToRuns()
      
      const newId = addParagraph(sIdx, pIdx)
      setTimeout(() => {
        const nextPara = document.querySelector(`[data-id="${newId}"]`) as HTMLElement
        if (nextPara) nextPara.focus()
      }, 10)
    } else if (e.key === 'Backspace') {
      const text = pRef.current?.innerText || ''
      if (text === '') {
        if (p.styleId !== '0') {
          e.preventDefault()
          updateParagraphStyle(sIdx, pIdx, '0')
        } else if (pIdx > 0) {
          e.preventDefault()
          // 삭제 전 위 문단으로 포커스 이동을 위해 sync 생략 혹은 선행 처리
          removeParagraph(sIdx, pIdx)
        }
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const selection = window.getSelection()
      if (!selection) return
      
      // 위/아래 이동 시 현재 내용을 저장하여 데이터 유실 방지
      if (e.key === 'ArrowUp' && selection.anchorOffset === 0) {
        if (pIdx > 0) {
          e.preventDefault()
          syncDOMToRuns() 
          const allParas = document.querySelectorAll('.editable-paragraph')
          const prevPara = allParas[pIdx - 1] as HTMLElement
          if (prevPara) {
            prevPara.focus()
            const range = document.createRange()
            range.selectNodeContents(prevPara)
            range.collapse(false)
            selection.removeAllRanges()
            selection.addRange(range)
          }
        }
      } else if (e.key === 'ArrowDown') {
        const textLength = pRef.current?.innerText.length || 0
        if (selection.anchorOffset === textLength) {
          const allParas = document.querySelectorAll('.editable-paragraph')
          if (pIdx < allParas.length - 1) {
            e.preventDefault()
            syncDOMToRuns()
            const nextPara = allParas[pIdx + 1] as HTMLElement
            if (nextPara) {
              nextPara.focus()
              const range = document.createRange()
              range.selectNodeContents(nextPara)
              range.collapse(true)
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }
        }
      }
    }
  }

  const selectFromMenu = (type: string) => {
    if (!pRef.current) return;
    const currentText = pRef.current.innerText;
    let newText = currentText;

    if (type === 'table') {
      insertTable(sIdx, pIdx, 3, 3); // 기본 3x3 테이블 삽입
      newText = currentText.replace(/(\/|#)$/, ''); // 슬래시 또는 샵 제거
    } else if (type === 'h1') {
      updateParagraphStyle(sIdx, pIdx, 'h1');
      newText = currentText.replace(/(\/|#)$/, '# ');
    } else if (type === 'h2') {
      updateParagraphStyle(sIdx, pIdx, 'h2');
      newText = currentText.replace(/(\/|#)$/, '## ');
    } else if (type === 'bullet') {
      updateParagraphStyle(sIdx, pIdx, 'bullet');
      newText = currentText.replace(/(\/|#)$/, '- ');
    } else if (type === 'code') {
      updateParagraphStyle(sIdx, pIdx, 'code');
      newText = currentText.replace(/(\/|#)$/, '```');
    }

    if (pRef.current) {
      pRef.current.innerText = newText;
      // 커서를 텍스트 끝으로 이동
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(pRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setShowSlashMenu(false);
  };

  return (
    <div className="paragraph-container" style={{ position: 'relative' }}>
      <div
        ref={pRef}
        data-id={p.id}
        className={`editable-paragraph para-style-${p.styleId}`}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onFocus={() => { isFocused.current = true }}
        onBlur={() => { 
          isFocused.current = false; 
          syncDOMToRuns(); // 포커스 나갈 때 최종 저장
        }}
        onCompositionStart={() => { isComposing.current = true }}
        onCompositionEnd={() => { isComposing.current = false }}
        onKeyDown={onKeyDown}
      >
      </div>
      
      {showSlashMenu && (
        <div className="slash-menu" style={{ top: menuPos.top - 100, left: menuPos.left }}>
          <div className="menu-item" onClick={() => selectFromMenu('h1')}>제목 1</div>
          <div className="menu-item" onClick={() => selectFromMenu('h2')}>제목 2</div>
          <div className="menu-item" onClick={() => selectFromMenu('bullet')}>글머리 기호</div>
          <div className="menu-item" onClick={() => selectFromMenu('code')}>코드 블록</div>
          <div className="menu-item" onClick={() => selectFromMenu('table')}>표 만들기</div>
        </div>
      )}
    </div>
  )
})

function App(): JSX.Element {
  const { doc, isDirty, setDoc, updateParagraph, updateParagraphWithRuns, addParagraph, removeParagraph, updateParagraphStyle, insertTable, addRow, addColumn, deleteRow, deleteColumn, addEquation, mergeCells, setCellBackgroundColor, addPicture, createNewDocument, undo, redo } = useDocStore()
  const [activeTab, setActiveTab] = useState('편집')
  const [fonts, setFonts] = useState<string[]>(['함초롬바탕', 'Pretendard'])
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [formatState, setFormatState] = useState({ bold: false, italic: false, underline: false, strike: false, fontSize: '11', fontName: '함초롬바탕' })
  const [isEquationModalOpen, setIsEquationModalOpen] = useState(false)
  const [activeTableInfo, setActiveTableInfo] = useState<{ id: string, selectedCells: string[] } | null>(null)
  
  // HWPX 스타일을 위한 전역 스타일 생성
  const globalStyles = useMemo(() => generateGlobalStyles(doc), [doc]);

  const handleInsertImage = async () => {
    try {
      // @ts-ignore
      const result = await window.api.openImage()
      if (result) {
        // 첫 번째 섹션의 첫 번째 단락에 삽입 (추후 포커스 위치에 삽입하도록 고도화 필요)
        addPicture(0, 0, { data: result.data, ext: result.ext })
      }
    } catch (e) {
      console.error(e)
      alert('이미지를 불러오는 중 오류가 발생했습니다.')
    }
  }

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      let container = range.commonAncestorContainer as HTMLElement;
      if (container.nodeType === 3) container = container.parentElement!;

      // 부모 요소들을 거슬러 올라가며 클래스(char-style-*) 찾기
      let current = container;
      let foundCharStyleId = "0";
      let foundParaStyleId = "0";

      while (current && current.classList) {
        const charMatch = Array.from(current.classList).find(c => c.startsWith('char-style-'));
        if (charMatch) foundCharStyleId = charMatch.replace('char-style-', '');
        
        const paraMatch = Array.from(current.classList).find(c => c.startsWith('para-style-'));
        if (paraMatch) foundParaStyleId = paraMatch.replace('para-style-', '');
        
        if (foundCharStyleId !== "0" && foundParaStyleId !== "0") break;
        current = current.parentElement!;
      }

      // HWPX 모델 스타일 정보 가져오기
      const charPr = doc.styles.charProperties[foundCharStyleId];
      
      setFormatState({
        bold: charPr?.["@_bold"] === "1" || document.queryCommandState('bold'),
        italic: charPr?.["@_italic"] === "1" || document.queryCommandState('italic'),
        underline: (charPr?.["@_underline"] && charPr["@_underline"] !== "none") || document.queryCommandState('underline'),
        strike: (charPr?.["@_strikeout"] && charPr["@_strikeout"] !== "none") || document.queryCommandState('strikeThrough'),
        fontSize: charPr?.["@_height"] ? (parseInt(charPr["@_height"]) / 100).toString() : '11',
        fontName: charPr?.["@_fontRef"] ? doc.styles.fontFaces[charPr["@_fontRef"]]?.["@_name"] : '함초롬바탕'
      })
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [doc])

  useEffect(() => {
    const init = async () => {
      try {
        // @ts-ignore
        const systemFonts = await window.api.getFonts()
        setFonts(systemFonts)
      } catch (e) { console.error(e) }
      if (!doc || doc.metadata.id === "new-doc") createNewDocument()
      setTimeout(() => {
        const firstPara = document.querySelector('.editable-paragraph') as HTMLElement
        if (firstPara) firstPara.focus()
      }, 500)
    }
    init()
  }, [])

  // Keyboard shortcuts for Undo/Redo/Select All
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+A (Cmd+A on Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allEditableParagraphs = document.querySelectorAll('.editable-paragraph');
        if (allEditableParagraphs.length > 0) {
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            const range = document.createRange();
            const firstPara = allEditableParagraphs[0];
            const lastPara = allEditableParagraphs[allEditableParagraphs.length - 1];

            // Set start of range to the beginning of the first paragraph
            range.setStart(firstPara, 0);

            // Set end of range to the end of the last paragraph
            // Check if lastPara has childNodes, otherwise use the element itself
            if (lastPara.childNodes.length > 0) {
              range.setEnd(lastPara.childNodes[lastPara.childNodes.length - 1], lastPara.childNodes[lastPara.childNodes.length - 1].textContent?.length || 0);
            } else {
              range.setEnd(lastPara, lastPara.textContent?.length || 0);
            }
            selection.addRange(range);
          }
        }
      }
      // Ctrl+Z (Cmd+Z on Mac)
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      // Ctrl+Y (Cmd+Y on Mac)
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [undo, redo]); // Add undo, redo to dependency array


  const handleOpenFile = async () => {
    if (isDirty) {
      // @ts-ignore
      const res = await window.api.confirmSave()
      if (res === 0) await handleSave()
      else if (res === 2) return
    }
    try {
      // @ts-ignore
      const filePath = await window.api.openFile()
      if (!filePath) return
      // @ts-ignore
      const openMode = await window.api.askOpenMode()
      if (openMode === 2) return
      if (openMode === 1) {
        // @ts-ignore
        await window.api.openNewWindow()
        return
      }
      // @ts-ignore
      const normalizedDoc = await window.api.parseHWPX(filePath)
      setDoc(normalizedDoc)
      setCurrentFilePath(filePath)
    } catch (error) {
      alert('파일을 여는 중 오류가 발생했습니다.')
    }
  }

  const handleNewDocument = async () => {
    if (isDirty) {
      // @ts-ignore
      const res = await window.api.confirmSave()
      if (res === 0) await handleSave()
      else if (res === 2) return
    }
    createNewDocument()
    setCurrentFilePath(null)
  }

  const handleSave = async () => {
    if (!currentFilePath) return handleSaveAs()
    try {
      // @ts-ignore
      const success = await window.api.saveHWPX(currentFilePath, doc)
      if (success) alert('저장되었습니다!')
    } catch (error) { 
      console.error(error);
      alert('저장 중 오류가 발생했습니다.') 
    }
  }

  const handleSaveAs = async () => {
    try {
      // @ts-ignore
      const filePath = await window.api.saveFile()
      if (filePath) {
        // @ts-ignore
        const success = await window.api.saveHWPX(filePath, doc)
        if (success) {
          setCurrentFilePath(filePath)
          alert('다른 이름으로 저장되었습니다!')
        }
      }
    } catch (error) { 
      console.error(error);
      alert('저장 중 오류가 발생했습니다.') 
    }
  }

  const execCommand = (cmd: string, val: string = '') => {
    document.execCommand(cmd, false, val)
  }

  return (
    <div className="app-container">
      <style>{globalStyles}</style>
      <header className="hwp-header">
        <div className="system-bar">
          <div className="window-controls">
            <span className="control close"></span>
            <span className="control minimize"></span>
            <span className="control maximize"></span>
          </div>
          <div className="app-title-container">
            <span className="app-logo">HF</span>
            <span className="doc-title">{currentFilePath ? currentFilePath.split('/').pop() : '제목_없음'}.hwpx - Han-Flow</span>
          </div>
          <div className="system-actions">
            <button className="sys-btn" onClick={handleSave}><FaSave /> 저장</button>
            <button className="sys-btn" onClick={handleOpenFile}><FaFolderOpen /> 열기</button>
          </div>
        </div>
        
        <nav className="ribbon-tabs">
          {['파일', '편집', '보기', '입력', '서식', '쪽', '검토', '도구'].map(tab => (
            <button 
              key={tab} 
              className={`tab-item ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="ribbon-content">
          {activeTab === '파일' && (
            <>
              <div className="ribbon-group-vertical">
                <div className="ribbon-group-horizontal">
                  <button className="ribbon-btn-large" onClick={handleNewDocument}>
                    <FaFileMedical className="icon-main" />
                    <span>새 문서</span>
                  </button>
                  <button className="ribbon-btn-large" onClick={handleOpenFile}>
                    <FaFolderOpen className="icon-main" />
                    <span>불러오기</span>
                  </button>
                </div>
                <div className="ribbon-group-title">기본 작업</div>
              </div>
              <div className="ribbon-group-vertical">
                <div className="ribbon-group-horizontal">
                  <button className="ribbon-btn-large" onClick={handleSave}>
                    <FaSave className="icon-main" />
                    <span>저장</span>
                  </button>
                  <button className="ribbon-btn-large" onClick={handleSaveAs}>
                    <FaShareAlt className="icon-main" />
                    <span>다른 이름</span>
                  </button>
                </div>
                <div className="ribbon-group-title">저장/공유</div>
              </div>
            </>
          )}
          
          {activeTab === '편집' && (
            <>
              <div className="ribbon-group-vertical">
                <div className="ribbon-group-horizontal">
                  <button className="ribbon-btn-large">
                    <FaRegClipboard className="icon-main" />
                    <span>붙여넣기</span>
                  </button>
                  <div className="ribbon-group">
                    <button className="ribbon-btn"><FaCut /> 오려 두기</button>
                  </div>
                </div>
                <div className="ribbon-group-title">클립보드</div>
              </div>
              
              <div className="ribbon-group-vertical">
                <div className="ribbon-row">
                  <select className="font-select" value={formatState.fontName} onChange={(e) => execCommand('fontName', e.target.value)}>
                    <option value="함초롬바탕">함초롬바탕</option>
                    {fonts.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select className="size-select" value={Math.round(parseFloat(formatState.fontSize)).toString()} onChange={(e) => execCommand('fontSize', e.target.value)}>
                    {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 32, 48].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="ribbon-row">
                  <button className={`ribbon-btn ${formatState.bold ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); execCommand('bold') }}><FaBold /></button>
                  <button className={`ribbon-btn ${formatState.italic ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); execCommand('italic') }}><FaItalic /></button>
                  <button className={`ribbon-btn ${formatState.underline ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); execCommand('underline') }}><FaUnderline /></button>
                  <button className={`ribbon-btn ${formatState.strike ? 'active' : ''}`} onMouseDown={(e) => { e.preventDefault(); execCommand('strikeThrough') }}><FaStrikethrough /></button>
                  <div className="v-divider"></div>
                  <div className="ribbon-group-row" style={{ display: 'flex', gap: '4px' }}>
                    <input type="color" className="color-picker" onChange={(e) => execCommand('foreColor', e.target.value)} title="글자 색" />
                    <input type="color" className="color-picker highlight" onChange={(e) => execCommand('hiliteColor', e.target.value)} title="형광펜" defaultValue="#ffff00" />
                  </div>
                </div>
                <div className="ribbon-group-title">글자 모양</div>
              </div>

              <div className="ribbon-group-vertical">
                <div className="ribbon-row" style={{ justifyContent: 'center' }}>
                  <button className="ribbon-btn" onClick={() => execCommand('justifyLeft')}><FaAlignLeft /></button>
                  <button className="ribbon-btn" onClick={() => execCommand('justifyCenter')}><FaAlignCenter /></button>
                  <button className="ribbon-btn" onClick={() => execCommand('justifyRight')}><FaAlignRight /></button>
                </div>
                <div className="ribbon-group-title">문단 모양</div>
              </div>
            </>
          )}

          {activeTab === '입력' && (
            <>
              <div className="ribbon-group-vertical">
                <div className="ribbon-group-horizontal">
                  <button className="ribbon-btn-large" onClick={() => insertTable(0, 0, 5, 5)}>
                    <FaTable className="icon-main" />
                    <span>표 만들기</span>
                  </button>
                  <button className="ribbon-btn-large" onClick={() => setIsEquationModalOpen(true)}>
                    <FaFont className="icon-main" />
                    <span>수식</span>
                  </button>
                </div>
                <div className="ribbon-group-title">표/수식</div>
              </div>

              {activeTableInfo && (
                <div className="ribbon-group-vertical">
                  <div className="ribbon-group-horizontal">
                    <div className="ribbon-row">
                      <FaFillDrip style={{ color: '#004696' }} />
                      <input 
                        type="color" 
                        className="color-picker" 
                        title="셀 배경색" 
                        onChange={(e) => setCellBackgroundColor(0, activeTableInfo.id, activeTableInfo.selectedCells, e.target.value)}
                      />
                    </div>
                    <div className="ribbon-row">
                      <button className="ribbon-btn" onClick={() => addRow(0, activeTableInfo.id, activeTableInfo.selectedCells.length > 0 ? parseInt(activeTableInfo.selectedCells[0].split('-')[2]) : 0)}><FaPlus /> 줄 추가</button>
                      <button className="ribbon-btn" onClick={() => deleteRow(0, activeTableInfo.id, activeTableInfo.selectedCells.length > 0 ? parseInt(activeTableInfo.selectedCells[0].split('-')[2]) : 0)}><FaMinus /> 줄 삭제</button>
                    </div>
                    <div className="ribbon-row">
                      <button className="ribbon-btn" onClick={() => addColumn(0, activeTableInfo.id, activeTableInfo.selectedCells.length > 0 ? parseInt(activeTableInfo.selectedCells[0].split('-')[3]) : 0)}><FaPlus /> 칸 추가</button>
                      <button className="ribbon-btn" onClick={() => deleteColumn(0, activeTableInfo.id, activeTableInfo.selectedCells.length > 0 ? parseInt(activeTableInfo.selectedCells[0].split('-')[3]) : 0)}><FaMinus /> 칸 삭제</button>
                    </div>
                  </div>
                  <div className="ribbon-group-title">표 도구</div>
                </div>
              )}

              <div className="ribbon-group-vertical">
                <div className="ribbon-group-horizontal">
                  <button className="ribbon-btn-large" onClick={handleInsertImage}>
                    <FaImage className="icon-main" />
                    <span>그림</span>
                  </button>
                </div>
                <div className="ribbon-group-title">개체</div>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="editor-main hwp-mode">
        <div className="page-scroller" key={currentFilePath || 'new'}>
          {doc.sections.map((section, sIdx) => (
            <div key={sIdx} className="a4-page-container">
              <div className="a4-page">
                {section.paragraphs.map((p, pIdx) => (
                  <React.Fragment key={p.id}>
                    {p.content.some(c => c.type === 'table') ? (
                      p.content.filter(c => c.type === 'table').map((tbl: any) => (
                        <TableRenderer 
                          key={tbl.id} 
                          tbl={tbl} 
                          updateParagraph={updateParagraph}
                          updateParagraphWithRuns={updateParagraphWithRuns}
                          addParagraph={addParagraph}
                          updateParagraphStyle={updateParagraphStyle}
                          insertTable={insertTable}
                          removeParagraph={removeParagraph}
                          sIdx={sIdx}
                          binData={doc.binData}
                          onSelectionChange={(tblId: string, cellIds: string[]) => {
                            if (cellIds.length > 0) {
                              setActiveTableInfo({ id: tblId, selectedCells: cellIds })
                            } else if (activeTableInfo?.id === tblId) {
                              setActiveTableInfo(null)
                            }
                          }}
                          addRow={addRow}
                          addColumn={addColumn}
                          deleteRow={deleteRow}
                          deleteColumn={deleteColumn}
                        />
                      ))
                    ) : (
                      <ParagraphItem
                        p={p}
                        sIdx={sIdx}
                        pIdx={pIdx}
                        updateParagraph={updateParagraph}
                        updateParagraphWithRuns={updateParagraphWithRuns}
                        addParagraph={addParagraph}
                        updateParagraphStyle={updateParagraphStyle}
                        insertTable={insertTable}
                        binData={doc.binData}
                        removeParagraph={(s: number, pI: number) => {
                          removeParagraph(s, pI)
                          setTimeout(() => {
                            const allParas = document.querySelectorAll('.editable-paragraph')
                            const prevPara = allParas[pI - 1] as HTMLElement
                            if (prevPara) {
                              prevPara.focus()
                              const range = document.createRange()
                              const sel = window.getSelection()
                              range.selectNodeContents(prevPara)
                              range.collapse(false)
                              sel?.removeAllRanges()
                              sel?.addRange(range)
                            }
                          }, 0)
                        }}
                      />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="status-bar">
        <div className="status-left">
          <span>쪽 1 / 1</span>
          <span className="separator">|</span>
          <span>글자 수 생략</span>
        </div>
        <div className="status-right">
          <span>한국어</span>
          <span className="zoom-level">100%</span>
        </div>
      </footer>

      <EquationEditorModal 
        isOpen={isEquationModalOpen} 
        onClose={() => setIsEquationModalOpen(false)}
        onSave={(script: string) => addEquation(0, 0, script)}
      />
    </div>
  )
}

export default App
