export { DiffService, diffService } from './DiffService';
export type { DiffChange, DiffResult, Modification } from './DiffService';

export { ModificationService, modificationService } from './ModificationService';
export type { FileModification, ChangeSet, ChangeSetStatus } from './ModificationService';

export { AIAssistanceService, aiAssistanceService } from './AIAssistanceService';
export type { AICommandType, AIAssistanceRequest, AIAssistanceResponse } from './AIAssistanceService';

export { ChapterService, chapterService } from './ChapterService';
export type { Chapter, ChapterStatus, ChapterStats } from './ChapterService';

export { CharacterService, characterService } from './CharacterService';
export type { Character, CharacterData } from './CharacterService';

export { PlotLineService, plotLineService } from './PlotLineService';
export type { PlotLine, PlotLineData, PlotLineStatus } from './PlotLineService';

export { WritingGoalService, writingGoalService } from './WritingGoalService';
export type { WritingGoal, DailyStats, WritingHistory } from './WritingGoalService';

export { SensitiveWordService, sensitiveWordService } from './SensitiveWordService';
export type { SensitiveWordMatch } from './SensitiveWordService';

export { SpecKitService, specKitService } from './SpecKitService';
export type {
  StorySpec,
  StorySpecAct,
  StorySpecBeat,
  StorySpecChapter,
  StorySpecCharacter,
  StorySpecScene,
  StorySpecStory,
  SpecKitArcMap,
  SpecKitArcCharacterMap,
  SpecKitConfig,
  SpecKitValidationIssue,
  SpecKitValidationReport,
} from './SpecKitService';

export { editorManager } from './EditorManager';
export type { EditorInstance } from '../types/editor';

export { editorConfigManager } from './EditorConfigManager';
export type { EditorUserConfig } from './EditorConfigManager';
