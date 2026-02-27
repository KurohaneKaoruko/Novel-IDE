'use client'

import { useEffect, useCallback } from 'react'
import type { ChangeSet } from '../services/ModificationService'
import { useDiff } from '../contexts/DiffContext'

type UseAutoOpenModifiedFilesOptions = {
  onOpenFile: (path: string) => void | Promise<void>
  enabled?: boolean
}

/**
 * Hook that automatically opens files when AI modifies them
 */
export function useAutoOpenModifiedFiles(
  options: UseAutoOpenModifiedFilesOptions
) {
  const { onOpenFile, enabled = true } = options
  const { changeSets, activeChangeSetId } = useDiff()

  // Track which files have been auto-opened
  const openedFilesRef = new Set<string>()

  const openModifiedFile = useCallback(
    async (changeSet: ChangeSet) => {
      // Open the first modified file
      if (changeSet.filePath && !openedFilesRef.has(changeSet.id)) {
        openedFilesRef.add(changeSet.id)
        await onOpenFile(changeSet.filePath)
      }
    },
    [onOpenFile]
  )

  useEffect(() => {
    if (!enabled) return

    // When a new change set is added, open the modified file
    for (const [id, changeSet] of changeSets) {
      if (id === activeChangeSetId) {
        openModifiedFile(changeSet)
      }
    }
  }, [changeSets, activeChangeSetId, enabled, openModifiedFile])

  // Reset when all change sets are cleared
  useEffect(() => {
    if (changeSets.size === 0) {
      openedFilesRef.clear()
    }
  }, [changeSets])

  return {
    openedFiles: Array.from(openedFilesRef),
  }
}

/**
 * Hook that highlights modified lines in the editor
 */
export function useHighlightModifiedLines() {
  const { activeChangeSetId, getChangeSet } = useDiff()

  const activeChangeSet = activeChangeSetId ? getChangeSet(activeChangeSetId) : null

  // Get line ranges to highlight
  const highlightRanges = activeChangeSet
    ? activeChangeSet.modifications.map((mod) => ({
        start: mod.lineStart,
        end: mod.lineEnd,
        type: mod.type,
      }))
    : []

  return {
    highlightRanges,
    hasActiveHighlight: highlightRanges.length > 0,
  }
}
