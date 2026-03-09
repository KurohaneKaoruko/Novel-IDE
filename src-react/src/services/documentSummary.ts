type DocumentSummary = {
  title: string
  headings: string[]
  opening: string
  closing: string
  charCount: number
  lineCount: number
}

type CachedSummaryEntry = {
  hash: string
  summary: DocumentSummary
}

type StorySummaryEntry = {
  path: string
  content: string
}

function extractCharacterNames(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, '').split(/[:：-]/)[0]?.trim() ?? '')
    .filter(Boolean)
    .slice(0, 16)
}

const STORAGE_KEY = 'novel-ide-document-summary-cache'
const memoryCache = new Map<string, CachedSummaryEntry>()

function hashContent(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${hash >>> 0}`
}

function compactText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}...`
}

function extractParagraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function computeSummary(content: string): DocumentSummary {
  const trimmed = content.trim()
  const lines = trimmed ? trimmed.split(/\r?\n/) : []
  const headings = lines
    .filter((line) => /^#{1,6}\s+/.test(line.trim()))
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 4)
  const paragraphs = extractParagraphs(trimmed)
  const title = headings[0] || compactText(lines.find((line) => line.trim()) ?? '', 80) || 'Untitled'
  const opening = compactText(paragraphs[0] ?? trimmed, 220)
  const closing = compactText(paragraphs[paragraphs.length - 1] ?? trimmed, 180)
  return {
    title,
    headings,
    opening,
    closing,
    charCount: content.length,
    lineCount: lines.length,
  }
}

function loadStorageCache(): Record<string, CachedSummaryEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CachedSummaryEntry>) : {}
  } catch {
    return {}
  }
}

function saveStorageCache(cache: Record<string, CachedSummaryEntry>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // ignore storage issues
  }
}

export function getDocumentSummary(path: string, content: string): DocumentSummary {
  const normalizedPath = path.trim().toLowerCase()
  const hash = hashContent(content)
  const cached = memoryCache.get(normalizedPath)
  if (cached?.hash === hash) {
    return cached.summary
  }

  const storageCache = loadStorageCache()
  const stored = storageCache[normalizedPath]
  if (stored?.hash === hash) {
    memoryCache.set(normalizedPath, stored)
    return stored.summary
  }

  const summary = computeSummary(content)
  const entry = { hash, summary }
  memoryCache.set(normalizedPath, entry)
  storageCache[normalizedPath] = entry
  saveStorageCache(storageCache)
  return summary
}

export function buildDocumentContextBlock(
  label: string,
  path: string,
  content: string,
  options?: { fullTextThreshold?: number; includeExcerpts?: boolean },
): string {
  const fullTextThreshold = options?.fullTextThreshold ?? 1400
  const includeExcerpts = options?.includeExcerpts !== false
  const normalized = content.trim()
  if (!normalized) {
    return `[${label}]\n(empty)`
  }
  if (normalized.length <= fullTextThreshold) {
    return `[${label}]\n${normalized}`
  }

  const summary = getDocumentSummary(path, content)
  const lines = [
    `[${label}]`,
    `title: ${summary.title}`,
    `chars: ${summary.charCount}, lines: ${summary.lineCount}`,
  ]

  if (summary.headings.length > 0) {
    lines.push(`headings: ${summary.headings.join(' > ')}`)
  }
  if (summary.opening) {
    lines.push(`opening: ${summary.opening}`)
  }
  if (summary.closing && summary.closing !== summary.opening) {
    lines.push(`recent: ${summary.closing}`)
  }

  if (includeExcerpts) {
    const head = compactText(normalized.slice(0, 500), 260)
    const tail = compactText(normalized.slice(Math.max(0, normalized.length - 500)), 220)
    lines.push(`[excerpt:start] ${head}`)
    if (tail && tail !== head) {
      lines.push(`[excerpt:end] ${tail}`)
    }
  }

  return lines.join('\n')
}

export function buildStorySummaryIndex(entries: StorySummaryEntry[], label = 'story summary index'): string {
  const usefulEntries = entries.filter((entry) => entry.path.trim() && entry.content.trim())
  if (usefulEntries.length === 0) {
    return `[${label}]\n(empty)`
  }

  const lines = [`[${label}]`]
  for (const entry of usefulEntries) {
    const summary = getDocumentSummary(entry.path, entry.content)
    const headingText = summary.headings.length > 0 ? ` | headings: ${summary.headings.join(' > ')}` : ''
    const openingText = summary.opening ? ` | opening: ${summary.opening}` : ''
    const closingText = summary.closing && summary.closing !== summary.opening ? ` | recent: ${summary.closing}` : ''
    lines.push(`- ${entry.path} | ${summary.title}${headingText}${openingText}${closingText}`)
  }
  return lines.join('\n')
}

export function buildCharacterStateDigest(characterMarkdown: string, entries: StorySummaryEntry[], label = 'character state digest'): string {
  const names = extractCharacterNames(characterMarkdown)
  if (names.length === 0 || entries.length === 0) {
    return `[${label}]\n(empty)`
  }

  const lines = [`[${label}]`]
  for (const name of names) {
    let lastMention = ''
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const paragraphs = extractParagraphs(entries[index].content)
      const hit = [...paragraphs].reverse().find((paragraph) => paragraph.includes(name))
      if (hit) {
        lastMention = compactText(hit, 180)
        break
      }
    }
    if (!lastMention) continue
    lines.push(`- ${name}: ${lastMention}`)
  }

  return lines.length === 1 ? `[${label}]\n(empty)` : lines.join('\n')
}

export function buildStoryCueDigest(entries: StorySummaryEntry[], label = 'recent cue digest'): string {
  if (entries.length === 0) {
    return `[${label}]\n(empty)`
  }

  const lines = [`[${label}]`]
  for (const entry of entries) {
    const summary = getDocumentSummary(entry.path, entry.content)
    const cue = summary.closing || summary.opening
    if (!cue) continue
    lines.push(`- ${entry.path}: ${cue}`)
  }
  return lines.length === 1 ? `[${label}]\n(empty)` : lines.join('\n')
}

export function clearDocumentSummaryCache() {
  memoryCache.clear()
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage issues
  }
}
