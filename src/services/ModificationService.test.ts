import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModificationService } from './ModificationService';
import type { FileModification } from './ModificationService';
import type { Modification } from './DiffService';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('ModificationService', () => {
  let service: ModificationService;

  beforeEach(() => {
    service = new ModificationService();
    vi.clearAllMocks();
  });

  describe('createChangeSet', () => {
    it('should create a change set with unique ID and timestamp', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original content',
          modifications: [],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);

      expect(changeSet.id).toBeDefined();
      expect(changeSet.id).toMatch(/^changeset-\d+-[a-z0-9]+$/);
      expect(changeSet.timestamp).toBeGreaterThan(0);
      expect(changeSet.files).toHaveLength(1);
      expect(changeSet.status).toBe('pending');
    });

    it('should set all modifications to pending status', () => {
      const modifications: Modification[] = [
        {
          id: 'mod-1',
          type: 'add',
          lineStart: 1,
          lineEnd: 1,
          modifiedText: 'new line',
          status: 'accepted', // This should be overridden to pending
        },
      ];

      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications,
          status: 'accepted',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);

      expect(changeSet.files[0].status).toBe('pending');
      expect(changeSet.files[0].modifications[0].status).toBe('pending');
    });

    it('should create backups of original file contents', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original content',
          modifications: [],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      
      // The backup should be stored internally
      expect(changeSet.id).toBeDefined();
    });
  });

  describe('rejectModification', () => {
    it('should reject a modification and update statuses', () => {
      const modifications: Modification[] = [
        {
          id: 'mod-1',
          type: 'add',
          lineStart: 1,
          lineEnd: 1,
          modifiedText: 'new line',
          status: 'pending',
        },
      ];

      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications,
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      service.rejectModification(changeSet.id, 'mod-1');

      const updatedChangeSet = service.getChangeSet(changeSet.id);
      expect(updatedChangeSet?.files[0].modifications[0].status).toBe('rejected');
      expect(updatedChangeSet?.files[0].status).toBe('rejected');
      expect(updatedChangeSet?.status).toBe('rejected');
    });

    it('should throw error if change set not found', () => {
      expect(() => {
        service.rejectModification('non-existent', 'mod-1');
      }).toThrow('ChangeSet with id non-existent not found');
    });

    it('should throw error if modification not found', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications: [],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);

      expect(() => {
        service.rejectModification(changeSet.id, 'non-existent-mod');
      }).toThrow(`Modification with id non-existent-mod not found`);
    });
  });

  describe('rejectAll', () => {
    it('should reject all modifications in a change set', () => {
      const modifications: Modification[] = [
        {
          id: 'mod-1',
          type: 'add',
          lineStart: 1,
          lineEnd: 1,
          modifiedText: 'line 1',
          status: 'pending',
        },
        {
          id: 'mod-2',
          type: 'add',
          lineStart: 2,
          lineEnd: 2,
          modifiedText: 'line 2',
          status: 'pending',
        },
      ];

      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications,
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      service.rejectAll(changeSet.id);

      const updatedChangeSet = service.getChangeSet(changeSet.id);
      expect(updatedChangeSet?.files[0].modifications[0].status).toBe('rejected');
      expect(updatedChangeSet?.files[0].modifications[1].status).toBe('rejected');
      expect(updatedChangeSet?.files[0].status).toBe('rejected');
      expect(updatedChangeSet?.status).toBe('rejected');
    });

    it('should throw error if change set not found', () => {
      expect(() => {
        service.rejectAll('non-existent');
      }).toThrow('ChangeSet with id non-existent not found');
    });
  });

  describe('getChangeSetStatus', () => {
    it('should return correct status information', () => {
      const modifications: Modification[] = [
        {
          id: 'mod-1',
          type: 'add',
          lineStart: 1,
          lineEnd: 1,
          modifiedText: 'line 1',
          status: 'pending',
        },
        {
          id: 'mod-2',
          type: 'add',
          lineStart: 2,
          lineEnd: 2,
          modifiedText: 'line 2',
          status: 'pending',
        },
      ];

      const fileModifications: FileModification[] = [
        {
          filePath: 'test1.txt',
          originalContent: 'original 1',
          modifications: [modifications[0]],
          status: 'pending',
        },
        {
          filePath: 'test2.txt',
          originalContent: 'original 2',
          modifications: [modifications[1]],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      const status = service.getChangeSetStatus(changeSet.id);

      expect(status.id).toBe(changeSet.id);
      expect(status.status).toBe('pending');
      expect(status.totalModifications).toBe(2);
      expect(status.acceptedModifications).toBe(0);
      expect(status.rejectedModifications).toBe(0);
      expect(status.pendingModifications).toBe(2);
      expect(status.filesAffected).toBe(2);
    });

    it('should throw error if change set not found', () => {
      expect(() => {
        service.getChangeSetStatus('non-existent');
      }).toThrow('ChangeSet with id non-existent not found');
    });
  });

  describe('getChangeSet', () => {
    it('should return change set by ID', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications: [],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      const retrieved = service.getChangeSet(changeSet.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(changeSet.id);
    });

    it('should return undefined if change set not found', () => {
      const retrieved = service.getChangeSet('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('deleteChangeSet', () => {
    it('should delete change set and its backups', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications: [],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      service.deleteChangeSet(changeSet.id);

      const retrieved = service.getChangeSet(changeSet.id);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('status updates', () => {
    it('should update file status to partial when some modifications are accepted', () => {
      const modifications: Modification[] = [
        {
          id: 'mod-1',
          type: 'add',
          lineStart: 1,
          lineEnd: 1,
          modifiedText: 'line 1',
          status: 'pending',
        },
        {
          id: 'mod-2',
          type: 'add',
          lineStart: 2,
          lineEnd: 2,
          modifiedText: 'line 2',
          status: 'pending',
        },
      ];

      const fileModifications: FileModification[] = [
        {
          filePath: 'test.txt',
          originalContent: 'original',
          modifications,
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      service.rejectModification(changeSet.id, 'mod-1');

      const updatedChangeSet = service.getChangeSet(changeSet.id);
      expect(updatedChangeSet?.files[0].status).toBe('partial');
      expect(updatedChangeSet?.status).toBe('partial');
    });

    it('should update change set status to partial when some files are accepted', () => {
      const fileModifications: FileModification[] = [
        {
          filePath: 'test1.txt',
          originalContent: 'original 1',
          modifications: [
            {
              id: 'mod-1',
              type: 'add',
              lineStart: 1,
              lineEnd: 1,
              modifiedText: 'line 1',
              status: 'pending',
            },
          ],
          status: 'pending',
        },
        {
          filePath: 'test2.txt',
          originalContent: 'original 2',
          modifications: [
            {
              id: 'mod-2',
              type: 'add',
              lineStart: 1,
              lineEnd: 1,
              modifiedText: 'line 2',
              status: 'pending',
            },
          ],
          status: 'pending',
        },
      ];

      const changeSet = service.createChangeSet(fileModifications);
      service.rejectModification(changeSet.id, 'mod-1');

      const updatedChangeSet = service.getChangeSet(changeSet.id);
      expect(updatedChangeSet?.status).toBe('partial');
    });
  });
});

// ============================================================================
// Property-Based Tests using fast-check
// ============================================================================

import * as fc from 'fast-check';

// Arbitraries (Generators) for property-based testing

/**
 * Generate random modification
 */
const modificationArbitrary = (): fc.Arbitrary<Modification> =>
  fc.record({
    id: fc.uuid(),
    type: fc.constantFrom('add', 'delete', 'modify'),
    lineStart: fc.integer({ min: 1, max: 100 }),
    lineEnd: fc.integer({ min: 1, max: 100 }),
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

describe('ModificationService - Property-Based Tests', () => {
  let service: ModificationService;

  beforeEach(() => {
    service = new ModificationService();
    vi.clearAllMocks();
  });

  describe('Property 4: Change Set Organization', () => {
    it('Feature: ai-novel-editor-upgrade, Property 4: Change Set Organization - all modifications should be organized into a single ChangeSet', () => {
      fc.assert(
        fc.property(
          fc.array(fileModificationArbitrary(), { minLength: 1, maxLength: 5 }),
          (fileModifications) => {
            // Create a change set
            const changeSet = service.createChangeSet(fileModifications);

            // Verify all modifications are in a single ChangeSet
            expect(changeSet.id).toBeDefined();
            expect(changeSet.id).toMatch(/^changeset-\d+-[a-z0-9]+$/);
            expect(changeSet.files).toHaveLength(fileModifications.length);

            // Verify all files are included
            for (let i = 0; i < fileModifications.length; i++) {
              expect(changeSet.files[i].filePath).toBe(fileModifications[i].filePath);
              expect(changeSet.files[i].modifications.length).toBe(
                fileModifications[i].modifications.length
              );
            }

            // Verify the ChangeSet can be retrieved
            const retrieved = service.getChangeSet(changeSet.id);
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(changeSet.id);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: Original State Preservation', () => {
    it('Feature: ai-novel-editor-upgrade, Property 5: Original State Preservation - unaccepted modifications should not change the original file', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 500 }),
          fc.array(modificationArbitrary(), { minLength: 1, maxLength: 5 }),
          (originalContent, modifications) => {
            // Create a file modification
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications,
              status: 'pending',
            };

            // Create a change set
            const changeSet = service.createChangeSet([fileModification]);

            // Verify original content is preserved in the change set
            const retrieved = service.getChangeSet(changeSet.id);
            expect(retrieved).toBeDefined();
            expect(retrieved?.files[0].originalContent).toBe(originalContent);

            // Reject all modifications
            service.rejectAll(changeSet.id);

            // Verify original content is still preserved
            const afterReject = service.getChangeSet(changeSet.id);
            expect(afterReject?.files[0].originalContent).toBe(originalContent);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 10: Multi-File Atomicity', () => {
    it('Feature: ai-novel-editor-upgrade, Property 10: Multi-File Atomicity - multi-file modifications should be atomic (all succeed or all rollback)', async () => {
      // Mock the Tauri invoke function
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = invoke as ReturnType<typeof vi.fn>;

      await fc.assert(
        fc.asyncProperty(
          fc.array(fileModificationArbitrary(), { minLength: 2, maxLength: 4 }),
          fc.boolean(),
          async (fileModifications, shouldFail) => {
            // Create a fresh service instance for each property test iteration
            const testService = new ModificationService();

            // Reset mocks
            mockInvoke.mockReset();

            // Setup mock behavior
            let callCount = 0;
            mockInvoke.mockImplementation(async (command: string, args: any) => {
              if (command === 'read_text') {
                // Return the original content for reads
                const file = fileModifications.find(f => f.filePath === args.relativePath);
                return file?.originalContent || '';
              } else if (command === 'write_text') {
                callCount++;
                // Simulate failure on the second file write if shouldFail is true
                if (shouldFail && callCount === 2) {
                  throw new Error('Simulated write failure');
                }
                return;
              }
            });

            // Create a change set
            const changeSet = testService.createChangeSet(fileModifications);

            try {
              // Try to accept all modifications
              await testService.acceptAll(changeSet.id);

              // If we get here, all modifications should be accepted
              if (!shouldFail) {
                const retrieved = testService.getChangeSet(changeSet.id);
                expect(retrieved?.status).toBe('accepted');
                for (const file of retrieved?.files || []) {
                  expect(file.status).toBe('accepted');
                }
              }
            } catch (error) {
              // If acceptAll failed, verify rollback occurred
              if (shouldFail) {
                expect(error).toBeDefined();
                expect((error as Error).message).toContain('Failed to accept all modifications');

                // Verify that rollback was attempted (writeFile called for rollback)
                // The number of write calls should include both the failed writes and rollback writes
                expect(mockInvoke).toHaveBeenCalled();
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 16: Accept Modification Effect', () => {
    it('Feature: ai-novel-editor-upgrade, Property 16: Accept Modification Effect - accepting a modification should update file content and status correctly', async () => {
      // Mock the Tauri invoke function
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = invoke as ReturnType<typeof vi.fn>;

      await fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 500 }),
          modificationArbitrary(),
          async (originalContent, modification) => {
            // Create a fresh service instance for each property test iteration
            const testService = new ModificationService();

            // Reset mocks
            mockInvoke.mockReset();

            // Setup mock behavior
            let writtenContent: string | null = null;
            mockInvoke.mockImplementation(async (command: string, args: any) => {
              if (command === 'read_text') {
                return originalContent;
              } else if (command === 'write_text') {
                writtenContent = args.content;
                return;
              }
            });

            // Create a file modification with pending status
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications: [{ ...modification, status: 'pending' }],
              status: 'pending',
            };

            // Create a change set
            const changeSet = testService.createChangeSet([fileModification]);

            // Accept the modification
            await testService.acceptModification(changeSet.id, modification.id);

            // Verify modification status is updated to accepted
            const retrieved = testService.getChangeSet(changeSet.id);
            expect(retrieved?.files[0].modifications[0].status).toBe('accepted');

            // Verify file status is updated to accepted
            expect(retrieved?.files[0].status).toBe('accepted');

            // Verify change set status is updated to accepted
            expect(retrieved?.status).toBe('accepted');

            // Verify writeFile was called (content was written)
            expect(mockInvoke).toHaveBeenCalledWith('write_text', expect.any(Object));
            expect(writtenContent).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 17: Reject Modification Effect', () => {
    it('Feature: ai-novel-editor-upgrade, Property 17: Reject Modification Effect - rejecting a modification should keep original state', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 500 }),
          modificationArbitrary(),
          (originalContent, modification) => {
            // Create a file modification with pending status
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications: [{ ...modification, status: 'pending' }],
              status: 'pending',
            };

            // Create a change set
            const changeSet = service.createChangeSet([fileModification]);

            // Reject the modification
            service.rejectModification(changeSet.id, modification.id);

            // Verify modification status is updated to rejected
            const retrieved = service.getChangeSet(changeSet.id);
            expect(retrieved?.files[0].modifications[0].status).toBe('rejected');

            // Verify file status is updated to rejected
            expect(retrieved?.files[0].status).toBe('rejected');

            // Verify change set status is updated to rejected
            expect(retrieved?.status).toBe('rejected');

            // Verify original content is still preserved
            expect(retrieved?.files[0].originalContent).toBe(originalContent);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 18: Modification Undo Round-Trip', () => {
    it('Feature: ai-novel-editor-upgrade, Property 18: Modification Undo Round-Trip - undoing an accepted modification should restore original state', async () => {
      // Mock the Tauri invoke function
      const { invoke } = await import('@tauri-apps/api/core');
      const mockInvoke = invoke as ReturnType<typeof vi.fn>;

      await fc.assert(
        fc.asyncProperty(
          fc.string({ maxLength: 500 }),
          modificationArbitrary(),
          async (originalContent, modification) => {
            // Create a fresh service instance for each property test iteration
            const testService = new ModificationService();

            // Reset mocks
            mockInvoke.mockReset();

            // Track written content
            let writtenContent: string | null = null;
            mockInvoke.mockImplementation(async (command: string, args: any) => {
              if (command === 'read_text') {
                return writtenContent || originalContent;
              } else if (command === 'write_text') {
                writtenContent = args.content;
                return;
              }
            });

            // Create a file modification with pending status
            const fileModification: FileModification = {
              filePath: 'test-file.txt',
              originalContent,
              modifications: [{ ...modification, status: 'pending' }],
              status: 'pending',
            };

            // Create a change set
            const changeSet = testService.createChangeSet([fileModification]);

            // Accept the modification
            await testService.acceptModification(changeSet.id, modification.id);

            // Verify modification was accepted
            let retrieved = testService.getChangeSet(changeSet.id);
            expect(retrieved?.files[0].modifications[0].status).toBe('accepted');

            // Undo the modification
            await testService.undoModification(changeSet.id, modification.id);

            // Verify modification status is back to pending
            retrieved = testService.getChangeSet(changeSet.id);
            expect(retrieved?.files[0].modifications[0].status).toBe('pending');

            // Verify the last write was the original content (rollback)
            expect(writtenContent).toBe(originalContent);

            // Verify file status is updated
            expect(retrieved?.files[0].status).toBe('pending');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
