import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useDocStore } from './store'

// 개별 단락 컴포넌트 (리렌더링 최소화)
const ParagraphItem = React.memo(({ p, sIdx, pIdx, updateParagraph, addParagraph, removeParagraph }: any) => {
  const pRef = useRef<HTMLDivElement>(null)
  const isComposing = useRef(false)

  // 초기 텍스트 설정
  useEffect(() => {
    if (pRef.current && pRef.current.innerText !== (p.content[0] as any)?.text) {
      pRef.current.innerText = (p.content[0] as any)?.text || ''
    }
  }, []) // 처음 한 번만 설정

  const onInput = () => {
    if (!isComposing.current) {
      updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
    }
  }

  const onCompositionStart = () => {
    isComposing.current = true
  }

  const onCompositionEnd = (e: React.CompositionEvent<HTMLDivElement>) => {
    isComposing.current = false
    updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      updateParagraph(sIdx, pIdx, pRef.current?.innerText || '')
      addParagraph(sIdx, pIdx)
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

  // 단락 삭제 후 포커스 이동 관리
  useEffect(() => {
    const paras = document.querySelectorAll('.editable-paragraph')
    // 현재 포커스가 없고 단락이 있다면 마지막 단락에 포커스 (또는 적절한 위치)
    if (document.activeElement?.className !== 'editable-paragraph' && paras.length > 0) {
      // 삭제 로직에서 포커스를 수동으로 잡아주는 것이 더 정확함
    }
  }, [doc.sections[0].paragraphs.length])

  return (
    <div className="app-container">
      <header className="mac-toolbar">
        <div className="toolbar-left">
          <span className="doc-title">{doc.metadata.id}.hwpx</span>
        </div>
        <div className="toolbar-center">
          <button className="tool-btn">글꼴</button>
          <button className="tool-btn">크기</button>
          <button className="tool-btn">정렬</button>
        </div>
        <div className="toolbar-right">
          <button className="save-btn">저장</button>
        </div>
      </header>

      <main className="editor-main">
        <div className="page-scroller">
          {doc.sections.map((section, sIdx) => (
            <div key={sIdx} className="a4-page">
              {section.paragraphs.map((p, pIdx) => (
                <ParagraphItem
                  key={p.id}
                  p={p}
                  sIdx={sIdx}
                  pIdx={pIdx}
                  updateParagraph={updateParagraph}
                  addParagraph={addParagraph}
                  removeParagraph={(s: number, p: number) => {
                    removeParagraph(s, p)
                    // 삭제 후 이전 단락 포커스 로직
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
          ))}
        </div>
      </main>

      <footer className="status-bar">
        <span>쪽: 1 / 1</span>
        <span>글자 수: {doc.sections.reduce((acc, s) => acc + s.paragraphs.reduce((pAcc, p) => pAcc + (p.content[0] as any)?.text.length, 0), 0)}</span>
      </footer>
    </div>
  )
}

export default App
