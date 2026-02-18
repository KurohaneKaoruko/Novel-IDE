'use client'

import { useCallback, useRef, type ReactNode } from 'react'
import './BottomPanel.css'

export type PanelTab = {
  id: string
  label: string
  icon: string
  content: ReactNode
}

type BottomPanelProps = {
  tabs: PanelTab[]
  activeTab: string
  onTabChange: (tabId: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

export function BottomPanel({ tabs, activeTab, onTabChange, isCollapsed, onToggleCollapse }: BottomPanelProps) {
  const activeContent = tabs.find((t) => t.id === activeTab)?.content

  return (
    <div className={`bottom-panel ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="bottom-panel-header">
        <div className="bottom-panel-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`bottom-panel-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="bottom-panel-tab-icon">{tab.icon}</span>
              <span className="bottom-panel-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="bottom-panel-actions">
          <button className="bottom-panel-action" onClick={onToggleCollapse} title={isCollapsed ? '展开' : '收起'}>
            {isCollapsed ? '▲' : '▼'}
          </button>
          <button className="bottom-panel-action" title="关闭">✕</button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="bottom-panel-content">
          {activeContent}
        </div>
      )}
    </div>
  )
}

type TerminalPanelProps = {
  lines: Array<{ type: 'info' | 'error' | 'success' | 'output'; text: string }>
}

export function TerminalPanel({ lines }: TerminalPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  return (
    <div className="terminal-panel" ref={bottomRef}>
      {lines.map((line, i) => (
        <div key={i} className={`terminal-line terminal-${line.type}`}>
          <span className="terminal-prompt">
            {line.type === 'output' ? '>' : line.type === 'error' ? '✕' : line.type === 'success' ? '✓' : 'i'}
          </span>
          <span className="terminal-text">{line.text}</span>
        </div>
      ))}
    </div>
  )
}
