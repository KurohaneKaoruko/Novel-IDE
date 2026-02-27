import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import './index.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'

type PrismLike = Record<string, unknown>

async function ensurePrismGlobal(): Promise<void> {
  const globalWithPrism = globalThis as typeof globalThis & { Prism?: PrismLike }
  if (globalWithPrism.Prism) {
    return
  }

  const prismModule = (await import('prismjs')) as { default?: PrismLike } & PrismLike
  const prism = prismModule.default ?? prismModule
  globalWithPrism.Prism = prism
}

function normalizeStartupError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function renderStartupError(root: Root, error: unknown): void {
  const normalized = normalizeStartupError(error)
  root.render(
    <div className="app-error-screen" role="alert">
      <h1 className="app-error-title">Startup failed</h1>
      <p className="app-error-message">
        The app could not initialize. Check the error details and reload.
      </p>
      <pre className="app-error-details">
        {normalized.message}
        {normalized.stack ? `\n\n${normalized.stack}` : ''}
      </pre>
      <button className="app-error-button" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>,
  )
}

async function bootstrap(root: Root): Promise<void> {
  await ensurePrismGlobal()

  const [{ default: App }, { DiffProvider }] = await Promise.all([
    import('./App.tsx'),
    import('./contexts/DiffContext'),
  ])

  root.render(
    <StrictMode>
      <AppErrorBoundary>
        <DiffProvider>
          <App />
        </DiffProvider>
      </AppErrorBoundary>
    </StrictMode>,
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element "#root" was not found.')
}

const root = createRoot(rootElement)

void bootstrap(root).catch((error) => {
  console.error('Application bootstrap failed:', error)
  renderStartupError(root, error)
})
