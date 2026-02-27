/**
 * SensitiveWordService
 * 
 * Provides efficient sensitive word detection using Aho-Corasick algorithm.
 * Supports custom dictionaries and real-time detection.
 * 
 * Requirements: 11.1, 11.4
 */

export interface SensitiveWordMatch {
  word: string;
  startIndex: number;
  endIndex: number;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Aho-Corasick Trie Node
 */
class TrieNode {
  children: Map<string, TrieNode> = new Map();
  fail: TrieNode | null = null;
  output: string[] = [];
  
  constructor() {}
}

/**
 * Aho-Corasick Automaton for efficient multi-pattern matching
 */
class AhoCorasick {
  private root: TrieNode = new TrieNode();
  
  /**
   * Build the Aho-Corasick automaton from a list of patterns
   */
  build(patterns: string[]): void {
    this.root = new TrieNode();
    
    // Build trie
    for (const pattern of patterns) {
      if (!pattern || pattern.length === 0) continue;
      
      let node = this.root;
      for (const char of pattern) {
        if (!node.children.has(char)) {
          node.children.set(char, new TrieNode());
        }
        node = node.children.get(char)!;
      }
      node.output.push(pattern);
    }
    
    // Build failure links using BFS
    const queue: TrieNode[] = [];
    
    // Initialize first level
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }
    
    // BFS to build failure links
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      for (const [char, child] of current.children) {
        queue.push(child);
        
        // Find failure link
        let fail = current.fail;
        while (fail !== null && !fail.children.has(char)) {
          fail = fail.fail;
        }
        
        if (fail === null) {
          child.fail = this.root;
        } else {
          child.fail = fail.children.get(char)!;
          // Merge output from failure link
          child.output.push(...child.fail.output);
        }
      }
    }
  }
  
  /**
   * Search for all pattern matches in the text
   */
  search(text: string): Array<{ word: string; index: number }> {
    const matches: Array<{ word: string; index: number }> = [];
    let node = this.root;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Follow failure links until we find a match or reach root
      while (node !== this.root && !node.children.has(char)) {
        node = node.fail!;
      }
      
      if (node.children.has(char)) {
        node = node.children.get(char)!;
      }
      
      // Record all matches at this position
      for (const word of node.output) {
        matches.push({
          word,
          index: i - word.length + 1
        });
      }
    }
    
    return matches;
  }
}

/**
 * SensitiveWordService
 * 
 * Manages sensitive word detection with custom dictionaries
 */
export class SensitiveWordService {
  private automaton: AhoCorasick = new AhoCorasick();
  private dictionary: Set<string> = new Set();
  private severityMap: Map<string, 'low' | 'medium' | 'high'> = new Map();
  
  constructor() {
    // Initialize with empty dictionary
    this.loadDictionary([]);
  }
  
  /**
   * Load a dictionary of sensitive words
   * 
   * @param words - Array of sensitive words to detect
   */
  loadDictionary(words: string[]): void {
    this.dictionary.clear();
    this.severityMap.clear();
    
    // Add words to dictionary
    for (const word of words) {
      if (word && word.trim().length > 0) {
        const trimmed = word.trim();
        this.dictionary.add(trimmed);
        
        // Assign default severity based on word characteristics
        // This is a simple heuristic - can be customized
        if (trimmed.length <= 2) {
          this.severityMap.set(trimmed, 'low');
        } else if (trimmed.length <= 4) {
          this.severityMap.set(trimmed, 'medium');
        } else {
          this.severityMap.set(trimmed, 'high');
        }
      }
    }
    
    // Rebuild automaton
    this.automaton.build(Array.from(this.dictionary));
  }
  
  /**
   * Detect sensitive words in text
   * 
   * @param text - Text to analyze
   * @returns Array of sensitive word matches
   */
  detectSensitiveWords(text: string): SensitiveWordMatch[] {
    if (!text || text.length === 0) {
      return [];
    }
    
    const rawMatches = this.automaton.search(text);
    const matches: SensitiveWordMatch[] = [];
    
    // Convert raw matches to SensitiveWordMatch format
    for (const match of rawMatches) {
      const severity = this.severityMap.get(match.word) || 'medium';
      
      matches.push({
        word: match.word,
        startIndex: match.index,
        endIndex: match.index + match.word.length,
        severity
      });
    }
    
    return matches;
  }
  
  /**
   * Add custom words to the dictionary
   * 
   * @param words - Words to add
   */
  async addCustomWords(words: string[]): Promise<void> {
    let modified = false;
    
    for (const word of words) {
      if (word && word.trim().length > 0) {
        const trimmed = word.trim();
        if (!this.dictionary.has(trimmed)) {
          this.dictionary.add(trimmed);
          
          // Assign default severity
          if (trimmed.length <= 2) {
            this.severityMap.set(trimmed, 'low');
          } else if (trimmed.length <= 4) {
            this.severityMap.set(trimmed, 'medium');
          } else {
            this.severityMap.set(trimmed, 'high');
          }
          
          modified = true;
        }
      }
    }
    
    // Rebuild automaton if dictionary was modified
    if (modified) {
      this.automaton.build(Array.from(this.dictionary));
    }
  }
  
  /**
   * Remove custom words from the dictionary
   * 
   * @param words - Words to remove
   */
  async removeCustomWords(words: string[]): Promise<void> {
    let modified = false;
    
    for (const word of words) {
      if (word && word.trim().length > 0) {
        const trimmed = word.trim();
        if (this.dictionary.has(trimmed)) {
          this.dictionary.delete(trimmed);
          this.severityMap.delete(trimmed);
          modified = true;
        }
      }
    }
    
    // Rebuild automaton if dictionary was modified
    if (modified) {
      this.automaton.build(Array.from(this.dictionary));
    }
  }
  
  /**
   * Get the current dictionary
   * 
   * @returns Array of all words in the dictionary
   */
  async getDictionary(): Promise<string[]> {
    return Array.from(this.dictionary);
  }
  
  /**
   * Set custom severity for specific words
   * 
   * @param word - The word to set severity for
   * @param severity - The severity level
   */
  setSeverity(word: string, severity: 'low' | 'medium' | 'high'): void {
    if (this.dictionary.has(word)) {
      this.severityMap.set(word, severity);
    }
  }
  
  /**
   * Get severity for a specific word
   * 
   * @param word - The word to check
   * @returns The severity level or undefined if word not in dictionary
   */
  getSeverity(word: string): 'low' | 'medium' | 'high' | undefined {
    return this.severityMap.get(word);
  }
}

// Export singleton instance
export const sensitiveWordService = new SensitiveWordService();
