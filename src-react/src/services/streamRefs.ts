import type { MutableRefObject } from 'react'

export type StreamMapRefs = {
  streamOutputRef: MutableRefObject<Map<string, string>>
  streamAssistantGroupRef: MutableRefObject<Map<string, string>>
  streamAssistantIdRef: MutableRefObject<Map<string, string>>
  manualCancelledStreamsRef: MutableRefObject<Set<string>>
  streamStartedAtRef: MutableRefObject<Map<string, number>>
  streamLastTokenAtRef: MutableRefObject<Map<string, number>>
}

export function cleanupStreamRefs(refs: StreamMapRefs, streamId: string) {
  refs.streamOutputRef.current.delete(streamId)
  refs.streamAssistantGroupRef.current.delete(streamId)
  refs.streamAssistantIdRef.current.delete(streamId)
  refs.manualCancelledStreamsRef.current.delete(streamId)
  refs.streamStartedAtRef.current.delete(streamId)
  refs.streamLastTokenAtRef.current.delete(streamId)
}
