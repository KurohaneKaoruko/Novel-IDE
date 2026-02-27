import { invoke } from '@tauri-apps/api/core';

/**
 * Writing goal configuration
 */
export interface WritingGoal {
  dailyWordCount: number;
  currentStreak: number;
  longestStreak: number;
}

/**
 * Daily writing statistics
 */
export interface DailyStats {
  date: string;
  wordCount: number;
  goal: number;
  progress: number; // 0-1
  timeSpent: number; // seconds
}

/**
 * Writing history entry
 */
export interface WritingHistory {
  date: string;
  wordCount: number;
  goal: number;
  achieved: boolean;
}

/**
 * Writing goal metadata stored in .novel/.settings/writing-goals.json
 */
interface WritingGoalMetadata {
  dailyWordCount: number;
  currentStreak: number;
  longestStreak: number;
}

/**
 * Writing history metadata stored in .novel/.history/writing-history.json
 */
interface WritingHistoryMetadata {
  history: Array<{
    date: string;
    wordCount: number;
    goal: number;
    achieved: boolean;
    timeSpent: number;
  }>;
}

/**
 * Service for managing writing goals and tracking progress
 */
export class WritingGoalService {
  private readonly GOAL_PATH = '.novel/.settings/writing-goals.json';
  private readonly HISTORY_PATH = '.novel/.history/writing-history.json';
  
  private todayStartTime: number = Date.now();
  private todayInitialWordCount: number = 0;

  /**
   * Get the current writing goal
   * @returns The current writing goal
   */
  async getCurrentGoal(): Promise<WritingGoal> {
    try {
      const metadata = await this.loadGoalMetadata();
      return {
        dailyWordCount: metadata.dailyWordCount,
        currentStreak: metadata.currentStreak,
        longestStreak: metadata.longestStreak,
      };
    } catch (error) {
      throw new Error(`Failed to get current goal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Set the daily word count goal
   * @param wordCount - The target word count per day
   */
  async setDailyGoal(wordCount: number): Promise<void> {
    try {
      if (wordCount < 0) {
        throw new Error('Word count must be non-negative');
      }

      const metadata = await this.loadGoalMetadata();
      metadata.dailyWordCount = wordCount;
      await this.saveGoalMetadata(metadata);
    } catch (error) {
      throw new Error(`Failed to set daily goal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Record writing progress
   * @param wordCount - The current total word count
   */
  async recordProgress(wordCount: number): Promise<void> {
    try {
      const today = this.getTodayDateString();
      const historyMetadata = await this.loadHistoryMetadata();
      const goalMetadata = await this.loadGoalMetadata();

      // Find or create today's entry
      let todayEntry = historyMetadata.history.find(h => h.date === today);
      
      if (!todayEntry) {
        // Create new entry for today
        todayEntry = {
          date: today,
          wordCount: 0,
          goal: goalMetadata.dailyWordCount,
          achieved: false,
          timeSpent: 0,
        };
        historyMetadata.history.push(todayEntry);
        this.todayStartTime = Date.now();
        this.todayInitialWordCount = wordCount;
      }

      // Update word count (calculate delta from initial)
      const newWords = Math.max(0, wordCount - this.todayInitialWordCount);
      todayEntry.wordCount = newWords;
      
      // Update time spent
      const timeElapsed = Math.floor((Date.now() - this.todayStartTime) / 1000);
      todayEntry.timeSpent = timeElapsed;

      // Check if goal achieved
      const wasAchieved = todayEntry.achieved;
      todayEntry.achieved = todayEntry.wordCount >= todayEntry.goal;

      // Update streak if goal just achieved
      if (todayEntry.achieved && !wasAchieved) {
        await this.updateStreak(historyMetadata);
      }

      // Save history
      await this.saveHistoryMetadata(historyMetadata);
    } catch (error) {
      throw new Error(`Failed to record progress: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get writing history for the last N days
   * @param days - Number of days to retrieve
   * @returns Array of writing history entries
   */
  async getHistory(days: number): Promise<WritingHistory[]> {
    try {
      const historyMetadata = await this.loadHistoryMetadata();
      
      // Sort by date descending and take last N days
      const sortedHistory = historyMetadata.history
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, days);

      return sortedHistory.map(entry => ({
        date: entry.date,
        wordCount: entry.wordCount,
        goal: entry.goal,
        achieved: entry.achieved,
      }));
    } catch (error) {
      throw new Error(`Failed to get history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get today's writing statistics
   * @returns Today's statistics
   */
  async getTodayStats(): Promise<DailyStats> {
    try {
      const today = this.getTodayDateString();
      const historyMetadata = await this.loadHistoryMetadata();
      const goalMetadata = await this.loadGoalMetadata();

      // Find today's entry
      const todayEntry = historyMetadata.history.find(h => h.date === today);

      if (!todayEntry) {
        // No entry for today yet
        return {
          date: today,
          wordCount: 0,
          goal: goalMetadata.dailyWordCount,
          progress: 0,
          timeSpent: 0,
        };
      }

      // Calculate progress (0-1)
      const progress = todayEntry.goal > 0 
        ? Math.min(1, todayEntry.wordCount / todayEntry.goal)
        : 0;

      return {
        date: todayEntry.date,
        wordCount: todayEntry.wordCount,
        goal: todayEntry.goal,
        progress,
        timeSpent: todayEntry.timeSpent,
      };
    } catch (error) {
      throw new Error(`Failed to get today stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update the current streak based on history
   * @param historyMetadata - The history metadata
   */
  private async updateStreak(historyMetadata: WritingHistoryMetadata): Promise<void> {
    try {
      const goalMetadata = await this.loadGoalMetadata();
      
      // Sort history by date descending
      const sortedHistory = historyMetadata.history
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Calculate current streak
      let currentStreak = 0;
      for (const entry of sortedHistory) {
        if (entry.achieved) {
          currentStreak++;
        } else {
          break;
        }
      }

      // Update longest streak if necessary
      if (currentStreak > goalMetadata.longestStreak) {
        goalMetadata.longestStreak = currentStreak;
      }

      goalMetadata.currentStreak = currentStreak;
      await this.saveGoalMetadata(goalMetadata);
    } catch (error) {
      throw new Error(`Failed to update streak: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get today's date as a string (YYYY-MM-DD)
   * @returns Date string
   */
  private getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Load writing goal metadata from file
   * @returns Writing goal metadata
   */
  private async loadGoalMetadata(): Promise<WritingGoalMetadata> {
    try {
      const content = await invoke<string>('read_text', { relativePath: this.GOAL_PATH });
      return JSON.parse(content) as WritingGoalMetadata;
    } catch (error) {
      // If file doesn't exist, return default metadata
      return {
        dailyWordCount: 2000,
        currentStreak: 0,
        longestStreak: 0,
      };
    }
  }

  /**
   * Save writing goal metadata to file
   * @param metadata - The metadata to save
   */
  private async saveGoalMetadata(metadata: WritingGoalMetadata): Promise<void> {
    try {
      const content = JSON.stringify(metadata, null, 2);
      await invoke('write_text', { relativePath: this.GOAL_PATH, content });
    } catch (error) {
      throw new Error(`Failed to save goal metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load writing history metadata from file
   * @returns Writing history metadata
   */
  private async loadHistoryMetadata(): Promise<WritingHistoryMetadata> {
    try {
      const content = await invoke<string>('read_text', { relativePath: this.HISTORY_PATH });
      return JSON.parse(content) as WritingHistoryMetadata;
    } catch (error) {
      // If file doesn't exist, return empty history
      return { history: [] };
    }
  }

  /**
   * Save writing history metadata to file
   * @param metadata - The metadata to save
   */
  private async saveHistoryMetadata(metadata: WritingHistoryMetadata): Promise<void> {
    try {
      const content = JSON.stringify(metadata, null, 2);
      await invoke('write_text', { relativePath: this.HISTORY_PATH, content });
    } catch (error) {
      throw new Error(`Failed to save history metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Export a singleton instance
export const writingGoalService = new WritingGoalService();
