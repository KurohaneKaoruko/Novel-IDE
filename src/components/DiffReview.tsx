'use client'

import { useCallback, useMemo, useState } from 'react'
import type { ChangeSet, FileModification } from '../services/ModificationService'
import './DiffReview.css'

type DiffReviewProps = {
  changeSets: ChangeSet[]
  onAccept: (changeSetId: string) => void
  onReject: (changeSetId: string) => void
  onClose: (changeSetId: string) => void
}

export function DiffReview({ changeSets, onAccept, onReject, onClose }: DiffReviewProps) {
  const [selectedChangeSet, setSelectedChangeSet] = useState<string | null>(
    changeSets[0]?.id || null
  )
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split')

  const activeChangeSet = useMemo(
    () => changeSets.find((cs) => cs.id === selectedChangeSet),
    [changeSets, selectedChangeSet]
  )

  const pendingCount = useMemo(
    () => changeSets.filter((cs) => cs.status === 'pending').length,
    [changeSets]
  )

  if (changeSets.length === 0) return null

  return (
    <div className="diff-review">
      {/* Sidebar: Change Set List */}
      <div className="diff-review-sidebar">
        <div className="diff-review-sidebar-header">
          <span className="diff-review-title">
            📝 修改审查 {pendingCount > 0 && <span className="pending-badge">{pendingCount}</span>}
          </span>
        </div>
        <div className="diff-review-list">
          {changeSets.map((changeSet) => (
            <div
              key={changeSet.id}
              className={`diff-review-item ${selectedChangeSet === changeSet.id ? 'active' : ''} ${changeSet.status}`}
              onClick={() => setSelectedChangeSet(changeSet.id)}
            >
              <div className="diff-review-item-status">
                {changeSet.status === 'pending' && '⏳'}
                {changeSet.status === 'accepted' && '✅'}
                {changeSet.status === 'rejected' && '❌'}
              </div>
              <div className="diff-review-item-info">
                <div className="diff-review-item-path">{changeSet.filePath.split('/').pop()}</div>
                <div className="diff-review-item-stats">
                  <span className="add">+{changeSet.stats.additions}</span>
                  <span className="delete">-{changeSet.stats.deletions}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main: Diff View */}
      <div className="diff-review-main">
        {activeChangeSet && (
          <>
            <div className="diff-review-header">
              <div className="diff-review-file-info">
                <span className="diff-review-file-path">{activeChangeSet.filePath}</span>
                <span className={`diff-review-status ${activeChangeSet.status}`}>
                  {activeChangeSet.status === 'pending' && '待审查'}
                  {activeChangeSet.status === 'accepted' && '已接受'}
                  {activeChangeSet.status === 'rejected' && '已拒绝'}
                </span>
              </div>
              <div className="diff-review-actions">
                <div className="diff-review-view-toggle">
                  <button
                    className={viewMode === 'split' ? 'active' : ''}
                    onClick={() => setViewMode('split')}
                  >
                    分割
                  </button>
                  <button
                    className={viewMode === 'unified' ? 'active' : ''}
                    onClick={() => setViewMode('unified')}
                  >
                    统一
                  </button>
                </div>
                {activeChangeSet.status === 'pending' && (
                  <>
                    <button
                      className="diff-review-btn accept"
                      onClick={() => onAccept(activeChangeSet.id)}
                    >
                      ✓ 接受
                    </button>
                    <button
                      className="diff-review-btn reject"
                      onClick={() => onReject(activeChangeSet.id)}
                    >
                      ✕ 拒绝
                    </button>
                  </>
                )}
                <button className="diff-review-btn close" onClick={() => onClose(activeChangeSet.id)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="diff-review-content">
              {viewMode === 'split' ? (
                <SplitDiffView changeSet={activeChangeSet} />
              ) : (
                <UnifiedDiffView changeSet={activeChangeSet} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Split View Component
function SplitDiffView({ changeSet }: { changeSet: ChangeSet }) {
  const modifications = changeSet.modifications

  return (
    <div className="diff-view-split">
      <div className="diff-pane diff-pane-original">
        <div className="diff-pane-header">原始</div>
        <div className="diff-pane-content">
          {modifications.map((mod) => (
            <div key={mod.id} className="diff-block">
              {mod.type !== 'add' && (
                <>
                  {Array.from({ length: mod.lineEnd - mod.lineStart + 1 }, (_, i) => (
                    <div key={i} className="diff-line delete">
                      <span className="line-num">{mod.lineStart + i + 1}</span>
                      <span className="line-content">
                        {mod.originalText?.split('\n')[i] || ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="diff-pane diff-pane-modified">
        <div className="diff-pane-header">修改后</div>
        <div className="diff-pane-content">
          {modifications.map((mod) => (
            <div key={mod.id} className="diff-block">
              {mod.type !== 'delete' && (
                <>
                  {mod.modifiedText.split('\n').map((line, i) => (
                    <div key={i} className={`diff-line ${mod.type === 'add' ? 'add' : 'modify'}`}>
                      <span className="line-num">{mod.lineStart + i + 1}</span>
                      <span className="line-content">{line}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Unified View Component
function UnifiedDiffView({ changeSet }: { changeSet: ChangeSet }) {
  const modifications = changeSet.modifications

  return (
    <div className="diff-view-unified">
      <div className="diff-pane-content">
        {modifications.map((mod) => (
          <div key={mod.id} className="diff-block">
            {mod.type === 'delete' && (
              <div className="diff-line delete">
                <span className="line-num">{mod.lineStart + 1}</span>
                <span className="line-prefix">-</span>
                <span className="line-content">{mod.originalText}</span>
              </div>
            )}
            {mod.type === 'modify' && (
              <>
                <div className="diff-line delete">
                  <span className="line-num">{mod.lineStart + 1}</span>
                  <span className="line-prefix">-</span>
                  <span className="line-content">{mod.originalText}</span>
                </div>
                <div className="diff-line add">
                  <span className="line-num">{mod.lineStart + 1}</span>
                  <span className="line-prefix">+</span>
                  <span className="line-content">{mod.modifiedText}</span>
                </div>
              </>
            )}
            {mod.type === 'add' && (
              <div className="diff-line add">
                <span className="line-num">{mod.lineStart + 1}</span>
                <span className="line-prefix">+</span>
                <span className="line-content">{mod.modifiedText}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
