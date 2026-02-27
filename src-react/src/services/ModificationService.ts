import type { Modification } from './DiffService';
import { invoke } from '@tauri-apps/api/core';

/**
 * Represents a modification to a single file
 */
export interface FileModification {
  filePath: string;
  originalContent: string;
  modifications: Modification[];
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
}

/**
 * Represents a set of changes for a single file
 */
export interface ChangeSet {
  id: string;
  timestamp: number;
  filePath: string;
  modifications: Modification[];
  stats: {
    additions: number;
    deletions: number;
  };
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
}

/**
 * Represents a set of changes across multiple files (legacy)
 */
export interface MultiFileChangeSet {
  id: string;
  timestamp: number;
  files: FileModification[];
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
}

/**
 * Status information for a ChangeSet
 */
export interface ChangeSetStatus {
  id: string;
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
  totalModifications: number;
  acceptedModifications: number;
  rejectedModifications: number;
  pendingModifications: number;
  filesAffected: number;
}

/**
 * Service for managing AI-generated modifications and change sets
 */
export class ModificationService {
  private changeSets: Map<string, ChangeSet> = new Map();
  private fileBackups: Map<string, Map<string, string>> = new Map(); // changeSetId -> filePath -> backup content

  /**
   * Create a new change set from file modifications
   * @param files - Array of file modifications
   * @returns The created ChangeSet
   */
  createChangeSet(files: FileModification[]): ChangeSet {
    if (files.length === 0) {
      throw new Error('Cannot create ChangeSet with no files');
    }

    const firstFile = files[0];
    let additions = 0;
    let deletions = 0;

    for (const mod of firstFile.modifications) {
      if (mod.type === 'add') additions++;
      else if (mod.type === 'delete') deletions++;
      else if (mod.type === 'modify') { additions++; deletions++; }
    }

    const changeSet: ChangeSet = {
      id: this.generateChangeSetId(),
      timestamp: Date.now(),
      filePath: firstFile.filePath,
      modifications: firstFile.modifications.map(mod => ({
        ...mod,
        status: 'pending',
      })),
      stats: { additions, deletions },
      status: 'pending',
    };

    this.changeSets.set(changeSet.id, changeSet);

    const backupMap = new Map<string, string>();
    backupMap.set(firstFile.filePath, firstFile.originalContent);
    this.fileBackups.set(changeSet.id, backupMap);

    return changeSet;
  }

  /**
   * Accept a single modification within a change set
   * @param changeSetId - The ID of the change set
   * @param modificationId - The ID of the modification to accept
   * @throws Error if change set or modification not found
   */
  async acceptModification(changeSetId: string, modificationId: string): Promise<void> {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    const targetMod = changeSet.modifications.find(m => m.id === modificationId);
    if (!targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    targetMod.status = 'accepted';
    await this.applyModificationToFile(changeSet.filePath, targetMod);
    this.updateChangeSetStatus(changeSet);
  }

  /**
   * Reject a single modification within a change set
   * @param changeSetId - The ID of the change set
   * @param modificationId - The ID of the modification to reject
   * @throws Error if change set or modification not found
   */
  rejectModification(changeSetId: string, modificationId: string): void {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    const targetMod = changeSet.modifications.find(m => m.id === modificationId);
    if (!targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    targetMod.status = 'rejected';
    this.updateChangeSetStatus(changeSet);
  }

  /**
   * Accept all modifications in a change set
   * @param changeSetId - The ID of the change set
   * @throws Error if change set not found or if any file operation fails
   */
  async acceptAll(changeSetId: string): Promise<void> {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    try {
      for (const mod of changeSet.modifications) {
        if (mod.status === 'pending') {
          mod.status = 'accepted';
        }
      }
      await this.applyAllModificationsToChangeSet(changeSet);
      changeSet.status = 'accepted';
    } catch (error) {
      await this.rollbackFile(changeSetId, changeSet.filePath);
      throw new Error(`Failed to accept all modifications: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reject all modifications in a change set
   * @param changeSetId - The ID of the change set
   * @throws Error if change set not found
   */
  rejectAll(changeSetId: string): void {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    for (const mod of changeSet.modifications) {
      if (mod.status === 'pending') {
        mod.status = 'rejected';
      }
    }
    changeSet.status = 'rejected';
  }

  /**
   * Undo a previously accepted modification
   * @param changeSetId - The ID of the change set
   * @param modificationId - The ID of the modification to undo
   * @throws Error if change set or modification not found, or if modification was not accepted
   */
  async undoModification(changeSetId: string, modificationId: string): Promise<void> {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    const targetMod = changeSet.modifications.find(m => m.id === modificationId);
    if (!targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    if (targetMod.status !== 'accepted') {
      throw new Error(`Modification ${modificationId} is not in accepted state, cannot undo`);
    }

    const backupMap = this.fileBackups.get(changeSetId);
    if (!backupMap || !backupMap.has(changeSet.filePath)) {
      throw new Error(`No backup found for file ${changeSet.filePath} in ChangeSet ${changeSetId}`);
    }
    
    const backup = backupMap.get(changeSet.filePath)!;
    await this.writeFile(changeSet.filePath, backup);
    targetMod.status = 'pending';
    this.updateChangeSetStatus(changeSet);
  }

  /**
   * Get the status of a change set
   * @param changeSetId - The ID of the change set
   * @returns ChangeSetStatus object
   * @throws Error if change set not found
   */
  getChangeSetStatus(changeSetId: string): ChangeSetStatus {
    const changeSet = this.changeSets.get(changeSetId);
    if (!changeSet) {
      throw new Error(`ChangeSet with id ${changeSetId} not found`);
    }

    let totalModifications = 0;
    let acceptedModifications = 0;
    let rejectedModifications = 0;
    let pendingModifications = 0;

    for (const mod of changeSet.modifications) {
      totalModifications++;
      if (mod.status === 'accepted') {
        acceptedModifications++;
      } else if (mod.status === 'rejected') {
        rejectedModifications++;
      } else if (mod.status === 'pending') {
        pendingModifications++;
      }
    }

    return {
      id: changeSet.id,
      status: changeSet.status,
      totalModifications,
      acceptedModifications,
      rejectedModifications,
      pendingModifications,
      filesAffected: 1,
    };
  }

  /**
   * Get a change set by ID
   * @param changeSetId - The ID of the change set
   * @returns The ChangeSet or undefined if not found
   */
  getChangeSet(changeSetId: string): ChangeSet | undefined {
    return this.changeSets.get(changeSetId);
  }

  /**
   * Delete a change set and its backups
   * @param changeSetId - The ID of the change set to delete
   */
  deleteChangeSet(changeSetId: string): void {
    this.changeSets.delete(changeSetId);
    this.fileBackups.delete(changeSetId);
  }

  /**
   * Apply a single modification to a file
   * @param filePath - The file path
   * @param modification - The modification to apply
   */
  private async applyModificationToFile(filePath: string, modification: Modification): Promise<void> {
    const currentContent = await this.readFile(filePath);
    const lines = currentContent.split('\n');
    const startIdx = modification.lineStart - 1;
    const endIdx = modification.lineEnd - 1;

    if (modification.type === 'add') {
      const newLines = (modification.modifiedText || '').split('\n');
      lines.splice(startIdx, 0, ...newLines);
    } else if (modification.type === 'delete') {
      const deleteCount = endIdx - startIdx + 1;
      lines.splice(startIdx, deleteCount);
    } else if (modification.type === 'modify') {
      const deleteCount = endIdx - startIdx + 1;
      const newLines = (modification.modifiedText || '').split('\n');
      lines.splice(startIdx, deleteCount, ...newLines);
    }

    const modifiedContent = lines.join('\n');
    await this.writeFile(filePath, modifiedContent);
  }

  /**
   * Apply all accepted modifications to a change set
   * @param changeSet - The change set
   */
  private async applyAllModificationsToChangeSet(changeSet: ChangeSet): Promise<void> {
    const backupMap = this.fileBackups.get(changeSet.id);
    if (!backupMap) return;

    const originalContent = backupMap.get(changeSet.filePath);
    if (!originalContent) return;

    const acceptedMods = changeSet.modifications
      .filter(mod => mod.status === 'accepted')
      .sort((a, b) => b.lineStart - a.lineStart);

    if (acceptedMods.length === 0) return;

    const lines = originalContent.split('\n');

    for (const mod of acceptedMods) {
      const startIdx = mod.lineStart - 1;
      const endIdx = mod.lineEnd - 1;

      if (mod.type === 'add') {
        const newLines = (mod.modifiedText || '').split('\n');
        lines.splice(startIdx, 0, ...newLines);
      } else if (mod.type === 'delete') {
        const deleteCount = endIdx - startIdx + 1;
        lines.splice(startIdx, deleteCount);
      } else if (mod.type === 'modify') {
        const deleteCount = endIdx - startIdx + 1;
        const newLines = (mod.modifiedText || '').split('\n');
        lines.splice(startIdx, deleteCount, ...newLines);
      }
    }

    const content = lines.join('\n');
    await this.writeFile(changeSet.filePath, content);
  }

  /**
   * Update the status of a change set based on its modifications
   * @param changeSet - The change set to update
   */
  private updateChangeSetStatus(changeSet: ChangeSet): void {
    const statuses = changeSet.modifications.map(mod => mod.status);
    const allAccepted = statuses.every(status => status === 'accepted');
    const allRejected = statuses.every(status => status === 'rejected');
    const allPending = statuses.every(status => status === 'pending');

    if (allAccepted) {
      changeSet.status = 'accepted';
    } else if (allRejected) {
      changeSet.status = 'rejected';
    } else if (allPending) {
      changeSet.status = 'pending';
    } else {
      changeSet.status = 'partial';
    }
  }

  /**
   * Rollback a file to its original state
   * @param changeSetId - The ID of the change set
   * @param filePath - The file path to rollback
   */
  private async rollbackFile(changeSetId: string, filePath: string): Promise<void> {
    const backupMap = this.fileBackups.get(changeSetId);
    if (!backupMap) {
      throw new Error(`No backups found for ChangeSet ${changeSetId}`);
    }

    const backup = backupMap.get(filePath);
    if (backup) {
      await this.writeFile(filePath, backup);
    }
  }

  /**
   * Read file content using Tauri API
   * @param filePath - The path to the file (relative to workspace root)
   * @returns The file content as a string
   */
  private async readFile(filePath: string): Promise<string> {
    try {
      const content = await invoke<string>('read_text', { relativePath: filePath });
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write content to a file using Tauri API
   * @param filePath - The path to the file (relative to workspace root)
   * @param content - The content to write
   */
  private async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await invoke('write_text', { relativePath: filePath, content });
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a unique ID for a change set
   * @returns A unique ID string
   */
  private generateChangeSetId(): string {
    return `changeset-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Export a singleton instance
export const modificationService = new ModificationService();
