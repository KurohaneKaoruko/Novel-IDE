import React, { useState, useEffect } from 'react';
import { chapterService } from '../services';
import type { Chapter, ChapterStatus } from '../services';
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
  onChapterUpdate,
}) => {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);
  const [dragOverChapterId, setDragOverChapterId] = useState<string | null>(null);

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

  const handleStatusChange = async (chapterId: string, newStatus: ChapterStatus) => {
    try {
      await chapterService.updateChapterStatus(chapterId, newStatus);
      
      // Update local state
      setChapters(prev => prev.map(c => 
        c.id === chapterId ? { ...c, status: newStatus } : c
      ));
      
      if (onChapterUpdate) {
        onChapterUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update chapter status');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, chapterId: string) => {
    setDraggedChapterId(chapterId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chapterId);
  };

  const handleDragOver = (e: React.DragEvent, chapterId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverChapterId(chapterId);
  };

  const handleDragLeave = () => {
    setDragOverChapterId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetChapterId: string) => {
    e.preventDefault();
    setDragOverChapterId(null);

    if (!draggedChapterId || draggedChapterId === targetChapterId) {
      setDraggedChapterId(null);
      return;
    }

    try {
      // Find indices
      const draggedIndex = chapters.findIndex(c => c.id === draggedChapterId);
      const targetIndex = chapters.findIndex(c => c.id === targetChapterId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      // Reorder chapters array
      const newChapters = [...chapters];
      const [draggedChapter] = newChapters.splice(draggedIndex, 1);
      newChapters.splice(targetIndex, 0, draggedChapter);

      // Update local state immediately for smooth UX
      setChapters(newChapters);

      // Save new order to backend
      const chapterIds = newChapters.map(c => c.id);
      await chapterService.reorderChapters(chapterIds);

      if (onChapterUpdate) {
        onChapterUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder chapters');
      // Reload chapters to restore correct order
      loadChapters();
    } finally {
      setDraggedChapterId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedChapterId(null);
    setDragOverChapterId(null);
  };

  // Calculate total statistics
  const totalStats = React.useMemo(() => {
    const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
    const totalChapters = chapters.length;
    const draftCount = chapters.filter(c => c.status === 'draft').length;
    const revisingCount = chapters.filter(c => c.status === 'revising').length;
    const completedCount = chapters.filter(c => c.status === 'completed').length;

    return {
      totalWordCount,
      totalChapters,
      draftCount,
      revisingCount,
      completedCount,
    };
  }, [chapters]);

  // Format date
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // Get status badge class
  const getStatusClass = (status: ChapterStatus) => {
    switch (status) {
      case 'draft':
        return 'chapter-status-draft';
      case 'revising':
        return 'chapter-status-revising';
      case 'completed':
        return 'chapter-status-completed';
      default:
        return '';
    }
  };

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
      
      {/* Header with statistics */}
      <div className="chapter-manager-header">
        <h2>章节管理</h2>
        <div className="chapter-stats">
          <div className="stat-item">
            <span className="stat-label">总章节:</span>
            <span className="stat-value">{totalStats.totalChapters}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">总字数:</span>
            <span className="stat-value">{totalStats.totalWordCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">草稿:</span>
            <span className="stat-value">{totalStats.draftCount}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">修订中:</span>
            <span className="stat-value">{totalStats.revisingCount}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">已完成:</span>
            <span className="stat-value">{totalStats.completedCount}</span>
          </div>
        </div>
      </div>

      {/* Chapter list */}
      <div className="chapter-list">
        {chapters.length === 0 ? (
          <div className="chapter-list-empty">
            <p>暂无章节</p>
            <p className="hint">在 stories 目录下创建文件以添加章节</p>
          </div>
        ) : (
          chapters.map((chapter) => (
            <div
              key={chapter.id}
              className={`chapter-item ${
                draggedChapterId === chapter.id ? 'chapter-item-dragging' : ''
              } ${
                dragOverChapterId === chapter.id ? 'chapter-item-drag-over' : ''
              }`}
              draggable
              onDragStart={(e) => handleDragStart(e, chapter.id)}
              onDragOver={(e) => handleDragOver(e, chapter.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, chapter.id)}
              onDragEnd={handleDragEnd}
              onClick={() => handleChapterClick(chapter)}
            >
              <div className="chapter-item-drag-handle">⋮⋮</div>
              
              <div className="chapter-item-content">
                <div className="chapter-item-header">
                  <h3 className="chapter-title">{chapter.title}</h3>
                  <select
                    className={`chapter-status-select ${getStatusClass(chapter.status)}`}
                    value={chapter.status}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleStatusChange(chapter.id, e.target.value as ChapterStatus);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="draft">草稿</option>
                    <option value="revising">修订中</option>
                    <option value="completed">已完成</option>
                  </select>
                </div>
                
                <div className="chapter-item-meta">
                  <span className="chapter-meta-item">
                    <span className="meta-label">文件:</span>
                    <span className="meta-value">{chapter.filePath}</span>
                  </span>
                  <span className="chapter-meta-item">
                    <span className="meta-label">字数:</span>
                    <span className="meta-value">{chapter.wordCount.toLocaleString()}</span>
                  </span>
                  <span className="chapter-meta-item">
                    <span className="meta-label">最后修改:</span>
                    <span className="meta-value">{formatDate(chapter.lastModified)}</span>
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
