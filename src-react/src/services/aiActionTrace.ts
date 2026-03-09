export type AIActionListItem = {
  name: string
  kind: 'dir' | 'file'
}

export type AIActionTraceItem = {
  actionId: string
  step: number
  tool: string
  status: 'running' | 'success' | 'error'
  inputPreview: string
  observationPreview?: string
  listItems?: AIActionListItem[]
  listTruncated?: boolean
  exists?: boolean
  existsKind?: 'dir' | 'file'
  readPath?: string
  readLines?: number
  readChars?: number
  readPreview?: string
  writePath?: string
  writeLines?: number
  writeChars?: number
  writePreview?: string
  timestamp: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
}

function actionIdentity(item: Pick<AIActionTraceItem, 'actionId' | 'step' | 'tool'>): string {
  return item.actionId || `step-${item.step}:${item.tool}`
}

export function upsertAIActionTrace(
  list: AIActionTraceItem[] | undefined,
  incoming: AIActionTraceItem,
): AIActionTraceItem[] {
  const base = list ?? []
  const identity = actionIdentity(incoming)
  const index = base.findIndex((item) => actionIdentity(item) === identity)

  if (index < 0) {
    const normalizedIncoming: AIActionTraceItem = {
      ...incoming,
      actionId: identity,
      startedAt: incoming.startedAt ?? incoming.timestamp,
    }
    return [...base, normalizedIncoming].sort((left, right) => {
      if (left.step !== right.step) return left.step - right.step
      return left.timestamp - right.timestamp
    })
  }

  const current = base[index]
  const merged: AIActionTraceItem = {
    ...current,
    ...incoming,
    actionId: identity,
    inputPreview: incoming.inputPreview || current.inputPreview,
    observationPreview: incoming.observationPreview ?? current.observationPreview,
    listItems: incoming.listItems ?? current.listItems,
    listTruncated: incoming.listTruncated ?? current.listTruncated,
    exists: incoming.exists ?? current.exists,
    existsKind: incoming.existsKind ?? current.existsKind,
    readPath: incoming.readPath ?? current.readPath,
    readLines: incoming.readLines ?? current.readLines,
    readChars: incoming.readChars ?? current.readChars,
    readPreview: incoming.readPreview ?? current.readPreview,
    writePath: incoming.writePath ?? current.writePath,
    writeLines: incoming.writeLines ?? current.writeLines,
    writeChars: incoming.writeChars ?? current.writeChars,
    writePreview: incoming.writePreview ?? current.writePreview,
    startedAt: incoming.startedAt ?? current.startedAt ?? incoming.timestamp,
    finishedAt: incoming.finishedAt ?? current.finishedAt,
    durationMs: incoming.durationMs ?? current.durationMs,
  }

  return [...base.slice(0, index), merged, ...base.slice(index + 1)]
}

export function actionTraceTarget(item: AIActionTraceItem): string | null {
  return item.writePath ?? item.readPath ?? null
}
