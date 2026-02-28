import type { ModelProvider } from '../tauri'

export type CustomProviderApiFormat = 'openai' | 'claude'

export type ProviderPreset = {
  key: string
  name: string
  kind: ModelProvider['kind']
  base_url: string
  model_name: string
}

export const CUSTOM_PROVIDER_PRESET_KEY = 'custom'

export const COMMON_PROVIDER_PRESETS: ProviderPreset[] = [
  { key: 'openai', name: 'OpenAI', kind: 'OpenAI', base_url: 'https://api.openai.com/v1', model_name: 'gpt-4o-mini' },
  { key: 'claude', name: 'Claude (Anthropic)', kind: 'Anthropic', base_url: 'https://api.anthropic.com', model_name: 'claude-3-5-sonnet-20241022' },
  { key: 'deepseek', name: 'DeepSeek', kind: 'OpenAICompatible', base_url: 'https://api.deepseek.com', model_name: 'deepseek-chat' },
  { key: 'openrouter', name: 'OpenRouter', kind: 'OpenAICompatible', base_url: 'https://openrouter.ai/api/v1', model_name: 'openai/gpt-4o-mini' },
  { key: 'moonshot', name: 'Moonshot (Kimi)', kind: 'OpenAICompatible', base_url: 'https://api.moonshot.cn/v1', model_name: 'moonshot-v1-8k' },
  { key: 'qwen', name: 'Qwen (DashScope)', kind: 'OpenAICompatible', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model_name: 'qwen-plus' },
  { key: 'zhipu', name: 'Zhipu AI (GLM)', kind: 'OpenAICompatible', base_url: 'https://open.bigmodel.cn/api/paas/v4', model_name: 'glm-4-flash' },
  { key: 'minimax', name: 'MiniMax', kind: 'OpenAICompatible', base_url: 'https://api.minimax.chat/v1', model_name: 'MiniMax-Text-01' },
  { key: 'siliconflow', name: 'SiliconFlow', kind: 'OpenAICompatible', base_url: 'https://api.siliconflow.cn/v1', model_name: 'deepseek-ai/DeepSeek-V3' },
  { key: 'groq', name: 'Groq', kind: 'OpenAICompatible', base_url: 'https://api.groq.com/openai/v1', model_name: 'llama-3.3-70b-versatile' },
  { key: 'ollama', name: 'Ollama (Local)', kind: 'OpenAICompatible', base_url: 'http://localhost:11434/v1', model_name: 'qwen2.5:14b' },
]

export function normalizeProviderBaseUrl(url?: string): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

export function inferProviderPresetKey(provider: Partial<ModelProvider>): string {
  const kind = provider.kind
  const base = normalizeProviderBaseUrl(provider.base_url)
  if (!kind || !base) return CUSTOM_PROVIDER_PRESET_KEY
  const matched = COMMON_PROVIDER_PRESETS.find((preset) => preset.kind === kind && normalizeProviderBaseUrl(preset.base_url) === base)
  return matched?.key ?? CUSTOM_PROVIDER_PRESET_KEY
}

export function providerKindLabel(kind: ModelProvider['kind']): string {
  switch (kind) {
    case 'OpenAI':
      return 'OpenAI API'
    case 'Anthropic':
      return 'Claude API'
    default:
      return 'OpenAI API'
  }
}

export function kindFromCustomProviderApiFormat(format: CustomProviderApiFormat): ModelProvider['kind'] {
  return format === 'claude' ? 'Anthropic' : 'OpenAICompatible'
}

export function defaultBaseUrlByCustomProviderApiFormat(format: CustomProviderApiFormat): string {
  return format === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
}

