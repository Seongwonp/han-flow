import React, { useEffect, useRef, useState } from 'react'
import { useDocStore } from './store'

function App(): JSX.Element {
  const { doc, updateParagraph, createNewDocument } = useDocStore()
  const [isComposing, setIsComposing] = useState(false)
  
  // 초기 로드 시 새 문서 생성
  useEffect(() => {
    if (!doc || doc.metadata.id === "new-doc") {
      createNewDocument()
    }
  }, [])

  // 한글 조합 시작
  const handleCompositionStart = () => {
    setIsComposing(true)
  }

  // 한글 조합 종료
  const handleCompositionEnd = (sIdx: number, pIdx: number, e: React.CompositionEvent<HTMLDivElement>) => {
    setIsComposing(false)
    // 조합이 끝난 시점에만 상태 업데이트
    const text = e.currentTarget.innerText
    updateParagraph(sIdx, pIdx, text)
  }

  // 일반 입력 (영문, 숫자 등)
  const handleInput = (sIdx: number, pIdx: number, e: React.FormEvent<HTMLDivElement>) => {
    // 한글 조합 중이 아닐 때만 즉시 업데이트
    if (!isComposing) {
      const text = e.currentTarget.innerText
      updateParagraph(sIdx, pIdx, text)
    }
  }

  const handleKeyDown = (sIdx: number, pIdx: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // @ts-ignore
      useDocStore.getState().addParagraph(sIdx, pIdx)
    } else if (e.key === 'Backspace') {
      const text = e.currentTarget.innerText
      // 단락이 비어있고 첫 번째 단락이 아닐 때 삭제
      if (text === '' && pIdx > 0) {
        e.preventDefault()
        // @ts-ignore
        useDocStore.getState().removeParagraph(sIdx, pIdx)
        
        // 이전 단락으로 포커스 이동 (비동기 처리)
        setTimeout(() => {
          const paras = document.querySelectorAll('.editable-paragraph')
          const prevPara = paras[pIdx - 1] as HTMLElement
          if (prevPara) {
            prevPara.focus()
            // 커서를 끝으로 이동
            const range = document.createRange()
            const sel = window.getSelection()
            range.selectNodeContents(prevPara)
            range.collapse(false)
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        }, 0)
      }
    }
  }

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
                <div
                  key={p.id} // ID를 key로 사용
                  className="editable-paragraph"
                  contentEditable
                  suppressContentEditableWarning
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={(e) => handleCompositionEnd(sIdx, pIdx, e)}
                  onInput={(e) => handleInput(sIdx, pIdx, e)}
                  onKeyDown={(e) => handleKeyDown(sIdx, pIdx, e)}
                  data-placeholder="내용을 입력하세요..."
                >
                  {/* 초기 렌더링 시에만 값을 넣어주고 이후에는 브라우저가 관리하게 함 */}
                  {p.content.map((c) => (c.type === 'text' ? (c as any).text : null))}
                </div>
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
