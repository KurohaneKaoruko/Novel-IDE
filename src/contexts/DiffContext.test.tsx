import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DiffProvider, useDiff } from './DiffContext';
import type { ChangeSet } from '../services';

// Helper to create a mock ChangeSet
const createMockChangeSet = (id: string): ChangeSet => ({
  id,
  timestamp: Date.now(),
  files: [],
  status: 'pending',
});

describe('DiffContext', () => {
  describe('useDiff hook', () => {
    it('should throw error when used outside DiffProvider', () => {
      expect(() => {
        renderHook(() => useDiff());
      }).toThrow('useDiff must be used within a DiffProvider');
    });
  });

  describe('DiffProvider', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      expect(result.current.changeSets.size).toBe(0);
      expect(result.current.activeChangeSetId).toBeNull();
      expect(result.current.viewMode).toBe('split');
      expect(result.current.hasChangeSets()).toBe(false);
      expect(result.current.getChangeSetCount()).toBe(0);
    });

    it('should initialize with custom view mode', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: ({ children }) => (
          <DiffProvider initialViewMode="unified">{children}</DiffProvider>
        ),
      });

      expect(result.current.viewMode).toBe('unified');
    });
  });

  describe('ChangeSet management', () => {
    it('should add a change set', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet = createMockChangeSet('test-1');

      act(() => {
        result.current.addChangeSet(changeSet);
      });

      expect(result.current.changeSets.size).toBe(1);
      expect(result.current.getChangeSet('test-1')).toEqual(changeSet);
      expect(result.current.hasChangeSets()).toBe(true);
      expect(result.current.getChangeSetCount()).toBe(1);
    });

    it('should add multiple change sets', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet1 = createMockChangeSet('test-1');
      const changeSet2 = createMockChangeSet('test-2');

      act(() => {
        result.current.addChangeSet(changeSet1);
        result.current.addChangeSet(changeSet2);
      });

      expect(result.current.changeSets.size).toBe(2);
      expect(result.current.getChangeSet('test-1')).toEqual(changeSet1);
      expect(result.current.getChangeSet('test-2')).toEqual(changeSet2);
      expect(result.current.getChangeSetCount()).toBe(2);
    });

    it('should update an existing change set', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet = createMockChangeSet('test-1');

      act(() => {
        result.current.addChangeSet(changeSet);
      });

      const updatedChangeSet = { ...changeSet, status: 'accepted' as const };

      act(() => {
        result.current.updateChangeSet(updatedChangeSet);
      });

      expect(result.current.getChangeSet('test-1')).toEqual(updatedChangeSet);
      expect(result.current.changeSets.size).toBe(1);
    });

    it('should remove a change set', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet = createMockChangeSet('test-1');

      act(() => {
        result.current.addChangeSet(changeSet);
      });

      expect(result.current.changeSets.size).toBe(1);

      act(() => {
        result.current.removeChangeSet('test-1');
      });

      expect(result.current.changeSets.size).toBe(0);
      expect(result.current.getChangeSet('test-1')).toBeUndefined();
      expect(result.current.hasChangeSets()).toBe(false);
    });

    it('should return undefined for non-existent change set', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      expect(result.current.getChangeSet('non-existent')).toBeUndefined();
    });
  });

  describe('Active ChangeSet management', () => {
    it('should set active change set', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      act(() => {
        result.current.setActiveChangeSet('test-1');
      });

      expect(result.current.activeChangeSetId).toBe('test-1');
    });

    it('should clear active change set when set to null', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      act(() => {
        result.current.setActiveChangeSet('test-1');
      });

      expect(result.current.activeChangeSetId).toBe('test-1');

      act(() => {
        result.current.setActiveChangeSet(null);
      });

      expect(result.current.activeChangeSetId).toBeNull();
    });

    it('should clear active change set when removed', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet = createMockChangeSet('test-1');

      act(() => {
        result.current.addChangeSet(changeSet);
        result.current.setActiveChangeSet('test-1');
      });

      expect(result.current.activeChangeSetId).toBe('test-1');

      act(() => {
        result.current.removeChangeSet('test-1');
      });

      expect(result.current.activeChangeSetId).toBeNull();
    });

    it('should not clear active change set when different change set is removed', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      const changeSet1 = createMockChangeSet('test-1');
      const changeSet2 = createMockChangeSet('test-2');

      act(() => {
        result.current.addChangeSet(changeSet1);
        result.current.addChangeSet(changeSet2);
        result.current.setActiveChangeSet('test-1');
      });

      act(() => {
        result.current.removeChangeSet('test-2');
      });

      expect(result.current.activeChangeSetId).toBe('test-1');
    });
  });

  describe('View mode management', () => {
    it('should set view mode', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      expect(result.current.viewMode).toBe('split');

      act(() => {
        result.current.setViewMode('unified');
      });

      expect(result.current.viewMode).toBe('unified');
    });

    it('should toggle view mode from split to unified', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      expect(result.current.viewMode).toBe('split');

      act(() => {
        result.current.toggleViewMode();
      });

      expect(result.current.viewMode).toBe('unified');
    });

    it('should toggle view mode from unified to split', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: ({ children }) => (
          <DiffProvider initialViewMode="unified">{children}</DiffProvider>
        ),
      });

      expect(result.current.viewMode).toBe('unified');

      act(() => {
        result.current.toggleViewMode();
      });

      expect(result.current.viewMode).toBe('split');
    });

    it('should toggle view mode multiple times', () => {
      const { result } = renderHook(() => useDiff(), {
        wrapper: DiffProvider,
      });

      expect(result.current.viewMode).toBe('split');

      act(() => {
        result.current.toggleViewMode();
      });
      expect(result.current.viewMode).toBe('unified');

      act(() => {
        result.current.toggleViewMode();
      });
      expect(result.current.viewMode).toBe('split');

      act(() => {
        result.current.toggleViewMode();
      });
      expect(result.current.viewMode).toBe('unified');
    });
  });
});
