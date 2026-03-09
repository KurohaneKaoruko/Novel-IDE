import { describe, expect, it } from 'vitest'

import { upsertAIActionTrace, type AIActionTraceItem } from '../src/services/aiActionTrace'

function makeEvent(overrides: Partial<AIActionTraceItem>): AIActionTraceItem {
  return {
    actionId: 'step-2',
    step: 2,
    tool: 'fs_read_text',
    status: 'running',
    inputPreview: '{"path":"stories/chapter-01.md"}',
    timestamp: 200,
    ...overrides,
  }
}

describe('upsertAIActionTrace', () => {
  it('merges start and finish events by stable action id', () => {
    const started = makeEvent({
      status: 'running',
      timestamp: 200,
      readPath: 'stories/chapter-01.md',
    })
    const finished = makeEvent({
      status: 'success',
      timestamp: 260,
      finishedAt: 260,
      durationMs: 60,
      readChars: 1280,
      readLines: 82,
      readPreview: 'chapter preview',
    })

    const merged = upsertAIActionTrace(upsertAIActionTrace([], started), finished)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      actionId: 'step-2',
      status: 'success',
      startedAt: 200,
      finishedAt: 260,
      durationMs: 60,
      readPath: 'stories/chapter-01.md',
      readChars: 1280,
    })
  })

  it('keeps actions sorted by step after inserts', () => {
    const later = makeEvent({ actionId: 'step-3', step: 3, timestamp: 300 })
    const earlier = makeEvent({ actionId: 'step-1', step: 1, timestamp: 100, tool: 'fs_exists' })

    const merged = upsertAIActionTrace(upsertAIActionTrace([], later), earlier)

    expect(merged.map((item) => item.actionId)).toEqual(['step-1', 'step-3'])
  })
})
