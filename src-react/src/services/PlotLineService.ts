import { invoke } from '@tauri-apps/api/core';

/**
 * Plot line status types
 */
export type PlotLineStatus = 'ongoing' | 'completed' | 'paused';

/**
 * Represents a plot line in the novel
 */
export interface PlotLine {
  id: string;
  name: string;
  startChapter: string;
  endChapter?: string;
  status: PlotLineStatus;
  chapters: string[]; // Chapter IDs
  description?: string;
}

/**
 * Data for creating or updating a plot line
 */
export interface PlotLineData {
  name: string;
  startChapter: string;
  endChapter?: string;
  status: PlotLineStatus;
  description?: string;
}

/**
 * Service for managing plot lines
 */
export class PlotLineService {
  private readonly PLOTLINES_FILE = 'outline/plotlines.md';

  /**
   * List all plot lines
   * @returns Array of plot lines
   */
  async listPlotLines(): Promise<PlotLine[]> {
    try {
      const content = await this.loadPlotLinesFile();
      return this.parsePlotLinesFromMarkdown(content);
    } catch (error) {
      // If file doesn't exist, return empty array
      if (error instanceof Error && error.message.includes('not found')) {
        return [];
      }
      throw new Error(`Failed to list plot lines: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new plot line
   * @param data - The plot line data
   * @returns The created plot line
   */
  async createPlotLine(data: PlotLineData): Promise<PlotLine> {
    try {
      const plotLines = await this.listPlotLines();
      
      // Generate unique ID
      const id = this.generatePlotLineId();
      
      // Normalize name by trimming
      const normalizedName = data.name.trim();
      
      // Build chapters array
      const trimmedStart = data.startChapter.trim();
      const trimmedEnd = data.endChapter?.trim();
      const chapters = [trimmedStart];
      if (trimmedEnd && trimmedEnd !== trimmedStart) {
        chapters.push(trimmedEnd);
      }
      
      // Create new plot line
      const plotLine: PlotLine = {
        id,
        name: normalizedName,
        startChapter: trimmedStart,
        endChapter: trimmedEnd,
        status: data.status,
        chapters,
        description: data.description,
      };
      
      // Add to list
      plotLines.push(plotLine);
      
      // Save to file
      await this.savePlotLinesToFile(plotLines);
      
      return plotLine;
    } catch (error) {
      throw new Error(`Failed to create plot line: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update a plot line
   * @param id - The plot line ID
   * @param data - Partial plot line data to update
   * @returns The updated plot line
   */
  async updatePlotLine(id: string, data: Partial<PlotLineData>): Promise<PlotLine> {
    try {
      const plotLines = await this.listPlotLines();
      const plotLine = plotLines.find(p => p.id === id);
      
      if (!plotLine) {
        throw new Error(`Plot line with id ${id} not found`);
      }
      
      // Update plot line data
      if (data.name !== undefined) {
        plotLine.name = data.name.trim();
      }
      if (data.startChapter !== undefined) {
        plotLine.startChapter = data.startChapter.trim();
      }
      if (data.endChapter !== undefined) {
        plotLine.endChapter = data.endChapter.trim();
      }
      if (data.status !== undefined) {
        plotLine.status = data.status;
      }
      if (data.description !== undefined) {
        plotLine.description = data.description;
      }
      
      // Rebuild chapters array
      const chapters = [plotLine.startChapter];
      if (plotLine.endChapter && plotLine.endChapter !== plotLine.startChapter) {
        chapters.push(plotLine.endChapter);
      }
      plotLine.chapters = chapters;
      
      // Save to file
      await this.savePlotLinesToFile(plotLines);
      
      return plotLine;
    } catch (error) {
      throw new Error(`Failed to update plot line: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a plot line
   * @param id - The plot line ID
   */
  async deletePlotLine(id: string): Promise<void> {
    try {
      const plotLines = await this.listPlotLines();
      const filteredPlotLines = plotLines.filter(p => p.id !== id);
      
      if (filteredPlotLines.length === plotLines.length) {
        throw new Error(`Plot line with id ${id} not found`);
      }
      
      await this.savePlotLinesToFile(filteredPlotLines);
    } catch (error) {
      throw new Error(`Failed to delete plot line: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load plot lines file content
   * @returns File content
   */
  private async loadPlotLinesFile(): Promise<string> {
    try {
      return await invoke<string>('read_text', { relativePath: this.PLOTLINES_FILE });
    } catch (error) {
      // Return empty content if file doesn't exist
      return '';
    }
  }

  /**
   * Parse plot lines from markdown content
   * @param content - Markdown content
   * @returns Array of plot lines
   */
  private parsePlotLinesFromMarkdown(content: string): PlotLine[] {
    if (!content.trim()) {
      return [];
    }

    const plotLines: PlotLine[] = [];
    
    // Split by ## headers (each plot line is a section)
    const sections = content.split(/^## /m).filter(s => s.trim());
    
    // Filter out document title if present
    const plotLineSections = sections.filter((section, index) => {
      if (index === 0 && section.trim().startsWith('# ')) {
        return false;
      }
      return section.trim().length > 0;
    });
    
    for (const section of plotLineSections) {
      const lines = section.split('\n');
      const firstLine = lines[0].trim();
      
      if (!firstLine) continue;
      
      // Extract ID and name from first line
      // Format: "Name <!-- id: plotline-xxx -->"
      const idMatch = firstLine.match(/<!--\s*id:\s*([^\s]+)\s*-->/);
      const name = firstLine.replace(/<!--.*?-->/, '').trim();
      
      if (!name) continue;
      
      const id = idMatch ? idMatch[1] : this.generatePlotLineId();
      
      // Parse plot line data fields
      let status: PlotLineStatus = 'ongoing';
      let startChapter = '';
      let endChapter: string | undefined;
      let description: string | undefined;
      const chapters: string[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('- **状态**:') || line.startsWith('- **Status**:')) {
          const statusValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          if (statusValue === '进行中' || statusValue === 'ongoing') {
            status = 'ongoing';
          } else if (statusValue === '已完结' || statusValue === 'completed') {
            status = 'completed';
          } else if (statusValue === '暂停' || statusValue === 'paused') {
            status = 'paused';
          }
        } else if (line.startsWith('- **起始章节**:') || line.startsWith('- **Start Chapter**:')) {
          startChapter = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
        } else if (line.startsWith('- **结束章节**:') || line.startsWith('- **End Chapter**:')) {
          const endValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          if (endValue && endValue !== '未定' && endValue !== 'TBD') {
            endChapter = endValue;
          }
        } else if (line.startsWith('- **涉及章节**:') || line.startsWith('- **Chapters**:')) {
          const chaptersValue = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
          const chapterIds = chaptersValue.split(/[;,]/).map(c => c.trim()).filter(c => c.length > 0);
          chapters.push(...chapterIds);
        } else if (line.startsWith('- **描述**:') || line.startsWith('- **Description**:')) {
          description = line.replace(/^- \*\*.*?\*\*:\s*/, '').trim();
        }
      }
      
      // If chapters array is empty, build from start/end
      if (chapters.length === 0 && startChapter) {
        chapters.push(startChapter);
        if (endChapter && endChapter !== startChapter) {
          chapters.push(endChapter);
        }
      }
      
      plotLines.push({
        id,
        name,
        startChapter,
        endChapter,
        status,
        chapters,
        description,
      });
    }
    
    return plotLines;
  }

  /**
   * Save plot lines to markdown file
   * @param plotLines - Array of plot lines
   */
  private async savePlotLinesToFile(plotLines: PlotLine[]): Promise<void> {
    try {
      let content = '# 情节线\n\n';
      
      for (const plotLine of plotLines) {
        content += `## ${plotLine.name} <!-- id: ${plotLine.id} -->\n\n`;
        
        // Status
        let statusText = '进行中';
        if (plotLine.status === 'completed') {
          statusText = '已完结';
        } else if (plotLine.status === 'paused') {
          statusText = '暂停';
        }
        content += `- **状态**: ${statusText}\n`;
        
        // Start chapter
        content += `- **起始章节**: ${plotLine.startChapter}\n`;
        
        // End chapter
        const endChapterText = plotLine.endChapter || '未定';
        content += `- **结束章节**: ${endChapterText}\n`;
        
        // Chapters
        const chaptersText = plotLine.chapters.join('; ');
        content += `- **涉及章节**: ${chaptersText}\n`;
        
        // Description
        if (plotLine.description) {
          content += `- **描述**: ${plotLine.description}\n`;
        }
        
        content += '\n';
      }
      
      await invoke('write_text', { relativePath: this.PLOTLINES_FILE, content });
    } catch (error) {
      throw new Error(`Failed to save plot lines: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a unique plot line ID
   * @returns A unique ID string
   */
  private generatePlotLineId(): string {
    return `plotline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Export a singleton instance
export const plotLineService = new PlotLineService();
