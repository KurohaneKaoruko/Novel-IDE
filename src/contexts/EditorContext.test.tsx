import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorProvider, useEditor } from './EditorContext';
import type { OpenFile, EditorState } from './EditorContext';

// Helper to create a mock OpenFile
const createMockFile = (path: string, content = 'test content'): OpenFile => ({
  path,
  content,
  isDirty: false,
  language: 'typescript',
});

// Helper to create a mock EditorState
const createMockEditorState = (): EditorState => ({
  cursorPosition: { lineNumber: 1, column: 1 },
  scrollPosition: 0,
  selections: [],
});

// Mock monaco decorations collection
const createMockDecorationsCollection = () => ({
  clear: vi.fn(),
  getRange: vi.fn(),
  getRanges: vi.fn(),
  set: vi.fn(),
});

describe('EditorContext', () => {
  describe('useEditor hook', () => {
    it('should throw error when used outside EditorProvider', () => {
      expect(() => {
        renderHook(() => useEditor());
      }).toThrow('useEditor must be used within an EditorProvider');
    });
  });

  describe('EditorProvider', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeFilePath).toBeNull();
      expect(result.current.decorations.size).toBe(0);
      expect(result.current.editorStates.size).toBe(0);
      expect(result.current.hasOpenFiles()).toBe(false);
      expect(result.current.getOpenFileCount()).toBe(0);
      expect(result.current.getDirtyFiles()).toEqual([]);
    });
  });

  describe('File management', () => {
    it('should open a file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.openFiles).toHaveLength(1);
      expect(result.current.openFiles[0]).toEqual(file);
      expect(result.current.activeFilePath).toBe('test.ts');
      expect(result.current.hasOpenFiles()).toBe(true);
      expect(result.current.getOpenFileCount()).toBe(1);
      expect(result.current.isFileOpen('test.ts')).toBe(true);
    });

    it('should open multiple files', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file1 = createMockFile('test1.ts');
      const file2 = createMockFile('test2.ts');

      act(() => {
        result.current.openFile(file1);
        result.current.openFile(file2);
      });

      expect(result.current.openFiles).toHaveLength(2);
      expect(result.current.getOpenFileCount()).toBe(2);
      expect(result.current.activeFilePath).toBe('test2.ts');
    });

    it('should update existing file when opened again', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts', 'original content');

      act(() => {
        result.current.openFile(file);
      });

      const updatedFile = createMockFile('test.ts', 'updated content');

      act(() => {
        result.current.openFile(updatedFile);
      });

      expect(result.current.openFiles).toHaveLength(1);
      expect(result.current.openFiles[0].content).toBe('updated content');
    });

    it('should close a file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.openFiles).toHaveLength(1);

      act(() => {
        result.current.closeFile('test.ts');
      });

      expect(result.current.openFiles).toHaveLength(0);
      expect(result.current.activeFilePath).toBeNull();
      expect(result.current.hasOpenFiles()).toBe(false);
      expect(result.current.isFileOpen('test.ts')).toBe(false);
    });

    it('should clear active file when closed', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.activeFilePath).toBe('test.ts');

      act(() => {
        result.current.closeFile('test.ts');
      });

      expect(result.current.activeFilePath).toBeNull();
    });

    it('should not clear active file when different file is closed', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file1 = createMockFile('test1.ts');
      const file2 = createMockFile('test2.ts');

      act(() => {
        result.current.openFile(file1);
        result.current.openFile(file2);
        result.current.setActiveFile('test1.ts');
      });

      act(() => {
        result.current.closeFile('test2.ts');
      });

      expect(result.current.activeFilePath).toBe('test1.ts');
    });

    it('should update file content', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts', 'original');

      act(() => {
        result.current.openFile(file);
      });

      act(() => {
        result.current.updateFileContent('test.ts', 'updated');
      });

      expect(result.current.openFiles[0].content).toBe('updated');
    });

    it('should mark file as dirty', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.openFiles[0].isDirty).toBe(false);

      act(() => {
        result.current.markFileDirty('test.ts', true);
      });

      expect(result.current.openFiles[0].isDirty).toBe(true);
      expect(result.current.getDirtyFiles()).toHaveLength(1);
    });

    it('should mark file as clean', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = { ...createMockFile('test.ts'), isDirty: true };

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.openFiles[0].isDirty).toBe(true);

      act(() => {
        result.current.markFileDirty('test.ts', false);
      });

      expect(result.current.openFiles[0].isDirty).toBe(false);
      expect(result.current.getDirtyFiles()).toHaveLength(0);
    });

    it('should get file by path', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      const retrieved = result.current.getFile('test.ts');
      expect(retrieved).toEqual(file);
    });

    it('should return undefined for non-existent file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const retrieved = result.current.getFile('non-existent.ts');
      expect(retrieved).toBeUndefined();
    });

    it('should check if file is open', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      expect(result.current.isFileOpen('test.ts')).toBe(true);
      expect(result.current.isFileOpen('other.ts')).toBe(false);
    });
  });

  describe('Active file management', () => {
    it('should set active file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      act(() => {
        result.current.setActiveFile('test.ts');
      });

      expect(result.current.activeFilePath).toBe('test.ts');
    });

    it('should get active file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      const activeFile = result.current.getActiveFile();
      expect(activeFile).toEqual(file);
    });

    it('should return undefined when no active file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const activeFile = result.current.getActiveFile();
      expect(activeFile).toBeUndefined();
    });
  });

  describe('Decorations management', () => {
    it('should set decorations for a file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const decorations = createMockDecorationsCollection();

      act(() => {
        result.current.setDecorations('test.ts', decorations as any);
      });

      expect(result.current.decorations.size).toBe(1);
      expect(result.current.getDecorations('test.ts')).toBe(decorations);
    });

    it('should get decorations for a file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const decorations = createMockDecorationsCollection();

      act(() => {
        result.current.setDecorations('test.ts', decorations as any);
      });

      const retrieved = result.current.getDecorations('test.ts');
      expect(retrieved).toBe(decorations);
    });

    it('should return undefined for non-existent decorations', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const retrieved = result.current.getDecorations('test.ts');
      expect(retrieved).toBeUndefined();
    });

    it('should clear decorations for a file', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const decorations = createMockDecorationsCollection();

      act(() => {
        result.current.setDecorations('test.ts', decorations as any);
      });

      expect(result.current.decorations.size).toBe(1);

      act(() => {
        result.current.clearDecorations('test.ts');
      });

      expect(result.current.decorations.size).toBe(0);
      expect(decorations.clear).toHaveBeenCalled();
    });

    it('should clear all decorations', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const decorations1 = createMockDecorationsCollection();
      const decorations2 = createMockDecorationsCollection();

      act(() => {
        result.current.setDecorations('test1.ts', decorations1 as any);
        result.current.setDecorations('test2.ts', decorations2 as any);
      });

      expect(result.current.decorations.size).toBe(2);

      act(() => {
        result.current.clearAllDecorations();
      });

      expect(result.current.decorations.size).toBe(0);
      expect(decorations1.clear).toHaveBeenCalled();
      expect(decorations2.clear).toHaveBeenCalled();
    });

    it('should clear decorations when file is closed', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');
      const decorations = createMockDecorationsCollection();

      act(() => {
        result.current.openFile(file);
        result.current.setDecorations('test.ts', decorations as any);
      });

      expect(result.current.decorations.size).toBe(1);

      act(() => {
        result.current.closeFile('test.ts');
      });

      expect(result.current.decorations.size).toBe(0);
    });
  });

  describe('Editor state management', () => {
    it('should save editor state', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const state = createMockEditorState();

      act(() => {
        result.current.saveEditorState('test.ts', state);
      });

      expect(result.current.editorStates.size).toBe(1);
      expect(result.current.getEditorState('test.ts')).toEqual(state);
    });

    it('should get editor state', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const state = createMockEditorState();

      act(() => {
        result.current.saveEditorState('test.ts', state);
      });

      const retrieved = result.current.getEditorState('test.ts');
      expect(retrieved).toEqual(state);
    });

    it('should return undefined for non-existent editor state', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const retrieved = result.current.getEditorState('test.ts');
      expect(retrieved).toBeUndefined();
    });

    it('should clear editor state', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const state = createMockEditorState();

      act(() => {
        result.current.saveEditorState('test.ts', state);
      });

      expect(result.current.editorStates.size).toBe(1);

      act(() => {
        result.current.clearEditorState('test.ts');
      });

      expect(result.current.editorStates.size).toBe(0);
    });

    it('should clear editor state when file is closed', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');
      const state = createMockEditorState();

      act(() => {
        result.current.openFile(file);
        result.current.saveEditorState('test.ts', state);
      });

      expect(result.current.editorStates.size).toBe(1);

      act(() => {
        result.current.closeFile('test.ts');
      });

      expect(result.current.editorStates.size).toBe(0);
    });
  });

  describe('Utility methods', () => {
    it('should get dirty files', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file1 = { ...createMockFile('test1.ts'), isDirty: true };
      const file2 = { ...createMockFile('test2.ts'), isDirty: false };
      const file3 = { ...createMockFile('test3.ts'), isDirty: true };

      act(() => {
        result.current.openFile(file1);
        result.current.openFile(file2);
        result.current.openFile(file3);
      });

      const dirtyFiles = result.current.getDirtyFiles();
      expect(dirtyFiles).toHaveLength(2);
      expect(dirtyFiles.map(f => f.path)).toEqual(['test1.ts', 'test3.ts']);
    });

    it('should return empty array when no dirty files', () => {
      const { result } = renderHook(() => useEditor(), {
        wrapper: EditorProvider,
      });

      const file = createMockFile('test.ts');

      act(() => {
        result.current.openFile(file);
      });

      const dirtyFiles = result.current.getDirtyFiles();
      expect(dirtyFiles).toEqual([]);
    });
  });
});
