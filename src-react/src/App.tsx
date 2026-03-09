import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { LexicalEditor as LexicalEditorType } from 'lexical'
import './App.css'
import { LexicalEditor } from './components/LexicalEditor'
import type { EditorConfig } from './types/editor'
import { EDITOR_NAMESPACE } from './branding'
import {
  createFile,
  createDir,
  deleteEntry,
  createNovelWork,
  getApiKeyStatus,
  getAppSettings,
  forgetImportedWork,
  getBookshelfState,
  initNovel,
  isTauriApp,
  listWorkTree,
  openFolderDialog,
  readText,
  rememberImportedWork,
  getWritingAssistants,
  setWritingAssistants,
  setApiKey,
  setAppSettings,
  setLaunchMode,
  saveChatSession,
  setWorkRoot,
  testProviderConnectivity,
  writeText,
  type AiEditApplyMode,
  type AppSettings,
  type FsEntry,
  type LaunchMode,
  type ModelProvider,
  type ProviderConnectivityResult,
  type WorkItem,
  type WorkSource,
  type WritingAssistant,
} from './tauri'
import { useDiff } from './contexts/DiffContext'
import { modificationService, aiAssistanceService, editorManager, editorConfigManager, uiSettingsManager, novelPlannerService, upsertAIActionTrace } from './services'
import type { AIAssistanceResponse, AIActionListItem, AIActionTraceItem, ChangeSet, EditorUserConfig, NovelTask, SessionPlannerState, WriterMode } from './services'
import { runAutoLongWriteWorkflow } from './services/autoLongWriteWorkflow'
import { runPlannerQueueWorkflow } from './services/plannerQueueWorkflow'
import { cleanupStreamRefs, type StreamMapRefs } from './services/streamRefs'
import { parseComposerInput } from './services/chatComposer'
import { appendStreamTextWithOverlap, formatElapsedLabel } from './services/chatStreamText'
import { resolveInlineReferencesInput } from './services/inlineReferences'
import { useMemoryWorkbench } from './hooks/useMemoryWorkbench'
import DiffView from './components/DiffView'
import EditorContextMenu from './components/EditorContextMenu'
import { ChapterManager } from './components/ChapterManager'
import { CharacterManager } from './components/CharacterManager'
import { PlotLineManager } from './components/PlotLineManager'
import { WritingGoalPanel } from './components/WritingGoalPanel'
import { RiskPanel } from './components/RiskPanel'
import { StatusBar } from './components/StatusBar'
import { SearchPanel, type SearchResult } from './components/Search'
import { TabBar } from './components/TabBar'
import { handleFileSaveError, clearBackupContent } from './utils/fileSaveErrorHandler'
import { useAutoSave, clearAutoSavedContent } from './hooks/useAutoSave'
import { useProjectWritingSettings } from './hooks/useProjectWritingSettings'
import { useAutoStoryNavigation } from './hooks/useAutoStoryNavigation'
import { useTaskQualityValidator } from './hooks/useTaskQualityValidator'
import { useChatSessionWorkbench } from './hooks/useChatSessionWorkbench'
import { APP_LOCALES, type AppLocale, useI18n } from './i18n'
import { logError } from './utils/errorLogger'
import { RecoveryDialog } from './components/RecoveryDialog'
import { BookshelfPage } from './components/ProjectPickerPage'
import { NovelStructurePanel } from './components/NovelStructurePanel'
import { HistoryPanel } from './components/HistoryPanel'
import { AppIcon } from './components/icons/AppIcon'
import { AIChatPanel } from './components/chat/AIChatPanel'
import {
  COMMON_PROVIDER_PRESETS,
  CUSTOM_PROVIDER_PRESET_KEY,
  defaultBaseUrlByCustomProviderApiFormat,
  inferProviderPresetKey,
  kindFromCustomProviderApiFormat,
  providerKindLabel,
  type CustomProviderApiFormat,
} from './config/providerPresets'

type OpenFile = {
  path: string
  name: string
  content: string
  dirty: boolean
}

type OpenByPathOptions = {
  forceReload?: boolean
}

type ChatItem = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  cancelled?: boolean
  failureKind?: ChatFailureKind
  streamId?: string
  changeSet?: ChangeSet
  toolEvents?: AgentToolActivity[]
  versionGroupId?: string
  versionIndex?: number
  versionCount?: number
  timestamp?: number
}

type AssistantVersion = {
  content: string
  changeSet?: ChangeSet
  cancelled?: boolean
  failureKind?: ChatFailureKind
  timestamp: number
}

type ChatFailureKind = 'provider' | 'timeout' | 'runtime' | 'generic' | 'cancelled'

type BackendChangeSet = {
  id: string
  timestamp: number
  files: Array<{
    filePath: string
    originalContent: string
    modifications: Array<{
      id: string
      type: 'add' | 'delete' | 'modify'
      lineStart: number
      lineEnd: number
      originalText?: string
      modifiedText?: string
      status: 'pending' | 'accepted' | 'rejected'
    }>
    status: 'pending' | 'partial' | 'accepted' | 'rejected'
  }>
}

type ImportedChangeSet = {
  changeSet: ChangeSet
  originalContent: string
}

type AgentToolListItem = AIActionListItem
type AgentToolActivity = AIActionTraceItem

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function normalizeStatus(v: unknown): 'pending' | 'partial' | 'accepted' | 'rejected' {
  return v === 'accepted' || v === 'rejected' || v === 'partial' ? v : 'pending'
}

function normalizeModStatus(v: unknown): 'pending' | 'accepted' | 'rejected' {
  return v === 'accepted' || v === 'rejected' ? v : 'pending'
}

function normalizeModType(v: unknown): 'add' | 'delete' | 'modify' {
  return v === 'add' || v === 'delete' ? v : 'modify'
}

function parseBackendChangeSets(raw: unknown): ImportedChangeSet[] {
  if (!isRecord(raw) || !Array.isArray(raw.files)) return []

  const parsed = raw as BackendChangeSet
  const baseId = typeof parsed.id === 'string' && parsed.id ? parsed.id : `changeset-${Date.now()}`
  const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now()
  const totalFiles = parsed.files.length
  const imported: ImportedChangeSet[] = []

  parsed.files.forEach((file, fileIdx) => {
    if (!isRecord(file)) return
    const filePath = typeof file.filePath === 'string' ? file.filePath : ''
    if (!filePath) return
    const originalContent = typeof file.originalContent === 'string' ? file.originalContent : ''
    const modsRaw = Array.isArray(file.modifications) ? file.modifications : []

    const modifications = modsRaw.flatMap((mod, modIdx) => {
      if (!isRecord(mod)) return []
      const lineStartRaw = typeof mod.lineStart === 'number' ? mod.lineStart : Number(mod.lineStart ?? 1)
      const lineEndRaw = typeof mod.lineEnd === 'number' ? mod.lineEnd : Number(mod.lineEnd ?? lineStartRaw)
      const lineStart = Number.isFinite(lineStartRaw) ? Math.max(1, Math.floor(lineStartRaw)) : 1
      const lineEnd = Number.isFinite(lineEndRaw) ? Math.max(lineStart, Math.floor(lineEndRaw)) : lineStart
      return [
        {
          id: typeof mod.id === 'string' && mod.id ? mod.id : `${baseId}-mod-${fileIdx}-${modIdx}`,
          type: normalizeModType(mod.type),
          lineStart,
          lineEnd,
          originalText: typeof mod.originalText === 'string' ? mod.originalText : undefined,
          modifiedText: typeof mod.modifiedText === 'string' ? mod.modifiedText : undefined,
          status: normalizeModStatus(mod.status),
        },
      ]
    })

    let additions = 0
    let deletions = 0
    for (const mod of modifications) {
      if (mod.type === 'add') additions += 1
      if (mod.type === 'delete') deletions += 1
      if (mod.type === 'modify') {
        additions += 1
        deletions += 1
      }
    }

    const changeSet: ChangeSet = {
      id: totalFiles > 1 ? `${baseId}:${fileIdx + 1}` : baseId,
      timestamp,
      filePath,
      modifications,
      stats: { additions, deletions },
      status: normalizeStatus(file.status),
    }

    imported.push({ changeSet, originalContent })
  })

  return imported
}

function stripInternalToolTrace(text: string): string {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  const actionIndex = lines.findIndex((line) => /^\s*ACTION\s*:/i.test(line))
  if (actionIndex < 0) return text
  const hasInput = lines.slice(actionIndex).some((line) => /^\s*INPUT\s*:/i.test(line))
  if (!hasInput) return text
  return lines.slice(0, actionIndex).join('\n').trimEnd()
}

function upsertToolActivity(list: AgentToolActivity[] | undefined, incoming: AgentToolActivity): AgentToolActivity[] {
  return upsertAIActionTrace(list, incoming)
}

type ChatContextMenuState = {
  x: number
  y: number
  messageId: string
  role: 'user' | 'assistant'
  message: string
  selection: string
}

type EditorContextMenuState = {
  x: number
  y: number
  selectedText: string
}

type UISettingsState = {
  theme: 'light' | 'dark'
  density: 'compact' | 'comfortable'
  motion: 'full' | 'reduced'
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelWidth: number
}

type SelectionOffsets = {
  start: number
  end: number
}

type SelectionLineRange = {
  startLine: number
  endLine: number
}

type ExtendedLexicalEditor = LexicalEditorType & {
  getSelectedText?: () => string
  getContextBeforeCursor?: (maxChars: number) => string
  getContent?: () => string
  getSelectionOffsets?: () => SelectionOffsets | null
}

type InlineAIAssistCommand = 'polish' | 'expand' | 'condense'

type StreamWaiter = {
  resolve: () => void
  reject: (error: Error) => void
}

type SendChatOptions = {
  skipModeWrap?: boolean
  sourceMessages?: ChatItem[]
  useExistingLastUser?: boolean
  hideUserEcho?: boolean
  versionGroupId?: string
  overrideProviderId?: string
}

type AssistantReplayContext = {
  replayHistory: ChatItem[]
  replayUser: ChatItem
  versionGroupId: string
  retryContext: string
}

type ResolveReplayOptions = {
  persistCurrentVersion?: boolean
  allowWhenStreaming?: boolean
}

type SettingsTabKey = 'general' | 'editor' | 'models'

type ProviderProbeViewResult = {
  kind: 'ok' | 'error'
  text: string
  detail?: string
}

type RollbackTurnState = {
  userId: string
  assistantId: string
  streamId: string
  userContent: string
  changeSetIds: string[]
}

type SearchPanelOptions = {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

type TranslateText = (key: string, params?: Record<string, string | number>) => string

const MASTER_PLAN_RELATIVE_PATH = '.novel/plans/master-plan.md'
const FIRST_TOKEN_RETRY_TIMEOUT_MS = 120_000
const AUTO_RETRY_MAX_PER_GROUP = 1
const STREAM_MANUAL_CANCEL_GRACE_MS = 6_000
const STREAM_PRETOKEN_HARD_TIMEOUT_MS = 360_000
const STREAM_IDLE_HARD_TIMEOUT_MS = 120_000
const STREAM_TOTAL_HARD_TIMEOUT_MS = 900_000
const FILE_SEARCH_RESULT_LIMIT = 300
const SEARCHABLE_TEXT_EXTENSIONS = new Set(['md', 'txt', 'json', 'toml', 'yaml', 'yml'])

function normalizeRelativePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectSearchableFiles(node: FsEntry | null): string[] {
  if (!node) return []
  const files: string[] = []

  const walk = (entry: FsEntry) => {
    if (entry.kind === 'file') {
      const normalized = normalizeRelativePath(entry.path)
      const extension = normalized.split('.').pop()?.toLowerCase() ?? ''
      if (SEARCHABLE_TEXT_EXTENSIONS.has(extension)) {
        files.push(normalized)
      }
      return
    }

    for (const child of entry.children ?? []) {
      if (child.name === '.git' || child.name === 'node_modules' || child.name === 'target') continue
      walk(child)
    }
  }

  walk(node)
  return files
}

function buildSearchRegex(query: string, options: SearchPanelOptions): RegExp {
  const base = options.regex ? query : escapeRegExp(query)
  const source = options.wholeWord ? `\\b${base}\\b` : base
  return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
}

function countMatches(line: string, regex: RegExp): number {
  regex.lastIndex = 0
  let count = 0
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(line)) !== null) {
    count += 1
    if (match[0].length === 0) {
      regex.lastIndex += 1
    }
    if (count > 999) break
  }
  return count
}

function shortText(text: string, max = 180): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}...`
}

function inferFailureKindFromText(rawMessage: string, stage?: string): ChatFailureKind {
  const lower = rawMessage.toLowerCase()
  if (stage === 'timeout' || lower.includes('timed out') || lower.includes('timeout')) return 'timeout'
  if (
    stage === 'provider' ||
    lower.includes('api key') ||
    lower.includes('provider=') ||
    lower.includes('base url') ||
    lower.includes('model id') ||
    lower.includes('keyring') ||
    lower.includes('no providers configured')
  ) {
    return 'provider'
  }
  if (
    lower.includes('tauri runtime') ||
    lower.includes('workspace') ||
    lower.includes('not currently opened') ||
    lower.includes('init')
  ) {
    return 'runtime'
  }
  return 'generic'
}

function formatProviderProbeErrorMessage(rawMessage: string): string {
  const raw = rawMessage.trim()
  if (!raw) return 'Connectivity check failed. Please try again.'
  const lower = raw.toLowerCase()
  const statusMatch = lower.match(/\bhttp\s+(\d{3})\b/)
  const statusCode = statusMatch ? Number(statusMatch[1]) : null

  if (lower.includes('api key not found') || lower.includes('keyring')) {
    return 'No API key was found. Set and save the API key first.'
  }
  if (statusCode === 400) {
    if (lower.includes('model') && lower.includes('not found')) {
      return 'Model not found (HTTP 400). Check the model ID.'
    }
    return 'Invalid request (HTTP 400). Check base URL and model ID.'
  }
  if (statusCode === 401 || statusCode === 403) {
    return `Authentication failed (HTTP ${statusCode}). Check API key and permissions.`
  }
  if (statusCode === 404) {
    return 'Endpoint not found (HTTP 404). Check base URL.'
  }
  if (statusCode === 408) {
    return 'Request timed out (HTTP 408). Please try again.'
  }
  if (statusCode === 409) {
    return 'Request conflict (HTTP 409). Please retry.'
  }
  if (statusCode === 422) {
    return 'Request format is valid but unprocessable (HTTP 422). Check model and parameters.'
  }
  if (statusCode === 429) {
    return 'Rate limited or quota exceeded (HTTP 429). Check limits and balance.'
  }
  if (statusCode && statusCode >= 500) {
    return `Provider service is temporarily unavailable (HTTP ${statusCode}). Try again later.`
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Connection timed out. Check network and try again.'
  }
  if (lower.includes('dns') || lower.includes('name or service not known') || lower.includes('failed to lookup address information')) {
    return 'DNS resolution failed. Check whether base URL is reachable.'
  }
  if (lower.includes('connection refused')) {
    return 'Connection refused. Confirm service address and port.'
  }
  if (lower.includes('certificate') || lower.includes('tls')) {
    return 'TLS certificate validation failed. Check HTTPS certificate settings.'
  }
  if (lower.includes('model') && lower.includes('not found')) {
    return 'Model not found. Check model ID.'
  }

  return `Connectivity check failed: ${shortText(raw, 220)}`
}
function formatProviderProbeSuccessMessage(result: ProviderConnectivityResult): string {
  const status = Number.isFinite(result.status_code) ? result.status_code : 200
  const latency = Math.max(1, Math.round(result.latency_ms))
  return `Connectivity OK - HTTP ${status} - ${latency}ms`
}

function formatProviderProbeDetail(rawMessage: string): string | undefined {
  const text = rawMessage.trim()
  if (!text) return undefined
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text
}

async function preflightChatProviderIssue(
  settings: AppSettings | null,
  providerId: string,
  t: TranslateText,
): Promise<string | null> {
  if (!settings) {
    return t('app.chat.preflight.settingsLoading')
  }
  if (settings.providers.length === 0) {
    return t('app.chat.preflight.noProvider')
  }
  const provider = settings.providers.find((item) => item.id === providerId)
  if (!provider) {
    return t('app.chat.preflight.providerMissing')
  }
  if (!provider.base_url.trim()) {
    return t('app.chat.preflight.baseUrlMissing', { provider: provider.name })
  }
  if (!provider.model_name.trim()) {
    return t('app.chat.preflight.modelMissing', { provider: provider.name })
  }
  if (!isTauriApp()) return null
  try {
    const hasApiKey = await getApiKeyStatus(provider.id)
    if (!hasApiKey) {
      return t('app.chat.preflight.apiKeyMissing', { provider: provider.name })
    }
  } catch {
    // Let backend perform final validation when keyring status cannot be read.
  }
  return null
}

function getProviderAvailability(
  provider: ModelProvider,
  hasApiKey: boolean,
  apiKeyKnown: boolean,
  tauriRuntime: boolean,
  t: TranslateText,
): { ready: boolean; statusLabel: string } {
  if (!provider.base_url.trim()) {
    return { ready: false, statusLabel: t('chat.provider.missingBaseUrl') }
  }
  if (!provider.model_name.trim()) {
    return { ready: false, statusLabel: t('chat.provider.missingModel') }
  }
  if (tauriRuntime && apiKeyKnown && !hasApiKey) {
    return { ready: false, statusLabel: t('chat.provider.missingApiKey') }
  }
  return { ready: true, statusLabel: t('chat.provider.ready') }
}

function extractJsonPreviewField(inputPreview: string, field: 'path' | 'from' | 'to'): string | null {
  const matcher = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`)
  const match = inputPreview.match(matcher)
  if (!match?.[1]) return null
  return match[1]
}

function resolveToolActivityTarget(activity: AgentToolActivity): string {
  if (activity.readPath?.trim()) return activity.readPath.trim()
  if (activity.writePath?.trim()) return activity.writePath.trim()
  const inputPreview = activity.inputPreview ?? ''
  const path = extractJsonPreviewField(inputPreview, 'path')
  if (path) return path
  const from = extractJsonPreviewField(inputPreview, 'from')
  const to = extractJsonPreviewField(inputPreview, 'to')
  if (from && to) return `${from} -> ${to}`
  return ''
}

function buildRetryContextFromToolEvents(toolEvents: AgentToolActivity[] | undefined, t: TranslateText): string {
  if (!toolEvents || toolEvents.length === 0) return ''
  const failed = toolEvents.filter((event) => event.status === 'error')
  if (failed.length === 0) return ''
  const recentFailed = failed.slice(-3)
  const lines = recentFailed.map((event, idx) => {
    const target = resolveToolActivityTarget(event)
    const detailSource =
      event.observationPreview || event.readPreview || event.writePreview || event.inputPreview || ''
    const detail = shortText(detailSource.replace(/\s+/g, ' ').trim(), 220)
    const targetPart = target ? ` | ${target}` : ''
    const detailPart = detail ? ` | ${detail}` : ''
    return `${idx + 1}. #${event.step} ${event.tool}${targetPart}${detailPart}`
  })
  return `${t('chat.retryContext.header')}\n${lines.join('\n')}\n${t('chat.retryContext.instruction')}`
}

function App() {
  const { locale, setLocale, t } = useI18n()

  // Diff Context
  const diffContext = useDiff()

  // DiffView State
  const [showDiffPanel, setShowDiffPanel] = useState(false)
  const [activeDiffTab, setActiveDiffTab] = useState<string | null>(null)

  // Modern UI State
  const initialUISettings = uiSettingsManager.getSettings() as UISettingsState
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(initialUISettings.theme)
  const [uiDensity, setUiDensity] = useState<'compact' | 'comfortable'>(initialUISettings.density)
  const [uiMotion, setUiMotion] = useState<'full' | 'reduced'>(initialUISettings.motion)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialUISettings.sidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState<number>(initialUISettings.sidebarWidth)
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(initialUISettings.rightPanelWidth)
  const resizeStateRef = useRef<
    | {
        target: 'sidebar' | 'right'
        startX: number
        startWidth: number
      }
    | null
  >(null)

  // Activity Bar State
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'history' | 'chapters' | 'characters' | 'plotlines' | 'risk'>('files')
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'graph' | 'writing-goal' | null>('chat')

  // Workspace & Files
  const [appView, setAppView] = useState<'bookshelf' | 'studio'>('bookshelf')
  const [workPathInput] = useState('')
  const [workRoot, setWorkRootState] = useState<string | null>(null)
  const [bookshelfRoot, setBookshelfRoot] = useState<string>('')
  const [recentWorks, setRecentWorks] = useState<WorkItem[]>([])
  const [importedWorks, setImportedWorks] = useState<WorkItem[]>([])
  const [launchMode, setLaunchModeState] = useState<LaunchMode>('picker')
  const [lastWorkPath, setLastWorkPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New state for model modal
  const [showModelModal, setShowModelModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Partial<ModelProvider>>({})
  const [editingProviderPreset, setEditingProviderPreset] = useState<string>(COMMON_PROVIDER_PRESETS[0]?.key ?? CUSTOM_PROVIDER_PRESET_KEY)
  const [editingCustomProviderApiFormat, setEditingCustomProviderApiFormat] = useState<CustomProviderApiFormat>('openai')
  const [isNewProvider, setIsNewProvider] = useState(true)
  const [providerProbeRunning, setProviderProbeRunning] = useState(false)
  const [providerProbeResult, setProviderProbeResult] = useState<ProviderProbeViewResult | null>(null)

  // Editors & Refs
  const editorRef = useRef<LexicalEditorType | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const aiMessagesRef = useRef<HTMLDivElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const autoOpenedRef = useRef(false)
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const SIDEBAR_WIDTH_MIN = 200
  const SIDEBAR_WIDTH_MAX = 420
  const RIGHT_PANEL_WIDTH_MIN = 260
  const RIGHT_PANEL_WIDTH_MAX = 520

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatAutoScroll, setChatAutoScroll] = useState(true)
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState | null>(null)
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null)
  const chatMessagesRef = useRef<ChatItem[]>([])
  const rollbackTurnStackRef = useRef<RollbackTurnState[]>([])
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  // Planner / Writer Mode State
  const [writerMode, setWriterMode] = useState<WriterMode>('normal')
  const writerModeRef = useRef<WriterMode>('normal')
  const [plannerState, setPlannerState] = useState<SessionPlannerState | null>(null)
  const [plannerTasks, setPlannerTasks] = useState<NovelTask[]>([])
  const [plannerBusy, setPlannerBusy] = useState(false)
  const [plannerQueueRunning, setPlannerQueueRunning] = useState(false)
  const [plannerLastRunError, setPlannerLastRunError] = useState<string | null>(null)
  const [autoLongWriteEnabled, setAutoLongWriteEnabled] = useState(false)
  const [autoLongWriteRunning, setAutoLongWriteRunning] = useState(false)
  const [autoLongWriteStatus, setAutoLongWriteStatus] = useState('')

  const {
    memoryIndexLoading,
    characterStateIndexContent,
    foreshadowIndexContent,
    characterStateIndexMeta,
    foreshadowIndexMeta,
    refreshMemoryIndices,
    onSaveMemoryIndex,
    onToggleMemoryIndexLock,
    onRestoreMemoryIndexAuto,
  } = useMemoryWorkbench({
    workRoot,
    activePath,
    tree,
    isTauriRuntime: isTauriApp(),
    plannerService: novelPlannerService,
  })
  const autoLongWriteStopRef = useRef(false)
  const plannerStopRef = useRef(false)
  const streamWaitersRef = useRef<Map<string, StreamWaiter>>(new Map())
  const streamFailuresRef = useRef<Set<string>>(new Set())
  const streamOutputRef = useRef<Map<string, string>>(new Map())
  const streamAssistantGroupRef = useRef<Map<string, string>>(new Map())
  const streamAssistantIdRef = useRef<Map<string, string>>(new Map())
  const manualCancelledStreamsRef = useRef<Set<string>>(new Set())
  const versionGroupAutoRetryCountRef = useRef<Map<string, number>>(new Map())
  const streamStartedAtRef = useRef<Map<string, number>>(new Map())
  const streamLastTokenAtRef = useRef<Map<string, number>>(new Map())
  const assistantVersionsRef = useRef<Map<string, AssistantVersion[]>>(new Map())
  const streamRefs = useMemo<StreamMapRefs>(
    () => ({
      streamOutputRef,
      streamAssistantGroupRef,
      streamAssistantIdRef,
      manualCancelledStreamsRef,
      streamStartedAtRef,
      streamLastTokenAtRef,
    }),
    [],
  )
  const [streamPhaseById, setStreamPhaseById] = useState<Record<string, string>>({})
  const [streamUiTick, setStreamUiTick] = useState(0)

  // Settings & Agents
  const [appSettings, setAppSettingsState] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>('general')
  const settingsOpenTabRef = useRef<SettingsTabKey | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [writingAssistantsState, setWritingAssistantsState] = useState<WritingAssistant[]>([])
  const [assistantEditorId, setAssistantEditorId] = useState<string>('')
  const [settingsSnapshot, setSettingsSnapshot] = useState<AppSettings | null>(null)
  const [writingAssistantSnapshots, setWritingAssistantSnapshots] = useState<WritingAssistant[] | null>(null)
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})

  // Recovery State
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false)

  // Editor Configuration State
  const [editorUserConfig, setEditorUserConfig] = useState<EditorUserConfig>(editorConfigManager.getConfig())

  // Stats & Visuals
  const {
    settings: projectWritingSettings,
    updateSettings: updateProjectWritingSettings,
    loadSettings: loadProjectWritingSettings,
    saveSettings: saveProjectWritingSettings,
  } = useProjectWritingSettings(workRoot)
  const chapterWordTarget = projectWritingSettings.chapterWordTarget
  const autoLongWriteMaxRounds = projectWritingSettings.autoMaxRounds
  const autoLongWriteMinChars = projectWritingSettings.autoMinChars
  const autoLongWriteMaxChars = projectWritingSettings.autoMaxChars
  const autoLongWriteMaxChapterAdvances = projectWritingSettings.autoMaxChapterAdvances
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])
  const { validateTaskQuality } = useTaskQualityValidator()

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
  const openFileContentMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const file of openFiles) {
      map.set(normalizeRelativePath(file.path), file.content)
    }
    return map
  }, [openFiles])
  const searchableFilePaths = useMemo(() => collectSearchableFiles(tree), [tree])
  const isMarkdownFile = useMemo(() => !!activeFile && activeFile.path.toLowerCase().endsWith('.md'), [activeFile])
  const activeCharCount = useMemo(() => {
    if (!activeFile) return 0
    return activeFile.content.replace(/\s/g, '').length
  }, [activeFile])
  const activeDocumentPreview = useMemo(() => {
    if (!activeFile) return ''
    const firstMeaningfulLine = activeFile.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (!firstMeaningfulLine) return ''
    return firstMeaningfulLine.length > 140 ? `${firstMeaningfulLine.slice(0, 140)}...` : firstMeaningfulLine
  }, [activeFile])
  const activeWorkLabel = useMemo(() => {
    if (!workRoot) return null
    const parts = workRoot.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? workRoot
  }, [workRoot])
  const activeStreamingMessage = useMemo(
    () => [...chatMessages].reverse().find((m) => m.role === 'assistant' && m.streaming && m.streamId) ?? null,
    [chatMessages],
  )
  const latestCompletedAssistant = useMemo(
    () => [...chatMessages].reverse().find((m) => m.role === 'assistant' && !m.streaming) ?? null,
    [chatMessages],
  )
  const latestCompletedAssistantId = latestCompletedAssistant?.id ?? null
  const activeStreamId = activeStreamingMessage?.streamId ?? null
  const isChatStreaming = !!activeStreamId
  const canRegenerateLatest = !!latestCompletedAssistant && !isChatStreaming
  const autoToggleDisabled = !activeFile || plannerQueueRunning || (!autoLongWriteEnabled && isChatStreaming)
  const showStopAction = isChatStreaming || autoLongWriteRunning
  const canRollbackLastTurn = useMemo(() => {
    const stack = rollbackTurnStackRef.current
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const turn = stack[i]
      const hasUser = chatMessages.some((m) => m.id === turn.userId && m.role === 'user')
      const hasAssistant = chatMessages.some((m) => m.id === turn.assistantId && m.role === 'assistant')
      if (hasUser && hasAssistant) return true
    }
    return false
  }, [chatMessages])
  useEffect(() => {
    if (!isChatStreaming) return
    const timer = window.setInterval(() => {
      setStreamUiTick((prev) => (prev + 1) % 1_000_000)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isChatStreaming])
  const scrollChatToBottom = useCallback((smooth = false) => {
    const panel = aiMessagesRef.current
    if (!panel) return
    panel.scrollTo({ top: panel.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  const onChatScrollToBottom = useCallback(() => {
    setChatAutoScroll(true)
    scrollChatToBottom(true)
  }, [scrollChatToBottom])
  const activeWritingAssistantId = appSettings?.active_writing_assistant_id ?? appSettings?.active_agent_id ?? ''
  const chatAssistantOptions = useMemo(() => writingAssistantsState.map((assistant) => ({ id: assistant.id, name: assistant.name })), [writingAssistantsState])
  const chatProviderOptions = useMemo(
    () => {
      const tauriRuntime = isTauriApp()
      return (appSettings?.providers ?? []).map((provider) => {
        const hasInlineKey = provider.api_key.trim().length > 0
        const hasPersistedKey = apiKeyStatus[provider.id] === true
        const apiKeyKnown = hasInlineKey || Object.prototype.hasOwnProperty.call(apiKeyStatus, provider.id)
        const availability = getProviderAvailability(provider, hasInlineKey || hasPersistedKey, apiKeyKnown, tauriRuntime, t)
        return {
          id: provider.id,
          name: provider.name,
          statusLabel: availability.statusLabel,
          disabled: !availability.ready,
        }
      })
    },
    [apiKeyStatus, appSettings, t],
  )
  const upsertAssistantVersion = useCallback((groupId: string, version: AssistantVersion): { index: number; count: number } => {
    const map = assistantVersionsRef.current
    const list = map.get(groupId) ?? []
    const existingIndex = list.findIndex((item) => item.content === version.content)
    if (existingIndex >= 0) {
      const existing = list[existingIndex]
      list[existingIndex] = {
        ...existing,
        changeSet: version.changeSet ?? existing.changeSet,
        cancelled: version.cancelled ?? existing.cancelled,
        failureKind: version.failureKind ?? existing.failureKind,
      }
      map.set(groupId, list)
      return { index: existingIndex, count: list.length }
    }
    list.push(version)
    map.set(groupId, list)
    return { index: list.length - 1, count: list.length }
  }, [])
  const getStreamPhaseLabel = useCallback(
    (streamId?: string): string => {
      if (!streamId) return t('chat.phase.processing')
      const phase = streamPhaseById[streamId]
      const now = Date.now()
      const startedAt = streamStartedAtRef.current.get(streamId) ?? now
      const lastTokenAt = streamLastTokenAtRef.current.get(streamId) ?? startedAt
      const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000))
      const idleSec = Math.max(0, Math.floor((now - lastTokenAt) / 1000))
      let base = t('chat.phase.processing')
      switch (phase) {
        case 'initializing':
          base = t('chat.phase.initializing')
          break
        case 'thinking':
          base = t('chat.phase.thinking')
          break
        case 'responding':
          base = idleSec >= 15 ? t('chat.phase.waitingNextChunk') : t('chat.phase.streaming')
          break
        case 'retrying':
          base = t('chat.phase.retrying')
          break
        default:
          base = t('chat.phase.processing')
          break
      }
      return elapsedSec > 0 ? `${base} (${formatElapsedLabel(elapsedSec)})` : base
    },
    [streamPhaseById, streamUiTick, t],
  )

  const effectiveProviderId = useMemo(() => {
    if (!appSettings) return ''
    const active = appSettings.active_provider_id
    if (active && appSettings.providers.some((p) => p.id === active)) return active
    return appSettings.providers[0]?.id ?? ''
  }, [appSettings])
  const activeChatProviderOption = useMemo(
    () => chatProviderOptions.find((provider) => provider.id === effectiveProviderId) ?? null,
    [chatProviderOptions, effectiveProviderId],
  )
  const activeChatProviderInvalid = activeChatProviderOption ? activeChatProviderOption.disabled === true : false

  // Editor configuration for Lexical
  const editorConfig: EditorConfig = useMemo(() => ({
    namespace: EDITOR_NAMESPACE,
    theme: {
      paragraph: 'editor-paragraph',
      text: {
        bold: 'editor-text-bold',
        italic: 'editor-text-italic',
        underline: 'editor-text-underline',
      },
    },
    onError: (error: Error) => {
      console.error('Lexical Editor Error:', error)
      logError('Editor error in App', error, {
        activePath,
        activeFile: activeFile?.name,
      })
      setError(error.message)
    },
    nodes: [],
  }), [activePath, activeFile])

  // Auto-save active file content to localStorage every 30 seconds
  useAutoSave({
    filePath: activeFile?.path || '',
    content: activeFile?.content || '',
    enabled: !!activeFile && activeFile.dirty,
    intervalMs: 30000, // 30 seconds
  })

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages])

  useEffect(() => {
    writerModeRef.current = writerMode
  }, [writerMode])

  useEffect(() => {
    if (!chatAutoScroll) return
    const timer = window.setTimeout(() => {
      scrollChatToBottom()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [chatMessages, chatAutoScroll, scrollChatToBottom])

  useEffect(() => {
    uiSettingsManager.updateSettings({
      theme,
      density: uiDensity,
      motion: uiMotion,
      sidebarCollapsed,
      sidebarWidth,
      rightPanelWidth,
    })
  }, [theme, uiDensity, uiMotion, sidebarCollapsed, sidebarWidth, rightPanelWidth])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.setAttribute('data-density', uiDensity)
    document.documentElement.setAttribute('data-motion', uiMotion)
  }, [theme, uiDensity, uiMotion])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  const clampSidebarWidth = useCallback(
    (value: number) => Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, value)),
    [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX],
  )

  const clampRightPanelWidth = useCallback(
    (value: number) => Math.max(RIGHT_PANEL_WIDTH_MIN, Math.min(RIGHT_PANEL_WIDTH_MAX, value)),
    [RIGHT_PANEL_WIDTH_MIN, RIGHT_PANEL_WIDTH_MAX],
  )

  const stopResize = useCallback(() => {
    resizeStateRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const onResizeMove = useCallback(
    (event: globalThis.MouseEvent) => {
      if (isMobileLayout) return
      const state = resizeStateRef.current
      if (!state) return
      const dx = event.clientX - state.startX
      if (state.target === 'sidebar') {
        setSidebarWidth(clampSidebarWidth(state.startWidth + dx))
      } else {
        setRightPanelWidth(clampRightPanelWidth(state.startWidth - dx))
      }
    },
    [clampRightPanelWidth, clampSidebarWidth, isMobileLayout],
  )

  const startSidebarResize = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isMobileLayout || sidebarCollapsed) return
      resizeStateRef.current = {
        target: 'sidebar',
        startX: event.clientX,
        startWidth: sidebarWidth,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [isMobileLayout, sidebarCollapsed, sidebarWidth],
  )

  const startRightPanelResize = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isMobileLayout || !activeRightTab) return
      resizeStateRef.current = {
        target: 'right',
        startX: event.clientX,
        startWidth: rightPanelWidth,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [activeRightTab, isMobileLayout, rightPanelWidth],
  )

  const layoutCssVars = useMemo(() => {
    if (isMobileLayout) return undefined
    return {
      '--sidebar-width': `${clampSidebarWidth(sidebarWidth)}px`,
      '--right-panel-width': `${clampRightPanelWidth(rightPanelWidth)}px`,
    } as CSSProperties
  }, [clampRightPanelWidth, clampSidebarWidth, isMobileLayout, rightPanelWidth, sidebarWidth])

  // --- Actions ---

  const refreshTree = useCallback(async () => {
    if (!workRoot) return
    const t = await listWorkTree(6)
    setTree(t)
  }, [workRoot])

  const reloadAppSettings = useCallback(async () => {
    if (!isTauriApp()) return
    try {
      const s = await getAppSettings()
      setAppSettingsState(s)
      setLaunchModeState(s.launch_mode)
      setSettingsError(null)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e))
      setAppSettingsState(null)
    }
  }, [])

  const openWorkPath = useCallback(
    async (path: string) => {
      const p = path.trim()
      if (!p) return false
      setError(null)
      setBusy(true)
      try {
        const info = await setWorkRoot(p)
        setWorkRootState(info.root)
        setLastWorkPath(info.root)
        return true
      } catch (e) {
        setWorkRootState(null)
        setTree(null)
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const extractTaskSummaryFromMessage = useCallback((text: string): string => {
    const normalized = text.trim()
    if (!normalized) return ''
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) return ''
    const useful = lines
      .filter((line) => !line.startsWith('TASK_DONE:'))
      .slice(-3)
      .join(' ')
      .trim()
    return useful.slice(0, 360)
  }, [])

  const refreshPlannerQueue = useCallback(async () => {
    if (!workRoot || !isTauriApp()) return
    await novelPlannerService.ensurePlannerWorkspace()
    const queue = await novelPlannerService.loadRunQueue()
    setPlannerTasks(queue)
  }, [workRoot])

  const loadPlannerSession = useCallback(async () => {
    if (!workRoot || !isTauriApp()) return
    await novelPlannerService.ensurePlannerWorkspace()
    const sessionId = chatSessionIdRef.current
    const session = await novelPlannerService.getSessionState(sessionId)
    setPlannerState(session)
    setWriterMode(session.mode)
    writerModeRef.current = session.mode
    if (session.mode === 'normal') {
      const queue = await novelPlannerService.loadRunQueue()
      setPlannerTasks(queue)
      return
    }
    await novelPlannerService.ensureMasterPlan(session.mode, {
      instruction: '',
      targetWords: 1_200_000,
      chapterWordTarget,
    })
    const queueState = await novelPlannerService.loadRunQueueState()
    if (queueState.tasks.length > 0 && queueState.mode === session.mode) {
      setPlannerTasks(queueState.tasks)
      return
    }
    const tasks = await novelPlannerService.generateTasksFromPlan({
      mode: session.mode,
      targetWords: 1_200_000,
      chapterWordTarget,
    })
    setPlannerTasks(tasks)
  }, [chapterWordTarget, workRoot])

  const {
    activeChatSessionId,
    chatSessionOptions,
    chatSessionsLoading,
    refreshChatSessionSummaries,
    onNewChatSession,
    onOpenChatSession,
  } = useChatSessionWorkbench({
    workRoot,
    isTauriRuntime: isTauriApp(),
    onSessionActivated: async (sessionId) => {
      chatSessionIdRef.current = sessionId
      setChatMessages([])
      rollbackTurnStackRef.current = []
      setChatAutoScroll(true)
      await loadPlannerSession()
    },
    onSessionOpened: async (sessionId, messages) => {
      chatSessionIdRef.current = sessionId
      rollbackTurnStackRef.current = []
      setChatMessages(messages)
      setChatAutoScroll(true)
      setChatInput('')
      await loadPlannerSession()
    },
    onError: (message) => setError(message),
    hasStreamingMessages: () => chatMessagesRef.current.some((message) => message.streaming),
  })

  const ensurePlanningArtifacts = useCallback(
    async (mode: WriterMode, instruction?: string) => {
      if (!workRoot || !isTauriApp()) return
      if (mode === 'normal') return
      await novelPlannerService.ensurePlannerWorkspace()
      await novelPlannerService.ensureMasterPlan(mode, {
        instruction: instruction ?? '',
        targetWords: 1_200_000,
        chapterWordTarget,
      })
      const queueState = await novelPlannerService.loadRunQueueState()
      if (queueState.tasks.length > 0 && queueState.mode === mode) {
        setPlannerTasks(queueState.tasks)
        return
      }
      const tasks = await novelPlannerService.generateTasksFromPlan({
        mode,
        targetWords: 1_200_000,
        chapterWordTarget,
      })
      setPlannerTasks(tasks)
    },
    [chapterWordTarget, workRoot],
  )

  const buildPromptByMode = useCallback(
    async (userInput: string, mode: WriterMode): Promise<string> => {
      if (!workRoot || !isTauriApp()) return userInput
      await novelPlannerService.ensurePlannerWorkspace()
      if (mode !== 'normal') {
        await ensurePlanningArtifacts(mode, userInput)
      }
      const context = await novelPlannerService.buildModeContext(mode, tree, activePath)
      return novelPlannerService.buildModePrompt(mode, userInput, context, activePath)
    },
    [activePath, ensurePlanningArtifacts, tree, workRoot],
  )

  const waitForStreamCompletion = useCallback((streamId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      streamWaitersRef.current.set(streamId, { resolve, reject })
      window.setTimeout(() => {
        const waiter = streamWaitersRef.current.get(streamId)
        if (!waiter) return
        streamWaitersRef.current.delete(streamId)
        streamFailuresRef.current.delete(streamId)
        reject(new Error(t('app.error.aiTimeout')))
      }, 8 * 60 * 1000)
    })
  }, [t])

  const loadGraph = useCallback(async () => {
    if (!workRoot) return
    try {
      const [rawChars, rawRels] = await Promise.all([readText('concept/characters.md'), readText('concept/relations.md')])

      const nodes = rawChars
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter(Boolean)
        .map((name) => ({ id: name, name }))

      const relLines = rawRels
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))

      const edges = relLines
        .map((l) => l.replace(/^- /, ''))
        .map((l) => {
          const m = l.match(/^(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/)
          if (!m) return null
          return { from: m[1].trim(), to: m[2].trim(), type: m[3]?.trim() || undefined }
        })
        .filter(Boolean) as Array<{ from: string; to: string; type?: string }>

      const nodeMap = new Map<string, { id: string; name: string }>()
      for (const n of nodes) nodeMap.set(n.id, n)
      for (const e of edges) {
        if (!nodeMap.has(e.from)) nodeMap.set(e.from, { id: e.from, name: e.from })
        if (!nodeMap.has(e.to)) nodeMap.set(e.to, { id: e.to, name: e.to })
      }
      setGraphNodes(Array.from(nodeMap.values()))
      setGraphEdges(edges)
    } catch {
      setGraphNodes([])
      setGraphEdges([])
    }
  }, [workRoot])

  const openSidebarTab = useCallback(
    (tab: 'files' | 'history' | 'chapters' | 'characters' | 'plotlines' | 'risk') => {
      setActiveSidebarTab(tab)
      setSidebarCollapsed(false)
      if (isMobileLayout) {
        setActiveRightTab(null)
      }
    },
    [isMobileLayout],
  )

  const toggleSidebarTab = useCallback(
    (tab: 'files' | 'history' | 'chapters' | 'characters' | 'plotlines' | 'risk') => {
      if (activeSidebarTab === tab) {
        setSidebarCollapsed((prev) => !prev)
        return
      }
      openSidebarTab(tab)
    },
    [activeSidebarTab, openSidebarTab],
  )

  const toggleRightTab = useCallback(
    (tab: 'chat' | 'graph' | 'writing-goal') => {
      setActiveRightTab((prev) => {
        const next = prev === tab ? null : tab
        if (next === 'graph') {
          void loadGraph()
        }
        if (next && isMobileLayout) {
          setSidebarCollapsed(true)
        }
        return next
      })
    },
    [isMobileLayout, loadGraph],
  )

  const refreshBookshelfState = useCallback(async () => {
    if (!isTauriApp()) return
    try {
      const state = await getBookshelfState()
      setBookshelfRoot(state.default_root)
      setRecentWorks(state.default_projects)
      setImportedWorks(state.external_projects)
      setLastWorkPath(state.last_workspace)
      setLaunchModeState(state.launch_mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const onOpenProjectFromPicker = useCallback(
    async (path: string, source: WorkSource) => {
      const ok = await openWorkPath(path)
      if (!ok) return
      if (isTauriApp() && source === 'external') {
        try {
          await rememberImportedWork(path)
        } catch {
          // Ignore memory persistence errors, project is still opened.
        }
      }
      setAppView('studio')
      if (isMobileLayout) {
        setSidebarCollapsed(true)
        setActiveRightTab(null)
      }
      if (isTauriApp()) {
        void refreshBookshelfState()
      }
    },
    [isMobileLayout, openWorkPath, refreshBookshelfState],
  )

  const onCreateProjectFromPicker = useCallback(
    async (name: string) => {
      if (!isTauriApp()) return
      setError(null)
      setBusy(true)
      try {
        const project = await createNovelWork(name)
        const opened = await openWorkPath(project.path)
        if (!opened) return
        setAppView('studio')
        if (isMobileLayout) {
          setSidebarCollapsed(true)
          setActiveRightTab(null)
        }
        await refreshBookshelfState()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [isMobileLayout, openWorkPath, refreshBookshelfState],
  )

  const onLoadExternalProject = useCallback(async () => {
    try {
      if (!isTauriApp()) {
        const ok = await openWorkPath(workPathInput)
        if (ok) setAppView('studio')
        return
      }
      const selected = await openFolderDialog()
      if (!selected) return
      const ok = await openWorkPath(selected)
      if (!ok) return
      try {
        await rememberImportedWork(selected)
      } catch {
        // Keep opened state even if remembering fails.
      }
      setAppView('studio')
      void refreshBookshelfState()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [openWorkPath, refreshBookshelfState, workPathInput])

  const onForgetExternalProject = useCallback(
    async (path: string) => {
      if (!isTauriApp()) return
      try {
        await forgetImportedWork(path)
        await refreshBookshelfState()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshBookshelfState],
  )

  const onLaunchModeChange = useCallback(
    async (mode: LaunchMode) => {
      setLaunchModeState(mode)
      if (!isTauriApp()) return
      try {
        await setLaunchMode(mode)
        await refreshBookshelfState()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshBookshelfState],
  )

  const onOpenByPath = useCallback(
    async (relPath: string, options?: OpenByPathOptions) => {
      if (!relPath) return
      const forceReload = options?.forceReload === true
      setError(null)
      setBusy(true)
      try {
        const existing = openFiles.find((f) => f.path === relPath)
        if (existing && !forceReload) {
          setActivePath(existing.path)
          return
        }
        const parts = relPath.replaceAll('\\', '/').split('/')
        const name = parts[parts.length - 1] || relPath
        const content = await readText(relPath)
        if (existing) {
          setOpenFiles((prev) =>
            prev.map((f) => (f.path === relPath ? { ...f, name, content, dirty: false } : f)),
          )
        } else {
          const next: OpenFile = { path: relPath, name, content, dirty: false }
          setOpenFiles((prev) => [...prev, next])
        }
        setActivePath(relPath)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [openFiles],
  )

  const onSearchInFiles = useCallback(
    async (query: string, options: SearchPanelOptions): Promise<SearchResult[]> => {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) return []

      let regex: RegExp
      try {
        regex = buildSearchRegex(normalizedQuery, options)
      } catch {
        setError(t('search.error.invalidRegex'))
        return []
      }

      const results: SearchResult[] = []
      for (const filePath of searchableFilePaths) {
        let content = openFileContentMap.get(filePath)
        if (content === undefined) {
          try {
            content = await readText(filePath)
          } catch {
            continue
          }
        }

        const lines = content.split(/\r?\n/)
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex]
          const matches = countMatches(line, regex)
          if (matches <= 0) continue

          results.push({
            id: `${filePath}:${lineIndex + 1}:${results.length}`,
            path: filePath,
            line: lineIndex + 1,
            preview: line.trim() || line,
            matchCount: matches,
          })

          if (results.length >= FILE_SEARCH_RESULT_LIMIT) {
            return results
          }
        }
      }

      return results
    },
    [openFileContentMap, searchableFilePaths, t],
  )

  const onSearchResultClick = useCallback(
    (result: SearchResult) => {
      setShowSearchPanel(false)
      void onOpenByPath(result.path)
    },
    [onOpenByPath],
  )

  const closeActiveTab = useCallback(() => {
    if (!activePath) return
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== activePath)
      setActivePath(next[next.length - 1]?.path ?? null)
      return next
    })
  }, [activePath])

  const focusNeighborTab = useCallback(
    (direction: 'next' | 'prev') => {
      if (!activePath || openFiles.length <= 1) return
      const currentIndex = openFiles.findIndex((f) => f.path === activePath)
      if (currentIndex < 0) return
      const offset = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + offset + openFiles.length) % openFiles.length
      setActivePath(openFiles[nextIndex]?.path ?? activePath)
    },
    [activePath, openFiles],
  )

  const { ensureAutoNextChapter, ensureAutoStoryFile } = useAutoStoryNavigation({
    tree,
    onOpenByPath,
    refreshTree,
  })

  const onSaveActive = useCallback(async () => {
    if (!activeFile) return
    setError(null)
    setBusy(true)
    try {
      await writeText(activeFile.path, activeFile.content)
      setOpenFiles((prev) => prev.map((f) => (f.path === activeFile.path ? { ...f, dirty: false } : f)))

      // Clear backup and auto-save after successful save
      clearBackupContent(activeFile.path)
      clearAutoSavedContent(activeFile.path)

      await refreshTree()
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))

      // Use error handler to show user-friendly error and recovery options
      const result = await handleFileSaveError({
        filePath: activeFile.path,
        content: activeFile.content,
        error,
        onRetry: async () => {
          // Retry save
          await writeText(activeFile.path, activeFile.content)
          setOpenFiles((prev) => prev.map((f) => (f.path === activeFile.path ? { ...f, dirty: false } : f)))
          clearBackupContent(activeFile.path)
          clearAutoSavedContent(activeFile.path)
          await refreshTree()
        },
        onSaveAs: async () => {
          // TODO: Implement save as dialog (requires file picker)
          // For now, just keep the dirty flag
          console.log('Save as not implemented yet')
        },
      })

      // Keep dirty flag if save failed
      if (result === 'cancel') {
        setError(error.message)
      }
    } finally {
      setBusy(false)
    }
  }, [activeFile, refreshTree])

  const showConfirm = useCallback(async (text: string): Promise<boolean> => {
    if (!isTauriApp()) return window.confirm(text)
    return confirm(text, { title: t('common.confirm'), kind: 'warning' })
  }, [t])

  const onNewChapter = useCallback(async () => {
    if (!workRoot) return
    setError(null)
    setBusy(true)
    try {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fileName = `stories/chapter-${yyyy}${mm}${dd}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.md`
      try {
        await createFile(fileName)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("parent directory does not exist")) {
          const ok = await showConfirm('stories/ folder does not exist. Create it now?')
          if (!ok) throw e
          await createDir('stories')
          await createFile(fileName)
        } else {
          throw e
        }
      }
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workRoot, refreshTree, showConfirm])

  const onCreateDraftInDir = useCallback(
    async (dir: string, prefix: string, ext: 'md' | 'txt' = 'md') => {
      if (!workRoot) return
      setError(null)
      setBusy(true)
      try {
        const now = new Date()
        const yyyy = String(now.getFullYear())
        const mm = String(now.getMonth() + 1).padStart(2, '0')
        const dd = String(now.getDate()).padStart(2, '0')
        const hh = String(now.getHours()).padStart(2, '0')
        const min = String(now.getMinutes()).padStart(2, '0')
        const relativePath = `${dir}/${prefix}-${yyyy}${mm}${dd}-${hh}${min}.${ext}`
        try {
          await createFile(relativePath)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('parent directory does not exist')) {
            await createDir(dir)
            await createFile(relativePath)
          } else {
            throw e
          }
        }
        await refreshTree()
        await onOpenByPath(relativePath, { forceReload: true })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [onOpenByPath, refreshTree, workRoot],
  )

  const onNewOutline = useCallback(async () => {
    await onCreateDraftInDir('outline', 'outline', 'md')
  }, [onCreateDraftInDir])

  const onNewConceptNote = useCallback(async () => {
    await onCreateDraftInDir('concept', 'concept-note', 'md')
  }, [onCreateDraftInDir])

  const onOpenMasterPlanDoc = useCallback(async () => {
    if (!workRoot) return
    setError(null)
    setBusy(true)
    try {
      let exists = true
      try {
        await readText(MASTER_PLAN_RELATIVE_PATH)
      } catch {
        exists = false
      }
      if (!exists) {
        try {
          await createDir('.novel')
        } catch {
          // no-op
        }
        try {
          await createDir('.novel/plans')
        } catch {
          // no-op
        }
        try {
          await createFile(MASTER_PLAN_RELATIVE_PATH)
        } catch {
          // no-op
        }
        const seed = '# Master Plan\n\n## Premise\n\n## Major Arcs\n\n## Chapter Beats\n'
        await writeText(MASTER_PLAN_RELATIVE_PATH, seed)
      }
      await refreshTree()
      await onOpenByPath(MASTER_PLAN_RELATIVE_PATH, { forceReload: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [onOpenByPath, refreshTree, workRoot])

  const onDeleteStructurePath = useCallback(
    async (path: string) => {
      if (!workRoot || !path) return
      const normalizedPath = path.replaceAll('\\', '/')
      const fileName = normalizedPath.split('/').filter(Boolean).pop() ?? normalizedPath
      const targetFile = openFiles.find((file) => file.path === path)
      const confirmText = targetFile?.dirty
        ? t('app.confirm.deleteUnsavedEntry', { name: fileName })
        : t('app.confirm.deleteEntry', { name: fileName })
      const ok = await showConfirm(confirmText)
      if (!ok) return
      setError(null)
      setBusy(true)
      try {
        await deleteEntry(path)
        editorManager.destroyEditor(path)
        clearBackupContent(path)
        clearAutoSavedContent(path)
        setOpenFiles((prev) => {
          const next = prev.filter((f) => f.path !== path)
          if (activePath === path) {
            setActivePath(next[next.length - 1]?.path ?? null)
          }
          return next
        })
        await refreshTree()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [activePath, openFiles, refreshTree, showConfirm, t, workRoot],
  )

  const newId = useCallback(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }, [])

  const openCreateProviderModal = useCallback(() => {
    const preset = COMMON_PROVIDER_PRESETS[0]
    if (preset) {
      setEditingProvider({
        id: newId(),
        name: preset.name,
        kind: preset.kind,
        base_url: preset.base_url,
        model_name: preset.model_name,
      })
      setEditingProviderPreset(preset.key)
      setEditingCustomProviderApiFormat(preset.kind === 'Anthropic' ? 'claude' : 'openai')
    } else {
      setEditingProvider({
        id: newId(),
        name: t('app.model.customProviderDefaultName'),
        kind: 'OpenAICompatible',
        base_url: 'https://api.openai.com/v1',
        model_name: '',
      })
      setEditingProviderPreset(CUSTOM_PROVIDER_PRESET_KEY)
      setEditingCustomProviderApiFormat('openai')
    }
    setIsNewProvider(true)
    setProviderProbeResult(null)
    setProviderProbeRunning(false)
    setShowModelModal(true)
  }, [newId, t])

  const openEditProviderModal = useCallback((provider: ModelProvider) => {
    const presetKey = inferProviderPresetKey(provider)
    setEditingProvider({ ...provider })
    setEditingProviderPreset(presetKey)
    setEditingCustomProviderApiFormat(provider.kind === 'Anthropic' ? 'claude' : 'openai')
    setIsNewProvider(false)
    setProviderProbeResult(null)
    setProviderProbeRunning(false)
    setShowModelModal(true)
  }, [])

  const onSelectProviderPreset = useCallback(
    (presetKey: string) => {
      setEditingProviderPreset(presetKey)
      if (presetKey === CUSTOM_PROVIDER_PRESET_KEY) {
        const nextKind = kindFromCustomProviderApiFormat(editingCustomProviderApiFormat)
        const nextBase = defaultBaseUrlByCustomProviderApiFormat(editingCustomProviderApiFormat)
        setEditingProvider((prev) => ({
          ...prev,
          kind: nextKind,
          name: prev.name?.trim() ? prev.name : t('app.model.customProviderDefaultName'),
          base_url: prev.base_url?.trim() ? prev.base_url : nextBase,
        }))
        return
      }

      const preset = COMMON_PROVIDER_PRESETS.find((item) => item.key === presetKey)
      if (!preset) return
      setEditingProvider((prev) => ({
        ...prev,
        name: preset.name,
        kind: preset.kind,
        base_url: preset.base_url,
        model_name: preset.model_name,
      }))
      setEditingCustomProviderApiFormat(preset.kind === 'Anthropic' ? 'claude' : 'openai')
    },
    [editingCustomProviderApiFormat, t],
  )

  const onChangeCustomProviderApiFormat = useCallback(
    (format: CustomProviderApiFormat) => {
      setEditingCustomProviderApiFormat(format)
      if (editingProviderPreset !== CUSTOM_PROVIDER_PRESET_KEY) return
      setEditingProvider((prev) => ({
        ...prev,
        kind: kindFromCustomProviderApiFormat(format),
        base_url: defaultBaseUrlByCustomProviderApiFormat(format),
      }))
    },
    [editingProviderPreset],
  )

  const onProbeProviderConnectivity = useCallback(async () => {
    const normalizedProvider: ModelProvider = {
      id: editingProvider.id?.trim() || `probe-${Date.now()}`,
      name: editingProvider.name?.trim() ?? '',
      kind: editingProvider.kind ?? 'OpenAICompatible',
      api_key: '',
      base_url: editingProvider.base_url?.trim() ?? '',
      model_name: editingProvider.model_name?.trim() ?? '',
    }
    if (!normalizedProvider.base_url || !normalizedProvider.model_name) {
      setProviderProbeResult({ kind: 'error', text: 'Please fill in Base URL and Model ID first.' })
      return
    }

    setProviderProbeRunning(true)
    setProviderProbeResult(null)
    try {
      const rawKey = (editingProvider.api_key ?? '').trim()
      const result: ProviderConnectivityResult = await testProviderConnectivity(normalizedProvider, rawKey || null)
      setProviderProbeResult({
        kind: 'ok',
        text: formatProviderProbeSuccessMessage(result),
        detail: formatProviderProbeDetail(result.message),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setProviderProbeResult({
        kind: 'error',
        text: formatProviderProbeErrorMessage(msg),
        detail: formatProviderProbeDetail(msg),
      })
    } finally {
      setProviderProbeRunning(false)
    }
  }, [editingProvider])


  const getSelectionText = useCallback((): string => {
    const editor = editorRef.current
    if (!editor) return ''

    // Use Lexical's getSelectedText method from AIAssistPlugin
    const extendedEditor = editor as ExtendedLexicalEditor
    if (extendedEditor.getSelectedText && typeof extendedEditor.getSelectedText === 'function') {
      return extendedEditor.getSelectedText()
    }

    return ''
  }, [])

  const copyText = useCallback(async (text: string) => {
    const value = text ?? ''
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      const el = document.createElement('textarea')
      el.value = value
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      el.style.top = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
  }, [])

  const showErrorDialog = useCallback(async (text: string) => {
    if (!isTauriApp()) {
      window.alert(text)
      return
    }
    await message(text, { title: '\u63d0\u793a' })
  }, [])

  const persistAppSettings = useCallback(
    async (next: AppSettings, prev?: AppSettings | null) => {
      try {
        await setAppSettings(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await showErrorDialog(t('app.error.saveSettings', { msg }))
        if (prev) {
          setAppSettingsState(prev)
        } else {
          await reloadAppSettings()
        }
      }
    },
    [reloadAppSettings, showErrorDialog, t],
  )
  const onChatAssistantChange = useCallback(
    (id: string) => {
      if (!appSettings) return
      const prev = appSettings
      const next = { ...appSettings, active_writing_assistant_id: id, active_agent_id: id }
      setAppSettingsState(next)
      void persistAppSettings(next, prev)
    },
    [appSettings, persistAppSettings],
  )
  const onChatProviderChange = useCallback(
    (id: string) => {
      if (!appSettings) return
      const prev = appSettings
      const next = { ...appSettings, active_provider_id: id }
      setAppSettingsState(next)
      void persistAppSettings(next, prev)
    },
    [appSettings, persistAppSettings],
  )
  const openModelSettings = useCallback(() => {
    settingsOpenTabRef.current = 'models'
    setShowSettings(true)
  }, [])

  const settingsDirty = useMemo(() => {
    if (!showSettings) return false
    if (!appSettings) return false
    if (!settingsSnapshot) return false
    const a = JSON.stringify(appSettings)
    const b = JSON.stringify(settingsSnapshot)
    if (a !== b) return true
    if (!writingAssistantSnapshots) return false
    return JSON.stringify(writingAssistantsState) !== JSON.stringify(writingAssistantSnapshots)
  }, [writingAssistantsState, writingAssistantSnapshots, appSettings, settingsSnapshot, showSettings])

  useEffect(() => {
    if (!showSettings) {
      setSettingsSnapshot(null)
      setWritingAssistantSnapshots(null)
      return
    }
    if (appSettings && !settingsSnapshot) {
      setSettingsSnapshot(appSettings)
    }
    if (!writingAssistantSnapshots) {
      setWritingAssistantSnapshots(writingAssistantsState)
    }
  }, [writingAssistantsState, writingAssistantSnapshots, appSettings, settingsSnapshot, showSettings])

  useEffect(() => {
    if (!showSettings) return
    const requested = settingsOpenTabRef.current
    settingsOpenTabRef.current = null
    setSettingsTab(requested ?? 'general')
  }, [showSettings])

  useEffect(() => {
    setProviderProbeResult(null)
  }, [editingProvider.base_url, editingProvider.model_name, editingProvider.kind, editingProvider.api_key])

  const saveAndCloseSettings = useCallback(async () => {
    if (!appSettings) return
    try {
      await setAppSettings(appSettings)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(t('app.error.saveSettings', { msg }))
      return
    }
    try {
      await setWritingAssistants(writingAssistantsState)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(t('app.error.saveAgents', { msg }))
      return
    }
    await reloadAppSettings()
    setShowSettings(false)
  }, [writingAssistantsState, appSettings, reloadAppSettings, showErrorDialog, t])

  const requestCloseSettings = useCallback(() => {
    void (async () => {
      if (!settingsDirty) {
        setShowSettings(false)
        return
      }
      const shouldSave = await showConfirm(t('app.settings.saveBeforeClose'))
      if (shouldSave) {
        await saveAndCloseSettings()
        return
      }
      const discard = await showConfirm(t('app.settings.discardUnsaved'))
      if (!discard) return
      if (settingsSnapshot) setAppSettingsState(settingsSnapshot)
      if (writingAssistantSnapshots) setWritingAssistantsState(writingAssistantSnapshots)
      setShowSettings(false)
    })()
  }, [writingAssistantSnapshots, saveAndCloseSettings, settingsDirty, settingsSnapshot, showConfirm, t])

  const openChatContextMenu = useCallback((e: MouseEvent, item: ChatItem) => {
    e.preventDefault()
    e.stopPropagation()
    const selection = window.getSelection?.()?.toString() ?? ''
    setChatContextMenu({
      x: e.clientX,
      y: e.clientY,
      messageId: item.id,
      role: item.role,
      message: item.content,
      selection,
    })
  }, [])

  useEffect(() => {
    if (!chatContextMenu) return
    const onClick = () => setChatContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChatContextMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [chatContextMenu])

  useEffect(() => {
    if (!editorContextMenu) return
    const onClick = () => setEditorContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditorContextMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editorContextMenu])

  const onQuoteSelection = useCallback(() => {
    const tag = t('app.chat.selectionReferenceTag')
    setChatInput((prev) => {
      const next = prev.trim()
      return next ? `${next} ${tag}` : `${tag} `
    })
    chatInputRef.current?.focus()
  }, [t])

  const onSendChat = useCallback(
    async (overrideContent?: string, options?: SendChatOptions): Promise<string | null> => {
      const rawInput = (overrideContent ?? chatInput).trim()
      if (!rawInput) return null
      if (chatMessagesRef.current.some((m) => m.streaming)) return null

      const parsedDirective = await parseComposerInput(rawInput)
      if (parsedDirective.autoAction) {
        const nextEnabled =
          parsedDirective.autoAction === 'on' ? true : parsedDirective.autoAction === 'off' ? false : !autoLongWriteEnabled
        if (!activeFile) {
          setError('Auto requires an active file.')
          return null
        }
        setAutoLongWriteEnabled(nextEnabled)
        autoLongWriteStopRef.current = !nextEnabled
        setAutoLongWriteStatus(nextEnabled ? 'Auto enabled.' : 'Auto disabled.')
        if (!nextEnabled && activeStreamId && isTauriApp()) {
          manualCancelledStreamsRef.current.add(activeStreamId)
          void import('./tauriChat')
            .then(({ chatCancelStream }) => chatCancelStream(activeStreamId))
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        }
        if (!overrideContent || overrideContent === chatInput) {
          setChatInput('')
        }
        return null
      }

      const requestedMode: WriterMode | null = parsedDirective.requestedMode
      const content = requestedMode ? parsedDirective.content : rawInput
      const applyRequestedMode = async (mode: WriterMode) => {
        if (mode === writerModeRef.current) return
        if (!workRoot || !isTauriApp()) {
          setWriterMode(mode)
          writerModeRef.current = mode
          return
        }
        setWriterMode(mode)
        writerModeRef.current = mode
        const session = await novelPlannerService.setSessionMode(chatSessionIdRef.current, mode)
        setPlannerState(session)
        if (mode === 'normal') {
          setPlannerLastRunError(null)
          return
        }
        setPlannerBusy(true)
        try {
          await ensurePlanningArtifacts(mode, content)
          await refreshPlannerQueue()
        } catch (e) {
          setPlannerLastRunError(e instanceof Error ? e.message : String(e))
        } finally {
          setPlannerBusy(false)
        }
      }

      if (!content) {
        if (requestedMode) await applyRequestedMode(requestedMode)
        if (!overrideContent || overrideContent === chatInput) {
          setChatInput('')
        }
        return null
      }

      let referencedContent = content
      try {
        referencedContent = await resolveInlineReferencesInput({
          input: content,
          selectionText: getSelectionText(),
          activeFile: activeFile ? { path: activeFile.path, content: activeFile.content } : null,
          isTauriRuntime: isTauriApp(),
          workRoot,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }

      let sendPayload = referencedContent
      const modeForPrompt = requestedMode ?? writerModeRef.current
      if (requestedMode) await applyRequestedMode(requestedMode)
      if (!options?.skipModeWrap) {
        try {
          sendPayload = await buildPromptByMode(referencedContent, modeForPrompt)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setError(msg)
        }
      }

      const selectedProviderId = options?.overrideProviderId?.trim() || effectiveProviderId
      const providerIssue = await preflightChatProviderIssue(appSettings, selectedProviderId, t)
      if (providerIssue) {
        setError(providerIssue)
        const shouldEchoLocalFailure = !options?.hideUserEcho && !options?.useExistingLastUser && !options?.sourceMessages
        if (shouldEchoLocalFailure) {
          const localUser: ChatItem = { id: newId(), role: 'user', content }
          const localAssistant: ChatItem = {
            id: newId(),
            role: 'assistant',
            content: providerIssue,
            streaming: false,
            failureKind: 'provider',
            timestamp: Date.now(),
          }
          setChatMessages((prev) => [...prev, localUser, localAssistant])
          setChatAutoScroll(true)
          if (!overrideContent || overrideContent === chatInput) {
            setChatInput('')
          }
        }
        return null
      }

      const sourceHistory = options?.sourceMessages ?? chatMessagesRef.current
      const user: ChatItem = { id: newId(), role: 'user', content }
      const streamId = newId()
      const assistantId = newId()
      const versionGroupId = options?.versionGroupId ?? newId()
      const existingVersions = assistantVersionsRef.current.get(versionGroupId)
      const assistant: ChatItem = {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
        streamId,
        versionGroupId,
        versionIndex: existingVersions && existingVersions.length > 0 ? existingVersions.length - 1 : 0,
        versionCount: existingVersions && existingVersions.length > 0 ? existingVersions.length : 1,
      }
      const startedAt = Date.now()
      streamOutputRef.current.set(streamId, '')
      streamAssistantGroupRef.current.set(streamId, versionGroupId)
      streamAssistantIdRef.current.set(streamId, assistantId)
      streamStartedAtRef.current.set(streamId, startedAt)
      streamLastTokenAtRef.current.set(streamId, startedAt)
      if (!options?.hideUserEcho && !options?.useExistingLastUser) {
        rollbackTurnStackRef.current.push({
          userId: user.id,
          assistantId,
          streamId,
          userContent: user.content,
          changeSetIds: [],
        })
      }

      if (options?.hideUserEcho) {
        if (options?.sourceMessages) {
          setChatMessages([...options.sourceMessages, assistant])
        } else {
          setChatMessages((prev) => [...prev, assistant])
        }
      } else {
        setChatMessages((prev) => [...prev, user, assistant])
      }
      setChatAutoScroll(true)
      if (!overrideContent || overrideContent === chatInput) {
        setChatInput('')
      }

      if (!isTauriApp()) {
        cleanupStreamRefs(streamRefs, streamId)
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: t('chat.error.tauriRequired'), streaming: false, failureKind: 'runtime' }
              : m,
          ),
        )
        return null
      }

      if (!workRoot) {
        cleanupStreamRefs(streamRefs, streamId)
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: t('chat.error.noWorkspace'), streaming: false, failureKind: 'runtime' }
              : m,
          ),
        )
        return null
      }

      try {
        await initNovel()
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e)
        cleanupStreamRefs(streamRefs, streamId)
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: rawMessage,
                  streaming: false,
                  failureKind: inferFailureKindFromText(rawMessage, 'runtime'),
                }
              : m,
          ),
        )
        return null
      }

      const sourceMessages = options?.useExistingLastUser ? [...sourceHistory] : [...sourceHistory, user]
      const maxConversationWindow = 24
      const boundedMessages =
        sourceMessages.length > maxConversationWindow
          ? sourceMessages.slice(sourceMessages.length - maxConversationWindow)
          : sourceMessages
      const messagesToSend = boundedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now(),
      }))
      if (messagesToSend.length > 0) {
        messagesToSend[messagesToSend.length - 1].content = sendPayload
      }
      try {
        setStreamPhaseById((prev) => ({ ...prev, [streamId]: 'initializing' }))
        const { chatGenerateStream } = await import('./tauriChat')
        await chatGenerateStream({
          streamId,
          messages: messagesToSend,
          useMarkdown: appSettings?.output.use_markdown ?? false,
          assistantId: activeWritingAssistantId || null,
          providerId: selectedProviderId || null,
        })
        return streamId
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e)
        cleanupStreamRefs(streamRefs, streamId)
        setStreamPhaseById((prev) => {
          const next = { ...prev }
          delete next[streamId]
          return next
        })
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: rawMessage,
                  streaming: false,
                  failureKind: inferFailureKindFromText(rawMessage),
                }
              : m,
          ),
        )
        return null
      }
    },
    [
      activeFile,
      activeStreamId,
      activeWritingAssistantId,
      autoLongWriteEnabled,
      appSettings,
      buildPromptByMode,
      chatInput,
      effectiveProviderId,
      ensurePlanningArtifacts,
      getSelectionText,
      newId,
      refreshPlannerQueue,
      t,
      workRoot,
      writerMode,
    ],
  )

  const onStopChat = useCallback(async () => {
    autoLongWriteStopRef.current = true
    setAutoLongWriteEnabled(false)
    if (!activeStreamId || !isTauriApp()) return
    try {
      manualCancelledStreamsRef.current.add(activeStreamId)
      const { chatCancelStream } = await import('./tauriChat')
      await chatCancelStream(activeStreamId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeStreamId])
  const forceFinalizeStream = useCallback(
    (streamId: string, message: string, cancelled = false, failureKind?: ChatFailureKind) => {
      setChatMessages((prev) => {
        let changed = false
        const next = prev.map((m) => {
          if (m.role !== 'assistant' || m.streamId !== streamId || !m.streaming) return m
          changed = true
          const nextContent = m.content.trim() ? `${m.content}\n\n${message}` : message
          const resolvedFailureKind =
            failureKind ?? (cancelled ? 'cancelled' : inferFailureKindFromText(message))
          return {
            ...m,
            content: nextContent,
            streaming: false,
            cancelled: cancelled || m.cancelled,
            failureKind: resolvedFailureKind,
          }
        })
        return changed ? next : prev
      })
      setStreamPhaseById((prev) => {
        if (!(streamId in prev)) return prev
        const next = { ...prev }
        delete next[streamId]
        return next
      })
      const waiter = streamWaitersRef.current.get(streamId)
      if (waiter) {
        streamWaitersRef.current.delete(streamId)
        waiter.reject(new Error(message))
      }
      streamFailuresRef.current.delete(streamId)
      window.setTimeout(() => {
        cleanupStreamRefs(streamRefs, streamId)
      }, 0)
    },
    [streamRefs],
  )
  const onRollbackLastTurn = useCallback(async () => {
    const history = chatMessagesRef.current
    const stack = rollbackTurnStackRef.current
    let rollbackIndex = -1
    let rollbackTurn: RollbackTurnState | null = null
    let assistantMessage: ChatItem | null = null

    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const candidate = stack[i]
      const user = history.find((m) => m.id === candidate.userId && m.role === 'user')
      const assistant = history.find((m) => m.id === candidate.assistantId && m.role === 'assistant')
      if (!user || !assistant) {
        stack.splice(i, 1)
        continue
      }
      rollbackIndex = i
      rollbackTurn = candidate
      assistantMessage = assistant
      break
    }

    if (!rollbackTurn || !assistantMessage) return

    if (isTauriApp()) {
      manualCancelledStreamsRef.current.add(rollbackTurn.streamId)
      try {
        const { chatCancelStream } = await import('./tauriChat')
        await chatCancelStream(rollbackTurn.streamId)
      } catch {
        // Ignore cancellation failures during rollback cleanup.
      }
    }

    cleanupStreamRefs(streamRefs, rollbackTurn.streamId)
    streamWaitersRef.current.delete(rollbackTurn.streamId)
    streamFailuresRef.current.delete(rollbackTurn.streamId)
    setStreamPhaseById((prev) => {
      if (!(rollbackTurn.streamId in prev)) return prev
      const next = { ...prev }
      delete next[rollbackTurn.streamId]
      return next
    })

    const rollbackIds = Array.from(new Set(rollbackTurn.changeSetIds)).reverse()
    if (rollbackIds.length > 0) {
      const removableCount = rollbackIds.filter((id) => diffContext.changeSets.has(id)).length
      const shouldCloseDiffPanel = diffContext.changeSets.size <= removableCount
      try {
        for (const changeSetId of rollbackIds) {
          await modificationService.rollbackChangeSet(changeSetId)
        }
        for (const changeSetId of rollbackIds) {
          diffContext.removeChangeSet(changeSetId)
          modificationService.deleteChangeSet(changeSetId)
        }
        setActiveDiffTab((prev) => (prev && rollbackIds.includes(prev) ? null : prev))
        if (shouldCloseDiffPanel) {
          setShowDiffPanel(false)
        }
        await refreshTree()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return
      }
    }

    if (assistantMessage.versionGroupId) {
      assistantVersionsRef.current.delete(assistantMessage.versionGroupId)
      versionGroupAutoRetryCountRef.current.delete(assistantMessage.versionGroupId)
    }
    setChatMessages((prev) => prev.filter((m) => m.id !== rollbackTurn.userId && m.id !== rollbackTurn.assistantId))
    setChatInput(rollbackTurn.userContent)
    setChatAutoScroll(true)
    if (rollbackIndex >= 0) {
      stack.splice(rollbackIndex, 1)
    }
    window.setTimeout(() => {
      chatInputRef.current?.focus()
    }, 0)
  }, [diffContext, refreshTree, streamRefs])
  const onToggleAutoLongWrite = useCallback(
    (next: boolean) => {
      setAutoLongWriteEnabled(next)
      autoLongWriteStopRef.current = !next
      setAutoLongWriteStatus(next ? 'Auto enabled.' : 'Auto disabled.')
      if (!next && activeStreamId) {
        void onStopChat()
      }
    },
    [activeStreamId, onStopChat],
  )

  const maybeAutoRetryNoTokenStream = useCallback(
    async (streamId: string) => {
      if (!isTauriApp()) return
      const active = chatMessagesRef.current.find((m) => m.role === 'assistant' && m.streamId === streamId && m.streaming)
      if (!active) return
      const hasOutput = (streamOutputRef.current.get(streamId) ?? '').length > 0
      if (hasOutput) return
      if (manualCancelledStreamsRef.current.has(streamId)) return

      const groupId = streamAssistantGroupRef.current.get(streamId) ?? active.versionGroupId ?? active.id
      const retried = versionGroupAutoRetryCountRef.current.get(groupId) ?? 0
      if (retried >= AUTO_RETRY_MAX_PER_GROUP) return
      versionGroupAutoRetryCountRef.current.set(groupId, retried + 1)
      setStreamPhaseById((prev) => ({ ...prev, [streamId]: 'retrying' }))

      try {
        const { chatCancelStream } = await import('./tauriChat')
        await chatCancelStream(streamId)
      } catch {
        // Ignore cancellation failures during auto-retry cancellation.
      }

      const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
      for (let i = 0; i < 40; i += 1) {
        const stillOldStream = chatMessagesRef.current.some((m) => m.role === 'assistant' && m.streamId === streamId && m.streaming)
        if (!stillOldStream) break
        await wait(120)
      }
      for (let i = 0; i < 40; i += 1) {
        const anyStreaming = chatMessagesRef.current.some((m) => m.streaming)
        if (!anyStreaming) break
        await wait(120)
      }
      if (chatMessagesRef.current.some((m) => m.streaming)) return

      const assistantId = streamAssistantIdRef.current.get(streamId) ?? active.id
      setError(t('chat.error.retryTimeout'))
      const history = chatMessagesRef.current
      const assistantIndex = history.findIndex((m) => m.id === assistantId && m.role === 'assistant' && !m.streaming)
      if (assistantIndex < 0) return
      let userIndex = -1
      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        if (history[i].role === 'user') {
          userIndex = i
          break
        }
      }
      if (userIndex < 0) return
      const targetAssistant = history[assistantIndex]
      const replayUser = history[userIndex]
      const replayHistory = history.slice(0, assistantIndex)
      const versionGroupId = targetAssistant.versionGroupId ?? targetAssistant.id
      if (targetAssistant.content.trim()) {
        upsertAssistantVersion(versionGroupId, {
          content: targetAssistant.content,
          changeSet: targetAssistant.changeSet,
          cancelled: targetAssistant.cancelled,
          failureKind: targetAssistant.failureKind,
          timestamp: Date.now(),
        })
      }
      await onSendChat(replayUser.content, {
        sourceMessages: replayHistory,
        useExistingLastUser: true,
        hideUserEcho: true,
        versionGroupId,
      })
    },
    [onSendChat, t, upsertAssistantVersion],
  )
  useEffect(() => {
    if (!activeStreamId) return
    const timer = window.setTimeout(() => {
      void maybeAutoRetryNoTokenStream(activeStreamId)
    }, FIRST_TOKEN_RETRY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [activeStreamId, maybeAutoRetryNoTokenStream])
  useEffect(() => {
    if (!isTauriApp()) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      const activeStreams = chatMessagesRef.current.filter((m): m is ChatItem & { streamId: string } => {
        return m.role === 'assistant' && m.streaming === true && typeof m.streamId === 'string' && m.streamId.length > 0
      })
      for (const item of activeStreams) {
        const streamId = item.streamId
        const startedAt = streamStartedAtRef.current.get(streamId) ?? now
        const lastTokenAt = streamLastTokenAtRef.current.get(streamId) ?? startedAt
        const idleMs = now - lastTokenAt
        const totalMs = now - startedAt
        const hasOutput = (streamOutputRef.current.get(streamId) ?? '').trim().length > 0
        const idleTimeoutMs = hasOutput ? STREAM_IDLE_HARD_TIMEOUT_MS : STREAM_PRETOKEN_HARD_TIMEOUT_MS

        if (manualCancelledStreamsRef.current.has(streamId) && idleMs >= STREAM_MANUAL_CANCEL_GRACE_MS) {
          forceFinalizeStream(streamId, t('chat.error.generationCancelled'), true, 'cancelled')
          continue
        }
        if (idleMs >= idleTimeoutMs || totalMs >= STREAM_TOTAL_HARD_TIMEOUT_MS) {
          forceFinalizeStream(streamId, t('chat.error.timeoutAutoStopped'), false, 'timeout')
        }
      }
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [forceFinalizeStream, t])

  const resolveAssistantReplayContext = useCallback(
    (assistantMessageId?: string, options?: ResolveReplayOptions): AssistantReplayContext | null => {
      const allowWhenStreaming = options?.allowWhenStreaming === true
      if (!allowWhenStreaming && chatMessagesRef.current.some((m) => m.streaming)) return null
      const history = chatMessagesRef.current
      if (history.length === 0) return null

      let assistantIndex = -1
      if (assistantMessageId) {
        assistantIndex = history.findIndex((m) => m.id === assistantMessageId && m.role === 'assistant' && !m.streaming)
      }
      if (assistantIndex < 0) {
        for (let i = history.length - 1; i >= 0; i -= 1) {
          const item = history[i]
          if (item.role === 'assistant' && !item.streaming) {
            assistantIndex = i
            break
          }
        }
      }
      if (assistantIndex < 0) return null

      let userIndex = -1
      for (let i = assistantIndex - 1; i >= 0; i -= 1) {
        if (history[i].role === 'user') {
          userIndex = i
          break
        }
      }
      if (userIndex < 0) return null

      const targetAssistant = history[assistantIndex]
      const versionGroupId = targetAssistant.versionGroupId ?? targetAssistant.id
      const shouldPersistVersion = options?.persistCurrentVersion !== false
      if (shouldPersistVersion && targetAssistant.content.trim()) {
        upsertAssistantVersion(versionGroupId, {
          content: targetAssistant.content,
          changeSet: targetAssistant.changeSet,
          cancelled: targetAssistant.cancelled,
          failureKind: targetAssistant.failureKind,
          timestamp: Date.now(),
        })
      }

      const replayHistory = history.slice(0, assistantIndex)
      const replayUser = replayHistory[replayHistory.length - 1]
      if (!replayUser || replayUser.role !== 'user') return null
      const retryContext = buildRetryContextFromToolEvents(targetAssistant.toolEvents, t)
      return { replayHistory, replayUser, versionGroupId, retryContext }
    },
    [t, upsertAssistantVersion],
  )

  const onRegenerateAssistant = useCallback(
    async (assistantMessageId?: string, retryContextOverride?: string) => {
      const replay = resolveAssistantReplayContext(assistantMessageId)
      if (!replay) return
      const resolvedRetryContext = typeof retryContextOverride === 'string' ? retryContextOverride.trim() : replay.retryContext
      const replayPrompt = resolvedRetryContext
        ? `${replay.replayUser.content}\n\n${resolvedRetryContext}`
        : replay.replayUser.content
      await onSendChat(replayPrompt, {
        sourceMessages: replay.replayHistory,
        useExistingLastUser: true,
        hideUserEcho: true,
        versionGroupId: replay.versionGroupId,
      })
    },
    [onSendChat, resolveAssistantReplayContext],
  )

  const onRetryWithFallbackProvider = useCallback(
    async (assistantMessageId?: string, retryContextOverride?: string) => {
      if (!appSettings) {
        setError(t('chat.recovery.noSettingsLoaded'))
        openModelSettings()
        return
      }

      const replay = resolveAssistantReplayContext(assistantMessageId)
      if (!replay) return

      const currentProviderId = effectiveProviderId
      const candidates = appSettings.providers.filter((provider) => provider.id !== currentProviderId)

      let fallbackProvider: ModelProvider | null = null
      for (const provider of candidates) {
        if (!provider.base_url.trim() || !provider.model_name.trim()) continue
        if (provider.api_key.trim()) {
          fallbackProvider = provider
          break
        }
        if (!isTauriApp()) continue
        try {
          const hasKey = await getApiKeyStatus(provider.id)
          if (hasKey) {
            fallbackProvider = provider
            break
          }
        } catch {
          // Ignore keyring lookup errors and keep trying other providers.
        }
      }

      if (!fallbackProvider) {
        setError(t('chat.recovery.noAlternativeProvider'))
        openModelSettings()
        return
      }

      if (appSettings.active_provider_id !== fallbackProvider.id) {
        const prev = appSettings
        const next = { ...appSettings, active_provider_id: fallbackProvider.id }
        setAppSettingsState(next)
        await persistAppSettings(next, prev)
      }

      const resolvedRetryContext = typeof retryContextOverride === 'string' ? retryContextOverride.trim() : replay.retryContext
      const replayPrompt = resolvedRetryContext
        ? `${replay.replayUser.content}\n\n${resolvedRetryContext}`
        : replay.replayUser.content
      await onSendChat(replayPrompt, {
        sourceMessages: replay.replayHistory,
        useExistingLastUser: true,
        hideUserEcho: true,
        versionGroupId: replay.versionGroupId,
        overrideProviderId: fallbackProvider.id,
      })
      setError(null)
    },
    [
      appSettings,
      effectiveProviderId,
      onSendChat,
      openModelSettings,
      persistAppSettings,
      resolveAssistantReplayContext,
      t,
    ],
  )
  const getRetryContextText = useCallback(
    (assistantMessageId?: string): string => {
      const replay = resolveAssistantReplayContext(assistantMessageId, {
        persistCurrentVersion: false,
        allowWhenStreaming: true,
      })
      return replay?.retryContext ?? ''
    },
    [resolveAssistantReplayContext],
  )

  const onGenerateAssistantCandidates = useCallback(
    async (assistantMessageId?: string, extraCount = 2) => {
      const replay = resolveAssistantReplayContext(assistantMessageId)
      if (!replay) return
      const rounds = Math.max(1, Math.min(4, Math.floor(extraCount)))
      for (let i = 0; i < rounds; i += 1) {
        const streamId = await onSendChat(replay.replayUser.content, {
          sourceMessages: replay.replayHistory,
          useExistingLastUser: true,
          hideUserEcho: true,
          versionGroupId: replay.versionGroupId,
        })
        if (!streamId) break
        try {
          await waitForStreamCompletion(streamId)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (!/cancel/i.test(msg)) {
            setError(msg)
          }
          break
        }
      }
    },
    [onSendChat, resolveAssistantReplayContext, waitForStreamCompletion],
  )

  const onSwitchAssistantVersion = useCallback((messageId: string, direction: -1 | 1) => {
    setChatMessages((prev) => {
      const index = prev.findIndex((m) => m.id === messageId && m.role === 'assistant')
      if (index < 0) return prev
      const current = prev[index]
      const groupId = current.versionGroupId
      if (!groupId) return prev
      const versions = assistantVersionsRef.current.get(groupId)
      if (!versions || versions.length < 2) return prev

      const currentIndex =
        typeof current.versionIndex === 'number'
          ? Math.max(0, Math.min(versions.length - 1, current.versionIndex))
          : versions.length - 1
      let nextIndex = currentIndex + direction
      if (nextIndex < 0) nextIndex = versions.length - 1
      if (nextIndex >= versions.length) nextIndex = 0

      const selected = versions[nextIndex]
      const next = [...prev]
      next[index] = {
        ...current,
        content: selected.content,
        changeSet: selected.changeSet,
        cancelled: selected.cancelled,
        failureKind: selected.failureKind,
        versionIndex: nextIndex,
        versionCount: versions.length,
      }
      return next
    })
  }, [])

  const onSmartComplete = useCallback(() => {
    if (!activeFile) return
    const editor = editorRef.current

    // Use getContextBeforeCursor from AIAssistPlugin to get last 1200 characters
    const extendedEditor = editor as ExtendedLexicalEditor
    let snippet = ''

    if (extendedEditor?.getContextBeforeCursor && typeof extendedEditor.getContextBeforeCursor === 'function') {
      snippet = extendedEditor.getContextBeforeCursor(1200)
    } else {
      // Fallback: get content from editor or activeFile
      const full: string = extendedEditor?.getContent?.() ?? activeFile.content
      snippet = full.slice(Math.max(0, full.length - 1200))
    }

    const nearing = chapterWordTarget > 0 && activeCharCount >= Math.floor(chapterWordTarget * 0.9)
    const prompt =
      `${t('app.chat.autoWritePrompt.header', { target: chapterWordTarget, current: activeCharCount })}\n` +
      `${nearing ? t('app.chat.autoWritePrompt.nearing') : t('app.chat.autoWritePrompt.continue')}\n` +
      `${t('app.chat.autoWritePrompt.context')}\n${snippet}`
    void onSendChat(prompt)
  }, [activeFile, chapterWordTarget, activeCharCount, onSendChat, t])

  const getLatestFileCharCount = useCallback(
    async (filePath: string, fallback = ''): Promise<number> => {
      if (!filePath) return 0
      if (workRoot && isTauriApp()) {
        try {
          const latest = await readText(filePath)
          return latest.replace(/\s/g, '').length
        } catch {
          // Fall back to in-memory content when disk read fails.
        }
      }
      return fallback.replace(/\s/g, '').length
    },
    [workRoot],
  )

  const runAutoLongWrite = useCallback(async () => {
    await runAutoLongWriteWorkflow({
      workRoot,
      isTauriRuntime: isTauriApp(),
      activeFile: activeFile ? { path: activeFile.path } : null,
      activePath,
      autoLongWriteRunning,
      openFiles,
      writerMode,
      chapterWordTarget,
      autoLongWriteMaxRounds,
      autoLongWriteMinChars,
      autoLongWriteMaxChars,
      autoLongWriteMaxChapterAdvances,
      chatSessionId: chatSessionIdRef.current,
      autoLongWriteStopRef,
      chatMessagesRef,
      streamRefs,
      plannerService: novelPlannerService,
      setPlannerTasks,
      setAutoLongWriteRunning,
      setAutoLongWriteStatus,
      setAutoLongWriteEnabled,
      setError,
      ensurePlanningArtifacts,
      ensureAutoStoryFile,
      ensureAutoNextChapter,
      getLatestFileCharCount,
      onSendChat,
      waitForStreamCompletion,
      validateTaskQuality,
      extractTaskSummaryFromMessage,
    })
  }, [
    activeFile,
    activePath,
    autoLongWriteMaxChapterAdvances,
    autoLongWriteMaxChars,
    autoLongWriteMaxRounds,
    autoLongWriteMinChars,
    autoLongWriteRunning,
    chapterWordTarget,
    ensureAutoNextChapter,
    ensureAutoStoryFile,
    ensurePlanningArtifacts,
    extractTaskSummaryFromMessage,
    getLatestFileCharCount,
    onSendChat,
    openFiles,
    validateTaskQuality,
    waitForStreamCompletion,
    workRoot,
    writerMode,
  ])


  useEffect(() => {
    if (!autoLongWriteEnabled) return
    if (!workRoot || !isTauriApp()) return
    if (!activeFile) return
    if (autoLongWriteRunning) return
    if (chatMessages.some((m) => m.streaming)) return
    void runAutoLongWrite()
  }, [activeFile, autoLongWriteEnabled, autoLongWriteRunning, chatMessages, runAutoLongWrite, workRoot])

  const onWriterModeChange = useCallback(
    async (mode: WriterMode) => {
      if (!workRoot || !isTauriApp()) {
        setWriterMode(mode)
        writerModeRef.current = mode
        return
      }
      setWriterMode(mode)
      writerModeRef.current = mode
      const session = await novelPlannerService.setSessionMode(chatSessionIdRef.current, mode)
      setPlannerState(session)
      if (mode === 'normal') {
        setPlannerLastRunError(null)
        return
      }
      setPlannerBusy(true)
      try {
        await ensurePlanningArtifacts(mode)
        await refreshPlannerQueue()
      } catch (e) {
        setPlannerLastRunError(e instanceof Error ? e.message : String(e))
      } finally {
        setPlannerBusy(false)
      }
    },
    [ensurePlanningArtifacts, refreshPlannerQueue, workRoot],
  )

  const runPlannerQueue = useCallback(
    async (userInstruction = '') => {
      await runPlannerQueueWorkflow({
        workRoot,
        isTauriRuntime: isTauriApp(),
        writerMode,
        plannerQueueRunning,
        plannerStopRef,
        chatSessionId: chatSessionIdRef.current,
        tree,
        activePath,
        userInstruction,
        streamRefs,
        plannerService: novelPlannerService,
        setPlannerQueueRunning,
        setPlannerLastRunError,
        setPlannerBusy,
        setPlannerTasks,
        ensurePlanningArtifacts,
        onSendChat,
        waitForStreamCompletion,
        validateTaskQuality,
        extractTaskSummaryFromMessage,
        refreshTree,
      })
    },
    [
      activePath,
      ensurePlanningArtifacts,
      extractTaskSummaryFromMessage,
      onSendChat,
      plannerQueueRunning,
      refreshTree,
      validateTaskQuality,
      waitForStreamCompletion,
      workRoot,
      writerMode,
      tree,
    ],
  )

  const onRunNextPlannerTask = useCallback(async () => {
    if (!workRoot || !isTauriApp()) return
    if (plannerQueueRunning || plannerBusy) return
    const nextTask = novelPlannerService.getNextExecutableTask(plannerTasks)
    if (!nextTask) return
    await onOpenByPath(nextTask.scope)
    await runPlannerQueue(nextTask.task_prompt || nextTask.title)
  }, [isTauriApp, onOpenByPath, plannerBusy, plannerQueueRunning, plannerTasks, runPlannerQueue, workRoot])

  const onRetryPlannerTask = useCallback(
    async (taskId: string) => {
      if (!workRoot || !isTauriApp()) return
      const next = await novelPlannerService.updateTask(writerMode, taskId, (task) => ({
        ...task,
        status: 'retry',
        last_error: undefined,
      }))
      setPlannerTasks(next)
    },
    [isTauriApp, workRoot, writerMode],
  )

  const onMarkPlannerTaskDone = useCallback(
    async (taskId: string) => {
      if (!workRoot || !isTauriApp()) return
      const target = plannerTasks.find((task) => task.id === taskId)
      if (!target) return
      const next = await novelPlannerService.updateTask(writerMode, taskId, (task) => ({
        ...task,
        status: 'done',
        completed_at: new Date().toISOString(),
        last_error: undefined,
      }))
      await novelPlannerService.appendContinuityEntry(target, 'Task marked done from AI sidebar')
      setPlannerTasks(next)
    },
    [isTauriApp, plannerTasks, workRoot, writerMode],
  )

  // --- DiffView Handlers ---

  const onAcceptModification = useCallback(async (changeSetId: string, modificationId: string) => {
    try {
      await modificationService.acceptModification(changeSetId, modificationId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
      await refreshMemoryIndices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext, refreshMemoryIndices])

  const onRejectModification = useCallback((changeSetId: string, modificationId: string) => {
    try {
      modificationService.rejectModification(changeSetId, modificationId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

  const onAcceptAllModifications = useCallback(async (changeSetId: string) => {
    try {
      await modificationService.acceptAll(changeSetId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
      // Refresh tree after accepting all modifications
      await refreshTree()
      await refreshMemoryIndices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext, refreshMemoryIndices, refreshTree])

  const onRejectAllModifications = useCallback((changeSetId: string) => {
    try {
      modificationService.rejectAll(changeSetId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

  const onCloseDiffView = useCallback((changeSetId: string) => {
    diffContext.removeChangeSet(changeSetId)
    if (activeDiffTab === changeSetId) {
      // Switch to another tab if available
      const remainingChangeSets = Array.from(diffContext.changeSets.keys()).filter(id => id !== changeSetId)
      setActiveDiffTab(remainingChangeSets[0] || null)
    }
    // Close panel if no more change sets
    if (diffContext.changeSets.size <= 1) {
      setShowDiffPanel(false)
    }
  }, [diffContext, activeDiffTab])

  const onOpenDiffView = useCallback((changeSetId: string) => {
    setShowDiffPanel(true)
    setActiveDiffTab(changeSetId)
    diffContext.setActiveChangeSet(changeSetId)
  }, [diffContext])

  // --- Editor Context Menu Handlers ---

  // TODO: Re-implement for Lexical in task 13
  // const openEditorContextMenu = useCallback((e: MouseEvent) => {
  //   e.preventDefault()
  //   e.stopPropagation()
  //
  //   const selectedText = getSelectionText()
  //   if (!selectedText || selectedText.trim().length === 0) {
  //     return
  //   }
  //
  //   setEditorContextMenu({
  //     x: e.clientX,
  //     y: e.clientY,
  //     selectedText,
  //   })
  // }, [getSelectionText])

  const closeEditorContextMenu = useCallback(() => {
    setEditorContextMenu(null)
  }, [])

  const resolveSelectionLineRange = useCallback(
    (editor: LexicalEditorType | null | undefined, selectedText: string): SelectionLineRange => {
      if (!activeFile) {
        return { startLine: 1, endLine: 1 }
      }

      const content = activeFile.content
      const withBounds = (value: number) => Math.max(0, Math.min(value, content.length))
      const toLine = (offset: number) => content.slice(0, withBounds(offset)).split('\n').length

      const extendedEditor = editor as ExtendedLexicalEditor | null | undefined
      const offsets = extendedEditor?.getSelectionOffsets?.()
      if (offsets) {
        const start = withBounds(offsets.start)
        const end = withBounds(offsets.end)
        return {
          startLine: toLine(start),
          endLine: toLine(Math.max(start, end)),
        }
      }

      const index = content.indexOf(selectedText)
      if (index >= 0) {
        const end = index + selectedText.length
        return {
          startLine: toLine(index),
          endLine: toLine(end),
        }
      }

      return { startLine: 1, endLine: 1 }
    },
    [activeFile],
  )

  const runInlineAIAssist = useCallback(
    async (command: InlineAIAssistCommand, selection: string, editor?: LexicalEditorType | null) => {
      if (!activeFile) return
      const selectedText = selection.trim()
      if (!selectedText) return

      setBusy(true)
      setError(null)

      try {
        let response: AIAssistanceResponse
        switch (command) {
          case 'polish':
            response = await aiAssistanceService.polishText(selectedText, activeFile.path)
            break
          case 'expand':
            response = await aiAssistanceService.expandText(selectedText, activeFile.path)
            break
          case 'condense':
            response = await aiAssistanceService.condenseText(selectedText, activeFile.path)
            break
          default:
            return
        }

        const lineRange = resolveSelectionLineRange(editor ?? editorRef.current, selectedText)
        const changeSet = aiAssistanceService.convertToChangeSet(
          response,
          activeFile.path,
          activeFile.content,
          lineRange.startLine,
          lineRange.endLine,
        )

        modificationService.registerImportedChangeSet(changeSet, activeFile.content)
        diffContext.addChangeSet(changeSet)
        const applyMode: AiEditApplyMode = appSettings?.ai_edit_apply_mode ?? 'review'
        if (applyMode === 'auto_apply') {
          await modificationService.acceptAll(changeSet.id)
          const updatedChangeSet = modificationService.getChangeSet(changeSet.id)
          if (updatedChangeSet) {
            diffContext.updateChangeSet(updatedChangeSet)
          }
          await refreshTree()
        } else {
          onOpenDiffView(changeSet.id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [activeFile, appSettings, diffContext, onOpenDiffView, refreshTree, resolveSelectionLineRange],
  )

  const handleAIPolish = useCallback(async () => {
    if (!editorContextMenu) return
    await runInlineAIAssist('polish', editorContextMenu.selectedText, editorRef.current)
  }, [editorContextMenu, runInlineAIAssist])

  const handleAIExpand = useCallback(async () => {
    if (!editorContextMenu) return
    await runInlineAIAssist('expand', editorContextMenu.selectedText, editorRef.current)
  }, [editorContextMenu, runInlineAIAssist])

  const handleAICondense = useCallback(async () => {
    if (!editorContextMenu) return
    await runInlineAIAssist('condense', editorContextMenu.selectedText, editorRef.current)
  }, [editorContextMenu, runInlineAIAssist])

  const handleEditorChange = useCallback((content: string) => {
    if (!activePath) return

    // Skip state updates when content is unchanged to reduce re-renders.
    setOpenFiles((prev) => {
      let changed = false
      const next = prev.map((f) => {
        if (f.path !== activePath) return f
        // Only mark as dirty if content actually changed from saved version
        if (f.content === content) {
          // Content matches saved version, ensure dirty is false
          if (f.dirty) {
            changed = true
            return { ...f, dirty: false }
          }
          return f
        }
        changed = true
        return { ...f, content, dirty: true }
      })
      return changed ? next : prev
    })
  }, [activePath])

  const handleEditorReady = useCallback((editor: LexicalEditorType) => {
    if (!activePath) return

    // Register editor with EditorManager
    editorManager.createEditor(activePath, editor)
    // TODO: Add context menu handler for Lexical (task 13)
    // TODO: Add character hover provider for Lexical (task 7)
  }, [activePath])

  // --- Effects ---

  // Handle tab switching with state save/restore
  useEffect(() => {
    if (!activePath || !editorRef.current) return

    // Save state of previous tab
    const previousPath = openFiles.find(f => f.path !== activePath)?.path
    if (previousPath) {
      editorManager.saveState(previousPath)
    }

    // Restore state of current tab
    editorManager.restoreState(activePath)
  }, [activePath, openFiles])

  useEffect(() => {
    if (!showPreview || !activeFile) {
      setPreviewHtml('')
      return
    }
    const content = activeFile.content
    const t = window.setTimeout(() => {
      try {
        const escapeHtml = (s: string) =>
          s.replace(/[&<>"']/g, (c) => {
            if (c === '&') return '&amp;'
            if (c === '<') return '&lt;'
            if (c === '>') return '&gt;'
            if (c === '"') return '&quot;'
            return '&#39;'
          })
        if (isMarkdownFile) {
          const html = marked.parse(content, { breaks: true }) as string
          setPreviewHtml(DOMPurify.sanitize(html))
        } else {
          setPreviewHtml(DOMPurify.sanitize(`<pre>${escapeHtml(content)}</pre>`))
        }
      } catch {
        setPreviewHtml('')
      }
    }, 120)
    return () => window.clearTimeout(t)
  }, [activeFile, isMarkdownFile, showPreview])

  useEffect(() => {
    if (!isTauriApp()) return
    void reloadAppSettings()
    void getWritingAssistants()
      .then((list) => {
        setWritingAssistantsState(list)
        setAssistantEditorId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => setWritingAssistantsState([]))
  }, [reloadAppSettings])

  useEffect(() => {
    if (!appSettings) return
    if (writingAssistantsState.length === 0) return
    if (writingAssistantsState.some((agent) => agent.id === activeWritingAssistantId)) return
    const fallback = writingAssistantsState[0]?.id ?? ''
    if (!fallback) return
    const prev = appSettings
    const next = { ...appSettings, active_writing_assistant_id: fallback, active_agent_id: fallback }
    setAppSettingsState(next)
    void persistAppSettings(next, prev)
  }, [activeWritingAssistantId, writingAssistantsState, appSettings, persistAppSettings])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!appSettings) return
    void (async () => {
      const entries = await Promise.all(
        appSettings.providers.map(async (p) => {
          try {
            const ok = await getApiKeyStatus(p.id)
            return [p.id, ok] as const
          } catch {
            return [p.id, false] as const
          }
        }),
      )
      const next: Record<string, boolean> = {}
      for (const [id, ok] of entries) next[id] = ok
      setApiKeyStatus(next)
    })()
  }, [appSettings])

  useEffect(() => {
    const updateLayout = () => {
      setIsMobileLayout(window.innerWidth <= 900)
    }
    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])

  useEffect(() => {
    if (!isMobileLayout) return
    setSidebarCollapsed(true)
    setActiveRightTab(null)
  }, [isMobileLayout])

  useEffect(() => {
    if (isMobileLayout) {
      stopResize()
      return
    }
    const handleMouseMove = (event: globalThis.MouseEvent) => onResizeMove(event)
    const handleMouseUp = () => stopResize()
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      stopResize()
    }
  }, [isMobileLayout, onResizeMove, stopResize])

  useEffect(() => {
    if (!isMobileLayout) return
    if (!activePath) return
    setSidebarCollapsed(true)
  }, [isMobileLayout, activePath])

  useEffect(() => {
    if (autoOpenedRef.current) return
    autoOpenedRef.current = true
    void (async () => {
      if (!isTauriApp()) {
        setAppView('bookshelf')
        return
      }
      try {
        const pickerState = await getBookshelfState()
        setBookshelfRoot(pickerState.default_root)
        setRecentWorks(pickerState.default_projects)
        setImportedWorks(pickerState.external_projects)
        setLastWorkPath(pickerState.last_workspace)
        setLaunchModeState(pickerState.launch_mode)

        if (pickerState.launch_mode === 'auto_last' && pickerState.last_workspace) {
          const opened = await openWorkPath(pickerState.last_workspace)
          if (opened) {
            setAppView('studio')
            return
          }
        }
        setAppView('bookshelf')
      } catch {
        setAppView('bookshelf')
        setLastWorkPath(null)
      }
    })()
  }, [openWorkPath])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workRoot) return
    void (async () => {
      try {
        const t = await listWorkTree(6)
        setTree(t)
      } catch {
        setTree(null)
      }
    })()
    void loadProjectWritingSettings()
    void refreshBookshelfState()
    setAppView((prev) => (prev === 'studio' ? prev : 'studio'))
  }, [loadProjectWritingSettings, refreshBookshelfState, workRoot])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workRoot) return
    void loadPlannerSession().catch((e) => {
      setPlannerLastRunError(e instanceof Error ? e.message : String(e))
    })
    void refreshChatSessionSummaries()
    void refreshMemoryIndices()
  }, [loadPlannerSession, refreshChatSessionSummaries, refreshMemoryIndices, workRoot])

  useEffect(() => {
    if (!workRoot || !isTauriApp()) return
    if (writerMode === 'normal') return
    if (!(plannerState?.auto_run ?? false)) return
    if (plannerQueueRunning || plannerBusy) return
    const next = novelPlannerService.getNextExecutableTask(plannerTasks)
    if (!next) return
    void runPlannerQueue()
  }, [isTauriApp, plannerBusy, plannerQueueRunning, plannerState, plannerTasks, runPlannerQueue, workRoot, writerMode])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workRoot) return
    const timer = window.setTimeout(() => {
      setShowRecoveryDialog(true)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [workRoot])

  // Subscribe to editor config changes and apply CSS variables
  useEffect(() => {
    const unsubscribe = editorConfigManager.subscribe((config) => {
      setEditorUserConfig(config)

      // Apply CSS variables to the editor container
      const editorContainer = document.querySelector('.lexical-editor-wrapper')
      if (editorContainer instanceof HTMLElement) {
        const cssVars = editorConfigManager.getCSSVariables()
        Object.entries(cssVars).forEach(([key, value]) => {
          editorContainer.style.setProperty(key, value)
        })
      }
    })

    // Apply initial CSS variables
    const editorContainer = document.querySelector('.lexical-editor-wrapper')
    if (editorContainer instanceof HTMLElement) {
      const cssVars = editorConfigManager.getCSSVariables()
      Object.entries(cssVars).forEach(([key, value]) => {
        editorContainer.style.setProperty(key, value)
      })
    }

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return
    const unlistenFns: Array<() => void> = []
    let disposed = false
    const normalizeStreamId = (v: unknown): string | null => {
      if (typeof v === 'string' && v) return v
      return null
    }
    const parsePayload = (payload: unknown): Record<string, unknown> | null => {
      if (!payload) return null
      if (typeof payload === 'string') {
        try {
          const v: unknown = JSON.parse(payload)
          if (v && typeof v === 'object') return v as Record<string, unknown>
          return null
        } catch {
          return null
        }
      }
      if (typeof payload === 'object') return payload as Record<string, unknown>
      return null
    }
    const subscribe = (eventName: string, handler: (payload: unknown) => void) => {
      void listen(eventName, (event) => {
        if (disposed) return
        handler(event.payload)
      })
        .then((unlisten) => {
          if (disposed) {
            unlisten()
            return
          }
          unlistenFns.push(unlisten)
        })
        .catch((e) => {
          if (!disposed) {
            console.error(`[ai-events] subscribe failed for ${eventName}`, e)
          }
        })
    }

    subscribe('ai_stream_start', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const now = Date.now()
      streamStartedAtRef.current.set(streamId, now)
      streamLastTokenAtRef.current.set(streamId, now)
    })

    subscribe('ai_stream_token', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const now = Date.now()
      if (!streamStartedAtRef.current.has(streamId)) {
        streamStartedAtRef.current.set(streamId, now)
      }
      streamLastTokenAtRef.current.set(streamId, now)
      const token = typeof p.token === 'string' ? p.token : ''
      if (!token) return
      const prevText = streamOutputRef.current.get(streamId) ?? ''
      const merged = appendStreamTextWithOverlap(prevText, token)
      if (!merged.appended) return
      streamOutputRef.current.set(streamId, merged.next)
      const visibleText = stripInternalToolTrace(merged.next)
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId ? { ...m, content: visibleText } : m,
        ),
      )
    })

    subscribe('ai_agent_step', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      streamLastTokenAtRef.current.set(streamId, Date.now())
      const stepRaw = typeof p.step === 'number' ? p.step : Number(p.step)
      if (!Number.isFinite(stepRaw)) return
      const tool = typeof p.tool === 'string' ? p.tool.trim() : ''
      if (!tool) return
      const phase = typeof p.phase === 'string' ? p.phase : ''
      const ok = p.ok === false ? false : p.ok === true ? true : null
      const status: AgentToolActivity['status'] =
        phase === 'start' ? 'running' : ok === false ? 'error' : 'success'
      const actionIdRaw = typeof p.actionId === 'string' ? p.actionId.trim() : ''
      const inputPreview = typeof p.inputPreview === 'string' ? p.inputPreview : ''
      const observationPreview = typeof p.observationPreview === 'string' ? p.observationPreview : undefined
      const listItems = Array.isArray(p.listItems)
        ? p.listItems.flatMap((entry) => {
            if (!isRecord(entry)) return []
            const name = typeof entry.name === 'string' ? entry.name : ''
            const kind = entry.kind === 'dir' ? 'dir' : entry.kind === 'file' ? 'file' : null
            if (!name || !kind) return []
            return [{ name, kind } as AgentToolListItem]
          })
        : undefined
      const listTruncated =
        p.listTruncated === true ? true : p.listTruncated === false ? false : undefined
      const exists =
        p.exists === true ? true : p.exists === false ? false : undefined
      const existsKind =
        p.existsKind === 'dir' ? 'dir' : p.existsKind === 'file' ? 'file' : undefined
      const readPath = typeof p.readPath === 'string' ? p.readPath : undefined
      const readLinesRaw = typeof p.readLines === 'number' ? p.readLines : Number(p.readLines)
      const readCharsRaw = typeof p.readChars === 'number' ? p.readChars : Number(p.readChars)
      const readPreview = typeof p.readPreview === 'string' ? p.readPreview : undefined
      const writePath = typeof p.writePath === 'string' ? p.writePath : undefined
      const writeLinesRaw = typeof p.writeLines === 'number' ? p.writeLines : Number(p.writeLines)
      const writeCharsRaw = typeof p.writeChars === 'number' ? p.writeChars : Number(p.writeChars)
      const writePreview = typeof p.writePreview === 'string' ? p.writePreview : undefined
      const timestamp = typeof p.timestamp === 'number' ? p.timestamp : Date.now()
      const durationMsRaw = typeof p.durationMs === 'number' ? p.durationMs : Number(p.durationMs)
      const activity: AgentToolActivity = {
        actionId: actionIdRaw || `step-${Math.max(1, Math.floor(stepRaw))}`,
        step: Math.max(1, Math.floor(stepRaw)),
        tool,
        status,
        inputPreview,
        observationPreview,
        listItems,
        listTruncated,
        exists,
        existsKind,
        readPath,
        readLines: Number.isFinite(readLinesRaw) ? Math.max(0, Math.floor(readLinesRaw)) : undefined,
        readChars: Number.isFinite(readCharsRaw) ? Math.max(0, Math.floor(readCharsRaw)) : undefined,
        readPreview,
        writePath,
        writeLines: Number.isFinite(writeLinesRaw) ? Math.max(0, Math.floor(writeLinesRaw)) : undefined,
        writeChars: Number.isFinite(writeCharsRaw) ? Math.max(0, Math.floor(writeCharsRaw)) : undefined,
        writePreview,
        timestamp,
        startedAt: phase === 'start' ? timestamp : undefined,
        finishedAt: phase === 'finish' ? timestamp : undefined,
        durationMs: Number.isFinite(durationMsRaw) ? Math.max(0, Math.floor(durationMsRaw)) : undefined,
      }
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? { ...m, toolEvents: upsertToolActivity(m.toolEvents, activity) }
            : m,
        ),
      )
    })

    subscribe('ai_stream_done', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const cancelled = p.cancelled === true
      const streamVersionGroupId = streamAssistantGroupRef.current.get(streamId)
      const rawOutput = streamOutputRef.current.get(streamId) ?? ''
      const hasOutput = rawOutput.trim().length > 0
      const visibleOutput = stripInternalToolTrace(rawOutput)
      const hasVisibleOutput = visibleOutput.trim().length > 0
      if (cancelled) {
        streamFailuresRef.current.add(streamId)
      }
      if (!cancelled && !hasOutput) {
        streamFailuresRef.current.add(streamId)
      }
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? (() => {
              const groupId = m.versionGroupId ?? streamVersionGroupId ?? m.id
              const mergedCancelled = cancelled || m.cancelled
              const sanitizedContent = stripInternalToolTrace(m.content)
              const sanitizedTrim = sanitizedContent.trim()
              const hasChangeSet = !!m.changeSet && m.changeSet.modifications.length > 0
              const normalizedContent =
                !mergedCancelled && !hasVisibleOutput
                  ? hasChangeSet
                    ? t('chat.collapsedForDiff')
                    : !hasOutput && !sanitizedTrim
                      ? t('chat.error.emptyResponseRetry')
                      : t('chat.error.actionsNoDirectOutput')
                  : sanitizedContent
              const normalizedFailureKind: ChatFailureKind | undefined = mergedCancelled
                ? 'cancelled'
                : !hasVisibleOutput
                  ? (m.failureKind ?? (hasChangeSet ? undefined : inferFailureKindFromText(normalizedContent)))
                  : undefined
              const registered = upsertAssistantVersion(groupId, {
                content: normalizedContent,
                changeSet: m.changeSet,
                cancelled: mergedCancelled,
                failureKind: normalizedFailureKind,
                timestamp: Date.now(),
              })
              return {
                ...m,
                content: normalizedContent,
                streaming: false,
                cancelled: mergedCancelled,
                failureKind: normalizedFailureKind,
                versionGroupId: groupId,
                versionIndex: registered.index,
                versionCount: registered.count,
                }
              })()
            : m,
        ),
      )
      setStreamPhaseById((prev) => {
        if (!(streamId in prev)) return prev
        const next = { ...prev }
        delete next[streamId]
        return next
      })
      const waiter = streamWaitersRef.current.get(streamId)
      if (waiter) {
        streamWaitersRef.current.delete(streamId)
        if (streamFailuresRef.current.has(streamId)) {
          streamFailuresRef.current.delete(streamId)
          waiter.reject(new Error(cancelled ? 'AI generation cancelled' : 'AI task failed'))
        } else {
          waiter.resolve()
        }
      }
      const finishedGroupId = streamAssistantGroupRef.current.get(streamId)
      if (finishedGroupId && hasOutput) {
        versionGroupAutoRetryCountRef.current.delete(finishedGroupId)
      }
      window.setTimeout(() => {
        cleanupStreamRefs(streamRefs, streamId)
      }, 30000)
    })

    subscribe('ai_stream_status', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const phase = typeof p.phase === 'string' ? p.phase : ''
      if (!phase) return
      streamLastTokenAtRef.current.set(streamId, Date.now())
      setStreamPhaseById((prev) => ({ ...prev, [streamId]: phase }))
    })

    subscribe('ai_change_set', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const imported = parseBackendChangeSets(p.changeSet)
      if (imported.length === 0) return
      const rollbackTurn = rollbackTurnStackRef.current.find((turn) => turn.streamId === streamId)
      if (rollbackTurn) {
        const mergedIds = new Set(rollbackTurn.changeSetIds)
        for (const item of imported) {
          mergedIds.add(item.changeSet.id)
        }
        rollbackTurn.changeSetIds = Array.from(mergedIds)
      }

      for (const item of imported) {
        modificationService.registerImportedChangeSet(item.changeSet, item.originalContent)
        diffContext.addChangeSet(item.changeSet)
      }

      const primaryChangeSet = imported[0]?.changeSet
      if (primaryChangeSet) {
        setChatMessages((prev) =>
          prev.map((m) => (m.role === 'assistant' && m.streamId === streamId ? { ...m, changeSet: primaryChangeSet } : m)),
        )
      }

        const applyMode: AiEditApplyMode = appSettings?.ai_edit_apply_mode ?? 'review'
        if (applyMode === 'auto_apply') {
        void (async () => {
          try {
            for (const item of imported) {
              await modificationService.acceptAll(item.changeSet.id)
              const updated = modificationService.getChangeSet(item.changeSet.id)
              if (updated) {
                diffContext.updateChangeSet(updated)
              }
            }
            await refreshTree()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        })()
      } else if (primaryChangeSet) {
        onOpenDiffView(primaryChangeSet.id)
      }
    })

    subscribe('ai_error', (rawPayload) => {
      const p = parsePayload(rawPayload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const rawMessage = typeof p.message === 'string' ? p.message : 'AI call failed'
      const stage = typeof p.stage === 'string' ? p.stage : ''
      const provider = typeof p.provider === 'string' ? p.provider : ''
      const lowerMessage = rawMessage.toLowerCase()
      const message =
        stage === 'timeout'
          ? t('chat.error.timeoutStoppedSmallerTask')
          : lowerMessage.includes('no api key configured') || lowerMessage.includes('api key not found')
            ? t('chat.error.noApiKeyConfigured')
            : rawMessage
      const failureKind = inferFailureKindFromText(message, stage)
      const extra = [provider ? `provider=${provider}` : '', stage ? `stage=${stage}` : ''].filter(Boolean).join(' ')
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? { ...m, content: extra ? `${message}\n(${extra})` : message, streaming: false, failureKind }
            : m,
        ),
      )
      setStreamPhaseById((prev) => {
        if (!(streamId in prev)) return prev
        const next = { ...prev }
        delete next[streamId]
        return next
      })
      streamFailuresRef.current.add(streamId)
      const waiter = streamWaitersRef.current.get(streamId)
      if (waiter) {
        streamWaitersRef.current.delete(streamId)
        streamFailuresRef.current.delete(streamId)
        waiter.reject(new Error(extra ? `${message} (${extra})` : message))
      }
      window.setTimeout(() => {
        cleanupStreamRefs(streamRefs, streamId)
      }, 1000)
    })

    return () => {
      disposed = true
      for (const u of unlistenFns) u()
    }
  }, [appSettings, diffContext, onOpenDiffView, refreshTree, t, upsertAssistantVersion])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workRoot) return
    let timer: number | null = null
    const unlistenFns: Array<() => void> = []
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refreshTree(), 200)
    }
    void listen('fs_changed', () => {
      scheduleRefresh()
    }).then((u) => unlistenFns.push(u))
    void listen('fs_watch_error', (event) => {
      const payload: unknown = event.payload
      if (payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string') {
        setError((payload as { message: string }).message)
      }
    }).then((u) => unlistenFns.push(u))
    return () => {
      if (timer) window.clearTimeout(timer)
      for (const u of unlistenFns) u()
    }
  }, [workRoot, refreshTree])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void onSaveActive()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
        return
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        closeActiveTab()
        return
      }
      if (mod && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        focusNeighborTab(e.shiftKey ? 'prev' : 'next')
        return
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearchPanel(true)
        return
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowSearchPanel(true)
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeActiveTab, focusNeighborTab, onSaveActive, toggleSidebar])

  useEffect(() => {
    if (!isTauriApp()) return
    const hasUnsaved = openFiles.some((f) => f.dirty) || settingsDirty
    if (!hasUnsaved) return
    let unlisten: null | (() => void) = null
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const ok = await showConfirm('You have unsaved changes. Close anyway?')
        if (!ok) event.preventDefault()
      })
      .then((u) => {
        unlisten = u
      })
    return () => {
      if (unlisten) unlisten()
    }
  }, [openFiles, settingsDirty, showConfirm])

  useEffect(() => {
    if (!isTauriApp()) return
    if (chatMessages.length === 0) return
    if (chatMessages.some((m) => m.streaming)) return
    void saveChatSession({
      id: chatSessionIdRef.current,
      workspace_root: workRoot ?? '',
      created_at: 0,
      updated_at: 0,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    })
      .then(() => {
        void refreshChatSessionSummaries()
      })
      .catch(() => {})
  }, [chatMessages, refreshChatSessionSummaries, workRoot])

  useEffect(() => {
    if (!activePath) return
    return () => {}
  }, [activePath])

  useEffect(() => {
    // Only render graph if the tab is active
    if (activeRightTab !== 'graph') return
    const canvas = graphCanvasRef.current
    if (!canvas) return
    // Adjust size based on container? For now use fixed-ish or flexible CSS
    // We'll rely on ResizeObserver or simple effect
    const cssW = canvas.clientWidth || 300
    const cssH = canvas.clientHeight || 500
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    // canvas.style.width is handled by CSS (100%)

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const nodes = graphNodes.slice()
    const n = nodes.length
    const cx = cssW / 2
    const cy = cssH / 2
    const r = Math.min(cssW, cssH) * 0.35

    const placed = nodes.map((node, i) => {
      const a = (Math.PI * 2 * i) / Math.max(1, n)
      return { ...node, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    })

    const byId = new Map<string, { id: string; name: string; x: number; y: number }>()
    for (const p of placed) byId.set(p.id, p)

    ctx.lineWidth = 1
    ctx.strokeStyle = '#3a3a3a'
    for (const e of graphEdges) {
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    for (const p of placed) {
      ctx.beginPath()
      ctx.fillStyle = '#2a2a2a'
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#4a4a4a'
      ctx.stroke()
      ctx.fillStyle = '#d4d4d4'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.name, p.x, p.y)
    }
  }, [activeRightTab, graphNodes, graphEdges]) // Re-render when tab changes or data changes

  // --- Render ---

  if (appView === 'bookshelf') {
    return (
      <BookshelfPage
        busy={busy}
        error={error}
        defaultRoot={bookshelfRoot}
        recentWorks={recentWorks}
        importedWorks={importedWorks}
        lastWorkPath={lastWorkPath}
        launchMode={launchMode}
        onSelectProject={onOpenProjectFromPicker}
        onCreateProject={(name) => void onCreateProjectFromPicker(name)}
        onLoadExternalProject={() => void onLoadExternalProject()}
        onForgetExternalProject={(path) => void onForgetExternalProject(path)}
        onRefresh={() => void refreshBookshelfState()}
        onLaunchModeChange={(mode) => void onLaunchModeChange(mode)}
        manualPathEnabled={!isTauriApp()}
        onOpenManualPath={(path) => {
          void onOpenProjectFromPicker(path, 'external')
        }}
      />
    )
  }

  return (
    <div className="app-container" data-theme={theme} data-density={uiDensity} data-motion={uiMotion} style={layoutCssVars}>
      <div className="workbench-body">
        {/* Activity Bar (Left) */}
        <div className="activity-bar">
          <div
            className={`activity-bar-item ${activeSidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('files')}
            title={t('app.activity.workspaceStructure')}
          >
            <span className="activity-bar-icon"><AppIcon name="chapters" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'chapters' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('chapters')}
            title={t('app.activity.chapters')}
          >
            <span className="activity-bar-icon"><AppIcon name="chapters" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'characters' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('characters')}
            title={t('app.activity.characters')}
          >
            <span className="activity-bar-icon"><AppIcon name="characters" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'plotlines' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('plotlines')}
            title={t('app.activity.plotLines')}
          >
            <span className="activity-bar-icon"><AppIcon name="plotlines" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'risk' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('risk')}
            title={t('app.activity.riskReview')}
          >
            <span className="activity-bar-icon"><AppIcon name="risk" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'history' ? 'active' : ''}`}
            onClick={() => toggleSidebarTab('history')}
            title={t('app.activity.history')}
          >
            <span className="activity-bar-icon"><AppIcon name="history" /></span>
          </div>
          <div className="spacer" />
          <div
            className="activity-bar-item"
            onClick={() => {
              setAppView('bookshelf')
              void refreshBookshelfState()
            }}
            title={t('app.activity.projectPicker')}
          >
            <span className="activity-bar-icon"><AppIcon name="projectSwitch" /></span>
          </div>
          <div
            className="activity-bar-item"
            onClick={() => {
              setShowSettings(true)
              if (!appSettings) void reloadAppSettings()
            }}
            title={t('app.activity.settings')}
          >
            <span className="activity-bar-icon"><AppIcon name="settings" /></span>
          </div>
        </div>

        {/* Sidebar Panel (Left) */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
                {activeSidebarTab === 'files' ? (
          <NovelStructurePanel
            workRoot={workRoot}
            tree={tree}
            activePath={activePath}
            busy={busy}
            error={error}
            onRefresh={() => void refreshTree()}
            onOpenPath={(path) => {
              void onOpenByPath(path)
            }}
            onNewChapter={() => void onNewChapter()}
            onNewOutline={() => void onNewOutline()}
            onNewConceptNote={() => void onNewConceptNote()}
            onOpenMasterPlan={() => void onOpenMasterPlanDoc()}
            onOpenProjectPicker={() => {
              setAppView('bookshelf')
              void refreshBookshelfState()
            }}
            onDeletePath={(path) => {
              void onDeleteStructurePath(path)
            }}
          />
        ) : null}

        {activeSidebarTab === 'history' ? (
          <HistoryPanel
            workRoot={workRoot}
            activePath={activePath}
            onOpenPath={(path, options) => {
              void onOpenByPath(path, options)
            }}
            onAfterRestore={() => {
              if (workRoot) {
                void refreshTree()
              }
            }}
          />
        ) : null}

        {activeSidebarTab === 'chapters' ? (
          <ChapterManager
            onChapterClick={(chapter) => {
              // Open the chapter file in the editor
              void onOpenByPath(chapter.filePath)
            }}
            onChapterUpdate={() => {
              // Optionally refresh the file tree or perform other updates
              if (workRoot) {
                void refreshTree()
              }
            }}
          />
        ) : null}

        {activeSidebarTab === 'characters' ? (
          <CharacterManager
            onCharacterClick={(character) => {
              // Optionally handle character click (e.g., show details)
              console.log('Character clicked:', character)
            }}
          />
        ) : null}

        {activeSidebarTab === 'plotlines' ? (
          <PlotLineManager
            onPlotLineClick={(plotLine) => {
              // Optionally handle plot line click (e.g., show details)
              console.log('Plot line clicked:', plotLine)
            }}
            onPlotLineUpdate={() => {
              // Optionally refresh the file tree or perform other updates
              if (workRoot) {
                void refreshTree()
              }
            }}
          />
        ) : null}

        {activeSidebarTab === 'risk' ? <RiskPanel activeFile={activeFile ? { path: activeFile.path, content: activeFile.content } : null} /> : null}
      </div>
      {!isMobileLayout && !sidebarCollapsed ? (
        <div
          className="layout-resize-handle layout-resize-handle-sidebar"
          onMouseDown={startSidebarResize}
          title="Drag to resize sidebar width"
        />
      ) : null}

      {/* Main Content */}
      <div className="main-content">
        <TabBar
          tabs={openFiles.map((f) => ({
            id: f.path,
            title: f.name,
            path: f.path,
            dirty: f.dirty,
          }))}
          activeTab={activePath}
          onTabSelect={(id) => setActivePath(id)}
          onTabClose={async (id) => {
            const file = openFiles.find(f => f.path === id)
            if (file?.dirty) {
              const ok = await showConfirm(t('app.confirm.unsavedClose', { name: file.name }))
              if (!ok) return
            }
            editorManager.destroyEditor(id)
            setOpenFiles((prev) => {
              const next = prev.filter((p) => p.path !== id)
              if (activePath === id) {
                setActivePath(next[next.length - 1]?.path ?? null)
              }
              return next
            })
          }}
          onTabsReorder={(fromIndex, toIndex) => {
            setOpenFiles((prev) => {
              const next = [...prev]
              const [removed] = next.splice(fromIndex, 1)
              next.splice(toIndex, 0, removed)
              return next
            })
          }}
        />
        {activeFile ? (
          <div className="editor-tabs-actions">
            <button className="icon-button" disabled={!workRoot} onClick={() => void onNewChapter()} title={t('app.action.newChapter')}>
              <AppIcon name="add" size={14} />
            </button>
            <button className="icon-button" disabled={!activeFile || !activeFile.dirty} onClick={() => void onSaveActive()} title={t('app.action.save')}>
              <AppIcon name="save" size={15} />
            </button>
            <button
              className="icon-button"
              disabled={!activeFile}
              onClick={() => setShowPreview((v) => !v)}
              title={t('app.action.preview')}
            >
              <AppIcon name="preview" size={15} />
            </button>
          </div>
        ) : null}
        <div className="editor-content">
          {activeFile ? (
            <>
              <div className="editor-pane" style={showPreview ? { width: '50%', maxWidth: '50%' } : undefined}>
                <LexicalEditor
                  key={activeFile.path}
                  initialContent={activeFile.content}
                  onChange={handleEditorChange}
                  config={editorConfig}
                  readOnly={false}
                  placeholder={t('app.editor.placeholder')}
                  editorRef={editorRef}
                  fileType={activeFile.path.split('.').pop() || 'txt'}
                  className="novel-editor"
                  onReady={handleEditorReady}
                  contextMenuItems={[
                    {
                      id: 'ai-polish',
                      label: t('app.editor.context.polish'),
                      icon: 'A',
                      action: async (editor, selection) => {
                        await runInlineAIAssist('polish', selection, editor)
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-expand',
                      label: t('app.editor.context.expand'),
                      icon: '+',
                      action: async (editor, selection) => {
                        await runInlineAIAssist('expand', selection, editor)
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-condense',
                      label: t('app.editor.context.condense'),
                      icon: '-',
                      action: async (editor, selection) => {
                        await runInlineAIAssist('condense', selection, editor)
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                  ]}
                />
              </div>
              {showPreview ? (
                <div className="preview-pane">
                  {previewHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  ) : (
                    <div className="preview-empty">Nothing to preview yet.</div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="welcome-screen">
              <h1>Novel-IDE</h1>
              <div className="welcome-actions">
                <button
                  className="welcome-btn"
                  onClick={() => {
                    setAppView('bookshelf')
                    void refreshBookshelfState()
                  }}
                >
                  {t('app.welcome.openProjectPicker')}
                </button>
              </div>
              {!workRoot && error ? <div className="error-text">{error}</div> : null}
            </div>
          )}
        </div>
      </div>

      {/* Right Activity Bar & Panel */}
      <div className="right-panel-container">
        {!isMobileLayout && activeRightTab ? (
          <div
            className="layout-resize-handle layout-resize-handle-right"
            onMouseDown={startRightPanelResize}
            title={t('app.action.dragResizeRight')}
          />
        ) : null}
        {activeRightTab ? (
          <aside className="right-panel-content">
            {activeRightTab === 'chat' ? (
              <AIChatPanel
                writerMode={writerMode}
                plannerLastRunError={plannerLastRunError}
                plannerTasks={plannerTasks}
                plannerBusy={plannerBusy}
                plannerQueueRunning={plannerQueueRunning}
                onRunNextPlannerTask={onRunNextPlannerTask}
                onRetryPlannerTask={(taskId) => void onRetryPlannerTask(taskId)}
                onMarkPlannerTaskDone={(taskId) => void onMarkPlannerTaskDone(taskId)}
                onOpenTaskScope={(path) => void onOpenByPath(path)}
                onNewSession={onNewChatSession}
                sessionSummaries={chatSessionOptions}
                activeSessionId={activeChatSessionId}
                sessionsLoading={chatSessionsLoading}
                onOpenSession={onOpenChatSession}
                memoryIndexLoading={memoryIndexLoading}
                characterStateIndexContent={characterStateIndexContent}
                characterStateIndexMeta={characterStateIndexMeta}
                foreshadowIndexContent={foreshadowIndexContent}
                foreshadowIndexMeta={foreshadowIndexMeta}
                onRefreshMemoryIndices={() => void refreshMemoryIndices()}
                onSaveMemoryIndex={(kind, content) => void onSaveMemoryIndex(kind, content)}
                onToggleMemoryIndexLock={(kind) => void onToggleMemoryIndexLock(kind)}
                onRestoreMemoryIndexAuto={(kind) => void onRestoreMemoryIndexAuto(kind)}
                chatMessages={chatMessages}
                messagesRef={aiMessagesRef}
                onAutoScrollChange={setChatAutoScroll}
                chatAutoScroll={chatAutoScroll}
                onScrollToBottom={onChatScrollToBottom}
                onSwitchAssistantVersion={onSwitchAssistantVersion}
                onOpenMessageContextMenu={openChatContextMenu}
                getStreamPhaseLabel={getStreamPhaseLabel}
                onOpenDiffView={onOpenDiffView}
                canUseEditorActions={!!activeFile}
                onQuoteSelection={onQuoteSelection}
                onSmartComplete={onSmartComplete}
                autoLongWriteEnabled={autoLongWriteEnabled}
                autoToggleDisabled={autoToggleDisabled}
                onToggleAutoLongWrite={onToggleAutoLongWrite}
                autoLongWriteStatus={autoLongWriteStatus}
                onWriterModeChange={(mode) => void onWriterModeChange(mode)}
                chatInput={chatInput}
                chatInputRef={chatInputRef}
                onChatInputChange={setChatInput}
                canRollbackLastTurn={canRollbackLastTurn}
                onRollbackLastTurn={onRollbackLastTurn}
                showStopAction={showStopAction}
                canStop={!!activeStreamId || autoLongWriteRunning}
                onStopChat={onStopChat}
                onSendChat={onSendChat}
                busy={busy}
                autoLongWriteRunning={autoLongWriteRunning}
                isChatStreaming={isChatStreaming}
                canRegenerateLatest={canRegenerateLatest}
                latestCompletedAssistantId={latestCompletedAssistant?.id}
                onRegenerateAssistant={onRegenerateAssistant}
                getRetryContextText={getRetryContextText}
                onGenerateAssistantCandidates={onGenerateAssistantCandidates}
                onRetryWithFallbackProvider={onRetryWithFallbackProvider}
                onOpenModelSettings={openModelSettings}
                reviewChangeSets={Array.from(diffContext.changeSets.values())}
                activeReviewChangeSetId={activeDiffTab}
                onOpenReviewChangeSet={onOpenDiffView}
                onAcceptReviewChangeSet={(changeSetId) => void onAcceptAllModifications(changeSetId)}
                onRejectReviewChangeSet={(changeSetId) => void onRejectAllModifications(changeSetId)}
                onAcceptReviewModification={(changeSetId, modificationId) => void onAcceptModification(changeSetId, modificationId)}
                onRejectReviewModification={(changeSetId, modificationId) => void onRejectModification(changeSetId, modificationId)}
                activeAssistantId={activeWritingAssistantId}
                assistants={chatAssistantOptions}
                onActiveAssistantChange={onChatAssistantChange}
                activeProviderId={effectiveProviderId}
                providers={chatProviderOptions}
                providerSelectInvalid={activeChatProviderInvalid}
                onActiveProviderChange={onChatProviderChange}
                activeDocumentPath={activeFile?.path ?? null}
                activeDocumentLabel={activeFile?.name ?? null}
                activeDocumentCharCount={activeCharCount}
                activeDocumentDirty={activeFile?.dirty === true}
                activeDocumentPreview={activeDocumentPreview}
                activeWorkLabel={activeWorkLabel}
              />
            ) : null}

            {activeRightTab === 'graph' ? (
              <div className="graph-panel">
                <div className="ai-header graph-header">
                  <button className="icon-button" onClick={() => void loadGraph()}>
                    {t('app.action.reloadGraph')}
                  </button>
                </div>
                <div className="graph-canvas-wrap">
                  <canvas ref={graphCanvasRef} className="graph-canvas" />
                </div>
                <div className="graph-footer">
                  {t('app.graph.dataSource')}
                </div>
              </div>
            ) : null}

            {activeRightTab === 'writing-goal' ? (
              <WritingGoalPanel
                onGoalUpdate={() => {
                  // Optionally refresh or perform other updates
                  console.log('Writing goal updated')
                }}
              />
            ) : null}
          </aside>
        ) : null}

        <div className="right-activity-bar">
          <div
            className={`right-activity-item ${activeRightTab === 'chat' ? 'active' : ''}`}
            onClick={() => toggleRightTab('chat')}
            title={t('app.panel.aiChat')}
          >
            <span className="right-activity-icon"><AppIcon name="chat" /></span>
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'graph' ? 'active' : ''}`}
            onClick={() => toggleRightTab('graph')}
            title={t('app.panel.characterGraph')}
          >
            <span className="right-activity-icon"><AppIcon name="graph" /></span>
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'writing-goal' ? 'active' : ''}`}
            onClick={() => toggleRightTab('writing-goal')}
            title={t('app.panel.writingGoal')}
          >
            <span className="right-activity-icon"><AppIcon name="target" /></span>
          </div>
        </div>
      </div>
    </div>

      {/* DiffView Panel */}
      {showDiffPanel && diffContext.changeSets.size > 0 ? (
        <div className="diff-panel-overlay">
          <div className="diff-panel-container">
            <div className="diff-panel-tabs">
              {Array.from(diffContext.changeSets.values()).map((changeSet) => (
                <div
                  key={changeSet.id}
                  className={`diff-panel-tab ${activeDiffTab === changeSet.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveDiffTab(changeSet.id)
                    diffContext.setActiveChangeSet(changeSet.id)
                  }}
                >
                  <span className="diff-panel-tab-title">
                    {changeSet.filePath.split('/').pop()}
                  </span>
                  <span className="diff-panel-tab-status">{changeSet.status}</span>
                  <button
                    className="diff-panel-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseDiffView(changeSet.id)
                    }}
                    title={t('app.diff.closeTab')}
                  >
                    x
                  </button>
                </div>
              ))}
              <div className="diff-panel-tabs-spacer" />
              <button
                className="diff-panel-close-all"
                onClick={() => {
                  setShowDiffPanel(false)
                  setActiveDiffTab(null)
                }}
                title={t('app.diff.closePanel')}
              >
                {t('app.diff.closePanel')}
              </button>
            </div>

            <div className="diff-panel-content">
              {activeDiffTab && diffContext.changeSets.has(activeDiffTab) ? (
                <div className="diff-panel-files">
                  <DiffView
                    changeSet={diffContext.changeSets.get(activeDiffTab)!}
                    viewMode={diffContext.viewMode}
                    onAccept={(modId) => onAcceptModification(activeDiffTab, modId)}
                    onReject={(modId) => onRejectModification(activeDiffTab, modId)}
                    onAcceptAll={() => onAcceptAllModifications(activeDiffTab)}
                    onRejectAll={() => onRejectAllModifications(activeDiffTab)}
                  />
                </div>
              ) : (
                <div className="diff-panel-empty">
                  <p>{t('app.diff.noSelection')}</p>
                </div>
              )}
            </div>

            <div className="diff-panel-footer">
              <button
                className="diff-panel-view-mode-toggle"
                onClick={() => diffContext.toggleViewMode()}
                title={`Switch to ${diffContext.viewMode === 'split' ? 'unified' : 'split'} view`}
              >
                {diffContext.viewMode === 'split' ? 'Switch to Unified' : 'Switch to Split'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      {showSettings ? (
        <div className="modal-overlay" onClick={requestCloseSettings}>
	          <div className="modal-content settings-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('common.settings')}</h2>
              <button className="close-btn" onClick={requestCloseSettings}>
                x
              </button>
            </div>
	            <div className="modal-body settings-modal-body">
              {!appSettings ? (
                <div className="settings-load-state">
                  <div className="settings-load-message">Failed to load settings. Please retry.</div>
                  {settingsError ? <div className="error-text">{settingsError}</div> : null}
                  <div className="settings-load-actions">
                    <button className="btn btn-secondary" onClick={() => void reloadAppSettings()}>
                      {t('common.reload')}
                    </button>
                    <button className="primary-button" onClick={() => setShowSettings(false)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
	              ) : (
	                <div className="settings-layout">
	                  <aside className="settings-nav">
	                    <button className={`settings-nav-item ${settingsTab === 'general' ? 'active' : ''}`} onClick={() => setSettingsTab('general')}>
                      {t('common.general')}
	                    </button>
	                    <button className={`settings-nav-item ${settingsTab === 'editor' ? 'active' : ''}`} onClick={() => setSettingsTab('editor')}>
	                      {t('common.writing')}
	                    </button>
	                    <button className={`settings-nav-item ${settingsTab === 'models' ? 'active' : ''}`} onClick={() => setSettingsTab('models')}>
	                      {t('common.models')}
	                    </button>
	                  </aside>
	                  <div className="settings-content">
	                <div className="settings-form settings-page">
	                {settingsTab === 'general' ? (
	                <div className="settings-section">
                  <h3 className="settings-section-title">{t('app.settings.generalTitle')}</h3>
                  <div className="form-group settings-inline-row">
                    <label className="settings-inline-label">{t('app.settings.markdownOutput')}</label>
                    <input
                      type="checkbox"
                      checked={appSettings.output.use_markdown}
                      onChange={(e) => {
                        const prev = appSettings
                        const next = { ...appSettings, output: { ...appSettings.output, use_markdown: e.target.checked } }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.launchMode')}</label>
                    <select
                      value={appSettings.launch_mode}
                      onChange={(e) => {
                        const mode = e.target.value as LaunchMode
                        const prev = appSettings
                        const next = { ...appSettings, launch_mode: mode }
                        setAppSettingsState(next)
                        setLaunchModeState(mode)
                        void persistAppSettings(next, prev)
                      }}
                      
                    >
                      <option value="picker">{t('app.settings.launchPicker')}</option>
                      <option value="auto_last">{t('app.settings.launchAutoLast')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.openProjectPicker')}</label>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowSettings(false)
                        setAppView('bookshelf')
                        void refreshBookshelfState()
                      }}
                    >
                      {t('app.settings.openProjectPicker')}
                    </button>
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.aiEditApplyMode')}</label>
                    <select
                      value={appSettings.ai_edit_apply_mode}
                      onChange={(e) => {
                        const mode = e.target.value as AiEditApplyMode
                        const prev = appSettings
                        const next = { ...appSettings, ai_edit_apply_mode: mode }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                      
                    >
                      <option value="auto_apply">{t('app.settings.aiApplyAuto')}</option>
                      <option value="review">{t('app.settings.aiApplyReview')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.chapterTarget')}</label>
                    <input
                      type="number"
                      value={chapterWordTarget}
                      onChange={(e) =>
                        updateProjectWritingSettings({
                          chapterWordTarget: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() => void saveProjectWritingSettings()}
                    />
                  </div>
                  <div className="form-group">
                    <label>Auto Minimum Characters</label>
                    <input
                      type="number"
                      value={autoLongWriteMinChars}
                      onChange={(e) =>
                        updateProjectWritingSettings({
                          autoMinChars: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() => void saveProjectWritingSettings()}
                    />
                  </div>
                  <div className="form-group">
                    <label>Auto Maximum Characters</label>
                    <input
                      type="number"
                      value={autoLongWriteMaxChars}
                      onChange={(e) =>
                        updateProjectWritingSettings({
                          autoMaxChars: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() => void saveProjectWritingSettings()}
                    />
                  </div>
                  <div className="form-group">
                    <label>Auto Max Rounds</label>
                    <input
                      type="number"
                      value={autoLongWriteMaxRounds}
                      onChange={(e) =>
                        updateProjectWritingSettings({
                          autoMaxRounds: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() => void saveProjectWritingSettings()}
                    />
                  </div>
                  <div className="form-group">
                    <label>Auto Max Chapter Advances</label>
                    <input
                      type="number"
                      value={autoLongWriteMaxChapterAdvances}
                      onChange={(e) =>
                        updateProjectWritingSettings({
                          autoMaxChapterAdvances: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={() => void saveProjectWritingSettings()}
                    />
                  </div>
                  <div className="form-group">
                    <label>{t('common.theme')}</label>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
                      
                    >
                      <option value="dark">{t('common.dark')}</option>
                      <option value="light">{t('common.light')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('common.language')}</label>
                    <select
                      value={locale}
                      onChange={(e) => setLocale(e.target.value as AppLocale)}
                    >
                      {APP_LOCALES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.uiDensity')}</label>
                    <select
                      value={uiDensity}
                      onChange={(e) => setUiDensity(e.target.value as 'compact' | 'comfortable')}
                      
                    >
                      <option value="comfortable">{t('app.settings.densityComfortable')}</option>
                      <option value="compact">{t('app.settings.densityCompact')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{t('app.settings.motion')}</label>
                    <select
                      value={uiMotion}
                      onChange={(e) => setUiMotion(e.target.value as 'full' | 'reduced')}
                      
                    >
                      <option value="full">{t('app.settings.motionFull')}</option>
                      <option value="reduced">{t('app.settings.motionReduced')}</option>
                    </select>
                  </div>
                  <div className="settings-action-row">
                    <button
                      className="btn btn-secondary settings-small-btn"
                      onClick={() => {
                        uiSettingsManager.resetSettings()
                        const defaults = uiSettingsManager.getSettings() as UISettingsState
                        setTheme(defaults.theme)
                        setUiDensity(defaults.density)
                        setUiMotion(defaults.motion)
                        setSidebarCollapsed(defaults.sidebarCollapsed)
                        setSidebarWidth(defaults.sidebarWidth)
                        setRightPanelWidth(defaults.rightPanelWidth)
                      }}
                    >
                      {t('app.settings.resetUILayout')}
                    </button>
                  </div>
	                </div>
	                ) : null}

	                {/* Editor Configuration Section */}
	                {settingsTab === 'editor' ? (
	                <div className="settings-section">
	                  <h3 className="settings-section-title">{t('app.settings.writingTitle')}</h3>

	                  {/* Font Family */}
	                  <div className="form-group">
	                    <label>{t('writing.fontFamily')}</label>
	                    <select
                      value={editorUserConfig.fontFamily}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ fontFamily: e.target.value })
                      }}
                      
                    >
                      <option value="system-ui, -apple-system, sans-serif">System UI</option>
                      <option value="'Songti SC', 'SimSun', serif">Songti</option>
                      <option value="'Heiti SC', 'SimHei', sans-serif">Heiti</option>
                      <option value="'Kaiti SC', 'KaiTi', serif">Kaiti</option>
                      <option value="'Microsoft YaHei', sans-serif">Microsoft YaHei</option>
                      <option value="'PingFang SC', sans-serif">PingFang SC</option>
                      <option value="monospace">Monospace</option>
                    </select>
                  </div>

	                  {/* Font Size */}
	                  <div className="form-group">
	                    <label>{t('writing.fontSize')} ({editorUserConfig.fontSize}px)</label>
                    <input
                      className="settings-range-input"
                      type="range"
                      min="10"
                      max="32"
                      step="1"
                      value={editorUserConfig.fontSize}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ fontSize: Number(e.target.value) })
                      }}
                    />
                  </div>

	                  {/* Line Height */}
	                  <div className="form-group">
	                    <label>{t('writing.lineHeight')} ({editorUserConfig.lineHeight})</label>
                    <input
                      className="settings-range-input"
                      type="range"
                      min="1.0"
                      max="3.0"
                      step="0.1"
                      value={editorUserConfig.lineHeight}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ lineHeight: Number(e.target.value) })
                      }}
                    />
                  </div>

	                  {/* Theme */}
	                  <div className="form-group">
	                    <label>{t('writing.theme')}</label>
                    <select
                      value={editorUserConfig.theme}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ theme: e.target.value as 'light' | 'dark' })
                      }}
                      
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </div>

	                  {/* Editor Width */}
	                  <div className="form-group">
	                    <label>{t('writing.editorWidth')}</label>
	                    <select
                      value={editorUserConfig.editorWidth}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ editorWidth: e.target.value as 'centered' | 'full' })
                      }}
                      
                    >
	                      <option value="centered">{t('writing.widthCentered')}</option>
	                      <option value="full">{t('writing.widthFull')}</option>
	                    </select>
	                  </div>

	                  {/* Auto-save Interval */}
	                  <div className="form-group">
	                    <label>{t('writing.autoSaveInterval')} ({editorUserConfig.autoSaveInterval === 0 ? t('writing.off') : `${editorUserConfig.autoSaveInterval}s`})</label>
	                    <input
                      className="settings-range-input"
                      type="range"
                      min="0"
                      max="300"
                      step="10"
                      value={editorUserConfig.autoSaveInterval}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ autoSaveInterval: Number(e.target.value) })
                      }}
	                    />
	                    <div className="settings-hint">
	                      {editorUserConfig.autoSaveInterval === 0
	                        ? t('writing.autoSaveDisabled')
	                        : t('writing.autoSaveEnabled', { seconds: editorUserConfig.autoSaveInterval })}
	                    </div>
	                  </div>

                  {/* Reset Button */}
                  <div className="settings-action-row">
                    <button
                      className="btn btn-secondary settings-small-btn"
	                      onClick={() => {
	                        void (async () => {
	                          const ok = await showConfirm(t('writing.resetConfirm'))
	                          if (ok) {
	                            editorConfigManager.resetConfig()
	                          }
	                        })()
	                      }}
	                    >
	                      {t('writing.reset')}
	                    </button>
                  </div>
	                </div>
	                ) : null}
	                {settingsTab === 'models' ? (
	                <div className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title settings-section-title-inline">{t('app.settings.modelTitle')}</h3>
                    <button
                      className="primary-button settings-tiny-btn"
                      onClick={openCreateProviderModal}
                    >
                      + {t('app.settings.newProvider')}
                    </button>
                  </div>

                  <div className="settings-provider-list">
                    {appSettings.providers.map((p) => (
                      <div
                        key={p.id}
                        className={`provider-item settings-provider-item${appSettings.active_provider_id === p.id ? ' active' : ''}`}
                        onClick={() => {
                          if (appSettings.active_provider_id !== p.id) {
                            const prev = appSettings
                            const next = { ...appSettings, active_provider_id: p.id }
                            setAppSettingsState(next)
                            void persistAppSettings(next, prev)
                          }
                        }}
                      >
                        <div className="settings-provider-meta">
                          <div className="settings-provider-name">{p.name}</div>
                          <div className="settings-provider-detail">
                            {providerKindLabel(p.kind)} - {p.model_name}
                          </div>
                          <div className={`settings-provider-key${apiKeyStatus[p.id] ? ' is-set' : ''}`}>
                            {t('app.model.apiKey')}: {apiKeyStatus[p.id] ? t('app.settings.keySet') : t('app.settings.keyNotSet')}
                          </div>
                        </div>
                        <div className="settings-provider-actions">
                          {appSettings.active_provider_id !== p.id && (
                            <button
                              className="icon-button"
                              title={t('app.settings.setActive')}
                              onClick={(e) => {
                                e.stopPropagation()
                                const prev = appSettings
                                const next = { ...appSettings, active_provider_id: p.id }
                                setAppSettingsState(next)
                                void persistAppSettings(next, prev)
                              }}
                            >
                              {t('app.settings.setActive')}
                            </button>
                          )}
                          <button
                            className="icon-button"
                            title={t('app.settings.edit')}
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditProviderModal(p)
                            }}
                          >
                            {t('app.settings.edit')}
                          </button>
                          <button
                            className="icon-button"
                            title={t('app.settings.delete')}
                            disabled={appSettings.providers.length <= 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              void (async () => {
                                const ok = await showConfirm(t('app.settings.confirmDeleteProvider'))
                                if (!ok) return
                                const prev = appSettings
                                const nextProviders = appSettings.providers.filter((x) => x.id !== p.id)
                                let nextActive = appSettings.active_provider_id
                                if (p.id === nextActive) {
                                  nextActive = nextProviders[0]?.id ?? ''
                                }
                                const next = { ...appSettings, providers: nextProviders, active_provider_id: nextActive }
                                setAppSettingsState(next)
                                await persistAppSettings(next, prev)
                              })()
                            }}
                          >
                            {t('app.settings.delete')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
	                </div>
	                ) : null}
	                {false ? (
	                <div className="settings-section">
                  <h3 className="settings-section-title">{t('app.settings.agentTitle')}</h3>

                  {/* Built-in Agents */}
                  <div className="settings-subsection settings-subsection-lg">
                    <div className="settings-subtitle">{t('app.settings.builtInAgents')}</div>
                    <div className="settings-grid-two">
                      {writingAssistantsState
                        .filter((a) => a.category !== 'custom')
                        .map((a) => (
                          <div
                            key={a.id}
                            className={`agent-card settings-agent-card${assistantEditorId === a.id ? ' active' : ''}`}
                            onClick={() => setAssistantEditorId(a.id)}
                          >
                            <div className="settings-agent-name">{a.name}</div>
                            <div className="settings-agent-category">{a.category}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Custom Agents */}
                  <div className="settings-subsection">
                    <div className="settings-subsection-head">
                      <div className="settings-subtitle settings-subtitle-inline">{t('app.settings.customAgents')}</div>
                      <button
                        className="icon-button settings-create-btn"
                        onClick={() => {
                          const id = newId()
                          const next: WritingAssistant = {
                            id,
                            name: t('app.settings.newAgentName'),
                            category: 'custom',
                            system_prompt: '',
                            temperature: 0.7,
                            max_tokens: 32000,
                          }
                          setWritingAssistantsState((prev) => [...prev, next])
                          setAssistantEditorId(id)
                        }}
                      >
                        + {t('app.settings.newAgent')}
                      </button>
                    </div>
                    {writingAssistantsState.filter((a) => a.category === 'custom').length === 0 ? (
                      <div className="settings-empty-note settings-empty-box">
                        {t('app.settings.noCustomAgents')}
                      </div>
                    ) : (
                      <div className="settings-grid-two">
                        {writingAssistantsState
                          .filter((a) => a.category === 'custom')
                          .map((a) => (
                            <div
                              key={a.id}
                              className={`agent-card settings-agent-card settings-agent-card-custom${assistantEditorId === a.id ? ' active' : ''}`}
                              onClick={() => setAssistantEditorId(a.id)}
                            >
                              <div className="settings-agent-name">{a.name}</div>
                              <div className="settings-agent-category">{t('app.settings.customCategory')}</div>
                              {assistantEditorId === a.id && (
                                <button
                                  className="icon-button settings-agent-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void (async () => {
                                      const ok = await showConfirm(t('app.settings.confirmDeleteCustomAgent'))
                                      if (!ok) return
                                      setWritingAssistantsState((prev) => prev.filter((x) => x.id !== a.id))
                                      setAssistantEditorId('')
                                    })()
                                  }}
                                >
                                  {t('app.settings.delete')}
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {assistantEditorId && writingAssistantsState.find((a) => a.id === assistantEditorId) && (
                    <div className="settings-editor-panel">
                      <div className="settings-editor-title">
                        {t('app.settings.editAgent')}: {writingAssistantsState.find((a) => a.id === assistantEditorId)?.name}
                      </div>
                      <div className="settings-editor-fields">
                        <div className="form-group">
                          <label>{t('app.settings.name')}</label>
                          <input
                            className="ai-select"
                            value={writingAssistantsState.find((a) => a.id === assistantEditorId)?.name ?? ''}
                            onChange={(e) =>
                              setWritingAssistantsState((prev) => prev.map((a) => (a.id === assistantEditorId ? { ...a, name: e.target.value } : a)))
                            }
                            disabled={writingAssistantsState.find((a) => a.id === assistantEditorId)?.category !== 'custom'}
                          />
                        </div>
                        <div className="form-group">
                          <label>{t('app.settings.systemPrompt')}</label>
                          <textarea
                            className="ai-textarea settings-agent-prompt"
                            placeholder={t('app.settings.systemPromptPlaceholder')}

                            value={writingAssistantsState.find((a) => a.id === assistantEditorId)?.system_prompt ?? ''}
                            onChange={(e) =>
                              setWritingAssistantsState((prev) => prev.map((a) => (a.id === assistantEditorId ? { ...a, system_prompt: e.target.value } : a)))
                            }
                            disabled={writingAssistantsState.find((a) => a.id === assistantEditorId)?.category !== 'custom'}
                          />
                        </div>
                        <div className="form-group">
                          <label>{t('app.settings.projectSpecific')}</label>
                          <div className="settings-spacer-text">{t('app.settings.projectSpecificHint')}</div>
	                        </div>
	                      </div>
	                    </div>
	                  )}
	                </div>
	                ) : null}
	              </div>
	            </div>
	          </div>
	        )}
	      </div>
            <div className="modal-footer">
              {appSettings ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    void saveAndCloseSettings()
                  }}
                >
                  {t('common.save')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Model Modal */}
      {showModelModal && (
        <div className="modal-overlay" onClick={() => setShowModelModal(false)}>
          <div className="modal-content modal-content-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{isNewProvider ? t('app.model.addProvider') : t('app.model.editProvider')}</h2>
              <button className="close-btn" onClick={() => setShowModelModal(false)}>
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-form">
                <div className="form-group">
                  <label>{t('app.model.displayName')}</label>
                  <input
                    value={editingProvider.name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, name: e.target.value }))}
                    placeholder={t('app.model.displayNamePlaceholder')}
                  />
                </div>
                <div className="form-group">
                  <label>{t('app.model.providerType')}</label>
                  <select
                    value={editingProviderPreset}
                    onChange={(e) => onSelectProviderPreset(e.target.value)}
                  >
                    {COMMON_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.name}
                      </option>
                    ))}
                    <option value={CUSTOM_PROVIDER_PRESET_KEY}>{t('app.model.providerTypeCustom')}</option>
                  </select>
                </div>
                {editingProviderPreset === CUSTOM_PROVIDER_PRESET_KEY ? (
                  <div className="form-group">
                    <label>{t('app.model.apiFormat')}</label>
                    <select
                      value={editingCustomProviderApiFormat}
                      onChange={(e) => onChangeCustomProviderApiFormat(e.target.value as CustomProviderApiFormat)}
                    >
                      <option value="openai">{t('app.model.apiFormatOpenAI')}</option>
                      <option value="claude">{t('app.model.apiFormatClaude')}</option>
                    </select>
                  </div>
                ) : null}
                <div className="form-group">
                  <label>{t('app.model.baseUrl')}</label>
                  <input
                    value={editingProvider.base_url ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, base_url: e.target.value }))}
                    placeholder={t('app.model.baseUrlPlaceholder')}
                  />
                </div>
                <div className="form-group">
                  <label>{t('app.model.modelId')}</label>
                  <input
                    value={editingProvider.model_name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, model_name: e.target.value }))}
                    placeholder={t('app.model.modelIdPlaceholder')}
                  />
                </div>
                <div className="form-group">
                  <label>{t('app.model.apiKey')}</label>
                  <input
                    type="password"
                    value={editingProvider.api_key ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder={
                      editingProvider.id && apiKeyStatus[editingProvider.id] ? t('app.model.apiKeyAlreadySetPlaceholder') : 'sk-...'
                    }
                  />
                </div>
	                {providerProbeResult ? (
	                  <div className={`settings-connectivity-result ${providerProbeResult.kind === 'ok' ? 'ok' : 'error'}`}>
	                    <div>{providerProbeResult.text}</div>
	                    {providerProbeResult.detail && providerProbeResult.detail !== providerProbeResult.text ? (
	                      <details className="settings-connectivity-detail">
                        <summary>{t('app.model.viewDetails')}</summary>
	                        <pre>{providerProbeResult.detail}</pre>
	                      </details>
	                    ) : null}
	                  </div>
	                ) : null}
	              </div>
	            </div>
	            <div className="modal-footer">
	              <button
	                className="btn btn-secondary"
	                disabled={providerProbeRunning || !editingProvider.base_url?.trim() || !editingProvider.model_name?.trim()}
	                onClick={() => {
	                  void onProbeProviderConnectivity()
	                }}
	              >
                {providerProbeRunning ? t('app.model.checking') : t('app.model.checkConnectivity')}
	              </button>
	              <button
	                className="primary-button"
	                disabled={providerProbeRunning || !editingProvider.name?.trim() || !editingProvider.base_url?.trim() || !editingProvider.model_name?.trim()}
	                onClick={() => {
                  if (!appSettings) return
                  void (async () => {
                    const prev = appSettings
                    const normalizedProvider: ModelProvider = {
                      id: editingProvider.id?.trim() || newId(),
                      name: editingProvider.name?.trim() ?? '',
                      kind: editingProvider.kind ?? 'OpenAICompatible',
                      api_key: '',
                      base_url: editingProvider.base_url?.trim() ?? '',
                      model_name: editingProvider.model_name?.trim() ?? '',
                    }
                    const rawKey = (editingProvider.api_key ?? '').trim()
                    const pid = normalizedProvider.id
                    if (isNewProvider && pid && !rawKey) {
                      const ok = await showConfirm(t('app.model.confirmNoApiKey'))
                      if (!ok) return
                    }
                    if (pid && rawKey) {
                      try {
                        await setApiKey(pid, rawKey)
                        setApiKeyStatus((m) => ({ ...m, [pid]: true }))
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e)
                        await showErrorDialog(t('app.model.errorSaveApiKey', { msg }))
                        return
                      }
                    }
                    let nextProviders = [...appSettings.providers]
                    if (isNewProvider) {
                      nextProviders.push(normalizedProvider)
                    } else {
                      nextProviders = nextProviders.map((p) =>
                        p.id === normalizedProvider.id ? normalizedProvider : p,
                      )
                    }
                    const next = { ...appSettings, providers: nextProviders }
                    setAppSettingsState(next)
                    try {
                      await setAppSettings(next)
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e)
                      await showErrorDialog(t('app.model.errorSaveSettings', { msg }))
                      setAppSettingsState(prev)
                      return
                    }
                    if (pid) {
                      try {
                        const ok = await getApiKeyStatus(pid)
                        setApiKeyStatus((m) => ({ ...m, [pid]: ok }))
                        if (rawKey && !ok) {
                          await showErrorDialog(t('app.model.errorApiKeyStatusUnset', { provider: pid }))
                          return
                        }
                      } catch {
                        setApiKeyStatus((m) => ({ ...m, [pid]: false }))
                        if (rawKey) {
                          await showErrorDialog(t('app.model.errorApiKeyStatusReadFailed', { provider: pid }))
                          return
                        }
                      }
                    }
                    await reloadAppSettings()
                    setShowModelModal(false)
                  })()
                }}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <StatusBar
        info={{
          charCount: activeCharCount,
          chapterTarget: chapterWordTarget,
          historyLabel: t('status.history'),
          historyStatus: openFiles.some((file) => file.dirty) ? 'recording' : 'idle',
          theme,
          language: locale,
        }}
        onThemeToggle={toggleTheme}
        onHistoryClick={() => {
          openSidebarTab('history')
        }}
      />

      {chatContextMenu ? (
        <div className="context-menu" style={{ left: chatContextMenu.x, top: chatContextMenu.y }}>
          <button
            className={chatContextMenu.selection ? 'context-menu-item' : 'context-menu-item disabled'}
            disabled={!chatContextMenu.selection}
            onClick={() => void copyText(chatContextMenu.selection).finally(() => setChatContextMenu(null))}
          >
            {t('app.chat.copySelection')}
          </button>
          <button
            className="context-menu-item"
            onClick={() => void copyText(chatContextMenu.message).finally(() => setChatContextMenu(null))}
          >
            {t('app.chat.copyMessage')}
          </button>
	          <button
	            className={
	              !isChatStreaming &&
	              chatContextMenu.role === 'assistant' &&
              chatContextMenu.messageId === latestCompletedAssistantId
                ? 'context-menu-item'
                : 'context-menu-item disabled'
            }
            disabled={
              isChatStreaming ||
              chatContextMenu.role !== 'assistant' ||
              chatContextMenu.messageId !== latestCompletedAssistantId
            }
            onClick={() =>
              void onRegenerateAssistant(chatContextMenu.messageId).finally(() => {
                setChatContextMenu(null)
              })
            }
	          >
	            {t('app.command.regenerateReply')}
	          </button>
	          <button
	            className={
	              !isChatStreaming &&
	              chatContextMenu.role === 'assistant' &&
	              chatContextMenu.messageId === latestCompletedAssistantId
	                ? 'context-menu-item'
	                : 'context-menu-item disabled'
	            }
	            disabled={
	              isChatStreaming ||
	              chatContextMenu.role !== 'assistant' ||
	              chatContextMenu.messageId !== latestCompletedAssistantId
	            }
	            onClick={() =>
	              void onGenerateAssistantCandidates(chatContextMenu.messageId, 2).finally(() => {
	                setChatContextMenu(null)
	              })
	            }
	          >
	            {t('app.command.generateCandidates')}
	          </button>
	        </div>
	      ) : null}

            {/* Editor Context Menu */}
      {editorContextMenu ? (
        <EditorContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          selectedText={editorContextMenu.selectedText}
          onPolish={handleAIPolish}
          onExpand={handleAIExpand}
          onCondense={handleAICondense}
          onClose={closeEditorContextMenu}
        />
      ) : null}

      {/* Recovery Dialog */}
      {showRecoveryDialog && (
        <RecoveryDialog
          onRecover={(filePath, content) => {
            // Open the recovered file
            void onOpenByPath(filePath)
            // Update the content
            setOpenFiles((prev) =>
              prev.map((f) =>
                f.path === filePath ? { ...f, content, dirty: true } : f
              )
            )
          }}
          onClose={() => setShowRecoveryDialog(false)}
        />
      )}

      <SearchPanel
        isOpen={showSearchPanel}
        onClose={() => setShowSearchPanel(false)}
        onSearch={onSearchInFiles}
        onResultClick={onSearchResultClick}
      />
    </div>
  )
}

export default App



