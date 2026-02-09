import Editor from '@monaco-editor/react'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import type { editor as MonacoEditor } from 'monaco-editor'
import './App.css'
import {
  createFile,
  createDir,
  deleteEntry,
  getAgents,
  getAppSettings,
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
}

type ChatContextMenuState = {
  x: number
  y: number
  message: string
  selection: string
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
  // Activity Bar State
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'git'>('files')
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'graph' | null>('chat')

  // Workspace & Files
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
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
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState | null>(null)
  const streamIdRef = useRef<string | null>(null)
  const assistantIdRef = useRef<string | null>(null)
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  // Settings & Agents
  const [appSettings, setAppSettingsState] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [agentsList, setAgentsList] = useState<Agent[]>([])
  const [agentEditorId, setAgentEditorId] = useState<string>('')

  // Git State
  const [gitItems, setGitItems] = useState<GitStatusItem[]>([])
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([])
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitSelectedPath, setGitSelectedPath] = useState<string | null>(null)
  const [gitDiffText, setGitDiffText] = useState('')
  const [gitError, setGitError] = useState<string | null>(null)

  // Stats & Visuals
  const [chapterWordTarget, setChapterWordTarget] = useState<number>(2000)
  const [writingSeconds, setWritingSeconds] = useState<number>(0)
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
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

  // --- Actions ---

  const refreshTree = useCallback(async () => {
    if (!workspaceRoot) return
    const t = await listWorkspaceTree(6)
    setTree(t)
  }, [workspaceRoot])

  const refreshGit = useCallback(async () => {
    if (!workspaceRoot) return
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
  }, [workspaceRoot])

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
    const raw = JSON.stringify({ chapter_word_target: chapterWordTarget }, null, 2)
    await writeText('.novel/.settings/project.json', raw)
  }, [workspaceRoot, chapterWordTarget])

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
    setError(null)
    setBusy(true)
    try {
      if (!isTauriApp()) {
        const info = await setWorkspace(workspaceInput.trim())
        setWorkspaceRoot(info.root)
      } else {
        const selected = await openFolderDialog()
        if (!selected) {
          setBusy(false)
          return
        }
        const info = await setWorkspace(selected)
        setWorkspaceRoot(info.root)
      }
      const t = await listWorkspaceTree(6)
      setTree(t)
      await refreshGit()
      await loadProjectSettings()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceInput, refreshGit, loadProjectSettings])

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
        const content = await readText(entry.path)
        const next: OpenFile = { path: entry.path, name: entry.name, content, dirty: false }
        setOpenFiles((prev) => [...prev, next])
        setActivePath(entry.path)
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
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [activeFile, refreshTree])

  const onNewChapter = useCallback(async () => {
    if (!workspaceRoot) return
    setError(null)
    setBusy(true)
    try {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fileName = `stories/chapter-${yyyy}${mm}${dd}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.md`
      await createFile(fileName)
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, refreshTree])

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
    const model = editor.getModel?.()
    const sel = editor.getSelection?.()
    if (!model || !sel) return ''
    const text = model.getValueInRange(sel) as string
    return text ?? ''
  }, [])

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor || !text) return
    const sel = editor.getSelection?.()
    if (!sel) return
    editor.executeEdits?.('ai-insert', [{ range: sel, text, forceMoveMarkers: true }])
    editor.focus?.()
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

  const showConfirm = useCallback(async (text: string): Promise<boolean> => {
    if (!isTauriApp()) return window.confirm(text)
    return confirm(text, { title: '确认', kind: 'warning' })
  }, [])

  const showErrorDialog = useCallback(async (text: string) => {
    if (!isTauriApp()) {
      window.alert(text)
      return
    }
    await message(text, { title: '错误', kind: 'error' })
  }, [])

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
    const assistantId = newId()
    const assistant: ChatItem = { id: assistantId, role: 'assistant', content: '', streaming: true }
    const streamId = newId()
    streamIdRef.current = streamId
    assistantIdRef.current = assistantId

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

    const messagesToSend = [...chatMessages, user].map((m) => ({ role: m.role, content: m.content }))
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
    const model = editor?.getModel?.()
    const full: string = model?.getValue?.() ?? activeFile.content
    let snippet = full.slice(Math.max(0, full.length - 1200))
    const pos = editor?.getPosition?.()
    if (pos && model?.getOffsetAt) {
      const offset = model.getOffsetAt(pos)
      snippet = full.slice(Math.max(0, offset - 1200), offset)
    }
    const nearing = chapterWordTarget > 0 && activeCharCount >= Math.floor(chapterWordTarget * 0.9)
    const prompt =
      `续写补全：本章目标字数 ${chapterWordTarget}，当前 ${activeCharCount}。\n` +
      (nearing ? '请开始考虑本章收尾，并给出下一章开头建议。\n' : '请续写下一段（150-300 字）。\n') +
      `上下文：\n${snippet}`
    void onSendChat(prompt)
  }, [activeFile, chapterWordTarget, activeCharCount, onSendChat])

  // --- Effects ---

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
      if (!streamId || streamIdRef.current !== streamId) return
      const token = typeof p.token === 'string' ? p.token : ''
      const assistantId = assistantIdRef.current
      if (!assistantId || !token) return
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `${m.content}${token}` } : m)),
      )
    }).then((u) => unlistenFns.push(u))

    void listen('ai_stream_done', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId || streamIdRef.current !== streamId) return
      const assistantId = assistantIdRef.current
      if (!assistantId) return
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
    }).then((u) => unlistenFns.push(u))

    void listen('ai_error', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId || streamIdRef.current !== streamId) return
      const assistantId = assistantIdRef.current
      if (!assistantId) return
      const message = typeof p.message === 'string' ? p.message : 'AI 调用失败'
      const stage = typeof p.stage === 'string' ? p.stage : ''
      const provider = typeof p.provider === 'string' ? p.provider : ''
      const extra = [provider ? `provider=${provider}` : '', stage ? `stage=${stage}` : ''].filter(Boolean).join(' ')
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
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
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
              <span>资源管理器</span>
              <div style={{ flex: 1 }} />
              {workspaceRoot ? (
                <button className="icon-button" onClick={() => void refreshTree()} title="刷新">
                  ↻
                </button>
              ) : null}
            </div>
            <div className="sidebar-content">
              {workspaceRoot ? (
                <>
                  <div style={{ padding: '10px 20px', fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid #333' }}>
                    {workspaceRoot.split(/[/\\]/).pop()}
                  </div>
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
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="editor-tabs">
          {openFiles.length === 0 ? (
            <div className="editor-tab">无文件</div>
          ) : (
            openFiles.map((f) => (
              <div
                key={f.path}
                className={f.path === activePath ? 'editor-tab active' : 'editor-tab'}
                onClick={() => setActivePath(f.path)}
              >
                {f.name}
                {f.dirty ? ' *' : ''}
                <span
                  style={{ marginLeft: 8 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpenFiles((prev) => prev.filter((p) => p.path !== f.path))
                    if (activePath === f.path) setActivePath(null)
                  }}
                >
                  ×
                </span>
              </div>
            ))
          )}
          <div className="spacer" />
          <button className="icon-button" disabled={!workspaceRoot} onClick={() => void onNewChapter()} title="新建章节">
            +
          </button>
          <button className="icon-button" disabled={!activeFile || !activeFile.dirty} onClick={() => void onSaveActive()} title="保存">
            💾
          </button>
        </div>
        <div className="editor-content">
          {activeFile ? (
            <Editor
              theme="vs-dark"
              language="plaintext"
              value={activeFile.content}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
              }}
              onChange={(v) => {
                const value = v ?? ''
                setOpenFiles((prev) => prev.map((f) => (f.path === activeFile.path ? { ...f, content: value, dirty: true } : f)))
              }}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                fontSize: 14,
                lineNumbers: 'off',
                padding: { top: 16, bottom: 16 },
              }}
              className="markdown-editor"
            />
          ) : (
            <div className="welcome-screen">
              <h1>Novel-IDE</h1>
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
                  <div className="ai-config-row">
                    <select
                      className="ai-select"
                      value={appSettings?.active_agent_id ?? ''}
                      onChange={(e) => {
                        const id = e.target.value
                        setAppSettingsState((prev) => {
                          if (!prev) return prev
                          const next = { ...prev, active_agent_id: id }
                          void setAppSettings(next)
                          return next
                        })
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
                        setAppSettingsState((prev) => {
                          if (!prev) return prev
                          const next = { ...prev, active_provider_id: active }
                          void setAppSettings(next)
                          return next
                        })
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
                        <div className="message-meta">{m.role === 'user' ? '你' : m.streaming ? 'AI...' : 'AI'}</div>
                        <div style={{ whiteSpace: 'pre-wrap' }} onContextMenu={(e) => openChatContextMenu(e, m.content)}>
                          {m.content}
                        </div>
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
        </div>
      </div>
    </div>

      {/* Settings Modal */}
      {showSettings ? (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
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
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>通用</h3>
                  <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <label style={{ flex: 1 }}>Markdown 输出</label>
                    <input
                      type="checkbox"
                      checked={appSettings.output.use_markdown}
                      onChange={(e) =>
                        setAppSettingsState((prev) => (prev ? { ...prev, output: { ...prev.output, use_markdown: e.target.checked } } : prev))
                      }
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

                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h3 style={{ fontSize: 14, color: '#fff', margin: 0 }}>模型配置</h3>
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
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                          <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ color: '#888', fontSize: 11 }}>
                            {p.kind} • {p.model_name}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {appSettings.active_provider_id !== p.id && (
                            <button
                              className="icon-button"
                              title="设为默认"
                              onClick={() => {
                                setAppSettingsState((prev) => {
                                  if (!prev) return prev
                                  const next = { ...prev, active_provider_id: p.id }
                                  void setAppSettings(next)
                                  return next
                                })
                              }}
                            >
                              ★
                            </button>
                          )}
                          <button
                            className="icon-button"
                            title="编辑"
                            onClick={() => {
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
                            onClick={() => {
                              if (!confirm('确定删除该模型配置？')) return
                              setAppSettingsState((prev) => {
                                if (!prev) return prev
                                const nextProviders = prev.providers.filter((x) => x.id !== p.id)
                                // If we deleted the active one, fallback to the first available
                                let nextActive = prev.active_provider_id
                                if (p.id === nextActive) {
                                  nextActive = nextProviders[0]?.id ?? ''
                                }
                                const next = { ...prev, providers: nextProviders, active_provider_id: nextActive }
                                void setAppSettings(next)
                                return next
                              })
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
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>智能体管理</h3>
                  
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
                                    if (!confirm('确定删除此智能体？')) return
                                    setAgentsList((prev) => prev.filter((x) => x.id !== a.id))
                                    setAgentEditorId('')
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
                    void setAppSettings(appSettings)
                    void setAgents(agentsList)
                    setShowSettings(false)
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
                      setEditingProvider((p) => ({ ...p, kind: k, base_url: base }))
                    }}
                  >
                    <option value="OpenAICompatible">OpenAI 兼容 (通用)</option>
                    <option value="OpenAI">OpenAI 官方</option>
                    <option value="Anthropic">Anthropic (Claude)</option>
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
                    placeholder="例如：gpt-4o, deepseek-chat"
                  />
                </div>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editingProvider.api_key ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder="sk-..."
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="primary-button"
                disabled={!editingProvider.name || !editingProvider.model_name}
                onClick={() => {
                  setAppSettingsState((prev) => {
                    if (!prev) return prev
                    let nextProviders = [...prev.providers]
                    if (isNewProvider) {
                      nextProviders.push(editingProvider as ModelProvider)
                    } else {
                      nextProviders = nextProviders.map((p) => (p.id === editingProvider.id ? (editingProvider as ModelProvider) : p))
                    }
                    const next = { ...prev, providers: nextProviders }
                    void setAppSettings(next)
                    return next
                  })
                  setShowModelModal(false)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="status-bar">
        <div className="status-item">字数：{activeCharCount} / {chapterWordTarget}</div>
        <div className="status-item">写作：{writingSeconds}s</div>
        <div className="status-item">Git：{gitError ? '不可用' : `${gitItems.length} 变更`}</div>
        <div className="status-spacer" />
      </div>

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
    </div>
  )
}

export default App
