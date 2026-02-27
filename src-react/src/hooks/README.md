# React Hooks

This directory contains custom React hooks for the AI Novel Editor.

## useAutoSave

Hook for automatically saving editor content to localStorage at regular intervals.

### Features

- **Automatic saving**: Saves content at configurable intervals (default: 30 seconds)
- **Crash recovery**: Enables recovery of unsaved content after application crashes
- **Conditional saving**: Only saves when enabled and content is dirty
- **Cleanup**: Provides functions to clear saved content after successful file save

### Usage

```typescript
import { useAutoSave, getAutoSavedContent, clearAutoSavedContent } from './hooks/useAutoSave';

function MyEditor() {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  
  // Auto-save every 30 seconds
  useAutoSave({
    filePath: 'path/to/file.txt',
    content: content,
    enabled: isDirty,
    intervalMs: 30000,
  });

  // Check for auto-saved content on mount
  useEffect(() => {
    const saved = getAutoSavedContent('path/to/file.txt');
    if (saved && saved.content !== content) {
      // Prompt user to recover
      setContent(saved.content);
      setIsDirty(true);
    }
  }, []);

  // Clear auto-save after successful save
  const handleSave = async () => {
    await saveFile(content);
    clearAutoSavedContent('path/to/file.txt');
    setIsDirty(false);
  };

  return (
    <Editor value={content} onChange={setContent} />
  );
}
```

### Options

- `filePath`: Path to the file being edited (required)
- `content`: Current content to save (required)
- `enabled`: Whether auto-save is enabled (required)
- `intervalMs`: Save interval in milliseconds (optional, defaults to 30000)

### Requirements

This hook implements the following requirements:

- **Requirement 14.3**: Auto-save to local cache every 30 seconds
- **Requirement 14.4**: Crash recovery functionality

### See Also

- [RecoveryDialog](../components/RecoveryDialog.tsx) - UI for recovering auto-saved content
- [fileSaveErrorHandler](../utils/fileSaveErrorHandler.ts) - Error handling for file save operations

