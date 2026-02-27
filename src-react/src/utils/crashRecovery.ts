import { getAutoSavedContent, clearAutoSavedContent } from '../hooks/useAutoSave'
import { readText } from '../tauri'

export interface RecoveryCandidate {
  filePath: string
  cachedContent: string
  cachedTimestamp: number
  savedContent?: string
  isDifferent: boolean
}

/**
 * Check for auto-saved content that might need recovery
 * Compares cached content with saved file content
 */
export async function checkForRecovery(filePath: string): Promise<RecoveryCandidate | null> {
  try {
    // Get auto-saved content from localStorage
    const cached = getAutoSavedContent(filePath)
    if (!cached) return null

    // Try to read the saved file content
    let savedContent: string | undefined
    try {
      savedContent = await readText(filePath)
    } catch (e) {
      // File might not exist or be inaccessible
      console.warn('Could not read saved file:', e)
    }

    // If saved content matches cached content, no recovery needed
    if (savedContent === cached.content) {
      clearAutoSavedContent(filePath)
      return null
    }

    // Recovery candidate found
    return {
      filePath,
      cachedContent: cached.content,
      cachedTimestamp: cached.timestamp,
      savedContent,
      isDifferent: true,
    }
  } catch (e) {
    console.error('Failed to check for recovery:', e)
    return null
  }
}

/**
 * Get all recovery candidates from localStorage
 */
export async function getAllRecoveryCandidates(): Promise<RecoveryCandidate[]> {
  const candidates: RecoveryCandidate[] = []

  try {
    // Collect all autosave keys first (before any modifications to localStorage)
    const autosaveKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('autosave:')) {
        autosaveKeys.push(key)
      }
    }

    // Now check each file for recovery
    for (const key of autosaveKeys) {
      const filePath = key.replace('autosave:', '')
      const candidate = await checkForRecovery(filePath)
      if (candidate) {
        candidates.push(candidate)
      }
    }
  } catch (e) {
    console.error('Failed to get recovery candidates:', e)
  }

  // Sort by timestamp (newest first)
  return candidates.sort((a, b) => b.cachedTimestamp - a.cachedTimestamp)
}

/**
 * Accept recovery - use cached content
 */
export function acceptRecovery(filePath: string): void {
  // Keep the auto-saved content, it will be used when opening the file
  console.log('Recovery accepted for:', filePath)
}

/**
 * Reject recovery - discard cached content
 */
export function rejectRecovery(filePath: string): void {
  clearAutoSavedContent(filePath)
  console.log('Recovery rejected for:', filePath)
}

/**
 * Format timestamp for display
 */
export function formatRecoveryTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`
  
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
