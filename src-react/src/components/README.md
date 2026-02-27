# DiffView Component Integration

## Overview

The DiffView component provides a visual interface for reviewing and managing file modifications suggested by AI. It supports:

- **Side-by-side (split) view**: Original and modified content displayed in parallel
- **Unified view**: Interleaved display of changes
- **Granular control**: Accept/reject individual modifications or all at once
- **Multiple files**: Tab-based interface for managing multiple ChangeSets
- **Real-time updates**: Changes are immediately reflected in the UI

## Architecture

### Components

1. **DiffView** (`src/components/DiffView.tsx`)
   - Displays a single file's modifications
   - Renders diff highlighting (add/delete/modify)
   - Provides accept/reject buttons for each modification

2. **DiffContext** (`src/contexts/DiffContext.tsx`)
   - Global state management for ChangeSets
   - Manages active ChangeSet and view mode
   - Provides hooks for adding/removing/updating ChangeSets

3. **DiffPanel** (integrated in `App.tsx`)
   - Modal overlay containing DiffView instances
   - Tab management for multiple ChangeSets
   - View mode toggle (split/unified)

### Services

1. **DiffService** (`src/services/DiffService.ts`)
   - Computes text differences
   - Converts diffs to Modification objects
   - Applies modifications to text

2. **ModificationService** (`src/services/ModificationService.ts`)
   - Creates and manages ChangeSets
   - Handles accept/reject operations
   - Persists changes to files
   - Supports undo functionality

## Usage

### Basic Integration

```typescript
import { useDiff } from './contexts/DiffContext';
import { modificationService, diffService } from './services';

function MyComponent() {
  const diffContext = useDiff();

  const handleAIResponse = (originalContent: string, modifiedContent: string, filePath: string) => {
    // 1. Compute diff
    const diffResult = diffService.computeDiff(originalContent, modifiedContent);
    const modifications = diffService.diffToModifications(diffResult);

    // 2. Create ChangeSet
    const changeSet = modificationService.createChangeSet([
      {
        filePath,
        originalContent,
        modifications,
        status: 'pending',
      },
    ]);

    // 3. Add to context
    diffContext.addChangeSet(changeSet);
    diffContext.setActiveChangeSet(changeSet.id);

    // 4. Open DiffView panel (in App.tsx)
    // setShowDiffPanel(true);
    // setActiveDiffTab(changeSet.id);
  };

  return <button onClick={() => handleAIResponse(...)}>Show Diff</button>;
}
```

### Multi-File Modifications

```typescript
const handleMultiFileModifications = (files: Array<{path: string, original: string, modified: string}>) => {
  const fileModifications = files.map(file => {
    const diffResult = diffService.computeDiff(file.original, file.modified);
    const modifications = diffService.diffToModifications(diffResult);

    return {
      filePath: file.path,
      originalContent: file.original,
      modifications,
      status: 'pending' as const,
    };
  });

  const changeSet = modificationService.createChangeSet(fileModifications);
  diffContext.addChangeSet(changeSet);
  diffContext.setActiveChangeSet(changeSet.id);
};
```

### Handling Accept/Reject

```typescript
// Accept a single modification
const onAcceptModification = async (changeSetId: string, modificationId: string) => {
  await modificationService.acceptModification(changeSetId, modificationId);
  const updatedChangeSet = modificationService.getChangeSet(changeSetId);
  if (updatedChangeSet) {
    diffContext.updateChangeSet(updatedChangeSet);
  }
};

// Reject a single modification
const onRejectModification = (changeSetId: string, modificationId: string) => {
  modificationService.rejectModification(changeSetId, modificationId);
  const updatedChangeSet = modificationService.getChangeSet(changeSetId);
  if (updatedChangeSet) {
    diffContext.updateChangeSet(updatedChangeSet);
  }
};

// Accept all modifications in a ChangeSet
const onAcceptAll = async (changeSetId: string) => {
  await modificationService.acceptAll(changeSetId);
  const updatedChangeSet = modificationService.getChangeSet(changeSetId);
  if (updatedChangeSet) {
    diffContext.updateChangeSet(updatedChangeSet);
  }
};
```

## State Management

### DiffContext State

```typescript
interface DiffState {
  changeSets: Map<string, ChangeSet>;      // All active ChangeSets
  activeChangeSetId: string | null;         // Currently displayed ChangeSet
  viewMode: 'split' | 'unified';           // Display mode
}
```

### ChangeSet Structure

```typescript
interface ChangeSet {
  id: string;                               // Unique identifier
  timestamp: number;                        // Creation time
  files: FileModification[];                // Modified files
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
}

interface FileModification {
  filePath: string;                         // Relative path
  originalContent: string;                  // Original file content
  modifications: Modification[];            // List of modifications
  status: 'pending' | 'partial' | 'accepted' | 'rejected';
}

interface Modification {
  id: string;                               // Unique identifier
  type: 'add' | 'delete' | 'modify';       // Modification type
  lineStart: number;                        // Start line (0-indexed)
  lineEnd: number;                          // End line (0-indexed)
  originalText?: string;                    // Original text (for delete/modify)
  modifiedText?: string;                    // New text (for add/modify)
  status: 'pending' | 'accepted' | 'rejected';
}
```

## UI Components

### DiffView Panel Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Tab 1] [Tab 2] [Tab 3]                    [Close Panel]│
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ File: stories/chapter-001.txt  +2 -1 ~3         │   │
│  │ [Accept All] [Reject All]                       │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ Original          │ Modified                     │   │
│  │ 1 The sun rose    │ 1 The golden sun rose       │   │
│  │ 2 The hero woke   │ 2 The hero woke up          │   │
│  │ 3 He prepared     │ 3 He carefully prepared     │   │
│  └─────────────────────────────────────────────────┘   │
│                                                           │
│  Modifications:                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [modify] Lines 1-1 [pending] [Accept] [Reject]  │   │
│  │ [modify] Lines 2-2 [pending] [Accept] [Reject]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                           │
├─────────────────────────────────────────────────────────┤
│                                    [⊞ Split / ⊟ Unified]│
└─────────────────────────────────────────────────────────┘
```

### Color Coding

- **Green**: Added lines (`diff-line-add`)
- **Red**: Deleted lines (`diff-line-delete`)
- **Yellow**: Modified lines (`diff-line-modify`)
- **Faded**: Accepted modifications (opacity: 0.6)
- **Strikethrough**: Rejected modifications

## Integration with AI Chat

### Step 1: Modify AI Response Handler

In `App.tsx`, update the `onSendChat` callback to handle AI responses with modifications:

```typescript
const onSendChat = useCallback(async (content: string) => {
  // ... existing chat logic ...

  // After receiving AI response:
  if (aiResponse.modifications) {
    const changeSetId = handleAIModifications(aiResponse.modifications);
    if (changeSetId) {
      onOpenDiffView(changeSetId);
    }
  }
}, [handleAIModifications, onOpenDiffView]);
```

### Step 2: Parse AI Response

The AI response should include modification instructions. Example format:

```json
{
  "message": "I've improved the chapter opening.",
  "modifications": [
    {
      "filePath": "stories/chapter-001.txt",
      "originalContent": "...",
      "modifiedContent": "..."
    }
  ]
}
```

### Step 3: Display in Chat

Show file modification info in chat messages:

```typescript
{chatMessages.map((m) => (
  <div key={m.id} className="message">
    <div className="message-content">{m.content}</div>
    {m.changeSetId && (
      <div className="message-files">
        <button onClick={() => onOpenDiffView(m.changeSetId)}>
          View Changes ({changeSet.files.length} files)
        </button>
      </div>
    )}
  </div>
))}
```

## Keyboard Shortcuts

Recommended shortcuts (to be implemented):

- `Ctrl+Shift+D`: Toggle DiffView panel
- `Ctrl+Enter`: Accept current modification
- `Ctrl+Backspace`: Reject current modification
- `Ctrl+Shift+Enter`: Accept all modifications
- `Ctrl+Tab`: Switch between DiffView tabs
- `Escape`: Close DiffView panel

## Testing

See `DiffView.example.tsx` for usage examples and test scenarios.

## Requirements Validation

This implementation satisfies the following requirements:

- **Requirement 2.2**: Multiple DiffView instances (one per file)
- **Requirement 3.1**: Diff view displays original and modified content
- **Requirement 3.2-3.4**: Color-coded highlighting (green/red/yellow)
- **Requirement 3.5**: Split and unified view modes
- **Requirement 3.6**: Line numbers displayed
- **Requirement 4.1**: Accept/reject buttons for each modification
- **Requirement 4.4**: Accept all/reject all buttons

## Future Enhancements

1. **Inline editing**: Allow users to edit modifications before accepting
2. **Conflict resolution**: Handle overlapping modifications
3. **History**: Track modification history and allow rollback
4. **Keyboard navigation**: Navigate between modifications with arrow keys
5. **Search**: Find specific changes within large diffs
6. **Export**: Export diff as patch file
7. **Comments**: Add comments to specific modifications
