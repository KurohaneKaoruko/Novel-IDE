# AI Multi-Line Editing Feature

## Overview

The AI multi-line editing feature allows the AI assistant to modify files at any line position, not just append content at the end. This enables the AI to:

- Replace specific line ranges with new content
- Insert new lines at any position
- Delete specific line ranges
- Make multiple modifications across multiple files in a single operation

## How It Works

### 1. AI Response Format

When the AI wants to modify files, it uses a special XML-based format in its response:

```xml
<file_edit path="stories/chapter-001.txt">
  <replace lines="10-15">
  This is the new content that will replace lines 10-15.
  It can span multiple lines.
  </replace>
  
  <insert at="20">
  This line will be inserted at line 20.
  </insert>
  
  <delete lines="30-35" />
</file_edit>
```

### 2. Backend Processing

The Rust backend (`ai_response_parser.rs`) parses the AI response and:

1. Detects `<file_edit>` tags in the response
2. Extracts the file path and modification instructions
3. Reads the original file content
4. Creates a `ChangeSet` containing all modifications
5. Emits the `ChangeSet` to the frontend via the `ai_change_set` event

### 3. Frontend Display

The frontend (`App.tsx`) receives the `ChangeSet` and:

1. Adds it to the `DiffContext` for state management
2. Updates the chat message to include file modification information
3. Displays a list of modified files with statistics (+X -Y ~Z lines)
4. Opens the `DiffView` panel automatically

### 4. User Review

Users can review modifications in the `DiffView` component:

- View side-by-side or unified diff of changes
- See color-coded highlights (green=add, red=delete, yellow=modify)
- Accept or reject individual modifications
- Accept or reject all modifications at once
- Undo accepted modifications

## Usage Example

### User Request:
```
请帮我修改 stories/chapter-001.txt 的第 10-15 行，将主角的对话改得更生动一些。
```

### AI Response:
```
好的，我来帮你修改主角的对话，让它更生动：

<file_edit path="stories/chapter-001.txt">
  <replace lines="10-15">
  "等等！"他猛地站起身，椅子发出刺耳的摩擦声。"你说的那个地方，我去过！"
  
  他的眼睛里闪烁着兴奋的光芒，声音因激动而微微颤抖。
  
  "那里有一座古老的石碑，上面刻着奇怪的符文。我当时以为只是普通的遗迹，没想到..."
  </replace>
</file_edit>

我已经将对话修改得更加生动，增加了动作描写和情绪表现。你可以在 Diff 视图中查看具体的修改内容。
```

### Frontend Display:

The chat panel will show:
```
📝 修改了 1 个文件

📄 chapter-001.txt
   stories/chapter-001.txt
   ~1 修改
```

Clicking on the file opens the DiffView showing the before/after comparison.

## Technical Details

### Data Flow

```
User Input → AI Provider → Agent System → AI Response
                                              ↓
                                    AI Response Parser
                                              ↓
                                         ChangeSet
                                              ↓
                                    Frontend (ai_change_set event)
                                              ↓
                                        DiffContext
                                              ↓
                                         DiffView
```

### Key Components

1. **modification_types.rs**: Defines the data structures for modifications
   - `Modification`: Single modification (add/delete/modify)
   - `FileModification`: Modifications for a single file
   - `ChangeSet`: Collection of file modifications

2. **ai_response_parser.rs**: Parses AI responses for file edit instructions
   - `parse_ai_response()`: Main parsing function
   - `parse_file_edits()`: Extracts file edit blocks
   - `parse_modifications()`: Parses individual modifications

3. **commands.rs**: Integrates parsing into the chat stream
   - Modified `chat_generate_stream()` to parse responses
   - Emits `ai_change_set` event when modifications are detected

4. **App.tsx**: Handles the frontend display
   - Listens for `ai_change_set` events
   - Updates chat messages with file modification info
   - Opens DiffView automatically

5. **DiffView.tsx**: Displays the diff and allows user review
   - Shows side-by-side or unified diff
   - Provides accept/reject buttons
   - Integrates with ModificationService

## Configuration

The AI agent system prompt has been updated to include instructions for using the file edit format:

```
文件编辑格式（用于多行编辑）：
当你需要修改文件的特定行时，使用以下 XML 格式：
<file_edit path="相对路径">
  <replace lines="起始行-结束行">新内容</replace>
  <insert at="行号">插入内容</insert>
  <delete lines="起始行-结束行" />
</file_edit>
```

## Benefits

1. **Precise Editing**: AI can modify specific sections without rewriting entire files
2. **User Control**: Users can review and selectively accept/reject changes
3. **Multi-File Support**: AI can modify multiple files in a single operation
4. **Visual Feedback**: Clear diff view shows exactly what changed
5. **Undo Support**: Users can undo accepted modifications
6. **Atomic Operations**: Multi-file changes are applied atomically

## Future Enhancements

- Add support for more complex modification patterns
- Implement conflict detection for overlapping modifications
- Add keyboard shortcuts for accepting/rejecting modifications
- Support for partial line modifications (character-level edits)
- Integration with version control for tracking AI modifications
