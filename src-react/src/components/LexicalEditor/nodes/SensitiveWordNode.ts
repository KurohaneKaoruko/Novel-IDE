/**
 * SensitiveWordNode
 * 
 * Custom Lexical node for marking sensitive words in the editor.
 * Extends TextNode to add sensitive word metadata and custom rendering.
 * 
 * Requirements: 6.1
 */

import {
  TextNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical'

export type SensitiveWordSeverity = 'low' | 'medium' | 'high'

export type SerializedSensitiveWordNode = Spread<
  {
    severity: SensitiveWordSeverity
  },
  SerializedTextNode
>

/**
 * SensitiveWordNode - Custom node for sensitive word highlighting
 * 
 * This node extends TextNode to add sensitive word metadata and custom DOM rendering.
 * It applies CSS classes based on severity level for visual highlighting.
 */
export class SensitiveWordNode extends TextNode {
  __severity: SensitiveWordSeverity

  static getType(): string {
    return 'sensitive-word'
  }

  static clone(node: SensitiveWordNode): SensitiveWordNode {
    return new SensitiveWordNode(node.__text, node.__severity, node.__key)
  }

  constructor(text: string, severity: SensitiveWordSeverity = 'medium', key?: NodeKey) {
    super(text, key)
    this.__severity = severity
  }

  /**
   * Create DOM element for this node
   * Adds .sensitive-word class and severity-specific class
   */
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.classList.add('sensitive-word')
    element.classList.add(`sensitive-word-${this.__severity}`)
    element.setAttribute('data-severity', this.__severity)
    return element
  }

  /**
   * Update DOM element when node changes
   */
  updateDOM(
    prevNode: TextNode,
    dom: HTMLElement,
    config: EditorConfig
  ): boolean {
    const isUpdated = super.updateDOM(prevNode as this, dom, config)
    
    // Update severity classes if changed
    if (prevNode instanceof SensitiveWordNode && prevNode.__severity !== this.__severity) {
      dom.classList.remove(`sensitive-word-${prevNode.__severity}`)
      dom.classList.add(`sensitive-word-${this.__severity}`)
      dom.setAttribute('data-severity', this.__severity)
    }
    
    return isUpdated
  }

  /**
   * Export DOM for copy/paste operations
   */
  exportDOM(): DOMExportOutput {
    const element = document.createElement('span')
    element.textContent = this.__text
    element.classList.add('sensitive-word')
    element.classList.add(`sensitive-word-${this.__severity}`)
    element.setAttribute('data-severity', this.__severity)
    return { element }
  }

  /**
   * Serialize node to JSON
   */
  exportJSON(): SerializedSensitiveWordNode {
    return {
      ...super.exportJSON(),
      severity: this.__severity,
      type: 'sensitive-word',
      version: 1,
    }
  }

  /**
   * Import node from JSON
   */
  static importJSON(serializedNode: SerializedSensitiveWordNode): SensitiveWordNode {
    const node = $createSensitiveWordNode(serializedNode.text, serializedNode.severity)
    node.setFormat(serializedNode.format)
    node.setDetail(serializedNode.detail)
    node.setMode(serializedNode.mode)
    node.setStyle(serializedNode.style)
    return node
  }

  /**
   * Import DOM node
   */
  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.classList.contains('sensitive-word')) {
          return null
        }
        return {
          conversion: convertSensitiveWordElement,
          priority: 1,
        }
      },
    }
  }

  /**
   * Get severity level
   */
  getSeverity(): SensitiveWordSeverity {
    const self = this.getLatest()
    return self.__severity
  }

  /**
   * Set severity level
   */
  setSeverity(severity: SensitiveWordSeverity): void {
    const self = this.getWritable()
    self.__severity = severity
  }

  /**
   * Check if this node can be merged with another text node
   * Sensitive word nodes should not be merged to preserve highlighting
   */
  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }
}

/**
 * Convert DOM element to SensitiveWordNode
 */
function convertSensitiveWordElement(domNode: HTMLElement): DOMConversionOutput | null {
  const textContent = domNode.textContent
  if (textContent === null) {
    return null
  }

  const severity = (domNode.getAttribute('data-severity') as SensitiveWordSeverity) || 'medium'
  const node = $createSensitiveWordNode(textContent, severity)
  
  return {
    node,
  }
}

/**
 * Factory function to create a SensitiveWordNode
 */
export function $createSensitiveWordNode(
  text: string,
  severity: SensitiveWordSeverity = 'medium'
): SensitiveWordNode {
  return new SensitiveWordNode(text, severity)
}

/**
 * Type guard to check if a node is a SensitiveWordNode
 */
export function $isSensitiveWordNode(
  node: LexicalNode | null | undefined
): node is SensitiveWordNode {
  return node instanceof SensitiveWordNode
}
