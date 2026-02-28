import { invoke } from '@tauri-apps/api/core';
import type { ChangeSet } from './ModificationService';
import { diffService } from './DiffService';

/**
 * Type of AI assistance command
 */
export type AICommandType = 'polish' | 'expand' | 'condense';

/**
 * Request for AI assistance
 */
export interface AIAssistanceRequest {
  commandType: AICommandType;
  selectedText: string;
  filePath: string;
  context?: string;
}

/**
 * Response from AI assistance
 */
export interface AIAssistanceResponse {
  originalText: string;
  modifiedText: string;
  commandType: AICommandType;
}

/**
 * Service for AI-assisted text editing
 */
export class AIAssistanceService {
  /**
   * Polish the selected text using AI
   * @param selectedText - The text to polish
   * @param filePath - The file path where the text is located
   * @param context - Optional context around the selected text
   * @returns AI assistance response
   */
  async polishText(
    selectedText: string,
    _filePath: string,
    context?: string
  ): Promise<AIAssistanceResponse> {
    const prompt = this.buildPolishPrompt(selectedText, context);
    const modifiedText = await this.callAI(prompt);

    return {
      originalText: selectedText,
      modifiedText,
      commandType: 'polish',
    };
  }

  /**
   * Expand the selected text using AI
   * @param selectedText - The text to expand
   * @param filePath - The file path where the text is located
   * @param context - Optional context around the selected text
   * @returns AI assistance response
   */
  async expandText(
    selectedText: string,
    _filePath: string,
    context?: string
  ): Promise<AIAssistanceResponse> {
    const prompt = this.buildExpandPrompt(selectedText, context);
    const modifiedText = await this.callAI(prompt);

    return {
      originalText: selectedText,
      modifiedText,
      commandType: 'expand',
    };
  }

  /**
   * Condense the selected text using AI
   * @param selectedText - The text to condense
   * @param filePath - The file path where the text is located
   * @param context - Optional context around the selected text
   * @returns AI assistance response
   */
  async condenseText(
    selectedText: string,
    _filePath: string,
    context?: string
  ): Promise<AIAssistanceResponse> {
    const prompt = this.buildCondensePrompt(selectedText, context);
    const modifiedText = await this.callAI(prompt);

    return {
      originalText: selectedText,
      modifiedText,
      commandType: 'condense',
    };
  }

  /**
   * Convert AI assistance response to a ChangeSet for DiffView
   * @param response - The AI assistance response
   * @param filePath - The file path
   * @param fileContent - The full file content
   * @param selectionStartLine - The starting line of the selection (1-based)
   * @param selectionEndLine - The ending line of the selection (1-based)
   * @returns A ChangeSet for displaying in DiffView
   */
  convertToChangeSet(
    response: AIAssistanceResponse,
    filePath: string,
    _fileContent: string,
    selectionStartLine: number,
    _selectionEndLine: number
  ): ChangeSet {
    const diffResult = diffService.computeDiff(
      response.originalText,
      response.modifiedText
    );

    const modifications = diffService.diffToModifications(diffResult);

    const adjustedModifications = modifications.map(mod => ({
      ...mod,
      lineStart: mod.lineStart + selectionStartLine - 1,
      lineEnd: mod.lineEnd + selectionStartLine - 1,
    }));

    let additions = 0;
    let deletions = 0;
    for (const mod of adjustedModifications) {
      if (mod.type === 'add') additions++;
      else if (mod.type === 'delete') deletions++;
      else if (mod.type === 'modify') { additions++; deletions++; }
    }

    const changeSet: ChangeSet = {
      id: this.generateChangeSetId(),
      timestamp: Date.now(),
      filePath,
      modifications: adjustedModifications,
      stats: { additions, deletions },
      status: 'pending',
    };

    return changeSet;
  }

  /**
   * Build prompt for polishing text
   * @param text - The text to polish
   * @param context - Optional context
   * @returns The prompt string
   */
  private buildPolishPrompt(text: string, context?: string): string {
    let prompt = '请润色以下文本，提升文字质量、流畅度和表达力，但保持原意不变：\n\n';
    
    if (context) {
      prompt += `上下文：\n${context}\n\n`;
    }
    
    prompt += `需要润色的文本：\n${text}\n\n`;
    prompt += '请直接返回润色后的文本，不要添加任何解释或说明。';
    
    return prompt;
  }

  /**
   * Build prompt for expanding text
   * @param text - The text to expand
   * @param context - Optional context
   * @returns The prompt string
   */
  private buildExpandPrompt(text: string, context?: string): string {
    let prompt = '请扩写以下文本，增加更多细节、描写和内容，使其更加丰富生动：\n\n';
    
    if (context) {
      prompt += `上下文：\n${context}\n\n`;
    }
    
    prompt += `需要扩写的文本：\n${text}\n\n`;
    prompt += '请直接返回扩写后的文本，不要添加任何解释或说明。';
    
    return prompt;
  }

  /**
   * Build prompt for condensing text
   * @param text - The text to condense
   * @param context - Optional context
   * @returns The prompt string
   */
  private buildCondensePrompt(text: string, context?: string): string {
    let prompt = '请缩写以下文本，保留核心内容和关键信息，使其更加简洁精炼：\n\n';
    
    if (context) {
      prompt += `上下文：\n${context}\n\n`;
    }
    
    prompt += `需要缩写的文本：\n${text}\n\n`;
    prompt += '请直接返回缩写后的文本，不要添加任何解释或说明。';
    
    return prompt;
  }

  private async callAI(prompt: string): Promise<string> {
    try {
      // Call the Tauri backend to generate AI response
      const response = await invoke<string>('ai_assistance_generate', {
        prompt,
      });
      
      return response.trim();
    } catch (error) {
      throw new Error(
        `AI assistance failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate a unique ID for a change set
   * @returns A unique ID string
   */
  private generateChangeSetId(): string {
    return `ai-assist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// Export a singleton instance
export const aiAssistanceService = new AIAssistanceService();
