'use client'

import { useCallback, useState, type DragEvent, type MouseEvent } from 'react'
import './TabBar.css'

export type TabItem = {
  id: string
  title: string
  path: string
  dirty?: boolean
}

type TabBarProps = {
  tabs: TabItem[]
  activeTab: string | null
  onTabSelect: (id: string) => void
  onTabClose: (id: string) => void
  onTabsReorder?: (fromIndex: number, toIndex: number) => void
}

export function TabBar({ tabs, activeTab, onTabSelect, onTabClose, onTabsReorder }: TabBarProps) {
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((e: DragEvent, index: number) => {
    setDragStartIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }, [])

  const handleDragOver = useCallback((e: DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragStartIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent, toIndex: number) => {
      e.preventDefault()
      const fromIndex = dragStartIndex
      if (fromIndex !== null && fromIndex !== toIndex && onTabsReorder) {
        onTabsReorder(fromIndex, toIndex)
      }
      setDragStartIndex(null)
      setDragOverIndex(null)
    },
    [dragStartIndex, onTabsReorder]
  )

  const handleCloseClick = useCallback(
    (e: MouseEvent, tabId: string) => {
      e.stopPropagation()
      onTabClose(tabId)
    },
    [onTabClose]
  )

  if (tabs.length === 0) {
    return (
      <div className="tab-bar empty">
        <span className="tab-bar-placeholder">无文件打开</span>
      </div>
    )
  }

  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`tab-bar-item ${tab.id === activeTab ? 'active' : ''} ${
            dragStartIndex === index ? 'dragging' : ''
          } ${dragOverIndex === index ? 'drag-over' : ''} ${tab.dirty ? 'dirty' : ''}`}
          onClick={() => onTabSelect(tab.id)}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, index)}
          title={tab.path}
        >
          <span className="tab-bar-item-title">{tab.title}</span>
          {tab.dirty && <span className="tab-bar-item-dirty">●</span>}
          <button
            className="tab-bar-item-close"
            onClick={(e) => handleCloseClick(e, tab.id)}
            title="关闭"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
