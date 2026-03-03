import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useI18n } from '../../i18n'
import type { ChangeSet, WriterMode } from '../../services'
import { AppIcon } from '../icons/AppIcon'

export type AIChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  cancelled?: boolean
  streamId?: string
  changeSet?: ChangeSet
  versionIndex?: number
  versionCount?: number
}
export type AIChatOption = {
  id: string
  name: string
}

type AIChatPanelProps = {
  writerMode: WriterMode
  plannerLastRunError: string | null
  onNewSession: () => void | Promise<unknown>
  chatMessages: AIChatMessage[]
  messagesRef: RefObject<HTMLDivElement | null>
  onAutoScrollChange: (atBottom: boolean) => void
  chatAutoScroll: boolean
  onScrollToBottom: () => void
  onSwitchAssistantVersion: (messageId: string, direction: -1 | 1) => void
  onOpenMessageContextMenu: (event: ReactMouseEvent<HTMLDivElement>, message: AIChatMessage) => void
  getStreamPhaseLabel: (streamId?: string) => string
  onOpenDiffView: (changeSetId: string) => void
  canUseEditorActions: boolean
  onQuoteSelection: () => void
  onSmartComplete: () => void | Promise<unknown>
  autoLongWriteEnabled: boolean
  autoToggleDisabled: boolean
  onToggleAutoLongWrite: (next: boolean) => void
  autoLongWriteStatus: string
  onWriterModeChange: (mode: WriterMode) => void
  chatInput: string
  chatInputRef: RefObject<HTMLTextAreaElement | null>
  onChatInputChange: (value: string) => void
  showStopAction: boolean
  canStop: boolean
  onStopChat: () => void | Promise<unknown>
  onSendChat: () => void | Promise<unknown>
  canRollbackLastTurn: boolean
  onRollbackLastTurn: () => void | Promise<unknown>
  busy: boolean
  autoLongWriteRunning: boolean
  isChatStreaming: boolean
  canRegenerateLatest: boolean
  latestCompletedAssistantId?: string
  onRegenerateAssistant: (messageId?: string) => void | Promise<unknown>
  onGenerateAssistantCandidates: (messageId?: string, count?: number) => void | Promise<unknown>
  activeAgentId: string
  agents: AIChatOption[]
  onActiveAgentChange: (id: string) => void
  activeProviderId: string
  providers: AIChatOption[]
  onActiveProviderChange: (id: string) => void
}

function writerModeLabel(mode: WriterMode, t: (key: string) => string): string {
  switch (mode) {
    case 'plan':
      return t('chat.mode.plan')
    case 'spec':
      return t('chat.mode.spec')
    default:
      return t('chat.mode.normal')
  }
}

function writerModeUpper(mode: WriterMode, t: (key: string) => string): string {
  return writerModeLabel(mode, t).toUpperCase()
}

const DEFAULT_COLLAPSE_CHAR_LIMIT = 900
const DEFAULT_COLLAPSE_LINE_LIMIT = 14

function countLines(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function compactSnippet(text: string, charLimit: number, lineLimit: number): string {
  if (!text) return text
  const lines = text.split(/\r?\n/)
  const clippedLines = lines.slice(0, lineLimit)
  let snippet = clippedLines.join('\n')
  if (snippet.length > charLimit) {
    snippet = `${snippet.slice(0, charLimit)}...`
  } else if (lines.length > lineLimit) {
    snippet = `${snippet}\n...`
  }
  return snippet
}

function shouldCollapseMessage(message: AIChatMessage): boolean {
  if (message.role !== 'assistant') return false
  if (message.streaming) return false
  const text = message.content ?? ''
  if (!text.trim()) return false
  const hasDiff = !!message.changeSet && message.changeSet.modifications.length > 0
  if (hasDiff) return true
  return text.length > DEFAULT_COLLAPSE_CHAR_LIMIT || countLines(text) > DEFAULT_COLLAPSE_LINE_LIMIT
}

export function AIChatPanel(props: AIChatPanelProps) {
  const { t } = useI18n()
  const {
    writerMode,
    plannerLastRunError,
    onNewSession,
    chatMessages,
    messagesRef,
    onAutoScrollChange,
    chatAutoScroll,
    onScrollToBottom,
    onSwitchAssistantVersion,
    onOpenMessageContextMenu,
    getStreamPhaseLabel,
    onOpenDiffView,
    canUseEditorActions,
    onQuoteSelection,
    onSmartComplete,
    autoLongWriteEnabled,
    autoToggleDisabled,
    onToggleAutoLongWrite,
    autoLongWriteStatus,
    onWriterModeChange,
    chatInput,
    chatInputRef,
    onChatInputChange,
    showStopAction,
    canStop,
    onStopChat,
    onSendChat,
    canRollbackLastTurn,
    onRollbackLastTurn,
    busy,
    autoLongWriteRunning,
    isChatStreaming,
    canRegenerateLatest,
    latestCompletedAssistantId,
    onRegenerateAssistant,
    onGenerateAssistantCandidates,
    activeAgentId,
    agents,
    onActiveAgentChange,
    activeProviderId,
    providers,
    onActiveProviderChange,
  } = props

  const [expandedAssistantIds, setExpandedAssistantIds] = useState<Record<string, boolean>>({})

  const toggleAssistantMessage = useCallback((messageId: string) => {
    setExpandedAssistantIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])

  const handleComposerKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !chatInput.trim()) {
      if (!canRollbackLastTurn) return
      e.preventDefault()
      void onRollbackLastTurn()
      return
    }
    if (e.key === 'Escape' && showStopAction) {
      e.preventDefault()
      void onStopChat()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (showStopAction) {
        void onStopChat()
      } else {
        void onSendChat()
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number }
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return
      }
      e.preventDefault()
      if (showStopAction) {
        void onStopChat()
      } else {
        void onSendChat()
      }
    }
  }

  return (
    <>
      <div className="ai-header">
        <div className="ai-title-row">
          <span>{t('chat.title')}</span>
          <div className="ai-title-actions">
            <button className="icon-button ai-new-session-btn" onClick={() => void onNewSession()} title={t('chat.newSession')}>
              {t('chat.newSession')}
            </button>
          </div>
        </div>
        <div className="ai-mode-brief">{writerModeLabel(writerMode, t)}</div>
        {plannerLastRunError ? <div className="planner-error-text">{plannerLastRunError}</div> : null}
      </div>

      <div className="ai-messages-wrap">
        <div
          className="ai-messages"
          ref={messagesRef}
          onScroll={(event) => {
            const panel = event.currentTarget
            const threshold = 24
            const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight <= threshold
            onAutoScrollChange(atBottom)
          }}
        >
          {chatMessages.length === 0 ? (
            <div className="ai-empty-state">
              <div>{t('chat.emptyPrimary')}</div>
              <div className="ai-empty-state-sub">
                {t('chat.emptyPrefix')}
                {writerModeUpper(writerMode, t)}
                {t('chat.emptySuffix')}
              </div>
            </div>
          ) : (
            chatMessages.map((message) => {
              const canCollapse = shouldCollapseMessage(message)
              const expanded = canCollapse ? expandedAssistantIds[message.id] === true : false
              const hasDiff = !!message.changeSet && message.changeSet.modifications.length > 0
              const preview = hasDiff
                ? t('chat.collapsedForDiff')
                : compactSnippet(message.content, DEFAULT_COLLAPSE_CHAR_LIMIT, DEFAULT_COLLAPSE_LINE_LIMIT)
              const renderedContent =
                canCollapse && !expanded
                  ? preview
                  : message.content || ''

              return (
              <div key={message.id} className={message.role === 'user' ? 'message user' : 'message assistant'}>
                <div className="message-meta">
                  {message.role === 'user' ? (
                    t('chat.you')
                  ) : (
                    <span className="ai-meta">
                      AI
                      {message.cancelled ? <span className="ai-cancelled-tag">{t('chat.stopped')}</span> : null}
                      {message.streaming ? (
                        <span className="ai-dot-pulse" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
                {message.role === 'assistant' && !message.streaming && (message.versionCount ?? 0) > 1 ? (
                  <div className="assistant-version-switch">
                    <button
                      className="icon-button assistant-version-btn"
                      onClick={() => onSwitchAssistantVersion(message.id, -1)}
                      title={t('chat.previousVersion')}
                    >
                      {'<'}
                    </button>
                    <span className="assistant-version-label">
                      {(typeof message.versionIndex === 'number' ? message.versionIndex + 1 : message.versionCount)}/{message.versionCount}
                    </span>
                    <button
                      className="icon-button assistant-version-btn"
                      onClick={() => onSwitchAssistantVersion(message.id, 1)}
                      title={t('chat.nextVersion')}
                    >
                      {'>'}
                    </button>
                  </div>
                ) : null}
                {renderedContent ? (
                  <div
                    className={`message-content${canCollapse && !expanded ? ' message-content-collapsed' : ''}`}
                    onContextMenu={(event) => onOpenMessageContextMenu(event, message)}
                  >
                    {renderedContent}
                  </div>
                ) : null}
                {canCollapse ? (
                  <button className="message-collapse-toggle" onClick={() => toggleAssistantMessage(message.id)} type="button">
                    {expanded ? t('chat.collapseDetails') : t('chat.expandDetails')}
                  </button>
                ) : null}
                {message.role === 'assistant' && message.streaming ? (
                  <div className="ai-processing-indicator">
                    <div className="ai-processing-spinner" />
                    <span>{getStreamPhaseLabel(message.streamId)}</span>
                  </div>
                ) : null}
                {message.role === 'assistant' && message.changeSet && message.changeSet.modifications.length > 0 ? (
                  <div className="file-modifications">
                    <div className="file-modifications-header">
                      <span>{t('chat.modified')} {message.changeSet.filePath.split('/').pop()}</span>
                    </div>
                    <div className="file-modifications-list">
                      <div className="file-modification-item" onClick={() => onOpenDiffView(message.changeSet!.id)} title={t('chat.clickViewDiff')}>
                        <div className="file-modification-name">
                          <span className="file-name">{message.changeSet.filePath.split('/').pop()}</span>
                        </div>
                        <div className="file-modification-path">{message.changeSet.filePath}</div>
                        <div className="file-modification-stats">
                          {message.changeSet.stats.additions > 0 ? <span className="stat-add">+{message.changeSet.stats.additions}</span> : null}
                          {message.changeSet.stats.deletions > 0 ? <span className="stat-delete">-{message.changeSet.stats.deletions}</span> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              )
            })
          )}
        </div>
        {!chatAutoScroll ? (
          <button className="chat-scroll-bottom-btn" onClick={onScrollToBottom}>
            {t('chat.backToBottom')}
          </button>
        ) : null}
      </div>

      <div className="ai-input-area">
        <div className="ai-input-topbar">
          <div className="ai-actions ai-input-tools">
            <button className="icon-button" disabled={!canUseEditorActions} onClick={onQuoteSelection} title={t('chat.quoteSelection')}>
              {t('chat.quote')}
            </button>
            <button className="icon-button" disabled={!canUseEditorActions} onClick={() => void onSmartComplete()} title={t('chat.smartComplete')}>
              {t('chat.continue')}
            </button>
          </div>
          <label className={`ai-auto-switch ${autoLongWriteEnabled ? 'active' : ''}`} title="Auto continuous long-form writing">
            <input
              type="checkbox"
              checked={autoLongWriteEnabled}
              disabled={autoToggleDisabled}
              onChange={(event) => {
                onToggleAutoLongWrite(event.target.checked)
              }}
            />
            <span className="ai-auto-switch-track">
              <span className="ai-auto-switch-knob" />
            </span>
            <span className="ai-auto-switch-text">Auto</span>
          </label>
          <select className="ai-select ai-mode-select" value={writerMode} onChange={(event) => onWriterModeChange(event.target.value as WriterMode)}>
            <option value="normal">{t('chat.mode.normal')}</option>
            <option value="plan">{t('chat.mode.plan')}</option>
            <option value="spec">{t('chat.mode.spec')}</option>
          </select>
        </div>
        {autoLongWriteStatus ? <div className="ai-auto-status">{autoLongWriteStatus}</div> : null}
        <textarea
          ref={chatInputRef}
          className="ai-textarea"
          value={chatInput}
          onChange={(event) => onChatInputChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={t('chat.placeholder')}
        />
        <div className="ai-composer-footer">
          <div className="ai-composer-selects">
            <select className="ai-select ai-select-compact" value={activeAgentId} onChange={(event) => onActiveAgentChange(event.target.value)}>
              {agents.length === 0 ? <option value="">{t('chat.noAgents')}</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select className="ai-select ai-select-compact" value={activeProviderId} onChange={(event) => onActiveProviderChange(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ai-composer-main-actions">
            {!isChatStreaming && canRegenerateLatest ? (
              <button className="icon-button ai-regenerate-btn" onClick={() => void onRegenerateAssistant(latestCompletedAssistantId)} title={t('chat.regenerateLatest')}>
                <AppIcon name="refresh" size={13} />
              </button>
            ) : null}
            {!isChatStreaming && canRegenerateLatest ? (
              <button className="icon-button ai-candidates-btn" onClick={() => void onGenerateAssistantCandidates(latestCompletedAssistantId, 2)} title={t('chat.generateCandidates')}>
                <AppIcon name="add" size={13} />
              </button>
            ) : null}
            {!showStopAction ? (
              <button
                className="icon-button ai-regenerate-btn"
                disabled={!canRollbackLastTurn || busy || autoLongWriteRunning}
                onClick={() => void onRollbackLastTurn()}
                title={t('chat.rollbackHint')}
              >
                {t('chat.rollback')}
              </button>
            ) : null}
            {showStopAction ? (
              <button className="primary-button chat-stop-button" disabled={!canStop} onClick={() => void onStopChat()} title={t('chat.stop')}>
                <AppIcon name="stop" size={13} />
              </button>
            ) : (
              <button className="primary-button" disabled={busy || !chatInput.trim() || autoLongWriteRunning} onClick={() => void onSendChat()}>
                {t('chat.send')}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
