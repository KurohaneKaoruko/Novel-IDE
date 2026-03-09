import { invoke } from '@tauri-apps/api/core'
import type { ChangeSet } from './services/ModificationService'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  changeSet?: ChangeSet
  timestamp: number
}

export async function chatGenerateStream(args: {
  streamId: string
  messages: ChatMessage[]
  useMarkdown: boolean
  assistantId?: string | null
  agentId?: string | null
  providerId?: string | null
}): Promise<void> {
  const assistantId = args.assistantId ?? args.agentId ?? null
  return invoke<void>('chat_generate_stream', {
    streamId: args.streamId,
    stream_id: args.streamId,
    messages: args.messages,
    useMarkdown: args.useMarkdown,
    use_markdown: args.useMarkdown,
    agentId: assistantId,
    agent_id: assistantId,
    providerId: args.providerId ?? null,
    provider_id: args.providerId ?? null,
  })
}

export async function chatCancelStream(streamId: string): Promise<void> {
  return invoke<void>('chat_cancel_stream', {
    streamId,
    stream_id: streamId,
  })
}
