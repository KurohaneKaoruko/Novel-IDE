import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export type WorkspaceInfo = {
  root: string
}
export type WorkInfo = WorkspaceInfo

export type AppSettings = {
  output: {
    use_markdown: boolean
  }
  providers: ModelProvider[]
  active_provider_id: string
  active_writing_assistant_id: string
  active_agent_id: string
  launch_mode: LaunchMode
  ai_edit_apply_mode: AiEditApplyMode
}

export type LaunchMode = 'picker' | 'auto_last'
export type AiEditApplyMode = 'auto_apply' | 'review'

export type ProjectSource = 'default' | 'external'
export type WorkSource = ProjectSource

export type ProjectItem = {
  name: string
  path: string
  source: ProjectSource
  is_valid_workspace: boolean
  last_opened_at: number | null
}
export type WorkItem = ProjectItem

export type ProjectPickerState = {
  default_root: string
  default_projects: ProjectItem[]
  external_projects: ProjectItem[]
  last_workspace: string | null
  launch_mode: LaunchMode
}
export type BookshelfState = ProjectPickerState

export type ModelProvider = {
  id: string
  name: string
  kind: 'OpenAI' | 'Anthropic' | 'OpenAICompatible'
  api_key: string
  base_url: string
  model_name: string
}

export type FsEntry = {
  name: string
  path: string
  kind: 'dir' | 'file'
  children: FsEntry[]
}

export type ProjectWritingSettings = {
  chapter_word_target: number
  auto_min_chars: number
  auto_max_chars: number
  auto_max_rounds: number
  auto_max_chapter_advances: number
}

export type ComposerDirectiveParseResult = {
  requested_mode: 'normal' | 'plan' | 'spec' | null
  auto_action: 'on' | 'off' | 'toggle' | null
  content: string
  matched: boolean
}

export type InlineReferencesResolveResult = {
  resolved_input: string
  blocks_added: number
}

export type NovelTaskQualityTask = {
  id: string
  target_words: number
  scope: string
  depends_on: string[]
  acceptance_checks: string[]
}

export type NovelTaskQualityResult = {
  ok: boolean
  reason: string | null
}

export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>('set_workspace', { path })
}

export async function setWorkRoot(path: string): Promise<WorkInfo> {
  return setWorkspace(path)
}

export async function getLastWorkspace(): Promise<string | null> {
  return invoke<string | null>('get_last_workspace')
}

export async function getLastWork(): Promise<string | null> {
  return getLastWorkspace()
}

export async function getProjectPickerState(): Promise<ProjectPickerState> {
  return invoke<ProjectPickerState>('get_project_picker_state')
}

export async function getBookshelfState(): Promise<BookshelfState> {
  return invoke<BookshelfState>('get_bookshelf_state')
}

export async function createNovelProject(name: string): Promise<ProjectItem> {
  return invoke<ProjectItem>('create_novel_project', { name })
}

export async function createNovelWork(name: string): Promise<WorkItem> {
  return invoke<WorkItem>('create_novel_work', { name })
}

export async function rememberExternalProject(path: string): Promise<void> {
  return invoke<void>('remember_external_project', { path })
}

export async function rememberImportedWork(path: string): Promise<void> {
  return invoke<void>('remember_imported_work', { path })
}

export async function forgetExternalProject(path: string): Promise<void> {
  return invoke<void>('forget_external_project', { path })
}

export async function forgetImportedWork(path: string): Promise<void> {
  return invoke<void>('forget_imported_work', { path })
}

export async function setLaunchMode(mode: LaunchMode): Promise<void> {
  return invoke<void>('set_launch_mode', { mode })
}

export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  })
  if (!selected) return null
  if (Array.isArray(selected)) return selected[0] ?? null
  return selected
}

export async function initNovel(): Promise<void> {
  return invoke<void>('init_novel')
}

export async function listWorkspaceTree(maxDepth = 6): Promise<FsEntry> {
  return invoke<FsEntry>('list_workspace_tree', { maxDepth })
}

export async function listWorkTree(maxDepth = 6): Promise<FsEntry> {
  return listWorkspaceTree(maxDepth)
}

export async function getProjectWritingSettings(): Promise<ProjectWritingSettings> {
  return invoke<ProjectWritingSettings>('get_project_writing_settings')
}

export async function setProjectWritingSettings(settings: ProjectWritingSettings): Promise<ProjectWritingSettings> {
  return invoke<ProjectWritingSettings>('set_project_writing_settings', { settings })
}

export async function parseComposerDirective(input: string): Promise<ComposerDirectiveParseResult> {
  return invoke<ComposerDirectiveParseResult>('parse_composer_directive', { input })
}

export async function resolveInlineReferences(
  input: string,
  selectionText?: string | null,
  activeFilePath?: string | null,
  activeFileContent?: string | null,
): Promise<InlineReferencesResolveResult> {
  return invoke<InlineReferencesResolveResult>('resolve_inline_references', {
    payload: {
      input,
      selection_text: selectionText ?? null,
      active_file_path: activeFilePath ?? null,
      active_file_content: activeFileContent ?? null,
    },
  })
}

export async function validateNovelTaskQuality(
  task: NovelTaskQualityTask,
  assistantText: string,
  taskPool: NovelTaskQualityTask[],
): Promise<NovelTaskQualityResult> {
  return invoke<NovelTaskQualityResult>('validate_novel_task_quality', {
    payload: {
      task,
      assistant_text: assistantText,
      task_pool: taskPool,
    },
  })
}

export async function readText(path: string): Promise<string> {
  return invoke<string>('read_text', { relativePath: path })
}

export async function writeText(path: string, content: string): Promise<void> {
  return invoke<void>('write_text', { relativePath: path, content })
}

export async function createFile(path: string): Promise<void> {
  return invoke<void>('create_file', { relativePath: path })
}

export async function createDir(path: string): Promise<void> {
  return invoke<void>('create_dir', { relativePath: path })
}

export async function deleteEntry(path: string): Promise<void> {
  return invoke<void>('delete_entry', { relativePath: path })
}

export async function renameEntry(fromPath: string, toPath: string): Promise<void> {
  return invoke<void>('rename_entry', { fromRelativePath: fromPath, toRelativePath: toPath })
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_app_settings')
}

export async function setAppSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('set_app_settings', { settings })
}

export async function getApiKeyStatus(providerId: string): Promise<boolean> {
  return invoke<boolean>('get_api_key_status', { providerId })
}

export async function setApiKey(providerId: string, apiKey: string): Promise<void> {
  return invoke<void>('set_api_key', { providerId, apiKey })
}

export type ProviderConnectivityResult = {
  ok: boolean
  status_code: number
  latency_ms: number
  message: string
}

export async function testProviderConnectivity(provider: ModelProvider, apiKey?: string | null): Promise<ProviderConnectivityResult> {
  return invoke<ProviderConnectivityResult>('test_provider_connectivity', {
    provider,
    apiKey: apiKey ?? null,
  })
}

export type Agent = {
  id: string
  name: string
  category: string
  system_prompt: string
  temperature: number
  max_tokens: number
}
export type WritingAssistant = Agent

export async function getAgents(): Promise<Agent[]> {
  return invoke<Agent[]>('get_agents')
}

export async function getWritingAssistants(): Promise<WritingAssistant[]> {
  return invoke<WritingAssistant[]>('get_writing_assistants')
}

export async function setAgents(agents_list: Agent[]): Promise<void> {
  return invoke<void>('set_agents', { agentsList: agents_list })
}

export async function setWritingAssistants(assistants: WritingAssistant[]): Promise<void> {
  return invoke<void>('set_writing_assistants', { assistants })
}

export async function exportAgents(): Promise<string> {
  return invoke<string>('export_agents')
}

export async function exportWritingAssistants(): Promise<string> {
  return invoke<string>('export_writing_assistants')
}

export async function importAgents(json: string): Promise<void> {
  return invoke<void>('import_agents', { json })
}

export async function importWritingAssistants(json: string): Promise<void> {
  return invoke<void>('import_writing_assistants', { json })
}

export type HistoryEntry = {
  id: string
  file_path: string
  created_at: number
  reason: string
  word_count: number
  char_count: number
  summary: string
}

export async function listHistoryEntries(max = 120): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>('list_history_entries', { max })
}

export async function createHistorySnapshot(relativePath: string, reason?: string | null): Promise<HistoryEntry> {
  return invoke<HistoryEntry>('create_history_snapshot', {
    relativePath,
    reason: reason ?? null,
  })
}

export async function readHistorySnapshot(id: string): Promise<string> {
  return invoke<string>('read_history_snapshot', { id })
}

export async function restoreHistorySnapshot(id: string): Promise<string> {
  return invoke<string>('restore_history_snapshot', { id })
}

export type ChatHistoryMessage = {
  role: 'user' | 'assistant' | string
  content: string
}

export type ChatSession = {
  id: string
  workspace_root: string
  created_at: number
  updated_at: number
  messages: ChatHistoryMessage[]
}

export type ChatSessionSummary = {
  id: string
  workspace_root: string
  updated_at: number
  message_count: number
}

export type RiskFinding = {
  level: 'low' | 'medium' | 'high' | string
  category: string
  excerpt: string
  reason: string
  suggestion: string
  line_start: number | null
  line_end: number | null
}

export type RiskScanResult = {
  summary: string
  overall_level: 'low' | 'medium' | 'high' | string
  findings: RiskFinding[]
  scanned_chars: number
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  return invoke<void>('save_chat_session', { session })
}

export async function listChatSessions(workspace_root?: string | null): Promise<ChatSessionSummary[]> {
  return invoke<ChatSessionSummary[]>('list_chat_sessions', { workspaceRoot: workspace_root ?? null })
}

export async function getChatSession(id: string): Promise<ChatSession> {
  return invoke<ChatSession>('get_chat_session', { id })
}

export async function riskScanContent(filePath: string | null, content: string): Promise<RiskScanResult> {
  return invoke<RiskScanResult>('risk_scan_content', { filePath: filePath ?? null, content })
}

// ============ Skills ============

export type Skill = {
  id: string
  name: string
  description: string
  prompt: string
  category: string
  enabled: boolean
}

export async function getSkills(): Promise<Skill[]> {
  return invoke<Skill[]>('get_skills')
}

export async function getSkillCategories(): Promise<string[]> {
  return invoke<string[]>('get_skill_categories')
}

export async function getSkillsByCategory(category: string): Promise<Skill[]> {
  return invoke<Skill[]>('get_skills_by_category', { category })
}

export async function applySkill(skillId: string, content: string): Promise<string> {
  return invoke<string>('apply_skill', { skillId, content })
}

// ============ MCP ============

export type McpServer = {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export type McpTool = {
  name: string
  description: string
  input_schema: unknown
}

export type McpResource = {
  uri: string
  name: string
  description: string
  mime_type: string
}

export type McpServerStatus = {
  server_id: string
  connected: boolean
  tools: McpTool[]
  resources: McpResource[]
  error: string | null
}

// ============ Book Split Types ============

export type ChapterInfo = {
  id: number
  title: string
  start_line: number
  end_line: number
  word_count: number
  summary: string
  key_events: string[]
  characters_appearing: string[]
}

export type BookOutline = {
  structure: string
  acts: Array<{ id: number; name: string; description: string; chapters: number[] }>
  arcs: Array<{ id: number; name: string; description: string; characters: string[] }>
}

export type CharacterInfo = {
  name: string
  role: string
  description: string
  appearances: number[]
}

export type SettingInfo = {
  name: string
  category: string
  description: string
}

export type BookAnalysis = {
  title: string
  author: string | null
  total_words: number
  chapters: ChapterInfo[]
  outline: BookOutline
  characters: CharacterInfo[]
  settings: SettingInfo[]
  themes: string[]
  style: string
}

export type BookSplitConfig = {
  split_by_chapters: boolean
  target_chapter_words: number
  extract_outline: boolean
  extract_characters: boolean
  extract_settings: boolean
  analyze_themes: boolean
  analyze_style: boolean
}

export type SplitChapter = {
  id: number
  title: string
  content: string
  word_count: number
  summary: string | null
}

export type BookSplitResult = {
  original_title: string
  chapters: SplitChapter[]
  metadata: Record<string, string>
}

export async function analyzeBook(content: string, title: string): Promise<BookAnalysis> {
  return invoke<BookAnalysis>('analyze_book', { content, title })
}

export async function splitBook(content: string, title: string, config: BookSplitConfig): Promise<BookSplitResult> {
  return invoke<BookSplitResult>('split_book', { content, title, config })
}

export async function extractChapters(content: string): Promise<ChapterInfo[]> {
  return invoke<ChapterInfo[]>('extract_chapters', { content })
}

// ============ 拆书 Types ============

export type BookStructure = {
  type: string
  acts: Array<{ id: number; name: string; chapters: number[]; description: string }>
  pacing: string
  audience: string
}

export type PlotArc = {
  name: string
  main: boolean
  chapters: number[]
  description: string
}

export type RhythmAnalysis = {
  average_chapter_length: number
  conflict_density: string
  turning_points: Array<{ chapter: number; type: string; description: string }>
  chapter_hooks: string[]
}

export type ClimaxPoint = {
  chapter: number
  type: string
  intensity: number
  description: string
}

export type 爽点 = {
  chapter: number
  type: string
  description: string
  frequency: string
}

export type CharacterAnalysis = {
  name: string
  role: string
  archetype: string
  growth: string
  main_moments: string[]
  relationships: string[]
}

export type CharacterRelationship = {
  from: string
  to: string
  type: string
  description: string
}

export type WorldSetting = {
  name: string
  category: string
  importance: string
  description: string
}

export type PowerSystem = {
  name: string
  levels: string[]
  cultivation_method: string
  resources: string[]
}

export type WritingTechnique = {
  category: string
  technique: string
  example: string
  application: string
}

export type Book拆书Result = {
  title: string
  author: string | null
  source: string
  structure: BookStructure
  plot_arcs: PlotArc[]
  rhythm: RhythmAnalysis
  climax_points: ClimaxPoint[]
  爽点列表: 爽点[]
  characters: CharacterAnalysis[]
  character_relationships: CharacterRelationship[]
  world_settings: WorldSetting[]
  power_system: PowerSystem[]
  techniques: WritingTechnique[]
  summary: string
  learnable_points: string[]
}

export async function 拆书Analyze(content: string, title: string): Promise<Book拆书Result> {
  return invoke<Book拆书Result>('拆书_analyze', { content, title })
}

export async function 拆书ExtractTechniques(content: string): Promise<WritingTechnique[]> {
  return invoke<WritingTechnique[]>('拆书_extract__echniques', { content })
}
