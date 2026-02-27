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
      <div className="chapter-manager-header" style={{ padding: '12px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#bbb', fontSize: 12, fontWeight: 500 }}>章节管理</span>
          <span style={{ color: '#888', fontSize: 11 }}>
            {chapters.length} 章 · {totalStats.totalWordCount.toLocaleString()} 字
          </span>
        </div>
      </div>

      {/* Chapter list - simplified display */}
      <div className="chapter-list" style={{ padding: '8px 0' }}>
        {chapters.length === 0 ? (
          <div className="chapter-list-empty" style={{ padding: '20px', textAlign: 'center' }}>
            <p style={{ color: '#888', fontSize: 13 }}>暂无章节</p>
          </div>
        ) : (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className="chapter-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid #333',
                cursor: 'pointer',
              }}
              onClick={() => handleChapterClick(chapter)}
            >
              <span style={{ flex: 1, color: '#ddd', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {chapter.title}
              </span>
              <span style={{ color: '#888', fontSize: 12, marginLeft: 12 }}>
                {chapter.wordCount.toLocaleString()} 字
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
