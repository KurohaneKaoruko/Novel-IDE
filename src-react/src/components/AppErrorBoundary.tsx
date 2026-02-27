import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('App runtime error:', error, errorInfo)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="app-error-screen" role="alert">
        <h1 className="app-error-title">Application crashed</h1>
        <p className="app-error-message">
          A runtime error interrupted rendering. Open DevTools for details, then reload.
        </p>
        <pre className="app-error-details">{this.state.error?.message ?? 'Unknown error'}</pre>
        <button className="app-error-button" onClick={this.handleReload}>
          Reload
        </button>
      </div>
    )
  }
}
