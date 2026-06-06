import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useDocStore } from './store'

// 개별 단락 컴포넌트
const ParagraphItem = React.memo(({ p, sIdx, pIdx, updateParagraph, addParagraph, removeParagraph }: any) => {
  const pRef = useRef<HTMLDivElement>(null)
  const isComposing = useRef(false)

  useEffect(() => {
    if (pRef.current && pRef.current.innerText !== (p.content[0] as any)?.text) {
      pRef.current.innerText = (p.content[0] as any)?.text || ''
    }
  }, [p.id]) // ID가 바뀔 때(새 단락)만 텍스트 동기화

  const onInput = () => {
    if (!isComposing.current) {
      updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
    }
  }

  const onCompositionStart = () => {
    isComposing.current = true
  }

  const onCompositionEnd = () => {
    isComposing.current = false
    updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // 현재 단락 내용 저장 후 새 단락 추가
      updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
      const newId = addParagraph(sIdx, pIdx)
      
      // 새 단락으로 포커스 이동 (ID 기반)
      setTimeout(() => {
        const nextPara = document.querySelector(`[data-id="${newId}"]`) as HTMLElement
        if (nextPara) {
          nextPara.focus()
        }
      }, 10)
    } else if (e.key === 'Backspace') {
      const text = pRef.current?.innerText || ''
      if (text === '' && pIdx > 0) {
        e.preventDefault()
        removeParagraph(sIdx, pIdx)
      }
    }
  }

  return (
    <div
      ref={pRef}
      data-id={p.id}
      className="editable-paragraph"
      contentEditable
      suppressContentEditableWarning
      onInput={onInput}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onKeyDown={onKeyDown}
      data-placeholder="내용을 입력하세요..."
    />
  )
})

function App(): JSX.Element {
  const { doc, updateParagraph, addParagraph, removeParagraph, createNewDocument } = useDocStore()
  
  useEffect(() => {
    if (!doc || doc.metadata.id === "new-doc") {
      createNewDocument()
    }
  }, [])

  return (
    <div className="app-container">
      {/* macOS Premium Toolbar */}
      <header className="mac-toolbar">
        <div className="toolbar-left">
          <div className="window-controls">
            <span className="control close"></span>
            <span className="control minimize"></span>
            <span className="control maximize"></span>
          </div>
          <span className="doc-title">{doc.metadata.id}.hwpx</span>
        </div>
        <div className="toolbar-center">
          <div className="tool-group">
            <button className="tool-btn-icon"><b>B</b></button>
            <button className="tool-btn-icon"><i>I</i></button>
            <button className="tool-btn-icon"><u>U</u></button>
          </div>
          <div className="divider"></div>
          <div className="tool-group">
            <button className="tool-btn-text">Pretendard</button>
            <button className="tool-btn-text">11pt</button>
          </div>
        </div>
        <div className="toolbar-right">
          <button className="action-btn share">공유</button>
          <button className="action-btn save">저장</button>
        </div>
      </header>

      <main className="editor-main">
        <div className="page-scroller">
          {doc.sections.map((section, sIdx) => (
            <div key={sIdx} className="a4-page-container">
              <div className="a4-page">
                {section.paragraphs.map((p, pIdx) => (
                  <ParagraphItem
                    key={p.id}
                    p={p}
                    sIdx={sIdx}
                    pIdx={pIdx}
                    updateParagraph={updateParagraph}
                    addParagraph={addParagraph}
                    removeParagraph={(s: number, pIdx: number) => {
                      removeParagraph(s, pIdx)
                      setTimeout(() => {
                        const allParas = document.querySelectorAll('.editable-paragraph')
                        const prevPara = allParas[pIdx - 1] as HTMLElement
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
          <span>{doc.sections.reduce((acc, s) => acc + s.paragraphs.reduce((pAcc, p) => pAcc + (p.content[0] as any)?.text.length, 0), 0)} 글자</span>
        </div>
        <div className="status-right">
          <span>한국어</span>
          <span className="zoom-level">100%</span>
        </div>
      </footer>
    </div>
  )
}

export default App
