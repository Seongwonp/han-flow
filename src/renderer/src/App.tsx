import React, { useState, useRef } from 'react'
import { NormalizedDocument } from '../../shared/types'

function App(): JSX.Element {
  const [doc, setDoc] = useState<NormalizedDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)

  const handleOpenFile = async () => {
    try {
      // @ts-ignore (exposed by preload)
      const filePath = await window.api.openFile()
      if (filePath) {
        await processFile(filePath)
      }
    } catch (error) {
      console.error('Failed to open file:', error)
      alert('파일을 여는 중 오류가 발생했습니다.')
    }
  }

  const processFile = async (filePath: string) => {
    setIsLoading(true)
    try {
      // @ts-ignore (exposed by preload)
      const parsedDoc = await window.api.parseHWPX(filePath)
      setDoc(parsedDoc)
    } catch (error) {
      console.error('Parsing error:', error)
      alert('HWPX 파일을 파싱하는 데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const file = files[0]
      const fileName = file.name.toLowerCase()
      if (fileName.endsWith('.hwpx') || fileName.endsWith('.hwp')) {
        // @ts-ignore (electron file path)
        await processFile(file.path)
      } else {
        alert('HWPX 또는 HWP 파일만 열 수 있습니다.')
      }
    }
  }

  return (
    <div className="app-container" onDragOver={handleDragOver} onDrop={handleDrop}>
      {!doc ? (
        <div className="welcome-screen">
          <h1>Han-Flow</h1>
          <p>macOS Optimized HWPX Editor</p>
          <button className="open-button" onClick={handleOpenFile} disabled={isLoading}>
            {isLoading ? '로딩 중...' : 'HWPX 파일 열기'}
          </button>
          <div className="drop-zone">
            또는 파일을 여기로 드래그하세요
          </div>
        </div>
      ) : (
        <div className="editor-container">
          <header className="editor-header">
            <button onClick={() => setDoc(null)}>닫기</button>
            <span>{doc.metadata.id || '문서'}</span>
          </header>
          <div className="viewer-area" ref={viewerRef}>
            {/* 실제 문서는 여기에 렌더링됨 */}
            {doc.sections.map((section, sIdx) => (
              <div key={sIdx} className="section">
                {section.paragraphs.map((p, pIdx) => (
                  <p key={pIdx} className="paragraph">
                    {p.content.map((c, cIdx) => {
                      if (c.type === 'text') {
                        return <span key={cIdx}>{(c as any).text}</span>
                      }
                      return null
                    })}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
