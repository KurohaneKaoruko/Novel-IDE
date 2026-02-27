/**
 * SensitiveWordHoverPlugin
 * 
 * Provides hover tooltips for sensitive words in the Lexical editor.
 * Shows word information and severity when hovering over sensitive word nodes.
 * 
 * Requirements: 6.2
 */

import { useEffect, useRef, useState } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $isSensitiveWordNode, type SensitiveWordSeverity } from '../nodes/SensitiveWordNode'
import { $getNearestNodeFromDOMNode } from 'lexical'
import './SensitiveWordHoverPlugin.css'

export interface SensitiveWordHoverPluginProps {
  // Whether hover tooltips are enabled
  enabled?: boolean
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  word: string
  severity: SensitiveWordSeverity
}

/**
 * Get severity text in Chinese
 */
function getSeverityText(severity: SensitiveWordSeverity): string {
  switch (severity) {
    case 'low':
      return '低 (Low)'
    case 'medium':
      return '中 (Medium)'
    case 'high':
      return '高 (High)'
  }
}

/**
 * Get severity emoji
 */
function getSeverityEmoji(severity: SensitiveWordSeverity): string {
  switch (severity) {
    case 'low':
      return '⚠️'
    case 'medium':
      return '⚠️'
    case 'high':
      return '🚫'
  }
}

/**
 * SensitiveWordHoverPlugin Component
 * 
 * Displays a tooltip when hovering over sensitive word nodes.
 */
export function SensitiveWordHoverPlugin({ enabled = true }: SensitiveWordHoverPluginProps) {
  const [editor] = useLexicalComposerContext()
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    word: '',
    severity: 'medium',
  })
  const tooltipTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setTooltip(prev => ({ ...prev, visible: false }))
      return
    }

    const rootElement = editor.getRootElement()
    if (!rootElement) return

    /**
     * Handle mouse move to detect hover over sensitive words
     */
    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Check if hovering over a sensitive word element
      if (target.classList.contains('sensitive-word')) {
        // Clear any existing timer
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current)
        }

        // Set a small delay before showing tooltip
        tooltipTimerRef.current = window.setTimeout(() => {
          // Get the node from DOM element
          editor.getEditorState().read(() => {
            const node = $getNearestNodeFromDOMNode(target)
            
            if (node && $isSensitiveWordNode(node)) {
              const word = node.getTextContent()
              const severity = node.getSeverity()
              
              // Calculate tooltip position
              const rect = target.getBoundingClientRect()
              const x = rect.left + rect.width / 2
              const y = rect.top - 10 // Position above the word

              setTooltip({
                visible: true,
                x,
                y,
                word,
                severity,
              })
            }
          })
        }, 300) // 300ms delay before showing tooltip
      } else {
        // Not hovering over sensitive word, hide tooltip
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current)
        }
        setTooltip(prev => ({ ...prev, visible: false }))
      }
    }

    /**
     * Handle mouse leave to hide tooltip
     */
    const handleMouseLeave = () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }
      setTooltip(prev => ({ ...prev, visible: false }))
    }

    // Add event listeners
    rootElement.addEventListener('mousemove', handleMouseMove)
    rootElement.addEventListener('mouseleave', handleMouseLeave)

    // Cleanup
    return () => {
      rootElement.removeEventListener('mousemove', handleMouseMove)
      rootElement.removeEventListener('mouseleave', handleMouseLeave)
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }
    }
  }, [editor, enabled])

  // Don't render if not visible
  if (!tooltip.visible) {
    return null
  }

  const severityText = getSeverityText(tooltip.severity)
  const severityEmoji = getSeverityEmoji(tooltip.severity)

  return (
    <div
      className="sensitive-word-tooltip"
      style={{
        left: `${tooltip.x}px`,
        top: `${tooltip.y}px`,
      }}
    >
      <div className="sensitive-word-tooltip-header">
        <span className="sensitive-word-tooltip-emoji">{severityEmoji}</span>
        <span className="sensitive-word-tooltip-title">敏感词检测</span>
      </div>
      <div className="sensitive-word-tooltip-content">
        <div className="sensitive-word-tooltip-row">
          <span className="sensitive-word-tooltip-label">词语:</span>
          <span className="sensitive-word-tooltip-value">{tooltip.word}</span>
        </div>
        <div className="sensitive-word-tooltip-row">
          <span className="sensitive-word-tooltip-label">严重程度:</span>
          <span className={`sensitive-word-tooltip-severity sensitive-word-tooltip-severity-${tooltip.severity}`}>
            {severityText}
          </span>
        </div>
      </div>
      <div className="sensitive-word-tooltip-footer">
        💡 建议: 请检查此内容是否符合发布平台的要求
      </div>
    </div>
  )
}
