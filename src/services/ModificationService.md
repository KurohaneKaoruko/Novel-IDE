# ModificationService

The `ModificationService` manages AI-generated file modifications and change sets. It provides functionality for creating, accepting, rejecting, and undoing modifications across multiple files.

## Overview

The service is responsible for:
- Creating change sets from file modifications
- Managing modification lifecycle (pending → accepted/rejected)
- Applying modifications to files
- Maintaining backups for rollback
- Ensuring atomicity for multi-file operations

## Core Concepts

### ChangeSet
A collection of file modifications generated in a single AI operation. Each change set has:
- Unique ID
- Timestamp
- Status (pending/partial/accepted/rejected)
- List of file modifications

### FileModification
Represents modifications to a single file:
- File path (relative to workspace root)
- Original content (backup)
- List of modifications
- Status

### Modification
A single change to a file (inherited from DiffService):
- Type: add/delete/modify
- Line range
- Original and modified text
- Status

## API Reference

### createChangeSet(files: FileModification[]): ChangeSet
Creates a new change set from file modifications.

**Parameters:**
- `files`: Array of file modifications

**Returns:** The created ChangeSet with unique ID and timestamp

**Example:**
```typescript
const changeSet = modificationService.createChangeSet([
  {
    filePath: 'chapter-001.txt',
    originalContent: 'Original text...',
    modifications: [
      {
        id: 'mod-1',
        type: 'modify',
        lineStart: 5,
        lineEnd: 7,
        originalText: 'old text',
        modifiedText: 'new text',
        status: 'pending'
      }
    ],
    status: 'pending'
  }
]);
```

### acceptModification(changeSetId: string, modificationId: string): Promise<void>
Accepts a single modification and applies it to the file.

**Parameters:**
- `changeSetId`: ID of the change set
- `modificationId`: ID of the modification to accept

**Throws:** Error if change set or modification not found

**Example:**
```typescript
await modificationService.acceptModification('changeset-123', 'mod-1');
```

### rejectModification(changeSetId: string, modificationId: string): void
Rejects a single modification without applying it.

**Parameters:**
- `changeSetId`: ID of the change set
- `modificationId`: ID of the modification to reject

**Throws:** Error if change set or modification not found

**Example:**
```typescript
modificationService.rejectModification('changeset-123', 'mod-1');
```

### acceptAll(changeSetId: string): Promise<void>
Accepts all modifications in a change set. If any file operation fails, all changes are rolled back.

**Parameters:**
- `changeSetId`: ID of the change set

**Throws:** Error if change set not found or if any file operation fails

**Example:**
```typescript
await modificationService.acceptAll('changeset-123');
```

### rejectAll(changeSetId: string): void
Rejects all modifications in a change set.

**Parameters:**
- `changeSetId`: ID of the change set

**Throws:** Error if change set not found

**Example:**
```typescript
modificationService.rejectAll('changeset-123');
```

### undoModification(changeSetId: string, modificationId: string): Promise<void>
Undoes a previously accepted modification by restoring the original file content.

**Parameters:**
- `changeSetId`: ID of the change set
- `modificationId`: ID of the modification to undo

**Throws:** Error if change set or modification not found, or if modification was not accepted

**Example:**
```typescript
await modificationService.undoModification('changeset-123', 'mod-1');
```

### getChangeSetStatus(changeSetId: string): ChangeSetStatus
Gets the current status of a change set.

**Parameters:**
- `changeSetId`: ID of the change set

**Returns:** ChangeSetStatus object with statistics

**Throws:** Error if change set not found

**Example:**
```typescript
const status = modificationService.getChangeSetStatus('changeset-123');
console.log(`${status.acceptedModifications}/${status.totalModifications} accepted`);
```

### getChangeSet(changeSetId: string): ChangeSet | undefined
Retrieves a change set by ID.

**Parameters:**
- `changeSetId`: ID of the change set

**Returns:** The ChangeSet or undefined if not found

**Example:**
```typescript
const changeSet = modificationService.getChangeSet('changeset-123');
if (changeSet) {
  console.log(`Change set has ${changeSet.files.length} files`);
}
```

### deleteChangeSet(changeSetId: string): void
Deletes a change set and its backups.

**Parameters:**
- `changeSetId`: ID of the change set to delete

**Example:**
```typescript
modificationService.deleteChangeSet('changeset-123');
```

## Status Management

The service automatically manages status at three levels:

### Modification Status
- `pending`: Not yet accepted or rejected
- `accepted`: Applied to file
- `rejected`: Not applied to file

### File Status
- `pending`: All modifications are pending
- `partial`: Some modifications accepted, some rejected/pending
- `accepted`: All modifications accepted
- `rejected`: All modifications rejected

### ChangeSet Status
- `pending`: All files are pending
- `partial`: Some files accepted, some rejected/pending
- `accepted`: All files accepted
- `rejected`: All files rejected

## Atomicity and Rollback

The service ensures atomicity for multi-file operations:

1. **acceptAll()**: If any file operation fails, all previously modified files are rolled back to their original state
2. **Backups**: Original file contents are stored when creating a change set
3. **undoModification()**: Restores file to original state from backup

## Integration with Tauri

The service uses Tauri commands for file operations:
- `read_text`: Read file content (relative to workspace root)
- `write_text`: Write file content (relative to workspace root)

All file paths should be relative to the workspace root.

## Usage Example

```typescript
import { modificationService } from './services';

// Create a change set
const changeSet = modificationService.createChangeSet([
  {
    filePath: 'stories/chapter-001.txt',
    originalContent: 'Chapter 1\n\nOld content...',
    modifications: [
      {
        id: 'mod-1',
        type: 'modify',
        lineStart: 3,
        lineEnd: 3,
        originalText: 'Old content...',
        modifiedText: 'New improved content...',
        status: 'pending'
      }
    ],
    status: 'pending'
  }
]);

// Accept a modification
await modificationService.acceptModification(changeSet.id, 'mod-1');

// Check status
const status = modificationService.getChangeSetStatus(changeSet.id);
console.log(`Status: ${status.status}`);
console.log(`Accepted: ${status.acceptedModifications}/${status.totalModifications}`);

// Undo if needed
await modificationService.undoModification(changeSet.id, 'mod-1');

// Clean up
modificationService.deleteChangeSet(changeSet.id);
```

## Requirements Validation

This service validates the following requirements:

- **1.4**: Organizes all AI modifications into a ChangeSet
- **1.5**: Preserves original file state until explicitly accepted/rejected
- **2.1**: Supports multi-file modifications in a single ChangeSet
- **2.5**: Ensures atomicity with rollback on failure
- **4.2**: Applies modifications when accepted
- **4.3**: Preserves original content when rejected
- **4.6**: Supports undoing accepted modifications

## Testing

The service includes comprehensive unit tests covering:
- Change set creation
- Modification acceptance and rejection
- Status updates
- Error handling
- Multi-file operations
- Atomicity and rollback

Run tests with:
```bash
npx vitest run ModificationService.test.ts
```
