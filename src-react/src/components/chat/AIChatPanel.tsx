import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useI18n } from '../../i18n'
import type { ChangeSet, WriterMode } from '../../services'
import { AppIcon } from '../icons/AppIcon'

export type AIChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  cancelled?: boolean
  failureKind?: 'provider' | 'timeout' | 'runtime' | 'generic' | 'cancelled'
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
  readPath?: string
  readLines?: number
  readChars?: number
  readPreview?: string
  writePath?: string
  writeLines?: number
  writeChars?: number
  writePreview?: string
  timestamp: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
}
export type AIChatOption = {
  id: string
  name: string
  statusLabel?: string
  disabled?: boolean
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
  onRegenerateAssistant: (messageId?: string, retryContextOverride?: string) => void | Promise<unknown>
  getRetryContextText?: (messageId?: string) => string
  onGenerateAssistantCandidates: (messageId?: string, count?: number) => void | Promise<unknown>
  onRetryWithFallbackProvider: (messageId?: string, retryContextOverride?: string) => void | Promise<unknown>
  onOpenModelSettings: () => void
  activeAgentId: string
  agents: AIChatOption[]
  onActiveAgentChange: (id: string) => void
  activeProviderId: string
  providers: AIChatOption[]
  providerSelectInvalid?: boolean
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

function shouldCollapseMessage(message: AIChatMessage, contentOverride?: string): boolean {
  if (message.role !== 'assistant') return false
  if (message.streaming) return false
  const text = contentOverride ?? message.content ?? ''
  if (!text.trim()) return false
  const hasDiff = !!message.changeSet && message.changeSet.modifications.length > 0
  if (hasDiff) return true
  return text.length > DEFAULT_COLLAPSE_CHAR_LIMIT || countLines(text) > DEFAULT_COLLAPSE_LINE_LIMIT
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string
type ToolStageKey = 'context' | 'filesystem' | 'memory' | 'other'
type ToolFilterMode = 'all' | 'error'
type ToolStageFilter = 'all' | ToolStageKey
type ToolCounters = { running: number; done: number; failed: number; total: number }
type RetryPromptMode = 'concise' | 'detailed'

type RecoveryActions = {
  showRetry: boolean
  showOpenModelSettings: boolean
  showSwitchProviderRetry: boolean
}

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

function toolStageKey(tool: string): ToolStageKey {
  switch (tool) {
    case 'fs_read_text':
    case 'fs_list_dir':
    case 'fs_exists':
      return 'context'
    case 'fs_create_dir':
    case 'fs_create_file':
    case 'fs_delete_entry':
    case 'fs_rename_entry':
    case 'fs_write_text':
      return 'filesystem'
    case 'memory_upsert':
    case 'memory_search':
      return 'memory'
    default:
      return 'other'
  }
}

function toolStageLabel(stage: ToolStageKey, t: TranslateFn): string {
  switch (stage) {
    case 'context':
      return t('chat.stage.context')
    case 'filesystem':
      return t('chat.stage.filesystem')
    case 'memory':
      return t('chat.stage.memory')
    default:
      return t('chat.stage.other')
  }
}

function groupToolEventsByStage(events: AIChatToolEvent[]): Array<{ stage: ToolStageKey; items: AIChatToolEvent[] }> {
  const buckets: Record<ToolStageKey, AIChatToolEvent[]> = {
    context: [],
    filesystem: [],
    memory: [],
    other: [],
  }
  const order: ToolStageKey[] = []
  for (const event of events) {
    const stage = toolStageKey(event.tool)
    if (buckets[stage].length === 0) {
      order.push(stage)
    }
    buckets[stage].push(event)
  }
  return order.map((stage) => ({ stage, items: buckets[stage] }))
}

function buildToolStageCountMap(events: AIChatToolEvent[]): Record<ToolStageKey, number> {
  const counts: Record<ToolStageKey, number> = {
    context: 0,
    filesystem: 0,
    memory: 0,
    other: 0,
  }
  for (const event of events) {
    counts[toolStageKey(event.tool)] += 1
  }
  return counts
}

function buildToolCounters(events: AIChatToolEvent[]): ToolCounters {
  let running = 0
  let done = 0
  let failed = 0
  for (const event of events) {
    if (event.status === 'running') {
      running += 1
      continue
    }
    if (event.status === 'error') {
      failed += 1
      continue
    }
    done += 1
  }
  return {
    running,
    done,
    failed,
    total: events.length,
  }
}

function stageStatus(events: AIChatToolEvent[]): AIChatToolEvent['status'] {
  if (events.some((event) => event.status === 'running')) return 'running'
  if (events.some((event) => event.status === 'error')) return 'error'
  return 'success'
}

function shouldCollapseStageByDefault(
  stage: ToolStageKey,
  items: AIChatToolEvent[],
  latestToolEvent: AIChatToolEvent | null,
): boolean {
  if (items.length <= 1) return false
  const status = stageStatus(items)
  if (status === 'running' || status === 'error') return false
  if (!latestToolEvent) return true
  return toolStageKey(latestToolEvent.tool) !== stage
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

function buildFailedOpsDigest(toolEvents: AIChatToolEvent[], t: TranslateFn, limit = 8): string {
  const failed = toolEvents.filter((event) => event.status === 'error')
  if (failed.length === 0) return ''
  const recentFailed = failed.slice(-limit)
  const lines = recentFailed.map((event, idx) => {
    const target = resolveToolEventTarget(event)
    const detail = compactPlainText(
      (event.observationPreview || event.readPreview || event.writePreview || event.inputPreview || '').replace(/\s+/g, ' ').trim(),
      160,
    )
    const targetPart = target ? ` | ${target}` : ''
    const detailPart = detail ? ` | ${detail}` : ''
    return `${idx + 1}. #${event.step} ${toolDisplayName(event.tool, t)} (${event.tool})${targetPart}${detailPart}`
  })
  const hiddenCount = failed.length - recentFailed.length
  const hiddenSuffix = hiddenCount > 0 ? `\n${t('chat.failedOpsDigestMore', { count: hiddenCount })}` : ''
  return `${t('chat.failedOpsDigestHeader', { count: failed.length })}\n${lines.join('\n')}${hiddenSuffix}`
}

function buildRetryPromptTemplate(mode: RetryPromptMode, retryContextText: string, failedOpsDigest: string, t: TranslateFn): string {
  const retryContext = retryContextText.trim()
  const failedOps = failedOpsDigest.trim()
  if (!retryContext && !failedOps) return ''
  if (mode === 'concise') {
    const lines = [t('chat.retryPrompt.conciseHeader')]
    if (failedOps) {
      const digest = compactPlainText(failedOps.replace(/\s+/g, ' ').trim(), 240)
      lines.push(`${t('chat.retryPrompt.conciseFailedPrefix')} ${digest}`)
    }
    if (retryContext) {
      const context = compactPlainText(retryContext.replace(/\s+/g, ' ').trim(), 220)
      lines.push(`${t('chat.retryPrompt.conciseContextPrefix')} ${context}`)
    }
    lines.push(t('chat.retryPrompt.conciseInstruction'))
    return lines.join('\n').trim()
  }
  const sections: string[] = [t('chat.retryPrompt.header')]
  if (failedOps) {
    sections.push('')
    sections.push(t('chat.retryPrompt.failedSection'))
    sections.push(failedOps)
  }
  if (retryContext) {
    sections.push('')
    sections.push(t('chat.retryPrompt.contextSection'))
    sections.push(retryContext)
  }
  sections.push('')
  sections.push(t('chat.retryPrompt.instruction'))
  return sections.join('\n').trim()
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

function extractJsonField(inputPreview: string, field: 'path' | 'from' | 'to'): string | null {
  const matcher = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`)
  const match = inputPreview.match(matcher)
  if (!match?.[1]) return null
  return match[1]
}

function resolveToolEventTarget(toolEvent: AIChatToolEvent): string {
  if (toolEvent.readPath?.trim()) return toolEvent.readPath.trim()
  if (toolEvent.writePath?.trim()) return toolEvent.writePath.trim()
  const inputPreview = toolEvent.inputPreview ?? ''
  const path = extractJsonField(inputPreview, 'path')
  if (path) return path
  const from = extractJsonField(inputPreview, 'from')
  const to = extractJsonField(inputPreview, 'to')
  if (from && to) return `${from} -> ${to}`
  return ''
}

function hasLiveToolDetail(toolEvent: AIChatToolEvent): boolean {
  if (toolEvent.inputPreview?.trim()) return true
  if (toolEvent.observationPreview?.trim()) return true
  if (Array.isArray(toolEvent.listItems) && toolEvent.listItems.length > 0) return true
  if (typeof toolEvent.exists === 'boolean') return true
  if (toolEvent.readPreview?.trim()) return true
  if (toolEvent.writePreview?.trim()) return true
  return false
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const payload = text.trim()
  if (!payload) return false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(payload)
      return true
    }
  } catch {
    // Ignore and fallback to legacy API.
  }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = payload
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

function stripToolTraceContent(content: string): string {
  if (!content.trim()) return ''
  const tracePrefix = /^\s*(ACTION|INPUT|OBSERVATION|OUTPUT|TOOL|TOOL_RESULT)\s*:/i
  const traceFence = /^\s*```(?:json|tool|text)?\s*$/i
  const traceJsonLine = /^\s*[\[{].*(?:"(path|name|kind|exists|text|error|ok|from|to|lines|chars)")/i
  const traceJsonTail = /^\s*[\],]\s*$/
  const next = content
    .split(/\r?\n/)
    .filter((line) => {
      if (tracePrefix.test(line)) return false
      if (traceFence.test(line)) return false
      if (traceJsonLine.test(line)) return false
      if (traceJsonTail.test(line)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return next
}

function messageRecoveryActions(message: AIChatMessage, text: string): RecoveryActions | null {
  if (message.role !== 'assistant') return null
  if (message.streaming) return null
  const kind = message.failureKind
  if (!kind && !text) return null
  if (kind === 'cancelled') return null

  const lower = text.toLowerCase()
  const providerLike =
    kind === 'provider' ||
    lower.includes('api key') ||
    lower.includes('provider=') ||
    lower.includes('base url') ||
    lower.includes('model id') ||
    lower.includes('keyring')
  const timeoutLike = kind === 'timeout' || lower.includes('timeout') || lower.includes('timed out')
  const runtimeLike = kind === 'runtime' || lower.includes('workspace') || lower.includes('tauri runtime')
  const genericLike = kind === 'generic' || lower.includes('error') || lower.includes('failed')

  if (!providerLike && !timeoutLike && !runtimeLike && !genericLike) return null

  return {
    showRetry: !runtimeLike,
    showOpenModelSettings: providerLike,
    showSwitchProviderRetry: providerLike,
  }
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
  if (toolEvent.tool === 'fs_read_text' && typeof toolEvent.readChars === 'number') {
    return t('chat.outcomeReadTextMeta', {
      lines: toolEvent.readLines ?? 0,
      chars: toolEvent.readChars,
    })
  }
  if (toolEvent.tool === 'fs_write_text' && typeof toolEvent.writeChars === 'number') {
    return t('chat.outcomeWriteTextMeta', {
      lines: toolEvent.writeLines ?? 0,
      chars: toolEvent.writeChars,
    })
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
    getRetryContextText,
    onGenerateAssistantCandidates,
    onRetryWithFallbackProvider,
    onOpenModelSettings,
    activeAgentId,
    agents,
    onActiveAgentChange,
    activeProviderId,
    providers,
    providerSelectInvalid = false,
    onActiveProviderChange,
  } = props

  const [expandedAssistantIds, setExpandedAssistantIds] = useState<Record<string, boolean>>({})
  const [collapsedToolPanels, setCollapsedToolPanels] = useState<Record<string, boolean>>({})
  const [collapsedToolStages, setCollapsedToolStages] = useState<Record<string, boolean>>({})
  const [toolFilterByMessage, setToolFilterByMessage] = useState<Record<string, ToolFilterMode>>({})
  const [toolStageFilterByMessage, setToolStageFilterByMessage] = useState<Record<string, ToolStageFilter>>({})
  const [retryContextCollapsedByMessage, setRetryContextCollapsedByMessage] = useState<Record<string, boolean>>({})
  const [retryContextDraftByMessage, setRetryContextDraftByMessage] = useState<Record<string, string>>({})
  const [retryPromptModeByMessage, setRetryPromptModeByMessage] = useState<Record<string, RetryPromptMode>>({})
  const [expandedToolItems, setExpandedToolItems] = useState<Record<string, boolean>>({})
  const [copiedMarker, setCopiedMarker] = useState<string | null>(null)
  const [liveOpsCollapsed, setLiveOpsCollapsed] = useState(false)
  const [liveOpsFilter, setLiveOpsFilter] = useState<ToolFilterMode>('all')
  const [liveStageFilter, setLiveStageFilter] = useState<ToolStageFilter>('all')
  const [collapsedLiveStages, setCollapsedLiveStages] = useState<Record<string, boolean>>({})
  const [expandedLiveItems, setExpandedLiveItems] = useState<Record<string, boolean>>({})
  const [toolNowTick, setToolNowTick] = useState(Date.now())
  const latestLiveStreamIdRef = useRef<string>('')
  const liveOpsListRef = useRef<HTMLDivElement | null>(null)

  const hasRunningToolEvents = chatMessages.some((message) => {
    if (message.role !== 'assistant') return false
    return (message.toolEvents ?? []).some((event) => event.status === 'running')
  })
  const activeStreamingMessage = (() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      const candidate = chatMessages[i]
      if (candidate.role === 'assistant' && candidate.streaming) {
        return candidate
      }
    }
    return null
  })()
  const activeLiveStreamId = activeStreamingMessage?.streamId ?? ''
  const activeLiveToolEvents = activeStreamingMessage?.toolEvents ?? []
  const activeLiveToolCount = activeLiveToolEvents.length
  const activeLiveLatestTool = activeLiveToolCount > 0 ? activeLiveToolEvents[activeLiveToolCount - 1] : null
  const activeLiveSummary = activeLiveToolCount > 0 ? buildThoughtSummary(activeLiveToolEvents, t) : ''
  const liveFailedToolCount = activeLiveToolEvents.filter((event) => event.status === 'error').length
  const modeFilteredLiveToolEvents =
    liveOpsFilter === 'error' ? activeLiveToolEvents.filter((event) => event.status === 'error') : activeLiveToolEvents
  const liveStageCounts = buildToolStageCountMap(modeFilteredLiveToolEvents)
  const visibleLiveToolEvents =
    liveStageFilter === 'all'
      ? modeFilteredLiveToolEvents
      : modeFilteredLiveToolEvents.filter((event) => toolStageKey(event.tool) === liveStageFilter)
  const liveModeFilteredStats = buildToolCounters(modeFilteredLiveToolEvents)
  const liveVisibleStats = buildToolCounters(visibleLiveToolEvents)
  const groupedLiveToolEvents = groupToolEventsByStage(visibleLiveToolEvents)
  const liveFailedOpsDigest = liveFailedToolCount > 0 ? buildFailedOpsDigest(activeLiveToolEvents, t) : ''

  useEffect(() => {
    if (!hasRunningToolEvents) return
    const timer = window.setInterval(() => {
      setToolNowTick(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [hasRunningToolEvents])
  useEffect(() => {
    const prev = latestLiveStreamIdRef.current
    if (activeLiveStreamId && activeLiveStreamId !== prev) {
      setLiveOpsCollapsed(false)
      setLiveOpsFilter('all')
      setLiveStageFilter('all')
      setCollapsedLiveStages({})
      setExpandedLiveItems({})
      setCopiedMarker(null)
    } else if (!activeLiveStreamId && prev) {
      setLiveOpsCollapsed(true)
      setLiveOpsFilter('all')
      setLiveStageFilter('all')
      setCollapsedLiveStages({})
      setExpandedLiveItems({})
      setCopiedMarker(null)
    }
    latestLiveStreamIdRef.current = activeLiveStreamId
  }, [activeLiveStreamId])
  useEffect(() => {
    if (liveOpsCollapsed) return
    const list = liveOpsListRef.current
    if (!list) return
    const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    if (distanceToBottom > 56) return
    list.scrollTop = list.scrollHeight
  }, [activeLiveToolCount, liveOpsCollapsed, liveOpsFilter])

  const toggleAssistantMessage = useCallback((messageId: string) => {
    setExpandedAssistantIds((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])
  const toggleToolPanel = useCallback((messageId: string) => {
    setCollapsedToolPanels((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }, [])
  const setToolFilter = useCallback((messageId: string, next: ToolFilterMode) => {
    setToolFilterByMessage((prev) => ({ ...prev, [messageId]: next }))
  }, [])
  const setToolStageFilter = useCallback((messageId: string, next: ToolStageFilter) => {
    setToolStageFilterByMessage((prev) => ({ ...prev, [messageId]: next }))
  }, [])
  const toggleRetryContextPanel = useCallback((messageId: string) => {
    setRetryContextCollapsedByMessage((prev) => ({ ...prev, [messageId]: !(prev[messageId] ?? true) }))
  }, [])
  const updateRetryContextDraft = useCallback((messageId: string, value: string) => {
    setRetryContextDraftByMessage((prev) => ({ ...prev, [messageId]: value }))
  }, [])
  const resetRetryContextDraft = useCallback((messageId: string) => {
    setRetryContextDraftByMessage((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, messageId)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
  }, [])
  const setRetryPromptMode = useCallback((messageId: string, next: RetryPromptMode) => {
    setRetryPromptModeByMessage((prev) => ({ ...prev, [messageId]: next }))
  }, [])
  const toggleToolStage = useCallback((stageId: string) => {
    setCollapsedToolStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }))
  }, [])
  const toggleToolItem = useCallback((itemId: string) => {
    setExpandedToolItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
  }, [])
  const copyWithFeedback = useCallback(async (marker: string, text: string) => {
    const ok = await copyTextToClipboard(text)
    if (!ok) return
    setCopiedMarker(marker)
    window.setTimeout(() => {
      setCopiedMarker((prev) => (prev === marker ? null : prev))
    }, 1200)
  }, [])
  const toggleLiveStage = useCallback((stageId: string) => {
    setCollapsedLiveStages((prev) => ({ ...prev, [stageId]: !prev[stageId] }))
  }, [])
  const toggleLiveItem = useCallback((itemId: string) => {
    setExpandedLiveItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }))
  }, [])
  const insertPromptToComposer = useCallback(
    (prompt: string) => {
      const payload = prompt.trim()
      if (!payload) return
      const current = chatInput.trim()
      const next = current ? `${current}\n\n${payload}` : payload
      onChatInputChange(next)
      window.setTimeout(() => {
        chatInputRef.current?.focus()
      }, 0)
    },
    [chatInput, chatInputRef, onChatInputChange],
  )

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
              const toolEvents = message.toolEvents ?? []
              const hasToolEvents = message.role === 'assistant' && toolEvents.length > 0
              const hasDiff = !!message.changeSet && message.changeSet.modifications.length > 0
              const rawContent = message.content || ''
              const cleanedContent = message.role === 'assistant' ? stripToolTraceContent(rawContent) : rawContent
              const canCollapse = shouldCollapseMessage(message, cleanedContent)
              const expanded = canCollapse ? expandedAssistantIds[message.id] === true : false
              const preview = hasDiff
                ? t('chat.collapsedForDiff')
                : compactSnippet(cleanedContent, DEFAULT_COLLAPSE_CHAR_LIMIT, DEFAULT_COLLAPSE_LINE_LIMIT)
              const renderedContent =
                canCollapse && !expanded
                  ? preview
                  : cleanedContent
              const recoveryActions = messageRecoveryActions(message, cleanedContent)
              const latestToolEvent = hasToolEvents ? toolEvents[toolEvents.length - 1] : null
              const thoughtSummary = hasToolEvents ? buildThoughtSummary(toolEvents, t) : ''
              const failedToolCount = hasToolEvents ? toolEvents.filter((event) => event.status === 'error').length : 0
              const retryContextDefaultText = failedToolCount > 0 ? (getRetryContextText?.(message.id) ?? '') : ''
              const failedOpsDigest = failedToolCount > 0 ? buildFailedOpsDigest(toolEvents, t) : ''
              const hasRetryContextDraft = Object.prototype.hasOwnProperty.call(retryContextDraftByMessage, message.id)
              const retryContextDraft = hasRetryContextDraft ? (retryContextDraftByMessage[message.id] ?? '') : retryContextDefaultText
              const retryPromptMode = retryPromptModeByMessage[message.id] ?? 'concise'
              const retryPromptTemplate =
                failedToolCount > 0 ? buildRetryPromptTemplate(retryPromptMode, retryContextDraft, failedOpsDigest, t) : ''
              const retryContextCollapsed = retryContextCollapsedByMessage[message.id] ?? false
              const retryContextEdited = hasRetryContextDraft && retryContextDraft.trim() !== retryContextDefaultText.trim()
              const retryContextLineCount = retryContextDraft.trim() ? countLines(retryContextDraft.trim()) : 0
              const toolFilter = toolFilterByMessage[message.id] ?? 'all'
              const toolStageFilter = toolStageFilterByMessage[message.id] ?? 'all'
              const modeFilteredToolEvents =
                toolFilter === 'error' ? toolEvents.filter((event) => event.status === 'error') : toolEvents
              const toolStageCounts = buildToolStageCountMap(modeFilteredToolEvents)
              const modeFilteredStats = buildToolCounters(modeFilteredToolEvents)
              const visibleToolEvents =
                toolStageFilter === 'all'
                  ? modeFilteredToolEvents
                  : modeFilteredToolEvents.filter((event) => toolStageKey(event.tool) === toolStageFilter)
              const visibleToolStats = buildToolCounters(visibleToolEvents)
              const hasToolFilterApplied = toolFilter !== 'all' || toolStageFilter !== 'all'
              const groupedToolEvents = groupToolEventsByStage(visibleToolEvents)
              const hasManualToolCollapse = Object.prototype.hasOwnProperty.call(collapsedToolPanels, message.id)
              const toolPanelCollapsed = hasToolEvents
                ? hasManualToolCollapse
                  ? collapsedToolPanels[message.id] === true
                  : message.streaming
                    ? false
                    : failedToolCount === 0
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
                {recoveryActions ? (
                  <div className="message-recovery-actions">
                    {recoveryActions.showSwitchProviderRetry ? (
                      <button
                        className="message-recovery-button"
                        type="button"
                        onClick={() => void onRetryWithFallbackProvider(message.id)}
                      >
                        {t('chat.recovery.switchProviderRetry')}
                      </button>
                    ) : null}
                    {recoveryActions.showOpenModelSettings ? (
                      <button
                        className="message-recovery-button"
                        type="button"
                        onClick={() => onOpenModelSettings()}
                      >
                        {t('chat.recovery.openModels')}
                      </button>
                    ) : null}
                    {recoveryActions.showRetry ? (
                      <button
                        className="message-recovery-button"
                        type="button"
                        onClick={() => void onRegenerateAssistant(message.id)}
                      >
                        {t('chat.recovery.retryTurn')}
                      </button>
                    ) : null}
                  </div>
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
                        <div className="message-tool-stats">
                          {toolStageFilter === 'all'
                            ? t('chat.opsStats', modeFilteredStats)
                            : t('chat.opsStatsFiltered', {
                                visible: visibleToolStats.total,
                                total: modeFilteredStats.total,
                                running: visibleToolStats.running,
                                done: visibleToolStats.done,
                                failed: visibleToolStats.failed,
                              })}
                        </div>
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
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className="message-tool-filter"
                              type="button"
                              disabled={!failedOpsDigest.trim()}
                              onClick={() => void copyWithFeedback(`${message.id}-failed-ops`, failedOpsDigest)}
                            >
                              {copiedMarker === `${message.id}-failed-ops` ? t('chat.copied') : t('chat.copyFailedOps')}
                            </button>
                          ) : null}
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className={`message-tool-filter${retryPromptMode === 'concise' ? ' active' : ''}`}
                              type="button"
                              onClick={() => setRetryPromptMode(message.id, 'concise')}
                            >
                              {t('chat.retryPrompt.modeConcise')}
                            </button>
                          ) : null}
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className={`message-tool-filter${retryPromptMode === 'detailed' ? ' active' : ''}`}
                              type="button"
                              onClick={() => setRetryPromptMode(message.id, 'detailed')}
                            >
                              {t('chat.retryPrompt.modeDetailed')}
                            </button>
                          ) : null}
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className="message-tool-filter"
                              type="button"
                              disabled={!retryPromptTemplate.trim()}
                              onClick={() => void copyWithFeedback(`${message.id}-retry-prompt`, retryPromptTemplate)}
                            >
                              {copiedMarker === `${message.id}-retry-prompt` ? t('chat.copied') : t('chat.copyRetryPrompt')}
                            </button>
                          ) : null}
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className="message-tool-filter"
                              type="button"
                              onClick={() => toggleRetryContextPanel(message.id)}
                            >
                              {retryContextCollapsed ? t('chat.retryContext.showEditor') : t('chat.retryContext.hideEditor')}
                            </button>
                          ) : null}
                          {!message.streaming && failedToolCount > 0 ? (
                            <button
                              className="message-tool-filter"
                              type="button"
                              onClick={() => void onRegenerateAssistant(message.id, hasRetryContextDraft ? retryContextDraft : undefined)}
                            >
                              {t('chat.recovery.retryTurn')}
                            </button>
                          ) : null}
                        </div>
                        <div className="message-tool-toolbar message-tool-stage-toolbar">
                          <button
                            className={`message-tool-filter${toolStageFilter === 'all' ? ' active' : ''}`}
                            type="button"
                            onClick={() => setToolStageFilter(message.id, 'all')}
                          >
                            {t('chat.stageFilterAll')}
                          </button>
                          {(['context', 'filesystem', 'memory', 'other'] as const).map((stageKey) => (
                            <button
                              key={`${message.id}-stage-filter-${stageKey}`}
                              className={`message-tool-filter${toolStageFilter === stageKey ? ' active' : ''}`}
                              type="button"
                              disabled={toolStageCounts[stageKey] === 0}
                              onClick={() => setToolStageFilter(message.id, stageKey)}
                            >
                              {toolStageLabel(stageKey, t)} ({toolStageCounts[stageKey]})
                            </button>
                          ))}
                        </div>
                        {!message.streaming && failedToolCount > 0 ? (
                          <div className="message-retry-context">
                            <button
                              className="message-retry-context-head"
                              type="button"
                              onClick={() => toggleRetryContextPanel(message.id)}
                              aria-expanded={!retryContextCollapsed}
                            >
                              <span className={`message-retry-context-chevron${retryContextCollapsed ? '' : ' expanded'}`} aria-hidden="true">
                                {'>'}
                              </span>
                              <span className="message-retry-context-title">{t('chat.retryContext.title')}</span>
                              <span className="message-retry-context-count">{t('chat.retryContext.lineCount', { count: retryContextLineCount })}</span>
                              {retryContextEdited ? <span className="message-retry-context-edited">{t('chat.retryContext.edited')}</span> : null}
                              <span className="message-retry-context-toggle">
                                {retryContextCollapsed ? t('chat.expandOps') : t('chat.collapseOps')}
                              </span>
                            </button>
                            <div className={`message-retry-context-body-wrap${retryContextCollapsed ? ' collapsed' : ''}`}>
                              <div className="message-retry-context-body">
                                <textarea
                                  className="message-retry-context-input"
                                  value={retryContextDraft}
                                  placeholder={t('chat.retryContext.placeholder')}
                                  onChange={(event) => updateRetryContextDraft(message.id, event.target.value)}
                                />
                                <div className="message-retry-context-actions">
                                  <button
                                    className="message-tool-filter"
                                    type="button"
                                    disabled={!retryContextDraft.trim()}
                                    onClick={() => void copyWithFeedback(`${message.id}-retryctx`, retryContextDraft)}
                                  >
                                    {copiedMarker === `${message.id}-retryctx` ? t('chat.copied') : t('chat.copyErrorContext')}
                                  </button>
                                  <button
                                    className="message-tool-filter"
                                    type="button"
                                    disabled={!hasRetryContextDraft}
                                    onClick={() => resetRetryContextDraft(message.id)}
                                  >
                                    {t('chat.retryContext.reset')}
                                  </button>
                                  <button
                                    className="message-tool-filter"
                                    type="button"
                                    disabled={!retryPromptTemplate.trim()}
                                    onClick={() => insertPromptToComposer(retryPromptTemplate)}
                                  >
                                    {t('chat.useRetryPrompt')}
                                  </button>
                                  <button
                                    className="message-tool-filter"
                                    type="button"
                                    onClick={() => void onRetryWithFallbackProvider(message.id, hasRetryContextDraft ? retryContextDraft : undefined)}
                                  >
                                    {t('chat.recovery.switchProviderRetry')}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {visibleToolEvents.length === 0 ? (
                          <div className="message-tool-empty">{hasToolFilterApplied ? t('chat.noOpsForFilters') : t('chat.noFailedOps')}</div>
                        ) : null}
                        {groupedToolEvents.map((group) => {
                          const stageId = `${message.id}-stage-${group.stage}`
                          const hasManualStageCollapse = Object.prototype.hasOwnProperty.call(collapsedToolStages, stageId)
                          const stageCollapsed = hasManualStageCollapse
                            ? collapsedToolStages[stageId] === true
                            : shouldCollapseStageByDefault(group.stage, group.items, latestToolEvent)
                          const stageState = stageStatus(group.items)
                          return (
                          <div key={stageId} className="message-tool-stage">
                            <button className="message-tool-stage-head" type="button" onClick={() => toggleToolStage(stageId)}>
                              <span className={`message-tool-stage-chevron${stageCollapsed ? '' : ' expanded'}`} aria-hidden="true">
                                {'>'}
                              </span>
                              <span className="message-tool-stage-title">{toolStageLabel(group.stage, t)}</span>
                              <span className={`message-tool-stage-status message-tool-stage-status-${stageState}`}>
                                {toolStatusLabel(stageState, t)}
                              </span>
                              <span className="message-tool-stage-count">{t('chat.operationCount', { count: group.items.length })}</span>
                            </button>
                            {stageCollapsed ? null : (
                            <div className="message-tool-stage-list">
                              {group.items.map((toolEvent, idx) => {
                                const itemId = `${message.id}-tool-${toolEvent.step}-${toolEvent.tool}-${toolEvent.timestamp}-${idx}`
                                const hasManualExpand = Object.prototype.hasOwnProperty.call(expandedToolItems, itemId)
                                const expandedToolItem = hasManualExpand ? expandedToolItems[itemId] === true : toolEvent.status !== 'success'
                                const durationMs =
                                  toolEvent.durationMs ??
                                  ((toolEvent.finishedAt ?? (toolEvent.status === 'running' ? toolNowTick : toolEvent.timestamp)) -
                                    (toolEvent.startedAt ?? toolEvent.timestamp))
                                const hasStructuredOutput =
                                  (toolEvent.tool === 'fs_list_dir' && Array.isArray(toolEvent.listItems)) ||
                                  (toolEvent.tool === 'fs_exists' && typeof toolEvent.exists === 'boolean') ||
                                  (toolEvent.tool === 'fs_read_text' && typeof toolEvent.readChars === 'number') ||
                                  (toolEvent.tool === 'fs_write_text' && typeof toolEvent.writeChars === 'number')

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
                                  {toolEvent.tool === 'fs_read_text' && toolEvent.readPreview ? (
                                    <div className="message-tool-read-card">
                                      <div className="message-tool-read-head">
                                        <span className="message-tool-read-path">{toolEvent.readPath ?? t('chat.unknownPath')}</span>
                                        <span className="message-tool-read-meta">
                                          {t('chat.readMeta', {
                                            lines: toolEvent.readLines ?? 0,
                                            chars: toolEvent.readChars ?? 0,
                                          })}
                                        </span>
                                      </div>
                                      <pre className="message-tool-read-preview">{toolEvent.readPreview}</pre>
                                    </div>
                                  ) : null}
                                  {toolEvent.tool === 'fs_write_text' && toolEvent.writePreview ? (
                                    <div className="message-tool-write-card">
                                      <div className="message-tool-write-head">
                                        <span className="message-tool-write-path">{toolEvent.writePath ?? t('chat.unknownPath')}</span>
                                        <span className="message-tool-write-meta">
                                          {t('chat.writeMeta', {
                                            lines: toolEvent.writeLines ?? 0,
                                            chars: toolEvent.writeChars ?? 0,
                                          })}
                                        </span>
                                      </div>
                                      <pre className="message-tool-write-preview">{toolEvent.writePreview}</pre>
                                    </div>
                                  ) : null}
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
                                        <div className="message-tool-item-line-wrap">
                                          <pre className="message-tool-item-line" title={toolEvent.inputPreview}>
                                            <span className="message-tool-item-label">{t('chat.input')}</span>{' '}
                                            {toolEvent.inputPreview}
                                          </pre>
                                          <button
                                            className="message-tool-copy-button"
                                            type="button"
                                            onClick={() =>
                                              void copyWithFeedback(`${itemId}-input`, `${t('chat.input')} ${toolEvent.inputPreview}`)
                                            }
                                          >
                                            {copiedMarker === `${itemId}-input` ? t('chat.copied') : t('chat.copy')}
                                          </button>
                                        </div>
                                      ) : null}
                                      {toolEvent.observationPreview && (!hasStructuredOutput || toolEvent.status === 'error') ? (
                                        <div className="message-tool-item-line-wrap">
                                          <pre className="message-tool-item-line" title={toolEvent.observationPreview}>
                                            <span className="message-tool-item-label">{t('chat.output')}</span>{' '}
                                            {toolEvent.observationPreview}
                                          </pre>
                                          <button
                                            className="message-tool-copy-button"
                                            type="button"
                                            onClick={() =>
                                              void copyWithFeedback(`${itemId}-output`, `${t('chat.output')} ${toolEvent.observationPreview ?? ''}`)
                                            }
                                          >
                                            {copiedMarker === `${itemId}-output` ? t('chat.copied') : t('chat.copy')}
                                          </button>
                                        </div>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                                )
                              })}
                            </div>
                            )}
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
      {activeStreamingMessage ? (
        <div className={`ai-live-ops${liveOpsCollapsed ? ' collapsed' : ''}`}>
          <button className="ai-live-ops-head" type="button" onClick={() => setLiveOpsCollapsed((prev) => !prev)}>
            <span className={`ai-live-ops-chevron${liveOpsCollapsed ? '' : ' expanded'}`} aria-hidden="true">
              {'>'}
            </span>
            <span className="ai-live-ops-title">{t('chat.thoughtProcess')}</span>
            <span className="ai-live-ops-count">{t('chat.operationCount', { count: activeLiveToolCount })}</span>
            <span className={`ai-live-ops-status ai-live-ops-status-${activeLiveLatestTool?.status ?? 'running'}`}>
              {toolStatusLabel(activeLiveLatestTool?.status ?? 'running', t)}
            </span>
            <span className="ai-live-ops-toggle">{liveOpsCollapsed ? t('chat.expandOps') : t('chat.collapseOps')}</span>
          </button>
          {liveOpsCollapsed ? (
            activeLiveSummary || activeStreamingMessage.streamId ? (
              <div className="ai-live-ops-summary">
                {activeLiveSummary || getStreamPhaseLabel(activeStreamingMessage.streamId)}
              </div>
            ) : null
          ) : (
            <div className="ai-live-ops-body">
              <div className="ai-live-ops-phase">{getStreamPhaseLabel(activeStreamingMessage.streamId)}</div>
              {activeLiveSummary ? <div className="ai-live-ops-summary">{activeLiveSummary}</div> : null}
              <div className="message-tool-toolbar ai-live-ops-toolbar">
                <button
                  className={`message-tool-filter${liveOpsFilter === 'all' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setLiveOpsFilter('all')}
                >
                  {t('chat.filterAll')}
                </button>
                <button
                  className={`message-tool-filter${liveOpsFilter === 'error' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setLiveOpsFilter('error')}
                >
                  {t('chat.filterFailed', { count: liveFailedToolCount })}
                </button>
                {liveFailedToolCount > 0 ? (
                  <button
                    className="message-tool-filter"
                    type="button"
                    disabled={!liveFailedOpsDigest.trim()}
                    onClick={() => void copyWithFeedback('live-failed-ops', liveFailedOpsDigest)}
                  >
                    {copiedMarker === 'live-failed-ops' ? t('chat.copied') : t('chat.copyFailedOps')}
                  </button>
                ) : null}
              </div>
              <div className="message-tool-toolbar message-tool-stage-toolbar ai-live-ops-toolbar">
                <button
                  className={`message-tool-filter${liveStageFilter === 'all' ? ' active' : ''}`}
                  type="button"
                  onClick={() => setLiveStageFilter('all')}
                >
                  {t('chat.stageFilterAll')}
                </button>
                {(['context', 'filesystem', 'memory', 'other'] as const).map((stageKey) => (
                  <button
                    key={`live-stage-filter-${stageKey}`}
                    className={`message-tool-filter${liveStageFilter === stageKey ? ' active' : ''}`}
                    type="button"
                    disabled={liveStageCounts[stageKey] === 0}
                    onClick={() => setLiveStageFilter(stageKey)}
                  >
                    {toolStageLabel(stageKey, t)} ({liveStageCounts[stageKey]})
                  </button>
                ))}
              </div>
              <div className="message-tool-stats">
                {liveStageFilter === 'all'
                  ? t('chat.opsStats', liveModeFilteredStats)
                  : t('chat.opsStatsFiltered', {
                      visible: liveVisibleStats.total,
                      total: liveModeFilteredStats.total,
                      running: liveVisibleStats.running,
                      done: liveVisibleStats.done,
                      failed: liveVisibleStats.failed,
                    })}
              </div>
              <div className="ai-live-ops-list" ref={liveOpsListRef}>
                {activeLiveToolCount === 0 ? (
                  <div className="ai-live-ops-empty">{t('chat.stepInProgress')}</div>
                ) : null}
                {activeLiveToolCount > 0 && visibleLiveToolEvents.length === 0 ? (
                  <div className="ai-live-ops-empty">
                    {liveOpsFilter !== 'all' || liveStageFilter !== 'all' ? t('chat.noOpsForFilters') : t('chat.noFailedOps')}
                  </div>
                ) : null}
                {groupedLiveToolEvents.map((group) => {
                  const stageId = `${activeLiveStreamId || 'live'}-live-stage-${group.stage}`
                  const hasManualLiveStageCollapse = Object.prototype.hasOwnProperty.call(collapsedLiveStages, stageId)
                  const liveStageCollapsed = hasManualLiveStageCollapse
                    ? collapsedLiveStages[stageId] === true
                    : shouldCollapseStageByDefault(group.stage, group.items, activeLiveLatestTool)
                  const liveStageState = stageStatus(group.items)
                  return (
                    <div key={stageId} className="ai-live-ops-stage">
                      <button
                        className="ai-live-ops-stage-head"
                        type="button"
                        onClick={() => toggleLiveStage(stageId)}
                        aria-expanded={!liveStageCollapsed}
                      >
                        <span className={`ai-live-ops-stage-chevron${liveStageCollapsed ? '' : ' expanded'}`} aria-hidden="true">
                          {'>'}
                        </span>
                        <span className="ai-live-ops-stage-title">{toolStageLabel(group.stage, t)}</span>
                        <span className={`ai-live-ops-stage-status ai-live-ops-stage-status-${liveStageState}`}>
                          {toolStatusLabel(liveStageState, t)}
                        </span>
                        <span className="ai-live-ops-stage-count">{t('chat.operationCount', { count: group.items.length })}</span>
                      </button>
                      <div className={`ai-live-ops-stage-content${liveStageCollapsed ? ' collapsed' : ''}`}>
                        <div className="ai-live-ops-stage-list">
                          {group.items.map((toolEvent, idx) => {
                            const liveToolId = `live-tool-${toolEvent.step}-${toolEvent.tool}-${toolEvent.timestamp}-${idx}`
                            const durationMs =
                              toolEvent.durationMs ??
                              ((toolEvent.finishedAt ?? (toolEvent.status === 'running' ? toolNowTick : toolEvent.timestamp)) -
                                (toolEvent.startedAt ?? toolEvent.timestamp))
                            const target = resolveToolEventTarget(toolEvent)
                            const canExpandDetail = hasLiveToolDetail(toolEvent)
                            const hasManualLiveItemExpand = Object.prototype.hasOwnProperty.call(expandedLiveItems, liveToolId)
                            const expandedLiveItem = hasManualLiveItemExpand
                              ? expandedLiveItems[liveToolId] === true
                              : toolEvent.status !== 'success'
                            return (
                              <div key={liveToolId} className={`ai-live-ops-item ai-live-ops-item-${toolEvent.status}`}>
                                <div className="ai-live-ops-item-main">
                                  <span className="ai-live-ops-item-step">#{toolEvent.step}</span>
                                  <span className="ai-live-ops-item-action">{toolDisplayName(toolEvent.tool, t)}</span>
                                  {target ? (
                                    <span className="ai-live-ops-item-target" title={target}>
                                      {target}
                                    </span>
                                  ) : null}
                                  <span className="ai-live-ops-item-state">{toolStatusLabel(toolEvent.status, t)}</span>
                                  <span className="ai-live-ops-item-duration">
                                    {formatDurationLabel(durationMs, toolEvent.status === 'running')}
                                  </span>
                                  {canExpandDetail ? (
                                    <button
                                      className="ai-live-ops-item-toggle"
                                      type="button"
                                      onClick={() => toggleLiveItem(liveToolId)}
                                      aria-expanded={expandedLiveItem}
                                    >
                                      {expandedLiveItem ? t('chat.stepCollapse') : t('chat.stepExpand')}
                                    </button>
                                  ) : null}
                                </div>
                                {canExpandDetail ? (
                                  <div className={`ai-live-ops-item-detail-wrap${expandedLiveItem ? ' expanded' : ''}`}>
                                    <div className="ai-live-ops-item-detail">
                                      {toolEvent.inputPreview ? (
                                        <div className="ai-live-ops-item-line-wrap">
                                          <pre className="ai-live-ops-item-line" title={toolEvent.inputPreview}>
                                            <span className="ai-live-ops-item-label">{t('chat.input')}</span>{' '}
                                            {toolEvent.inputPreview}
                                          </pre>
                                          <button
                                            className="message-tool-copy-button"
                                            type="button"
                                            onClick={() =>
                                              void copyWithFeedback(`${liveToolId}-input`, `${t('chat.input')} ${toolEvent.inputPreview}`)
                                            }
                                          >
                                            {copiedMarker === `${liveToolId}-input` ? t('chat.copied') : t('chat.copy')}
                                          </button>
                                        </div>
                                      ) : null}
                                      {toolEvent.observationPreview ? (
                                        <div className="ai-live-ops-item-line-wrap">
                                          <pre className="ai-live-ops-item-line" title={toolEvent.observationPreview}>
                                            <span className="ai-live-ops-item-label">{t('chat.output')}</span>{' '}
                                            {toolEvent.observationPreview}
                                          </pre>
                                          <button
                                            className="message-tool-copy-button"
                                            type="button"
                                            onClick={() =>
                                              void copyWithFeedback(`${liveToolId}-output`, `${t('chat.output')} ${toolEvent.observationPreview ?? ''}`)
                                            }
                                          >
                                            {copiedMarker === `${liveToolId}-output` ? t('chat.copied') : t('chat.copy')}
                                          </button>
                                        </div>
                                      ) : null}
                                      {Array.isArray(toolEvent.listItems) && toolEvent.listItems.length > 0 ? (
                                        <div className="ai-live-ops-item-tree">
                                          {toolEvent.listItems.map((item, treeIdx) => (
                                            <div key={`${item.kind}-${item.name}-${treeIdx}`} className="ai-live-ops-item-tree-entry">
                                              <span className={`ai-live-ops-item-tree-kind ai-live-ops-item-tree-kind-${item.kind}`}>
                                                {item.kind === 'dir' ? t('chat.treeDir') : t('chat.treeFile')}
                                              </span>
                                              <span className="ai-live-ops-item-tree-name">{item.name}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}

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
            <select
              className={`ai-select ai-select-compact${providerSelectInvalid ? ' ai-select-compact-warning' : ''}`}
              value={activeProviderId}
              onChange={(event) => onActiveProviderChange(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={provider.disabled}>
                  {provider.statusLabel ? `${provider.name} (${provider.statusLabel})` : provider.name}
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
