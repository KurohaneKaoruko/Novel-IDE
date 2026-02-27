import type { LexicalEditor, EditorState, Klass, LexicalNode } from 'lexical'

/**
 * Editor theme configuration
 * Defines CSS class names for different editor elements
 */
export interface EditorTheme {
  // Paragraph styles
  paragraph?: string
  
  // Text formatting styles
  text?: {
    bold?: string
    italic?: string
    underline?: string
    strikethrough?: string
    code?: string
  }
  
  // Heading styles
  heading?: {
    h1?: string
    h2?: string
    h3?: string
    h4?: string
    h5?: string
    h6?: string
  }
  
  // List styles
  list?: {
    ul?: string
    ol?: string
    listitem?: string
    nested?: {
      listitem?: string
    }
  }
  
  // Link styles
  link?: string
  
  // Sensitive word styles
  sensitiveWord?: string
  
  // Code block styles
  code?: string
  codeHighlight?: Record<string, string>
}

/**
 * Editor configuration
 * Core settings for initializing a Lexical editor instance
 */
export interface EditorConfig {
  // Theme configuration
  theme: EditorTheme
  
  // Namespace for the editor (used for multi-editor instances)
  namespace: string
  
  // Error handler
  onError: (error: Error) => void
  
  // Custom nodes to register
  nodes?: Array<Klass<LexicalNode>>
  
  // Whether the editor is editable
  editable?: boolean
}

/**
 * Context menu item configuration
 */
export interface ContextMenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  action: (editor: LexicalEditor, selection: string) => void
  condition?: (hasSelection: boolean) => boolean
}

/**
 * Props for the LexicalEditor component
 */
export interface LexicalEditorProps {
  // Initial content to load into the editor
  initialContent: string
  
  // Callback when editor content changes
  onChange: (content: string, editor: LexicalEditor) => void
  
  // Editor configuration
  config: EditorConfig
  
  // Whether the editor is read-only
  readOnly?: boolean
  
  // Placeholder text when editor is empty
  placeholder?: string
  
  // Reference to the editor instance (for external control)
  editorRef?: React.MutableRefObject<LexicalEditor | null>
  
  // Sensitive words dictionary for detection
  sensitiveWords?: string[]
  
  // Whether to enable Markdown support
  enableMarkdown?: boolean
  
  // Custom CSS class name
  className?: string
  
  // Callback when editor is ready
  onReady?: (editor: LexicalEditor) => void
  
  // File type to determine which plugin to use (.md for RichText, .txt for PlainText)
  fileType?: string
  
  // Whether to show the Markdown toolbar (only for .md files)
  showMarkdownToolbar?: boolean
  
  // Custom context menu items
  contextMenuItems?: ContextMenuItem[]
  
  // Callback when context menu item is clicked
  onContextMenuItemClick?: (item: ContextMenuItem, selection: string) => void
}

/**
 * Editor instance state
 * Represents a single editor instance in the multi-tab system
 */
export interface EditorInstance {
  // Editor ID (typically the file path)
  id: string
  
  // Lexical editor instance
  editor: LexicalEditor
  
  // Current editor state
  state: EditorState
  
  // Whether the editor has unsaved changes
  isDirty: boolean
  
  // Cursor position (character offset)
  cursorPosition: number
  
  // Scroll position (pixels from top)
  scrollPosition: number
}

/**
 * Selection state for saving/restoring
 */
export interface SelectionState {
  anchorOffset: number
  focusOffset: number
  anchorKey: string
  focusKey: string
}

/**
 * File state in the tab system
 */
export interface FileState {
  // File path
  path: string
  
  // File name
  name: string
  
  // Editor content
  content: string
  
  // Whether file has unsaved changes
  dirty: boolean
  
  // Saved editor state for tab switching
  editorState?: {
    cursorPosition: number
    scrollPosition: number
    selection: SelectionState | null
  }
}
