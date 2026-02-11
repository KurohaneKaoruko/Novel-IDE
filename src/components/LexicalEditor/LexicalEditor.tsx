import { useEffect, useRef, useState, useMemo, type MutableRefObject } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CodeNode } from '@lexical/code'
import { LinkNode } from '@lexical/link'
import { $convertToMarkdownString, TRANSFORMERS } from '@lexical/markdown'
import { marked } from 'marked'
import { 
  $getRoot, 
  $createParagraphNode, 
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  UNDO_COMMAND,
  REDO_COMMAND,
} from 'lexical'
import type { EditorState, LexicalEditor as LexicalEditorType } from 'lexical'
import type { LexicalEditorProps } from '../../types/editor'
import { AIAssistPlugin } from './plugins/AIAssistPlugin'
import { SensitiveWordPlugin } from './plugins/SensitiveWordPlugin'
import { SensitiveWordHoverPlugin } from './plugins/SensitiveWordHoverPlugin'
import { MarkdownPlugin } from './plugins/MarkdownPlugin'
import { MarkdownToolbar } from './plugins/MarkdownToolbar'
import { ContextMenuPlugin } from './plugins/ContextMenuPlugin'
import { SensitiveWordNode } from './nodes/SensitiveWordNode'
import { EditorErrorBoundary } from './EditorErrorBoundary'
import { SimpleFallbackEditor } from './SimpleFallbackEditor'
import { logError } from '../../utils/errorLogger'
import './LexicalEditor.css'

/**
 * Extended editor interface with custom methods
 */
export interface ExtendedLexicalEditor extends LexicalEditorType {
  getSelection: () => any
  getSelectedText: () => string
  getContent: () => string
  setContent: (content: string) => void
  exportToMarkdown: () => string
  exportToHTML: () => string
}

/**
 * Apply editor configuration CSS variables to the editor wrapper
 */
function applyEditorConfig(element: HTMLElement): void {
  // Import editorConfigManager dynamically to avoid circular dependencies
  import('../../services/EditorConfigManager').then(({ editorConfigManager }) => {
    const cssVars = editorConfigManager.getCSSVariables()
    Object.entries(cssVars).forEach(([key, value]) => {
      element.style.setProperty(key, value)
    })
  }).catch((error) => {
    console.error('Failed to apply editor config:', error)
  })
}

/**
 * Plugin to listen for config changes and update CSS variables
 */
function ConfigListenerPlugin({ wrapperRef }: { wrapperRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    // Import editorConfigManager dynamically
    let unsubscribe: (() => void) | undefined
    
    import('../../services/EditorConfigManager').then(({ editorConfigManager }) => {
      // Subscribe to config changes
      unsubscribe = editorConfigManager.subscribe(() => {
        if (wrapperRef.current) {
          const cssVars = editorConfigManager.getCSSVariables()
          Object.entries(cssVars).forEach(([key, value]) => {
            wrapperRef.current!.style.setProperty(key, value)
          })
        }
      })
    }).catch((error) => {
      console.error('Failed to subscribe to config changes:', error)
    })
    
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [wrapperRef])
  
  return null
}

/**
 * Plugin to set initial content
 */
function InitialContentPlugin({
  content,
  lastEditorContentRef,
}: {
  content: string
  lastEditorContentRef: MutableRefObject<string | null>
}) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    // Skip full-document sync when this change came from local editor input.
    if (content === lastEditorContentRef.current) {
      return
    }
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      
      // Split content by newlines and create paragraphs
      const lines = content.split('\n')
      lines.forEach((line) => {
        const paragraph = $createParagraphNode()
        if (line) {
          paragraph.append($createTextNode(line))
        }
        root.append(paragraph)
      })
    })
  }, [editor, content, lastEditorContentRef])
  
  return null
}

/**
 * Plugin to expose editor instance via ref with custom methods
 */
function EditorRefPlugin({ 
  editorRef, 
  onReady 
}: { 
  editorRef?: React.MutableRefObject<any>
  onReady?: (editor: any) => void
}) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    // Extend editor with custom methods
    const extendedEditor = editor as ExtendedLexicalEditor
    
    // Add getSelection method
    extendedEditor.getSelection = () => {
      let selection = null
      editor.getEditorState().read(() => {
        selection = $getSelection()
      })
      return selection
    }
    
    // Add getSelectedText method
    extendedEditor.getSelectedText = () => {
      let selectedText = ''
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selectedText = selection.getTextContent()
        }
      })
      return selectedText
    }
    
    // Add getContent method - returns complete editor content
    extendedEditor.getContent = () => {
      let content = ''
      editor.getEditorState().read(() => {
        const root = $getRoot()
        content = root.getTextContent()
      })
      return content
    }
    
    // Add setContent method - sets editor content (handles both plain text and rich text)
    extendedEditor.setContent = (content: string) => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        
        // Split content by newlines and create paragraphs
        const lines = content.split('\n')
        lines.forEach((line) => {
          const paragraph = $createParagraphNode()
          if (line) {
            paragraph.append($createTextNode(line))
          }
          root.append(paragraph)
        })
      })
    }
    
    // Add exportToMarkdown method - exports editor content as Markdown
    extendedEditor.exportToMarkdown = () => {
      let markdown = ''
      editor.getEditorState().read(() => {
        markdown = $convertToMarkdownString(TRANSFORMERS)
      })
      return markdown
    }
    
    // Add exportToHTML method - exports editor content as HTML (via Markdown)
    extendedEditor.exportToHTML = () => {
      const markdown = extendedEditor.exportToMarkdown()
      const html = marked.parse(markdown) as string
      return html
    }
    
    if (editorRef) {
      editorRef.current = extendedEditor
    }
    if (onReady) {
      onReady(extendedEditor)
    }
  }, [editor, editorRef, onReady])
  
  return null
}

/**
 * Plugin to handle keyboard shortcuts for undo/redo and zoom
 * Ctrl+Z for undo, Ctrl+Y for redo
 * Ctrl+Plus for zoom in, Ctrl+Minus for zoom out, Ctrl+0 for reset zoom
 */
function KeyboardShortcutsPlugin() {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault()
          editor.dispatchCommand(UNDO_COMMAND, undefined)
        } else if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
          event.preventDefault()
          editor.dispatchCommand(REDO_COMMAND, undefined)
        } else if (event.key === '+' || event.key === '=') {
          // Zoom in
          event.preventDefault()
          import('../../services/EditorConfigManager').then(({ editorConfigManager }) => {
            editorConfigManager.zoomIn()
          })
        } else if (event.key === '-' || event.key === '_') {
          // Zoom out
          event.preventDefault()
          import('../../services/EditorConfigManager').then(({ editorConfigManager }) => {
            editorConfigManager.zoomOut()
          })
        } else if (event.key === '0') {
          // Reset zoom
          event.preventDefault()
          import('../../services/EditorConfigManager').then(({ editorConfigManager }) => {
            editorConfigManager.resetZoom()
          })
        }
      }
    }
    
    // Register keyboard event listener
    const rootElement = editor.getRootElement()
    if (rootElement) {
      rootElement.addEventListener('keydown', handleKeyDown)
      return () => {
        rootElement.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [editor])
  
  return null
}

/**
 * LexicalEditor Component
 * A wrapper around Lexical editor with basic functionality
 */
export function LexicalEditor({
  initialContent,
  onChange,
  config,
  readOnly = false,
  placeholder = '开始写作...',
  editorRef,
  className = '',
  onReady,
  fileType,
  sensitiveWords = [],
  showMarkdownToolbar = false,
  contextMenuItems = [],
  onContextMenuItemClick,
}: LexicalEditorProps) {
  const contentEditableRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const lastEditorContentRef = useRef<string | null>(null)
  const [useFallback, setUseFallback] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  
  // Apply editor configuration CSS variables on mount
  useEffect(() => {
    if (wrapperRef.current) {
      applyEditorConfig(wrapperRef.current)
    }
  }, [])
  
  // Determine if we should use RichText or PlainText based on file type
  // .md files use RichText, .txt files use PlainText
  const useRichText = useMemo(() => {
    return fileType === '.md' || fileType === 'md'
  }, [fileType])
  
  // Handle content changes with debouncing to prevent performance issues
  const handleChange = useMemo(() => {
    return (editorState: EditorState, editor: any) => {
      editorState.read(() => {
        const root = $getRoot()
        const textContent = root.getTextContent()
        lastEditorContentRef.current = textContent
        onChange(textContent, editor)
      })
    }
  }, [onChange])
  
  // Use a ref to store the debounce timer
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Debounced onChange handler to improve performance
  const debouncedHandleChange = useMemo(() => {
    return (editorState: EditorState, editor: any) => {
      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      
      // Set new timer - only call onChange after 150ms of no typing
      debounceTimerRef.current = setTimeout(() => {
        handleChange(editorState, editor)
      }, 150)
    }
  }, [handleChange])
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])
  
  // Initial config for LexicalComposer - include SensitiveWordNode and Markdown nodes
  // Memoize to prevent unnecessary re-initialization
  const initialConfig = useMemo(() => ({
    namespace: config.namespace,
    theme: config.theme,
    onError: (error: Error) => {
      console.error('Lexical Editor Error:', error)
      logError('Lexical editor error', error, {
        namespace: config.namespace,
        fileType,
      })
      config.onError(error)
    },
    nodes: [
      SensitiveWordNode,
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      LinkNode,
      ...(config.nodes || [])
    ],
    editable: !readOnly,
  }), [config.namespace, config.theme, config.onError, config.nodes, fileType, readOnly])
  
  const handleRetry = () => {
    setRetryKey((prev) => prev + 1)
  }
  
  const handleFallbackToSimple = () => {
    setUseFallback(true)
  }
  
  // If using fallback editor, render simple textarea
  if (useFallback) {
    return (
      <SimpleFallbackEditor
        initialContent={initialContent}
        onChange={(content) => onChange(content, null as any)}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    )
  }
  
  return (
    <div ref={wrapperRef} className={`lexical-editor-wrapper ${className}`}>
      <EditorErrorBoundary 
        key={retryKey}
        onRetry={handleRetry}
        fallbackToSimple={handleFallbackToSimple}
      >
        <LexicalComposer initialConfig={initialConfig}>
        {useRichText && showMarkdownToolbar && <MarkdownToolbar />}
        <div className="lexical-editor-container">
          {useRichText ? (
            <RichTextPlugin
              contentEditable={
                <ContentEditable 
                  ref={contentEditableRef}
                  className="lexical-content-editable"
                  role="textbox"
                  aria-label="小说编辑器"
                  aria-multiline="true"
                  aria-placeholder={placeholder}
                  placeholder={
                    <div className="lexical-placeholder">{placeholder}</div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          ) : (
            <PlainTextPlugin
              contentEditable={
                <ContentEditable 
                  ref={contentEditableRef}
                  className="lexical-content-editable"
                  role="textbox"
                  aria-label="小说编辑器"
                  aria-multiline="true"
                  aria-placeholder={placeholder}
                  placeholder={
                    <div className="lexical-placeholder">{placeholder}</div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          )}
          <HistoryPlugin />
          <KeyboardShortcutsPlugin />
          {useRichText && <ListPlugin />}
          <OnChangePlugin onChange={debouncedHandleChange} />
          <InitialContentPlugin content={initialContent} lastEditorContentRef={lastEditorContentRef} />
          <EditorRefPlugin editorRef={editorRef} onReady={onReady} />
          <ConfigListenerPlugin wrapperRef={wrapperRef} />
          <AIAssistPlugin />
          {useRichText && <MarkdownPlugin />}
          <SensitiveWordPlugin 
            dictionary={sensitiveWords}
            enabled={sensitiveWords.length > 0}
          />
          <SensitiveWordHoverPlugin enabled={sensitiveWords.length > 0} />
          <ContextMenuPlugin 
            customMenuItems={contextMenuItems}
            onMenuItemClick={onContextMenuItemClick}
          />
        </div>
      </LexicalComposer>
      </EditorErrorBoundary>
    </div>
  )
}
