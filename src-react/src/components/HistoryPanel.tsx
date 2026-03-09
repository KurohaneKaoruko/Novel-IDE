import { useCallback, useEffect, useMemo, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  createHistorySnapshot,
  isTauriApp,
  listHistoryEntries,
  readHistorySnapshot,
  restoreHistorySnapshot,
  type HistoryEntry,
} from '../tauri'
import { useI18n } from '../i18n'
import { AppIcon } from './icons/AppIcon'
import './HistoryPanel.css'

type HistoryPanelProps = {
  workRoot: string | null
  activePath: string | null
  onOpenPath: (path: string, options?: { forceReload?: boolean }) => void
  onAfterRestore?: (path: string) => void
}

function formatTime(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp)) return '--'
  return new Date(timestamp).toLocaleString(locale, { hour12: false })
}

export function HistoryPanel({ workRoot, activePath, onOpenPath, onAfterRestore }: HistoryPanelProps) {
  const { locale, t } = useI18n()
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)

  const activePathKey = useMemo(() => {
    if (!activePath) return null
    return activePath.replaceAll('\\', '/').toLowerCase()
  }, [activePath])

  const filteredEntries = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    return entries.filter((entry) => {
      if (activeOnly && activePathKey) {
        const entryPath = entry.file_path.replaceAll('\\', '/').toLowerCase()
        if (entryPath !== activePathKey) return false
      }
      if (!keyword) return true
      return (
        entry.file_path.toLowerCase().includes(keyword) ||
        entry.summary.toLowerCase().includes(keyword) ||
        entry.reason.toLowerCase().includes(keyword)
      )
    })
  }, [activeOnly, activePathKey, entries, searchText])

  const selectedEntry = useMemo(
    () => filteredEntries.find((item) => item.id === selectedId) ?? null,
    [filteredEntries, selectedId],
  )

  const refresh = useCallback(async () => {
    if (!workRoot || !isTauriApp()) {
      setEntries([])
      setSelectedId(null)
      setPreview('')
      return
    }
    setLoading(true)
    try {
      const next = await listHistoryEntries(150)
      setEntries(next)
      if (next.length === 0) {
        setSelectedId(null)
        setPreview('')
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [workRoot])

  const loadPreview = useCallback(
    async (id: string) => {
      if (!workRoot || !isTauriApp()) return
      setSelectedId(id)
      try {
        const text = await readHistorySnapshot(id)
        setPreview(text)
      } catch (e) {
        setPreview('')
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [workRoot],
  )

  const handleCreateManualSnapshot = useCallback(async () => {
    if (!activePath || !workRoot || !isTauriApp()) return
    setActionBusy(true)
    try {
      const created = await createHistorySnapshot(activePath, 'manual')
      await refresh()
      await loadPreview(created.id)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActionBusy(false)
    }
  }, [activePath, loadPreview, refresh, workRoot])

  const handleRestore = useCallback(
    async (entry: HistoryEntry) => {
      if (!workRoot || !isTauriApp()) return
      const ok = await confirm(
        t('history.restoreConfirm', {
          path: entry.file_path,
          time: formatTime(entry.created_at, locale),
        }),
        {
          title: t('history.restoreTitle'),
          kind: 'warning',
        },
      )
      if (!ok) return

      setActionBusy(true)
      try {
        const filePath = await restoreHistorySnapshot(entry.id)
        onOpenPath(filePath, { forceReload: true })
        await refresh()
        if (onAfterRestore) {
          onAfterRestore(filePath)
        }
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setActionBusy(false)
      }
    },
    [locale, onAfterRestore, onOpenPath, refresh, t, workRoot],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId) return
    void loadPreview(selectedId)
  }, [loadPreview, selectedId])

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedId(null)
      setPreview('')
      return
    }
    if (!selectedId || !filteredEntries.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredEntries[0].id)
    }
  }, [filteredEntries, selectedId])

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <div className="history-panel-title">
          <span className="history-panel-title-icon"><AppIcon name="history" size={14} /></span>
          <span>{t('history.title')}</span>
        </div>
        <div className="history-panel-actions">
          <button className="icon-button" title={t('history.refresh')} disabled={loading || actionBusy} onClick={() => void refresh()}>
            <AppIcon name="refresh" size={14} />
          </button>
          <button
            className="history-snapshot-btn"
            disabled={!activePath || loading || actionBusy}
            onClick={() => void handleCreateManualSnapshot()}
          >
            {t('history.manualSnapshot')}
          </button>
        </div>
      </div>

      {error ? <div className="history-panel-error">{error}</div> : null}

      <div className="history-panel-filters">
        <label className="history-panel-filter-toggle">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            disabled={!activePath}
          />
          <span>{t('history.activeOnly')}</span>
        </label>
        <input
          className="history-panel-search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
        />
        <span className="history-panel-count">
          {filteredEntries.length}/{entries.length}
        </span>
      </div>

      <div className="history-layout">
        <div className="history-list">
          {filteredEntries.length === 0 ? (
            <div className="history-empty">
              {entries.length === 0 ? (
                <>
                  <p>{t('history.empty')}</p>
                  <p className="history-empty-hint">{t('history.emptyHint')}</p>
                </>
              ) : (
                <>
                  <p>{t('history.emptyFiltered')}</p>
                  <p className="history-empty-hint">{t('history.emptyFilteredHint')}</p>
                </>
              )}
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.id}
                className={`history-row ${selectedId === entry.id ? 'active' : ''}`}
                onClick={() => void loadPreview(entry.id)}
              >
                <div className="history-row-main">
                  <span className="history-path" title={entry.file_path}>{entry.file_path}</span>
                  <span className="history-meta">{formatTime(entry.created_at, locale)}</span>
                </div>
                <div className="history-row-sub">
                  <span title={entry.summary}>{entry.summary}</span>
                  <span>{t('history.wordCount', { count: entry.word_count })}</span>
                </div>
                <span className="history-reason">{entry.reason}</span>
              </button>
            ))
          )}
        </div>

        <div className="history-preview">
          {selectedEntry ? (
            <>
              <div className="history-preview-head">
                <div>
                  <div className="history-preview-file">{selectedEntry.file_path}</div>
                  <div className="history-preview-time">{formatTime(selectedEntry.created_at, locale)}</div>
                </div>
                <button
                  className="history-restore-btn"
                  disabled={actionBusy}
                  onClick={() => void handleRestore(selectedEntry)}
                >
                  {t('history.restore')}
                </button>
              </div>
              <pre className="history-preview-body">{preview || t('history.previewEmpty')}</pre>
            </>
          ) : (
            <div className="history-preview-empty">{t('history.selectHint')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

