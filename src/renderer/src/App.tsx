import React, { useState, useEffect, useMemo } from 'react'
import { NormalizedDocument } from '../../shared/types'

function App(): JSX.Element {
  const [doc, setDoc] = useState<NormalizedDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [visibleParagraphs, setVisibleParagraphs] = useState(50) // 초기 표시할 단락 수

  // 문서가 바뀌면 초기화
  useEffect(() => {
    setVisibleParagraphs(50)
  }, [doc])

  const handleOpenFile = async () => {
    try {
      // @ts-ignore
      const filePath = await window.api.openFile()
      if (filePath) await processFile(filePath)
    } catch (error) {
      console.error('Failed to open file:', error)
      alert('파일을 여는 중 오류가 발생했습니다.')
    }
  }

  const processFile = async (filePath: string) => {
    setIsLoading(true)
    try {
      // @ts-ignore
      const parsedDoc = await window.api.parseHWPX(filePath)
      setDoc(parsedDoc)
    } catch (error) {
      console.error('Parsing error:', error)
      alert(`파싱 실패: ${error instanceof Error ? error.message : String(error)}`)
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
        // @ts-ignore
        await processFile(file.path)
      } else {
        alert('HWPX 또는 HWP 파일만 열 수 있습니다.')
      }
    }
  }

  // 스크롤 시 추가 단락 로드 (간단한 무한 스크롤)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop <= clientHeight + 500) {
      setVisibleParagraphs(prev => prev + 50)
    }
  }

  // 표시할 데이터 계산
  const renderedContent = useMemo(() => {
    if (!doc) return null
    let count = 0
    return doc.sections.map((section, sIdx) => {
      if (count >= visibleParagraphs) return null
      const paras = section.paragraphs.slice(0, visibleParagraphs - count)
      count += paras.length
      return (
        <div key={sIdx} className="section">
          {paras.map((p, pIdx) => (
            <p key={pIdx} className="paragraph">
              {p.content.map((c, cIdx) => {
                if (c.type === 'text') return <span key={cIdx}>{(c as any).text}</span>
                if (c.type === 'table') return <div key={cIdx} className="table-placeholder">[표]</div>
                return null
              })}
            </p>
          ))}
        </div>
      )
    })
  }, [doc, visibleParagraphs])

  return (
    <div className="app-container" onDragOver={handleDragOver} onDrop={handleDrop}>
      {!doc ? (
        <div className="welcome-screen">
          <h1>Han-Flow</h1>
          <p>macOS Optimized HWPX Editor</p>
          <button className="open-button" onClick={handleOpenFile} disabled={isLoading}>
            {isLoading ? '로딩 중...' : 'HWPX 파일 열기'}
          </button>
          <div className="drop-zone">또는 파일을 여기로 드래그하세요</div>
        </div>
      ) : (
        <div className="editor-container">
          <header className="editor-header">
            <button onClick={() => setDoc(null)}>닫기</button>
            <span>{doc.metadata.id || '문서'}</span>
          </header>
          <div className="viewer-area" onScroll={handleScroll}>
            {renderedContent}
            {doc.sections.reduce((acc, s) => acc + s.paragraphs.length, 0) > visibleParagraphs && (
              <div className="loading-more">나머지 내용을 불러오는 중...</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
