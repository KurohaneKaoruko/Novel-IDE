import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
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
  toolEvents?: AIChatToolEvent[]
  versionIndex?: number
  versionCount?: number
}

export type AIChatToolEvent = {
  step: number
  tool: string
  status: 'running' | 'success' | 'error'
  inputPreview: string
  observationPreview?: string
  listItems?: Array<{ name: string; kind: 'dir' | 'file' }>
  listTruncated?: boolean
  exists?: boolean
  existsKind?: 'dir' | 'file'
  timestamp: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
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

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

function toolStatusLabel(status: AIChatToolEvent['status'], t: TranslateFn): string {
  if (status === 'running') return t('chat.operationRunning')
  if (status === 'error') return t('chat.operationError')
  return t('chat.operationDone')
}

function toolDisplayName(tool: string, t: TranslateFn): string {
  switch (tool) {
    case 'fs_read_text':
      return t('chat.tool.fsReadText')
    case 'fs_list_dir':
      return t('chat.tool.fsListDir')
    case 'fs_exists':
      return t('chat.tool.fsExists')
    case 'fs_create_dir':
      return t('chat.tool.fsCreateDir')
    case 'fs_create_file':
      return t('chat.tool.fsCreateFile')
    case 'fs_delete_entry':
      return t('chat.tool.fsDeleteEntry')
    case 'fs_rename_entry':
      return t('chat.tool.fsRenameEntry')
    case 'fs_write_text':
      return t('chat.tool.fsWriteText')
    case 'memory_upsert':
      return t('chat.tool.memoryUpsert')
    case 'memory_search':
      return t('chat.tool.memorySearch')
    default:
      return tool
  }
}

function buildThoughtSummary(toolEvents: AIChatToolEvent[], t: TranslateFn): string {
  if (toolEvents.length === 0) return ''
  const failed = toolEvents.filter((event) => event.status === 'error')
  const completed = toolEvents.filter((event) => event.status === 'success')
  const running = [...toolEvents].reverse().find((event) => event.status === 'running')
  if (running) {
    return t('chat.summaryRunning', {
      action: toolDisplayName(running.tool, t),
      done: completed.length,
      failed: failed.length,
    })
  }
  if (failed.length > 0) {
    const latestFailed = failed[failed.length - 1]
    return t('chat.summaryFailed', {
      failed: failed.length,
      action: toolDisplayName(latestFailed.tool, t),
    })
  }
  return t('chat.summaryDone', { done: completed.length })
}

function formatDurationLabel(ms: number, running: boolean): string {
  const safe = Math.max(running ? 0 : 1, Math.floor(ms))
  if (safe < 1000) return `${safe}ms`
  if (safe < 60_000) {
    const sec = safe / 1000
    return sec >= 10 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`
  }
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function compactPlainText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}...`
}

function buildToolOutcomeSummary(toolEvent: AIChatToolEvent, t: TranslateFn): string {
  if (toolEvent.status === 'running') return t('chat.stepInProgress')
  if (toolEvent.tool === 'fs_exists' && typeof toolEvent.exists === 'boolean') {
    if (!toolEvent.exists) return t('chat.outcomePathMissing')
    if (toolEvent.existsKind === 'dir') return t('chat.outcomePathExistsDir')
    if (toolEvent.existsKind === 'file') return t('chat.outcomePathExistsFile')
    return t('chat.outcomePathExists')
  }
  if (toolEvent.tool === 'fs_list_dir' && Array.isArray(toolEvent.listItems)) {
    return t('chat.outcomeListDir', { count: toolEvent.listItems.length })
  }
  const raw = toolEvent.observationPreview?.trim()
  if (!raw) return t('chat.outcomeOk')
  if (raw.includes('"exists":true') || raw.includes('"exists": true')) return t('chat.outcomePathExists')
  if (raw.includes('"exists":false') || raw.includes('"exists": false')) return t('chat.outcomePathMissing')
  if (toolEvent.tool === 'fs_list_dir') {
    const match = raw.match(/"name"\s*:/g)
    const count = match ? match.length : 0
    if (count > 0) return t('chat.outcomeListDir', { count })
  }
  if (toolEvent.tool === 'fs_read_text') {
    if (raw.includes('"text":')) return t('chat.outcomeReadText')
  }
  if (raw.includes('"error"')) return t('chat.outcomeError')
  return compactPlainText(raw, 96)
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
  const [collapsedToolPanels, setCollapsedToolPanels] = useState<Record<string, boolean>>({})
  const [toolFilterByMessage, setToolFilterByMessage] = useState<Record<string, 'all' | 'error'>>({})
  const [expandedToolItems, setExpandedToolItems] = useState<Record<string, boolean>>({})
  const [toolNowTick, setToolNowTick] = useState(Date.now())

  const hasRunningToolEvents = chatMessages.some((message) => {
    if (message.role !== 'assistant') return false
    return (message.toolEvents ?? []).some((event) => event.status === 'running')
  })

  useEffect(() => {
    if (!hasRunningToolEvents) return
    const timer = window.setInterval(() => {
      setToolNowTick(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningToolEvents])

  const toggleAssistantMessage = useCallback((messageId: string) => {
    setExpandedAssistantIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])
  const toggleToolPanel = useCallback((messageId: string) => {
    setCollapsedToolPanels((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])
  const setToolFilter = useCallback((messageId: string, next: 'all' | 'error') => {
    setToolFilterByMessage((prev) => ({ ...prev, [messageId]: next }))
  }, [])
  const toggleToolItem = useCallback((itemId: string) => {
    setExpandedToolItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
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
              const toolEvents = message.toolEvents ?? []
              const hasToolEvents = message.role === 'assistant' && toolEvents.length > 0
              const latestToolEvent = hasToolEvents ? toolEvents[toolEvents.length - 1] : null
              const thoughtSummary = hasToolEvents ? buildThoughtSummary(toolEvents, t) : ''
              const failedToolCount = hasToolEvents ? toolEvents.filter((event) => event.status === 'error').length : 0
              const toolFilter = toolFilterByMessage[message.id] ?? 'all'
              const visibleToolEvents =
                toolFilter === 'error' ? toolEvents.filter((event) => event.status === 'error') : toolEvents
              const hasManualToolCollapse = Object.prototype.hasOwnProperty.call(collapsedToolPanels, message.id)
              const toolPanelCollapsed = hasToolEvents
                ? hasManualToolCollapse
                  ? collapsedToolPanels[message.id] === true
                  : !message.streaming
                : true

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
                {hasToolEvents ? (
                  <div className="message-tool-activity">
                    <button className="message-tool-summary" onClick={() => toggleToolPanel(message.id)} type="button">
                      <span className={`message-tool-summary-chevron${toolPanelCollapsed ? '' : ' expanded'}`} aria-hidden="true">
                        {'>'}
                      </span>
                      <span className="message-tool-summary-title">{t('chat.thoughtProcess')}</span>
                      <span className="message-tool-summary-count">{t('chat.operationCount', { count: toolEvents.length })}</span>
                      <span className={`message-tool-summary-status message-tool-summary-status-${latestToolEvent?.status ?? 'running'}`}>
                        {toolStatusLabel(latestToolEvent?.status ?? 'running', t)}
                      </span>
                      <span className="message-tool-summary-toggle">
                        {toolPanelCollapsed ? t('chat.expandOps') : t('chat.collapseOps')}
                      </span>
                    </button>
                    {toolPanelCollapsed ? (
                      thoughtSummary ? (
                        <div className="message-tool-collapsed-line">
                          {thoughtSummary}
                        </div>
                      ) : null
                    ) : (
                      <div className="message-tool-list">
                        <div className="message-tool-summary-text">{thoughtSummary}</div>
                        <div className="message-tool-toolbar">
                          <button
                            className={`message-tool-filter${toolFilter === 'all' ? ' active' : ''}`}
                            type="button"
                            onClick={() => setToolFilter(message.id, 'all')}
                          >
                            {t('chat.filterAll')}
                          </button>
                          <button
                            className={`message-tool-filter${toolFilter === 'error' ? ' active' : ''}`}
                            type="button"
                            onClick={() => setToolFilter(message.id, 'error')}
                          >
                            {t('chat.filterFailed', { count: failedToolCount })}
                          </button>
                        </div>
                        {visibleToolEvents.length === 0 ? (
                          <div className="message-tool-empty">{t('chat.noFailedOps')}</div>
                        ) : null}
                        {visibleToolEvents.map((toolEvent, idx) => {
                          const itemId = `${message.id}-tool-${toolEvent.step}-${toolEvent.tool}-${idx}`
                          const hasManualExpand = Object.prototype.hasOwnProperty.call(expandedToolItems, itemId)
                          const expandedToolItem = hasManualExpand ? expandedToolItems[itemId] === true : toolEvent.status !== 'success'
                          const durationMs =
                            toolEvent.durationMs ??
                            ((toolEvent.finishedAt ?? (toolEvent.status === 'running' ? toolNowTick : toolEvent.timestamp)) -
                              (toolEvent.startedAt ?? toolEvent.timestamp))

                          return (
                          <div key={itemId} className={`message-tool-item message-tool-item-${toolEvent.status}`}>
                            <div className="message-tool-item-head">
                              <span className="message-tool-item-step">#{toolEvent.step}</span>
                              <span className="message-tool-item-name">{t('chat.builderAgent')}</span>
                              <span className="message-tool-item-state">
                                {toolStatusLabel(toolEvent.status, t)}
                              </span>
                              <span className="message-tool-item-kind">{t('chat.terminal')}</span>
                              <span className="message-tool-item-duration">
                                {formatDurationLabel(durationMs, toolEvent.status === 'running')}
                              </span>
                              <button className="message-tool-item-toggle" type="button" onClick={() => toggleToolItem(itemId)}>
                                {expandedToolItem ? t('chat.stepCollapse') : t('chat.stepExpand')}
                              </button>
                            </div>
                            <div className="message-tool-item-action">{toolDisplayName(toolEvent.tool, t)}</div>
                            <div className="message-tool-command" title={toolEvent.tool}>
                              <span className="message-tool-command-prefix">$</span>
                              <span className="message-tool-command-name">{toolEvent.tool}</span>
                            </div>
                            <div className="message-tool-item-brief">
                              <span className="message-tool-item-label">{t('chat.stepResult')}</span>{' '}
                              {buildToolOutcomeSummary(toolEvent, t)}
                            </div>
                            {Array.isArray(toolEvent.listItems) && toolEvent.listItems.length > 0 ? (
                              <div className="message-tool-tree">
                                {toolEvent.listItems.map((item, treeIdx) => (
                                  <div key={`${item.kind}-${item.name}-${treeIdx}`} className="message-tool-tree-item">
                                    <span className={`message-tool-tree-kind message-tool-tree-kind-${item.kind}`}>
                                      {item.kind === 'dir' ? t('chat.treeDir') : t('chat.treeFile')}
                                    </span>
                                    <span className="message-tool-tree-name">{item.name}</span>
                                  </div>
                                ))}
                                {toolEvent.listTruncated ? (
                                  <div className="message-tool-tree-more">{t('chat.treeMore')}</div>
                                ) : null}
                              </div>
                            ) : null}
                            {expandedToolItem ? (
                              <>
                                {toolEvent.inputPreview ? (
                                  <pre className="message-tool-item-line" title={toolEvent.inputPreview}>
                                    <span className="message-tool-item-label">{t('chat.input')}</span>{' '}
                                    {toolEvent.inputPreview}
                                  </pre>
                                ) : null}
                                {toolEvent.observationPreview ? (
                                  <pre className="message-tool-item-line" title={toolEvent.observationPreview}>
                                    <span className="message-tool-item-label">{t('chat.output')}</span>{' '}
                                    {toolEvent.observationPreview}
                                  </pre>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
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
