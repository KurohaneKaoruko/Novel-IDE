import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
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

function writerModeLabel(mode: WriterMode): string {
  switch (mode) {
    case 'plan':
      return '大纲模式'
    case 'spec':
      return '细纲模式'
    default:
      return '普通模式'
  }
}

function writerModeUpper(mode: WriterMode): string {
  return mode.toUpperCase()
}

const COMPOSER_PLACEHOLDER =
  '输入指令... 支持 #选区 #当前文件 #file:路径，可用 /plan /spec 切换模式，/auto on|off 控制自动连续生成（Enter 发送，Shift+Enter 换行）'

export function AIChatPanel(props: AIChatPanelProps) {
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
          <span>AI 对话</span>
          <div className="ai-title-actions">
            <button className="icon-button ai-new-session-btn" onClick={() => void onNewSession()} title="新建对话">
              新会话
            </button>
          </div>
        </div>
        <div className="ai-mode-brief">{writerModeLabel(writerMode)}</div>
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
              <div>嗨，我是你的写作助手。</div>
              <div className="ai-empty-state-sub">
                {'当前模式：'}
                {writerModeUpper(writerMode)}
                {'。可继续剧情，或切换到大纲模式/细纲模式进行规划。'}
              </div>
            </div>
          ) : (
            chatMessages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'message user' : 'message assistant'}>
                <div className="message-meta">
                  {message.role === 'user' ? (
                    '你'
                  ) : (
                    <span className="ai-meta">
                      AI
                      {message.cancelled ? <span className="ai-cancelled-tag">{'已停止'}</span> : null}
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
                    <button className="icon-button assistant-version-btn" onClick={() => onSwitchAssistantVersion(message.id, -1)} title="上一版">
                      {'<'}
                    </button>
                    <span className="assistant-version-label">
                      {(typeof message.versionIndex === 'number' ? message.versionIndex + 1 : message.versionCount)}/{message.versionCount}
                    </span>
                    <button className="icon-button assistant-version-btn" onClick={() => onSwitchAssistantVersion(message.id, 1)} title="下一版">
                      {'>'}
                    </button>
                  </div>
                ) : null}
                <div className="message-content" onContextMenu={(event) => onOpenMessageContextMenu(event, message)}>
                  {message.content || (message.role === 'assistant' && message.streaming ? '正在思考…' : '')}
                </div>
                {message.role === 'assistant' && message.streaming ? (
                  <div className="ai-processing-indicator">
                    <div className="ai-processing-spinner" />
                    <span>{getStreamPhaseLabel(message.streamId)}</span>
                  </div>
                ) : null}
                {message.role === 'assistant' && message.changeSet && message.changeSet.modifications.length > 0 ? (
                  <div className="file-modifications">
                    <div className="file-modifications-header">
                      <span>修改了 {message.changeSet.filePath.split('/').pop()}</span>
                    </div>
                    <div className="file-modifications-list">
                      <div className="file-modification-item" onClick={() => onOpenDiffView(message.changeSet!.id)} title="点击查看差异">
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
            ))
          )}
        </div>
        {!chatAutoScroll ? (
          <button className="chat-scroll-bottom-btn" onClick={onScrollToBottom}>
            {'回到底部'}
          </button>
        ) : null}
      </div>

      <div className="ai-input-area">
        <div className="ai-input-topbar">
          <div className="ai-actions ai-input-tools">
            <button className="icon-button" disabled={!canUseEditorActions} onClick={onQuoteSelection} title="引用选区">
              引用
            </button>
            <button className="icon-button" disabled={!canUseEditorActions} onClick={() => void onSmartComplete()} title="智能补全">
              续写
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
            <option value="normal">{'普通模式'}</option>
            <option value="plan">{'大纲模式'}</option>
            <option value="spec">{'细纲模式'}</option>
          </select>
        </div>
        {autoLongWriteStatus ? <div className="ai-auto-status">{autoLongWriteStatus}</div> : null}
        <textarea
          ref={chatInputRef}
          className="ai-textarea"
          value={chatInput}
          onChange={(event) => onChatInputChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={COMPOSER_PLACEHOLDER}
        />
        <div className="ai-composer-footer">
          <div className="ai-composer-selects">
            <select className="ai-select ai-select-compact" value={activeAgentId} onChange={(event) => onActiveAgentChange(event.target.value)}>
              {agents.length === 0 ? <option value="">无智能体</option> : null}
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
              <button className="icon-button ai-regenerate-btn" onClick={() => void onRegenerateAssistant(latestCompletedAssistantId)} title="重新生成上条回复">
                <AppIcon name="refresh" size={13} />
              </button>
            ) : null}
            {!isChatStreaming && canRegenerateLatest ? (
              <button className="icon-button ai-candidates-btn" onClick={() => void onGenerateAssistantCandidates(latestCompletedAssistantId, 2)} title="生成额外候选回复">
                <AppIcon name="add" size={13} />
              </button>
            ) : null}
            {!showStopAction ? (
              <button
                className="icon-button ai-regenerate-btn"
                disabled={!canRollbackLastTurn || busy || autoLongWriteRunning}
                onClick={() => void onRollbackLastTurn()}
                title="回退上一轮 AI 改动（Ctrl/Cmd+Z）"
              >
                {'回退'}
              </button>
            ) : null}
            {showStopAction ? (
              <button className="primary-button chat-stop-button" disabled={!canStop} onClick={() => void onStopChat()} title="停止生成">
                <AppIcon name="stop" size={13} />
              </button>
            ) : (
              <button className="primary-button" disabled={busy || !chatInput.trim() || autoLongWriteRunning} onClick={() => void onSendChat()}>
                {'发送'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
