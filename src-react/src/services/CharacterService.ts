import { invoke } from '@tauri-apps/api/core';

/**
 * Character data fields
 */
export interface CharacterData {
  name: string;
  appearance?: string;
  personality?: string;
  background?: string;
  relationships?: string;
  notes?: string;
}

/**
 * Represents a character in the novel
 */
export interface Character {
  id: string;
  name: string;
  data: CharacterData;
}

/**
 * Service for managing character cards
 */
export class CharacterService {
  private readonly CHARACTERS_FILE = 'concept/characters.md';

  /**
   * List all characters
   * @returns Array of characters
   */
  async listCharacters(): Promise<Character[]> {
    try {
      const content = await this.loadCharactersFile();
      return this.parseCharactersFromMarkdown(content);
    } catch (error) {
      // If file doesn't exist, return empty array
      if (error instanceof Error && error.message.includes('not found')) {
        return [];
      }
      throw new Error(`Failed to list characters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new character
   * @param data - The character data
   * @returns The created character
   */
  async createCharacter(data: CharacterData): Promise<Character> {
    try {
      const characters = await this.listCharacters();
      
      // Generate unique ID
      const id = this.generateCharacterId();
      
      // Normalize name by trimming
      const normalizedName = data.name.trim();
      
      // Create new character
      const character: Character = {
        id,
        name: normalizedName,
        data: {
          ...data,
          name: normalizedName,
        },
      };
      
      // Add to list
      characters.push(character);
      
      // Save to file
      await this.saveCharactersToFile(characters);
      
      return character;
    } catch (error) {
      throw new Error(`Failed to create character: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update a character
   * @param id - The character ID
   * @param data - Partial character data to update
   * @returns The updated character
   */
  async updateCharacter(id: string, data: Partial<CharacterData>): Promise<Character> {
    try {
      const characters = await this.listCharacters();
      const character = characters.find(c => c.id === id);
      
      if (!character) {
        throw new Error(`Character with id ${id} not found`);
      }
      
      // Update character data
      character.data = {
        ...character.data,
        ...data,
      };
      
      // Update and normalize name if provided
      if (data.name) {
        const normalizedName = data.name.trim();
        character.name = normalizedName;
        character.data.name = normalizedName;
      }
      
      // Save to file
      await this.saveCharactersToFile(characters);
      
      return character;
    } catch (error) {
      throw new Error(`Failed to update character: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a character
   * @param id - The character ID
   */
  async deleteCharacter(id: string): Promise<void> {
    try {
      const characters = await this.listCharacters();
      const filteredCharacters = characters.filter(c => c.id !== id);
      
      if (filteredCharacters.length === characters.length) {
        throw new Error(`Character with id ${id} not found`);
      }
      
      await this.saveCharactersToFile(filteredCharacters);
    } catch (error) {
      throw new Error(`Failed to delete character: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search characters by query
   * @param query - The search query
   * @returns Array of matching characters
   */
  async searchCharacters(query: string): Promise<Character[]> {
    try {
      const characters = await this.listCharacters();
      const lowerQuery = query.toLowerCase();
      
      return characters.filter(character => {
        // Search in name
        if (character.name.toLowerCase().includes(lowerQuery)) {
          return true;
        }
        
        // Search in all data fields
        const data = character.data;
        return (
          (data.appearance?.toLowerCase().includes(lowerQuery)) ||
          (data.personality?.toLowerCase().includes(lowerQuery)) ||
          (data.background?.toLowerCase().includes(lowerQuery)) ||
          (data.relationships?.toLowerCase().includes(lowerQuery)) ||
          (data.notes?.toLowerCase().includes(lowerQuery))
        );
      });
    } catch (error) {
      throw new Error(`Failed to search characters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load characters file content
   * @returns File content
   */
  private async loadCharactersFile(): Promise<string> {
    try {
      return await invoke<string>('read_text', { relativePath: this.CHARACTERS_FILE });
    } catch (error) {
      // Return empty content if file doesn't exist
      return '';
    }
  }

  /**
   * Parse characters from markdown content
   * @param content - Markdown content
   * @returns Array of characters
   */
  private parseCharactersFromMarkdown(content: string): Character[] {
    if (!content.trim()) {
      return [];
    }

    const characters: Character[] = [];
    
    // Split by ## headers (each character is a section)
    const sections = content.split(/^## /m).filter(s => s.trim());
    
    // The first section might be the document title if it starts with "# " (single hash)
    // We want to skip that but keep character names that contain "#"
    const characterSections = sections.filter((section, index) => {
      // If it's the first section and starts with exactly "# " (document title), skip it
      if (index === 0 && section.trim().startsWith('# ')) {
        return false;
      }
      return section.trim().length > 0;
    });
    
    for (const section of characterSections) {
      const lines = section.split('\n');
      const firstLine = lines[0].trim();
      
      if (!firstLine) continue;
      
      // Extract ID and name from first line
      // Format: "Name <!-- id: character-xxx -->"
      const idMatch = firstLine.match(/<!--\s*id:\s*([^\s]+)\s*-->/);
      const name = firstLine.replace(/<!--.*?-->/, '').trim();
      
      if (!name) continue;
      
      const id = idMatch ? idMatch[1] : this.generateCharacterId();
      
      // Parse character data fields
      const data: CharacterData = { name };
      let currentField: keyof CharacterData | null = null;
      let currentContent: string[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for field headers
        if (line.startsWith('- **外貌**:') || line.startsWith('- **Appearance**:')) {
          if (currentField && currentContent.length > 0) {
            const trimmedContent = currentContent.join('\n').trim();
            if (trimmedContent) data[currentField] = trimmedContent;
          }
          currentField = 'appearance';
          const fieldValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          currentContent = fieldValue ? [fieldValue] : [];
        } else if (line.startsWith('- **性格**:') || line.startsWith('- **Personality**:')) {
          if (currentField && currentContent.length > 0) {
            const trimmedContent = currentContent.join('\n').trim();
            if (trimmedContent) data[currentField] = trimmedContent;
          }
          currentField = 'personality';
          const fieldValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          currentContent = fieldValue ? [fieldValue] : [];
        } else if (line.startsWith('- **背景**:') || line.startsWith('- **Background**:')) {
          if (currentField && currentContent.length > 0) {
            const trimmedContent = currentContent.join('\n').trim();
            if (trimmedContent) data[currentField] = trimmedContent;
          }
          currentField = 'background';
          const fieldValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          currentContent = fieldValue ? [fieldValue] : [];
        } else if (line.startsWith('- **关系**:') || line.startsWith('- **Relationships**:')) {
          if (currentField && currentContent.length > 0) {
            const trimmedContent = currentContent.join('\n').trim();
            if (trimmedContent) data[currentField] = trimmedContent;
          }
          currentField = 'relationships';
          const fieldValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          currentContent = fieldValue ? [fieldValue] : [];
        } else if (line.startsWith('- **备注**:') || line.startsWith('- **Notes**:')) {
          if (currentField && currentContent.length > 0) {
            const trimmedContent = currentContent.join('\n').trim();
            if (trimmedContent) data[currentField] = trimmedContent;
          }
          currentField = 'notes';
          const fieldValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          currentContent = fieldValue ? [fieldValue] : [];
        } else if (line.trim() && currentField) {
          // Continue current field content
          currentContent.push(line);
        }
      }
      
      // Save last field
      if (currentField && currentContent.length > 0) {
        const trimmedContent = currentContent.join('\n').trim();
        if (trimmedContent) data[currentField] = trimmedContent;
      }
      
      characters.push({ id, name, data });
    }
    
    return characters;
  }

  /**
   * Save characters to markdown file
   * @param characters - Array of characters
   */
  private async saveCharactersToFile(characters: Character[]): Promise<void> {
    try {
      let content = '# 人物卡片\n\n';
      
      for (const character of characters) {
        content += `## ${character.name} <!-- id: ${character.id} -->\n\n`;
        
        if (character.data.appearance) {
          content += `- **外貌**: ${character.data.appearance}\n`;
        }
        if (character.data.personality) {
          content += `- **性格**: ${character.data.personality}\n`;
        }
        if (character.data.background) {
          content += `- **背景**: ${character.data.background}\n`;
        }
        if (character.data.relationships) {
          content += `- **关系**: ${character.data.relationships}\n`;
        }
        if (character.data.notes) {
          content += `- **备注**: ${character.data.notes}\n`;
        }
        
        content += '\n';
      }
      
      await invoke('write_text', { relativePath: this.CHARACTERS_FILE, content });
    } catch (error) {
      throw new Error(`Failed to save characters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a unique character ID
   * @returns A unique ID string
   */
  private generateCharacterId(): string {
    return `character-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Export a singleton instance
export const characterService = new CharacterService();
