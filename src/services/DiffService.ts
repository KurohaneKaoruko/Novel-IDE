import fastDiff from 'fast-diff';

/**
 * Represents a single change in a diff operation
 */
export interface DiffChange {
  type: 'add' | 'delete' | 'modify';
  lineStart: number;
  lineEnd: number;
  originalText?: string;
  modifiedText?: string;
}

/**
 * Result of a diff computation
 */
export interface DiffResult {
  changes: DiffChange[];
  stats: {
    additions: number;
    deletions: number;
    modifications: number;
  };
}

/**
 * Represents a single modification to be applied to a file
 */
export interface Modification {
  id: string;
  type: 'add' | 'delete' | 'modify';
  lineStart: number;
  lineEnd: number;
  originalText?: string;
  modifiedText?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

/**
 * Service for computing text differences and managing modifications
 */
export class DiffService {
  /**
   * Compute the difference between two text strings
   * @param original - The original text
   * @param modified - The modified text
   * @returns DiffResult containing changes and statistics
   */
  computeDiff(original: string, modified: string): DiffResult {
    // Use fast-diff to compute character-level differences
    const diffs = fastDiff(original, modified);
    
    // Convert to line-based changes
    const changes: DiffChange[] = [];
    let originalLineNum = 1;
    let modifiedLineNum = 1;
    let originalPos = 0;
    let modifiedPos = 0;
    
    // Track statistics
    let additions = 0;
    let deletions = 0;
    
    for (const [operation, text] of diffs) {
      const lines = text.split('\n');
      const lineCount = lines.length - 1; // Number of newlines
      
      if (operation === fastDiff.DELETE) {
        // Text was deleted from original
        const lineStart = originalLineNum;
        const lineEnd = originalLineNum + lineCount;
        
        changes.push({
          type: 'delete',
          lineStart,
          lineEnd,
          originalText: text,
        });
        
        deletions += lineCount > 0 ? lineCount : 1;
        originalLineNum += lineCount;
        originalPos += text.length;
        
      } else if (operation === fastDiff.INSERT) {
        // Text was added to modified
        const lineStart = modifiedLineNum;
        const lineEnd = modifiedLineNum + lineCount;
        
        changes.push({
          type: 'add',
          lineStart,
          lineEnd,
          modifiedText: text,
        });
        
        additions += lineCount > 0 ? lineCount : 1;
        modifiedLineNum += lineCount;
        modifiedPos += text.length;
        
      } else {
        // Text is equal in both
        originalLineNum += lineCount;
        modifiedLineNum += lineCount;
        originalPos += text.length;
        modifiedPos += text.length;
      }
    }
    
    // Merge adjacent add/delete operations into modify operations
    const mergedChanges = this.mergeChanges(changes);
    
    // Recalculate stats after merging
    const stats = this.calculateStats(mergedChanges);
    
    return {
      changes: mergedChanges,
      stats,
    };
  }
  
  /**
   * Merge adjacent add and delete operations into modify operations
   * @param changes - Array of DiffChange objects
   * @returns Merged array of DiffChange objects
   */
  private mergeChanges(changes: DiffChange[]): DiffChange[] {
    const merged: DiffChange[] = [];
    let i = 0;
    
    while (i < changes.length) {
      const current = changes[i];
      const next = changes[i + 1];
      
      // Check if we can merge a delete followed by an add into a modify
      if (
        current &&
        next &&
        current.type === 'delete' &&
        next.type === 'add' &&
        Math.abs(current.lineStart - next.lineStart) <= 1
      ) {
        merged.push({
          type: 'modify',
          lineStart: current.lineStart,
          lineEnd: Math.max(current.lineEnd, next.lineEnd),
          originalText: current.originalText,
          modifiedText: next.modifiedText,
        });
        i += 2; // Skip both changes
      } else {
        merged.push(current);
        i += 1;
      }
    }
    
    return merged;
  }
  
  /**
   * Calculate statistics from changes
   * @param changes - Array of DiffChange objects
   * @returns Statistics object
   */
  private calculateStats(changes: DiffChange[]): {
    additions: number;
    deletions: number;
    modifications: number;
  } {
    let additions = 0;
    let deletions = 0;
    let modifications = 0;
    
    for (const change of changes) {
      const lineCount = change.lineEnd - change.lineStart + 1;
      
      if (change.type === 'add') {
        additions += lineCount;
      } else if (change.type === 'delete') {
        deletions += lineCount;
      } else if (change.type === 'modify') {
        modifications += lineCount;
      }
    }
    
    return { additions, deletions, modifications };
  }
  
  /**
   * Convert a DiffResult into an array of Modification objects
   * @param diff - The DiffResult to convert
   * @returns Array of Modification objects
   */
  diffToModifications(diff: DiffResult): Modification[] {
    return diff.changes.map((change, index) => ({
      id: this.generateModificationId(index),
      type: change.type,
      lineStart: change.lineStart,
      lineEnd: change.lineEnd,
      originalText: change.originalText,
      modifiedText: change.modifiedText,
      status: 'pending',
    }));
  }
  
  /**
   * Apply an array of modifications to the original text
   * @param original - The original text
   * @param modifications - Array of modifications to apply
   * @returns The modified text
   */
  applyModifications(original: string, modifications: Modification[]): string {
    // Filter only accepted modifications
    const acceptedMods = modifications.filter(mod => mod.status === 'accepted');
    
    if (acceptedMods.length === 0) {
      return original;
    }
    
    // Sort modifications by line number (descending) to apply from bottom to top
    // This prevents line number shifts from affecting subsequent modifications
    const sortedMods = [...acceptedMods].sort((a, b) => b.lineStart - a.lineStart);
    
    // Split original text into lines
    const lines = original.split('\n');
    
    // Apply each modification
    for (const mod of sortedMods) {
      const startIdx = mod.lineStart - 1; // Convert to 0-based index
      const endIdx = mod.lineEnd - 1;
      
      if (mod.type === 'add') {
        // Insert new lines
        const newLines = (mod.modifiedText || '').split('\n');
        lines.splice(startIdx, 0, ...newLines);
        
      } else if (mod.type === 'delete') {
        // Remove lines
        const deleteCount = endIdx - startIdx + 1;
        lines.splice(startIdx, deleteCount);
        
      } else if (mod.type === 'modify') {
        // Replace lines
        const deleteCount = endIdx - startIdx + 1;
        const newLines = (mod.modifiedText || '').split('\n');
        lines.splice(startIdx, deleteCount, ...newLines);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Generate a unique ID for a modification
   * @param index - The index of the modification
   * @returns A unique ID string
   */
  private generateModificationId(index: number): string {
    return `mod-${Date.now()}-${index}`;
  }
}

// Export a singleton instance
export const diffService = new DiffService();
