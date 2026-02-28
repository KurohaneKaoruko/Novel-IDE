import { isTauriApp, parseComposerDirective, type ComposerDirectiveParseResult } from '../tauri'

export type WriterModeLike = 'normal' | 'plan' | 'spec'
export type ComposerAutoAction = 'on' | 'off' | 'toggle' | null

export type ParsedComposerDirective = {
  requestedMode: WriterModeLike | null
  autoAction: ComposerAutoAction
  content: string
  matched: boolean
}

function parseLocally(input: string): ParsedComposerDirective {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { requestedMode: null, autoAction: null, content: trimmed, matched: false }
  }

  const match = trimmed.match(/^\/([^\s]+)\s*(.*)$/u)
  const command = (match?.[1] ?? '').toLowerCase()
  const rest = (match?.[2] ?? '').trim()

  if (command === 'auto') {
    const arg = (rest.split(/\s+/u)[0] ?? '').toLowerCase()
    const autoAction: ComposerAutoAction = arg === 'on' ? 'on' : arg === 'off' ? 'off' : 'toggle'
    return { requestedMode: null, autoAction, content: '', matched: true }
  }

  const modeMap: Record<string, WriterModeLike> = {
    normal: 'normal',
    plan: 'plan',
    spec: 'spec',
    '普通': 'normal',
    '大纲': 'plan',
    '细纲': 'spec',
  }
  const requestedMode = modeMap[command] ?? null
  if (requestedMode) {
    return { requestedMode, autoAction: null, content: rest, matched: true }
  }

  return { requestedMode: null, autoAction: null, content: trimmed, matched: false }
}

function mapBackendResult(result: ComposerDirectiveParseResult): ParsedComposerDirective {
  return {
    requestedMode: result.requested_mode,
    autoAction: result.auto_action,
    content: result.content,
    matched: result.matched,
  }
}

export async function parseComposerInput(rawInput: string): Promise<ParsedComposerDirective> {
  const trimmed = rawInput.trim()
  if (!trimmed) return { requestedMode: null, autoAction: null, content: '', matched: false }
  if (!isTauriApp()) return parseLocally(trimmed)
  try {
    const parsed = await parseComposerDirective(trimmed)
    return mapBackendResult(parsed)
  } catch {
    return parseLocally(trimmed)
  }
}

