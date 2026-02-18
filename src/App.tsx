import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { LexicalEditor as LexicalEditorType } from 'lexical'
import { $getSelection, $isRangeSelection } from 'lexical'
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
  getLastWorkspace,
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
  renameEntry,
  setAgents,
  setApiKey,
  setAppSettings,
  saveChatSession,
  setWorkspace,
  writeText,
  type Agent,
  type AppSettings,
  type FsEntry,
  type GitCommitInfo,
  type GitStatusItem,
  type ModelProvider,
} from './tauri'
import { useDiff } from './contexts/DiffContext'
import { modificationService, aiAssistanceService, editorManager, editorConfigManager } from './services'
import type { EditorUserConfig } from './services'
import DiffView from './components/DiffView'
import EditorContextMenu from './components/EditorContextMenu'
import { ChapterManager } from './components/ChapterManager'
import { CharacterManager } from './components/CharacterManager'
import { PlotLineManager } from './components/PlotLineManager'
import { WritingGoalPanel } from './components/WritingGoalPanel'
import { SpecKitPanel } from './components/SpecKitPanel'
import { SpecKitLintPanel } from './components/SpecKitLintPanel'
import { DiffReviewPanel } from './components/DiffReviewPanel'
import { StatusBar } from './components/StatusBar'
import { CommandPalette, type Command } from './components/CommandPalette'
import { TabBar, type TabItem } from './components/TabBar'
import { handleFileSaveError, clearBackupContent } from './utils/fileSaveErrorHandler'
import { useAutoSave, clearAutoSavedContent, getAutoSavedContent } from './hooks/useAutoSave'
import { logError } from './utils/errorLogger'
import { RecoveryDialog } from './components/RecoveryDialog'

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
  streamId?: string
  changeSet?: import('./services/ModificationService').ChangeSet
  timestamp?: number
}

type ChatContextMenuState = {
  x: number
  y: number
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

function App() {
  // Diff Context
  const diffContext = useDiff()

  // DiffView State
  const [showDiffPanel, setShowDiffPanel] = useState(false)
  const [activeDiffTab, setActiveDiffTab] = useState<string | null>(null)

  // Modern UI State
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  // Activity Bar State
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'git' | 'chapters' | 'characters' | 'plotlines' | 'specKit'>('files')
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'graph' | 'writing-goal' | 'spec-kit' | null>('chat')

  // Workspace & Files
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
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
  const [isNewProvider, setIsNewProvider] = useState(true)

  // ... (rest of App component)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [explorerModal, setExplorerModal] = useState<ExplorerModalState | null>(null)
  const [explorerModalValue, setExplorerModalValue] = useState<string>('')
  const [explorerQuery, setExplorerQuery] = useState<string>('')

  // Editors & Refs
  const editorRef = useRef<LexicalEditorType | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const autoOpenedRef = useRef(false)

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState | null>(null)
  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null)
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  // Chat session management (future feature)
  // const [chatSessions, setChatSessions] = useState<Array<{ id: string; name: string; updatedAt: number }>>([])
  // const [showSessionManager, setShowSessionManager] = useState(false)

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

  // Sensitive Word Detection State
  const [sensitiveWordEnabled, setSensitiveWordEnabled] = useState(true)
  const [sensitiveWordDictionary, setSensitiveWordDictionary] = useState<string[]>([
    // Default sensitive words (example - should be loaded from config)
    '暴力', '血腥', '色情', '政治', '敏感',
  ])
  const [newSensitiveWord, setNewSensitiveWord] = useState('')

  // Editor Configuration State
  const [editorUserConfig, setEditorUserConfig] = useState<EditorUserConfig>(editorConfigManager.getConfig())

  // Sensitive Word Detection Hook
  // TODO: Re-implement for Lexical in task 9
  // const { sensitiveWordCount, isDetecting: isSensitiveWordDetecting } = useSensitiveWordDetection({
  //   editor: editorRef.current,
  //   enabled: sensitiveWordEnabled && activePath !== null,
  //   dictionary: sensitiveWordDictionary,
  //   debounceMs: 500,
  // })
  const sensitiveWordCount = 0
  const isSensitiveWordDetecting = false
  const [gitError, setGitError] = useState<string | null>(null)

  // Stats & Visuals
  const [chapterWordTarget, setChapterWordTarget] = useState<number>(2000)
  const [writingSeconds, setWritingSeconds] = useState<number>(0)
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
  const isMarkdownFile = useMemo(() => !!activeFile && activeFile.path.toLowerCase().endsWith('.md'), [activeFile])
  const activeCharCount = useMemo(() => {
    if (!activeFile) return 0
    return activeFile.content.replace(/\s/g, '').length
  }, [activeFile])

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
      setSettingsError(null)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e))
      setAppSettingsState(null)
    }
  }, [])

  const openWorkspacePath = useCallback(
    async (path: string) => {
      const p = path.trim()
      if (!p) return
      setError(null)
      setBusy(true)
      try {
        const info = await setWorkspace(p)
        setWorkspaceRoot(info.root)
        setLastWorkspace(info.root)
      } catch (e) {
        setWorkspaceRoot(null)
        setTree(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const loadProjectSettings = useCallback(async () => {
    if (!workspaceRoot) return
    try {
      const raw = await readText('.novel/.settings/project.json')
      const v: unknown = JSON.parse(raw)
      const n =
        typeof v === 'object' && v && 'chapter_word_target' in v
          ? Number((v as { chapter_word_target?: unknown }).chapter_word_target)
          : NaN
      if (Number.isFinite(n) && n > 0) {
        setChapterWordTarget(n)
      }
    } catch {
      return
    }
  }, [workspaceRoot])

  const saveProjectSettings = useCallback(async () => {
    if (!workspaceRoot) return
    if (isTauriApp()) {
      try {
        await initNovel()
      } catch {
        return
      }
    }
    const raw = JSON.stringify({ chapter_word_target: chapterWordTarget }, null, 2)
    await writeText('.novel/.settings/project.json', raw)
  }, [workspaceRoot, chapterWordTarget])

  const loadSensitiveWordSettings = useCallback(async () => {
    if (!workspaceRoot) return
    try {
      const raw = await readText('.novel/.settings/sensitive-words.json')
      const v: unknown = JSON.parse(raw)
      if (typeof v === 'object' && v) {
        const data = v as { enabled?: boolean; dictionary?: string[] }
        if (typeof data.enabled === 'boolean') {
          setSensitiveWordEnabled(data.enabled)
        }
        if (Array.isArray(data.dictionary)) {
          setSensitiveWordDictionary(data.dictionary)
        }
      }
    } catch {
      // File doesn't exist or is invalid, use defaults
      return
    }
  }, [workspaceRoot])

  const saveSensitiveWordSettings = useCallback(async () => {
    if (!workspaceRoot) return
    if (isTauriApp()) {
      try {
        await initNovel()
      } catch {
        return
      }
    }
    const raw = JSON.stringify(
      {
        enabled: sensitiveWordEnabled,
        dictionary: sensitiveWordDictionary,
      },
      null,
      2
    )
    await writeText('.novel/.settings/sensitive-words.json', raw)
  }, [workspaceRoot, sensitiveWordEnabled, sensitiveWordDictionary])

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

  const onOpenWorkspace = useCallback(async () => {
    try {
      if (!isTauriApp()) {
        await openWorkspacePath(workspaceInput)
      } else {
        const selected = await openFolderDialog()
        if (!selected) return
        await openWorkspacePath(selected)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [openWorkspacePath, workspaceInput])

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

  // Sensitive Word Handlers
  const onAddSensitiveWord = useCallback(() => {
    const word = newSensitiveWord.trim()
    if (!word) return
    if (sensitiveWordDictionary.includes(word)) {
      setNewSensitiveWord('')
      return
    }
    setSensitiveWordDictionary((prev) => [...prev, word])
    setNewSensitiveWord('')
  }, [newSensitiveWord, sensitiveWordDictionary])

  const onRemoveSensitiveWord = useCallback((word: string) => {
    setSensitiveWordDictionary((prev) => prev.filter((w) => w !== word))
  }, [])

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
            <span className="file-icon file">📄</span>
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
            <span className="file-icon">{open ? '📂' : '📁'}</span>
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

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor || !text) return

    // Use Lexical's insertTextAtCursor method from AIAssistPlugin
    const extendedEditor = editor as any
    if (extendedEditor.insertTextAtCursor && typeof extendedEditor.insertTextAtCursor === 'function') {
      extendedEditor.insertTextAtCursor(text)
    } else {
      // Fallback to direct update
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertText(text)
        }
      })
      editor.focus()
    }
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
    await message(text, { title: '错误', kind: 'error' })
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
      await setAgents(agentsList)
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

  const openChatContextMenu = useCallback((e: MouseEvent, message: string) => {
    e.preventDefault()
    e.stopPropagation()
    const selection = window.getSelection?.()?.toString() ?? ''
    setChatContextMenu({ x: e.clientX, y: e.clientY, message, selection })
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
    const text = getSelectionText().trim()
    if (!text) return
    setChatInput((prev) => (prev ? `${prev}\n${text}` : text))
    chatInputRef.current?.focus()
  }, [getSelectionText])

  const onSendChat = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? chatInput).trim()
    if (!content) return
    const user: ChatItem = { id: newId(), role: 'user', content }
    const streamId = newId()
    const assistantId = newId()
    const assistant: ChatItem = { id: assistantId, role: 'assistant', content: '', streaming: true, streamId }

    setChatMessages((prev) => [...prev, user, assistant])
    if (!overrideContent || overrideContent === chatInput) {
      setChatInput('')
    }

    if (!isTauriApp()) {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: '当前未运行在 Tauri 环境，无法调用 AI。', streaming: false } : m)),
      )
      return
    }

    if (!workspaceRoot) {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: '请先打开一个工作区（Workspace）。', streaming: false } : m)),
      )
      return
    }

    try {
      await initNovel()
    } catch (e) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
        ),
      )
      return
    }

    const messagesToSend = [...chatMessages, user].map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp || Date.now()
    }))
    try {
      const { chatGenerateStream } = await import('./tauriChat')
      await chatGenerateStream({
        streamId,
        messages: messagesToSend,
        useMarkdown: appSettings?.output.use_markdown ?? false,
        agentId: appSettings?.active_agent_id ?? null,
      })
    } catch (e) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
        ),
      )
    }
  }, [chatInput, chatMessages, newId, appSettings, workspaceRoot])

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

  const handleAIPolish = useCallback(async () => {
    if (!editorContextMenu || !activeFile) return

    const selectedText = editorContextMenu.selectedText

    setBusy(true)
    setError(null)

    try {
      // Call AI assistance service
      const response = await aiAssistanceService.polishText(
        selectedText,
        activeFile.path
      )

      // Convert to ChangeSet (without line numbers for now - will be improved in task 7)
      const changeSet = aiAssistanceService.convertToChangeSet(
        response,
        activeFile.path,
        activeFile.content,
        1, // placeholder
        1  // placeholder
      )

      // Add to diff context and open diff view
      diffContext.addChangeSet(changeSet)
      onOpenDiffView(changeSet.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [editorContextMenu, activeFile, diffContext, onOpenDiffView])

  const handleAIExpand = useCallback(async () => {
    if (!editorContextMenu || !activeFile) return

    const selectedText = editorContextMenu.selectedText

    setBusy(true)
    setError(null)

    try {
      // Call AI assistance service
      const response = await aiAssistanceService.expandText(
        selectedText,
        activeFile.path
      )

      // Convert to ChangeSet (without line numbers for now - will be improved in task 7)
      const changeSet = aiAssistanceService.convertToChangeSet(
        response,
        activeFile.path,
        activeFile.content,
        1, // placeholder
        1  // placeholder
      )

      // Add to diff context and open diff view
      diffContext.addChangeSet(changeSet)
      onOpenDiffView(changeSet.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [editorContextMenu, activeFile, diffContext, onOpenDiffView])

  const handleAICondense = useCallback(async () => {
    if (!editorContextMenu || !activeFile) return

    const selectedText = editorContextMenu.selectedText

    setBusy(true)
    setError(null)

    try {
      // Call AI assistance service
      const response = await aiAssistanceService.condenseText(
        selectedText,
        activeFile.path
      )

      // Convert to ChangeSet (without line numbers for now - will be improved in task 7)
      const changeSet = aiAssistanceService.convertToChangeSet(
        response,
        activeFile.path,
        activeFile.content,
        1, // placeholder
        1  // placeholder
      )

      // Add to diff context and open diff view
      diffContext.addChangeSet(changeSet)
      onOpenDiffView(changeSet.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [editorContextMenu, activeFile, diffContext, onOpenDiffView])

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
    if (!isTauriApp()) return
    if (autoOpenedRef.current) return
    autoOpenedRef.current = true
    void (async () => {
      try {
        const last = await getLastWorkspace()
        setLastWorkspace(last)
        if (!workspaceRoot && last) {
          await openWorkspacePath(last)
        }

        // Check for recovery candidates after workspace is loaded
        setTimeout(() => {
          setShowRecoveryDialog(true)
        }, 1000) // Delay to let workspace load first
      } catch {
        setLastWorkspace(null)
      }
    })()
  }, [openWorkspacePath, workspaceRoot])

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
    void loadProjectSettings()
    void loadSensitiveWordSettings()
  }, [loadProjectSettings, loadSensitiveWordSettings, refreshGit, workspaceRoot])

  // Auto-save sensitive word settings when they change
  useEffect(() => {
    if (!workspaceRoot) return
    // Debounce the save to avoid too many writes
    const timer = setTimeout(() => {
      void saveSensitiveWordSettings()
    }, 500)
    return () => clearTimeout(timer)
  }, [sensitiveWordEnabled, sensitiveWordDictionary, saveSensitiveWordSettings, workspaceRoot])

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
    void listen('ai_stream_token', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const token = typeof p.token === 'string' ? p.token : ''
      if (!token) return
      setChatMessages((prev) =>
        prev.map((m) => (m.role === 'assistant' && m.streamId === streamId ? { ...m, content: `${m.content}${token}` } : m)),
      )
    }).then((u) => unlistenFns.push(u))

    void listen('ai_stream_done', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      setChatMessages((prev) => prev.map((m) => (m.role === 'assistant' && m.streamId === streamId ? { ...m, streaming: false } : m)))
    }).then((u) => unlistenFns.push(u))

    void listen('ai_change_set', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const changeSet = p.changeSet as import('./services/ModificationService').ChangeSet | undefined
      if (!changeSet) return

      // Add the ChangeSet to the DiffContext
      diffContext.addChangeSet(changeSet)

      // Update the chat message with the ChangeSet
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? { ...m, changeSet }
            : m
        )
      )

      // Open the DiffView panel
      onOpenDiffView(changeSet.id)
    }).then((u) => unlistenFns.push(u))

    void listen('ai_error', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const message = typeof p.message === 'string' ? p.message : 'AI 调用失败'
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
    }).then((u) => unlistenFns.push(u))

    return () => {
      for (const u of unlistenFns) u()
    }
  }, [])

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
  }, [onSaveActive])

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
    setWritingSeconds(0)
    if (!activePath) return
    const t = window.setInterval(() => setWritingSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(t)
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

  return (
    <div className="app-container">
      <div className="workbench-body">
        {/* Activity Bar (Left) */}
        <div className="activity-bar">
          <div
            className={`activity-bar-item ${activeSidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('files')}
            title="资源管理器"
          >
            <span className="activity-bar-icon">📁</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'chapters' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('chapters')}
            title="章节管理"
          >
            <span className="activity-bar-icon">📚</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'characters' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('characters')}
            title="人物管理"
          >
            <span className="activity-bar-icon">👤</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'plotlines' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('plotlines')}
            title="情节线管理"
          >
            <span className="activity-bar-icon">📈</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'specKit' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('specKit')}
            title="Spec-Kit"
          >
            <span className="activity-bar-icon">🧩</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'git' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('git')}
            title="源代码管理"
          >
            <span className="activity-bar-icon">📦</span>
          </div>
          <div className="spacer" />
          <div
            className="activity-bar-item"
            onClick={() => {
              setShowSettings(true)
              if (!appSettings) void reloadAppSettings()
            }}
            title="设置"
          >
            <span className="activity-bar-icon">⚙️</span>
          </div>
        </div>

        {/* Sidebar Panel (Left) */}
        <div className="sidebar">
        {activeSidebarTab === 'files' ? (
          <>
            <div className="sidebar-header">
              <span>{workspaceRoot ? workspaceRoot.split(/[/\\]/).pop() || '项目' : '资源管理器'}</span>
              <div style={{ flex: 1 }} />
              {workspaceRoot ? (
                <button className="icon-button" onClick={() => void refreshTree()} title="刷新">
                  ↻
                </button>
              ) : null}
            </div>
            <div className="sidebar-content" style={{ flex: 1 }} onContextMenu={(e) => {
              e.preventDefault()
              if (workspaceRoot) {
                setExplorerContextMenu({ x: e.clientX, y: e.clientY, entry: { kind: 'dir', path: workspaceRoot, name: workspaceRoot.split('/').pop() || '', children: [] } })
              }
            }}>
              {workspaceRoot ? (
                <>
                  {error ? <div className="error-text">{error}</div> : null}
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
                    <input
                      className="explorer-search"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      placeholder="搜索..."
                    />
                  </div>
                  {visibleTree ? <TreeNode entry={visibleTree} depth={0} /> : <div style={{ padding: 10 }}>加载中...</div>}
                </>
              ) : (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <button className="primary-button" onClick={() => void onOpenWorkspace()}>
                    打开文件夹
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
                      style={{ width: '100%', marginTop: 10, padding: 4 }}
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
                <div className="sidebar-content" style={{ flex: '0 0 auto', maxHeight: '150px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void onOpenByPath('outline/outline.md')}
                    style={{ width: 'calc(100% - 20px)', margin: '10px', display: 'block' }}
                  >
                    打开 outline.md
                  </button>
                  <div style={{ padding: '0 10px', fontSize: '11px', color: '#888' }}>在 outline/ 目录维护章节大纲。</div>
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
                  <div style={{ padding: 10, color: '#888' }}>无变更</div>
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
                <div style={{ padding: 10, borderTop: '1px solid #333' }}>
                  {gitCommits.slice(0, 5).map((c) => (
                    <div key={c.id} style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'monospace', marginRight: 6 }}>{c.id.slice(0, 7)}</span>
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

        {activeSidebarTab === 'specKit' ? <SpecKitPanel /> : null}
      </div>

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
        <div className="editor-tabs-actions">
          <button className="icon-button" disabled={!workspaceRoot} onClick={() => void onNewChapter()} title="新建章节">
            +
          </button>
          <button className="icon-button" disabled={!activeFile || !activeFile.dirty} onClick={() => void onSaveActive()} title="保存">
            💾
          </button>
          <button
            className="icon-button"
            disabled={!activeFile}
            onClick={() => setShowPreview((v) => !v)}
            title="预览"
          >
            👁
          </button>
        </div>
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
                      icon: '✨',
                      action: async (_editor, selection) => {
                        if (!selection || !activeFile) return
                        setBusy(true)
                        setError(null)
                        try {
                          const response = await aiAssistanceService.polishText(selection, activeFile.path)
                          const changeSet = aiAssistanceService.convertToChangeSet(
                            response,
                            activeFile.path,
                            activeFile.content,
                            1,
                            1
                          )
                          diffContext.addChangeSet(changeSet)
                          onOpenDiffView(changeSet.id)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        } finally {
                          setBusy(false)
                        }
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-expand',
                      label: 'AI 扩写',
                      icon: '📝',
                      action: async (_editor, selection) => {
                        if (!selection || !activeFile) return
                        setBusy(true)
                        setError(null)
                        try {
                          const response = await aiAssistanceService.expandText(selection, activeFile.path)
                          const changeSet = aiAssistanceService.convertToChangeSet(
                            response,
                            activeFile.path,
                            activeFile.content,
                            1,
                            1
                          )
                          diffContext.addChangeSet(changeSet)
                          onOpenDiffView(changeSet.id)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        } finally {
                          setBusy(false)
                        }
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-condense',
                      label: 'AI 缩写',
                      icon: '✂️',
                      action: async (_editor, selection) => {
                        if (!selection || !activeFile) return
                        setBusy(true)
                        setError(null)
                        try {
                          const response = await aiAssistanceService.condenseText(selection, activeFile.path)
                          const changeSet = aiAssistanceService.convertToChangeSet(
                            response,
                            activeFile.path,
                            activeFile.content,
                            1,
                            1
                          )
                          diffContext.addChangeSet(changeSet)
                          onOpenDiffView(changeSet.id)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        } finally {
                          setBusy(false)
                        }
                      },
                      condition: (hasSelection) => hasSelection,
                    },
                    {
                      id: 'ai-spec-kit-fix',
                      label: 'Spec-Kit 修正',
                      icon: '🧩',
                      action: async (_editor, selection) => {
                        if (!selection || !activeFile) return
                        setBusy(true)
                        setError(null)
                        try {
                          const response = await aiAssistanceService.specKitFixText(selection, activeFile.path)
                          const changeSet = aiAssistanceService.convertToChangeSet(
                            response,
                            activeFile.path,
                            activeFile.content,
                            1,
                            1
                          )
                          diffContext.addChangeSet(changeSet)
                          onOpenDiffView(changeSet.id)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e))
                        } finally {
                          setBusy(false)
                        }
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
                <button className="welcome-btn" onClick={() => void onOpenWorkspace()}>
                  打开文件夹
                </button>
              </div>
              {!workspaceRoot && error ? <div className="error-text">{error}</div> : null}
            </div>
          )}
        </div>
      </div>

      {/* Right Activity Bar & Panel */}
      <div className="right-panel-container">
        {activeRightTab ? (
          <aside className="right-panel-content">
            {activeRightTab === 'chat' ? (
              <>
                <div className="ai-header">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: '#888', fontWeight: 500 }}>AI 对话</span>
                    <button
                      className="icon-button"
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      onClick={() => {
                        const newId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
                        chatSessionIdRef.current = newId
                        setChatMessages([])
                      }}
                      title="新建对话"
                    >
                      ➕ 新会话
                    </button>
                  </div>
                  <div className="ai-config-row">
                    <select
                      className="ai-select"
                      value={appSettings?.active_agent_id ?? ''}
                      onChange={(e) => {
                        const id = e.target.value
                        if (!appSettings) return
                        const prev = appSettings
                        const next = { ...appSettings, active_agent_id: id }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    >
                      {agentsList.length === 0 ? <option value="">无智能体</option> : null}
                      {agentsList.map((a) => (
                        <option key={a.id} value={a.id}>
                          🤖 {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ai-config-row">
                    <select
                      className="ai-select"
                      value={effectiveProviderId}
                      onChange={(e) => {
                        const active = e.target.value
                        if (!appSettings) return
                        const prev = appSettings
                        const next = { ...appSettings, active_provider_id: active }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    >
                      {appSettings?.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="ai-messages">
                  {chatMessages.length === 0 ? (
                    <div style={{ padding: 20, color: '#888', textAlign: 'center', fontSize: 13 }}>
                      <div>👋 嗨，我是你的写作助手。</div>
                      <div style={{ marginTop: 8 }}>我可以帮你续写情节、润色文笔或构思大纲。</div>
                    </div>
                  ) : (
                    chatMessages.map((m) => (
                      <div key={m.id} className={m.role === 'user' ? 'message user' : 'message assistant'}>
                        <div className="message-meta">
                          {m.role === 'user' ? (
                            '你'
                          ) : (
                            <span className="ai-meta">
                              AI
                              {m.streaming ? (
                                <span className="ai-dot-pulse" aria-hidden="true">
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                        <div className="message-content" style={{ whiteSpace: 'pre-wrap' }} onContextMenu={(e) => openChatContextMenu(e, m.content)}>
                          {m.content || (m.role === 'assistant' && m.streaming ? '正在思考…' : '')}
                        </div>
                        {m.role === 'assistant' && m.streaming ? (
                          <div className="ai-processing-indicator">
                            <div className="ai-processing-spinner" />
                            <span>AI 正在处理文件...</span>
                          </div>
                        ) : null}
                        {m.role === 'assistant' && m.changeSet && m.changeSet.files.length > 0 ? (
                          <div className="file-modifications">
                            <div className="file-modifications-header">
                              <span className="file-icon">📝</span>
                              <span>修改了 {m.changeSet.files.length} 个文件</span>
                            </div>
                            <div className="file-modifications-list">
                              {m.changeSet.files.map((fileModification) => {
                                const stats = {
                                  additions: fileModification.modifications.filter(mod => mod.type === 'add').length,
                                  deletions: fileModification.modifications.filter(mod => mod.type === 'delete').length,
                                  modifications: fileModification.modifications.filter(mod => mod.type === 'modify').length,
                                }
                                return (
                                  <div
                                    key={fileModification.filePath}
                                    className="file-modification-item"
                                    onClick={() => onOpenDiffView(m.changeSet!.id)}
                                    title="点击查看差异"
                                  >
                                    <div className="file-modification-name">
                                      <span className="file-icon">📄</span>
                                      <span className="file-name">{fileModification.filePath.split('/').pop()}</span>
                                    </div>
                                    <div className="file-modification-path">{fileModification.filePath}</div>
                                    <div className="file-modification-stats">
                                      {stats.additions > 0 && <span className="stat-add">+{stats.additions}</span>}
                                      {stats.deletions > 0 && <span className="stat-delete">-{stats.deletions}</span>}
                                      {stats.modifications > 0 && <span className="stat-modify">~{stats.modifications}</span>}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                        {m.role === 'assistant' && m.content ? (
                          <div className="ai-actions">
                            <button className="icon-button" disabled={!activeFile} onClick={() => insertAtCursor(m.content)} title="插入">
                              ↵
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <div className="ai-input-area">
                  <div className="ai-actions" style={{ marginBottom: 6, justifyContent: 'flex-start', gap: 10 }}>
                    <button className="icon-button" disabled={!activeFile} onClick={() => onQuoteSelection()} title="引用选区">
                      ❝
                    </button>
                    <button className="icon-button" disabled={!activeFile} onClick={() => void onSmartComplete()} title="智能补全">
                      ⚡
                    </button>
                    <div style={{ flex: 1 }} />
                    <button className="primary-button" disabled={busy || !chatInput.trim()} onClick={() => void onSendChat()}>
                      发送
                    </button>
                  </div>
                  <textarea
                    ref={chatInputRef}
                    className="ai-textarea"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault()
                        void onSendChat()
                      }
                    }}
                    placeholder="输入指令..."
                  />
                </div>
              </>
            ) : null}

            {activeRightTab === 'graph' ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="ai-header" style={{ justifyContent: 'center' }}>
                  <button className="icon-button" onClick={() => void loadGraph()}>
                    ↻ 刷新图谱
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  <canvas ref={graphCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                </div>
                <div style={{ padding: 10, fontSize: 11, color: '#666', textAlign: 'center' }}>
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

            {activeRightTab === 'spec-kit' ? (
              <SpecKitLintPanel text={activeFile?.content ?? ''} enabled={!!activeFile} />
            ) : null}
          </aside>
        ) : null}

        <div className="right-activity-bar">
          <div
            className={`right-activity-item ${activeRightTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveRightTab(activeRightTab === 'chat' ? null : 'chat')}
            title="对话"
          >
            💬
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'graph' ? 'active' : ''}`}
            onClick={() => {
              setActiveRightTab(activeRightTab === 'graph' ? null : 'graph')
              if (activeRightTab !== 'graph') void loadGraph()
            }}
            title="图谱"
          >
            🕸️
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'writing-goal' ? 'active' : ''}`}
            onClick={() => setActiveRightTab(activeRightTab === 'writing-goal' ? null : 'writing-goal')}
            title="写作目标"
          >
            🎯
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'spec-kit' ? 'active' : ''}`}
            onClick={() => setActiveRightTab(activeRightTab === 'spec-kit' ? null : 'spec-kit')}
            title="Spec-Kit 检查"
          >
            🧩
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
                    {changeSet.files.length} file{changeSet.files.length !== 1 ? 's' : ''}
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
                  {diffContext.changeSets.get(activeDiffTab)!.files.map((fileModification) => (
                    <div key={fileModification.filePath} className="diff-panel-file">
                      <DiffView
                        fileModification={fileModification}
                        viewMode={diffContext.viewMode}
                        onAccept={(modId) => onAcceptModification(activeDiffTab, modId)}
                        onReject={(modId) => onRejectModification(activeDiffTab, modId)}
                        onAcceptAll={() => onAcceptAllModifications(activeDiffTab)}
                        onRejectAll={() => onRejectAllModifications(activeDiffTab)}
                      />
                    </div>
                  ))}
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
                <div style={{ padding: 12, color: '#ccc' }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>设置加载失败或尚未加载完成。</div>
                  {settingsError ? <div className="error-text">{settingsError}</div> : null}
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button className="btn btn-secondary" onClick={() => void reloadAppSettings()}>
                      重新加载
                    </button>
                    <button className="primary-button" onClick={() => setShowSettings(false)}>
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-form">
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff', writingMode: 'horizontal-tb' }}>通用</h3>
                  <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <label style={{ flex: 1, writingMode: 'horizontal-tb' }}>Markdown 输出</label>
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
                    <label>章节目标字数</label>
                    <input
                      type="number"
                      value={chapterWordTarget}
                      onChange={(e) => setChapterWordTarget(Number(e.target.value) || 0)}
                      onBlur={() => void saveProjectSettings()}
                    />
                  </div>
                </div>

                {/* Editor Configuration Section */}
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff', writingMode: 'horizontal-tb' }}>编辑器配置</h3>

                  {/* Font Family */}
                  <div className="form-group">
                    <label>字体</label>
                    <select
                      value={editorUserConfig.fontFamily}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ fontFamily: e.target.value })
                      }}
                      style={{
                        padding: '6px 10px',
                        background: '#333',
                        border: '1px solid #555',
                        borderRadius: 4,
                        color: '#fff',
                        fontSize: 13,
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
                      type="range"
                      min="10"
                      max="32"
                      step="1"
                      value={editorUserConfig.fontSize}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ fontSize: Number(e.target.value) })
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Line Height */}
                  <div className="form-group">
                    <label>行高 ({editorUserConfig.lineHeight})</label>
                    <input
                      type="range"
                      min="1.0"
                      max="3.0"
                      step="0.1"
                      value={editorUserConfig.lineHeight}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ lineHeight: Number(e.target.value) })
                      }}
                      style={{ width: '100%' }}
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
                      style={{
                        padding: '6px 10px',
                        background: '#333',
                        border: '1px solid #555',
                        borderRadius: 4,
                        color: '#fff',
                        fontSize: 13,
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
                      style={{
                        padding: '6px 10px',
                        background: '#333',
                        border: '1px solid #555',
                        borderRadius: 4,
                        color: '#fff',
                        fontSize: 13,
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
                      type="range"
                      min="0"
                      max="300"
                      step="10"
                      value={editorUserConfig.autoSaveInterval}
                      onChange={(e) => {
                        editorConfigManager.updateConfig({ autoSaveInterval: Number(e.target.value) })
                      }}
                      style={{ width: '100%' }}
                    />
                    <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                      {editorUserConfig.autoSaveInterval === 0 ? '自动保存已禁用' : `每 ${editorUserConfig.autoSaveInterval} 秒自动保存到本地缓存`}
                    </div>
                  </div>

                  {/* Reset Button */}
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, padding: '6px 12px' }}
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

                {/* Sensitive Word Configuration Section */}
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff', writingMode: 'horizontal-tb' }}>敏感词检测</h3>

                  {/* Enable/Disable Toggle */}
                  <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    <label style={{ flex: 1, writingMode: 'horizontal-tb' }}>启用敏感词检测</label>
                    <input
                      type="checkbox"
                      checked={sensitiveWordEnabled}
                      onChange={(e) => setSensitiveWordEnabled(e.target.checked)}
                    />
                  </div>

                  {/* Custom Words Management */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, color: '#ccc', marginBottom: 6, display: 'block' }}>
                      自定义敏感词词库
                    </label>

                    {/* Add Word Input */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <input
                        type="text"
                        value={newSensitiveWord}
                        onChange={(e) => setNewSensitiveWord(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            onAddSensitiveWord()
                          }
                        }}
                        placeholder="输入敏感词..."
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          background: '#333',
                          border: '1px solid #555',
                          borderRadius: 4,
                          color: '#fff',
                          fontSize: 13,
                        }}
                      />
                      <button
                        className="primary-button"
                        style={{ fontSize: 12, padding: '6px 12px' }}
                        onClick={onAddSensitiveWord}
                        disabled={!newSensitiveWord.trim()}
                      >
                        添加
                      </button>
                    </div>

                    {/* Word List */}
                    <div
                      style={{
                        maxHeight: 200,
                        overflowY: 'auto',
                        background: '#2d2d2d',
                        border: '1px solid #444',
                        borderRadius: 4,
                        padding: 8,
                      }}
                    >
                      {sensitiveWordDictionary.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', textAlign: 'center', padding: 10 }}>
                          暂无自定义敏感词
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {sensitiveWordDictionary.map((word) => (
                            <div
                              key={word}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                background: '#444',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 12,
                                color: '#fff',
                              }}
                            >
                              <span>{word}</span>
                              <button
                                onClick={() => onRemoveSensitiveWord(word)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#ff6b6b',
                                  cursor: 'pointer',
                                  padding: 0,
                                  fontSize: 14,
                                  lineHeight: 1,
                                }}
                                title="删除"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
                      共 {sensitiveWordDictionary.length} 个敏感词
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h3 style={{ fontSize: 14, color: '#fff', margin: 0, writingMode: 'horizontal-tb' }}>模型配置</h3>
                    <button
                      className="primary-button"
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      onClick={() => {
                        setEditingProvider({
                          id: newId(),
                          kind: 'OpenAICompatible',
                          base_url: 'https://api.openai.com/v1',
                          model_name: 'gpt-4o-mini',
                        })
                        setIsNewProvider(true)
                        setShowModelModal(true)
                      }}
                    >
                      + 添加模型
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {appSettings.providers.map((p) => (
                      <div
                        key={p.id}
                        className="provider-item"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#333',
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: appSettings.active_provider_id === p.id ? '1px solid #007acc' : '1px solid transparent',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          if (appSettings.active_provider_id !== p.id) {
                            const prev = appSettings
                            const next = { ...appSettings, active_provider_id: p.id }
                            setAppSettingsState(next)
                            void persistAppSettings(next, prev)
                          }
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                          <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ color: '#888', fontSize: 11 }}>
                            {p.kind} • {p.model_name}
                          </div>
                          <div style={{ color: apiKeyStatus[p.id] ? '#9cdcfe' : '#888', fontSize: 11 }}>
                            API Key：{apiKeyStatus[p.id] ? '已设置' : '未设置'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
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
                              setEditingProvider(p)
                              setIsNewProvider(false)
                              setShowModelModal(true)
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

                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff', writingMode: 'horizontal-tb' }}>智能体管理</h3>

                  {/* Built-in Agents */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>内置智能体</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {agentsList
                        .filter((a) => a.category !== '自定义')
                        .map((a) => (
                          <div
                            key={a.id}
                            className="agent-card"
                            style={{
                              background: '#333',
                              padding: 10,
                              borderRadius: 4,
                              cursor: 'pointer',
                              border: agentEditorId === a.id ? '1px solid #007acc' : '1px solid transparent',
                            }}
                            onClick={() => setAgentEditorId(a.id)}
                          >
                            <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>{a.name}</div>
                            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{a.category}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Custom Agents */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 12, color: '#888' }}>自定义智能体</div>
                      <button
                        className="icon-button"
                        style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #444', borderRadius: 3 }}
                        onClick={() => {
                          const id = newId()
                          const next: Agent = {
                            id,
                            name: '新智能体',
                            category: '自定义',
                            system_prompt: '',
                            temperature: 0.7,
                            max_tokens: 1024,
                          }
                          setAgentsList((prev) => [...prev, next])
                          setAgentEditorId(id)
                        }}
                      >
                        + 创建
                      </button>
                    </div>
                    {agentsList.filter((a) => a.category === '自定义').length === 0 ? (
                      <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', padding: 10, textAlign: 'center', background: '#2d2d2d', borderRadius: 4 }}>
                        暂无自定义智能体
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {agentsList
                          .filter((a) => a.category === '自定义')
                          .map((a) => (
                            <div
                              key={a.id}
                              className="agent-card"
                              style={{
                                background: '#333',
                                padding: 10,
                                borderRadius: 4,
                                cursor: 'pointer',
                                border: agentEditorId === a.id ? '1px solid #007acc' : '1px solid transparent',
                                position: 'relative',
                              }}
                              onClick={() => setAgentEditorId(a.id)}
                            >
                              <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>{a.name}</div>
                              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>自定义</div>
                              {agentEditorId === a.id && (
                                <button
                                  className="icon-button"
                                  style={{ position: 'absolute', top: 6, right: 6, padding: 2, fontSize: 12 }}
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
                    <div style={{ marginTop: 16, borderTop: '1px solid #444', paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 10 }}>
                        编辑: {agentsList.find((a) => a.id === agentEditorId)?.name}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                            className="ai-textarea"
                            placeholder="你是一个..."
                            style={{ height: 120 }}
                            value={agentsList.find((a) => a.id === agentEditorId)?.system_prompt ?? ''}
                            onChange={(e) =>
                              setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, system_prompt: e.target.value } : a)))
                            }
                          />
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
          <div className="modal-content" style={{ width: 450 }} onClick={(e) => e.stopPropagation()}>
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
                  <label>类型</label>
                  <select
                    value={editingProvider.kind ?? 'OpenAICompatible'}
                    onChange={(e) => {
                      const k = e.target.value as ModelProvider['kind']
                      let base = editingProvider.base_url
                      if (k === 'OpenAI') base = 'https://api.openai.com/v1'
                      else if (k === 'Anthropic') base = 'https://api.anthropic.com'
                      else if (k === 'Minimax') base = 'https://api.minimaxi.com/v1'
                      else if (k === 'ZAI') base = 'https://open.bigmodel.cn/api/paas/v4'
                      else if (k === 'Custom') base = ''
                      setEditingProvider((p) => ({ ...p, kind: k, base_url: base }))
                    }}
                  >
                    <option value="OpenAICompatible">OpenAI 兼容 (通用)</option>
                    <option value="OpenAI">OpenAI 官方</option>
                    <option value="Anthropic">Anthropic (Claude)</option>
                    <option value="Minimax">Minimax</option>
                    <option value="ZAI">智谱 (ZAI)</option>
                    <option value="Custom">自定义</option>
                  </select>
                </div>
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
                    placeholder={editingProvider.kind === 'Minimax' ? '例如：MiniMax-M2.1, MiniMax-M2.5' : editingProvider.kind === 'ZAI' ? '例如：glm-4' : '例如：gpt-4o, deepseek-chat'}
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
                disabled={!editingProvider.name || !editingProvider.model_name}
                onClick={() => {
                  if (!appSettings) return
                  void (async () => {
                    const prev = appSettings
                    const rawKey = (editingProvider.api_key ?? '').trim()
                    const pid = editingProvider.id ?? ''
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
                      nextProviders.push({ ...(editingProvider as ModelProvider), api_key: '' })
                    } else {
                      nextProviders = nextProviders.map((p) =>
                        p.id === editingProvider.id ? ({ ...(editingProvider as ModelProvider), api_key: '' } as ModelProvider) : p,
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
        onThemeToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
        onGitClick={() => setActiveSidebarTab('git')}
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
            { id: 'toggleTheme', label: '切换主题', category: '视图', action: () => setTheme(t => t === 'light' ? 'dark' : 'light') },
            { id: 'toggleSidebar', label: '切换侧边栏', category: '视图', shortcut: 'Ctrl+B', action: () => {} },
            { id: 'openSettings', label: '打开设置', category: '设置', shortcut: 'Ctrl+,', action: () => setShowSettings(true) },
            { id: 'aiChat', label: 'AI 对话', category: 'AI', shortcut: 'Ctrl+Shift+L', action: () => {} },
            { id: 'smartComplete', label: '智能补全', category: 'AI', action: () => void onSmartComplete() },
            { id: 'gitCommit', label: 'Git 提交', category: 'Git', action: () => {} },
            { id: 'gitPush', label: 'Git 推送', category: 'Git', action: () => {} },
          ]}
          onClose={() => setShowCommandPalette(false)}
        />
      )}
    </div>
  )
}

export default App
