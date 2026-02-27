import { message, confirm } from '@tauri-apps/plugin-dialog'
import { isTauriApp } from '../tauri'
import { logError, logWarning } from './errorLogger'

export interface SaveErrorOptions {
  filePath: string
  content: string
  error: Error
  onRetry?: () => Promise<void>
  onSaveAs?: () => Promise<void>
}

/**
 * Handle file save errors with user-friendly messages and recovery options
 */
export async function handleFileSaveError(options: SaveErrorOptions): Promise<'retry' | 'save-as' | 'cancel'> {
  const { filePath, content, error, onRetry, onSaveAs } = options
  
  // Log error using error logger
  logError('File save failed', error, {
    filePath,
    contentLength: content.length,
    errorType: error.name,
  })
  
  // Save content to backup in localStorage
  try {
    const backupKey = `backup:${filePath}`
    const backupData = {
      content,
      timestamp: Date.now(),
      error: error.message,
    }
    localStorage.setItem(backupKey, JSON.stringify(backupData))
    console.log('Content backed up to localStorage:', backupKey)
  } catch (e) {
    console.error('Failed to backup content:', e)
    logWarning('Failed to backup content', { filePath, error: String(e) })
  }
  
  // Determine error type and message
  let errorMessage = '保存失败'
  let errorDetails = error.message
  
  if (error.message.includes('permission') || error.message.includes('denied')) {
    errorMessage = '保存失败：权限不足'
    errorDetails = '无法写入文件，请检查文件权限或选择其他位置保存。'
  } else if (error.message.includes('disk') || error.message.includes('space')) {
    errorMessage = '保存失败：磁盘空间不足'
    errorDetails = '磁盘空间不足，请清理磁盘空间后重试。'
  } else if (error.message.includes('not found') || error.message.includes('does not exist')) {
    errorMessage = '保存失败：文件或目录不存在'
    errorDetails = '文件路径不存在，请检查路径或选择其他位置保存。'
  }
  
  // Show error dialog
  if (isTauriApp()) {
    await message(`${errorMessage}\n\n${errorDetails}\n\n内容已自动备份到本地缓存。`, {
      title: '保存错误',
      kind: 'error',
    })
    
    // Ask user what to do
    const shouldRetry = await confirm('是否重试保存？', {
      title: '保存失败',
      kind: 'warning',
      okLabel: '重试',
      cancelLabel: '取消',
    })
    
    if (shouldRetry) {
      if (onRetry) {
        try {
          await onRetry()
          return 'retry'
        } catch (retryError) {
          // Retry failed, offer save as option
          const shouldSaveAs = await confirm('重试失败，是否另存为？', {
            title: '保存失败',
            kind: 'warning',
            okLabel: '另存为',
            cancelLabel: '取消',
          })
          
          if (shouldSaveAs && onSaveAs) {
            await onSaveAs()
            return 'save-as'
          }
        }
      }
      return 'retry'
    } else {
      // Offer save as option
      const shouldSaveAs = await confirm('是否另存为到其他位置？', {
        title: '保存失败',
        kind: 'info',
        okLabel: '另存为',
        cancelLabel: '取消',
      })
      
      if (shouldSaveAs && onSaveAs) {
        await onSaveAs()
        return 'save-as'
      }
    }
  } else {
    // Browser environment - use window.alert and confirm
    window.alert(`${errorMessage}\n\n${errorDetails}\n\n内容已自动备份到本地缓存。`)
    
    const shouldRetry = window.confirm('是否重试保存？')
    if (shouldRetry) {
      if (onRetry) {
        try {
          await onRetry()
          return 'retry'
        } catch (retryError) {
          const shouldSaveAs = window.confirm('重试失败，是否另存为？')
          if (shouldSaveAs && onSaveAs) {
            await onSaveAs()
            return 'save-as'
          }
        }
      }
      return 'retry'
    } else {
      const shouldSaveAs = window.confirm('是否另存为到其他位置？')
      if (shouldSaveAs && onSaveAs) {
        await onSaveAs()
        return 'save-as'
      }
    }
  }
  
  return 'cancel'
}

/**
 * Get backup content from localStorage
 */
export function getBackupContent(filePath: string): { content: string; timestamp: number } | null {
  try {
    const backupKey = `backup:${filePath}`
    const backupData = localStorage.getItem(backupKey)
    if (!backupData) return null
    
    const parsed = JSON.parse(backupData)
    return {
      content: parsed.content,
      timestamp: parsed.timestamp,
    }
  } catch (e) {
    console.error('Failed to get backup content:', e)
    return null
  }
}

/**
 * Clear backup content from localStorage
 */
export function clearBackupContent(filePath: string): void {
  try {
    const backupKey = `backup:${filePath}`
    localStorage.removeItem(backupKey)
  } catch (e) {
    console.error('Failed to clear backup content:', e)
  }
}
