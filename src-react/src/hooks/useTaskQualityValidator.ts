import { useCallback } from 'react'
import { isTauriApp, validateNovelTaskQuality } from '../tauri'
import type { NovelTask } from '../services'

export type TaskQualityResult = {
  ok: boolean
  reason: string | null
}

export function useTaskQualityValidator() {
  const validateTaskQuality = useCallback(
    async (task: NovelTask, assistantText: string, taskPool: NovelTask[]): Promise<TaskQualityResult> => {
      if (!isTauriApp()) return { ok: true, reason: null }
      const result = await validateNovelTaskQuality(
        {
          id: task.id,
          target_words: task.target_words,
          scope: task.scope,
          depends_on: task.depends_on,
          acceptance_checks: task.acceptance_checks,
        },
        assistantText,
        taskPool.map((item) => ({
          id: item.id,
          target_words: item.target_words,
          scope: item.scope,
          depends_on: item.depends_on,
          acceptance_checks: item.acceptance_checks,
        })),
      )
      return { ok: !!result.ok, reason: result.reason ?? null }
    },
    [],
  )

  return { validateTaskQuality }
}
