'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import './Search.css'

export type SearchResult = {
  id: string
  path: string
  line: number
  preview: string
  matchCount?: number
}

type SearchOptions = {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

type SearchPanelProps = {
  isOpen: boolean
  onClose: () => void
  onSearch: (query: string, options: SearchOptions) => Promise<SearchResult[]>
  onResultClick: (result: SearchResult) => void
}

export function SearchPanel({ isOpen, onClose, onSearch, onResultClick }: SearchPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [options, setOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  })
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
    }
  }, [isOpen])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)
    try {
      const searchResults = await onSearch(query, options)
      setResults(searchResults)
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setLoading(false)
    }
  }, [query, options, onSearch])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSearch()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-header">
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="search-btn" onClick={() => void handleSearch()} disabled={loading}>
            {loading ? t('search.searching') : t('search.search')}
          </button>
          <button className="search-close" onClick={onClose} aria-label={t('common.close')}>
            x
          </button>
        </div>

        <div className="search-options">
          <label className="search-option">
            <input
              type="checkbox"
              checked={options.caseSensitive}
              onChange={(e) => setOptions({ ...options, caseSensitive: e.target.checked })}
            />
            <span>{t('search.option.caseSensitive')}</span>
          </label>
          <label className="search-option">
            <input
              type="checkbox"
              checked={options.wholeWord}
              onChange={(e) => setOptions({ ...options, wholeWord: e.target.checked })}
            />
            <span>{t('search.option.wholeWord')}</span>
          </label>
          <label className="search-option">
            <input
              type="checkbox"
              checked={options.regex}
              onChange={(e) => setOptions({ ...options, regex: e.target.checked })}
            />
            <span>{t('search.option.regex')}</span>
          </label>
        </div>

        <div className="search-results">
          {results.length === 0 && searched && !loading ? <div className="search-empty">{t('search.empty')}</div> : null}
          {results.map((result) => (
            <div
              key={result.id}
              className="search-result"
              onClick={() => onResultClick(result)}
            >
              <div className="search-result-path">
                <span className="search-result-file">{result.path.split('/').pop()}</span>
                <span className="search-result-line">:{result.line}</span>
              </div>
              <div className="search-result-preview">{result.preview}</div>
            </div>
          ))}
        </div>

        {results.length > 0 ? (
          <div className="search-footer">{t('search.resultCount', { count: results.length })}</div>
        ) : null}
      </div>
    </div>
  )
}
