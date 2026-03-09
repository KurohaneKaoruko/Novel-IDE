import { useCallback, useState } from 'react'

import { readText, writeText, type FsEntry } from '../tauri'
import { parseMemoryIndexDocument, serializeMemoryIndexDocument, type MemoryIndexMeta } from '../services/memoryIndex'

type PlannerServiceLike = {
  refreshDerivedStateIndexes: (tree: FsEntry | null, activePath: string | null) => Promise<void>
}

type UseMemoryWorkbenchArgs = {
  workRoot: string | null
  activePath: string | null
  tree: FsEntry | null
  isTauriRuntime: boolean
  plannerService: PlannerServiceLike
}

export function useMemoryWorkbench(args: UseMemoryWorkbenchArgs) {
  const { workRoot, activePath, tree, isTauriRuntime, plannerService } = args

  const [memoryIndexLoading, setMemoryIndexLoading] = useState(false)
  const [characterStateIndexContent, setCharacterStateIndexContent] = useState('')
  const [foreshadowIndexContent, setForeshadowIndexContent] = useState('')
  const [characterStateIndexMeta, setCharacterStateIndexMeta] = useState<MemoryIndexMeta | null>(null)
  const [foreshadowIndexMeta, setForeshadowIndexMeta] = useState<MemoryIndexMeta | null>(null)

  const refreshMemoryIndices = useCallback(async () => {
    if (!workRoot || !isTauriRuntime) {
      setCharacterStateIndexContent('')
      setForeshadowIndexContent('')
      setCharacterStateIndexMeta(null)
      setForeshadowIndexMeta(null)
      return
    }
    setMemoryIndexLoading(true)
    try {
      await plannerService.refreshDerivedStateIndexes(tree, activePath)
      const [characterStateIndex, foreshadowIndex] = await Promise.all([
        readText('.novel/state/character-state-index.md').catch(() => ''),
        readText('.novel/state/foreshadow-index.md').catch(() => ''),
      ])
      const parsedCharacter = parseMemoryIndexDocument(characterStateIndex)
      const parsedForeshadow = parseMemoryIndexDocument(foreshadowIndex)
      setCharacterStateIndexContent(parsedCharacter.body)
      setForeshadowIndexContent(parsedForeshadow.body)
      setCharacterStateIndexMeta(parsedCharacter.meta)
      setForeshadowIndexMeta(parsedForeshadow.meta)
    } finally {
      setMemoryIndexLoading(false)
    }
  }, [activePath, isTauriRuntime, plannerService, tree, workRoot])

  const onSaveMemoryIndex = useCallback(
    async (kind: 'character' | 'foreshadow', content: string) => {
      if (!workRoot || !isTauriRuntime) return
      const path = kind === 'character' ? '.novel/state/character-state-index.md' : '.novel/state/foreshadow-index.md'
      const meta = kind === 'character' ? characterStateIndexMeta : foreshadowIndexMeta
      await writeText(path, serializeMemoryIndexDocument(content, { ...meta, source: 'manual' }))
      await refreshMemoryIndices()
    },
    [characterStateIndexMeta, foreshadowIndexMeta, isTauriRuntime, refreshMemoryIndices, workRoot],
  )

  const onToggleMemoryIndexLock = useCallback(
    async (kind: 'character' | 'foreshadow') => {
      if (!workRoot || !isTauriRuntime) return
      const path = kind === 'character' ? '.novel/state/character-state-index.md' : '.novel/state/foreshadow-index.md'
      const content = kind === 'character' ? characterStateIndexContent : foreshadowIndexContent
      const meta = kind === 'character' ? characterStateIndexMeta : foreshadowIndexMeta
      await writeText(path, serializeMemoryIndexDocument(content, { ...meta, locked: !(meta?.locked === true) }))
      await refreshMemoryIndices()
    },
    [characterStateIndexContent, characterStateIndexMeta, foreshadowIndexContent, foreshadowIndexMeta, isTauriRuntime, refreshMemoryIndices, workRoot],
  )

  const onRestoreMemoryIndexAuto = useCallback(
    async (kind: 'character' | 'foreshadow') => {
      if (!workRoot || !isTauriRuntime) return
      const path = kind === 'character' ? '.novel/state/character-state-index.md' : '.novel/state/foreshadow-index.md'
      const content = kind === 'character' ? characterStateIndexContent : foreshadowIndexContent
      await writeText(path, serializeMemoryIndexDocument(content, { source: 'auto', locked: false }))
      await refreshMemoryIndices()
    },
    [characterStateIndexContent, foreshadowIndexContent, isTauriRuntime, refreshMemoryIndices, workRoot],
  )

  return {
    memoryIndexLoading,
    characterStateIndexContent,
    foreshadowIndexContent,
    characterStateIndexMeta,
    foreshadowIndexMeta,
    refreshMemoryIndices,
    onSaveMemoryIndex,
    onToggleMemoryIndexLock,
    onRestoreMemoryIndexAuto,
  }
}

