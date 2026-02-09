import Editor from '@monaco-editor/react'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import './App.css'
import {
  createFile,
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

  // Editors & Refs
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const streamIdRef = useRef<string | null>(null)
  const assistantIdRef = useRef<string | null>(null)
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  // Settings & Agents
  const [appSettings, setAppSettingsState] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
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

  const filteredTree = useMemo(() => {
    const allowTop = new Set(['concept', 'outline', 'stories'])
    const isAllowedPath = (p: string) =>
      p === 'concept' || p === 'outline' || p === 'stories' || p.startsWith('concept/') || p.startsWith('outline/') || p.startsWith('stories/')

    const walk = (e: FsEntry, depth: number): FsEntry | null => {
      if (depth === 1 && e.kind === 'file') return null
      if (depth === 1 && !allowTop.has(e.name)) return null

      if (e.kind === 'file') {
        if (!isAllowedPath(e.path)) return null
        return e.name.toLowerCase().endsWith('.md') ? e : null
      }

      const children = e.children.map((c) => walk(c, depth + 1)).filter(Boolean) as FsEntry[]
      return { ...e, children }
    }

    return tree ? walk(tree, 0) : null
  }, [tree])

  const TreeNode = useCallback(
    function TreeNodeInner({ entry, depth }: { entry: FsEntry; depth: number }) {
      const [open, setOpen] = useState(depth < 1)
      const pad = { paddingLeft: `${depth * 12}px` }
      if (entry.kind === 'file') {
        return (
          <div className="file-tree-item" style={pad} onClick={() => void onOpenFile(entry)}>
            <span className="file-icon file">📄</span>
            {entry.name}
          </div>
        )
      }
      return (
        <div>
          <div className="file-tree-item" style={pad} onClick={() => setOpen((v) => !v)}>
            <span className="file-icon">{open ? '📂' : '📁'}</span>
            {entry.name}
          </div>
          {open && entry.children.map((c) => <TreeNodeInner key={c.path} entry={c} depth={depth + 1} />)}
        </div>
      )
    },
    [onOpenFile],
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
    void getAppSettings()
      .then((s) => setAppSettingsState(s))
      .catch(() => setAppSettingsState(null))
    void getAgents()
      .then((list) => {
        setAgentsList(list)
        setAgentEditorId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => setAgentsList([]))
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return
    const unlistenFns: Array<() => void> = []
    void listen('ai_stream_token', (event) => {
      const payload: unknown = event.payload
      if (!payload || typeof payload !== 'object') return
      const p = payload as Record<string, unknown>
      const streamId = typeof p.streamId === 'string' ? p.streamId : undefined
      if (!streamId || streamIdRef.current !== streamId) return
      const token = typeof p.token === 'string' ? p.token : ''
      const assistantId = assistantIdRef.current
      if (!assistantId || !token) return
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `${m.content}${token}` } : m)),
      )
    }).then((u) => unlistenFns.push(u))

    void listen('ai_stream_done', (event) => {
      const payload: unknown = event.payload
      if (!payload || typeof payload !== 'object') return
      const p = payload as Record<string, unknown>
      const streamId = typeof p.streamId === 'string' ? p.streamId : undefined
      if (!streamId || streamIdRef.current !== streamId) return
      const assistantId = assistantIdRef.current
      if (!assistantId) return
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
    }).then((u) => unlistenFns.push(u))

    return () => {
      for (const u of unlistenFns) u()
    }
  }, [])

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
          <div className="activity-bar-item" onClick={() => setShowSettings(true)} title="设置">
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
                  {filteredTree ? <TreeNode entry={filteredTree} depth={0} /> : <div style={{ padding: 10 }}>加载中...</div>}
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
                      value={appSettings?.providers.active ?? 'openai'}
                      onChange={(e) => {
                        setAppSettingsState((prev) => (prev ? { ...prev, providers: { ...prev.providers, active: e.target.value } } : prev))
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="claude">Claude</option>
                      <option value="wenxin">文心一言</option>
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
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
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
      {showSettings && appSettings ? (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
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
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>模型配置</h3>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    {['openai', 'claude', 'wenxin'].map((p) => (
                      <button
                        key={p}
                        className={appSettings.providers.active === p ? 'primary-button' : 'btn btn-secondary'}
                        onClick={() =>
                          setAppSettingsState((prev) => (prev ? { ...prev, providers: { ...prev.providers, active: p } } : prev))
                        }
                      >
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {appSettings.providers.active === 'openai' && (
                    <>
                      <div className="form-group">
                        <label>Base URL</label>
                        <input
                          value={appSettings.providers.openai.base_url}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    providers: { ...prev.providers, openai: { ...prev.providers.openai, base_url: e.target.value } },
                                  }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>Model</label>
                        <input
                          value={appSettings.providers.openai.model}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, openai: { ...prev.providers.openai, model: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>API Key</label>
                        <input
                          type="password"
                          value={appSettings.providers.openai.api_key}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, openai: { ...prev.providers.openai, api_key: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                  {appSettings.providers.active === 'claude' && (
                    <>
                      <div className="form-group">
                        <label>Model</label>
                        <input
                          value={appSettings.providers.claude.model}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, claude: { ...prev.providers.claude, model: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>API Key</label>
                        <input
                          type="password"
                          value={appSettings.providers.claude.api_key}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, claude: { ...prev.providers.claude, api_key: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                  {appSettings.providers.active === 'wenxin' && (
                    <>
                      <div className="form-group">
                        <label>Base URL</label>
                        <input
                          value={appSettings.providers.wenxin.base_url}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, base_url: e.target.value } },
                                  }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>Model</label>
                        <input
                          value={appSettings.providers.wenxin.model}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, model: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>API Key</label>
                        <input
                          type="password"
                          value={appSettings.providers.wenxin.api_key}
                          onChange={(e) =>
                            setAppSettingsState((prev) =>
                              prev
                                ? { ...prev, providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, api_key: e.target.value } } }
                                : prev,
                            )
                          }
                        />
                      </div>
                    </>
                  )}
                </div>

                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>智能体管理</h3>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <select
                      className="ai-select"
                      style={{ flex: 1 }}
                      value={agentEditorId}
                      onChange={(e) => setAgentEditorId(e.target.value)}
                    >
                      <option value="">-- 选择编辑 --</option>
                      {agentsList.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.category} / {a.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-button"
                      style={{ border: '1px solid #333' }}
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
                      +
                    </button>
                    {agentEditorId && (
                      <button
                        className="icon-button"
                        style={{ border: '1px solid #333' }}
                        onClick={() => {
                          setAgentsList((prev) => prev.filter((a) => a.id !== agentEditorId))
                          setAgentEditorId('')
                        }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                  {agentEditorId && agentsList.find((a) => a.id === agentEditorId) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <input
                        className="ai-select"
                        placeholder="名称"
                        value={agentsList.find((a) => a.id === agentEditorId)?.name ?? ''}
                        onChange={(e) =>
                          setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, name: e.target.value } : a)))
                        }
                      />
                      <textarea
                        className="ai-textarea"
                        placeholder="系统提示词 (System Prompt)"
                        style={{ height: 120 }}
                        value={agentsList.find((a) => a.id === agentEditorId)?.system_prompt ?? ''}
                        onChange={(e) =>
                          setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, system_prompt: e.target.value } : a)))
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
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
            </div>
          </div>
        </div>
      ) : null}

      <div className="status-bar">
        <div className="status-item">字数：{activeCharCount} / {chapterWordTarget}</div>
        <div className="status-item">写作：{writingSeconds}s</div>
        <div className="status-item">Git：{gitError ? '不可用' : `${gitItems.length} 变更`}</div>
        <div className="status-spacer" />
      </div>
    </div>
  )
}

export default App
