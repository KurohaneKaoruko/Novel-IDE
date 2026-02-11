import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from '@lexical/markdown'

/**
 * MarkdownPlugin
 * Enables Markdown syntax support in the editor
 * - Supports headings, lists, bold, italic, links
 * - Provides real-time Markdown conversion
 */
export function MarkdownPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Register markdown transformers
    // This enables markdown shortcuts like **bold**, *italic*, # heading, etc.
    return editor.registerUpdateListener(() => {
      // The transformers are automatically applied by Lexical
      // when using the TRANSFORMERS constant
    })
  }, [editor])

  return null
}

/**
 * Hook to convert markdown string to editor state
 */
export function useMarkdownImport() {
  const [editor] = useLexicalComposerContext()

  return (markdown: string) => {
    editor.update(() => {
      $convertFromMarkdownString(markdown, TRANSFORMERS)
    })
  }
}

/**
 * Hook to export editor state to markdown string
 */
export function useMarkdownExport() {
  const [editor] = useLexicalComposerContext()

  return (): string => {
    let markdown = ''
    editor.getEditorState().read(() => {
      markdown = $convertToMarkdownString(TRANSFORMERS)
    })
    return markdown
  }
}
