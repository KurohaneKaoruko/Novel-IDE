const UI_SETTINGS_STORAGE_KEY = 'novel-ide-ui-settings'

export type UITheme = 'light' | 'dark'
export type UIDensity = 'compact' | 'comfortable'
export type UIMotion = 'full' | 'reduced'

export interface UISettings {
  theme: UITheme
  density: UIDensity
  motion: UIMotion
  sidebarCollapsed: boolean
}

const DEFAULT_SETTINGS: UISettings = {
  theme: 'dark',
  density: 'comfortable',
  motion: 'full',
  sidebarCollapsed: false,
}

class UISettingsManager {
  private settings: UISettings
  private listeners: Set<(settings: UISettings) => void>

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS }
    this.listeners = new Set()
    this.loadFromStorage()
  }

  getSettings(): UISettings {
    return { ...this.settings }
  }

  updateSettings(updates: Partial<UISettings>): void {
    const next = {
      ...this.settings,
      ...updates,
    }
    if (!this.isValid(next)) {
      return
    }
    this.settings = next
    this.saveToStorage()
    this.notifyListeners()
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS }
    this.saveToStorage()
    this.notifyListeners()
  }

  subscribe(listener: (settings: UISettings) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private isValid(settings: UISettings): boolean {
    const validTheme = settings.theme === 'light' || settings.theme === 'dark'
    const validDensity = settings.density === 'compact' || settings.density === 'comfortable'
    const validMotion = settings.motion === 'full' || settings.motion === 'reduced'
    return validTheme && validDensity && validMotion && typeof settings.sidebarCollapsed === 'boolean'
  }

  private notifyListeners(): void {
    const snapshot = this.getSettings()
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch (error) {
        console.error('Failed to notify UI settings listener:', error)
      }
    })
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(UI_SETTINGS_STORAGE_KEY)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return
      const next = {
        ...DEFAULT_SETTINGS,
        ...(parsed as Partial<UISettings>),
      }
      if (!this.isValid(next)) return
      this.settings = next
    } catch (error) {
      console.error('Failed to load UI settings from localStorage:', error)
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
    } catch (error) {
      console.error('Failed to save UI settings to localStorage:', error)
    }
  }
}

export const uiSettingsManager = new UISettingsManager()
