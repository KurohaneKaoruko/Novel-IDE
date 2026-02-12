import { invoke } from '@tauri-apps/api/core';
import type { ChangeSet, FileModification } from './ModificationService';
import { diffService } from './DiffService';
import type { SpecKitConfig } from './SpecKitService';

/**
 * Type of AI assistance command
 */
export type AICommandType = 'polish' | 'expand' | 'condense' | 'spec_kit_fix';

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

  async specKitFixText(
    selectedText: string,
    _filePath: string,
    context?: string
  ): Promise<AIAssistanceResponse> {
    const cfg = await this.loadSpecKitConfig();
    const prompt = this.buildSpecKitFixPrompt(selectedText, cfg, context);
    const modifiedText = await this.callAI(prompt);

    return {
      originalText: selectedText,
      modifiedText,
      commandType: 'spec_kit_fix',
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
    fileContent: string,
    selectionStartLine: number,
    _selectionEndLine: number
  ): ChangeSet {
    // Compute diff between original and modified text
    const diffResult = diffService.computeDiff(
      response.originalText,
      response.modifiedText
    );

    // Convert diff to modifications
    const modifications = diffService.diffToModifications(diffResult);

    // Adjust line numbers to match the file position
    const adjustedModifications = modifications.map(mod => ({
      ...mod,
      lineStart: mod.lineStart + selectionStartLine - 1,
      lineEnd: mod.lineEnd + selectionStartLine - 1,
    }));

    // Create file modification
    const fileModification: FileModification = {
      filePath,
      originalContent: fileContent,
      modifications: adjustedModifications,
      status: 'pending',
    };

    // Create change set
    const changeSet: ChangeSet = {
      id: this.generateChangeSetId(),
      timestamp: Date.now(),
      files: [fileModification],
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

  private buildSpecKitFixPrompt(text: string, cfg: SpecKitConfig, context?: string): string {
    const ratios = cfg.ratios;
    const themeKeywords = cfg.theme.keywords.filter(Boolean);

    let prompt = '你是一名严格遵循 Spec-Kit 规范的小说编辑。请在不改变人物关系与事实的前提下，按以下要求重写文本：\n';
    prompt += `- 叙述视角: ${cfg.style.pov}\n`;
    prompt += `- 语调: ${cfg.style.tone}\n`;
    prompt += `- 对白/动作/描写比例目标: ${(ratios.dialogue * 100).toFixed(0)}% / ${(ratios.action * 100).toFixed(0)}% / ${(ratios.description * 100).toFixed(0)}%\n`;
    if (cfg.theme.statement.trim()) prompt += `- 主题: ${cfg.theme.statement.trim()}\n`;
    if (themeKeywords.length > 0) prompt += `- 主题关键词: ${themeKeywords.join('、')}\n`;
    prompt += '- 强化场景的 Goal/Conflict/Stakes/Turn（可隐含表达，但要让读者感受到目标、阻力、代价与转折）。\n';
    prompt += '- 保持语言自然，不要出现“根据要求/比例/关键词”等元话语。\n\n';

    if (context) {
      prompt += `上下文：\n${context}\n\n`;
    }
    prompt += `需要修正的文本：\n${text}\n\n`;
    prompt += '请直接返回修正后的文本，不要添加任何解释或说明。';
    return prompt;
  }

  private async loadSpecKitConfig(): Promise<SpecKitConfig> {
    try {
      const raw = await invoke<string>('read_text', { relativePath: '.novel/.spec-kit/config.json' });
      return JSON.parse(raw) as SpecKitConfig;
    } catch {
      return {
        spec_kit_version: '1.0.0',
        story_type: 'coming_of_age',
        target_words: 100000,
        chapter_count: 30,
        chapter_word_target: 3500,
        style: { pov: 'third_limited', tense: 'past', tone: 'serious' },
        rhythm: { act1_ratio: 0.25, act2_ratio: 0.5, act3_ratio: 0.25, tension_baseline: 20, tension_peak: 95 },
        ratios: { dialogue: 0.35, action: 0.25, description: 0.4 },
        theme: { statement: '', keywords: [] },
      };
    }
  }

  /**
   * Call AI with a prompt and get the response
   * @param prompt - The prompt to send to AI
   * @returns The AI response text
   */
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
