'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChangeSet } from '../services/ModificationService'
import './AIPanel.css'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thinking?: string
  changeSet?: ChangeSet
  timestamp?: number
}

type AIPanelProps = {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (overrideContent?: string) => void
  onQuoteSelection?: () => void
  onInsertToCursor?: (text: string) => void
  onAcceptChangeSet?: (changeSetId: string) => void
  onRejectChangeSet?: (changeSetId: string) => void
  onCloseChangeSet?: (changeSetId: string) => void
  disabled?: boolean
  placeholder?: string
}

export function AIPanel({
  messages,
  input,
  onInputChange,
  onSend,
  onQuoteSelection,
  onAcceptChangeSet,
  onRejectChangeSet,
  onCloseChangeSet,
  disabled,
  placeholder = '输入消息... (Ctrl+Enter 发送)',
}: AIPanelProps) {
  const [showChangeSets, setShowChangeSets] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on Ctrl+Shift+L
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown as any)
    return () => window.removeEventListener('keydown', handleKeyDown as any)
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (!disabled && input.trim()) {
          onSend()
        }
      }
    },
    [disabled, onSend]
  )

  const handleCloseChangeSet = useCallback(
    (changeSetId: string) => {
      setShowChangeSets(false)
      onCloseChangeSet?.(changeSetId)
    },
    [onCloseChangeSet]
  )

  // Group change sets
  const changeSets = messages.filter((m) => m.changeSet).map((m) => m.changeSet!)
  const pendingChangeSets = changeSets.filter((cs) => cs.status === 'pending')

  return (
    <div className="ai-panel">
      {/* Messages */}
      <div className="ai-panel-messages">
        {messages.length === 0 && (
          <div className="ai-panel-empty">
            <div className="ai-panel-empty-icon">🤖</div>
            <div className="ai-panel-empty-text">开始与AI创作助手对话</div>
            <div className="ai-panel-empty-hint">
              选中文字后点击"引用选区"可让AI理解上下文
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`ai-message ai-message-${message.role}`}>
            <div className="ai-message-avatar">
              {message.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="ai-message-content">
              {/* Thinking indicator */}
              {message.streaming && message.role === 'assistant' && !message.content && (
                <div className="ai-message-thinking">
                  <span className="ai-thinking-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                  <span className="ai-thinking-text">AI正在思考...</span>
                </div>
              )}

              {/* Content */}
              {(message.content || !message.streaming) && (
                <div className="ai-message-text">
                  {message.content.split('\n').map((line, i) => (
                    <p key={i}>{line || <br />}</p>
                  ))}
                </div>
              )}

              {/* Streaming indicator */}
              {message.streaming && message.content && (
                <span className="ai-message-streaming">▍</span>
              )}

              {/* Change Set indicator */}
              {message.changeSet && (
                <div className="ai-message-changeset-indicator">
                  <span className={`changeset-status changeset-status-${message.changeSet.status}`}>
                    {message.changeSet.status === 'pending' && '📝 待审查'}
                    {message.changeSet.status === 'accepted' && '✅ 已接受'}
                    {message.changeSet.status === 'rejected' && '❌ 已拒绝'}
                  </span>
                  <span className="changeset-files">
                    {message.changeSet.modifications.length} 个修改
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Change Sets Panel */}
      {changeSets.length > 0 && (
        <div className="ai-panel-changesets">
          <div className="ai-changesets-header">
            <span className="ai-changesets-title">
              📝 文件修改 {pendingChangeSets.length > 0 && `(${pendingChangeSets.length} 待审查)`}
            </span>
            <button
              className="ai-changesets-toggle"
              onClick={() => setShowChangeSets(!showChangeSets)}
            >
              {showChangeSets ? '▼' : '▶'}
            </button>
          </div>

          {showChangeSets && (
            <div className="ai-changesets-list">
              {changeSets.map((changeSet) => (
                <div key={changeSet.id} className="ai-changeset">
                  <div className="ai-changeset-header">
                    <div className="ai-changeset-info">
                      <span className={`ai-changeset-status-badge ${changeSet.status}`}>
                        {changeSet.status === 'pending' && '⏳'}
                        {changeSet.status === 'accepted' && '✅'}
                        {changeSet.status === 'rejected' && '❌'}
                      </span>
                      <span className="ai-changeset-path">{changeSet.filePath}</span>
                    </div>
                    <div className="ai-changeset-stats">
                      <span className="stat-add">+{changeSet.stats.additions}</span>
                      <span className="stat-delete">-{changeSet.stats.deletions}</span>
                    </div>
                  </div>

                  {changeSet.status === 'pending' && (
                    <div className="ai-changeset-actions">
                      <button
                        className="ai-btn ai-btn-accept"
                        onClick={() => onAcceptChangeSet?.(changeSet.id)}
                      >
                        ✓ 接受
                      </button>
                      <button
                        className="ai-btn ai-btn-reject"
                        onClick={() => onRejectChangeSet?.(changeSet.id)}
                      >
                        ✕ 拒绝
                      </button>
                      <button
                        className="ai-btn ai-btn-close"
                        onClick={() => handleCloseChangeSet(changeSet.id)}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input Area */}
      <div className="ai-panel-input">
        {onQuoteSelection && (
          <button className="ai-panel-action" onClick={onQuoteSelection} title="引用选区">
            📋
          </button>
        )}
        <textarea
          ref={inputRef}
          className="ai-panel-textarea"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
        />
        <button
          className="ai-panel-send"
          onClick={() => onSend()}
          disabled={disabled || !input.trim()}
          title="发送 (Ctrl+Enter)"
        >
          ➤
        </button>
      </div>
    </div>
  )
}
