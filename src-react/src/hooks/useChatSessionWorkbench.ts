import { useCallback, useMemo, useState } from 'react'

import { getChatSession, listChatSessions, type ChatSessionSummary } from '../tauri'

type SessionMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

type UseChatSessionWorkbenchArgs = {
  workRoot: string | null
  isTauriRuntime: boolean
  onSessionActivated: (sessionId: string) => void | Promise<void>
  onSessionOpened: (sessionId: string, messages: SessionMessage[]) => void | Promise<void>
  onError: (message: string) => void
  hasStreamingMessages: () => boolean
}

export function useChatSessionWorkbench(args: UseChatSessionWorkbenchArgs) {
  const { workRoot, isTauriRuntime, onSessionActivated, onSessionOpened, onError, hasStreamingMessages } = args

  const [activeChatSessionId, setActiveChatSessionId] = useState(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  const [chatSessionSummaries, setChatSessionSummaries] = useState<ChatSessionSummary[]>([])
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false)
  const [chatSessionTitles, setChatSessionTitles] = useState<Record<string, string>>({})

  const chatSessionOptions = useMemo(
    () =>
      chatSessionSummaries.map((session) => ({
        id: session.id,
        updatedAt: session.updated_at,
        messageCount: session.message_count,
        title: chatSessionTitles[session.id] ?? '',
      })),
    [chatSessionSummaries, chatSessionTitles],
  )

  const refreshChatSessionSummaries = useCallback(async () => {
    if (!workRoot || !isTauriRuntime) {
      setChatSessionSummaries([])
      return
    }
    setChatSessionsLoading(true)
    try {
      const sessions = await listChatSessions(workRoot)
      setChatSessionSummaries(sessions)
      const nextTitles = await Promise.all(
        sessions.slice(0, 12).map(async (session) => {
          try {
            const detail = await getChatSession(session.id)
            const lead = detail.messages.find((message) => message.content.trim())?.content.trim() ?? ''
            const compact = lead.replace(/\s+/g, ' ').trim()
            return [session.id, compact.length > 36 ? `${compact.slice(0, 36)}...` : compact] as const
          } catch {
            return [session.id, ''] as const
          }
        }),
      )
      setChatSessionTitles((prev) => ({
        ...prev,
        ...Object.fromEntries(nextTitles.filter(([, title]) => title)),
      }))
    } catch {
      setChatSessionSummaries([])
    } finally {
      setChatSessionsLoading(false)
    }
  }, [isTauriRuntime, workRoot])

  const onNewChatSession = useCallback(() => {
    const nextSessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setActiveChatSessionId(nextSessionId)
    void Promise.resolve(onSessionActivated(nextSessionId)).catch((error) => {
      onError(error instanceof Error ? error.message : String(error))
    })
  }, [onError, onSessionActivated])

  const onOpenChatSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId || !isTauriRuntime) return
      if (hasStreamingMessages()) return
      setChatSessionsLoading(true)
      try {
        const session = await getChatSession(sessionId)
        setActiveChatSessionId(session.id)
        await onSessionOpened(
          session.id,
          session.messages.map((message, index) => ({
            id: `${session.id}-${index}-${message.role}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
            streaming: false,
          })),
        )
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        setChatSessionsLoading(false)
      }
    },
    [hasStreamingMessages, isTauriRuntime, onError, onSessionOpened],
  )

  return {
    activeChatSessionId,
    chatSessionOptions,
    chatSessionsLoading,
    refreshChatSessionSummaries,
    onNewChatSession,
    onOpenChatSession,
  }
}
