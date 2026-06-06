import React, { useEffect, useRef } from 'react'
import { useDocStore } from './store'

function App(): JSX.Element {
  const { doc, updateParagraph, createNewDocument } = useDocStore()
  const editorRef = useRef<HTMLDivElement>(null)

  // 초기 로드 시 새 문서 생성
  useEffect(() => {
    if (!doc || doc.metadata.id === "new-doc") {
      createNewDocument()
    }
  }, [])

  const handleInput = (sIdx: number, pIdx: number, e: React.FormEvent<HTMLParagraphElement>) => {
    const text = e.currentTarget.innerText
    updateParagraph(sIdx, pIdx, text)
  }

  const handleKeyDown = (sIdx: number, pIdx: number, e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // @ts-ignore
      useDocStore.getState().addParagraph(sIdx, pIdx)
      // 다음 요소로 포커스 이동은 React의 리렌더링 이후 처리 필요
    }
  }

  return (
    <div className="app-container">
      {/* macOS 스타일 상단 툴바 */}
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

      {/* 메인 에디터 영역 */}
      <main className="editor-main">
        <div className="page-scroller">
          {doc.sections.map((section, sIdx) => (
            <div key={sIdx} className="a4-page">
              {section.paragraphs.map((p, pIdx) => (
                <div
                  key={pIdx}
                  className="editable-paragraph"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(e) => handleInput(sIdx, pIdx, e)}
                  onKeyDown={(e) => handleKeyDown(sIdx, pIdx, e)}
                  data-placeholder="내용을 입력하세요..."
                >
                  {p.content.map((c, cIdx) => (
                    c.type === 'text' ? (c as any).text : null
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>

      {/* 하단 상태바 */}
      <footer className="status-bar">
        <span>쪽: 1 / 1</span>
        <span>글자 수: {doc.sections.reduce((acc, s) => acc + s.paragraphs.reduce((pAcc, p) => pAcc + (p.content[0] as any)?.text.length, 0), 0)}</span>
      </footer>
    </div>
  )
}

export default App
