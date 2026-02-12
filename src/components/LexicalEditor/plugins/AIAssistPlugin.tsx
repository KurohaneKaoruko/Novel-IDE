import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  TextNode,
} from 'lexical'

/**
 * AIAssistPlugin
 * 
 * Provides AI integration functionality for the Lexical editor:
 * - Get selected text
 * - Insert text at cursor position
 * - Replace selected text
 * - Get context before cursor
 * - Set cursor position programmatically
 * - Set selection programmatically
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

export interface AIAssistPluginProps {
  // Optional callback when plugin is ready
  onReady?: (api: AIAssistAPI) => void
}

export interface AIAssistAPI {
  // Get the currently selected text
  getSelectedText: () => string
  
  // Insert text at the current cursor position
  insertTextAtCursor: (text: string) => void
  
  // Replace the currently selected text with new text
  replaceSelectedText: (text: string) => void
  
  // Get N characters of context before the cursor
  getContextBeforeCursor: (n: number) => string
  
  // Set cursor position programmatically (character offset from start)
  setCursorPosition: (offset: number) => void
  
  // Set selection programmatically (start and end offsets)
  setSelection: (startOffset: number, endOffset: number) => void
}

export function AIAssistPlugin({ onReady }: AIAssistPluginProps) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    // Create API object with all methods
    const api: AIAssistAPI = {
      /**
       * Get the currently selected text
       * Requirement: 5.1
       */
      getSelectedText: () => {
        let selectedText = ''
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            selectedText = selection.getTextContent()
          }
        })
        return selectedText
      },
      
      /**
       * Insert text at the current cursor position
       * If there's a selection, it will be replaced
       * Requirement: 5.2
       */
      insertTextAtCursor: (text: string) => {
        if (!text) return
        
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            selection.insertText(text)
          } else {
            const root = $getRoot()
            const paragraph = $createParagraphNode()
            paragraph.append($createTextNode(text))
            root.append(paragraph)
          }
        })
        
        // Focus editor after insertion
        editor.focus()
      },
      
      /**
       * Replace the currently selected text with new text
       * If no selection, behaves like insertTextAtCursor
       * Requirement: 5.3
       */
      replaceSelectedText: (text: string) => {
        editor.update(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            // Delete current selection and insert new text
            selection.insertText(text)
          } else {
            const root = $getRoot()
            const paragraph = $createParagraphNode()
            paragraph.append($createTextNode(text))
            root.append(paragraph)
          }
        })
        
        editor.focus()
      },
      
      /**
       * Get N characters of context before the cursor
       * Used for AI smart completion
       * Requirement: 5.4
       */
      getContextBeforeCursor: (n: number) => {
        let context = ''
        
        editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection)) {
            // No selection, get all content
            const root = $getRoot()
            context = root.getTextContent()
            return
          }
          
          // Get all text content up to cursor position
          const root = $getRoot()
          const allText = root.getTextContent()
          
          // Get cursor position
          const anchorNode = selection.anchor.getNode()
          const anchorOffset = selection.anchor.offset
          
          // Calculate absolute position in document
          let position = 0
          let found = false
          
          const traverse = (node: any): boolean => {
            if (node === anchorNode) {
              position += anchorOffset
              found = true
              return true
            }
            
            if (node instanceof TextNode) {
              position += node.getTextContent().length
            }
            
            const children = node.getChildren?.()
            if (children) {
              for (const child of children) {
                if (traverse(child)) return true
              }
            }
            
            return false
          }
          
          traverse(root)
          
          if (found) {
            // Get text before cursor
            const textBeforeCursor = allText.substring(0, position)
            context = textBeforeCursor.slice(Math.max(0, textBeforeCursor.length - n))
          } else {
            // Fallback: get last n characters of all text
            context = allText.slice(Math.max(0, allText.length - n))
          }
        })
        
        return context
      },
      
      /**
       * Set cursor position programmatically
       * Requirement: 5.5
       */
      setCursorPosition: (offset: number) => {
        editor.update(() => {
          const root = $getRoot()
          const allText = root.getTextContent()
          
          // Clamp offset to valid range
          const clampedOffset = Math.max(0, Math.min(offset, allText.length))
          
          // Find the node and offset for the given position
          let currentPosition = 0
          let targetNode: TextNode | null = null
          let targetOffset = 0
          
          const traverse = (node: any): boolean => {
            if (node instanceof TextNode) {
              const textLength = node.getTextContent().length
              if (currentPosition + textLength >= clampedOffset) {
                targetNode = node
                targetOffset = clampedOffset - currentPosition
                return true
              }
              currentPosition += textLength
            }
            
            const children = node.getChildren?.()
            if (children) {
              for (const child of children) {
                if (traverse(child)) return true
              }
            }
            
            return false
          }
          
          traverse(root)
          
          if (targetNode) {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.setTextNodeRange(targetNode, targetOffset, targetNode, targetOffset)
            }
          } else {
            // Fallback: select end of document
            const lastChild = root.getLastChild()
            if (lastChild) {
              lastChild.selectEnd()
            }
          }
        })
        
        editor.focus()
      },
      
      /**
       * Set selection programmatically
       * Requirement: 5.5
       */
      setSelection: (startOffset: number, endOffset: number) => {
        editor.update(() => {
          const root = $getRoot()
          const allText = root.getTextContent()
          
          // Clamp offsets to valid range
          const clampedStart = Math.max(0, Math.min(startOffset, allText.length))
          const clampedEnd = Math.max(clampedStart, Math.min(endOffset, allText.length))
          
          // Find start node and offset
          let currentPosition = 0
          let startNode: TextNode | null = null
          let startNodeOffset = 0
          let endNode: TextNode | null = null
          let endNodeOffset = 0
          
          const traverse = (node: any): void => {
            if (node instanceof TextNode) {
              const textLength = node.getTextContent().length
              
              // Check if start position is in this node
              if (!startNode && currentPosition + textLength >= clampedStart) {
                startNode = node as TextNode
                startNodeOffset = clampedStart - currentPosition
              }
              
              // Check if end position is in this node
              if (!endNode && currentPosition + textLength >= clampedEnd) {
                endNode = node as TextNode
                endNodeOffset = clampedEnd - currentPosition
              }
              
              currentPosition += textLength
            }
            
            const children = node.getChildren?.()
            if (children) {
              for (const child of children) {
                traverse(child)
              }
            }
          }
          
          traverse(root)
          
          if (startNode && endNode) {
            // Create selection between start and end nodes
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.setTextNodeRange(startNode, startNodeOffset, endNode, endNodeOffset)
            }
          } else if (startNode !== null) {
            // Only start found, select to end of start node
            const textLength = (startNode as TextNode).getTextContent().length
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.setTextNodeRange(startNode as TextNode, startNodeOffset, startNode as TextNode, textLength)
            }
          } else {
            // Fallback: select end of document
            const lastChild = root.getLastChild()
            if (lastChild) {
              lastChild.selectEnd()
            }
          }
        })
        
        editor.focus()
      },
    }
    
    // Expose API via callback
    if (onReady) {
      onReady(api)
    }
    
    // Also extend the editor instance with these methods for backward compatibility
    const extendedEditor = editor as any
    extendedEditor.getSelectedText = api.getSelectedText
    extendedEditor.insertTextAtCursor = api.insertTextAtCursor
    extendedEditor.replaceSelectedText = api.replaceSelectedText
    extendedEditor.getContextBeforeCursor = api.getContextBeforeCursor
    extendedEditor.setCursorPosition = api.setCursorPosition
    extendedEditor.setSelection = api.setSelection
  }, [editor, onReady])
  
  return null
}
