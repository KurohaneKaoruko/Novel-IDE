# Services

This directory contains business logic services for the AI Novel Editor.

## DiffService

The `DiffService` provides functionality for computing text differences, managing modifications, and applying changes to text files.

### Features

- **Diff Computation**: Uses the `fast-diff` library to compute character-level differences between two text strings
- **Line-based Changes**: Converts character-level diffs to line-based changes for easier visualization
- **Change Merging**: Intelligently merges adjacent add/delete operations into modify operations
- **Modification Management**: Converts diffs into modification objects with status tracking (pending/accepted/rejected)
- **Selective Application**: Applies only accepted modifications while preserving original content for pending/rejected changes

### Type Definitions

#### DiffChange
Represents a single change in a diff operation:
```typescript
interface DiffChange {
  type: 'add' | 'delete' | 'modify';
  lineStart: number;
  lineEnd: number;
  originalText?: string;
  modifiedText?: string;
}
```

#### DiffResult
Result of a diff computation:
```typescript
interface DiffResult {
  changes: DiffChange[];
  stats: {
    additions: number;
    deletions: number;
    modifications: number;
  };
}
```

#### Modification
Represents a modification that can be accepted or rejected:
```typescript
interface Modification {
  id: string;
  type: 'add' | 'delete' | 'modify';
  lineStart: number;
  lineEnd: number;
  originalText?: string;
  modifiedText?: string;
  status: 'pending' | 'accepted' | 'rejected';
}
```

### Methods

#### computeDiff(original: string, modified: string): DiffResult
Computes the difference between two text strings and returns a structured result with changes and statistics.

#### diffToModifications(diff: DiffResult): Modification[]
Converts a DiffResult into an array of Modification objects, each with a unique ID and pending status.

#### applyModifications(original: string, modifications: Modification[]): string
Applies accepted modifications to the original text and returns the modified result. Pending and rejected modifications are ignored.

### Usage Example

```typescript
import { diffService } from './services';

// Compute diff
const original = 'Line 1\nLine 2\nLine 3';
const modified = 'Line 1\nModified Line 2\nLine 3\nLine 4';
const diff = diffService.computeDiff(original, modified);

// Convert to modifications
const modifications = diffService.diffToModifications(diff);

// Accept some modifications
modifications[0].status = 'accepted';

// Apply accepted modifications
const result = diffService.applyModifications(original, modifications);
```

### Requirements Satisfied

- **Requirement 1.1**: Supports insert, delete, and replace operations at any line range
- **Requirement 1.2**: Records start line, end line, and modification type for each modification
- **Requirement 3.1**: Provides structured diff data for visualization in DiffView components

### Testing

The service includes comprehensive unit tests covering:
- Addition, deletion, and modification detection
- Conversion from diffs to modifications
- Selective application of modifications
- Multiple modification handling
- Edge cases (empty texts, identical texts, etc.)

Run tests with:
```bash
npx vitest run src/services/DiffService.test.ts
```

### Dependencies

- `fast-diff`: Fast character-level diff algorithm
- `@types/fast-diff`: TypeScript type definitions for fast-diff
