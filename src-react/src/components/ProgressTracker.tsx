'use client'

import { useMemo } from 'react'
import './ProgressTracker.css'

export type WritingProgress = {
  totalWords: number
  targetWords: number
  chapters: number
  completedChapters: number
  dailyTarget: number
  todayWords: number
}

type ProgressTrackerProps = {
  progress: WritingProgress
}

export function ProgressTracker({ progress }: ProgressTrackerProps) {
  const { totalWords, targetWords, chapters, completedChapters, dailyTarget, todayWords } = progress

  const totalProgress = useMemo(() => {
    if (targetWords <= 0) return 0
    return Math.min(100, Math.round((totalWords / targetWords) * 100))
  }, [totalWords, targetWords])

  const dailyProgress = useMemo(() => {
    if (dailyTarget <= 0) return 0
    return Math.min(100, Math.round((todayWords / dailyTarget) * 100))
  }, [todayWords, dailyTarget])

  const chapterProgress = useMemo(() => {
    if (chapters <= 0) return 0
    return Math.round((completedChapters / chapters) * 100)
  }, [completedChapters, chapters])

  return (
    <div className="progress-tracker">
      {/* Overall Progress */}
      <div className="progress-section">
        <div className="progress-header">
          <span className="progress-label">总进度</span>
          <span className="progress-value">{totalProgress}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${totalProgress}%` }} />
        </div>
        <div className="progress-stats">
          <span>{totalWords.toLocaleString()} / {targetWords.toLocaleString()} 字</span>
        </div>
      </div>

      {/* Daily Progress */}
      <div className="progress-section">
        <div className="progress-header">
          <span className="progress-label">今日</span>
          <span className="progress-value">{dailyProgress}%</span>
        </div>
        <div className="progress-bar daily">
          <div className="progress-bar-fill" style={{ width: `${dailyProgress}%` }} />
        </div>
        <div className="progress-stats">
          <span>{todayWords.toLocaleString()} / {dailyTarget.toLocaleString()} 字</span>
        </div>
      </div>

      {/* Chapter Progress */}
      <div className="progress-section">
        <div className="progress-header">
          <span className="progress-label">章节</span>
          <span className="progress-value">{chapterProgress}%</span>
        </div>
        <div className="progress-bar chapters">
          <div className="progress-bar-fill" style={{ width: `${chapterProgress}%` }} />
        </div>
        <div className="progress-stats">
          <span>{completedChapters} / {chapters} 章</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="progress-quick-stats">
        <div className="quick-stat">
          <span className="quick-stat-value">{chapters}</span>
          <span className="quick-stat-label">章节</span>
        </div>
        <div className="quick-stat">
          <span className="quick-stat-value">{Math.round(totalWords / 10000 * 10) / 10}万</span>
          <span className="quick-stat-label">总字数</span>
        </div>
        <div className="quick-stat">
          <span className="quick-stat-value">{Math.max(0, targetWords - totalWords).toLocaleString()}</span>
          <span className="quick-stat-label">剩余</span>
        </div>
      </div>
    </div>
  )
}

// Compact version for sidebar
export function ProgressTrackerCompact({ progress }: ProgressTrackerProps) {
  const { totalWords, targetWords, dailyTarget, todayWords } = progress

  const totalProgress = useMemo(() => {
    if (targetWords <= 0) return 0
    return Math.min(100, Math.round((totalWords / targetWords) * 100))
  }, [totalWords, targetWords])

  const dailyProgress = useMemo(() => {
    if (dailyTarget <= 0) return 0
    return Math.min(100, Math.round((todayWords / dailyTarget) * 100))
  }, [todayWords, dailyTarget])

  return (
    <div className="progress-tracker-compact">
      <div className="compact-item">
        <span className="compact-label">总进度</span>
        <div className="compact-bar">
          <div className="compact-bar-fill" style={{ width: `${totalProgress}%` }} />
        </div>
        <span className="compact-value">{totalProgress}%</span>
      </div>
      <div className="compact-item">
        <span className="compact-label">今日</span>
        <div className="compact-bar daily">
          <div className="compact-bar-fill" style={{ width: `${dailyProgress}%` }} />
        </div>
        <span className="compact-value">{dailyProgress}%</span>
      </div>
    </div>
  )
}
