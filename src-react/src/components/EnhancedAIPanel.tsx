'use client'

import { useCallback, useMemo, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ChangeSet } from '../services/ModificationService'
import { useDiff } from '../contexts/DiffContext'
import './EnhancedAIPanel.css'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thinking?: string
  changeSet?: ChangeSet
  timestamp?: number
}

type EnhancedAIPanelProps = {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (overrideContent?: string) => void
  onQuoteSelection?: () => void
  onSmartComplete?: () => void
  onInsertToCursor?: (text: string) => void
  onAcceptChangeSet?: (changeSetId: string) => void
  onRejectChangeSet?: (changeSetId: string) => void
  onCloseChangeSet?: (changeSetId: string) => void
  onOpenDiffView?: (changeSetId: string) => void
  disabled?: boolean
  placeholder?: string
  hasActiveFile?: boolean
}

export function EnhancedAIPanel({
  messages,
  input,
  onInputChange,
  onSend,
  onQuoteSelection,
  onSmartComplete,
  onOpenDiffView,
  disabled,
  placeholder = '输入消息... (Ctrl+Enter 发送)',
  hasActiveFile = false,
}: EnhancedAIPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { changeSets, activeChangeSetId, setActiveChangeSet } = useDiff()

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on Ctrl+Shift+L
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (!disabled && input.trim()) {
          onSend()
        }
      }
    },
    [disabled, input, onSend]
  )

  const handleChangeSetClick = useCallback(
    (changeSetId: string) => {
      setActiveChangeSet(changeSetId)
      onOpenDiffView?.(changeSetId)
    },
    [setActiveChangeSet, onOpenDiffView]
  )

  // Get all change sets from context
  const allChangeSets = useMemo(() => Array.from(changeSets.values()), [changeSets])
  const pendingChangeSets = useMemo(
    () => allChangeSets.filter((cs) => cs.status === 'pending'),
    [allChangeSets]
  )

  return (
    <div className="enhanced-ai-panel">
      {/* Messages */}
      <div className="ai-messages">
        {messages.length === 0 && (
          <div className="ai-welcome">
            <div className="ai-welcome-icon">🤖</div>
            <div className="ai-welcome-title">AI 创作助手</div>
            <div className="ai-welcome-desc">
              选中文字后点击"引用选区"可让AI理解上下文
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`ai-message ai-message-${message.role}`}>
            <div className="ai-message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="ai-message-body">
              {/* Meta */}
              <div className="ai-message-meta">
                {message.role === 'user' ? '你' : 'AI'}
                {message.role === 'assistant' && message.streaming && (
                  <span className="ai-thinking-indicator">
                    <span className="thinking-dot"></span>
                    <span className="thinking-dot"></span>
                    <span className="thinking-dot"></span>
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="ai-message-content">
                {message.content.split('\n').map((line, i) => (
                  <p key={i}>{line || <br />}</p>
                ))}
                {message.streaming && message.content && (
                  <span className="ai-cursor">▍</span>
                )}
              </div>

              {/* Change Set Card */}
              {message.changeSet && (
                <div
                  className={`ai-changeset-card ${message.changeSet.status}`}
                  onClick={() => handleChangeSetClick(message.changeSet!.id)}
                >
                  <div className="changeset-card-header">
                    <span className="changeset-icon">
                      {message.changeSet.status === 'pending' && '📝'}
                      {message.changeSet.status === 'accepted' && '✅'}
                      {message.changeSet.status === 'rejected' && '❌'}
                    </span>
                    <span className="changeset-label">
                      {message.changeSet.status === 'pending' && '待审查'}
                      {message.changeSet.status === 'accepted' && '已接受'}
                      {message.changeSet.status === 'rejected' && '已拒绝'}
                    </span>
                    <span className="changeset-file">{message.changeSet.filePath.split('/').pop()}</span>
                  </div>
                  <div className="changeset-card-stats">
                    <span className="stat-add">+{message.changeSet.stats.additions}</span>
                    <span className="stat-delete">-{message.changeSet.stats.deletions}</span>
                  </div>
                </div>
              )}

              {/* Actions for assistant messages */}
              {message.role === 'assistant' && message.content && !message.streaming && (
                <div className="ai-message-actions">
                  <button
                    className="ai-action-btn"
                    disabled={!hasActiveFile}
                    onClick={() => {}}
              title={hasActiveFile ? 'Insert at cursor' : 'Open a file first'}
                  >
                    ↵ 插入
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Change Sets Panel (from context) */}
      {allChangeSets.length > 0 && (
        <div className="ai-changesets-panel">
          <div className="changesets-panel-header">
            <span>📝 文件修改</span>
            {pendingChangeSets.length > 0 && (
              <span className="pending-count">{pendingChangeSets.length} 待审查</span>
            )}
          </div>
          <div className="changesets-panel-list">
            {allChangeSets.map((changeSet) => (
              <div
                key={changeSet.id}
                className={`changesets-panel-item ${changeSet.id === activeChangeSetId ? 'active' : ''} ${changeSet.status}`}
                onClick={() => handleChangeSetClick(changeSet.id)}
              >
                <div className="changesets-item-info">
                  <span className="changesets-item-status">
                    {changeSet.status === 'pending' && '⏳'}
                    {changeSet.status === 'accepted' && '✅'}
                    {changeSet.status === 'rejected' && '❌'}
                  </span>
                  <span className="changesets-item-path">{changeSet.filePath.split('/').pop()}</span>
                </div>
                <div className="changesets-item-stats">
                  <span className="add">+{changeSet.stats.additions}</span>
                  <span className="delete">-{changeSet.stats.deletions}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="ai-input-area">
        <div className="ai-input-actions">
          {onQuoteSelection && (
            <button
              className="ai-input-btn"
              disabled={!hasActiveFile}
              onClick={onQuoteSelection}
              title={hasActiveFile ? 'Quote Selection (Ctrl+Shift+L)' : 'Open a file first'}
            >
              ❝
            </button>
          )}
          {onSmartComplete && (
            <button
              className="ai-input-btn"
              disabled={!hasActiveFile}
              onClick={onSmartComplete}
              title={hasActiveFile ? 'Smart Complete' : 'Open a file first'}
            >
              ⚡
            </button>
          )}
        </div>
        <textarea
          ref={inputRef}
          className="ai-textarea"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
        />
        <button
          className="ai-send-btn"
          onClick={() => onSend()}
          disabled={disabled || !input.trim()}
              title="Send (Ctrl+Enter)"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
