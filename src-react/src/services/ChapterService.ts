import { invoke } from '@tauri-apps/api/core';

/**
 * Chapter status types
 */
export type ChapterStatus = 'draft' | 'revising' | 'completed';

/**
 * Represents a chapter in the novel
 */
export interface Chapter {
  id: string;
  filePath: string;
  title: string;
  wordCount: number;
  status: ChapterStatus;
  lastModified: number;
  order: number;
}

/**
 * Statistics for a chapter
 */
export interface ChapterStats {
  wordCount: number;
  characterCount: number;
  paragraphCount: number;
  lastModified: number;
}

/**
 * Chapter metadata stored in .novel/.settings/chapters.json
 */
interface ChapterMetadata {
  chapters: Array<{
    id: string;
    filePath: string;
    title: string;
    status: ChapterStatus;
    order: number;
    wordCount: number;
    lastModified: number;
  }>;
}

/**
 * Service for managing chapters
 */
export class ChapterService {
  private readonly METADATA_PATH = '.novel/.settings/chapters.json';
  private readonly STORIES_DIR = 'stories';

  /**
   * List all chapters in the workspace
   * @returns Array of chapters sorted by order
   */
  async listChapters(): Promise<Chapter[]> {
    try {
      // Read metadata file
      const metadata = await this.loadMetadata();
      
      // Get all files in stories directory
      const storyFiles = await this.getStoryFiles();
      
      // Merge metadata with actual files
      const chapters: Chapter[] = [];
      
      for (const filePath of storyFiles) {
        const existingMeta = metadata.chapters.find(c => c.filePath === filePath);
        
        if (existingMeta) {
          // Use existing metadata
          chapters.push({
            id: existingMeta.id,
            filePath: existingMeta.filePath,
            title: existingMeta.title,
            wordCount: existingMeta.wordCount,
            status: existingMeta.status,
            lastModified: existingMeta.lastModified,
            order: existingMeta.order,
          });
        } else {
          // Create new metadata for file
          const stats = await this.getChapterStats(filePath);
          const newChapter: Chapter = {
            id: this.generateChapterId(),
            filePath,
            title: this.extractTitleFromPath(filePath),
            wordCount: stats.wordCount,
            status: 'draft',
            lastModified: stats.lastModified,
            order: chapters.length,
          };
          chapters.push(newChapter);
        }
      }
      
      // Sort by order
      chapters.sort((a, b) => a.order - b.order);
      
      // Save updated metadata
      await this.saveMetadata({ chapters });
      
      return chapters;
    } catch (error) {
      throw new Error(`Failed to list chapters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new chapter
   * @param title - The title of the chapter
   * @returns The created chapter
   */
  async createChapter(title: string): Promise<Chapter> {
    try {
      // Generate file name from title
      const fileName = this.sanitizeFileName(title);
      const filePath = `${this.STORIES_DIR}/${fileName}.txt`;
      
      // Create the file
      await invoke('create_file', { relativePath: filePath });
      
      // Write initial content
      await invoke('write_text', { 
        relativePath: filePath, 
        content: `# ${title}\n\n` 
      });
      
      // Get current chapters to determine order
      const existingChapters = await this.listChapters();
      const maxOrder = existingChapters.length > 0 
        ? Math.max(...existingChapters.map(c => c.order)) 
        : -1;
      
      // Create chapter object
      const chapter: Chapter = {
        id: this.generateChapterId(),
        filePath,
        title,
        wordCount: 0,
        status: 'draft',
        lastModified: Date.now(),
        order: maxOrder + 1,
      };
      
      // Load metadata and add new chapter
      const metadata = await this.loadMetadata();
      metadata.chapters.push({
        id: chapter.id,
        filePath: chapter.filePath,
        title: chapter.title,
        status: chapter.status,
        order: chapter.order,
        wordCount: chapter.wordCount,
        lastModified: chapter.lastModified,
      });
      
      // Save metadata
      await this.saveMetadata(metadata);
      
      return chapter;
    } catch (error) {
      throw new Error(`Failed to create chapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update chapter status
   * @param chapterId - The ID of the chapter
   * @param status - The new status
   */
  async updateChapterStatus(chapterId: string, status: ChapterStatus): Promise<void> {
    try {
      const metadata = await this.loadMetadata();
      const chapter = metadata.chapters.find(c => c.id === chapterId);
      
      if (!chapter) {
        throw new Error(`Chapter with id ${chapterId} not found`);
      }
      
      chapter.status = status;
      await this.saveMetadata(metadata);
    } catch (error) {
      throw new Error(`Failed to update chapter status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reorder chapters
   * @param chapterIds - Array of chapter IDs in the new order
   */
  async reorderChapters(chapterIds: string[]): Promise<void> {
    try {
      const metadata = await this.loadMetadata();
      
      // Update order for each chapter
      chapterIds.forEach((id, index) => {
        const chapter = metadata.chapters.find(c => c.id === id);
        if (chapter) {
          chapter.order = index;
        }
      });
      
      await this.saveMetadata(metadata);
    } catch (error) {
      throw new Error(`Failed to reorder chapters: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get statistics for a chapter
   * @param filePath - The relative path to the chapter file
   * @returns Chapter statistics
   */
  async getChapterStats(filePath: string): Promise<ChapterStats> {
    try {
      const content = await invoke<string>('read_text', { relativePath: filePath });
      
      // Calculate word count (split by whitespace)
      const words = content.trim().split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;
      
      // Calculate character count (excluding whitespace)
      const characterCount = content.replace(/\s/g, '').length;
      
      // Calculate paragraph count (split by double newlines)
      const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
      const paragraphCount = paragraphs.length;
      
      // Get last modified time (use current time as fallback)
      const lastModified = Date.now();
      
      return {
        wordCount,
        characterCount,
        paragraphCount,
        lastModified,
      };
    } catch (error) {
      throw new Error(`Failed to get chapter stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load chapter metadata from file
   * @returns Chapter metadata
   */
  private async loadMetadata(): Promise<ChapterMetadata> {
    try {
      const content = await invoke<string>('read_text', { relativePath: this.METADATA_PATH });
      return JSON.parse(content) as ChapterMetadata;
    } catch (error) {
      // If file doesn't exist, return empty metadata
      return { chapters: [] };
    }
  }

  /**
   * Save chapter metadata to file
   * @param metadata - The metadata to save
   */
  private async saveMetadata(metadata: ChapterMetadata): Promise<void> {
    try {
      const content = JSON.stringify(metadata, null, 2);
      await invoke('write_text', { relativePath: this.METADATA_PATH, content });
    } catch (error) {
      throw new Error(`Failed to save metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all story files from the stories directory
   * @returns Array of file paths
   */
  private async getStoryFiles(): Promise<string[]> {
    try {
      // List workspace tree with max depth to get stories directory
      const tree = await invoke<any>('list_workspace_tree', { maxDepth: 2 });
      
      // Find stories directory
      const storiesDir = tree.children?.find((child: any) => 
        child.name === 'stories' && child.kind === 'dir'
      );
      
      if (!storiesDir || !storiesDir.children) {
        return [];
      }
      
      // Get all files in stories directory
      const files = storiesDir.children
        .filter((child: any) => child.kind === 'file')
        .map((child: any) => child.path);
      
      return files;
    } catch (error) {
      throw new Error(`Failed to get story files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract title from file path
   * @param filePath - The file path
   * @returns The extracted title
   */
  private extractTitleFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() || filePath;
    const nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
    
    // Convert kebab-case or snake_case to Title Case
    return nameWithoutExt
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Sanitize file name
   * @param title - The title to sanitize
   * @returns Sanitized file name
   */
  private sanitizeFileName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Generate a unique chapter ID
   * @returns A unique ID string
   */
  private generateChapterId(): string {
    return `chapter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Export a singleton instance
export const chapterService = new ChapterService();
