import React, { useState, useEffect } from 'react';
import { plotLineService, chapterService } from '../services';
import type { PlotLine, PlotLineData, PlotLineStatus } from '../services';
import type { Chapter } from '../services';
import { PlotLineVisualization } from './PlotLineVisualization';
import './PlotLineManager.css';

export interface PlotLineManagerProps {
  onPlotLineClick?: (plotLine: PlotLine) => void;
  onPlotLineUpdate?: () => void;
}

/**
 * PlotLineManager Component
 * Displays and manages all plot lines in the novel
 * Supports creating, editing, deleting plot lines and visualizing them
 */
export const PlotLineManager: React.FC<PlotLineManagerProps> = ({
  onPlotLineClick,
  onPlotLineUpdate,
}) => {
  const [plotLines, setPlotLines] = useState<PlotLine[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingPlotLine, setEditingPlotLine] = useState<PlotLine | null>(null);
  const [selectedPlotLine, setSelectedPlotLine] = useState<PlotLine | null>(null);

  // Form state
  const [formData, setFormData] = useState<PlotLineData>({
    name: '',
    startChapter: '',
    endChapter: undefined,
    status: 'ongoing',
    description: '',
  });

  // Load plot lines and chapters on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [plotLineList, chapterList] = await Promise.all([
        plotLineService.listPlotLines(),
        chapterService.listChapters(),
      ]);
      setPlotLines(plotLineList);
      setChapters(chapterList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handlePlotLineClick = (plotLine: PlotLine) => {
    setSelectedPlotLine(plotLine);
    if (onPlotLineClick) {
      onPlotLineClick(plotLine);
    }
  };

  const handleCreateClick = () => {
    setShowCreateForm(true);
    setEditingPlotLine(null);
    setFormData({
      name: '',
      startChapter: chapters.length > 0 ? chapters[0].id : '',
      endChapter: undefined,
      status: 'ongoing',
      description: '',
    });
  };

  const handleEditClick = (plotLine: PlotLine) => {
    setEditingPlotLine(plotLine);
    setShowCreateForm(true);
    setFormData({
      name: plotLine.name,
      startChapter: plotLine.startChapter,
      endChapter: plotLine.endChapter,
      status: plotLine.status,
      description: plotLine.description || '',
    });
  };

  const handleCancelForm = () => {
    setShowCreateForm(false);
    setEditingPlotLine(null);
    setFormData({
      name: '',
      startChapter: '',
      endChapter: undefined,
      status: 'ongoing',
      description: '',
    });
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (editingPlotLine) {
        // Update existing plot line
        await plotLineService.updatePlotLine(editingPlotLine.id, formData);
      } else {
        // Create new plot line
        await plotLineService.createPlotLine(formData);
      }
      
      // Reload data
      await loadData();
      
      // Reset form
      handleCancelForm();
      
      if (onPlotLineUpdate) {
        onPlotLineUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plot line');
    }
  };

  const handleDeleteClick = async (plotLineId: string) => {
    if (!confirm('确定要删除这条情节线吗？')) {
      return;
    }
    
    try {
      await plotLineService.deletePlotLine(plotLineId);
      await loadData();
      
      if (selectedPlotLine?.id === plotLineId) {
        setSelectedPlotLine(null);
      }
      
      if (onPlotLineUpdate) {
        onPlotLineUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete plot line');
    }
  };

  const getStatusText = (status: PlotLineStatus) => {
    switch (status) {
      case 'ongoing':
        return '进行中';
      case 'completed':
        return '已完结';
      case 'paused':
        return '暂停';
      default:
        return status;
    }
  };

  const getStatusClass = (status: PlotLineStatus) => {
    switch (status) {
      case 'ongoing':
        return 'status-ongoing';
      case 'completed':
        return 'status-completed';
      case 'paused':
        return 'status-paused';
      default:
        return '';
    }
  };

  const getChapterTitle = (chapterId: string) => {
    const chapter = chapters.find(c => c.id === chapterId);
    return chapter ? chapter.title : chapterId;
  };

  if (loading) {
    return (
      <div className="plot-line-manager-loading">
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="plot-line-manager">
      <div className="plot-line-manager-header">
        <h2>情节线管理</h2>
        <button className="btn-create" onClick={handleCreateClick}>
          + 新建情节线
        </button>
      </div>

      {error && (
        <div className="plot-line-manager-error">
          <p>{error}</p>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {showCreateForm && (
        <div className="plot-line-form-overlay">
          <div className="plot-line-form">
            <h3>{editingPlotLine ? '编辑情节线' : '新建情节线'}</h3>
            <form onSubmit={handleSubmitForm}>
              <div className="form-group">
                <label htmlFor="name">名称 *</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="输入情节线名称"
                />
              </div>

              <div className="form-group">
                <label htmlFor="startChapter">起始章节 *</label>
                <select
                  id="startChapter"
                  value={formData.startChapter}
                  onChange={(e) => setFormData({ ...formData, startChapter: e.target.value })}
                  required
                >
                  <option value="">选择章节</option>
                  {chapters.map(chapter => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="endChapter">结束章节</label>
                <select
                  id="endChapter"
                  value={formData.endChapter || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    endChapter: e.target.value || undefined 
                  })}
                >
                  <option value="">未定</option>
                  {chapters.map(chapter => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="status">状态 *</label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    status: e.target.value as PlotLineStatus 
                  })}
                  required
                >
                  <option value="ongoing">进行中</option>
                  <option value="completed">已完结</option>
                  <option value="paused">暂停</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="description">描述</label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="输入情节线描述"
                  rows={4}
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-submit">
                  {editingPlotLine ? '保存' : '创建'}
                </button>
                <button type="button" className="btn-cancel" onClick={handleCancelForm}>
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="plot-line-manager-content">
        {plotLines.length === 0 ? (
          <div className="plot-line-manager-empty">
            <p>暂无情节线，点击"新建情节线"开始创建</p>
          </div>
        ) : (
          <>
            <div className="plot-line-visualization-section">
              <h3>情节线可视化</h3>
              <PlotLineVisualization
                plotLines={plotLines}
                chapters={chapters}
                onPlotLineClick={handlePlotLineClick}
              />
            </div>

            <div className="plot-line-list-section">
              <h3>情节线列表</h3>
              <div className="plot-line-list">
                {plotLines.map(plotLine => (
                  <div
                    key={plotLine.id}
                    className={`plot-line-item ${selectedPlotLine?.id === plotLine.id ? 'selected' : ''}`}
                    onClick={() => handlePlotLineClick(plotLine)}
                  >
                    <div className="plot-line-item-header">
                      <h4>{plotLine.name}</h4>
                      <span className={`plot-line-status ${getStatusClass(plotLine.status)}`}>
                        {getStatusText(plotLine.status)}
                      </span>
                    </div>
                    
                    <div className="plot-line-item-info">
                      <p>
                        <strong>起始章节:</strong> {getChapterTitle(plotLine.startChapter)}
                      </p>
                      <p>
                        <strong>结束章节:</strong> {
                          plotLine.endChapter 
                            ? getChapterTitle(plotLine.endChapter) 
                            : '未定'
                        }
                      </p>
                      {plotLine.description && (
                        <p className="plot-line-description">
                          <strong>描述:</strong> {plotLine.description}
                        </p>
                      )}
                    </div>

                    <div className="plot-line-item-chapters">
                      <strong>涉及章节:</strong>
                      <div className="chapter-tags">
                        {plotLine.chapters.map(chapterId => (
                          <span key={chapterId} className="chapter-tag">
                            {getChapterTitle(chapterId)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="plot-line-item-actions">
                      <button
                        className="btn-edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(plotLine);
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(plotLine.id);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
