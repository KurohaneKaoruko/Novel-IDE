import { useEffect, useRef } from 'react'
import './SimpleFallbackEditor.css'

interface SimpleFallbackEditorProps {
  initialContent: string
  onChange: (content: string) => void
  placeholder?: string
  readOnly?: boolean
}

/**
 * Simple fallback editor using textarea
 * Used when Lexical editor fails to initialize
 */
export function SimpleFallbackEditor({
  initialContent,
  onChange,
  placeholder = '开始写作...',
  readOnly = false,
}: SimpleFallbackEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== initialContent) {
      textareaRef.current.value = initialContent
    }
  }, [initialContent])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value)
  }

  return (
    <div className="simple-fallback-editor">
      <div className="fallback-editor-notice">
        ⚠️ 使用简单编辑器模式（部分功能不可用）
      </div>
      <textarea
        ref={textareaRef}
        className="fallback-editor-textarea"
        defaultValue={initialContent}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={false}
      />
    </div>
  )
}
