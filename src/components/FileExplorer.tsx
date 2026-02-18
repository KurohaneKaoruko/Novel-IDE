'use client'

import React, { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { FsEntry } from '../tauri'
import './FileExplorer.css'

type FileExplorerProps = {
  tree: FsEntry | null
  activePath: string | null
  query: string
  onQueryChange: (query: string) => void
  onFileClick: (entry: FsEntry) => void
  onContextMenu?: (e: MouseEvent, entry: FsEntry) => void
}

const getFileIcon = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    md: '📝',
    txt: '📄',
    json: '📋',
    js: '📜',
    ts: '📜',
    jsx: '⚛️',
    tsx: '⚛️',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    java: '☕',
    css: '🎨',
    html: '🌐',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    svg: '🖼️',
  }
  return iconMap[ext || ''] || '📄'
}

const getDirIcon = (isOpen: boolean): string => (isOpen ? '📂' : '📁')

export function FileExplorer({ tree, activePath, query, onQueryChange, onFileClick, onContextMenu }: FileExplorerProps) {
  const visibleTree = useMemo(() => {
    if (!tree) return null
    if (!query.trim()) return tree

    const q = query.toLowerCase()

    const walk = (e: FsEntry): FsEntry | null => {
      const name = e.name.toLowerCase()
      if (e.kind === 'file') {
        return name.includes(q) ? e : null
      }
      const filtered = e.children.map(walk).filter(Boolean) as FsEntry[]
      if (name.includes(q) || filtered.length > 0) {
        return { ...e, children: filtered }
      }
      return null
    }

    return walk(tree)
  }, [tree, query])

  const renderEntry = useCallback(
    (entry: FsEntry, depth: number): React.JSX.Element => {
      const isActive = entry.path === activePath
      const paddingLeft = `${depth * 16 + 8}px`

      if (entry.kind === 'dir') {
        const [isOpen, setIsOpen] = useState(depth < 1)
        
        return (
          <div key={entry.path}>
            <div
              className={`file-explorer-item dir ${isActive ? 'active' : ''}`}
              style={{ paddingLeft }}
              onClick={() => setIsOpen(!isOpen)}
              onContextMenu={(e) => onContextMenu?.(e, entry)}
            >
              <span className="file-explorer-icon">{getDirIcon(isOpen)}</span>
              <span className="file-explorer-name">{entry.name}</span>
              <span className="file-explorer-count">{entry.children.length}</span>
            </div>
            {isOpen && (
              <div className="file-explorer-children">
                {entry.children
                  .sort((a, b) => {
                    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
                    return a.name.localeCompare(b.name)
                  })
                  .map((child) => renderEntry(child, depth + 1))}
              </div>
            )}
          </div>
        )
      }

      return (
        <div
          key={entry.path}
          className={`file-explorer-item file ${isActive ? 'active' : ''}`}
          style={{ paddingLeft }}
          onClick={() => onFileClick(entry)}
          onContextMenu={(e) => onContextMenu?.(e, entry)}
        >
          <span className="file-explorer-icon">{getFileIcon(entry.name)}</span>
          <span className="file-explorer-name">{entry.name}</span>
        </div>
      )
    },
    [activePath, onFileClick, onContextMenu]
  )

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <span className="file-explorer-title">资源管理器</span>
        <div className="file-explorer-actions">
          <button className="file-explorer-action" title="新建文件">+</button>
          <button className="file-explorer-action" title="刷新">↻</button>
        </div>
      </div>
      <div className="file-explorer-search">
        <input
          type="text"
          placeholder="搜索文件..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <div className="file-explorer-content">
        {visibleTree ? (
          <div className="file-explorer-tree">
            {visibleTree.children
              .sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
                return a.name.localeCompare(b.name)
              })
              .map((child) => renderEntry(child, 0))}
          </div>
        ) : (
          <div className="file-explorer-empty">无文件</div>
        )}
      </div>
    </div>
  )
}
