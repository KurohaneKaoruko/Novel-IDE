import React, { useMemo } from 'react';
import type { FileModification } from '../services';
import './DiffView.css';

export type ViewMode = 'split' | 'unified';

export interface DiffViewProps {
  fileModification: FileModification;
  viewMode: ViewMode;
  onAccept: (modificationId: string) => void;
  onReject: (modificationId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose?: () => void;
}

/**
 * DiffView Component
 * Displays file modifications with side-by-side or unified diff view
 * Supports accepting/rejecting individual modifications or all at once
 */
export const DiffView: React.FC<DiffViewProps> = ({
  fileModification,
  viewMode,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onClose,
}) => {
  const { filePath, originalContent, modifications, status } = fileModification;

  // Split content into lines for display
  const originalLines = useMemo(() => originalContent.split('\n'), [originalContent]);

  // Calculate modified content by applying all modifications
  const modifiedContent = useMemo(() => {
    let result = originalContent;
    // Sort modifications by line number (descending) to apply from bottom to top
    const sortedMods = [...modifications].sort((a, b) => b.lineStart - a.lineStart);
    
    for (const mod of sortedMods) {
      if (mod.status !== 'accepted') continue;
      
      const lines = result.split('\n');
      const before = lines.slice(0, mod.lineStart);
      const after = lines.slice(mod.lineEnd + 1);
      
      if (mod.type === 'add' && mod.modifiedText) {
        const newLines = mod.modifiedText.split('\n');
        result = [...before, ...newLines, ...after].join('\n');
      } else if (mod.type === 'delete') {
        result = [...before, ...after].join('\n');
      } else if (mod.type === 'modify' && mod.modifiedText) {
        const newLines = mod.modifiedText.split('\n');
        result = [...before, ...newLines, ...after].join('\n');
      }
    }
    
    return result;
  }, [originalContent, modifications]);

  const modifiedLines = useMemo(() => modifiedContent.split('\n'), [modifiedContent]);

  // Get modification statistics
  const stats = useMemo(() => {
    const additions = modifications.filter(m => m.type === 'add').length;
    const deletions = modifications.filter(m => m.type === 'delete').length;
    const changes = modifications.filter(m => m.type === 'modify').length;
    const pending = modifications.filter(m => m.status === 'pending').length;
    const accepted = modifications.filter(m => m.status === 'accepted').length;
    const rejected = modifications.filter(m => m.status === 'rejected').length;
    
    return { additions, deletions, changes, pending, accepted, rejected };
  }, [modifications]);

  // Render line with modification highlighting
  const renderLine = (lineNum: number, content: string, type: 'original' | 'modified') => {
    const mod = modifications.find(m => lineNum >= m.lineStart && lineNum <= m.lineEnd);
    
    let className = 'diff-line';
    if (mod) {
      if (mod.type === 'add') className += ' diff-line-add';
      else if (mod.type === 'delete') className += ' diff-line-delete';
      else if (mod.type === 'modify') className += ' diff-line-modify';
      
      if (mod.status === 'accepted') className += ' diff-line-accepted';
      else if (mod.status === 'rejected') className += ' diff-line-rejected';
    }
    
    return (
      <div key={`${type}-${lineNum}`} className={className}>
        <span className="diff-line-number">{lineNum + 1}</span>
        <span className="diff-line-content">{content || ' '}</span>
      </div>
    );
  };

  // Render split view (side-by-side)
  const renderSplitView = () => {
    return (
      <div className="diff-split-view">
        <div className="diff-pane diff-pane-original">
          <div className="diff-pane-header">Original</div>
          <div className="diff-pane-content">
            {originalLines.map((line, idx) => renderLine(idx, line, 'original'))}
          </div>
        </div>
        <div className="diff-pane diff-pane-modified">
          <div className="diff-pane-header">Modified</div>
          <div className="diff-pane-content">
            {modifiedLines.map((line, idx) => renderLine(idx, line, 'modified'))}
          </div>
        </div>
      </div>
    );
  };

  // Render unified view (interleaved)
  const renderUnifiedView = () => {
    const lines: Array<{ lineNum: number; content: string; type: 'original' | 'modified' | 'unchanged' }> = [];
    
    // Simple unified view: show all original lines with modifications highlighted
    originalLines.forEach((line, idx) => {
      const mod = modifications.find(m => idx >= m.lineStart && idx <= m.lineEnd);
      if (mod) {
        if (mod.type === 'delete') {
          lines.push({ lineNum: idx, content: line, type: 'original' });
        } else if (mod.type === 'modify' && mod.modifiedText) {
          lines.push({ lineNum: idx, content: line, type: 'original' });
          lines.push({ lineNum: idx, content: mod.modifiedText, type: 'modified' });
        } else if (mod.type === 'add' && mod.modifiedText) {
          lines.push({ lineNum: idx, content: mod.modifiedText, type: 'modified' });
        }
      } else {
        lines.push({ lineNum: idx, content: line, type: 'unchanged' });
      }
    });
    
    return (
      <div className="diff-unified-view">
        <div className="diff-pane-content">
          {lines.map((line) => renderLine(line.lineNum, line.content, line.type === 'modified' ? 'modified' : 'original'))}
        </div>
      </div>
    );
  };

  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-header-left">
          <span className="diff-file-path">{filePath}</span>
          <span className="diff-stats">
            <span className="diff-stat-add">+{stats.additions}</span>
            <span className="diff-stat-delete">-{stats.deletions}</span>
            <span className="diff-stat-modify">~{stats.changes}</span>
          </span>
          <span className="diff-status">
            {status === 'pending' && `${stats.pending} pending`}
            {status === 'partial' && `${stats.accepted} accepted, ${stats.pending} pending`}
            {status === 'accepted' && 'All accepted'}
            {status === 'rejected' && 'All rejected'}
          </span>
        </div>
        <div className="diff-header-right">
          <button 
            className="diff-btn diff-btn-accept-all" 
            onClick={onAcceptAll}
            disabled={stats.pending === 0}
            title="Accept all pending modifications"
          >
            Accept All
          </button>
          <button 
            className="diff-btn diff-btn-reject-all" 
            onClick={onRejectAll}
            disabled={stats.pending === 0}
            title="Reject all pending modifications"
          >
            Reject All
          </button>
          {onClose && (
            <button 
              className="diff-btn diff-btn-close" 
              onClick={onClose}
              title="Close diff view"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="diff-content">
        {viewMode === 'split' ? renderSplitView() : renderUnifiedView()}
      </div>

      {modifications.length > 0 && (
        <div className="diff-modifications">
          <div className="diff-modifications-header">Modifications</div>
          <div className="diff-modifications-list">
            {modifications.map((mod) => (
              <div key={mod.id} className={`diff-modification diff-modification-${mod.status}`}>
                <div className="diff-modification-info">
                  <span className={`diff-modification-type diff-modification-type-${mod.type}`}>
                    {mod.type}
                  </span>
                  <span className="diff-modification-lines">
                    Lines {mod.lineStart + 1}-{mod.lineEnd + 1}
                  </span>
                  <span className="diff-modification-status">{mod.status}</span>
                </div>
                {mod.status === 'pending' && (
                  <div className="diff-modification-actions">
                    <button 
                      className="diff-btn diff-btn-sm diff-btn-accept" 
                      onClick={() => onAccept(mod.id)}
                      title="Accept this modification"
                    >
                      Accept
                    </button>
                    <button 
                      className="diff-btn diff-btn-sm diff-btn-reject" 
                      onClick={() => onReject(mod.id)}
                      title="Reject this modification"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DiffView;
