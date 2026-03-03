'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import './CommandPalette.css'

export type Command = {
  id: string
  label: string
  category: string
  shortcut?: string
  action: () => void | Promise<void>
}

type CommandPaletteProps = {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const runCommand = useCallback((cmd: Command) => {
    void Promise.resolve(cmd.action())
      .catch((error) => {
        console.error('Command execution failed:', error)
      })
      .finally(() => {
        onClose()
      })
  }, [onClose])

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    )
  }, [commands, query])

  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {}
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = []
      }
      groups[cmd.category].push(cmd)
    }
    return groups
  }, [filteredCommands])

  const flatCommands = useMemo(() => filteredCommands, [filteredCommands])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredCommands])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector('.command-palette-item.selected')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          {
            const cmd = flatCommands[selectedIndex]
            if (cmd) {
              runCommand(cmd)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    },
    [flatCommands, selectedIndex, onClose, runCommand]
  )

  const handleItemClick = useCallback(
    (cmd: Command) => {
      runCommand(cmd)
    },
    [runCommand]
  )

  let currentIndex = 0

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-wrapper">
          <span className="command-palette-icon">CMD</span>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={t('commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="command-palette-shortcut">{t('commandPalette.esc')}</kbd>
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">{t('commandPalette.empty')}</div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="command-palette-group">
                <div className="command-palette-category">{category}</div>
                {cmds.map((cmd) => {
                  const idx = currentIndex++
                  return (
                    <div
                      key={cmd.id}
                      className={`command-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                      onClick={() => handleItemClick(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="command-palette-label">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="command-palette-item-shortcut">{cmd.shortcut}</kbd>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
