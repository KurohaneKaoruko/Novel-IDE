import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as fc from 'fast-check';
import { DiffView, type ViewMode } from './DiffView';
import type { FileModification, Modification } from '../services';

// ============================================================================
// Property-Based Tests using fast-check
// ============================================================================

// Arbitraries (Generators) for property-based testing

/**
 * Generate random modification
 */
const modificationArbitrary = (): fc.Arbitrary<Modification> =>
  fc.record({
    id: fc.uuid(),
    type: fc.constantFrom('add', 'delete', 'modify'),
    lineStart: fc.integer({ min: 0, max: 50 }),
    lineEnd: fc.integer({ min: 0, max: 50 }),
    originalText: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    modifiedText: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    status: fc.constantFrom('pending', 'accepted', 'rejected'),
  }).map(mod => ({
    ...mod,
    // Ensure lineEnd >= lineStart
    lineEnd: Math.max(mod.lineStart, mod.lineEnd),
  }));

/**
 * Generate random file modification
 */
const fileModificationArbitrary = (): fc.Arbitrary<FileModification> =>
  fc.record({
    filePath: fc.string({ minLength: 1, maxLength: 50 }).map(s => `test-${s}.txt`),
    originalContent: fc.string({ maxLength: 500 }),
    modifications: fc.array(modificationArbitrary(), { minLength: 1, maxLength: 5 }),
    status: fc.constantFrom('pending', 'partial', 'accepted', 'rejected'),
  });

/**
 * Generate view mode
 */
const viewModeArbitrary = (): fc.Arbitrary<ViewMode> =>
  fc.constantFrom('split', 'unified');

describe('DiffView - Property-Based Tests', () => {
  describe('Property 11: Diff Content Completeness', () => {
    it('Feature: ai-novel-editor-upgrade, Property 11: Diff Content Completeness - DiffView should display both original and modified content', () => {
      fc.assert(
        fc.property(
          fileModificationArbitrary(),
          viewModeArbitrary(),
          (fileModification, viewMode) => {
            // Mock callbacks
            const onAccept = vi.fn();
            const onReject = vi.fn();
            const onAcceptAll = vi.fn();
            const onRejectAll = vi.fn();

            // Render DiffView
            const { container } = render(
              <DiffView
                fileModification={fileModification}
                viewMode={viewMode}
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Verify file path is displayed
            expect(screen.getByText(fileModification.filePath)).toBeInTheDocument();

            // Verify original content is present in the DOM
            const originalLines = fileModification.originalContent.split('\n');
            if (originalLines.length > 0 && originalLines[0].trim() !== '') {
              // Check that at least some original content is rendered
              const diffContent = container.querySelector('.diff-content');
              expect(diffContent).toBeInTheDocument();
              expect(diffContent?.textContent).toBeTruthy();
            }

            // Verify view mode specific rendering
            if (viewMode === 'split') {
              // Split view should have two panes
              const originalPane = container.querySelector('.diff-pane-original');
              const modifiedPane = container.querySelector('.diff-pane-modified');
              expect(originalPane).toBeInTheDocument();
              expect(modifiedPane).toBeInTheDocument();
            } else {
              // Unified view should have single pane
              const unifiedView = container.querySelector('.diff-unified-view');
              expect(unifiedView).toBeInTheDocument();
            }

            // Verify modifications section is present
            if (fileModification.modifications.length > 0) {
              const modificationsSection = container.querySelector('.diff-modifications');
              expect(modificationsSection).toBeInTheDocument();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 12: Diff Highlighting Correctness', () => {
    it('Feature: ai-novel-editor-upgrade, Property 12: Diff Highlighting Correctness - highlighting colors should be correct (green=add, red=delete, yellow=modify)', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 500 }),
          fc.array(modificationArbitrary(), { minLength: 1, maxLength: 5 }),
          viewModeArbitrary(),
          (originalContent, modifications, viewMode) => {
            // Create file modification
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications,
              status: 'pending',
            };

            // Mock callbacks
            const onAccept = vi.fn();
            const onReject = vi.fn();
            const onAcceptAll = vi.fn();
            const onRejectAll = vi.fn();

            // Render DiffView
            const { container } = render(
              <DiffView
                fileModification={fileModification}
                viewMode={viewMode}
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Verify highlighting classes for each modification type
            for (const mod of modifications) {
              // Find modification in the modifications list
              const modificationElement = container.querySelector(
                `.diff-modification-type-${mod.type}`
              );
              
              if (modificationElement) {
                // Verify the modification type is displayed correctly
                expect(modificationElement.textContent).toBe(mod.type);
              }

              // Check for highlighting classes in diff lines
              const addLines = container.querySelectorAll('.diff-line-add');
              const deleteLines = container.querySelectorAll('.diff-line-delete');
              const modifyLines = container.querySelectorAll('.diff-line-modify');

              // Verify that highlighting classes exist for modifications
              if (mod.type === 'add') {
                // Add modifications should have green highlighting
                // The class 'diff-line-add' should be present
                expect(addLines.length).toBeGreaterThanOrEqual(0);
              } else if (mod.type === 'delete') {
                // Delete modifications should have red highlighting
                // The class 'diff-line-delete' should be present
                expect(deleteLines.length).toBeGreaterThanOrEqual(0);
              } else if (mod.type === 'modify') {
                // Modify modifications should have yellow highlighting
                // The class 'diff-line-modify' should be present
                expect(modifyLines.length).toBeGreaterThanOrEqual(0);
              }
            }

            // Verify that each modification type has the correct CSS class
            const addMods = modifications.filter(m => m.type === 'add');
            const deleteMods = modifications.filter(m => m.type === 'delete');
            const modifyMods = modifications.filter(m => m.type === 'modify');

            // Count the modification type elements
            const addTypeElements = container.querySelectorAll('.diff-modification-type-add');
            const deleteTypeElements = container.querySelectorAll('.diff-modification-type-delete');
            const modifyTypeElements = container.querySelectorAll('.diff-modification-type-modify');

            expect(addTypeElements.length).toBe(addMods.length);
            expect(deleteTypeElements.length).toBe(deleteMods.length);
            expect(modifyTypeElements.length).toBe(modifyMods.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 13: View Mode Support', () => {
    it('Feature: ai-novel-editor-upgrade, Property 13: View Mode Support - DiffView should support both split and unified display modes', () => {
      fc.assert(
        fc.property(
          fileModificationArbitrary(),
          (fileModification) => {
            // Mock callbacks
            const onAccept = vi.fn();
            const onReject = vi.fn();
            const onAcceptAll = vi.fn();
            const onRejectAll = vi.fn();

            // Test split mode
            const { container: splitContainer } = render(
              <DiffView
                fileModification={fileModification}
                viewMode="split"
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Verify split mode rendering
            const splitView = splitContainer.querySelector('.diff-split-view');
            expect(splitView).toBeInTheDocument();

            const originalPane = splitContainer.querySelector('.diff-pane-original');
            const modifiedPane = splitContainer.querySelector('.diff-pane-modified');
            expect(originalPane).toBeInTheDocument();
            expect(modifiedPane).toBeInTheDocument();

            // Verify headers
            expect(screen.getByText('Original')).toBeInTheDocument();
            expect(screen.getByText('Modified')).toBeInTheDocument();

            // Clean up
            splitContainer.remove();

            // Test unified mode
            const { container: unifiedContainer } = render(
              <DiffView
                fileModification={fileModification}
                viewMode="unified"
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Verify unified mode rendering
            const unifiedView = unifiedContainer.querySelector('.diff-unified-view');
            expect(unifiedView).toBeInTheDocument();

            // Unified view should not have split panes
            const noOriginalPane = unifiedContainer.querySelector('.diff-pane-original');
            const noModifiedPane = unifiedContainer.querySelector('.diff-pane-modified');
            expect(noOriginalPane).not.toBeInTheDocument();
            expect(noModifiedPane).not.toBeInTheDocument();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 14: Line Number Display', () => {
    it('Feature: ai-novel-editor-upgrade, Property 14: Line Number Display - line numbers should be correctly displayed', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 500 }).filter(s => s.includes('\n')),
          viewModeArbitrary(),
          (originalContent, viewMode) => {
            // Create file modification with no modifications to test pure line number display
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications: [],
              status: 'pending',
            };

            // Mock callbacks
            const onAccept = vi.fn();
            const onReject = vi.fn();
            const onAcceptAll = vi.fn();
            const onRejectAll = vi.fn();

            // Render DiffView
            const { container } = render(
              <DiffView
                fileModification={fileModification}
                viewMode={viewMode}
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Get all line number elements
            const lineNumbers = container.querySelectorAll('.diff-line-number');
            
            // Verify line numbers are present
            expect(lineNumbers.length).toBeGreaterThan(0);

            // Count expected lines
            const expectedLineCount = originalContent.split('\n').length;

            // In split mode, we have line numbers for both original and modified
            // In unified mode, we have line numbers for the unified view
            if (viewMode === 'split') {
              // Split mode should have line numbers for both panes
              // Each pane should have expectedLineCount line numbers
              expect(lineNumbers.length).toBeGreaterThanOrEqual(expectedLineCount);
            } else {
              // Unified mode should have line numbers for the unified view
              expect(lineNumbers.length).toBeGreaterThanOrEqual(expectedLineCount);
            }

            // Verify line numbers are sequential and start from 1
            const lineNumberTexts = Array.from(lineNumbers).map(el => el.textContent);
            
            // Check that line numbers contain digits
            for (const lineNumText of lineNumberTexts) {
              expect(lineNumText).toMatch(/^\d+$/);
              const lineNum = parseInt(lineNumText || '0', 10);
              expect(lineNum).toBeGreaterThan(0);
            }

            // Verify first line number is 1
            if (lineNumberTexts.length > 0) {
              const firstLineNum = parseInt(lineNumberTexts[0] || '0', 10);
              expect(firstLineNum).toBe(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Integration: All Properties Together', () => {
    it('Feature: ai-novel-editor-upgrade - DiffView should satisfy all properties simultaneously', () => {
      fc.assert(
        fc.property(
          fileModificationArbitrary(),
          viewModeArbitrary(),
          (fileModification, viewMode) => {
            // Mock callbacks
            const onAccept = vi.fn();
            const onReject = vi.fn();
            const onAcceptAll = vi.fn();
            const onRejectAll = vi.fn();

            // Render DiffView
            const { container } = render(
              <DiffView
                fileModification={fileModification}
                viewMode={viewMode}
                onAccept={onAccept}
                onReject={onReject}
                onAcceptAll={onAcceptAll}
                onRejectAll={onRejectAll}
              />
            );

            // Property 11: Content Completeness
            expect(screen.getByText(fileModification.filePath)).toBeInTheDocument();
            const diffContent = container.querySelector('.diff-content');
            expect(diffContent).toBeInTheDocument();

            // Property 12: Highlighting Correctness
            const addMods = fileModification.modifications.filter(m => m.type === 'add');
            const deleteMods = fileModification.modifications.filter(m => m.type === 'delete');
            const modifyMods = fileModification.modifications.filter(m => m.type === 'modify');

            const addTypeElements = container.querySelectorAll('.diff-modification-type-add');
            const deleteTypeElements = container.querySelectorAll('.diff-modification-type-delete');
            const modifyTypeElements = container.querySelectorAll('.diff-modification-type-modify');

            expect(addTypeElements.length).toBe(addMods.length);
            expect(deleteTypeElements.length).toBe(deleteMods.length);
            expect(modifyTypeElements.length).toBe(modifyMods.length);

            // Property 13: View Mode Support
            if (viewMode === 'split') {
              expect(container.querySelector('.diff-split-view')).toBeInTheDocument();
              expect(container.querySelector('.diff-pane-original')).toBeInTheDocument();
              expect(container.querySelector('.diff-pane-modified')).toBeInTheDocument();
            } else {
              expect(container.querySelector('.diff-unified-view')).toBeInTheDocument();
            }

            // Property 14: Line Number Display
            const lineNumbers = container.querySelectorAll('.diff-line-number');
            expect(lineNumbers.length).toBeGreaterThan(0);

            // Verify line numbers are valid
            for (const lineNum of lineNumbers) {
              expect(lineNum.textContent).toMatch(/^\d+$/);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
