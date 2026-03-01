import { invoke } from '@tauri-apps/api/core'
import { createDir, readText, writeText, type FsEntry } from '../tauri'

export type WriterMode = 'normal' | 'plan' | 'spec'
export type TaskStatus = 'todo' | 'running' | 'blocked' | 'done' | 'retry'

export interface NovelTask {
  id: string
  title: string
  status: TaskStatus
  priority: 'low' | 'medium' | 'high'
  depends_on: string[]
  target_words: number
  scope: string
  volume: number
  chapter_index: number
  acceptance_checks: string[]
  arc_targets: string[]
  foreshadow_refs: string[]
  timeline_window: string
  task_prompt: string
  retries: number
  last_error?: string
  completed_at?: string
}

export interface SessionPlannerState {
  session_id: string
  mode: WriterMode
  auto_run: boolean
  current_task_id: string | null
  updated_at: string
  last_error: string | null
}

type SessionPlannerStore = {
  sessions: Record<string, SessionPlannerState>
}

type BuildPlanOptions = {
  instruction?: string
  targetWords: number
  chapterWordTarget: number
}

type BuildTasksOptions = {
  mode: WriterMode
  targetWords: number
  chapterWordTarget: number
}

export type RunQueueState = {
  mode: WriterMode | null
  tasks: NovelTask[]
}

export type PlannerContextPack = {
  mode: WriterMode
  activePath: string | null
  summary: string
  references: string[]
}

const PLANS_DIR = '.novel/plans'
const TASKS_DIR = '.novel/tasks'
const STATE_DIR = '.novel/state'
const MASTER_PLAN_PATH = '.novel/plans/master-plan.md'
const MASTER_TASKS_PATH = '.novel/tasks/master-tasks.md'
const RUN_QUEUE_PATH = '.novel/tasks/run-queue.md'
const SESSION_STATE_PATH = '.novel/state/session-state.json'
const CONTINUITY_INDEX_PATH = '.novel/state/continuity-index.md'

const MAX_CONTEXT_CHARS_PER_FILE = 2200

function utcNow(): string {
  return new Date().toISOString()
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function cleanMarkdown(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('```')) return text
  const lines = text.split('\n')
  if (lines.length <= 2) return text
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (first.startsWith('```') && last.trim() === '```') {
    return lines.slice(1, -1).join('\n').trim()
  }
  return text
}

function toJsonFrontMatter(meta: Record<string, unknown>, body: string): string {
  const safeBody = body.trim()
  return `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${safeBody}\n`
}

function parseJsonFrontMatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: raw }
  }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) {
    return { meta: {}, body: raw }
  }
  const headerRaw = normalized.slice(4, end).trim()
  const body = normalized.slice(end + 5).trim()
  if (!headerRaw) {
    return { meta: {}, body }
  }
  try {
    const parsed: unknown = JSON.parse(headerRaw)
    if (isRecord(parsed)) {
      return { meta: parsed, body }
    }
    return { meta: {}, body }
  } catch {
    return { meta: {}, body }
  }
}

function sanitizeTask(v: unknown): NovelTask | null {
  if (!isRecord(v)) return null
  const id = typeof v.id === 'string' ? v.id.trim() : ''
  const title = typeof v.title === 'string' ? v.title.trim() : ''
  if (!id || !title) return null
  const statusRaw = typeof v.status === 'string' ? v.status : 'todo'
  const status: TaskStatus =
    statusRaw === 'running' || statusRaw === 'blocked' || statusRaw === 'done' || statusRaw === 'retry'
      ? statusRaw
      : 'todo'
  const priorityRaw = typeof v.priority === 'string' ? v.priority : 'medium'
  const priority: 'low' | 'medium' | 'high' =
    priorityRaw === 'low' || priorityRaw === 'high' ? priorityRaw : 'medium'
  const dependsOn = Array.isArray(v.depends_on) ? v.depends_on.filter((x): x is string => typeof x === 'string') : []
  const checks = Array.isArray(v.acceptance_checks)
    ? v.acceptance_checks.filter((x): x is string => typeof x === 'string')
    : []
  const targetWordsRaw = Number(v.target_words)
  const targetWords = Number.isFinite(targetWordsRaw) ? Math.max(500, Math.round(targetWordsRaw)) : 2000
  const scope = typeof v.scope === 'string' && v.scope.trim() ? v.scope.trim() : `stories/${id}.md`
  const volumeRaw = Number(v.volume)
  const volume = Number.isFinite(volumeRaw) ? Math.max(1, Math.floor(volumeRaw)) : 1
  const chapterIndexRaw = Number(v.chapter_index)
  const chapterIndex = Number.isFinite(chapterIndexRaw) ? Math.max(1, Math.floor(chapterIndexRaw)) : 1
  const prompt = typeof v.task_prompt === 'string' ? v.task_prompt.trim() : ''
  const retriesRaw = Number(v.retries)
  const retries = Number.isFinite(retriesRaw) ? Math.max(0, Math.floor(retriesRaw)) : 0
  const lastError = typeof v.last_error === 'string' ? v.last_error : undefined
  const completedAt = typeof v.completed_at === 'string' ? v.completed_at : undefined
  const arcTargets = Array.isArray(v.arc_targets) ? v.arc_targets.filter((x): x is string => typeof x === 'string') : []
  const foreshadowRefs = Array.isArray(v.foreshadow_refs)
    ? v.foreshadow_refs.filter((x): x is string => typeof x === 'string')
    : []
  const timelineWindow = typeof v.timeline_window === 'string' ? v.timeline_window : 'global'
  return {
    id,
    title,
    status,
    priority,
    depends_on: dependsOn,
    target_words: targetWords,
    scope,
    volume,
    chapter_index: chapterIndex,
    acceptance_checks: checks,
    arc_targets: arcTargets,
    foreshadow_refs: foreshadowRefs,
    timeline_window: timelineWindow,
    task_prompt: prompt,
    retries,
    last_error: lastError,
    completed_at: completedAt,
  }
}

function serializeTaskList(mode: WriterMode, tasks: NovelTask[], docId: string, title: string): string {
  const meta = {
    id: docId,
    mode,
    updated_at: utcNow(),
    total: tasks.length,
    tasks,
  }
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`总任务数：${tasks.length}`)
  lines.push('')
  for (const task of tasks) {
    const checked = task.status === 'done' ? 'x' : ' '
    lines.push(`- [${checked}] ${task.id} ${task.title} (${task.scope}, ${task.target_words}字, ${task.status})`)
  }
  return toJsonFrontMatter(meta, lines.join('\n'))
}

function parseTaskListDocument(raw: string): RunQueueState {
  const { meta } = parseJsonFrontMatter(raw)
  const modeRaw = typeof meta.mode === 'string' ? meta.mode : ''
  const mode: WriterMode | null = modeRaw === 'normal' || modeRaw === 'plan' || modeRaw === 'spec' ? modeRaw : null
  const rawTasks = Array.isArray(meta.tasks) ? meta.tasks : []
  const tasks = rawTasks.map(sanitizeTask).filter((v): v is NovelTask => v !== null)
  return { mode, tasks }
}

function collectStoryFiles(entry: FsEntry | null, out: string[]): void {
  if (!entry) return
  if (entry.kind === 'file') {
    const path = entry.path.replace(/\\/g, '/')
    if (path.startsWith('stories/') && (path.endsWith('.md') || path.endsWith('.txt'))) {
      out.push(path)
    }
    return
  }
  for (const child of entry.children) {
    collectStoryFiles(child, out)
  }
}

function extractPlanSummary(planMarkdown: string): string {
  const { body } = parseJsonFrontMatter(planMarkdown)
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/^#+\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return normalized.slice(0, 2800)
}

function buildFallbackPlan(mode: WriterMode, targetWords: number, chapterWordTarget: number, instruction: string): string {
  const chapterCount = Math.max(12, Math.ceil(targetWords / Math.max(800, chapterWordTarget)))
  const modeName = mode === 'spec' ? 'Spec' : 'Plan'
  const lines: string[] = []
  lines.push(`# ${modeName} 小说设计文档`)
  lines.push('')
  lines.push('## 项目目标')
  lines.push(`- 总字数目标：${targetWords.toLocaleString()} 字`)
  lines.push(`- 章节目标：约 ${chapterCount} 章（每章约 ${chapterWordTarget} 字）`)
  lines.push(`- 创作说明：${instruction || '围绕核心冲突推进，保持叙事连贯。'}`)
  lines.push('')
  lines.push('## 核心主线')
  lines.push('- 主角在稳定世界中遭遇不可逆转的冲突。')
  lines.push('- 通过阶段性失败和代价升级，推动人物成长。')
  lines.push('- 在结尾兑现伏笔并完成主题表达。')
  lines.push('')
  lines.push('## 三幕结构')
  lines.push('### 第一幕（建立）')
  lines.push('- 建立世界规则、角色欲望、初始关系。')
  lines.push('- 引发事件迫使主角离开舒适区。')
  lines.push('### 第二幕（对抗）')
  lines.push('- 冲突升级，主副线交叉推进。')
  lines.push('- 中点反转后，目标与代价重新定义。')
  lines.push('### 第三幕（收束）')
  lines.push('- 高潮对决与关键选择。')
  lines.push('- 伏笔回收、角色弧线完成、主题落地。')
  lines.push('')
  lines.push('## 角色弧线')
  lines.push('- 主角：从回避责任到主动承担。')
  lines.push('- 伙伴：从功利合作到价值共鸣。')
  lines.push('- 对手：由外部压迫转为价值镜像。')
  lines.push('')
  lines.push('## 伏笔池')
  lines.push('- 早期埋设：关键道具、失踪档案、被误读的预言。')
  lines.push('- 中期强化：身份错位、立场反转、规则漏洞。')
  lines.push('- 后期回收：真相揭示、代价兑现、情感闭环。')
  return lines.join('\n')
}

function makeTaskPrompt(mode: WriterMode, task: NovelTask, chapterNumber: number): string {
  const scope = task.scope
  const checks = task.acceptance_checks.map((v) => `- ${v}`).join('\n')
  const arcTargets = task.arc_targets.length > 0 ? task.arc_targets.join('，') : '主线推进'
  const foreshadowRefs = task.foreshadow_refs.length > 0 ? task.foreshadow_refs.join('，') : '无'
  const modeInstruction =
    mode === 'spec'
      ? '你在 Spec 模式，必须严格按照任务约束写作，并主动修改目标文件。'
      : '你在 Plan 模式，按粗纲推进剧情，保持节奏和连贯性。'
  return [
    `${modeInstruction}`,
    '',
    `任务ID：${task.id}`,
    `任务标题：${task.title}`,
    `目标文件：${scope}`,
    `卷号：${task.volume}，章节序号：${task.chapter_index}`,
    `目标字数：${task.target_words}`,
    `弧线目标：${arcTargets}`,
    `伏笔引用：${foreshadowRefs}`,
    `时间窗口：${task.timeline_window}`,
    '',
    '必须执行：',
    `1. 如文件不存在请先创建，再写入完整章节文本（章节号建议使用第${chapterNumber}章）。`,
    '2. 使用工具主动修改文件，不要只给建议。',
    '3. 保持与既有设定一致，避免时间线与角色动机冲突。',
    '4. 在文本结尾加入下一章钩子。',
    '',
    '质量门槛（平衡）：',
    checks || '- 角色动机一致\n- 时间线连续\n- 与上一章衔接自然',
    '',
    '完成后请只做两件事：',
    '1. 输出一句“TASK_DONE: <task_id>”。',
    '2. 用 2-3 句总结本章推进点。',
    '',
    '任务详细说明：',
    task.task_prompt || task.title,
  ].join('\n')
}

export class NovelPlannerService {
  private async readOptional(path: string): Promise<string> {
    try {
      return await readText(path)
    } catch {
      return ''
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const raw = JSON.stringify(value, null, 2)
    await writeText(path, raw)
  }

  async ensurePlannerWorkspace(): Promise<void> {
    await createDir(PLANS_DIR)
    await createDir(TASKS_DIR)
    await createDir(STATE_DIR)
    const sessionState = await this.readOptional(SESSION_STATE_PATH)
    if (!sessionState.trim()) {
      await this.writeJson(SESSION_STATE_PATH, { sessions: {} } satisfies SessionPlannerStore)
    }
    const continuity = await this.readOptional(CONTINUITY_INDEX_PATH)
    if (!continuity.trim()) {
      const initial = [
        '# Continuity Index',
        '',
        '用于记录角色、时间线、伏笔回收等连续性信息。',
      ].join('\n')
      await writeText(CONTINUITY_INDEX_PATH, initial)
    }
  }

  private async loadSessionStore(): Promise<SessionPlannerStore> {
    await this.ensurePlannerWorkspace()
    const raw = await this.readOptional(SESSION_STATE_PATH)
    if (!raw.trim()) return { sessions: {} }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed) && isRecord(parsed.sessions)) {
        const sessions: Record<string, SessionPlannerState> = {}
        for (const [key, value] of Object.entries(parsed.sessions)) {
          if (!isRecord(value)) continue
          const modeRaw = typeof value.mode === 'string' ? value.mode : 'normal'
          const mode: WriterMode = modeRaw === 'plan' || modeRaw === 'spec' ? modeRaw : 'normal'
          sessions[key] = {
            session_id: key,
            mode,
            auto_run: typeof value.auto_run === 'boolean' ? value.auto_run : mode !== 'normal',
            current_task_id: typeof value.current_task_id === 'string' ? value.current_task_id : null,
            updated_at: typeof value.updated_at === 'string' ? value.updated_at : utcNow(),
            last_error: typeof value.last_error === 'string' ? value.last_error : null,
          }
        }
        return { sessions }
      }
      return { sessions: {} }
    } catch {
      return { sessions: {} }
    }
  }

  private async saveSessionStore(store: SessionPlannerStore): Promise<void> {
    await this.writeJson(SESSION_STATE_PATH, store)
  }

  async getSessionState(sessionId: string): Promise<SessionPlannerState> {
    const store = await this.loadSessionStore()
    const existing = store.sessions[sessionId]
    if (existing) return existing
    const next: SessionPlannerState = {
      session_id: sessionId,
      mode: 'normal',
      auto_run: false,
      current_task_id: null,
      updated_at: utcNow(),
      last_error: null,
    }
    store.sessions[sessionId] = next
    await this.saveSessionStore(store)
    return next
  }

  async setSessionMode(sessionId: string, mode: WriterMode): Promise<SessionPlannerState> {
    const store = await this.loadSessionStore()
    const prev = store.sessions[sessionId]
    const next: SessionPlannerState = {
      session_id: sessionId,
      mode,
      auto_run: mode === 'normal' ? false : (prev?.auto_run ?? true),
      current_task_id: prev?.current_task_id ?? null,
      updated_at: utcNow(),
      last_error: null,
    }
    store.sessions[sessionId] = next
    await this.saveSessionStore(store)
    return next
  }

  async setSessionAutoRun(sessionId: string, autoRun: boolean): Promise<SessionPlannerState> {
    const store = await this.loadSessionStore()
    const prev = store.sessions[sessionId] ?? (await this.getSessionState(sessionId))
    const next: SessionPlannerState = {
      ...prev,
      auto_run: autoRun,
      updated_at: utcNow(),
    }
    store.sessions[sessionId] = next
    await this.saveSessionStore(store)
    return next
  }

  async setSessionTaskPointer(sessionId: string, taskId: string | null, lastError: string | null): Promise<void> {
    const store = await this.loadSessionStore()
    const prev = store.sessions[sessionId] ?? (await this.getSessionState(sessionId))
    store.sessions[sessionId] = {
      ...prev,
      current_task_id: taskId,
      last_error: lastError,
      updated_at: utcNow(),
    }
    await this.saveSessionStore(store)
  }

  async readMasterPlan(): Promise<string> {
    await this.ensurePlannerWorkspace()
    return this.readOptional(MASTER_PLAN_PATH)
  }

  async ensureMasterPlan(mode: WriterMode, options: BuildPlanOptions): Promise<string> {
    const existing = await this.readMasterPlan()
    if (existing.trim()) {
      const parsed = parseJsonFrontMatter(existing)
      const existingMode = typeof parsed.meta.mode === 'string' ? parsed.meta.mode : ''
      if (existingMode === mode) {
        return existing
      }
    }
    return this.generateMasterPlan(mode, options)
  }

  async generateMasterPlan(mode: WriterMode, options: BuildPlanOptions): Promise<string> {
    await this.ensurePlannerWorkspace()
    const instruction = (options.instruction || '').trim()
    const prompt = [
      `你是小说总编剧。请输出一份可执行的${mode === 'spec' ? '超详细' : '阶段化'}小说设计文档（Markdown）。`,
      '要求：',
      `- 总字数目标：${options.targetWords}`,
      `- 章节目标字数：${options.chapterWordTarget}`,
      '- 必须包含：核心主题、主线冲突、三幕/多幕结构、角色弧线、伏笔清单、阶段目标。',
      mode === 'spec' ? '- 需要支持百万字长篇规划，分卷分阶段说明。' : '- 粗纲层级清晰，便于按阶段写作。',
      instruction ? `- 用户补充：${instruction}` : '',
      '请直接输出 Markdown，不要输出 JSON，不要解释。',
    ]
      .filter(Boolean)
      .join('\n')

    let body = ''
    try {
      const generated = await invoke<string>('ai_assistance_generate', { prompt })
      body = cleanMarkdown(generated)
    } catch {
      body = ''
    }
    if (!body.trim()) {
      body = buildFallbackPlan(mode, options.targetWords, options.chapterWordTarget, instruction)
    }

    const markdown = toJsonFrontMatter(
      {
        id: 'master-plan',
        mode,
        status: 'active',
        target_words: options.targetWords,
        chapter_word_target: options.chapterWordTarget,
        updated_at: utcNow(),
      },
      body,
    )
    await writeText(MASTER_PLAN_PATH, markdown)
    return markdown
  }

  private buildDefaultTasks(options: BuildTasksOptions, planSummary: string): NovelTask[] {
    const safeTargetWords = Math.max(20000, Math.round(options.targetWords))
    const safeChapterWords = clamp(Math.round(options.chapterWordTarget || 2000), 800, 12000)
    const estimatedChapters = Math.max(12, Math.ceil(safeTargetWords / safeChapterWords))
    const taskCount =
      options.mode === 'spec'
        ? clamp(estimatedChapters, 24, 800)
        : clamp(Math.ceil(estimatedChapters / 2), 12, 240)
    const wordsPerTask = Math.max(1200, Math.round(safeTargetWords / taskCount))
    const arcNames =
      options.mode === 'spec'
        ? ['起势', '扩张', '裂变', '反噬', '重组', '决战', '余波']
        : ['开端', '发展', '转折', '高潮', '收束']
    const volumeTargetWords = 120000
    const volumeCount = options.mode === 'spec' ? clamp(Math.ceil(safeTargetWords / volumeTargetWords), 2, 40) : 1
    const chaptersPerVolume = Math.max(1, Math.ceil(taskCount / volumeCount))

    const tasks: NovelTask[] = []
    for (let i = 0; i < taskCount; i += 1) {
      const id = `task-${String(i + 1).padStart(4, '0')}`
      const prevId = i > 0 ? `task-${String(i).padStart(4, '0')}` : null
      const arc = arcNames[i % arcNames.length]
      const chapterNo = i + 1
      const volume = options.mode === 'spec' ? Math.min(volumeCount, Math.floor(i / chaptersPerVolume) + 1) : 1
      const chapterInVolume = options.mode === 'spec' ? i - (volume - 1) * chaptersPerVolume + 1 : chapterNo
      const title = options.mode === 'spec' ? `卷${volume}·第${chapterInVolume}章·${arc}` : `阶段${chapterNo}·${arc}`
      const scope =
        options.mode === 'spec'
          ? `stories/vol-${String(volume).padStart(2, '0')}/chapter-${String(chapterNo).padStart(4, '0')}.md`
          : `stories/chapter-${String(chapterNo).padStart(4, '0')}.md`
      const isVolumeEnd = options.mode === 'spec' && (chapterInVolume === chaptersPerVolume || chapterNo === taskCount)
      const arcTargets =
        options.mode === 'spec'
          ? [`主线-${arc}`, isVolumeEnd ? `卷${volume}阶段收束` : `卷${volume}推进`]
          : [`主线-${arc}`]
      const foreshadowRefs =
        options.mode === 'spec'
          ? [`伏笔-${String(volume).padStart(2, '0')}-${String(chapterInVolume).padStart(2, '0')}`]
          : []
      const task: NovelTask = {
        id,
        title,
        status: 'todo',
        priority: i < 3 ? 'high' : 'medium',
        depends_on: prevId ? [prevId] : [],
        target_words: wordsPerTask,
        scope,
        volume,
        chapter_index: chapterNo,
        acceptance_checks: [
          '角色动机连续',
          '时间线不冲突',
          '与上一任务衔接自然',
          '结尾保留下一章钩子',
        ],
        arc_targets: arcTargets,
        foreshadow_refs: foreshadowRefs,
        timeline_window: options.mode === 'spec' ? `vol-${String(volume).padStart(2, '0')}` : 'global',
        task_prompt: [
          `本任务属于“${arc}”阶段，目标是推进主线并落实人物弧线。`,
          options.mode === 'spec' ? `当前为卷 ${volume} 的章节任务（卷内序号 ${chapterInVolume}）。` : '',
          `计划摘要（节选）：${planSummary.slice(0, 360) || '暂无摘要'}`,
          options.mode === 'spec' ? '请包含至少一个伏笔推进或回收动作。' : '保持阶段节奏，不要跳过关键冲突。',
          isVolumeEnd ? '这是卷末节点，需要形成阶段性冲突闭环并抛出新悬念。' : '',
        ].join('\n'),
        retries: 0,
      }
      tasks.push(task)
    }
    return tasks
  }

  async generateTasksFromPlan(options: BuildTasksOptions): Promise<NovelTask[]> {
    await this.ensurePlannerWorkspace()
    const planRaw = await this.readMasterPlan()
    const planSummary = extractPlanSummary(planRaw)
    const tasks = this.buildDefaultTasks(options, planSummary)
    await writeText(MASTER_TASKS_PATH, serializeTaskList(options.mode, tasks, 'master-tasks', 'Master Tasks'))
    await writeText(RUN_QUEUE_PATH, serializeTaskList(options.mode, tasks, 'run-queue', 'Run Queue'))
    return tasks
  }

  async loadRunQueue(): Promise<NovelTask[]> {
    const state = await this.loadRunQueueState()
    return state.tasks
  }

  async loadRunQueueState(): Promise<RunQueueState> {
    await this.ensurePlannerWorkspace()
    const raw = await this.readOptional(RUN_QUEUE_PATH)
    if (!raw.trim()) return { mode: null, tasks: [] }
    return parseTaskListDocument(raw)
  }

  async saveRunQueue(mode: WriterMode, tasks: NovelTask[]): Promise<void> {
    await this.ensurePlannerWorkspace()
    await writeText(RUN_QUEUE_PATH, serializeTaskList(mode, tasks, 'run-queue', 'Run Queue'))
  }

  getNextExecutableTask(tasks: NovelTask[]): NovelTask | null {
    const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id))
    for (const task of tasks) {
      if (task.status !== 'todo' && task.status !== 'retry') continue
      if (task.depends_on.every((dep) => done.has(dep))) {
        return task
      }
    }
    return null
  }

  async updateTask(
    mode: WriterMode,
    taskId: string,
    updater: (task: NovelTask) => NovelTask,
  ): Promise<NovelTask[]> {
    const tasks = await this.loadRunQueue()
    const next = tasks.map((task) => (task.id === taskId ? updater(task) : task))
    await this.saveRunQueue(mode, next)
    return next
  }

  async appendContinuityEntry(task: NovelTask, summary: string): Promise<void> {
    await this.ensurePlannerWorkspace()
    const old = await this.readOptional(CONTINUITY_INDEX_PATH)
    const line = `- ${new Date().toLocaleString()} [${task.id}] ${task.title}: ${summary.trim()}`
    const next = old.trim() ? `${old.trim()}\n${line}\n` : `# Continuity Index\n\n${line}\n`
    await writeText(CONTINUITY_INDEX_PATH, next)
  }

  async buildModeContext(mode: WriterMode, tree: FsEntry | null, activePath: string | null): Promise<PlannerContextPack> {
    const storyFiles: string[] = []
    collectStoryFiles(tree, storyFiles)
    storyFiles.sort((a, b) => a.localeCompare(b))

    const references: string[] = []
    if (activePath && storyFiles.includes(activePath)) {
      const idx = storyFiles.indexOf(activePath)
      for (let i = Math.max(0, idx - 2); i <= Math.min(storyFiles.length - 1, idx + 2); i += 1) {
        references.push(storyFiles[i])
      }
    } else if (storyFiles.length > 0) {
      references.push(...storyFiles.slice(-3))
    }

    if (mode !== 'normal') {
      references.push(MASTER_PLAN_PATH)
    }
    if (mode === 'spec') {
      references.push(RUN_QUEUE_PATH)
    }
    references.push('concept/characters.md', 'concept/relations.md', 'outline/outline.md', CONTINUITY_INDEX_PATH)

    const deduped = Array.from(new Set(references))
    const snippets: string[] = []
    for (const path of deduped) {
      const raw = await this.readOptional(path)
      if (!raw.trim()) continue
      snippets.push(`### ${path}\n${raw.trim().slice(0, MAX_CONTEXT_CHARS_PER_FILE)}`)
    }
    const summary = snippets.join('\n\n')
    return {
      mode,
      activePath,
      summary,
      references: deduped,
    }
  }

  buildModePrompt(mode: WriterMode, userInput: string, context: PlannerContextPack, activePath: string | null): string {
    const modeHeader =
      mode === 'normal'
        ? '写作模式：Normal（无大纲）'
        : mode === 'plan'
          ? '写作模式：Plan（粗纲驱动）'
          : '写作模式：Spec（粗纲 + 细纲任务驱动）'
    const constraints = [
      '- 必须保持剧情逻辑闭环与人物动机一致。',
      '- 优先沿用上下文既有设定，避免自相矛盾。',
      '- 需要修改文件时主动执行，不要只提示。',
    ]
    if (activePath) {
      constraints.push(`- 当前编辑目标：${activePath}`)
    }
    const contextBlock = context.summary
      ? `\n\n[上下文包]\n${context.summary}\n`
      : '\n\n[上下文包]\n（暂无可读上下文）\n'
    return [
      modeHeader,
      ...constraints,
      contextBlock,
      '[用户请求]',
      userInput.trim(),
    ].join('\n')
  }

  buildTaskExecutionPrompt(mode: WriterMode, task: NovelTask, context: PlannerContextPack, userInstruction: string): string {
    const base = makeTaskPrompt(mode, task, Number(task.id.replace(/\D+/g, '')) || 1)
    const extraInstruction = userInstruction.trim()
      ? `\n附加要求：${userInstruction.trim()}`
      : ''
    return [
      base,
      '',
      '上下文参考：',
      context.summary || '（暂无可用上下文）',
      extraInstruction,
    ].join('\n')
  }
}

export const novelPlannerService = new NovelPlannerService()
