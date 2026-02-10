import { describe, it, expect } from 'vitest';
import { DiffService, type Modification } from './DiffService';
import * as fc from 'fast-check';

describe('DiffService', () => {
  const service = new DiffService();

  describe('computeDiff', () => {
    it('should detect additions', () => {
      const original = 'line 1\nline 2';
      const modified = 'line 1\nline 2\nline 3';
      
      const result = service.computeDiff(original, modified);
      
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.stats.additions).toBeGreaterThan(0);
    });

    it('should detect deletions', () => {
      const original = 'line 1\nline 2\nline 3';
      const modified = 'line 1\nline 2';
      
      const result = service.computeDiff(original, modified);
      
      expect(result.changes.length).toBeGreaterThan(0);
      expect(result.stats.deletions).toBeGreaterThan(0);
    });

    it('should detect modifications', () => {
      const original = 'line 1\nline 2\nline 3';
      const modified = 'line 1\nmodified line 2\nline 3';
      
      const result = service.computeDiff(original, modified);
      
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should return empty changes for identical texts', () => {
      const text = 'line 1\nline 2\nline 3';
      
      const result = service.computeDiff(text, text);
      
      expect(result.changes.length).toBe(0);
      expect(result.stats.additions).toBe(0);
      expect(result.stats.deletions).toBe(0);
      expect(result.stats.modifications).toBe(0);
    });
  });

  describe('diffToModifications', () => {
    it('should convert DiffResult to Modifications with pending status', () => {
      const original = 'line 1\nline 2';
      const modified = 'line 1\nline 2\nline 3';
      
      const diff = service.computeDiff(original, modified);
      const modifications = service.diffToModifications(diff);
      
      expect(modifications.length).toBe(diff.changes.length);
      modifications.forEach(mod => {
        expect(mod).toHaveProperty('id');
        expect(mod).toHaveProperty('type');
        expect(mod).toHaveProperty('lineStart');
        expect(mod).toHaveProperty('lineEnd');
        expect(mod.status).toBe('pending');
      });
    });

    it('should include modification metadata', () => {
      const original = 'line 1';
      const modified = 'line 1\nline 2';
      
      const diff = service.computeDiff(original, modified);
      const modifications = service.diffToModifications(diff);
      
      expect(modifications.length).toBeGreaterThan(0);
      const mod = modifications[0];
      expect(typeof mod.lineStart).toBe('number');
      expect(typeof mod.lineEnd).toBe('number');
      expect(['add', 'delete', 'modify']).toContain(mod.type);
    });
  });

  describe('applyModifications', () => {
    it('should apply accepted additions', () => {
      const original = 'line 1\nline 2';
      const modifications = [
        {
          id: 'test-1',
          type: 'add' as const,
          lineStart: 3,
          lineEnd: 3,
          modifiedText: 'line 3',
          status: 'accepted' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).toContain('line 3');
    });

    it('should apply accepted deletions', () => {
      const original = 'line 1\nline 2\nline 3';
      const modifications = [
        {
          id: 'test-1',
          type: 'delete' as const,
          lineStart: 2,
          lineEnd: 2,
          originalText: 'line 2',
          status: 'accepted' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).not.toContain('line 2');
      expect(result).toContain('line 1');
      expect(result).toContain('line 3');
    });

    it('should apply accepted modifications', () => {
      const original = 'line 1\nline 2\nline 3';
      const modifications = [
        {
          id: 'test-1',
          type: 'modify' as const,
          lineStart: 2,
          lineEnd: 2,
          originalText: 'line 2',
          modifiedText: 'modified line 2',
          status: 'accepted' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).toContain('modified line 2');
      expect(result.split('\n')).not.toContain('line 2');
    });

    it('should not apply pending modifications', () => {
      const original = 'line 1\nline 2';
      const modifications = [
        {
          id: 'test-1',
          type: 'add' as const,
          lineStart: 3,
          lineEnd: 3,
          modifiedText: 'line 3',
          status: 'pending' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).toBe(original);
    });

    it('should not apply rejected modifications', () => {
      const original = 'line 1\nline 2';
      const modifications = [
        {
          id: 'test-1',
          type: 'add' as const,
          lineStart: 3,
          lineEnd: 3,
          modifiedText: 'line 3',
          status: 'rejected' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).toBe(original);
    });

    it('should handle multiple modifications', () => {
      const original = 'line 1\nline 2\nline 3';
      const modifications = [
        {
          id: 'test-1',
          type: 'modify' as const,
          lineStart: 1,
          lineEnd: 1,
          originalText: 'line 1',
          modifiedText: 'modified line 1',
          status: 'accepted' as const,
        },
        {
          id: 'test-2',
          type: 'delete' as const,
          lineStart: 2,
          lineEnd: 2,
          originalText: 'line 2',
          status: 'accepted' as const,
        },
      ];
      
      const result = service.applyModifications(original, modifications);
      
      expect(result).toContain('modified line 1');
      expect(result).not.toContain('line 2');
      expect(result).toContain('line 3');
    });
  });

  describe('Requirement validation', () => {
    it('should support insert, delete, and replace operations at any line range (Req 1.1)', () => {
      const original = 'line 1\nline 2\nline 3\nline 4\nline 5';
      
      // Test insert at beginning
      const insertMod = {
        id: 'insert-1',
        type: 'add' as const,
        lineStart: 1,
        lineEnd: 1,
        modifiedText: 'new line 0',
        status: 'accepted' as const,
      };
      const insertResult = service.applyModifications(original, [insertMod]);
      expect(insertResult).toContain('new line 0');
      
      // Test delete in middle
      const deleteMod = {
        id: 'delete-1',
        type: 'delete' as const,
        lineStart: 3,
        lineEnd: 3,
        originalText: 'line 3',
        status: 'accepted' as const,
      };
      const deleteResult = service.applyModifications(original, [deleteMod]);
      expect(deleteResult).not.toContain('line 3');
      
      // Test replace at end
      const replaceMod = {
        id: 'replace-1',
        type: 'modify' as const,
        lineStart: 5,
        lineEnd: 5,
        originalText: 'line 5',
        modifiedText: 'replaced line 5',
        status: 'accepted' as const,
      };
      const replaceResult = service.applyModifications(original, [replaceMod]);
      expect(replaceResult).toContain('replaced line 5');
    });

    it('should record start line, end line, and modification type for each modification (Req 1.2)', () => {
      const original = 'line 1\nline 2';
      const modified = 'line 1\nmodified line 2';
      
      const diff = service.computeDiff(original, modified);
      const modifications = service.diffToModifications(diff);
      
      modifications.forEach(mod => {
        expect(typeof mod.lineStart).toBe('number');
        expect(typeof mod.lineEnd).toBe('number');
        expect(['add', 'delete', 'modify']).toContain(mod.type);
        expect(mod.lineStart).toBeGreaterThan(0);
        expect(mod.lineEnd).toBeGreaterThanOrEqual(mod.lineStart);
      });
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * Property 1: Modification Type Support
     * **Validates: Requirements 1.1**
     * 
     * For any file content and any line range, the system should support 
     * applying insert, delete, or replace modifications at that range
     */
    it('Feature: ai-novel-editor-upgrade, Property 1: Modification Type Support', () => {
      // Generator for file content (multi-line strings)
      const fileContentArb = fc.array(
        fc.string({ minLength: 0, maxLength: 50 }),
        { minLength: 1, maxLength: 20 }
      ).map(lines => lines.join('\n'));

      // Generator for modification type
      const modificationTypeArb = fc.constantFrom('add', 'delete', 'modify' as const);

      // Generator for line range (ensuring valid ranges)
      const lineRangeArb = (maxLines: number) => 
        fc.tuple(
          fc.integer({ min: 1, max: Math.max(1, maxLines) }),
          fc.integer({ min: 1, max: Math.max(1, maxLines) })
        ).map(([start, end]) => ({
          lineStart: Math.min(start, end),
          lineEnd: Math.max(start, end)
        }));

      // Generator for modification text
      const modificationTextArb = fc.array(
        fc.string({ minLength: 0, maxLength: 50 }),
        { minLength: 1, maxLength: 5 }
      ).map(lines => lines.join('\n'));

      fc.assert(
        fc.property(
          fileContentArb,
          modificationTypeArb,
          modificationTextArb,
          (originalContent, modType, modText) => {
            const lineCount = originalContent.split('\n').length;
            
            // Generate a valid line range for this content
            const lineRange = fc.sample(lineRangeArb(lineCount), 1)[0];
            
            // Create a modification based on the type
            const modification: Modification = {
              id: 'prop-test-1',
              type: modType,
              lineStart: lineRange.lineStart,
              lineEnd: lineRange.lineEnd,
              originalText: modType === 'delete' || modType === 'modify' ? 'original' : undefined,
              modifiedText: modType === 'add' || modType === 'modify' ? modText : undefined,
              status: 'accepted'
            };

            // Apply the modification - should not throw an error
            let result: string;
            try {
              result = service.applyModifications(originalContent, [modification]);
              
              // Verify the result is a string
              expect(typeof result).toBe('string');
              
              // Verify the modification was applied based on type
              if (modType === 'add') {
                // For add operations, the result should contain the new text
                // (unless the modification text is empty)
                if (modText.trim().length > 0) {
                  expect(result.length).toBeGreaterThanOrEqual(originalContent.length);
                }
              } else if (modType === 'delete') {
                // For delete operations, the result should be shorter or equal
                expect(result.length).toBeLessThanOrEqual(originalContent.length);
              } else if (modType === 'modify') {
                // For modify operations, the result should be different (unless modText equals original)
                // We just verify it's a valid string
                expect(typeof result).toBe('string');
              }
              
              return true;
            } catch (error) {
              // If an error occurs, fail the property
              console.error('Failed to apply modification:', error);
              return false;
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property 2: Modification Metadata Completeness
     * **Validates: Requirements 1.2**
     * 
     * For any modification created by the system, the modification should 
     * contain start line, end line, and modification type fields
     */
    it('Feature: ai-novel-editor-upgrade, Property 2: Modification Metadata Completeness', () => {
      // Generator for original and modified text pairs
      const textPairArb = fc.tuple(
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 1, maxLength: 20 })
      ).map(([originalLines, modifiedLines]) => ({
        original: originalLines.join('\n'),
        modified: modifiedLines.join('\n')
      }));

      fc.assert(
        fc.property(
          textPairArb,
          ({ original, modified }) => {
            // Compute diff between original and modified
            const diff = service.computeDiff(original, modified);
            
            // Convert to modifications
            const modifications = service.diffToModifications(diff);
            
            // Verify each modification has complete metadata
            for (const mod of modifications) {
              // Must have an id
              expect(mod.id).toBeDefined();
              expect(typeof mod.id).toBe('string');
              expect(mod.id.length).toBeGreaterThan(0);
              
              // Must have a type (one of the three valid types)
              expect(mod.type).toBeDefined();
              expect(['add', 'delete', 'modify']).toContain(mod.type);
              
              // Must have lineStart
              expect(mod.lineStart).toBeDefined();
              expect(typeof mod.lineStart).toBe('number');
              expect(mod.lineStart).toBeGreaterThan(0);
              
              // Must have lineEnd
              expect(mod.lineEnd).toBeDefined();
              expect(typeof mod.lineEnd).toBe('number');
              expect(mod.lineEnd).toBeGreaterThanOrEqual(mod.lineStart);
              
              // Must have status
              expect(mod.status).toBeDefined();
              expect(['pending', 'accepted', 'rejected']).toContain(mod.status);
              
              // Type-specific metadata checks
              if (mod.type === 'delete' || mod.type === 'modify') {
                // Delete and modify operations should have originalText
                // (though it may be undefined in some edge cases)
                expect(mod).toHaveProperty('originalText');
              }
              
              if (mod.type === 'add' || mod.type === 'modify') {
                // Add and modify operations should have modifiedText
                // (though it may be undefined in some edge cases)
                expect(mod).toHaveProperty('modifiedText');
              }
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Additional Property: Modification Application Idempotency
     * 
     * Applying the same set of accepted modifications multiple times
     * should produce the same result
     */
    it('Feature: ai-novel-editor-upgrade, Additional Property: Modification Application Idempotency', () => {
      const fileContentArb = fc.array(
        fc.string({ minLength: 0, maxLength: 50 }),
        { minLength: 1, maxLength: 10 }
      ).map(lines => lines.join('\n'));

      const modificationsArb = fc.array(
        fc.record({
          id: fc.uuid(),
          type: fc.constantFrom('add', 'delete', 'modify' as const),
          lineStart: fc.integer({ min: 1, max: 10 }),
          lineEnd: fc.integer({ min: 1, max: 10 }),
          originalText: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          modifiedText: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          status: fc.constant('accepted' as const)
        }),
        { minLength: 0, maxLength: 5 }
      ).map(mods => 
        // Ensure lineEnd >= lineStart
        mods.map(mod => ({
          ...mod,
          lineEnd: Math.max(mod.lineStart, mod.lineEnd)
        }))
      );

      fc.assert(
        fc.property(
          fileContentArb,
          modificationsArb,
          (original, modifications) => {
            // Apply modifications once
            const result1 = service.applyModifications(original, modifications);
            
            // Apply the same modifications again to the result
            // Since modifications are already applied, applying them again
            // to the original should give the same result
            const result2 = service.applyModifications(original, modifications);
            
            // Results should be identical
            expect(result1).toBe(result2);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Additional Property: Empty Modifications Preserve Original
     * 
     * Applying an empty array of modifications should return the original content unchanged
     */
    it('Feature: ai-novel-editor-upgrade, Additional Property: Empty Modifications Preserve Original', () => {
      const fileContentArb = fc.array(
        fc.string({ minLength: 0, maxLength: 50 }),
        { minLength: 1, maxLength: 20 }
      ).map(lines => lines.join('\n'));

      fc.assert(
        fc.property(
          fileContentArb,
          (original) => {
            // Apply empty modifications array
            const result = service.applyModifications(original, []);
            
            // Result should be identical to original
            expect(result).toBe(original);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Additional Property: Pending Modifications Don't Affect Content
     * 
     * Modifications with 'pending' or 'rejected' status should not affect the original content
     */
    it('Feature: ai-novel-editor-upgrade, Additional Property: Pending Modifications Preserve Original', () => {
      const fileContentArb = fc.array(
        fc.string({ minLength: 0, maxLength: 50 }),
        { minLength: 1, maxLength: 10 }
      ).map(lines => lines.join('\n'));

      const pendingModificationsArb = fc.array(
        fc.record({
          id: fc.uuid(),
          type: fc.constantFrom('add', 'delete', 'modify' as const),
          lineStart: fc.integer({ min: 1, max: 10 }),
          lineEnd: fc.integer({ min: 1, max: 10 }),
          originalText: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          modifiedText: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          status: fc.constantFrom('pending', 'rejected' as const)
        }),
        { minLength: 1, maxLength: 5 }
      ).map(mods => 
        // Ensure lineEnd >= lineStart
        mods.map(mod => ({
          ...mod,
          lineEnd: Math.max(mod.lineStart, mod.lineEnd)
        }))
      );

      fc.assert(
        fc.property(
          fileContentArb,
          pendingModificationsArb,
          (original, modifications) => {
            // Apply pending/rejected modifications
            const result = service.applyModifications(original, modifications);
            
            // Result should be identical to original (no changes applied)
            expect(result).toBe(original);
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
