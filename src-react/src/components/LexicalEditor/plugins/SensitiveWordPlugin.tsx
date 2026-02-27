/**
 * SensitiveWordPlugin
 * 
 * Lexical plugin for detecting and highlighting sensitive words in the editor.
 * Uses the existing SensitiveWordService for detection logic.
 * Implements debounced detection (500ms) to avoid performance issues.
 * 
 * Requirements: 6.1, 6.3, 6.4
 */

import { useEffect, useRef, useCallback } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  TextNode,
  type LexicalEditor,
} from 'lexical'
import { sensitiveWordService, type SensitiveWordMatch } from '../../../services/SensitiveWordService'
import { 
  $createSensitiveWordNode, 
  $isSensitiveWordNode,
  SensitiveWordNode,
  type SensitiveWordSeverity,
} from '../nodes/SensitiveWordNode'

export interface SensitiveWordPluginProps {
  // Custom dictionary of sensitive words
  dictionary?: string[]
  
  // Debounce delay in milliseconds (default: 500ms)
  debounceMs?: number
  
  // Whether detection is enabled
  enabled?: boolean
  
  // Callback when sensitive words are detected
  onDetect?: (matches: SensitiveWordMatch[]) => void
}

export interface SensitiveWordPluginAPI {
  // Get current sensitive word count
  getSensitiveWordCount: () => number
  
  // Get positions of all sensitive words
  getSensitiveWordPositions: () => Array<{ word: string; startOffset: number; endOffset: number; severity: SensitiveWordSeverity }>
  
  // Load a new dictionary
  loadDictionary: (words: string[]) => void
  
  // Trigger immediate detection (bypasses debounce)
  detectNow: () => void
}

const SENSITIVE_WORD_UPDATE_TAG = 'sensitive-word-plugin-update'

/**
 * SensitiveWordPlugin Component
 * 
 * Detects sensitive words in the editor content and converts them to SensitiveWordNode
 * for visual highlighting.
 */
export function SensitiveWordPlugin({
  dictionary = [],
  debounceMs = 500,
  enabled = true,
  onDetect,
}: SensitiveWordPluginProps) {
  const [editor] = useLexicalComposerContext()
  const debounceTimerRef = useRef<number | null>(null)
  const matchesRef = useRef<SensitiveWordMatch[]>([])
  const isDetectingRef = useRef(false)

  /**
   * Load dictionary into the service
   */
  const loadDictionary = useCallback((words: string[]) => {
    sensitiveWordService.loadDictionary(words)
  }, [])

  /**
   * Load initial dictionary
   */
  useEffect(() => {
    if (dictionary.length > 0) {
      loadDictionary(dictionary)
    }
  }, [dictionary, loadDictionary])

  /**
   * Detect sensitive words in the current editor content
   */
  const detectSensitiveWords = useCallback(() => {
    if (!enabled || isDetectingRef.current) {
      return
    }

    isDetectingRef.current = true

    editor.update(() => {
      const root = $getRoot()
      const textContent = root.getTextContent()

      // Detect sensitive words using the service
      const matches = sensitiveWordService.detectSensitiveWords(textContent)
      matchesRef.current = matches

      // Call onDetect callback
      if (onDetect) {
        onDetect(matches)
      }

      // If no matches, remove all sensitive word nodes
      if (matches.length === 0) {
        removeSensitiveWordNodes(editor)
        isDetectingRef.current = false
        return
      }

      // Apply sensitive word nodes
      applySensitiveWordNodes(editor, matches)
      isDetectingRef.current = false
    }, { tag: SENSITIVE_WORD_UPDATE_TAG })
  }, [editor, enabled, onDetect])

  /**
   * Debounced detection
   */
  const detectDebounced = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // Set new timer
    debounceTimerRef.current = window.setTimeout(() => {
      detectSensitiveWords()
    }, debounceMs)
  }, [detectSensitiveWords, debounceMs])

  /**
   * Listen to editor content changes
   */
  useEffect(() => {
    if (!enabled || dictionary.length === 0) {
      // Remove all sensitive word nodes when disabled or dictionary is empty
      editor.update(() => {
        removeSensitiveWordNodes(editor)
      }, { tag: SENSITIVE_WORD_UPDATE_TAG })
      matchesRef.current = []
      return
    }

    // Initial detection
    detectSensitiveWords()

    // Register update listener
    const removeUpdateListener = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      if (tags.has(SENSITIVE_WORD_UPDATE_TAG)) {
        return
      }
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
        return
      }
      // Trigger debounced detection on content change
      detectDebounced()
    })

    // Cleanup
    return () => {
      removeUpdateListener()
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [editor, enabled, dictionary.length, detectSensitiveWords, detectDebounced])

  /**
   * Expose API via editor instance
   */
  useEffect(() => {
    const api: SensitiveWordPluginAPI = {
      getSensitiveWordCount: () => matchesRef.current.length,
      
      getSensitiveWordPositions: () => {
        return matchesRef.current.map(match => ({
          word: match.word,
          startOffset: match.startIndex,
          endOffset: match.endIndex,
          severity: match.severity,
        }))
      },
      
      loadDictionary: (words: string[]) => {
        loadDictionary(words)
        // Trigger immediate detection after loading dictionary
        detectSensitiveWords()
      },
      
      detectNow: () => {
        detectSensitiveWords()
      },
    }

    // Extend editor with API
    const extendedEditor = editor as any
    extendedEditor.sensitiveWordAPI = api
  }, [editor, loadDictionary, detectSensitiveWords])

  return null
}

/**
 * Apply sensitive word nodes to the editor
 */
function applySensitiveWordNodes(_editor: LexicalEditor, matches: SensitiveWordMatch[]): void {
  const root = $getRoot()

  // Traverse all text nodes and split them based on sensitive word boundaries
  const textNodes: TextNode[] = []
  
  function collectTextNodes(node: any): void {
    if (node instanceof TextNode) {
      textNodes.push(node)
    }
    const children = node.getChildren?.()
    if (children) {
      for (const child of children) {
        collectTextNodes(child)
      }
    }
  }
  
  collectTextNodes(root)

  // Process each text node
  let currentOffset = 0
  
  for (const textNode of textNodes) {
    const text = textNode.getTextContent()
    const nodeStartOffset = currentOffset
    const nodeEndOffset = currentOffset + text.length

    // Check if this node contains any sensitive words
    const nodeMatches: Array<{ start: number; end: number; match: SensitiveWordMatch }> = []
    
    for (const match of matches) {
      // Check if match overlaps with this node
      if (match.startIndex < nodeEndOffset && match.endIndex > nodeStartOffset) {
        const relativeStart = Math.max(0, match.startIndex - nodeStartOffset)
        const relativeEnd = Math.min(text.length, match.endIndex - nodeStartOffset)
        
        if (relativeStart < relativeEnd) {
          nodeMatches.push({
            start: relativeStart,
            end: relativeEnd,
            match,
          })
        }
      }
    }

    // If this node has sensitive words, split it
    if (nodeMatches.length > 0 && !$isSensitiveWordNode(textNode)) {
      splitTextNodeWithMatches(textNode, nodeMatches)
    }

    currentOffset = nodeEndOffset
  }
}

/**
 * Split a text node into regular and sensitive word nodes
 */
function splitTextNodeWithMatches(
  textNode: TextNode,
  matches: Array<{ start: number; end: number; match: SensitiveWordMatch }>
): void {
  const text = textNode.getTextContent()
  const parent = textNode.getParent()
  
  if (!parent) return

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start)

  // Build segments: [{ start, end, isSensitive, severity }]
  const segments: Array<{ start: number; end: number; isSensitive: boolean; severity?: SensitiveWordSeverity }> = []
  let lastEnd = 0

  for (const { start, end, match } of matches) {
    // Add regular text before this match
    if (start > lastEnd) {
      segments.push({ start: lastEnd, end: start, isSensitive: false })
    }
    
    // Add sensitive word segment
    segments.push({ start, end, isSensitive: true, severity: match.severity })
    lastEnd = end
  }

  // Add remaining regular text
  if (lastEnd < text.length) {
    segments.push({ start: lastEnd, end: text.length, isSensitive: false })
  }

  // Create new nodes for each segment
  const newNodes: (TextNode | SensitiveWordNode)[] = []
  
  for (const segment of segments) {
    const segmentText = text.substring(segment.start, segment.end)
    
    if (segment.isSensitive && segment.severity) {
      // Create sensitive word node
      const sensitiveNode = $createSensitiveWordNode(segmentText, segment.severity)
      newNodes.push(sensitiveNode)
    } else {
      // Create regular text node
      const regularNode = new TextNode(segmentText)
      regularNode.setFormat(textNode.getFormat())
      regularNode.setStyle(textNode.getStyle())
      newNodes.push(regularNode)
    }
  }

  // Replace the original node with new nodes
  if (newNodes.length > 0) {
    textNode.replace(newNodes[0])
    for (let i = 1; i < newNodes.length; i++) {
      newNodes[i - 1].insertAfter(newNodes[i])
    }
  }
}

/**
 * Remove all sensitive word nodes from the editor
 */
function removeSensitiveWordNodes(_editor: LexicalEditor): void {
  const root = $getRoot()
  const sensitiveNodes: SensitiveWordNode[] = []

  function collectSensitiveNodes(node: any): void {
    if ($isSensitiveWordNode(node)) {
      sensitiveNodes.push(node)
    }
    const children = node.getChildren?.()
    if (children) {
      for (const child of children) {
        collectSensitiveNodes(child)
      }
    }
  }

  collectSensitiveNodes(root)

  // Replace each sensitive word node with a regular text node
  for (const sensitiveNode of sensitiveNodes) {
    const text = sensitiveNode.getTextContent()
    const regularNode = new TextNode(text)
    regularNode.setFormat(sensitiveNode.getFormat())
    regularNode.setStyle(sensitiveNode.getStyle())
    sensitiveNode.replace(regularNode)
  }
}
