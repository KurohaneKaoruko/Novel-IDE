import { useCallback, useState } from 'react'
import { getProjectWritingSettings, initNovel, isTauriApp, setProjectWritingSettings } from '../tauri'

export type ProjectWritingSettingsState = {
  chapterWordTarget: number
  autoMinChars: number
  autoMaxChars: number
  autoMaxRounds: number
  autoMaxChapterAdvances: number
}

const DEFAULT_SETTINGS: ProjectWritingSettingsState = {
  chapterWordTarget: 2000,
  autoMinChars: 500,
  autoMaxChars: 2400,
  autoMaxRounds: 120,
  autoMaxChapterAdvances: 24,
}

function sanitizeForSave(settings: ProjectWritingSettingsState): ProjectWritingSettingsState {
  const chapterWordTarget = Number.isFinite(settings.chapterWordTarget) ? Math.max(0, Math.floor(settings.chapterWordTarget)) : 0
  const autoMinChars = Number.isFinite(settings.autoMinChars) ? Math.max(120, Math.floor(settings.autoMinChars)) : DEFAULT_SETTINGS.autoMinChars
  const rawMaxChars = Number.isFinite(settings.autoMaxChars)
    ? Math.max(180, Math.floor(settings.autoMaxChars))
    : DEFAULT_SETTINGS.autoMaxChars
  const autoMaxChars = Math.max(rawMaxChars, autoMinChars)
  const autoMaxRounds = Number.isFinite(settings.autoMaxRounds) ? Math.max(1, Math.floor(settings.autoMaxRounds)) : DEFAULT_SETTINGS.autoMaxRounds
  const autoMaxChapterAdvances = Number.isFinite(settings.autoMaxChapterAdvances)
    ? Math.max(0, Math.floor(settings.autoMaxChapterAdvances))
    : DEFAULT_SETTINGS.autoMaxChapterAdvances
  return {
    chapterWordTarget,
    autoMinChars,
    autoMaxChars,
    autoMaxRounds,
    autoMaxChapterAdvances,
  }
}

export function useProjectWritingSettings(workspaceRoot: string | null) {
  const [settings, setSettings] = useState<ProjectWritingSettingsState>(DEFAULT_SETTINGS)

  const updateSettings = useCallback((partial: Partial<ProjectWritingSettingsState>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }, [])

  const loadSettings = useCallback(async () => {
    if (!workspaceRoot || !isTauriApp()) return
    const loaded = await getProjectWritingSettings()
    setSettings({
      chapterWordTarget: loaded.chapter_word_target,
      autoMinChars: loaded.auto_min_chars,
      autoMaxChars: loaded.auto_max_chars,
      autoMaxRounds: loaded.auto_max_rounds,
      autoMaxChapterAdvances: loaded.auto_max_chapter_advances,
    })
  }, [workspaceRoot])

  const saveSettings = useCallback(async (override?: Partial<ProjectWritingSettingsState>) => {
    if (!workspaceRoot || !isTauriApp()) return
    await initNovel()
    const merged = sanitizeForSave({ ...settings, ...(override ?? {}) })
    const normalized = await setProjectWritingSettings({
      chapter_word_target: merged.chapterWordTarget,
      auto_min_chars: merged.autoMinChars,
      auto_max_chars: merged.autoMaxChars,
      auto_max_rounds: merged.autoMaxRounds,
      auto_max_chapter_advances: merged.autoMaxChapterAdvances,
    })
    setSettings({
      chapterWordTarget: normalized.chapter_word_target,
      autoMinChars: normalized.auto_min_chars,
      autoMaxChars: normalized.auto_max_chars,
      autoMaxRounds: normalized.auto_max_rounds,
      autoMaxChapterAdvances: normalized.auto_max_chapter_advances,
    })
  }, [settings, workspaceRoot])

  return {
    settings,
    updateSettings,
    loadSettings,
    saveSettings,
  }
}
