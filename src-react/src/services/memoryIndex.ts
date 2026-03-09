export type MemoryIndexSource = 'auto' | 'manual'

export type MemoryIndexMeta = {
  source: MemoryIndexSource
  locked: boolean
  updatedAt: string
}

export type MemoryIndexDocument = {
  meta: MemoryIndexMeta
  body: string
}

function normalizeMeta(meta?: Partial<MemoryIndexMeta>): MemoryIndexMeta {
  return {
    source: meta?.source === 'manual' ? 'manual' : 'auto',
    locked: meta?.locked === true,
    updatedAt: typeof meta?.updatedAt === 'string' && meta.updatedAt ? meta.updatedAt : new Date().toISOString(),
  }
}

export function parseMemoryIndexDocument(raw: string): MemoryIndexDocument {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { meta: normalizeMeta(), body: raw.trim() }
  }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) {
    return { meta: normalizeMeta(), body: raw.trim() }
  }

  const headerRaw = normalized.slice(4, end).trim()
  const body = normalized.slice(end + 5).trim()
  const meta: Partial<MemoryIndexMeta> = {}
  for (const line of headerRaw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf(':')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (key === 'source') meta.source = value === 'manual' ? 'manual' : 'auto'
    if (key === 'locked') meta.locked = value === 'true'
    if (key === 'updated_at') meta.updatedAt = value
  }
  return { meta: normalizeMeta(meta), body }
}

export function serializeMemoryIndexDocument(body: string, meta?: Partial<MemoryIndexMeta>): string {
  const normalizedMeta = normalizeMeta(meta)
  const safeBody = body.trim()
  return [
    '---',
    `source: ${normalizedMeta.source}`,
    `locked: ${normalizedMeta.locked ? 'true' : 'false'}`,
    `updated_at: ${normalizedMeta.updatedAt}`,
    '---',
    '',
    safeBody,
    '',
  ].join('\n')
}

