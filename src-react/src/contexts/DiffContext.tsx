import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ChangeSet } from '../services';

/**
 * View mode for displaying diffs
 */
export type ViewMode = 'split' | 'unified';

/**
 * State managed by DiffContext
 */
interface DiffState {
  changeSets: Map<string, ChangeSet>;
  activeChangeSetId: string | null;
  viewMode: ViewMode;
}

/**
 * Actions available in DiffContext
 */
interface DiffContextValue extends DiffState {
  // ChangeSet management
  addChangeSet: (changeSet: ChangeSet) => void;
  removeChangeSet: (changeSetId: string) => void;
  updateChangeSet: (changeSet: ChangeSet) => void;
  getChangeSet: (changeSetId: string) => ChangeSet | undefined;
  
  // Active ChangeSet management
  setActiveChangeSet: (changeSetId: string | null) => void;
  
  // View mode management
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  
  // Utility methods
  hasChangeSets: () => boolean;
  getChangeSetCount: () => number;
}

// Create context with undefined default value
const DiffContext = createContext<DiffContextValue | undefined>(undefined);

/**
 * Props for DiffProvider component
 */
interface DiffProviderProps {
  children: ReactNode;
  initialViewMode?: ViewMode;
}

/**
 * Provider component for DiffContext
 * Manages change sets, active change set, and view mode state
 */
export const DiffProvider: React.FC<DiffProviderProps> = ({ 
  children, 
  initialViewMode = 'split' 
}) => {
  const [changeSets, setChangeSets] = useState<Map<string, ChangeSet>>(new Map());
  const [activeChangeSetId, setActiveChangeSetId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);

  /**
   * Add a new change set to the state
   */
  const addChangeSet = useCallback((changeSet: ChangeSet) => {
    setChangeSets(prev => {
      const next = new Map(prev);
      next.set(changeSet.id, changeSet);
      return next;
    });
  }, []);

  /**
   * Remove a change set from the state
   */
  const removeChangeSet = useCallback((changeSetId: string) => {
    setChangeSets(prev => {
      const next = new Map(prev);
      next.delete(changeSetId);
      return next;
    });
    
    // Clear active change set if it was removed
    setActiveChangeSetId(prev => prev === changeSetId ? null : prev);
  }, []);

  /**
   * Update an existing change set
   */
  const updateChangeSet = useCallback((changeSet: ChangeSet) => {
    setChangeSets(prev => {
      const next = new Map(prev);
      next.set(changeSet.id, changeSet);
      return next;
    });
  }, []);

  /**
   * Get a change set by ID
   */
  const getChangeSet = useCallback((changeSetId: string): ChangeSet | undefined => {
    return changeSets.get(changeSetId);
  }, [changeSets]);

  /**
   * Set the active change set
   */
  const setActiveChangeSet = useCallback((changeSetId: string | null) => {
    setActiveChangeSetId(changeSetId);
  }, []);

  /**
   * Toggle between split and unified view modes
   */
  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'split' ? 'unified' : 'split');
  }, []);

  /**
   * Check if there are any change sets
   */
  const hasChangeSets = useCallback(() => {
    return changeSets.size > 0;
  }, [changeSets]);

  /**
   * Get the number of change sets
   */
  const getChangeSetCount = useCallback(() => {
    return changeSets.size;
  }, [changeSets]);

  const value: DiffContextValue = {
    changeSets,
    activeChangeSetId,
    viewMode,
    addChangeSet,
    removeChangeSet,
    updateChangeSet,
    getChangeSet,
    setActiveChangeSet,
    setViewMode,
    toggleViewMode,
    hasChangeSets,
    getChangeSetCount,
  };

  return <DiffContext.Provider value={value}>{children}</DiffContext.Provider>;
};

/**
 * Hook to access DiffContext
 * @throws Error if used outside of DiffProvider
 */
export const useDiff = (): DiffContextValue => {
  const context = useContext(DiffContext);
  if (context === undefined) {
    throw new Error('useDiff must be used within a DiffProvider');
  }
  return context;
};
