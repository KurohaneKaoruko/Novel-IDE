'use client'

import { useMemo } from 'react'
import './StatusBar.css'

export type StatusBarInfo = {
  fileName?: string
  filePath?: string
  language?: string
  lineCount?: number
  charCount?: number
  wordCount?: number
  chapterTarget?: number
  currentChapter?: string
  gitBranch?: string
  gitStatus?: 'clean' | 'modified' | 'staged'
  theme?: 'light' | 'dark'
}

type StatusBarProps = {
  info: StatusBarInfo
  onThemeToggle?: () => void
  onGitClick?: () => void
}

export function StatusBar({ info, onThemeToggle, onGitClick }: StatusBarProps) {
  const wordCountText = useMemo(() => {
    if (!info.wordCount) return ''
    const w = info.wordCount.toLocaleString()
    if (info.chapterTarget) {
      const progress = Math.min(100, Math.round((info.wordCount / info.chapterTarget) * 100))
      return `${w} / ${info.chapterTarget.toLocaleString()} (${progress}%)`
    }
    return w
  }, [info.wordCount, info.chapterTarget])

  const gitStatusIcon = useMemo(() => {
    switch (info.gitStatus) {
      case 'clean':
        return '✓'
      case 'modified':
        return '●'
      case 'staged':
        return '◉'
      default:
        return ''
    }
  }, [info.gitStatus])

  const gitStatusText = useMemo(() => {
    if (!info.gitBranch) return null
    return `${info.gitBranch}${gitStatusIcon ? ` ${gitStatusIcon}` : ''}`
  }, [info.gitBranch, gitStatusIcon])

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {info.gitBranch && (
          <div
            className={`status-bar-item clickable ${info.gitStatus || ''}`}
            onClick={onGitClick}
            title="Git 状态"
          >
            <span className="status-bar-icon">⎇</span>
            {gitStatusText}
          </div>
        )}
        {info.currentChapter && (
          <div className="status-bar-item" title="当前章节">
            <span className="status-bar-icon">📑</span>
            {info.currentChapter}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {wordCountText && (
          <div className="status-bar-item" title="字数统计">
            <span className="status-bar-icon">✎</span>
            {wordCountText}
          </div>
        )}
        {info.charCount !== undefined && (
          <div className="status-bar-item" title="字符数">
            {info.charCount.toLocaleString()} 字符
          </div>
        )}
        {info.lineCount !== undefined && (
          <div className="status-bar-item" title="行数">
            {info.lineCount} 行
          </div>
        )}
        {info.language && (
          <div className="status-bar-item">
            {info.language}
          </div>
        )}
        <div
          className="status-bar-item clickable theme-toggle"
          onClick={onThemeToggle}
          title="切换主题"
        >
          {info.theme === 'dark' ? '☀️' : '🌙'}
        </div>
      </div>
    </div>
  )
}
