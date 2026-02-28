import React, { useState, useEffect } from 'react';
import { chapterService } from '../services';
import type { Chapter } from '../services';
import './ChapterManager.css';

export interface ChapterManagerProps {
  onChapterClick?: (chapter: Chapter) => void;
  onChapterUpdate?: () => void;
}

/**
 * ChapterManager Component
 * Displays and manages all chapters in the novel
 * Supports drag-and-drop reordering, status updates, and statistics
 */
export const ChapterManager: React.FC<ChapterManagerProps> = ({
  onChapterClick,
}) => {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load chapters on mount
  useEffect(() => {
    loadChapters();
  }, []);

  const loadChapters = async () => {
    try {
      setLoading(true);
      setError(null);
      const chapterList = await chapterService.listChapters();
      setChapters(chapterList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chapters');
    } finally {
      setLoading(false);
    }
  };

  const handleChapterClick = (chapter: Chapter) => {
    if (onChapterClick) {
      onChapterClick(chapter);
    }
  };

  // Calculate total statistics
  const totalStats = React.useMemo(() => {
    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const totalChapters = chapters.length;
    return {
      totalWordCount,
      totalChapters,
    };
  }, [chapters]);

  if (loading) {
    return (
      <div className="chapter-manager">
        <div className="chapter-manager-loading">加载中...</div>
      </div>
    );
  }

  if (error && chapters.length === 0) {
    return (
      <div className="chapter-manager">
        <div className="chapter-manager-error">
          <p>错误: {error}</p>
          <button onClick={loadChapters}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="chapter-manager">
      {/* Error banner for non-fatal errors */}
      {error && chapters.length > 0 && (
        <div className="chapter-manager-error-banner">
          <span>错误: {error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      
      {/* Header - simplified */}
      <div className="chapter-manager-header chapter-manager-header-compact">
        <div className="chapter-manager-header-row">
          <span className="chapter-manager-header-title">章节管理</span>
          <span className="chapter-manager-header-meta">
            {chapters.length} 章 · {totalStats.totalWordCount.toLocaleString()} 字
          </span>
        </div>
      </div>

      {/* Chapter list - simplified display */}
      <div className="chapter-list chapter-list-compact">
        {chapters.length === 0 ? (
          <div className="chapter-list-empty chapter-list-empty-compact">
            <p className="chapter-list-empty-text">暂无章节</p>
          </div>
        ) : (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className="chapter-item chapter-item-compact"
              onClick={() => handleChapterClick(chapter)}
            >
              <span className="chapter-item-title-compact">
                {chapter.title}
              </span>
              <span className="chapter-item-meta-compact">
                {chapter.wordCount.toLocaleString()} 字
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
