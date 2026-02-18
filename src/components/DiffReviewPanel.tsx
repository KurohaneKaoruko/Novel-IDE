'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ChangeSet } from '../services/ModificationService'
import { useDiff } from '../contexts/DiffContext'
import './DiffReviewPanel.css'

type DiffReviewPanelProps = {
  onAccept?: (changeSetId: string) => void | Promise<void>
  onReject?: (changeSetId: string) => void
  onClose?: (changeSetId: string) => void
}

export function DiffReviewPanel({ onAccept, onReject, onClose }: DiffReviewPanelProps) {
  const { changeSets, activeChangeSetId, setActiveChangeSet, removeChangeSet } = useDiff()
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split')
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all')

  const allChangeSets = useMemo(() => Array.from(changeSets.values()), [changeSets])

  const filteredChangeSets = useMemo(() => {
    if (filter === 'all') return allChangeSets
    return allChangeSets.filter((cs) => cs.status === filter)
  }, [allChangeSets, filter])

  const activeChangeSet = activeChangeSetId
    ? changeSets.get(activeChangeSetId)
    : null

  const handleAccept = useCallback(async () => {
    if (!activeChangeSetId) return
    await onAccept?.(activeChangeSetId)
    // Don't remove, just update status in context
  }, [activeChangeSetId, onAccept])

  const handleReject = useCallback(() => {
    if (!activeChangeSetId) return
    onReject?.(activeChangeSetId)
  }, [activeChangeSetId, onReject])

  const handleClose = useCallback(() => {
    if (!activeChangeSetId) return
    removeChangeSet(activeChangeSetId)
    onClose?.(activeChangeSetId)
  }, [activeChangeSetId, removeChangeSet, onClose])

  if (allChangeSets.length === 0) return null

  return (
    <div className="diff-review-panel">
      {/* Header */}
      <div className="diff-review-header">
        <div className="diff-review-title">
          <span className="diff-review-icon">📝</span>
          <span>修改审查</span>
          <span className="diff-review-count">{allChangeSets.length}</span>
        </div>
        <div className="diff-review-filters">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            className={`filter-btn ${filter === 'pending' ? 'active' : ''}`}
            onClick={() => setFilter('pending')}
          >
            待审查
          </button>
          <button
            className={`filter-btn ${filter === 'accepted' ? 'active' : ''}`}
            onClick={() => setFilter('accepted')}
          >
            已接受
          </button>
          <button
            className={`filter-btn ${filter === 'rejected' ? 'active' : ''}`}
            onClick={() => setFilter('rejected')}
          >
            已拒绝
          </button>
        </div>
        <div className="diff-review-actions">
          <div className="view-toggle">
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
        </div>
      </div>

      {/* Main Content */}
      <div className="diff-review-content">
        {/* Sidebar: File List */}
        <div className="diff-review-sidebar">
          {filteredChangeSets.map((changeSet) => (
            <div
              key={changeSet.id}
              className={`diff-review-file-item ${
                activeChangeSetId === changeSet.id ? 'active' : ''
              } ${changeSet.status}`}
              onClick={() => setActiveChangeSet(changeSet.id)}
            >
              <div className="file-item-status">
                {changeSet.status === 'pending' && '⏳'}
                {changeSet.status === 'accepted' && '✅'}
                {changeSet.status === 'rejected' && '❌'}
              </div>
              <div className="file-item-info">
                <div className="file-item-name">{changeSet.filePath.split('/').pop()}</div>
                <div className="file-item-path">{changeSet.filePath}</div>
              </div>
              <div className="file-item-stats">
                <span className="add">+{changeSet.stats.additions}</span>
                <span className="delete">-{changeSet.stats.deletions}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Diff View */}
        <div className="diff-review-main">
          {activeChangeSet ? (
            <>
              <div className="diff-review-file-header">
                <div className="file-header-info">
                  <span className="file-header-path">{activeChangeSet.filePath}</span>
                  <span className={`file-header-status ${activeChangeSet.status}`}>
                    {activeChangeSet.status === 'pending' && '待审查'}
                    {activeChangeSet.status === 'accepted' && '已接受'}
                    {activeChangeSet.status === 'rejected' && '已拒绝'}
                  </span>
                </div>
                <div className="file-header-actions">
                  {activeChangeSet.status === 'pending' && (
                    <>
                      <button className="action-btn accept" onClick={handleAccept}>
                        ✓ 接受
                      </button>
                      <button className="action-btn reject" onClick={handleReject}>
                        ✕ 拒绝
                      </button>
                    </>
                  )}
                  <button className="action-btn close" onClick={handleClose}>
                    ✕
                  </button>
                </div>
              </div>
              <div className="diff-review-diff">
                {viewMode === 'split' ? (
                  <SplitDiffView changeSet={activeChangeSet} />
                ) : (
                  <UnifiedDiffView changeSet={activeChangeSet} />
                )}
              </div>
            </>
          ) : (
            <div className="diff-review-empty">
              选择一个文件查看修改内容
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Split View Component
function SplitDiffView({ changeSet }: { changeSet: ChangeSet }) {
  const modifications = changeSet.modifications

  // Get original content (simplified - in real app would load from file)
  const renderOriginalPane = () => (
    <div className="diff-pane">
      <div className="diff-pane-header">原始</div>
      <div className="diff-pane-content">
        {modifications.map((mod) => (
          <div key={mod.id} className="diff-modification-block">
            {(mod.type === 'delete' || mod.type === 'modify') && mod.originalText && (
              <>
                {mod.originalText.split('\n').map((line, i) => (
                  <div key={i} className="diff-line delete">
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
  )

  const renderModifiedPane = () => (
    <div className="diff-pane">
      <div className="diff-pane-header">修改后</div>
      <div className="diff-pane-content">
        {modifications.map((mod) => (
          <div key={mod.id} className="diff-modification-block">
            {(mod.type === 'add' || mod.type === 'modify') && mod.modifiedText && (
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
  )

  return (
    <div className="diff-split-view">
      {renderOriginalPane()}
      {renderModifiedPane()}
    </div>
  )
}

// Unified View Component
function UnifiedDiffView({ changeSet }: { changeSet: ChangeSet }) {
  const modifications = changeSet.modifications

  return (
    <div className="diff-unified-view">
      <div className="diff-pane">
        <div className="diff-pane-header">差异</div>
        <div className="diff-pane-content">
          {modifications.map((mod) => (
            <div key={mod.id} className="diff-modification-block">
              {mod.type === 'delete' && mod.originalText && (
                <div className="diff-line delete">
                  <span className="line-num">{mod.lineStart + 1}</span>
                  <span className="line-prefix">-</span>
                  <span className="line-content">{mod.originalText}</span>
                </div>
              )}
              {mod.type === 'modify' && (
                <>
                  {mod.originalText && (
                    <div className="diff-line delete">
                      <span className="line-num">{mod.lineStart + 1}</span>
                      <span className="line-prefix">-</span>
                      <span className="line-content">{mod.originalText}</span>
                    </div>
                  )}
                  {mod.modifiedText && (
                    <div className="diff-line add">
                      <span className="line-num">{mod.lineStart + 1}</span>
                      <span className="line-prefix">+</span>
                      <span className="line-content">{mod.modifiedText}</span>
                    </div>
                  )}
                </>
              )}
              {mod.type === 'add' && mod.modifiedText && (
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
    </div>
  )
}
