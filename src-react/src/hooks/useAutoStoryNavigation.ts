import { useCallback } from 'react'
import { createDir, createFile, type FsEntry } from '../tauri'

type Params = {
  tree: FsEntry | null
  onOpenByPath: (path: string) => Promise<void>
  refreshTree: () => Promise<void>
}

function collectWorkspaceFiles(root: FsEntry | null): Set<string> {
  const out = new Set<string>()
  if (!root) return out
  const stack: FsEntry[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.kind === 'file') {
      out.add(node.path.replace(/\\/g, '/'))
    } else {
      for (const child of node.children ?? []) {
        stack.push(child)
      }
    }
  }
  return out
}

function buildNextChapterPath(currentPath: string, files: Set<string>): string | null {
  const normalized = (currentPath ?? '').replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash >= 0 ? normalized.slice(0, slash) : ''
  const file = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const match = file.match(/^chapter-(\d+)([^.]*)\.(md|txt)$/i)
  if (!match) return null
  const digits = match[1] ?? ''
  const suffix = match[2] ?? ''
  const ext = match[3] ?? 'md'
  const nextNum = String(Number(digits) + 1).padStart(digits.length, '0')
  const nextFile = `chapter-${nextNum}${suffix}.${ext}`
  const sameDirCandidate = dir ? `${dir}/${nextFile}` : nextFile
  if (files.has(sameDirCandidate)) return sameDirCandidate

  const globalMatches = [...files].filter((path) => path.endsWith(`/${nextFile}`) || path === nextFile).sort()
  if (globalMatches.length > 0) {
    const preferred = globalMatches.find((path) => path.startsWith('stories/vol-')) ?? globalMatches[0]
    return preferred
  }

  const volMatch = dir.match(/^(.*\/)?vol-(\d+)$/i)
  if (volMatch) {
    const volPrefix = volMatch[1] ?? ''
    const nextVol = String(Number(volMatch[2]) + 1).padStart(volMatch[2].length, '0')
    return `${volPrefix}vol-${nextVol}/${nextFile}`
  }

  return sameDirCandidate
}

export function useAutoStoryNavigation({ tree, onOpenByPath, refreshTree }: Params) {
  const ensureAutoNextChapter = useCallback(
    async (currentPath: string): Promise<string | null> => {
      const files = collectWorkspaceFiles(tree)
      const candidate = buildNextChapterPath(currentPath, files)
      if (!candidate) return null
      if (!candidate.startsWith('stories/')) return null
      if (!files.has(candidate)) {
        try {
          await createFile(candidate)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('parent directory does not exist')) {
            const slash = candidate.lastIndexOf('/')
            if (slash > 0) {
              await createDir(candidate.slice(0, slash))
            }
            await createFile(candidate)
          } else {
            throw e
          }
        }
      }
      await onOpenByPath(candidate)
      await refreshTree()
      return candidate
    },
    [onOpenByPath, refreshTree, tree],
  )

  const ensureAutoStoryFile = useCallback(
    async (path: string): Promise<string | null> => {
      const normalized = (path ?? '').replace(/\\/g, '/')
      if (!normalized || !normalized.startsWith('stories/')) return null
      const files = collectWorkspaceFiles(tree)
      if (!files.has(normalized)) {
        try {
          await createFile(normalized)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('parent directory does not exist')) {
            const slash = normalized.lastIndexOf('/')
            if (slash > 0) {
              await createDir(normalized.slice(0, slash))
            }
            await createFile(normalized)
          } else {
            throw e
          }
        }
      }
      await onOpenByPath(normalized)
      await refreshTree()
      return normalized
    },
    [onOpenByPath, refreshTree, tree],
  )

  return {
    ensureAutoNextChapter,
    ensureAutoStoryFile,
  }
}
