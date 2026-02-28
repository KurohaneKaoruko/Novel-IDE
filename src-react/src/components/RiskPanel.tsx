import { useEffect, useMemo, useState } from 'react'
import { riskScanContent, type RiskScanResult } from '../tauri'
import './RiskPanel.css'

type RiskPanelProps = {
  activeFile: { path: string; content: string } | null
}

const levelLabel: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
}

export function RiskPanel({ activeFile }: RiskPanelProps) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RiskScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canScan = useMemo(
    () => !!activeFile && activeFile.content.trim().length > 0 && !running,
    [activeFile, running],
  )

  useEffect(() => {
    setError(null)
    setResult(null)
  }, [activeFile?.path])

  const onScan = async () => {
    if (!activeFile || !activeFile.content.trim()) return
    setRunning(true)
    setError(null)
    try {
      const res = await riskScanContent(activeFile.path, activeFile.content)
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <div className="sidebar-header">风险检测</div>
      <div className="sidebar-content risk-panel">
        <div className="risk-panel-toolbar">
          <button className="primary-button risk-panel-run" disabled={!canScan} onClick={() => void onScan()}>
            {running ? '检测中...' : '检测当前文件'}
          </button>
          <div className="risk-panel-meta">
            {activeFile ? activeFile.path : '未打开文件'}
          </div>
        </div>

        {error ? <div className="error-text risk-panel-error">{error}</div> : null}

        {!activeFile ? (
          <div className="risk-panel-empty">请先打开要检测的章节文件。</div>
        ) : null}

        {activeFile && !result && !running ? (
          <div className="risk-panel-empty">点击“检测当前文件”后，AI 会给出风险项与改写建议。</div>
        ) : null}

        {result ? (
          <div className="risk-panel-result">
            <div className="risk-panel-summary">
              <div className={`risk-level-badge level-${result.overall_level}`}>
                {levelLabel[result.overall_level] ?? result.overall_level}
              </div>
              <div className="risk-summary-text">{result.summary}</div>
            </div>
            <div className="risk-count">共 {result.findings.length} 项，扫描 {result.scanned_chars} 字符</div>
            {result.findings.length === 0 ? (
              <div className="risk-panel-empty">未检出明显风险项。</div>
            ) : (
              <div className="risk-findings">
                {result.findings.map((item, idx) => (
                  <div key={`${item.category}-${idx}`} className="risk-finding-card">
                    <div className="risk-finding-head">
                      <span className={`risk-level-badge level-${item.level}`}>
                        {levelLabel[item.level] ?? item.level}
                      </span>
                      <span className="risk-category">{item.category || 'other'}</span>
                    </div>
                    {item.excerpt ? <div className="risk-excerpt">“{item.excerpt}”</div> : null}
                    <div className="risk-reason">{item.reason}</div>
                    {item.suggestion ? <div className="risk-suggestion">建议：{item.suggestion}</div> : null}
                    {item.line_start ? (
                      <div className="risk-line">
                        行号：{item.line_start}
                        {item.line_end && item.line_end !== item.line_start ? ` - ${item.line_end}` : ''}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
