/**
 * EditorConfigManager
 * Manages editor configuration settings (font, theme, line height, width, auto-save interval)
 * Provides read/write operations for editor configuration
 */

import { EDITOR_CONFIG_STORAGE_KEY, LEGACY_EDITOR_CONFIG_STORAGE_KEY } from '../branding'

export interface EditorUserConfig {
  // Font settings
  fontFamily: string
  fontSize: number
  
  // Theme settings
  theme: 'light' | 'dark'
  
  // Layout settings
  lineHeight: number
  editorWidth: 'centered' | 'full'
  
  // Auto-save settings
  autoSaveInterval: number // in seconds, 0 = disabled
  
  // Zoom settings
  zoom: number // 0.5 to 2.0, default 1.0
}

// Default configuration
const DEFAULT_CONFIG: EditorUserConfig = {
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 16,
  theme: 'dark',
  lineHeight: 1.8,
  editorWidth: 'centered',
  autoSaveInterval: 30, // 30 seconds
  zoom: 1.0, // default zoom level
}

// LocalStorage key for editor configuration
const STORAGE_KEY = EDITOR_CONFIG_STORAGE_KEY
const LEGACY_STORAGE_KEY = LEGACY_EDITOR_CONFIG_STORAGE_KEY

class EditorConfigManager {
  private config: EditorUserConfig
  private listeners: Set<(config: EditorUserConfig) => void>
  
  constructor() {
    this.config = { ...DEFAULT_CONFIG }
    this.listeners = new Set()
    
    // Load configuration from localStorage on initialization
    this.loadFromStorage()
  }
  
  /**
   * Get current editor configuration
   */
  getConfig(): EditorUserConfig {
    return { ...this.config }
  }
  
  /**
   * Update editor configuration (partial update)
   */
  updateConfig(updates: Partial<EditorUserConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    }
    
    // Save to localStorage
    this.saveToStorage()
    
    // Notify listeners
    this.notifyListeners()
  }
  
  /**
   * Set complete editor configuration
   */
  setConfig(config: EditorUserConfig): void {
    this.config = { ...config }
    
    // Save to localStorage
    this.saveToStorage()
    
    this.notifyListeners()
  }
  
  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = { ...DEFAULT_CONFIG }
    
    // Save to localStorage
    this.saveToStorage()
    
    this.notifyListeners()
  }
  
  /**
   * Subscribe to configuration changes
   */
  subscribe(listener: (config: EditorUserConfig) => void): () => void {
    this.listeners.add(listener)
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener)
    }
  }
  
  /**
   * Notify all listeners of configuration changes
   */
  private notifyListeners(): void {
    const config = this.getConfig()
    this.listeners.forEach((listener) => {
      try {
        listener(config)
      } catch (error) {
        console.error('Error in config listener:', error)
      }
    })
  }
  
  /**
   * Increase zoom level
   */
  zoomIn(): void {
    const newZoom = Math.min(2.0, this.config.zoom + 0.1)
    this.updateConfig({ zoom: newZoom })
  }
  
  /**
   * Decrease zoom level
   */
  zoomOut(): void {
    const newZoom = Math.max(0.5, this.config.zoom - 0.1)
    this.updateConfig({ zoom: newZoom })
  }
  
  /**
   * Reset zoom to default (1.0)
   */
  resetZoom(): void {
    this.updateConfig({ zoom: 1.0 })
  }
  
  /**
   * Get CSS variables for current configuration
   * Returns an object that can be applied to a DOM element's style
   */
  getCSSVariables(): Record<string, string> {
    return {
      '--editor-font-family': this.config.fontFamily,
      '--editor-font-size': `${this.config.fontSize}px`,
      '--editor-line-height': String(this.config.lineHeight),
      '--editor-max-width': this.config.editorWidth === 'centered' ? '800px' : '100%',
      '--editor-zoom': String(this.config.zoom),
    }
  }
  
  /**
   * Validate configuration values
   */
  validateConfig(config: Partial<EditorUserConfig>): boolean {
    if (config.fontSize !== undefined) {
      if (config.fontSize < 10 || config.fontSize > 32) {
        return false
      }
    }
    
    if (config.lineHeight !== undefined) {
      if (config.lineHeight < 1.0 || config.lineHeight > 3.0) {
        return false
      }
    }
    
    if (config.autoSaveInterval !== undefined) {
      if (config.autoSaveInterval < 0 || config.autoSaveInterval > 600) {
        return false
      }
    }
    
    if (config.theme !== undefined) {
      if (config.theme !== 'light' && config.theme !== 'dark') {
        return false
      }
    }
    
    if (config.editorWidth !== undefined) {
      if (config.editorWidth !== 'centered' && config.editorWidth !== 'full') {
        return false
      }
    }
    
    if (config.zoom !== undefined) {
      if (config.zoom < 0.5 || config.zoom > 2.0) {
        return false
      }
    }
    
    return true
  }
  
  /**
   * Load configuration from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!stored) {
        return
      }
      
      const parsed: unknown = JSON.parse(stored)
      if (typeof parsed !== 'object' || parsed === null) {
        return
      }
      
      // Validate and merge with defaults
      const config = parsed as Partial<EditorUserConfig>
      if (this.validateConfig(config)) {
        this.config = {
          ...DEFAULT_CONFIG,
          ...config,
        }
        if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config))
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        }
      }
    } catch (error) {
      console.error('Failed to load editor config from localStorage:', error)
      // Keep default config on error
    }
  }
  
  /**
   * Save configuration to localStorage
   */
  private saveToStorage(): void {
    try {
      const serialized = JSON.stringify(this.config)
      localStorage.setItem(STORAGE_KEY, serialized)
    } catch (error) {
      console.error('Failed to save editor config to localStorage:', error)
    }
  }
}

// Export singleton instance
export const editorConfigManager = new EditorConfigManager()
