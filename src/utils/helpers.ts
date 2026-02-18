/**
 * Utility functions for working with file paths
 */

/**
 * Get the file name from a path
 */
export function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || ''
}

/**
 * Get the file extension from a path
 */
export function getFileExtension(path: string): string {
  const name = getFileName(path)
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : ''
}

/**
 * Get the directory path from a file path
 */
export function getDirectory(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  parts.pop()
  return parts.join('/')
}

/**
 * Get the file name without extension
 */
export function getFileNameWithoutExtension(path: string): string {
  const name = getFileName(path)
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(0, dotIndex) : name
}

/**
 * Check if a path is a markdown file
 */
export function isMarkdownFile(path: string): boolean {
  const ext = getFileExtension(path)
  return ['md', 'markdown', 'mdown', 'mkd'].includes(ext)
}

/**
 * Check if a path is a novel-related directory
 */
export function isNovelDirectory(dir: string): boolean {
  const name = dir.toLowerCase()
  return name === 'concept' || name === 'outline' || name === 'stories'
}

/**
 * Format file size to human readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * Format date to relative time
 */
export function formatRelativeTime(date: Date | number): string {
  const now = Date.now()
  const then = typeof date === 'number' ? date : date.getTime()
  const diff = now - then

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天前`
  if (hours > 0) return `${hours}小时前`
  if (minutes > 0) return `${minutes}分钟前`
  return '刚刚'
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 11)}`
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}
