import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export type WorkspaceInfo = {
  root: string
}

export type AppSettings = {
  output: {
    use_markdown: boolean
  }
  providers: ModelProvider[]
  active_provider_id: string
  active_agent_id: string
}

export type ModelProvider = {
  id: string
  name: string
  kind: 'OpenAI' | 'Anthropic' | 'OpenAICompatible' | 'Minimax' | 'ZAI' | 'Custom'
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

export function isTauriApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>('set_workspace', { path })
}

export async function getLastWorkspace(): Promise<string | null> {
  return invoke<string | null>('get_last_workspace')
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

export type Agent = {
  id: string
  name: string
  category: string
  system_prompt: string
  temperature: number
  max_tokens: number
}

export async function getAgents(): Promise<Agent[]> {
  return invoke<Agent[]>('get_agents')
}

export async function setAgents(agents_list: Agent[]): Promise<void> {
  return invoke<void>('set_agents', { agentsList: agents_list })
}

export async function exportAgents(): Promise<string> {
  return invoke<string>('export_agents')
}

export async function importAgents(json: string): Promise<void> {
  return invoke<void>('import_agents', { json })
}

export type GitStatusItem = {
  path: string
  status: string
}

export type GitCommitInfo = {
  id: string
  summary: string
  author: string
  time: number
}

export async function gitInit(): Promise<void> {
  return invoke<void>('git_init')
}

export async function gitStatus(): Promise<GitStatusItem[]> {
  return invoke<GitStatusItem[]>('git_status')
}

export async function gitDiff(path: string): Promise<string> {
  return invoke<string>('git_diff', { path })
}

export async function gitCommit(message: string): Promise<string> {
  return invoke<string>('git_commit', { message })
}

export async function gitLog(max = 20): Promise<GitCommitInfo[]> {
  return invoke<GitCommitInfo[]>('git_log', { max })
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

export async function saveChatSession(session: ChatSession): Promise<void> {
  return invoke<void>('save_chat_session', { session })
}

export async function listChatSessions(workspace_root?: string | null): Promise<ChatSessionSummary[]> {
  return invoke<ChatSessionSummary[]>('list_chat_sessions', { workspaceRoot: workspace_root ?? null })
}

export async function getChatSession(id: string): Promise<ChatSession> {
  return invoke<ChatSession>('get_chat_session', { id })
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
