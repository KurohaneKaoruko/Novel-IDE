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
 * Represents a set of changes across multiple files
 */
export interface ChangeSet {
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
    const changeSet: ChangeSet = {
      id: this.generateChangeSetId(),
      timestamp: Date.now(),
      files: files.map(file => ({
        ...file,
        status: 'pending',
        modifications: file.modifications.map(mod => ({
          ...mod,
          status: 'pending',
        })),
      })),
      status: 'pending',
    };

    // Store the change set
    this.changeSets.set(changeSet.id, changeSet);

    // Create backups of original file contents
    const backupMap = new Map<string, string>();
    for (const file of changeSet.files) {
      backupMap.set(file.filePath, file.originalContent);
    }
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

    // Find the modification
    let targetFile: FileModification | undefined;
    let targetMod: Modification | undefined;

    for (const file of changeSet.files) {
      const mod = file.modifications.find(m => m.id === modificationId);
      if (mod) {
        targetFile = file;
        targetMod = mod;
        break;
      }
    }

    if (!targetFile || !targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    // Update modification status
    targetMod.status = 'accepted';

    // Apply the modification to the file
    await this.applyModificationToFile(targetFile, targetMod);

    // Update file status
    this.updateFileStatus(targetFile);

    // Update change set status
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

    // Find the modification
    let targetFile: FileModification | undefined;
    let targetMod: Modification | undefined;

    for (const file of changeSet.files) {
      const mod = file.modifications.find(m => m.id === modificationId);
      if (mod) {
        targetFile = file;
        targetMod = mod;
        break;
      }
    }

    if (!targetFile || !targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    // Update modification status
    targetMod.status = 'rejected';

    // Update file status
    this.updateFileStatus(targetFile);

    // Update change set status
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

    // Track which files were successfully modified for rollback
    const modifiedFiles: string[] = [];

    try {
      // Accept all modifications in all files
      for (const file of changeSet.files) {
        for (const mod of file.modifications) {
          if (mod.status === 'pending') {
            mod.status = 'accepted';
          }
        }

        // Apply all accepted modifications to the file
        await this.applyAllModificationsToFile(file);
        modifiedFiles.push(file.filePath);

        // Update file status
        file.status = 'accepted';
      }

      // Update change set status
      changeSet.status = 'accepted';
    } catch (error) {
      // Rollback all changes if any file operation fails
      await this.rollbackFiles(changeSetId, modifiedFiles);
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

    // Reject all modifications in all files
    for (const file of changeSet.files) {
      for (const mod of file.modifications) {
        if (mod.status === 'pending') {
          mod.status = 'rejected';
        }
      }
      file.status = 'rejected';
    }

    // Update change set status
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

    // Find the modification
    let targetFile: FileModification | undefined;
    let targetMod: Modification | undefined;

    for (const file of changeSet.files) {
      const mod = file.modifications.find(m => m.id === modificationId);
      if (mod) {
        targetFile = file;
        targetMod = mod;
        break;
      }
    }

    if (!targetFile || !targetMod) {
      throw new Error(`Modification with id ${modificationId} not found in ChangeSet ${changeSetId}`);
    }

    if (targetMod.status !== 'accepted') {
      throw new Error(`Modification ${modificationId} is not in accepted state, cannot undo`);
    }

    // Restore the file to its original state
    const backupMap = this.fileBackups.get(changeSetId);
    if (!backupMap || !backupMap.has(targetFile.filePath)) {
      throw new Error(`No backup found for file ${targetFile.filePath} in ChangeSet ${changeSetId}`);
    }
    
    const backup = backupMap.get(targetFile.filePath)!;

    // Write the backup content back to the file
    await this.writeFile(targetFile.filePath, backup);

    // Update modification status
    targetMod.status = 'pending';

    // Update file status
    this.updateFileStatus(targetFile);

    // Update change set status
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

    for (const file of changeSet.files) {
      for (const mod of file.modifications) {
        totalModifications++;
        if (mod.status === 'accepted') {
          acceptedModifications++;
        } else if (mod.status === 'rejected') {
          rejectedModifications++;
        } else if (mod.status === 'pending') {
          pendingModifications++;
        }
      }
    }

    return {
      id: changeSet.id,
      status: changeSet.status,
      totalModifications,
      acceptedModifications,
      rejectedModifications,
      pendingModifications,
      filesAffected: changeSet.files.length,
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
   * @param file - The file modification object
   * @param modification - The modification to apply
   */
  private async applyModificationToFile(file: FileModification, modification: Modification): Promise<void> {
    // Read current file content
    const currentContent = await this.readFile(file.filePath);
    
    // Apply the modification
    const lines = currentContent.split('\n');
    const startIdx = modification.lineStart - 1; // Convert to 0-based index
    const endIdx = modification.lineEnd - 1;

    if (modification.type === 'add') {
      // Insert new lines
      const newLines = (modification.modifiedText || '').split('\n');
      lines.splice(startIdx, 0, ...newLines);
    } else if (modification.type === 'delete') {
      // Remove lines
      const deleteCount = endIdx - startIdx + 1;
      lines.splice(startIdx, deleteCount);
    } else if (modification.type === 'modify') {
      // Replace lines
      const deleteCount = endIdx - startIdx + 1;
      const newLines = (modification.modifiedText || '').split('\n');
      lines.splice(startIdx, deleteCount, ...newLines);
    }

    const modifiedContent = lines.join('\n');

    // Write the modified content back to the file
    await this.writeFile(file.filePath, modifiedContent);
  }

  /**
   * Apply all accepted modifications to a file
   * @param file - The file modification object
   */
  private async applyAllModificationsToFile(file: FileModification): Promise<void> {
    // Get accepted modifications sorted by line number (descending)
    const acceptedMods = file.modifications
      .filter(mod => mod.status === 'accepted')
      .sort((a, b) => b.lineStart - a.lineStart);

    if (acceptedMods.length === 0) {
      return;
    }

    // Start with original content
    let content = file.originalContent;
    const lines = content.split('\n');

    // Apply each modification from bottom to top
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

    content = lines.join('\n');

    // Write the modified content to the file
    await this.writeFile(file.filePath, content);
  }

  /**
   * Update the status of a file based on its modifications
   * @param file - The file modification object
   */
  private updateFileStatus(file: FileModification): void {
    const statuses = file.modifications.map(mod => mod.status);
    const allAccepted = statuses.every(status => status === 'accepted');
    const allRejected = statuses.every(status => status === 'rejected');
    const allPending = statuses.every(status => status === 'pending');

    if (allAccepted) {
      file.status = 'accepted';
    } else if (allRejected) {
      file.status = 'rejected';
    } else if (allPending) {
      file.status = 'pending';
    } else {
      file.status = 'partial';
    }
  }

  /**
   * Update the status of a change set based on its files
   * @param changeSet - The change set to update
   */
  private updateChangeSetStatus(changeSet: ChangeSet): void {
    const statuses = changeSet.files.map(file => file.status);
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
   * Rollback files to their original state
   * @param changeSetId - The ID of the change set
   * @param filePaths - Array of file paths to rollback
   */
  private async rollbackFiles(changeSetId: string, filePaths: string[]): Promise<void> {
    const backupMap = this.fileBackups.get(changeSetId);
    if (!backupMap) {
      throw new Error(`No backups found for ChangeSet ${changeSetId}`);
    }

    for (const filePath of filePaths) {
      const backup = backupMap.get(filePath);
      if (backup) {
        await this.writeFile(filePath, backup);
      }
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
