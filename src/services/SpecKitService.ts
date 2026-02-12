import { invoke } from '@tauri-apps/api/core';

export type SpecKitIssueSeverity = 'error' | 'warning';

export interface SpecKitValidationIssue {
  severity: SpecKitIssueSeverity;
  code: string;
  message: string;
  path: string;
}

export interface SpecKitValidationReport {
  issues: SpecKitValidationIssue[];
}

export interface SpecKitConfig {
  spec_kit_version: string;
  story_type: string;
  target_words: number;
  chapter_count: number;
  chapter_word_target: number;
  style: StorySpecStyleConfig;
  rhythm: {
    act1_ratio: number;
    act2_ratio: number;
    act3_ratio: number;
    tension_baseline: number;
    tension_peak: number;
  };
  ratios: {
    dialogue: number;
    action: number;
    description: number;
  };
  theme: {
    statement: string;
    keywords: string[];
  };
}

export interface StorySpecStyleConfig {
  pov: string;
  tense: string;
  tone: string;
}

export interface StorySpecStory {
  title: string;
  logline: string;
  story_type: string;
  target_words: number;
  theme_statement: string;
  theme_keywords: string[];
  style: StorySpecStyleConfig;
}

export interface StorySpecBeat {
  id: string;
  name: string;
  target_chapter_range: [number, number];
  purpose: string;
}

export interface StorySpecAct {
  id: string;
  name: string;
  beats: StorySpecBeat[];
}

export interface StorySpecStructure {
  acts: StorySpecAct[];
}

export interface StorySpecScene {
  id: string;
  goal: string;
  conflict: string;
  stakes: string;
  turn: string;
  pov: string;
  location: string;
  characters: string[];
}

export interface StorySpecChapter {
  id: string;
  title: string;
  act: string;
  target_words: number;
  beat_id: string;
  scenes: StorySpecScene[];
}

export interface StorySpecCharacter {
  id: string;
  name: string;
  archetype_id: string;
  want: string;
  need: string;
  lie: string;
  arc_steps: string[];
}

export interface StorySpec {
  spec_kit_version: string;
  story: StorySpecStory;
  structure: StorySpecStructure;
  characters: StorySpecCharacter[];
  chapters: StorySpecChapter[];
}

export interface SpecKitArcCharacterMap {
  character_id: string;
  character_name: string;
  archetype_id: string;
  beat_to_arc_step_index: Record<string, number>;
}

export interface SpecKitArcMap {
  spec_kit_version: string;
  character_maps: SpecKitArcCharacterMap[];
}

export class SpecKitService {
  async loadConfig(): Promise<SpecKitConfig> {
    const raw = await invoke<string>('read_text', { relativePath: '.novel/.spec-kit/config.json' });
    return JSON.parse(raw) as SpecKitConfig;
  }

  async generateOutline(): Promise<StorySpec> {
    return invoke<StorySpec>('spec_kit_generate_outline');
  }

  async validateStorySpec(): Promise<SpecKitValidationReport> {
    return invoke<SpecKitValidationReport>('spec_kit_validate_story_spec');
  }

  async matchCharacterArcs(): Promise<SpecKitArcMap> {
    return invoke<SpecKitArcMap>('spec_kit_match_character_arcs');
  }

  async exportMarkdown(): Promise<string> {
    return invoke<string>('spec_kit_export_markdown');
  }

  async exportEpub(): Promise<string> {
    return invoke<string>('spec_kit_export_epub');
  }

  async exportPdf(): Promise<string> {
    return invoke<string>('spec_kit_export_pdf');
  }
}

export const specKitService = new SpecKitService();
