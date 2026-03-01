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
  getAgents,
  getApiKeyStatus,
  getAppSettings,
  forgetExternalProject,
  getProjectPickerState,
  gitCommit,
  gitDiff,
  gitInit,
  gitLog,
  gitStatus,
  initNovel,
  isTauriApp,
  listWorkspaceTree,
  openFolderDialog,
  readText,
  rememberExternalProject,
  renameEntry,
  setAgents,
  setApiKey,
  setAppSettings,
  setLaunchMode,
  saveChatSession,
  setWorkspace,
  writeText,
  type Agent,
  type AiEditApplyMode,
  type AppSettings,
  type FsEntry,
  type GitCommitInfo,
  type GitStatusItem,
  type LaunchMode,
  type ModelProvider,
  type ProjectItem,
  type ProjectSource,
} from './tauri'
import { useDiff } from './contexts/DiffContext'
import { modificationService, aiAssistanceService, editorManager, editorConfigManager, uiSettingsManager, novelPlannerService } from './services'
import type { AIAssistanceResponse, ChangeSet, EditorUserConfig, NovelTask, SessionPlannerState, WriterMode } from './services'
import { runAutoLongWriteWorkflow } from './services/autoLongWriteWorkflow'
import { runPlannerQueueWorkflow } from './services/plannerQueueWorkflow'
import { cleanupStreamRefs, type StreamMapRefs } from './services/streamRefs'
import { parseComposerInput } from './services/chatComposer'
import { appendStreamTextWithOverlap, formatElapsedLabel } from './services/chatStreamText'
import { resolveInlineReferencesInput } from './services/inlineReferences'
import DiffView from './components/DiffView'
import EditorContextMenu from './components/EditorContextMenu'
import { ChapterManager } from './components/ChapterManager'
import { CharacterManager } from './components/CharacterManager'
import { PlotLineManager } from './components/PlotLineManager'
import { WritingGoalPanel } from './components/WritingGoalPanel'
import { RiskPanel } from './components/RiskPanel'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { TabBar } from './components/TabBar'
import { handleFileSaveError, clearBackupContent } from './utils/fileSaveErrorHandler'
import { useAutoSave, clearAutoSavedContent, getAutoSavedContent } from './hooks/useAutoSave'
import { useProjectWritingSettings } from './hooks/useProjectWritingSettings'
import { useAutoStoryNavigation } from './hooks/useAutoStoryNavigation'
import { useTaskQualityValidator } from './hooks/useTaskQualityValidator'
import { logError } from './utils/errorLogger'
import { RecoveryDialog } from './components/RecoveryDialog'
import { ProjectPickerPage } from './components/ProjectPickerPage'
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

type ChatItem = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  cancelled?: boolean
  streamId?: string
  changeSet?: ChangeSet
  versionGroupId?: string
  versionIndex?: number
  versionCount?: number
  timestamp?: number
}

type AssistantVersion = {
  content: string
  changeSet?: ChangeSet
  cancelled?: boolean
  timestamp: number
}

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

type ExplorerContextMenuState = {
  x: number
  y: number
  entry: FsEntry
}

type ExplorerModalState =
  | { mode: 'newFile'; dirPath: string }
  | { mode: 'newFolder'; dirPath: string }
  | { mode: 'rename'; entry: FsEntry; parentDir: string }

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
}

type AssistantReplayContext = {
  replayHistory: ChatItem[]
  replayUser: ChatItem
  versionGroupId: string
}

type RollbackTurnState = {
  userId: string
  assistantId: string
  streamId: string
  userContent: string
  changeSetIds: string[]
}

const MASTER_PLAN_RELATIVE_PATH = '.novel/plans/master-plan.md'
const FIRST_TOKEN_RETRY_TIMEOUT_MS = 35_000
const AUTO_RETRY_MAX_PER_GROUP = 1

function App() {
  // Diff Context
  const diffContext = useDiff()

  // DiffView State
  const [showDiffPanel, setShowDiffPanel] = useState(false)
  const [activeDiffTab, setActiveDiffTab] = useState<string | null>(null)

  // Modern UI State
  const initialUISettings = uiSettingsManager.getSettings() as UISettingsState
  const [showCommandPalette, setShowCommandPalette] = useState(false)
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
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'git' | 'chapters' | 'characters' | 'plotlines' | 'risk'>('files')
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'graph' | 'writing-goal' | null>('chat')

  // Workspace & Files
  const [appView, setAppView] = useState<'project-picker' | 'workspace'>('project-picker')
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [defaultProjectsRoot, setDefaultProjectsRoot] = useState<string>('')
  const [defaultProjects, setDefaultProjects] = useState<ProjectItem[]>([])
  const [externalProjects, setExternalProjects] = useState<ProjectItem[]>([])
  const [launchMode, setLaunchModeState] = useState<LaunchMode>('picker')
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null)
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

  // ... (rest of App component)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [explorerModal, setExplorerModal] = useState<ExplorerModalState | null>(null)
  const [explorerModalValue, setExplorerModalValue] = useState<string>('')
  const [explorerQuery, setExplorerQuery] = useState<string>('')

  // Editors & Refs
  const editorRef = useRef<LexicalEditorType | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const aiMessagesRef = useRef<HTMLDivElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const gitCommitInputRef = useRef<HTMLInputElement | null>(null)
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
  // Chat session management (future feature)
  // const [chatSessions, setChatSessions] = useState<Array<{ id: string; name: string; updatedAt: number }>>([])
  // const [showSessionManager, setShowSessionManager] = useState(false)

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
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [agentsList, setAgentsList] = useState<Agent[]>([])
  const [agentEditorId, setAgentEditorId] = useState<string>('')
  const [settingsSnapshot, setSettingsSnapshot] = useState<AppSettings | null>(null)
  const [agentsSnapshot, setAgentsSnapshot] = useState<Agent[] | null>(null)
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})

  // Recovery State
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false)

  // Git State
  const [gitItems, setGitItems] = useState<GitStatusItem[]>([])
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([])
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitSelectedPath, setGitSelectedPath] = useState<string | null>(null)
  const [gitDiffText, setGitDiffText] = useState('')

  // Editor Configuration State
  const [editorUserConfig, setEditorUserConfig] = useState<EditorUserConfig>(editorConfigManager.getConfig())
  const [gitError, setGitError] = useState<string | null>(null)

  // Stats & Visuals
  const {
    settings: projectWritingSettings,
    updateSettings: updateProjectWritingSettings,
    loadSettings: loadProjectWritingSettings,
    saveSettings: saveProjectWritingSettings,
  } = useProjectWritingSettings(workspaceRoot)
  const chapterWordTarget = projectWritingSettings.chapterWordTarget
  const autoLongWriteMaxRounds = projectWritingSettings.autoMaxRounds
  const autoLongWriteMinChars = projectWritingSettings.autoMinChars
  const autoLongWriteMaxChars = projectWritingSettings.autoMaxChars
  const autoLongWriteMaxChapterAdvances = projectWritingSettings.autoMaxChapterAdvances
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])
  const { validateTaskQuality } = useTaskQualityValidator()

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
  const isMarkdownFile = useMemo(() => !!activeFile && activeFile.path.toLowerCase().endsWith('.md'), [activeFile])
  const activeCharCount = useMemo(() => {
    if (!activeFile) return 0
    return activeFile.content.replace(/\s/g, '').length
  }, [activeFile])
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
  const chatAgentOptions = useMemo(() => agentsList.map((agent) => ({ id: agent.id, name: agent.name })), [agentsList])
  const chatProviderOptions = useMemo(
    () => (appSettings?.providers ?? []).map((provider) => ({ id: provider.id, name: provider.name })),
    [appSettings],
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
      if (!streamId) return 'AI processing...'
      const phase = streamPhaseById[streamId]
      const now = Date.now()
      const startedAt = streamStartedAtRef.current.get(streamId) ?? now
      const lastTokenAt = streamLastTokenAtRef.current.get(streamId) ?? startedAt
      const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000))
      const idleSec = Math.max(0, Math.floor((now - lastTokenAt) / 1000))
      let base = 'AI processing...'
      switch (phase) {
        case 'initializing':
          base = 'AI initializing...'
          break
        case 'thinking':
          base = 'AI thinking...'
          break
        case 'responding':
          base = idleSec >= 15 ? 'AI waiting for next chunk...' : 'AI streaming...'
          break
        case 'retrying':
          base = 'AI auto retrying...'
          break
        default:
          base = 'AI processing...'
          break
      }
      return elapsedSec > 0 ? `${base} (${formatElapsedLabel(elapsedSec)})` : base
    },
    [streamPhaseById, streamUiTick],
  )

  const effectiveProviderId = useMemo(() => {
    if (!appSettings) return ''
    const active = appSettings.active_provider_id
    if (active && appSettings.providers.some((p) => p.id === active)) return active
    return appSettings.providers[0]?.id ?? ''
  }, [appSettings])

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

  const toggleDensity = useCallback(() => {
    setUiDensity((prev) => (prev === 'comfortable' ? 'compact' : 'comfortable'))
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
    if (!workspaceRoot) return
    const t = await listWorkspaceTree(6)
    setTree(t)
  }, [workspaceRoot])

  const refreshGit = useCallback(async () => {
    if (!isTauriApp()) return
    try {
      const [items, commits] = await Promise.all([gitStatus(), gitLog(20)])
      setGitItems(items)
      setGitCommits(commits)
      setGitError(null)
    } catch (e) {
      setGitItems([])
      setGitCommits([])
      setGitError(e instanceof Error ? e.message : String(e))
    }
  }, [])

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

  const openWorkspacePath = useCallback(
    async (path: string) => {
      const p = path.trim()
      if (!p) return false
      setError(null)
      setBusy(true)
      try {
        const info = await setWorkspace(p)
        setWorkspaceRoot(info.root)
        setLastWorkspace(info.root)
        return true
      } catch (e) {
        setWorkspaceRoot(null)
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
    if (!workspaceRoot || !isTauriApp()) return
    await novelPlannerService.ensurePlannerWorkspace()
    const queue = await novelPlannerService.loadRunQueue()
    setPlannerTasks(queue)
  }, [workspaceRoot])

  const loadPlannerSession = useCallback(async () => {
    if (!workspaceRoot || !isTauriApp()) return
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
  }, [chapterWordTarget, workspaceRoot])

  const onNewChatSession = useCallback(() => {
    const nextSessionId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    chatSessionIdRef.current = nextSessionId
    setChatMessages([])
    rollbackTurnStackRef.current = []
    setChatAutoScroll(true)
    void loadPlannerSession().catch((e) => {
      setPlannerLastRunError(e instanceof Error ? e.message : String(e))
    })
  }, [loadPlannerSession])

  const ensurePlanningArtifacts = useCallback(
    async (mode: WriterMode, instruction?: string) => {
      if (!workspaceRoot || !isTauriApp()) return
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
    [chapterWordTarget, workspaceRoot],
  )

  const buildPromptByMode = useCallback(
    async (userInput: string, mode: WriterMode): Promise<string> => {
      if (!workspaceRoot || !isTauriApp()) return userInput
      await novelPlannerService.ensurePlannerWorkspace()
      if (mode !== 'normal') {
        await ensurePlanningArtifacts(mode, userInput)
      }
      const context = await novelPlannerService.buildModeContext(mode, tree, activePath)
      return novelPlannerService.buildModePrompt(mode, userInput, context, activePath)
    },
    [activePath, ensurePlanningArtifacts, tree, workspaceRoot],
  )

  const waitForStreamCompletion = useCallback((streamId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      streamWaitersRef.current.set(streamId, { resolve, reject })
      window.setTimeout(() => {
        const waiter = streamWaitersRef.current.get(streamId)
        if (!waiter) return
        streamWaitersRef.current.delete(streamId)
        streamFailuresRef.current.delete(streamId)
        reject(new Error('等待 AI 响应超时'))
      }, 8 * 60 * 1000)
    })
  }, [])

  const loadGraph = useCallback(async () => {
    if (!workspaceRoot) return
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
  }, [workspaceRoot])

  const openSidebarTab = useCallback(
    (tab: 'files' | 'git' | 'chapters' | 'characters' | 'plotlines' | 'risk') => {
      if (activeSidebarTab === tab) {
        setSidebarCollapsed((prev) => !prev)
      } else {
        setActiveSidebarTab(tab)
        setSidebarCollapsed(false)
      }
      if (isMobileLayout) {
        setActiveRightTab(null)
      }
    },
    [activeSidebarTab, isMobileLayout],
  )

  const openRightTab = useCallback(
    (tab: 'chat' | 'graph' | 'writing-goal') => {
      setActiveRightTab(tab)
      if (tab === 'graph') {
        void loadGraph()
      }
      if (isMobileLayout) {
        setSidebarCollapsed(true)
      }
    },
    [isMobileLayout, loadGraph],
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

  const refreshProjectPickerState = useCallback(async () => {
    if (!isTauriApp()) return
    try {
      const state = await getProjectPickerState()
      setDefaultProjectsRoot(state.default_root)
      setDefaultProjects(state.default_projects)
      setExternalProjects(state.external_projects)
      setLastWorkspace(state.last_workspace)
      setLaunchModeState(state.launch_mode)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const onOpenProjectFromPicker = useCallback(
    async (path: string, source: ProjectSource) => {
      const ok = await openWorkspacePath(path)
      if (!ok) return
      if (isTauriApp() && source === 'external') {
        try {
          await rememberExternalProject(path)
        } catch {
          // Ignore memory persistence errors, project is still opened.
        }
      }
      setAppView('workspace')
      if (isMobileLayout) {
        setSidebarCollapsed(true)
        setActiveRightTab(null)
      }
      if (isTauriApp()) {
        void refreshProjectPickerState()
      }
    },
    [isMobileLayout, openWorkspacePath, refreshProjectPickerState],
  )

  const onLoadExternalProject = useCallback(async () => {
    try {
      if (!isTauriApp()) {
        const ok = await openWorkspacePath(workspaceInput)
        if (ok) setAppView('workspace')
        return
      }
      const selected = await openFolderDialog()
      if (!selected) return
      const ok = await openWorkspacePath(selected)
      if (!ok) return
      try {
        await rememberExternalProject(selected)
      } catch {
        // Keep opened state even if remembering fails.
      }
      setAppView('workspace')
      void refreshProjectPickerState()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [openWorkspacePath, refreshProjectPickerState, workspaceInput])

  const onForgetExternalProject = useCallback(
    async (path: string) => {
      if (!isTauriApp()) return
      try {
        await forgetExternalProject(path)
        await refreshProjectPickerState()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshProjectPickerState],
  )

  const onLaunchModeChange = useCallback(
    async (mode: LaunchMode) => {
      setLaunchModeState(mode)
      if (!isTauriApp()) return
      try {
        await setLaunchMode(mode)
        await refreshProjectPickerState()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshProjectPickerState],
  )

  const onOpenFile = useCallback(
    async (entry: FsEntry) => {
      if (entry.kind !== 'file') return
      setError(null)
      setBusy(true)
      try {
        const existing = openFiles.find((f) => f.path === entry.path)
        if (existing) {
          setActivePath(existing.path)
          return
        }

        // Check for auto-saved content
        const autoSaved = getAutoSavedContent(entry.path)
        let content = await readText(entry.path)

        // If auto-saved content exists and is different, use it
        if (autoSaved && autoSaved.content !== content) {
          content = autoSaved.content
          // Mark as dirty since it has unsaved changes
          const next: OpenFile = { path: entry.path, name: entry.name, content, dirty: true }
          setOpenFiles((prev) => [...prev, next])
          setActivePath(entry.path)
        } else {
          const next: OpenFile = { path: entry.path, name: entry.name, content, dirty: false }
          setOpenFiles((prev) => [...prev, next])
          setActivePath(entry.path)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [openFiles],
  )

  const onOpenByPath = useCallback(
    async (relPath: string) => {
      if (!relPath) return
      setError(null)
      setBusy(true)
      try {
        const existing = openFiles.find((f) => f.path === relPath)
        if (existing) {
          setActivePath(existing.path)
          return
        }
        const parts = relPath.replaceAll('\\', '/').split('/')
        const name = parts[parts.length - 1] || relPath
        const content = await readText(relPath)
        const next: OpenFile = { path: relPath, name, content, dirty: false }
        setOpenFiles((prev) => [...prev, next])
        setActivePath(relPath)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [openFiles],
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
    return confirm(text, { title: '确认', kind: 'warning' })
  }, [])

  const onNewChapter = useCallback(async () => {
    if (!workspaceRoot) return
    setError(null)
    setBusy(true)
    try {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fileName = `stories/chapter-${yyyy}${mm}${dd}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.txt`
      try {
        await createFile(fileName)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("parent directory does not exist")) {
          const ok = await showConfirm('stories/ 目录不存在，是否创建？')
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
  }, [workspaceRoot, refreshTree, showConfirm])

  const onGitInit = useCallback(async () => {
    if (!workspaceRoot) return
    setBusy(true)
    try {
      await gitInit()
      await refreshGit()
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, refreshGit])

  const onGitSelect = useCallback(
    async (path: string) => {
      if (!workspaceRoot) return
      setBusy(true)
      setGitSelectedPath(path)
      try {
        const text = await gitDiff(path)
        setGitDiffText(text)
      } catch (e) {
        setGitDiffText(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [workspaceRoot],
  )

  const onGitCommit = useCallback(async () => {
    if (!workspaceRoot) return
    const msg = gitCommitMsg.trim()
    if (!msg) return
    setBusy(true)
    try {
      await gitCommit(msg)
      setGitCommitMsg('')
      await refreshGit()
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, gitCommitMsg, refreshGit])

  const nameCollator = useMemo(() => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }), [])

  const visibleTree = useMemo(() => {
    if (!tree) return null
    const q = explorerQuery.trim().toLowerCase()
    if (!q) return tree

    const walk = (e: FsEntry): FsEntry | null => {
      const name = e.name.toLowerCase()
      if (e.kind === 'file') return name.includes(q) ? e : null
      const children = e.children.map(walk).filter(Boolean) as FsEntry[]
      if (name.includes(q) || children.length > 0) return { ...e, children }
      return null
    }

    return walk(tree)
  }, [tree, explorerQuery])

  const openExplorerContextMenu = useCallback((e: MouseEvent, entry: FsEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setExplorerContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const TreeNode = useCallback(
    function TreeNodeInner({ entry, depth }: { entry: FsEntry; depth: number }) {
      const [open, setOpen] = useState(depth < 1)
      const pad = { paddingLeft: `${depth * 12}px` }
      if (entry.kind === 'file') {
        return (
          <div
            className="file-tree-item"
            style={pad}
            onClick={() => void onOpenFile(entry)}
            onContextMenu={(e) => openExplorerContextMenu(e, entry)}
          >
            <span className="file-icon file"><AppIcon name="file" size={14} /></span>
            {entry.name}
          </div>
        )
      }
      return (
        <div>
          <div
            className="file-tree-item"
            style={pad}
            onClick={() => setOpen((v) => !v)}
            onContextMenu={(e) => openExplorerContextMenu(e, entry)}
          >
            <span className="file-icon"><AppIcon name={open ? 'folderOpen' : 'folder'} size={14} /></span>
            {entry.name}
          </div>
          {open &&
            [...entry.children]
              .sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
                return nameCollator.compare(a.name, b.name)
              })
              .map((c) => <TreeNodeInner key={c.path} entry={c} depth={depth + 1} />)}
        </div>
      )
    },
    [onOpenFile, openExplorerContextMenu, nameCollator],
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
        name: '自定义提供商',
        kind: 'OpenAICompatible',
        base_url: 'https://api.openai.com/v1',
        model_name: '',
      })
      setEditingProviderPreset(CUSTOM_PROVIDER_PRESET_KEY)
      setEditingCustomProviderApiFormat('openai')
    }
    setIsNewProvider(true)
    setShowModelModal(true)
  }, [newId])

  const openEditProviderModal = useCallback((provider: ModelProvider) => {
    const presetKey = inferProviderPresetKey(provider)
    setEditingProvider({ ...provider })
    setEditingProviderPreset(presetKey)
    setEditingCustomProviderApiFormat(provider.kind === 'Anthropic' ? 'claude' : 'openai')
    setIsNewProvider(false)
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
          name: prev.name?.trim() ? prev.name : '自定义提供商',
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
    [editingCustomProviderApiFormat],
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

  const getSelectionText = useCallback((): string => {
    const editor = editorRef.current
    if (!editor) return ''

    // Use Lexical's getSelectedText method from AIAssistPlugin
    const extendedEditor = editor as any
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
        await showErrorDialog(`保存设置失败：${msg}`)
        if (prev) {
          setAppSettingsState(prev)
        } else {
          await reloadAppSettings()
        }
      }
    },
    [reloadAppSettings, showErrorDialog],
  )
  const onChatAgentChange = useCallback(
    (id: string) => {
      if (!appSettings) return
      const prev = appSettings
      const next = { ...appSettings, active_agent_id: id }
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

  const settingsDirty = useMemo(() => {
    if (!showSettings) return false
    if (!appSettings) return false
    if (!settingsSnapshot) return false
    const a = JSON.stringify(appSettings)
    const b = JSON.stringify(settingsSnapshot)
    if (a !== b) return true
    if (!agentsSnapshot) return false
    return JSON.stringify(agentsList) !== JSON.stringify(agentsSnapshot)
  }, [agentsList, agentsSnapshot, appSettings, settingsSnapshot, showSettings])

  useEffect(() => {
    if (!showSettings) {
      setSettingsSnapshot(null)
      setAgentsSnapshot(null)
      return
    }
    if (appSettings && !settingsSnapshot) {
      setSettingsSnapshot(appSettings)
    }
    if (!agentsSnapshot) {
      setAgentsSnapshot(agentsList)
    }
  }, [agentsList, agentsSnapshot, appSettings, settingsSnapshot, showSettings])

  const saveAndCloseSettings = useCallback(async () => {
    if (!appSettings) return
    try {
      await setAppSettings(appSettings)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(`保存设置失败：${msg}`)
      return
    }
    try {
      await setAgents(agentsList.filter((agent) => agent.category === '自定义'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(`保存智能体失败：${msg}`)
      return
    }
    await reloadAppSettings()
    setShowSettings(false)
  }, [agentsList, appSettings, reloadAppSettings, showErrorDialog])

  const requestCloseSettings = useCallback(() => {
    void (async () => {
      if (!settingsDirty) {
        setShowSettings(false)
        return
      }
      const shouldSave = await showConfirm('检测到未保存的设置更改，是否保存？')
      if (shouldSave) {
        await saveAndCloseSettings()
        return
      }
      const discard = await showConfirm('确认放弃未保存的更改？')
      if (!discard) return
      if (settingsSnapshot) setAppSettingsState(settingsSnapshot)
      if (agentsSnapshot) setAgentsList(agentsSnapshot)
      setShowSettings(false)
    })()
  }, [agentsSnapshot, saveAndCloseSettings, settingsDirty, settingsSnapshot, showConfirm])

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
    if (!explorerContextMenu) return
    const onClick = () => setExplorerContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExplorerContextMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [explorerContextMenu])

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
    setChatInput((prev) => {
      const next = prev.trim()
      return next ? `${next} #选区` : '#选区 '
    })
    chatInputRef.current?.focus()
  }, [])

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
        if (!workspaceRoot || !isTauriApp()) {
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
          workspaceRoot,
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
          prev.map((m) => (m.id === assistantId ? { ...m, content: '当前未运行在 Tauri 环境，无法调用 AI。', streaming: false } : m)),
        )
        return null
      }

      if (!workspaceRoot) {
        cleanupStreamRefs(streamRefs, streamId)
        setChatMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: '请先打开一个工作区（Workspace）。', streaming: false } : m)),
        )
        return null
      }

      try {
        await initNovel()
      } catch (e) {
        cleanupStreamRefs(streamRefs, streamId)
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
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
          agentId: appSettings?.active_agent_id ?? null,
        })
        return streamId
      } catch (e) {
        cleanupStreamRefs(streamRefs, streamId)
        setStreamPhaseById((prev) => {
          const next = { ...prev }
          delete next[streamId]
          return next
        })
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
          ),
        )
        return null
      }
    },
    [
      activeFile,
      activeStreamId,
      autoLongWriteEnabled,
      appSettings,
      buildPromptByMode,
      chatInput,
      ensurePlanningArtifacts,
      getSelectionText,
      newId,
      refreshPlannerQueue,
      workspaceRoot,
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
      } catch {}
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
      } catch {}

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
      setError('AI 首次输出超时，已自动重试一次。')
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
    [onSendChat, upsertAssistantVersion],
  )
  useEffect(() => {
    if (!activeStreamId) return
    const timer = window.setTimeout(() => {
      void maybeAutoRetryNoTokenStream(activeStreamId)
    }, FIRST_TOKEN_RETRY_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [activeStreamId, maybeAutoRetryNoTokenStream])

  const resolveAssistantReplayContext = useCallback(
    (assistantMessageId?: string): AssistantReplayContext | null => {
      if (chatMessagesRef.current.some((m) => m.streaming)) return null
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
      if (targetAssistant.content.trim()) {
        upsertAssistantVersion(versionGroupId, {
          content: targetAssistant.content,
          changeSet: targetAssistant.changeSet,
          cancelled: targetAssistant.cancelled,
          timestamp: Date.now(),
        })
      }

      const replayHistory = history.slice(0, assistantIndex)
      const replayUser = replayHistory[replayHistory.length - 1]
      if (!replayUser || replayUser.role !== 'user') return null
      return { replayHistory, replayUser, versionGroupId }
    },
    [upsertAssistantVersion],
  )

  const onRegenerateAssistant = useCallback(
    async (assistantMessageId?: string) => {
      const replay = resolveAssistantReplayContext(assistantMessageId)
      if (!replay) return
      await onSendChat(replay.replayUser.content, {
        sourceMessages: replay.replayHistory,
        useExistingLastUser: true,
        hideUserEcho: true,
        versionGroupId: replay.versionGroupId,
      })
    },
    [onSendChat, resolveAssistantReplayContext],
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
    const extendedEditor = editor as any
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
      `续写补全：本章目标字数 ${chapterWordTarget}，当前 ${activeCharCount}。\n` +
      (nearing ? '请开始考虑本章收尾，并给出下一章开头建议。\n' : '请续写下一段（150-300 字）。\n') +
      `上下文：\n${snippet}`
    void onSendChat(prompt)
  }, [activeFile, chapterWordTarget, activeCharCount, onSendChat])

  const getLatestFileCharCount = useCallback(
    async (filePath: string, fallback = ''): Promise<number> => {
      if (!filePath) return 0
      if (workspaceRoot && isTauriApp()) {
        try {
          const latest = await readText(filePath)
          return latest.replace(/\s/g, '').length
        } catch {
          // Fall back to in-memory content when disk read fails.
        }
      }
      return fallback.replace(/\s/g, '').length
    },
    [workspaceRoot],
  )

  const runAutoLongWrite = useCallback(async () => {
    await runAutoLongWriteWorkflow({
      workspaceRoot,
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
    workspaceRoot,
    writerMode,
  ])


  useEffect(() => {
    if (!autoLongWriteEnabled) return
    if (!workspaceRoot || !isTauriApp()) return
    if (!activeFile) return
    if (autoLongWriteRunning) return
    if (chatMessages.some((m) => m.streaming)) return
    void runAutoLongWrite()
  }, [activeFile, autoLongWriteEnabled, autoLongWriteRunning, chatMessages, runAutoLongWrite, workspaceRoot])

  const onWriterModeChange = useCallback(
    async (mode: WriterMode) => {
      if (!workspaceRoot || !isTauriApp()) {
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
    [ensurePlanningArtifacts, refreshPlannerQueue, workspaceRoot],
  )

  const onGeneratePlanAndTasks = useCallback(async () => {
    if (!workspaceRoot || !isTauriApp()) return
    if (writerMode === 'normal') {
      await message('\u666e\u901a\u6a21\u5f0f\u4e0d\u751f\u6210\u5927\u7eb2\u4e0e\u7ec6\u7eb2\uff0c\u8bf7\u5207\u6362\u5230\u5927\u7eb2\u6a21\u5f0f\u6216\u7ec6\u7eb2\u6a21\u5f0f\u3002', { title: '\u63d0\u793a' })
      return
    }
    setPlannerBusy(true)
    setPlannerLastRunError(null)
    try {
      await novelPlannerService.generateMasterPlan(writerMode, {
        instruction: chatInput,
        targetWords: 1_200_000,
        chapterWordTarget,
      })
      const tasks = await novelPlannerService.generateTasksFromPlan({
        mode: writerMode,
        targetWords: 1_200_000,
        chapterWordTarget,
      })
      setPlannerTasks(tasks)
      if (activePath !== MASTER_PLAN_RELATIVE_PATH) {
        await onOpenByPath(MASTER_PLAN_RELATIVE_PATH)
      }
      if (tasks.length > 0) {
        void runPlannerQueue(chatInput)
      }
    } catch (e) {
      setPlannerLastRunError(e instanceof Error ? e.message : String(e))
    } finally {
      setPlannerBusy(false)
    }
  }, [activePath, chapterWordTarget, chatInput, onOpenByPath, workspaceRoot, writerMode])
  const runPlannerQueue = useCallback(
    async (userInstruction = '') => {
      await runPlannerQueueWorkflow({
        workspaceRoot,
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
      workspaceRoot,
      writerMode,
      tree,
    ],
  )

  // --- DiffView Handlers ---

  const onAcceptModification = useCallback(async (changeSetId: string, modificationId: string) => {
    try {
      await modificationService.acceptModification(changeSetId, modificationId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext, refreshTree])

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

      const extendedEditor = editor as (LexicalEditorType & { getSelectionOffsets?: () => SelectionOffsets | null }) | null | undefined
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
        const applyMode: AiEditApplyMode = appSettings?.ai_edit_apply_mode ?? 'auto_apply'
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
    void getAgents()
      .then((list) => {
        setAgentsList(list)
        setAgentEditorId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => setAgentsList([]))
  }, [reloadAppSettings])

  useEffect(() => {
    if (!appSettings) return
    if (agentsList.length === 0) return
    if (agentsList.some((agent) => agent.id === appSettings.active_agent_id)) return
    const fallback = agentsList[0]?.id ?? ''
    if (!fallback) return
    const prev = appSettings
    const next = { ...appSettings, active_agent_id: fallback }
    setAppSettingsState(next)
    void persistAppSettings(next, prev)
  }, [agentsList, appSettings, persistAppSettings])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!showSettings) return
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
  }, [appSettings, showSettings])

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
        setAppView('project-picker')
        return
      }
      try {
        const pickerState = await getProjectPickerState()
        setDefaultProjectsRoot(pickerState.default_root)
        setDefaultProjects(pickerState.default_projects)
        setExternalProjects(pickerState.external_projects)
        setLastWorkspace(pickerState.last_workspace)
        setLaunchModeState(pickerState.launch_mode)

        if (pickerState.launch_mode === 'auto_last' && pickerState.last_workspace) {
          const opened = await openWorkspacePath(pickerState.last_workspace)
          if (opened) {
            setAppView('workspace')
            return
          }
        }
        setAppView('project-picker')
      } catch {
        setAppView('project-picker')
        setLastWorkspace(null)
      }
    })()
  }, [openWorkspacePath])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
    void (async () => {
      try {
        const t = await listWorkspaceTree(6)
        setTree(t)
      } catch {
        setTree(null)
      }
    })()
    void refreshGit()
    void loadProjectWritingSettings()
    void refreshProjectPickerState()
    setAppView((prev) => (prev === 'workspace' ? prev : 'workspace'))
  }, [loadProjectWritingSettings, refreshGit, refreshProjectPickerState, workspaceRoot])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
    void loadPlannerSession().catch((e) => {
      setPlannerLastRunError(e instanceof Error ? e.message : String(e))
    })
  }, [loadPlannerSession, workspaceRoot])

  useEffect(() => {
    if (!workspaceRoot || !isTauriApp()) return
    if (writerMode === 'normal') return
    if (!(plannerState?.auto_run ?? false)) return
    if (plannerQueueRunning || plannerBusy) return
    const next = novelPlannerService.getNextExecutableTask(plannerTasks)
    if (!next) return
    void runPlannerQueue()
  }, [isTauriApp, plannerBusy, plannerQueueRunning, plannerState, plannerTasks, runPlannerQueue, workspaceRoot, writerMode])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
    const timer = window.setTimeout(() => {
      setShowRecoveryDialog(true)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [workspaceRoot])

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
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId ? { ...m, content: `${m.content}${merged.appended}` } : m,
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
      if (cancelled) {
        streamFailuresRef.current.add(streamId)
      }
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? (() => {
                const groupId = m.versionGroupId ?? streamVersionGroupId ?? m.id
                const mergedCancelled = cancelled || m.cancelled
                const registered = upsertAssistantVersion(groupId, {
                  content: m.content,
                  changeSet: m.changeSet,
                  cancelled: mergedCancelled,
                  timestamp: Date.now(),
                })
                return {
                  ...m,
                  streaming: false,
                  cancelled: mergedCancelled,
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
      const hasOutput = (streamOutputRef.current.get(streamId) ?? '').trim().length > 0
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

      const applyMode: AiEditApplyMode = appSettings?.ai_edit_apply_mode ?? 'auto_apply'
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
      const message = typeof p.message === 'string' ? p.message : 'AI call failed'
      const stage = typeof p.stage === 'string' ? p.stage : ''
      const provider = typeof p.provider === 'string' ? p.provider : ''
      const extra = [provider ? `provider=${provider}` : '', stage ? `stage=${stage}` : ''].filter(Boolean).join(' ')
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? { ...m, content: extra ? `${message}\n(${extra})` : message, streaming: false }
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
  }, [appSettings, diffContext, onOpenDiffView, refreshTree, upsertAssistantVersion])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
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
  }, [workspaceRoot, refreshTree])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
      // Command Palette: Ctrl+Shift+P
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSaveActive, toggleSidebar])

  useEffect(() => {
    if (!isTauriApp()) return
    const hasUnsaved = openFiles.some((f) => f.dirty) || settingsDirty
    if (!hasUnsaved) return
    let unlisten: null | (() => void) = null
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const ok = await showConfirm('存在未保存内容，确认要关闭吗？')
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
      workspace_root: workspaceRoot ?? '',
      created_at: 0,
      updated_at: 0,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    }).catch(() => {})
  }, [chatMessages, workspaceRoot])

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

  if (appView === 'project-picker') {
    return (
      <ProjectPickerPage
        busy={busy}
        error={error}
        defaultRoot={defaultProjectsRoot}
        defaultProjects={defaultProjects}
        externalProjects={externalProjects}
        lastWorkspace={lastWorkspace}
        launchMode={launchMode}
        onSelectProject={onOpenProjectFromPicker}
        onLoadExternalProject={() => void onLoadExternalProject()}
        onForgetExternalProject={(path) => void onForgetExternalProject(path)}
        onRefresh={() => void refreshProjectPickerState()}
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
            onClick={() => openSidebarTab('files')}
            title="资源管理器"
          >
            <span className="activity-bar-icon"><AppIcon name="files" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'chapters' ? 'active' : ''}`}
            onClick={() => openSidebarTab('chapters')}
            title="章节管理"
          >
            <span className="activity-bar-icon"><AppIcon name="chapters" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'characters' ? 'active' : ''}`}
            onClick={() => openSidebarTab('characters')}
            title="人物管理"
          >
            <span className="activity-bar-icon"><AppIcon name="characters" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'plotlines' ? 'active' : ''}`}
            onClick={() => openSidebarTab('plotlines')}
            title="情节线管理"
          >
            <span className="activity-bar-icon"><AppIcon name="plotlines" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'risk' ? 'active' : ''}`}
            onClick={() => openSidebarTab('risk')}
            title="风险检测"
          >
            <span className="activity-bar-icon"><AppIcon name="risk" /></span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'git' ? 'active' : ''}`}
            onClick={() => openSidebarTab('git')}
            title="源代码管理"
          >
            <span className="activity-bar-icon"><AppIcon name="git" /></span>
          </div>
          <div className="spacer" />
          <div
            className="activity-bar-item"
            onClick={() => {
              setAppView('project-picker')
              void refreshProjectPickerState()
            }}
            title="切换项目"
          >
            <span className="activity-bar-icon"><AppIcon name="projectSwitch" /></span>
          </div>
          <div
            className="activity-bar-item"
            onClick={() => {
              setShowSettings(true)
              if (!appSettings) void reloadAppSettings()
            }}
            title="设置"
          >
            <span className="activity-bar-icon"><AppIcon name="settings" /></span>
          </div>
        </div>

        {/* Sidebar Panel (Left) */}
        <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {activeSidebarTab === 'files' ? (
          <>
            <div className="sidebar-header">
              <span>{workspaceRoot ? workspaceRoot.split(/[/\\]/).pop() || '项目' : '资源管理器'}</span>
              <div className="spacer" />
              {workspaceRoot ? (
                <button className="icon-button" onClick={() => void refreshTree()} title="刷新">
                  <AppIcon name="refresh" size={14} />
                </button>
              ) : null}
            </div>
            <div className="sidebar-content flex-1" onContextMenu={(e) => {
              e.preventDefault()
              if (workspaceRoot) {
                setExplorerContextMenu({ x: e.clientX, y: e.clientY, entry: { kind: 'dir', path: workspaceRoot, name: workspaceRoot.split('/').pop() || '', children: [] } })
              }
            }}>
              {workspaceRoot ? (
                <>
                  {error ? <div className="error-text">{error}</div> : null}
                  <div className="sidebar-search-wrap">
                    <input
                      className="explorer-search"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      placeholder="搜索..."
                    />
                  </div>
                  {visibleTree ? <TreeNode entry={visibleTree} depth={0} /> : <div className="sidebar-loading">加载中...</div>}
                </>
              ) : (
                <div className="sidebar-empty">
                  <button
                    className="primary-button"
                    onClick={() => {
                      setAppView('project-picker')
                      void refreshProjectPickerState()
                    }}
                  >
                    项目选择页
                  </button>
                  {error ? <div className="error-text">{error}</div> : null}
                  {lastWorkspace ? (
                    <div className="welcome-recent" style={{ width: '100%' }}>
                      <h3>最近打开</h3>
                      <div className="recent-list">
                        <div className="recent-item" onClick={() => void openWorkspacePath(lastWorkspace)}>
                          {lastWorkspace}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {!isTauriApp() && (
                    <input
                      className="workspace-path-input"
                      value={workspaceInput}
                      onChange={(e) => setWorkspaceInput(e.target.value)}
                      placeholder="或输入路径"
                    />
	                  )}
	                  </div>
              )}
            </div>
            {workspaceRoot ? (
              <>
                <div className="sidebar-header">大纲</div>
                <div className="sidebar-content sidebar-outline">
                  <button
                    className="btn btn-secondary sidebar-outline-btn"
                    onClick={() => void onOpenByPath('outline/outline.md')}
                  >
                    打开 outline.md
                  </button>
                  <div className="sidebar-outline-hint">在 outline/ 目录维护章节大纲。</div>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {activeSidebarTab === 'git' ? (
          <>
            <div className="sidebar-header">源代码管理</div>
            <div className="sidebar-content">
              {gitError ? <div className="error-text">{gitError}</div> : null}
              <div className="git-toolbar">
                <button disabled={busy || !workspaceRoot} onClick={() => void onGitInit()}>
                  初始化
                </button>
                <button disabled={busy || !workspaceRoot} onClick={() => void refreshGit()}>
                  刷新
                </button>
              </div>
              <div className="git-status-list">
                {gitItems.length === 0 ? (
                  <div className="git-empty">无变更</div>
                ) : (
                  gitItems.map((it) => (
                    <div
                      key={it.path}
                      className={gitSelectedPath === it.path ? 'git-row active' : 'git-row'}
                      onClick={() => void onGitSelect(it.path)}
                    >
                      <span className={`git-status-icon ${it.status === 'M' ? 'modified' : 'new'}`}>{it.status}</span>
                      <span className="git-path">{it.path}</span>
                    </div>
                  ))
                )}
              </div>
              {gitSelectedPath ? <pre className="git-diff-view">{gitDiffText}</pre> : null}
              <div className="git-commit-section">
                <input
                  ref={gitCommitInputRef}
                  className="git-commit-input"
                  value={gitCommitMsg}
                  onChange={(e) => setGitCommitMsg(e.target.value)}
                  placeholder="提交信息 (Ctrl+Enter)"
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'Enter') void onGitCommit()
                  }}
                />
                <button className="git-commit-btn" disabled={busy || !gitCommitMsg.trim()} onClick={() => void onGitCommit()}>
                  提交
                </button>
              </div>
              {gitCommits.length > 0 ? (
                <div className="git-commits">
                  {gitCommits.slice(0, 5).map((c) => (
                    <div key={c.id} className="git-commit-item">
                      <span className="git-commit-hash">{c.id.slice(0, 7)}</span>
                      <span>{c.summary}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {activeSidebarTab === 'chapters' ? (
          <ChapterManager
            onChapterClick={(chapter) => {
              // Open the chapter file in the editor
              void onOpenByPath(chapter.filePath)
            }}
            onChapterUpdate={() => {
              // Optionally refresh the file tree or perform other updates
              if (workspaceRoot) {
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
              if (workspaceRoot) {
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
          title="拖动调整左侧栏宽度"
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
              const ok = await showConfirm(`文件"${file.name}"未保存，确认关闭吗？`)
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
            <button className="icon-button" disabled={!workspaceRoot} onClick={() => void onNewChapter()} title="新建章节">
              <AppIcon name="add" size={14} />
            </button>
            <button className="icon-button" disabled={!activeFile || !activeFile.dirty} onClick={() => void onSaveActive()} title="保存">
              <AppIcon name="save" size={15} />
            </button>
            <button
              className="icon-button"
              disabled={!activeFile}
              onClick={() => setShowPreview((v) => !v)}
              title="预览"
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
                  placeholder="开始写作..."
                  editorRef={editorRef}
                  fileType={activeFile.path.split('.').pop() || 'txt'}
                  className="novel-editor"
                  onReady={handleEditorReady}
                  contextMenuItems={[
                    {
                      id: 'ai-polish',
                      label: 'AI 润色',
                      icon: 'A',
                      action: async (editor, selection) => {
                        await runInlineAIAssist('polish', selection, editor)
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-expand',
                      label: 'AI 扩写',
                      icon: '+',
                      action: async (editor, selection) => {
                        await runInlineAIAssist('expand', selection, editor)
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-condense',
                      label: 'AI 缩写',
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
                    <div className="preview-empty">无预览内容</div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="welcome-screen">
              <h1>Novel IDE</h1>
              <div className="welcome-actions">
                <button
                  className="welcome-btn"
                  onClick={() => {
                    setAppView('project-picker')
                    void refreshProjectPickerState()
                  }}
                >
                  选择项目
                </button>
              </div>
              {!workspaceRoot && error ? <div className="error-text">{error}</div> : null}
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
            title="拖动调整右侧面板宽度"
          />
        ) : null}
        {activeRightTab ? (
          <aside className="right-panel-content">
            {activeRightTab === 'chat' ? (
              <AIChatPanel
                writerMode={writerMode}
                plannerLastRunError={plannerLastRunError}
                onNewSession={onNewChatSession}
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
                onGenerateAssistantCandidates={onGenerateAssistantCandidates}
                activeAgentId={appSettings?.active_agent_id ?? ''}
                agents={chatAgentOptions}
                onActiveAgentChange={onChatAgentChange}
                activeProviderId={effectiveProviderId}
                providers={chatProviderOptions}
                onActiveProviderChange={onChatProviderChange}
              />
            ) : null}

            {activeRightTab === 'graph' ? (
              <div className="graph-panel">
                <div className="ai-header graph-header">
                  <button className="icon-button" onClick={() => void loadGraph()}>
                    刷新图谱
                  </button>
                </div>
                <div className="graph-canvas-wrap">
                  <canvas ref={graphCanvasRef} className="graph-canvas" />
                </div>
                <div className="graph-footer">
                  数据: concept/characters.md & relations.md
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
            title="对话"
          >
            <span className="right-activity-icon"><AppIcon name="chat" /></span>
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'graph' ? 'active' : ''}`}
            onClick={() => toggleRightTab('graph')}
            title="图谱"
          >
            <span className="right-activity-icon"><AppIcon name="graph" /></span>
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'writing-goal' ? 'active' : ''}`}
            onClick={() => toggleRightTab('writing-goal')}
            title="写作目标"
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
                    title="Close"
                  >
                    ×
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
                title="Close diff panel"
              >
                Close Panel
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
                  <p>No diff view selected</p>
                </div>
              )}
            </div>

            <div className="diff-panel-footer">
              <button
                className="diff-panel-view-mode-toggle"
                onClick={() => diffContext.toggleViewMode()}
                title={`Switch to ${diffContext.viewMode === 'split' ? 'unified' : 'split'} view`}
              >
                {diffContext.viewMode === 'split' ? '⊟ Unified' : '⊞ Split'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      {showSettings ? (
        <div className="modal-overlay" onClick={requestCloseSettings}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置</h2>
              <button className="close-btn" onClick={requestCloseSettings}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {!appSettings ? (
                <div className="settings-load-state">
                  <div className="settings-load-message">设置加载失败或尚未加载完成。</div>
                  {settingsError ? <div className="error-text">{settingsError}</div> : null}
                  <div className="settings-load-actions">
                    <button className="btn btn-secondary" onClick={() => void reloadAppSettings()}>
                      重新加载
                    </button>
                    <button className="primary-button" onClick={() => setShowSettings(false)}>
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-form settings-page">
                <div className="settings-section">
                  <h3 className="settings-section-title">通用</h3>
                  <div className="form-group settings-inline-row">
                    <label className="settings-inline-label">Markdown 输出</label>
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
                    <label>启动行为</label>
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
                      <option value="picker">总是显示项目选择页</option>
                      <option value="auto_last">自动打开上次项目</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>项目管理</label>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowSettings(false)
                        setAppView('project-picker')
                        void refreshProjectPickerState()
                      }}
                    >
                      打开项目选择页
                    </button>
                  </div>
                  <div className="form-group">
                    <label>AI 文件修改</label>
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
                      <option value="auto_apply">自动应用（推荐）</option>
                      <option value="review">审阅后应用</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>章节目标字数</label>
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
                    <label>Auto 每轮最小字数</label>
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
                    <label>Auto 每轮最大字数</label>
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
                    <label>Auto 最大轮次</label>
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
                    <label>Auto 最大章节推进</label>
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
                    <label>界面主题</label>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
                      
                    >
                      <option value="dark">暗色</option>
                      <option value="light">亮色</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>界面密度</label>
                    <select
                      value={uiDensity}
                      onChange={(e) => setUiDensity(e.target.value as 'compact' | 'comfortable')}
                      
                    >
                      <option value="comfortable">默认</option>
                      <option value="compact">紧凑</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>动效</label>
                    <select
                      value={uiMotion}
                      onChange={(e) => setUiMotion(e.target.value as 'full' | 'reduced')}
                      
                    >
                      <option value="full">完整动效</option>
                      <option value="reduced">减少动效</option>
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
                      重置界面设置
                    </button>
                  </div>
                </div>

                {/* Editor Configuration Section */}
                <div className="settings-section">
                  <h3 className="settings-section-title">编辑器配置</h3>

                  {/* Font Family */}
                  <div className="form-group">
                    <label>字体</label>
                    <select
                      value={editorUserConfig.fontFamily}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ fontFamily: e.target.value })
                      }}
                      
                    >
                      <option value="system-ui, -apple-system, sans-serif">系统默认</option>
                      <option value="'Songti SC', 'SimSun', serif">宋体</option>
                      <option value="'Heiti SC', 'SimHei', sans-serif">黑体</option>
                      <option value="'Kaiti SC', 'KaiTi', serif">楷体</option>
                      <option value="'Microsoft YaHei', sans-serif">微软雅黑</option>
                      <option value="'PingFang SC', sans-serif">苹方</option>
                      <option value="monospace">等宽字体</option>
                    </select>
                  </div>

                  {/* Font Size */}
                  <div className="form-group">
                    <label>字号 ({editorUserConfig.fontSize}px)</label>
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
                    <label>行高 ({editorUserConfig.lineHeight})</label>
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
                    <label>主题</label>
                    <select
                      value={editorUserConfig.theme}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ theme: e.target.value as 'light' | 'dark' })
                      }}
                      
                    >
                      <option value="dark">暗色</option>
                      <option value="light">亮色</option>
                    </select>
                  </div>

                  {/* Editor Width */}
                  <div className="form-group">
                    <label>编辑器宽度</label>
                    <select
                      value={editorUserConfig.editorWidth}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ editorWidth: e.target.value as 'centered' | 'full' })
                      }}
                      
                    >
                      <option value="centered">居中（800px）</option>
                      <option value="full">全宽</option>
                    </select>
                  </div>

                  {/* Auto-save Interval */}
                  <div className="form-group">
                    <label>自动保存间隔 ({editorUserConfig.autoSaveInterval === 0 ? '禁用' : `${editorUserConfig.autoSaveInterval}秒`})</label>
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
                      {editorUserConfig.autoSaveInterval === 0 ? '自动保存已禁用' : `每 ${editorUserConfig.autoSaveInterval} 秒自动保存到本地缓存`}
                    </div>
                  </div>

                  {/* Reset Button */}
                  <div className="settings-action-row">
                    <button
                      className="btn btn-secondary settings-small-btn"
                      onClick={() => {
                        void (async () => {
                          const ok = await showConfirm('确定要重置编辑器配置为默认值吗？')
                          if (ok) {
                            editorConfigManager.resetConfig()
                          }
                        })()
                      }}
                    >
                      重置为默认值
                    </button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title settings-section-title-inline">模型配置</h3>
                    <button
                      className="primary-button settings-tiny-btn"
                      onClick={openCreateProviderModal}
                    >
                      + 添加模型
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
                            {providerKindLabel(p.kind)} • {p.model_name}
                          </div>
                          <div className={`settings-provider-key${apiKeyStatus[p.id] ? ' is-set' : ''}`}>
                            API Key：{apiKeyStatus[p.id] ? '已设置' : '未设置'}
                          </div>
                        </div>
                        <div className="settings-provider-actions">
                          {appSettings.active_provider_id !== p.id && (
                            <button
                              className="icon-button"
                              title="设为默认"
                              onClick={(e) => {
                                e.stopPropagation()
                                const prev = appSettings
                                const next = { ...appSettings, active_provider_id: p.id }
                                setAppSettingsState(next)
                                void persistAppSettings(next, prev)
                              }}
                            >
                              ★
                            </button>
                          )}
                          <button
                            className="icon-button"
                            title="编辑"
                            onClick={(e) => {
                              e.stopPropagation()
                              openEditProviderModal(p)
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="icon-button"
                            title="删除"
                            disabled={appSettings.providers.length <= 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              void (async () => {
                                const ok = await showConfirm('确定删除该模型配置？')
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
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="settings-section-title">智能体管理</h3>

                  {/* Built-in Agents */}
                  <div className="settings-subsection settings-subsection-lg">
                    <div className="settings-subtitle">内置智能体</div>
                    <div className="settings-grid-two">
                      {agentsList
                        .filter((a) => a.category !== '自定义')
                        .map((a) => (
                          <div
                            key={a.id}
                            className={`agent-card settings-agent-card${agentEditorId === a.id ? ' active' : ''}`}
                            onClick={() => setAgentEditorId(a.id)}
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
                      <div className="settings-subtitle settings-subtitle-inline">自定义智能体</div>
                      <button
                        className="icon-button settings-create-btn"
                        onClick={() => {
                          const id = newId()
                          const next: Agent = {
                            id,
                            name: '新智能体',
                            category: '自定义',
                            system_prompt: '',
                            temperature: 0.7,
                            max_tokens: 32000,
                          }
                          setAgentsList((prev) => [...prev, next])
                          setAgentEditorId(id)
                        }}
                      >
                        + 创建
                      </button>
                    </div>
                    {agentsList.filter((a) => a.category === '自定义').length === 0 ? (
                      <div className="settings-empty-note settings-empty-box">
                        暂无自定义智能体
                      </div>
                    ) : (
                      <div className="settings-grid-two">
                        {agentsList
                          .filter((a) => a.category === '自定义')
                          .map((a) => (
                            <div
                              key={a.id}
                              className={`agent-card settings-agent-card settings-agent-card-custom${agentEditorId === a.id ? ' active' : ''}`}
                              onClick={() => setAgentEditorId(a.id)}
                            >
                              <div className="settings-agent-name">{a.name}</div>
                              <div className="settings-agent-category">自定义</div>
                              {agentEditorId === a.id && (
                                <button
                                  className="icon-button settings-agent-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void (async () => {
                                      const ok = await showConfirm('确定删除此智能体？')
                                      if (!ok) return
                                      setAgentsList((prev) => prev.filter((x) => x.id !== a.id))
                                      setAgentEditorId('')
                                    })()
                                  }}
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {agentEditorId && agentsList.find((a) => a.id === agentEditorId) && (
                    <div className="settings-editor-panel">
                      <div className="settings-editor-title">
                        编辑: {agentsList.find((a) => a.id === agentEditorId)?.name}
                      </div>
                      <div className="settings-editor-fields">
                        <div className="form-group">
                          <label>名称</label>
                          <input
                            className="ai-select"
                            value={agentsList.find((a) => a.id === agentEditorId)?.name ?? ''}
                            onChange={(e) =>
                              setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, name: e.target.value } : a)))
                            }
                            disabled={agentsList.find((a) => a.id === agentEditorId)?.category !== '自定义'}
                          />
                        </div>
                        <div className="form-group">
                          <label>系统提示词 (System Prompt)</label>
                          <textarea
                            className="ai-textarea settings-agent-prompt"
                            placeholder="你是一个..."

                            value={agentsList.find((a) => a.id === agentEditorId)?.system_prompt ?? ''}
                            onChange={(e) =>
                              setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, system_prompt: e.target.value } : a)))
                            }
                            disabled={agentsList.find((a) => a.id === agentEditorId)?.category !== '自定义'}
                          />
                        </div>
                        <div className="form-group">
                          <label>章节目标字数</label>
                          <div className="settings-spacer-text">此项为项目级设置，请在上方“章节目标字数”中调整。</div>
                        </div>
                      </div>
                    </div>
                  )}
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
                  保存并关闭
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
              <h2>{isNewProvider ? '添加模型' : '编辑模型'}</h2>
              <button className="close-btn" onClick={() => setShowModelModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-form">
                <div className="form-group">
                  <label>名称 (显示用)</label>
                  <input
                    value={editingProvider.name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, name: e.target.value }))}
                    placeholder="例如：DeepSeek V3"
                  />
                </div>
                <div className="form-group">
                  <label>提供商</label>
                  <select
                    value={editingProviderPreset}
                    onChange={(e) => onSelectProviderPreset(e.target.value)}
                  >
                    {COMMON_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.key} value={preset.key}>
                        {preset.name}
                      </option>
                    ))}
                    <option value={CUSTOM_PROVIDER_PRESET_KEY}>自定义提供商</option>
                  </select>
                </div>
                {editingProviderPreset === CUSTOM_PROVIDER_PRESET_KEY ? (
                  <div className="form-group">
                    <label>API 格式</label>
                    <select
                      value={editingCustomProviderApiFormat}
                      onChange={(e) => onChangeCustomProviderApiFormat(e.target.value as CustomProviderApiFormat)}
                    >
                      <option value="openai">OpenAI API 格式</option>
                      <option value="claude">Claude API 格式</option>
                    </select>
                  </div>
                ) : null}
                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    value={editingProvider.base_url ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, base_url: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
                <div className="form-group">
                  <label>Model ID</label>
                  <input
                    value={editingProvider.model_name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, model_name: e.target.value }))}
                    placeholder="例如：gpt-4o, claude-sonnet-4-5, deepseek-chat"
                  />
                </div>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editingProvider.api_key ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder={
                      editingProvider.id && apiKeyStatus[editingProvider.id] ? '已设置（留空表示不修改）' : 'sk-...'
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="primary-button"
                disabled={!editingProvider.name?.trim() || !editingProvider.base_url?.trim() || !editingProvider.model_name?.trim()}
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
                      const ok = await showConfirm('未填写 API Key，仍要保存该模型配置吗？')
                      if (!ok) return
                    }
                    if (pid && rawKey) {
                      try {
                        await setApiKey(pid, rawKey)
                        setApiKeyStatus((m) => ({ ...m, [pid]: true }))
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e)
                        await showErrorDialog(`保存 API Key 失败：${msg}`)
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
                      await showErrorDialog(`保存设置失败：${msg}`)
                      setAppSettingsState(prev)
                      return
                    }
                    if (pid) {
                      try {
                        const ok = await getApiKeyStatus(pid)
                        setApiKeyStatus((m) => ({ ...m, [pid]: ok }))
                        if (rawKey && !ok) {
                          await showErrorDialog(`API Key 已提交保存，但读取状态仍为"未设置"（provider=${pid}）。可能是系统凭据存储不可用。`)
                          return
                        }
                      } catch {
                        setApiKeyStatus((m) => ({ ...m, [pid]: false }))
                        if (rawKey) {
                          await showErrorDialog(`API Key 已提交保存，但读取状态失败（provider=${pid}）。可能是系统凭据存储不可用。`)
                          return
                        }
                      }
                    }
                    await reloadAppSettings()
                    setShowModelModal(false)
                  })()
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <StatusBar
        info={{
          charCount: activeCharCount,
          chapterTarget: chapterWordTarget,
          gitStatus: gitItems.length > 0 ? 'modified' : 'clean',
          gitBranch: 'main',
          theme,
        }}
        onThemeToggle={toggleTheme}
        onGitClick={() => {
          openSidebarTab('git')
        }}
      />

      {chatContextMenu ? (
        <div className="context-menu" style={{ left: chatContextMenu.x, top: chatContextMenu.y }}>
          <button
            className={chatContextMenu.selection ? 'context-menu-item' : 'context-menu-item disabled'}
            disabled={!chatContextMenu.selection}
            onClick={() => void copyText(chatContextMenu.selection).finally(() => setChatContextMenu(null))}
          >
            复制选中内容
          </button>
          <button
            className="context-menu-item"
            onClick={() => void copyText(chatContextMenu.message).finally(() => setChatContextMenu(null))}
          >
            复制该条消息
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
	            {'\u91cd\u65b0\u751f\u6210\u56de\u590d'}
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
	            {'\u751f\u6210 2 \u4e2a\u5019\u9009'}
	          </button>
	        </div>
	      ) : null}

      {explorerContextMenu ? (
        <div className="context-menu" style={{ left: explorerContextMenu.x, top: explorerContextMenu.y }}>
          <button className="context-menu-item" onClick={() => void refreshTree().finally(() => setExplorerContextMenu(null))}>
            刷新
          </button>
          {explorerContextMenu.entry.kind === 'dir' ? (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  setExplorerModal({ mode: 'newFile', dirPath: explorerContextMenu.entry.path })
                  setExplorerModalValue('')
                  setExplorerContextMenu(null)
                }}
              >
                新建文件
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  setExplorerModal({ mode: 'newFolder', dirPath: explorerContextMenu.entry.path })
                  setExplorerModalValue('')
                  setExplorerContextMenu(null)
                }}
              >
                新建文件夹
              </button>
            </>
          ) : null}
          <button
            className="context-menu-item"
            onClick={() => {
              const parentDir = explorerContextMenu.entry.path.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
              setExplorerModal({ mode: 'rename', entry: explorerContextMenu.entry, parentDir })
              setExplorerModalValue(explorerContextMenu.entry.name)
              setExplorerContextMenu(null)
            }}
          >
            重命名
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const entry = explorerContextMenu.entry
              setExplorerContextMenu(null)
              void (async () => {
                const ok = await showConfirm(`确认删除：${entry.path} ?`)
                if (!ok) return
                try {
                  await deleteEntry(entry.path)
                  await refreshTree()
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e)
                  await showErrorDialog(msg)
                }
              })()
            }}
          >
            删除
          </button>
        </div>
      ) : null}

      {explorerModal ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setExplorerModal(null)
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div className="modal-header">
              <h2>
                {explorerModal.mode === 'newFile' ? '新建文件' : explorerModal.mode === 'newFolder' ? '新建文件夹' : '重命名'}
              </h2>
              <button className="close-btn" onClick={() => setExplorerModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>名称</label>
                <input
                  value={explorerModalValue}
                  onChange={(e) => setExplorerModalValue(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setExplorerModal(null)}>
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void (async () => {
                    const name = explorerModalValue.trim()
                    if (!name) return
                    if (explorerModal.mode === 'newFile') {
                      const rel = `${explorerModal.dirPath.replaceAll('\\', '/')}/${name}`.replaceAll('//', '/')
                      const ok = await showConfirm(`确认新建文件：${rel} ?`)
                      if (!ok) return
                      try {
                        await createFile(rel)
                        await refreshTree()
                        setExplorerModal(null)
                      } catch (e) {
                        await showErrorDialog(e instanceof Error ? e.message : String(e))
                      }
                      return
                    }
                    if (explorerModal.mode === 'newFolder') {
                      const rel = `${explorerModal.dirPath.replaceAll('\\', '/')}/${name}`.replaceAll('//', '/')
                      const ok = await showConfirm(`确认新建文件夹：${rel} ?`)
                      if (!ok) return
                      try {
                        await createDir(rel)
                        await refreshTree()
                        setExplorerModal(null)
                      } catch (e) {
                        await showErrorDialog(e instanceof Error ? e.message : String(e))
                      }
                      return
                    }
                    const next = `${explorerModal.parentDir}/${name}`.replaceAll('//', '/')
                    const ok = await showConfirm(`确认重命名为：${next} ?`)
                    if (!ok) return
                    try {
                      await renameEntry(explorerModal.entry.path, next)
                      await refreshTree()
                      setExplorerModal(null)
                    } catch (e) {
                      await showErrorDialog(e instanceof Error ? e.message : String(e))
                    }
                  })()
                }}
              >
                确定
              </button>
            </div>
          </div>
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

      {/* Command Palette */}
      {showCommandPalette && (
        <CommandPalette
          commands={[
            { id: 'save', label: '保存文件', category: '文件', shortcut: 'Ctrl+S', action: () => void onSaveActive() },
            { id: 'newChapter', label: '新建章节', category: '文件', action: () => void onNewChapter() },
            {
              id: 'switchProject',
              label: '切换项目',
              category: '文件',
              action: () => {
                setShowCommandPalette(false)
                setAppView('project-picker')
                void refreshProjectPickerState()
              },
            },
            { id: 'toggleTheme', label: '切换主题', category: '视图', action: toggleTheme },
            { id: 'toggleDensity', label: '切换界面密度', category: '视图', action: toggleDensity },
            { id: 'toggleSidebar', label: '切换侧边栏', category: '视图', shortcut: 'Ctrl+B', action: toggleSidebar },
            { id: 'openSettings', label: '打开设置', category: '设置', shortcut: 'Ctrl+,', action: () => setShowSettings(true) },
            {
              id: 'aiChat',
              label: 'AI 对话',
              category: 'AI',
              shortcut: 'Ctrl+Shift+L',
              action: () => {
                openRightTab('chat')
                window.setTimeout(() => {
                  chatInputRef.current?.focus()
                }, 0)
              },
            },
            { id: 'smartComplete', label: '智能补全', category: 'AI', action: () => void onSmartComplete() },
            {
              id: 'toggleAutoLongWrite',
              label: autoLongWriteEnabled ? '关闭 Auto 连续生成' : '开启 Auto 连续生成',
              category: 'AI',
	              action: () => {
	                const next = !autoLongWriteEnabled
	                setAutoLongWriteEnabled(next)
	                autoLongWriteStopRef.current = !next
	                setAutoLongWriteStatus(next ? 'Auto enabled.' : 'Auto disabled.')
	                if (!next && activeStreamId) {
	                  void onStopChat()
	                }
	              },
	            },
            { id: 'regenerateReply', label: '\u91cd\u65b0\u751f\u6210\u56de\u590d', category: 'AI', action: () => void onRegenerateAssistant(latestCompletedAssistantId ?? undefined) },
            { id: 'candidateReplies', label: '\u751f\u6210 2 \u4e2a\u5019\u9009\u56de\u590d', category: 'AI', action: () => void onGenerateAssistantCandidates(latestCompletedAssistantId ?? undefined, 2) },
            { id: 'modeNormal', label: '\u5207\u6362\u666e\u901a\u6a21\u5f0f', category: '\u0041\u0049\u89C4\u5212', action: () => void onWriterModeChange('normal') },
            { id: 'modePlan', label: '\u5207\u6362\u5927\u7eb2\u6a21\u5f0f', category: '\u0041\u0049\u89C4\u5212', action: () => void onWriterModeChange('plan') },
            { id: 'modeSpec', label: '\u5207\u6362\u7ec6\u7eb2\u6a21\u5f0f', category: '\u0041\u0049\u89C4\u5212', action: () => void onWriterModeChange('spec') },
            { id: 'generatePlan', label: '\u751F\u6210\u5927\u7EB2\u4E0E\u7EC6\u7EB2', category: '\u0041\u0049\u89C4\u5212', action: () => void onGeneratePlanAndTasks() },
            { id: 'runQueue', label: '\u6267\u884C\u7EC6\u7EB2\u961F\u5217', category: '\u0041\u0049\u89C4\u5212', action: () => void runPlannerQueue(chatInput) },
            {
              id: 'gitCommit',
              label: 'Git 提交',
              category: 'Git',
              action: () => {
                openSidebarTab('git')
                if (gitCommitMsg.trim()) {
                  void onGitCommit()
                  return
                }
                window.setTimeout(() => {
                  gitCommitInputRef.current?.focus()
                }, 0)
              },
            },
            {
              id: 'gitPush',
              label: 'Git 推送',
              category: 'Git',
              action: async () => {
                openSidebarTab('git')
                await showErrorDialog('当前版本暂不支持 Git Push，请在外部终端执行。')
              },
            },
          ]}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  )
}

export default App

























