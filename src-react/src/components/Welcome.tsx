'use client'

import { useState } from 'react'
import './Welcome.css'

export type WelcomeAction = {
  id: string
  icon: string
  title: string
  description: string
  action: () => void
}

export type WelcomeProps = {
  onOpenWorkspace: () => void
  recentWorkspaces?: Array<{ path: string; name: string; lastOpened?: Date }>
}

export function Welcome({ onOpenWorkspace, recentWorkspaces = [] }: WelcomeProps) {
  const [showRecent, setShowRecent] = useState(false)

  return (
    <div className="welcome">
      {/* Hero Section */}
      <div className="welcome-hero">
        <div className="welcome-logo">📚</div>
        <h1 className="welcome-title">Novel-IDE</h1>
        <p className="welcome-subtitle">本地小说创作IDE</p>
        <p className="welcome-desc">
          专为小说作者设计的集成开发环境，AI辅助写作，智能编辑器，完整的工作流支持。
        </p>
      </div>

      {/* Actions */}
      <div className="welcome-actions">
        <button className="welcome-action primary" onClick={onOpenWorkspace}>
          <span className="welcome-action-icon">📂</span>
          <span className="welcome-action-text">
            <span className="welcome-action-title">打开工作区</span>
            <span className="welcome-action-desc">打开已有的小说项目</span>
          </span>
        </button>
      </div>

      {/* Recent Workspaces */}
      {recentWorkspaces.length > 0 && (
        <div className="welcome-section">
          <div className="welcome-section-header" onClick={() => setShowRecent(!showRecent)}>
            <span>最近打开</span>
            <span className="welcome-chevron">{showRecent ? '▼' : '▶'}</span>
          </div>
          {showRecent && (
            <div className="welcome-recent-list">
              {recentWorkspaces.map((ws) => (
                <button key={ws.path} className="welcome-recent-item">
                  <span className="welcome-recent-icon">📁</span>
                  <div className="welcome-recent-info">
                    <div className="welcome-recent-name">{ws.name}</div>
                    <div className="welcome-recent-path">{ws.path}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Features */}
      <div className="welcome-section">
        <h3 className="welcome-section-title">功能特点</h3>
        <div className="welcome-features">
          <div className="welcome-feature">
            <span className="welcome-feature-icon">🤖</span>
            <div className="welcome-feature-text">
              <div className="welcome-feature-title">AI 辅助写作</div>
              <div className="welcome-feature-desc">智能续写、润色、情节发展建议</div>
            </div>
          </div>
          <div className="welcome-feature">
            <span className="welcome-feature-icon">📝</span>
            <div className="welcome-feature-text">
              <div className="welcome-feature-title">专业编辑器</div>
              <div className="welcome-feature-desc">Lexical 编辑器，流畅长文本编辑</div>
            </div>
          </div>
          <div className="welcome-feature">
            <span className="welcome-feature-icon">👥</span>
            <div className="welcome-feature-text">
              <div className="welcome-feature-title">人物管理</div>
              <div className="welcome-feature-desc">关系图谱、角色卡片</div>
            </div>
          </div>
          <div className="welcome-feature">
            <span className="welcome-feature-icon">📊</span>
            <div className="welcome-feature-text">
              <div className="welcome-feature-title">写作统计</div>
              <div className="welcome-feature-desc">字数统计、写作目标追踪</div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts */}
      <div className="welcome-section">
        <h3 className="welcome-section-title">快捷键</h3>
        <div className="welcome-shortcuts">
          <div className="welcome-shortcut">
            <kbd>Ctrl + Shift + P</kbd>
            <span>命令面板</span>
          </div>
          <div className="welcome-shortcut">
            <kbd>Ctrl + S</kbd>
            <span>保存文件</span>
          </div>
          <div className="welcome-shortcut">
            <kbd>Ctrl + Shift + L</kbd>
            <span>AI 对话</span>
          </div>
          <div className="welcome-shortcut">
            <kbd>Ctrl + B</kbd>
            <span>切换侧边栏</span>
          </div>
        </div>
      </div>
    </div>
  )
}
