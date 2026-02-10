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
  agentId?: string | null
}): Promise<void> {
  return invoke<void>('chat_generate_stream', {
    streamId: args.streamId,
    messages: args.messages,
    useMarkdown: args.useMarkdown,
    agentId: args.agentId ?? null,
  })
}
