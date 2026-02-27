import React, { useMemo } from 'react';
import type { ChangeSet } from '../services';
import './DiffView.css';

export type ViewMode = 'split' | 'unified';

export interface DiffViewProps {
  changeSet: ChangeSet;
  viewMode: ViewMode;
  onAccept: (modificationId: string) => void;
  onReject: (modificationId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onClose?: () => void;
}

export const DiffView: React.FC<DiffViewProps> = ({
  changeSet,
  viewMode,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onClose,
}) => {
  const { filePath, modifications, stats, status } = changeSet;

  const modifiedStats = useMemo(() => {
    const pending = modifications.filter(m => m.status === 'pending').length;
    const accepted = modifications.filter(m => m.status === 'accepted').length;
    const rejected = modifications.filter(m => m.status === 'rejected').length;
    
    return { pending, accepted, rejected };
  }, [modifications]);

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

  const renderSplitView = () => {
    const originalLines: Array<{ lineNum: number; content: string }> = [];
    const modifiedLines: Array<{ lineNum: number; content: string }> = [];

    for (const mod of modifications) {
      if (mod.type === 'delete' || mod.type === 'modify') {
        const lines = (mod.originalText || '').split('\n');
        lines.forEach((line, i) => {
          originalLines.push({ lineNum: mod.lineStart + i, content: line });
        });
      }
      if (mod.type === 'add' || mod.type === 'modify') {
        const lines = (mod.modifiedText || '').split('\n');
        lines.forEach((line, i) => {
          modifiedLines.push({ lineNum: mod.lineStart + i, content: line });
        });
      }
    }

    return (
      <div className="diff-split-view">
        <div className="diff-pane diff-pane-original">
          <div className="diff-pane-header">Original</div>
          <div className="diff-pane-content">
            {originalLines.map((line) => renderLine(line.lineNum, line.content, 'original'))}
          </div>
        </div>
        <div className="diff-pane diff-pane-modified">
          <div className="diff-pane-header">Modified</div>
          <div className="diff-pane-content">
            {modifiedLines.map((line) => renderLine(line.lineNum, line.content, 'modified'))}
          </div>
        </div>
      </div>
    );
  };

  const renderUnifiedView = () => {
    const lines: Array<{ lineNum: number; content: string; type: 'original' | 'modified' }> = [];

    for (const mod of modifications) {
      if (mod.type === 'delete' || mod.type === 'modify') {
        const modLines = (mod.originalText || '').split('\n');
        modLines.forEach((line, i) => {
          lines.push({ lineNum: mod.lineStart + i, content: line, type: 'original' });
        });
      }
      if (mod.type === 'add' || mod.type === 'modify') {
        const modLines = (mod.modifiedText || '').split('\n');
        modLines.forEach((line, i) => {
          lines.push({ lineNum: mod.lineStart + i, content: line, type: 'modified' });
        });
      }
    }

    return (
      <div className="diff-unified-view">
        <div className="diff-pane-content">
          {lines.map((line) => renderLine(line.lineNum, line.content, line.type))}
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
          </span>
          <span className="diff-status">
            {status === 'pending' && `${modifiedStats.pending} pending`}
            {status === 'partial' && `${modifiedStats.accepted} accepted, ${modifiedStats.pending} pending`}
            {status === 'accepted' && 'All accepted'}
            {status === 'rejected' && 'All rejected'}
          </span>
        </div>
        <div className="diff-header-right">
          <button 
            className="diff-btn diff-btn-accept-all" 
            onClick={onAcceptAll}
            disabled={modifiedStats.pending === 0}
            title="Accept all pending modifications"
          >
            Accept All
          </button>
          <button 
            className="diff-btn diff-btn-reject-all" 
            onClick={onRejectAll}
            disabled={modifiedStats.pending === 0}
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
