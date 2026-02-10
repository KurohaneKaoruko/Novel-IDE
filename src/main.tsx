import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DiffProvider } from './contexts/DiffContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiffProvider>
      <App />
    </DiffProvider>
  </StrictMode>,
)
