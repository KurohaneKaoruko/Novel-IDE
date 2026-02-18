'use client'

import { useState, useCallback } from 'react'
import { analyzeBook, splitBook, extractChapters, type BookAnalysis, type BookSplitResult, type ChapterInfo, type BookSplitConfig } from '../tauri'
import './BookSplitter.css'

type BookSplitterProps = {
  isOpen: boolean
  onClose: () => void
  onInsertChapters?: (chapters: { title: string; content: string }[]) => void
}

export function BookSplitter({ isOpen, onClose, onInsertChapters }: BookSplitterProps) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'analyze' | 'split' | 'extract'>('analyze')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BookAnalysis | BookSplitResult | ChapterInfo[] | null>(null)
  const [config, setConfig] = useState<BookSplitConfig>({
    split_by_chapters: true,
    target_chapter_words: 3000,
    extract_outline: true,
    extract_characters: true,
    extract_settings: true,
    analyze_themes: true,
    analyze_style: true,
  })

  const handleAnalyze = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const analysis = await analyzeBook(content, title || '未命名书籍')
      setResult(analysis)
    } catch (error) {
      console.error('分析失败:', error)
    } finally {
      setLoading(false)
    }
  }, [content, title])

  const handleSplit = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const split = await splitBook(content, title || '未命名书籍', config)
      setResult(split)
    } catch (error) {
      console.error('拆分失败:', error)
    } finally {
      setLoading(false)
    }
  }, [content, title, config])

  const handleExtract = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const chapters = await extractChapters(content)
      setResult(chapters)
    } catch (error) {
      console.error('提取章节失败:', error)
    } finally {
      setLoading(false)
    }
  }, [content])

  const handleInsertChapters = useCallback(() => {
    if (!result || !onInsertChapters) return
    
    if (mode === 'split' && 'chapters' in result) {
      const texts = result.chapters.map(ch => ({ title: ch.title, content: ch.content }))
      onInsertChapters(texts)
      onClose()
    } else if (mode === 'extract' && Array.isArray(result)) {
      const texts = result.map(ch => ({ title: ch.title, content: ch.summary || '' }))
      onInsertChapters(texts)
      onClose()
    }
  }, [result, mode, onInsertChapters, onClose])

  if (!isOpen) return null

  return (
    <div className="book-splitter-overlay" onClick={onClose}>
      <div className="book-splitter" onClick={(e) => e.stopPropagation()}>
        <div className="book-splitter-header">
          <h2>📚 拆书工具</h2>
          <button className="book-splitter-close" onClick={onClose}>×</button>
        </div>

        <div className="book-splitter-content">
          {/* Mode Selection */}
          <div className="book-splitter-modes">
            <button 
              className={`mode-btn ${mode === 'analyze' ? 'active' : ''}`}
              onClick={() => { setMode('analyze'); setResult(null); }}
            >
              📊 分析
            </button>
            <button 
              className={`mode-btn ${mode === 'split' ? 'active' : ''}`}
              onClick={() => { setMode('split'); setResult(null); }}
            >
              ✂️ 拆分
            </button>
            <button 
              className={`mode-btn ${mode === 'extract' ? 'active' : ''}`}
              onClick={() => { setMode('extract'); setResult(null); }}
            >
              📑 提取章节
            </button>
          </div>

          {/* Input */}
          <div className="book-splitter-input">
            <input
              type="text"
              placeholder="书籍标题（可选）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="book-title-input"
            />
            <textarea
              placeholder="粘贴要拆分的文本内容..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="book-content-input"
            />
          </div>

          {/* Config for Split Mode */}
          {mode === 'split' && (
            <div className="book-splitter-config">
              <div className="config-item">
                <label>目标章节字数</label>
                <input
                  type="number"
                  min={500}
                  max={10000}
                  value={config.target_chapter_words}
                  onChange={(e) => setConfig({ ...config, target_chapter_words: parseInt(e.target.value) || 3000 })}
                />
              </div>
            </div>
          )}

          {/* Action Button */}
          <button 
            className="book-splitter-action"
            disabled={!content.trim() || loading}
            onClick={() => {
              if (mode === 'analyze') handleAnalyze()
              else if (mode === 'split') handleSplit()
              else handleExtract()
            }}
          >
            {loading ? '处理中...' : mode === 'analyze' ? '📊 开始分析' : mode === 'split' ? '✂️ 开始拆分' : '📑 提取章节'}
          </button>

          {/* Result */}
          {result && (
            <div className="book-splitter-result">
              {mode === 'analyze' && 'chapters' in result && (
                <div className="result-section">
                  <h3>📊 分析结果</h3>
                  <div className="result-stats">
                    <div className="stat-item">
                      <span className="stat-value">{result.total_words.toLocaleString()}</span>
                      <span className="stat-label">总字数</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{result.chapters.length}</span>
                      <span className="stat-label">章节数</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{result.outline.structure}</span>
                      <span className="stat-label">结构</span>
                    </div>
                  </div>
                  
                  {result.themes.length > 0 && (
                    <div className="result-themes">
                      <h4>主题</h4>
                      <div className="themes-list">
                        {result.themes.map((theme, i) => (
                          <span key={i} className="theme-tag">{theme}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {result.characters.length > 0 && (
                    <div className="result-characters">
                      <h4>人物</h4>
                      <div className="characters-list">
                        {result.characters.slice(0, 5).map((char, i) => (
                          <span key={i} className="character-tag">{char.name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {result.chapters.length > 0 && (
                    <div className="chapters-preview">
                      <h4>章节预览</h4>
                      {result.chapters.slice(0, 10).map((ch) => (
                        <div key={ch.id} className="chapter-item">
                          <span className="chapter-title">{ch.title}</span>
                          <span className="chapter-words">{ch.word_count}字</span>
                        </div>
                      ))}
                      {result.chapters.length > 10 && (
                        <div className="chapters-more">还有 {result.chapters.length - 10} 个章节...</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'split' && 'chapters' in result && (
                <div className="result-section">
                  <h3>✂️ 拆分结果</h3>
                  <div className="result-stats">
                    <div className="stat-item">
                      <span className="stat-value">{result.chapters.length}</span>
                      <span className="stat-label">拆分章节数</span>
                    </div>
                  </div>
                  
                  <div className="chapters-preview">
                    {result.chapters.map((ch) => (
                      <div key={ch.id} className="chapter-item">
                        <span className="chapter-title">{ch.title}</span>
                        <span className="chapter-words">{ch.word_count}字</span>
                      </div>
                    ))}
                  </div>

                  {onInsertChapters && (
                    <button className="insert-btn" onClick={handleInsertChapters}>
                      导入所有章节到项目
                    </button>
                  )}
                </div>
              )}

              {mode === 'extract' && Array.isArray(result) && (
                <div className="result-section">
                  <h3>📑 提取的章节</h3>
                  <div className="result-stats">
                    <div className="stat-item">
                      <span className="stat-value">{result.length}</span>
                      <span className="stat-label">章节数</span>
                    </div>
                  </div>
                  
                  <div className="chapters-preview">
                    {result.map((ch) => (
                      <div key={ch.id} className="chapter-item">
                        <span className="chapter-title">{ch.title}</span>
                        <span className="chapter-words">{ch.word_count}字</span>
                      </div>
                    ))}
                  </div>

                  {onInsertChapters && (
                    <button className="insert-btn" onClick={handleInsertChapters}>
                      导入章节大纲
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
