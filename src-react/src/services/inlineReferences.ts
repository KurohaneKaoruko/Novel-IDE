import { readText, resolveInlineReferences as resolveInlineReferencesCommand } from '../tauri'
import { buildDocumentContextBlock } from './documentSummary'

type ActiveFileLite = {
  path: string
  content: string
}

type ResolveInlineReferencesInput = {
  input: string
  selectionText: string
  activeFile: ActiveFileLite | null
  isTauriRuntime: boolean
  workRoot: string | null
}

function pushBlock(blocks: string[], title: string, body: string) {
  const normalized = body.trim()
  blocks.push(`[${title}]\n${normalized || '(empty)'}`)
}

function pushDocumentBlock(blocks: string[], title: string, path: string, body: string) {
  blocks.push(buildDocumentContextBlock(title, path, body))
}

async function resolveLocally(params: ResolveInlineReferencesInput): Promise<string> {
  const source = params.input.trim()
  if (!source.includes('#')) return source

  const selectionRegex = /#(?:选区|selection)\b/gi
  const currentFileRegex = /#(?:当前文件|current_file|current)\b/gi
  const filePrefixRegex = /#(?:文件|file):([^\s#]+)/gi
  const filePathRegex = /#([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,16})/g

  const blocks: string[] = []
  const fileRefs: string[] = []
  const seenFileRefs = new Set<string>()
  let cleaned = source

  if (selectionRegex.test(source)) {
    const selected = params.selectionText.trim()
    pushBlock(blocks, 'selection', selected || '(no selection detected; select text in editor first)')
    cleaned = cleaned.replace(selectionRegex, '').trim()
  }

  if (currentFileRegex.test(source)) {
    if (params.activeFile) {
      pushDocumentBlock(blocks, `current file ${params.activeFile.path}`, params.activeFile.path, params.activeFile.content)
    } else {
      pushBlock(blocks, 'current file', '(no active file)')
    }
    cleaned = cleaned.replace(currentFileRegex, '').trim()
  }

  for (const match of source.matchAll(filePrefixRegex)) {
    const ref = (match[1] ?? '').trim().replace(/\\/g, '/')
    if (!ref) continue
    const key = ref.toLowerCase()
    if (seenFileRefs.has(key)) continue
    seenFileRefs.add(key)
    fileRefs.push(ref)
  }

  for (const match of source.matchAll(filePathRegex)) {
    const ref = (match[1] ?? '').trim().replace(/\\/g, '/')
    if (!ref) continue
    const key = ref.toLowerCase()
    if (seenFileRefs.has(key)) continue
    seenFileRefs.add(key)
    fileRefs.push(ref)
  }

  cleaned = cleaned.replace(filePrefixRegex, '').replace(filePathRegex, '').trim()

  if (fileRefs.length > 0) {
    for (const ref of fileRefs) {
      const rel = ref.replace(/^\.?\//, '')
      if (!rel) continue
      if (!params.workRoot || !params.isTauriRuntime) {
        pushBlock(blocks, `file ${rel}`, '(project files are unavailable in current environment)')
        continue
      }
      try {
        const content = await readText(rel)
        pushDocumentBlock(blocks, `file ${rel}`, rel, content)
      } catch (e) {
        pushBlock(blocks, `file ${rel}`, `read failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  if (blocks.length === 0) return source
  if (!cleaned) {
    return `Please continue writing based on the following references.\n\n${blocks.join('\n\n')}`
  }
  return `${cleaned}\n\n[References]\n${blocks.join('\n\n')}`
}

export async function resolveInlineReferencesInput(params: ResolveInlineReferencesInput): Promise<string> {
  const source = params.input.trim()
  if (!source.includes('#')) return source
  if (!params.isTauriRuntime) return resolveLocally(params)
  try {
    return await resolveLocally(params)
  } catch {
    try {
      const result = await resolveInlineReferencesCommand(
        source,
        params.selectionText,
        params.activeFile?.path ?? null,
        params.activeFile?.content ?? null,
      )
      return result.resolved_input
    } catch {
      return source
    }
  }
}


