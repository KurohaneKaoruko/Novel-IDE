# Character Hover Quick View - Testing Guide

## Feature Description

This feature adds character quick view functionality to the Monaco Editor. When you hover over a character name in the editor, a tooltip will appear showing the character's information from the character card system.

## Implementation Details

### Location
- **File**: `src/App.tsx`
- **Function**: Monaco Editor `onMount` handler

### How It Works

1. **Hover Provider Registration**: A Monaco hover provider is registered for the 'plaintext' language
2. **Character Name Detection**: When hovering over a word, the system extracts the word at the cursor position
3. **Character Lookup**: The system searches for characters matching the hovered word using `characterService.searchCharacters()`
4. **Exact Match**: An exact match (case-insensitive) is found from the search results
5. **Tooltip Display**: If a character is found, a formatted tooltip displays:
   - Character name (bold)
   - Appearance (if available)
   - Personality (if available)
   - Background (if available)
   - Relationships (if available)
   - Notes (if available)

### Code Implementation

```typescript
// Register character hover provider
const hoverProvider = monaco.languages.registerHoverProvider('plaintext', {
  provideHover: async (model, position) => {
    // Get the word at the current position
    const word = model.getWordAtPosition(position)
    if (!word) return null
    
    const characterName = word.word
    
    try {
      // Search for the character by name
      const characters = await characterService.searchCharacters(characterName)
      
      // Find exact match (case-insensitive)
      const character = characters.find(
        c => c.name.toLowerCase() === characterName.toLowerCase()
      )
      
      if (!character) return null
      
      // Build hover content with character information
      const lines: string[] = [
        `**${character.name}**`,
        '',
      ]
      
      if (character.data.appearance) {
        lines.push(`**外貌**: ${character.data.appearance}`)
      }
      
      if (character.data.personality) {
        lines.push(`**性格**: ${character.data.personality}`)
      }
      
      if (character.data.background) {
        lines.push(`**背景**: ${character.data.background}`)
      }
      
      if (character.data.relationships) {
        lines.push(`**关系**: ${character.data.relationships}`)
      }
      
      if (character.data.notes) {
        lines.push(`**备注**: ${character.data.notes}`)
      }
      
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        ),
        contents: [
          { value: lines.join('\n\n') }
        ]
      }
    } catch (error) {
      console.error('Failed to fetch character data:', error)
      return null
    }
  }
})

// Clean up hover provider when editor is disposed
editor.onDidDispose(() => {
  hoverProvider.dispose()
})
```

## Manual Testing Steps

### Prerequisites
1. Open a workspace in the Novel-IDE application
2. Create at least one character card using the Character Manager

### Test Case 1: Basic Hover Functionality

**Steps:**
1. Navigate to the Character Manager (left sidebar)
2. Create a new character with the following data:
   - Name: "张三"
   - Appearance: "高大威猛，浓眉大眼"
   - Personality: "性格豪爽，乐于助人"
   - Background: "出身武林世家"
   - Relationships: "李四的好友"
   - Notes: "主角的师兄"

3. Open or create a text file in the editor
4. Type the character name "张三" in the editor
5. Hover your mouse over the word "张三"

**Expected Result:**
- A tooltip should appear showing all the character information
- The tooltip should display:
  ```
  张三
  
  外貌: 高大威猛，浓眉大眼
  
  性格: 性格豪爽，乐于助人
  
  背景: 出身武林世家
  
  关系: 李四的好友
  
  备注: 主角的师兄
  ```

### Test Case 2: Case-Insensitive Matching

**Steps:**
1. Using the same character "张三" from Test Case 1
2. Type "张三" in different cases (if applicable for Chinese characters, test with English names)
3. For English character names, test with variations like "John", "john", "JOHN"

**Expected Result:**
- The hover tooltip should appear regardless of case
- The character information should be displayed correctly

### Test Case 3: No Match Scenario

**Steps:**
1. Type a word that is NOT a character name (e.g., "这是一个测试")
2. Hover over the word "测试"

**Expected Result:**
- No tooltip should appear
- No errors should be logged in the console

### Test Case 4: Partial Character Data

**Steps:**
1. Create a character with only name and appearance:
   - Name: "李四"
   - Appearance: "清秀俊朗"
   - (Leave other fields empty)

2. Type "李四" in the editor
3. Hover over "李四"

**Expected Result:**
- A tooltip should appear showing only the available fields:
  ```
  李四
  
  外貌: 清秀俊朗
  ```

### Test Case 5: Multiple Characters

**Steps:**
1. Create multiple characters: "张三", "李四", "王五"
2. Type all three names in the editor: "张三和李四去找王五"
3. Hover over each name individually

**Expected Result:**
- Each character name should display its own tooltip with correct information
- Hovering over "张三" shows 张三's info
- Hovering over "李四" shows 李四's info
- Hovering over "王五" shows 王五's info

### Test Case 6: Performance Test

**Steps:**
1. Create 10+ characters
2. Type a paragraph with multiple character names
3. Hover over different character names rapidly

**Expected Result:**
- Tooltips should appear quickly without noticeable lag
- No performance degradation in the editor
- No memory leaks (check browser DevTools)

## Validation Checklist

- [ ] Hover tooltip appears when hovering over character names
- [ ] Tooltip displays all available character fields
- [ ] Tooltip does not appear for non-character words
- [ ] Case-insensitive matching works correctly
- [ ] Partial character data is displayed correctly
- [ ] Multiple characters can be hovered independently
- [ ] No console errors during hover operations
- [ ] Hover provider is properly disposed when editor is closed
- [ ] Performance is acceptable with multiple characters

## Requirements Validation

This implementation satisfies **Requirement 7.5**:
> WHEN 用户在 Editor 中选中人物名称，THE System SHALL 提供快速查看该人物卡片的功能

The hover functionality provides quick access to character information without requiring explicit selection, which is even more convenient than the requirement specifies.

## Known Limitations

1. **Word Boundary Detection**: The hover provider uses Monaco's `getWordAtPosition()` which may not work perfectly for all character name formats (e.g., names with spaces or special characters)
2. **Language Support**: Currently registered only for 'plaintext' language. May need to be extended to other languages if the editor supports multiple file types
3. **Async Loading**: Character data is loaded asynchronously, which may cause a slight delay on first hover

## Future Enhancements

1. Add caching to improve performance for frequently hovered characters
2. Support multi-word character names (e.g., "John Smith")
3. Add visual indicators (e.g., underline) for recognized character names
4. Support clicking on character names to open full character card editor
5. Add keyboard shortcut to trigger hover programmatically
