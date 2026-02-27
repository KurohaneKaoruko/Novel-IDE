import { useEffect, useRef } from 'react'

export interface AutoSaveOptions {
  filePath: string
  content: string
  enabled: boolean
  intervalMs?: number
}

/**
 * Hook to automatically save editor content to localStorage
 * Saves content every 30 seconds (or custom interval) to prevent data loss
 */
export function useAutoSave({
  filePath,
  content,
  enabled,
  intervalMs = 30000, // 30 seconds default
}: AutoSaveOptions) {
  const lastSavedContentRef = useRef<string>('')
  const lastSavedTimeRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled || !filePath) return

    const timer = setInterval(() => {
      // Only save if content has changed
      if (content === lastSavedContentRef.current) {
        return
      }

      try {
        const cacheKey = `autosave:${filePath}`
        const cacheData = {
          content,
          timestamp: Date.now(),
          filePath,
        }
        
        localStorage.setItem(cacheKey, JSON.stringify(cacheData))
        lastSavedContentRef.current = content
        lastSavedTimeRef.current = Date.now()
        
        console.log(`Auto-saved: ${filePath} at ${new Date().toLocaleTimeString()}`)
      } catch (e) {
        console.error('Auto-save failed:', e)
      }
    }, intervalMs)

    return () => clearInterval(timer)
  }, [filePath, content, enabled, intervalMs])

  return {
    lastSavedTime: lastSavedTimeRef.current,
  }
}

/**
 * Get auto-saved content from localStorage
 */
export function getAutoSavedContent(filePath: string): {
  content: string
  timestamp: number
} | null {
  try {
    const cacheKey = `autosave:${filePath}`
    const cached = localStorage.getItem(cacheKey)
    
    if (!cached) return null
    
    const parsed = JSON.parse(cached)
    return {
      content: parsed.content,
      timestamp: parsed.timestamp,
    }
  } catch (e) {
    console.error('Failed to get auto-saved content:', e)
    return null
  }
}

/**
 * Clear auto-saved content from localStorage
 */
export function clearAutoSavedContent(filePath: string): void {
  try {
    const cacheKey = `autosave:${filePath}`
    localStorage.removeItem(cacheKey)
    console.log(`Cleared auto-save: ${filePath}`)
  } catch (e) {
    console.error('Failed to clear auto-saved content:', e)
  }
}

/**
 * Get all auto-saved files
 */
export function getAllAutoSavedFiles(): Array<{
  filePath: string
  timestamp: number
}> {
  const files: Array<{ filePath: string; timestamp: number }> = []
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('autosave:')) {
        const cached = localStorage.getItem(key)
        if (cached) {
          const parsed = JSON.parse(cached)
          files.push({
            filePath: parsed.filePath,
            timestamp: parsed.timestamp,
          })
        }
      }
    }
  } catch (e) {
    console.error('Failed to get all auto-saved files:', e)
  }
  
  return files.sort((a, b) => b.timestamp - a.timestamp)
}
