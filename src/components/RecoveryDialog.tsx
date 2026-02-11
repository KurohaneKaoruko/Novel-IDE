import { useState, useEffect } from 'react'
import { 
  getAllRecoveryCandidates, 
  acceptRecovery, 
  rejectRecovery, 
  formatRecoveryTime,
  type RecoveryCandidate 
} from '../utils/crashRecovery'
import './RecoveryDialog.css'

interface RecoveryDialogProps {
  onRecover: (filePath: string, content: string) => void
  onClose: () => void
}

export function RecoveryDialog({ onRecover, onClose }: RecoveryDialogProps) {
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const found = await getAllRecoveryCandidates()
        setCandidates(found)
      } catch (e) {
        console.error('Failed to load recovery candidates:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const handleRecover = (candidate: RecoveryCandidate) => {
    acceptRecovery(candidate.filePath)
    onRecover(candidate.filePath, candidate.cachedContent)
    setCandidates((prev) => prev.filter((c) => c.filePath !== candidate.filePath))
  }

  const handleDiscard = (candidate: RecoveryCandidate) => {
    rejectRecovery(candidate.filePath)
    setCandidates((prev) => prev.filter((c) => c.filePath !== candidate.filePath))
  }

  const handleDiscardAll = () => {
    candidates.forEach((c) => rejectRecovery(c.filePath))
    setCandidates([])
    onClose()
  }

  if (loading) {
    return (
      <div className="recovery-dialog-overlay">
        <div className="recovery-dialog">
          <div className="recovery-dialog-header">
            <h3>检查恢复内容...</h3>
          </div>
        </div>
      </div>
    )
  }

  if (candidates.length === 0) {
    return null
  }

  return (
    <div className="recovery-dialog-overlay">
      <div className="recovery-dialog">
        <div className="recovery-dialog-header">
          <h3>发现未保存的内容</h3>
          <p>检测到以下文件有自动保存的内容，是否恢复？</p>
        </div>
        <div className="recovery-dialog-content">
          {candidates.map((candidate) => (
            <div 
              key={candidate.filePath} 
              className={`recovery-item ${selectedPath === candidate.filePath ? 'selected' : ''}`}
              onClick={() => setSelectedPath(candidate.filePath)}
            >
              <div className="recovery-item-header">
                <span className="recovery-item-path">{candidate.filePath}</span>
                <span className="recovery-item-time">
                  {formatRecoveryTime(candidate.cachedTimestamp)}
                </span>
              </div>
              <div className="recovery-item-actions">
                <button
                  className="recovery-button primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRecover(candidate)
                  }}
                >
                  恢复
                </button>
                <button
                  className="recovery-button secondary"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDiscard(candidate)
                  }}
                >
                  放弃
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="recovery-dialog-footer">
          <button className="recovery-button secondary" onClick={handleDiscardAll}>
            全部放弃
          </button>
          <button className="recovery-button primary" onClick={onClose}>
            稍后处理
          </button>
        </div>
      </div>
    </div>
  )
}
