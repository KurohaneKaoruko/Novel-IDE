import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  language: string;
}

export interface EditorState {
  cursorPosition: { lineNumber: number; column: number };
  scrollPosition: number;
  selections: any[];
}

export interface EditorContextValue {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  decorations: Map<string, any>;
  editorStates: Map<string, EditorState>;

  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  markFileDirty: (path: string, isDirty: boolean) => void;

  getFile: (path: string) => OpenFile | undefined;
  getActiveFile: () => OpenFile | undefined;
  isFileOpen: (path: string) => boolean;

  setDecorations: (path: string, decorations: any) => void;
  getDecorations: (path: string) => any | undefined;
  clearDecorations: (path: string) => void;
  clearAllDecorations: () => void;

  saveEditorState: (path: string, state: EditorState) => void;
  getEditorState: (path: string) => EditorState | undefined;
  clearEditorState: (path: string) => void;

  hasOpenFiles: () => boolean;
  getOpenFileCount: () => number;
  getDirtyFiles: () => OpenFile[];
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return ctx;
}

export const EditorProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [decorations, setDecorationsMap] = useState<Map<string, any>>(() => new Map());
  const [editorStates, setEditorStates] = useState<Map<string, EditorState>>(() => new Map());

  const openFile = useCallback((file: OpenFile) => {
    setOpenFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === file.path);
      const next = [...prev];
      if (idx >= 0) next[idx] = file;
      else next.push(file);
      return next;
    });
    setActiveFilePath(file.path);
  }, []);

  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      setActiveFilePath((current) => {
        if (current !== path) return current;
        return next.length > 0 ? next[next.length - 1].path : null;
      });
      return next;
    });
    setDecorationsMap((prev) => {
      const next = new Map(prev);
      const d = next.get(path);
      if (d && typeof d.clear === 'function') d.clear();
      next.delete(path);
      return next;
    });
    setEditorStates((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const setActiveFile = useCallback((path: string) => {
    setActiveFilePath(path);
  }, []);

  const updateFileContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)));
  }, []);

  const markFileDirty = useCallback((path: string, isDirty: boolean) => {
    setOpenFiles((prev) => prev.map((f) => (f.path === path ? { ...f, isDirty } : f)));
  }, []);

  const getFile = useCallback((path: string) => openFiles.find((f) => f.path === path), [openFiles]);

  const getActiveFile = useCallback(() => (activeFilePath ? openFiles.find((f) => f.path === activeFilePath) : undefined), [
    openFiles,
    activeFilePath,
  ]);

  const isFileOpen = useCallback((path: string) => openFiles.some((f) => f.path === path), [openFiles]);

  const setDecorations = useCallback((path: string, decorations: any) => {
    setDecorationsMap((prev) => {
      const next = new Map(prev);
      next.set(path, decorations);
      return next;
    });
  }, []);

  const getDecorations = useCallback((path: string) => decorations.get(path), [decorations]);

  const clearDecorations = useCallback((path: string) => {
    setDecorationsMap((prev) => {
      const next = new Map(prev);
      const d = next.get(path);
      if (d && typeof d.clear === 'function') d.clear();
      next.delete(path);
      return next;
    });
  }, []);

  const clearAllDecorations = useCallback(() => {
    setDecorationsMap((prev) => {
      for (const d of prev.values()) {
        if (d && typeof d.clear === 'function') d.clear();
      }
      return new Map();
    });
  }, []);

  const saveEditorState = useCallback((path: string, state: EditorState) => {
    setEditorStates((prev) => {
      const next = new Map(prev);
      next.set(path, state);
      return next;
    });
  }, []);

  const getEditorState = useCallback((path: string) => editorStates.get(path), [editorStates]);

  const clearEditorState = useCallback((path: string) => {
    setEditorStates((prev) => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }, []);

  const hasOpenFiles = useCallback(() => openFiles.length > 0, [openFiles]);
  const getOpenFileCount = useCallback(() => openFiles.length, [openFiles]);
  const getDirtyFiles = useCallback(() => openFiles.filter((f) => f.isDirty), [openFiles]);

  const value: EditorContextValue = useMemo(
    () => ({
      openFiles,
      activeFilePath,
      decorations,
      editorStates,
      openFile,
      closeFile,
      setActiveFile,
      updateFileContent,
      markFileDirty,
      getFile,
      getActiveFile,
      isFileOpen,
      setDecorations,
      getDecorations,
      clearDecorations,
      clearAllDecorations,
      saveEditorState,
      getEditorState,
      clearEditorState,
      hasOpenFiles,
      getOpenFileCount,
      getDirtyFiles,
    }),
    [
      openFiles,
      activeFilePath,
      decorations,
      editorStates,
      openFile,
      closeFile,
      setActiveFile,
      updateFileContent,
      markFileDirty,
      getFile,
      getActiveFile,
      isFileOpen,
      setDecorations,
      getDecorations,
      clearDecorations,
      clearAllDecorations,
      saveEditorState,
      getEditorState,
      clearEditorState,
      hasOpenFiles,
      getOpenFileCount,
      getDirtyFiles,
    ]
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
};
