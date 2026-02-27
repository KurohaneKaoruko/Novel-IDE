import type { LexicalEditor } from 'lexical'
import type { EditorInstance } from '../types/editor'
import { $getSelection, $isRangeSelection } from 'lexical'

/**
 * EditorManager Service
 * Manages multiple Lexical editor instances for the multi-tab system
 * 
 * Responsibilities:
 * - Create and destroy editor instances
 * - Track editor state (cursor position, scroll position, selection)
 * - Save and restore editor state when switching tabs
 * - Manage editor lifecycle
 */
class EditorManager {
  private editors: Map<string, EditorInstance> = new Map()
  
  /**
   * Create a new editor instance
   * @param filePath - Unique identifier for the editor (file path)
   * @param editor - Lexical editor instance
   * @returns EditorInstance
   */
  createEditor(filePath: string, editor: LexicalEditor): EditorInstance {
    // If editor already exists, return it
    if (this.editors.has(filePath)) {
      return this.editors.get(filePath)!
    }
    
    const instance: EditorInstance = {
      id: filePath,
      editor,
      state: editor.getEditorState(),
      isDirty: false,
      cursorPosition: 0,
      scrollPosition: 0,
    }
    
    this.editors.set(filePath, instance)
    return instance
  }
  
  /**
   * Get an existing editor instance
   * @param filePath - File path identifier
   * @returns EditorInstance or null if not found
   */
  getEditor(filePath: string): EditorInstance | null {
    return this.editors.get(filePath) || null
  }
  
  /**
   * Destroy an editor instance and clean up resources
   * @param filePath - File path identifier
   */
  destroyEditor(filePath: string): void {
    const instance = this.editors.get(filePath)
    if (!instance) return
    
    // Clean up editor resources
    // Note: Lexical editors are managed by React, so we just remove from our map
    this.editors.delete(filePath)
  }
  
  /**
   * Get editor content
   * @param filePath - File path identifier
   * @returns Content string or empty string if editor not found
   */
  getContent(filePath: string): string {
    const instance = this.editors.get(filePath)
    if (!instance) return ''
    
    let content = ''
    instance.editor.getEditorState().read(() => {
      const root = instance.editor.getEditorState()._nodeMap.get('root')
      if (root && 'getTextContent' in root && typeof root.getTextContent === 'function') {
        content = root.getTextContent()
      }
    })
    
    return content
  }
  
  /**
   * Set editor content
   * @param filePath - File path identifier
   * @param content - New content
   */
  setContent(filePath: string, content: string): void {
    const instance = this.editors.get(filePath)
    if (!instance) return
    
    // Use the editor's setContent method if available
    const editor = instance.editor as any
    if (editor.setContent && typeof editor.setContent === 'function') {
      editor.setContent(content)
    }
  }
  
  /**
   * Save editor state (cursor position, scroll position, selection)
   * Called when switching away from a tab
   * @param filePath - File path identifier
   */
  saveState(filePath: string): void {
    const instance = this.editors.get(filePath)
    if (!instance) return
    
    // Save current editor state
    instance.state = instance.editor.getEditorState()
    
    // Save cursor position and selection
    instance.editor.getEditorState().read(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        // Get cursor position (anchor offset)
        instance.cursorPosition = selection.anchor.offset
      }
    })
    
    // Save scroll position
    const rootElement = instance.editor.getRootElement()
    if (rootElement) {
      const scrollContainer = rootElement.closest('.lexical-editor-container') || rootElement.parentElement
      if (scrollContainer) {
        instance.scrollPosition = scrollContainer.scrollTop
      }
    }
  }
  
  /**
   * Restore editor state (cursor position, scroll position, selection)
   * Called when switching to a tab
   * @param filePath - File path identifier
   */
  restoreState(filePath: string): void {
    const instance = this.editors.get(filePath)
    if (!instance) return
    
    // Restore scroll position
    const rootElement = instance.editor.getRootElement()
    if (rootElement) {
      const scrollContainer = rootElement.closest('.lexical-editor-container') || rootElement.parentElement
      if (scrollContainer) {
        scrollContainer.scrollTop = instance.scrollPosition
      }
    }
    
    // Focus the editor
    instance.editor.focus()
    
    // Note: Cursor position restoration is handled by Lexical's state management
    // The editor state already contains the selection information
  }
  
  /**
   * Mark editor as dirty (has unsaved changes)
   * @param filePath - File path identifier
   * @param isDirty - Dirty flag
   */
  setDirty(filePath: string, isDirty: boolean): void {
    const instance = this.editors.get(filePath)
    if (!instance) return
    
    instance.isDirty = isDirty
  }
  
  /**
   * Check if editor has unsaved changes
   * @param filePath - File path identifier
   * @returns true if dirty, false otherwise
   */
  isDirty(filePath: string): boolean {
    const instance = this.editors.get(filePath)
    return instance ? instance.isDirty : false
  }
  
  /**
   * Get all editor instances
   * @returns Array of EditorInstance
   */
  getAllEditors(): EditorInstance[] {
    return Array.from(this.editors.values())
  }
  
  /**
   * Clear all editors
   */
  clearAll(): void {
    this.editors.clear()
  }
}

// Export singleton instance
export const editorManager = new EditorManager()
