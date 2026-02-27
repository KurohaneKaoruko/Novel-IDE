'use client'

import './Loading.css'

type LoadingProps = {
  size?: 'small' | 'medium' | 'large'
  text?: string
  fullScreen?: boolean
}

export function Loading({ size = 'medium', text, fullScreen = false }: LoadingProps) {
  const content = (
    <div className={`loading loading-${size}`}>
      <div className="loading-spinner">
        <div className="loading-spinner-ring"></div>
        <div className="loading-spinner-ring"></div>
        <div className="loading-spinner-ring"></div>
      </div>
      {text && <div className="loading-text">{text}</div>}
    </div>
  )

  if (fullScreen) {
    return <div className="loading-fullscreen">{content}</div>
  }

  return content
}

export function LoadingOverlay({ 
  loading, 
  children 
}: { 
  loading: boolean
  children: React.ReactNode 
}) {
  return (
    <div className="loading-overlay-container">
      {children}
      {loading && (
        <div className="loading-overlay">
          <Loading text="加载中..." />
        </div>
      )}
    </div>
  )
}

export function LoadingDots({ text = '加载中' }: { text?: string }) {
  return (
    <span className="loading-dots">
      {text}
      <span className="loading-dots-span">.</span>
      <span className="loading-dots-span">.</span>
      <span className="loading-dots-span">.</span>
    </span>
  )
}
