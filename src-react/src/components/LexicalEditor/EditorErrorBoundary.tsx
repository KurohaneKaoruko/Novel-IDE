import { Component, type ReactNode } from 'react'
import { logError } from '../../utils/errorLogger'
import './EditorErrorBoundary.css'

interface EditorErrorBoundaryProps {
  children: ReactNode
  onRetry?: () => void
  fallbackToSimple?: () => void
}

interface EditorErrorBoundaryState {
  hasError: boolean
  error: Error | null
  retryCount: number
}

/**
 * Error boundary for Lexical editor initialization errors
 * Catches errors during editor initialization and provides recovery options
 */
export class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  constructor(props: EditorErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<EditorErrorBoundaryState> {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Editor initialization error:', error, errorInfo)
    
    // Log error using error logger
    logError('Editor initialization failed', error, {
      componentStack: errorInfo.componentStack,
      retryCount: this.state.retryCount,
    })
    
    // Also store in legacy format for backward compatibility
    try {
      const logs = JSON.parse(localStorage.getItem('editor_error_logs') || '[]')
      logs.push({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      })
      // Keep only last 10 errors
      if (logs.length > 10) {
        logs.shift()
      }
      localStorage.setItem('editor_error_logs', JSON.stringify(logs))
    } catch (e) {
      console.error('Failed to log error:', e)
    }
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }))
    
    if (this.props.onRetry) {
      this.props.onRetry()
    }
  }

  handleFallback = () => {
    if (this.props.fallbackToSimple) {
      this.props.fallbackToSimple()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-error-container">
          <div className="editor-error-content">
            <div className="editor-error-icon">⚠️</div>
            <h3 className="editor-error-title">编辑器初始化失败</h3>
            <p className="editor-error-message">
              {this.state.error?.message || '未知错误'}
            </p>
            <div className="editor-error-actions">
              <button 
                className="editor-error-button primary" 
                onClick={this.handleRetry}
              >
                重试
              </button>
              {this.state.retryCount >= 3 && this.props.fallbackToSimple && (
                <button 
                  className="editor-error-button secondary" 
                  onClick={this.handleFallback}
                >
                  使用简单编辑器
                </button>
              )}
            </div>
            {this.state.retryCount > 0 && (
              <p className="editor-error-hint">
                已重试 {this.state.retryCount} 次
              </p>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
