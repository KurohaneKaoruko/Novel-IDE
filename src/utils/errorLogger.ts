export interface ErrorLog {
  id: string
  timestamp: string
  level: 'error' | 'warning' | 'info'
  category: 'editor' | 'file' | 'network' | 'system' | 'unknown'
  message: string
  stack?: string
  context?: Record<string, unknown>
}

const MAX_LOGS = 100
const STORAGE_KEY = 'editor_error_logs'

/**
 * Log an error to console and localStorage
 */
export function logError(
  message: string,
  error?: Error | unknown,
  context?: Record<string, unknown>
): void {
  const errorLog: ErrorLog = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: 'error',
    category: categorizeError(message, error),
    message,
    stack: error instanceof Error ? error.stack : undefined,
    context,
  }

  // Log to console
  console.error('[Error]', message, error, context)

  // Store in localStorage
  storeLog(errorLog)
}

/**
 * Log a warning to console and localStorage
 */
export function logWarning(
  message: string,
  context?: Record<string, unknown>
): void {
  const errorLog: ErrorLog = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: 'warning',
    category: categorizeError(message),
    message,
    context,
  }

  // Log to console
  console.warn('[Warning]', message, context)

  // Store in localStorage
  storeLog(errorLog)
}

/**
 * Log an info message to console and localStorage
 */
export function logInfo(
  message: string,
  context?: Record<string, unknown>
): void {
  const errorLog: ErrorLog = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'system',
    message,
    context,
  }

  // Log to console
  console.info('[Info]', message, context)

  // Store in localStorage
  storeLog(errorLog)
}

/**
 * Get all error logs from localStorage
 */
export function getErrorLogs(): ErrorLog[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    
    const logs = JSON.parse(stored)
    return Array.isArray(logs) ? logs : []
  } catch (e) {
    console.error('Failed to get error logs:', e)
    return []
  }
}

/**
 * Clear all error logs from localStorage
 */
export function clearErrorLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    console.log('Error logs cleared')
  } catch (e) {
    console.error('Failed to clear error logs:', e)
  }
}

/**
 * Export error logs as JSON string
 */
export function exportErrorLogs(): string {
  const logs = getErrorLogs()
  return JSON.stringify(logs, null, 2)
}

/**
 * Get error logs filtered by category
 */
export function getErrorLogsByCategory(category: ErrorLog['category']): ErrorLog[] {
  return getErrorLogs().filter((log) => log.category === category)
}

/**
 * Get error logs filtered by level
 */
export function getErrorLogsByLevel(level: ErrorLog['level']): ErrorLog[] {
  return getErrorLogs().filter((log) => log.level === level)
}

/**
 * Get recent error logs (last N logs)
 */
export function getRecentErrorLogs(count: number = 10): ErrorLog[] {
  const logs = getErrorLogs()
  return logs.slice(-count).reverse()
}

// --- Private helpers ---

function storeLog(log: ErrorLog): void {
  try {
    const logs = getErrorLogs()
    logs.push(log)
    
    // Keep only last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS)
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs))
  } catch (e) {
    console.error('Failed to store error log:', e)
  }
}

function categorizeError(message: string, error?: Error | unknown): ErrorLog['category'] {
  const msg = message.toLowerCase()
  const errMsg = error instanceof Error ? error.message.toLowerCase() : ''
  
  if (msg.includes('editor') || msg.includes('lexical') || errMsg.includes('editor')) {
    return 'editor'
  }
  if (msg.includes('file') || msg.includes('save') || msg.includes('read') || errMsg.includes('file')) {
    return 'file'
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('request') || errMsg.includes('network')) {
    return 'network'
  }
  if (msg.includes('system') || msg.includes('permission') || errMsg.includes('system')) {
    return 'system'
  }
  
  return 'unknown'
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
