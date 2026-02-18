'use client'

import { useMemo } from 'react'
import './StatsPanel.css'

export type WritingStats = {
  totalWords: number
  chapterCount: number
  characterCount: number
  conceptCount: number
  outlineCount: number
  daysWriting: number
  avgWordsPerDay: number
  longestChapter?: { title: string; words: number }
  shortestChapter?: { title: string; words: number }
}

type StatsPanelProps = {
  stats: WritingStats
}

export function StatsPanel({ stats }: StatsPanelProps) {
  const wordCountFormatted = useMemo(() => {
    if (stats.totalWords >= 10000) {
      return `${(stats.totalWords / 10000).toFixed(1)} 万字`
    }
    return `${stats.totalWords.toLocaleString()} 字`
  }, [stats.totalWords])

  const avgFormatted = useMemo(() => {
    return stats.avgWordsPerDay.toLocaleString()
  }, [stats.avgWordsPerDay])

  return (
    <div className="stats-panel">
      {/* Main Stats */}
      <div className="stats-main">
        <div className="stats-main-item">
          <span className="stats-main-value">{wordCountFormatted}</span>
          <span className="stats-main-label">总字数</span>
        </div>
        <div className="stats-main-divider" />
        <div className="stats-main-item">
          <span className="stats-main-value">{stats.chapterCount}</span>
          <span className="stats-main-label">章节</span>
        </div>
        <div className="stats-main-divider" />
        <div className="stats-main-item">
          <span className="stats-main-value">{avgFormatted}</span>
          <span className="stats-main-label">日均</span>
        </div>
      </div>

      {/* Details */}
      <div className="stats-details">
        <div className="stats-detail">
          <span className="stats-detail-icon">📄</span>
          <span className="stats-detail-label">章节</span>
          <span className="stats-detail-value">{stats.chapterCount}</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-icon">👤</span>
          <span className="stats-detail-label">人物</span>
          <span className="stats-detail-value">{stats.characterCount}</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-icon">📋</span>
          <span className="stats-detail-label">设定</span>
          <span className="stats-detail-value">{stats.conceptCount}</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-icon">📑</span>
          <span className="stats-detail-label">大纲</span>
          <span className="stats-detail-value">{stats.outlineCount}</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-icon">📅</span>
          <span className="stats-detail-label">创作天数</span>
          <span className="stats-detail-value">{stats.daysWriting}</span>
        </div>
      </div>

      {/* Chapter Stats */}
      {(stats.longestChapter || stats.shortestChapter) && (
        <div className="stats-chapters">
          <h4 className="stats-chapters-title">章节之最</h4>
          {stats.longestChapter && (
            <div className="stats-chapter-stat">
              <span className="stats-chapter-label">最长</span>
              <span className="stats-chapter-title">{stats.longestChapter.title}</span>
              <span className="stats-chapter-words">{stats.longestChapter.words.toLocaleString()}字</span>
            </div>
          )}
          {stats.shortestChapter && (
            <div className="stats-chapter-stat">
              <span className="stats-chapter-label">最短</span>
              <span className="stats-chapter-title">{stats.shortestChapter.title}</span>
              <span className="stats-chapter-words">{stats.shortestChapter.words.toLocaleString()}字</span>
            </div>
          )}
        </div>
      )}

      {/* Progress Ring */}
      <div className="stats-ring-container">
        <svg className="stats-ring" viewBox="0 0 100 100">
          <circle
            className="stats-ring-bg"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
          />
          <circle
            className="stats-ring-fill"
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="8"
            strokeDasharray={`${Math.min(100, (stats.avgWordsPerDay / 5000) * 100) * 2.83} 283`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="stats-ring-text">
          <span className="stats-ring-value">{Math.min(100, Math.round((stats.avgWordsPerDay / 5000) * 100))}%</span>
          <span className="stats-ring-label">日目标完成</span>
        </div>
      </div>
    </div>
  )
}
