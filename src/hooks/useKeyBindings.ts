import { useCallback, useEffect } from 'react'

export type KeyBinding = {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  action: () => void | Promise<void>
  description?: string
}

type UseKeyBindingsOptions = {
  enabled?: boolean
}

export function useKeyBindings(bindings: KeyBinding[], options: UseKeyBindingsOptions = {}) {
  const { enabled = true } = options

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      // Don't trigger in input fields (except for specific commands)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      for (const binding of bindings) {
        const keyMatch = e.key.toLowerCase() === binding.key.toLowerCase()
        const ctrlMatch = !!binding.ctrl === (e.ctrlKey || e.metaKey)
        const shiftMatch = !!binding.shift === e.shiftKey
        const altMatch = !!binding.alt === e.altKey
        const metaMatch = !!binding.meta === e.metaKey

        // For input fields, only allow if ctrl/meta is pressed
        if (isInput && !ctrlMatch && !metaMatch) continue

        if (keyMatch && ctrlMatch && shiftMatch && altMatch && metaMatch) {
          e.preventDefault()
          binding.action()
          return
        }
      }
    },
    [bindings, enabled]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

// Parse keyboard shortcut string to KeyBinding
export function parseShortcut(shortcut: string): Partial<KeyBinding> {
  const parts = shortcut.toLowerCase().split('+').map((p) => p.trim())
  const result: Partial<KeyBinding> = {}

  for (const part of parts) {
    switch (part) {
      case 'ctrl':
      case 'control':
        result.ctrl = true
        break
      case 'shift':
        result.shift = true
        break
      case 'alt':
        result.alt = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        result.meta = true
        break
      default:
        result.key = part.toUpperCase()
    }
  }

  return result
}

// Format KeyBinding to display string
export function formatShortcut(binding: Partial<KeyBinding>): string {
  const parts: string[] = []

  if (binding.ctrl || binding.meta) parts.push('⌘')
  if (binding.shift) parts.push('⇧')
  if (binding.alt) parts.push('⌥')
  if (binding.key) parts.push(binding.key.toUpperCase())

  return parts.join('')
}

// Common keyboard shortcuts
export const DEFAULT_SHORTCUTS = {
  save: { key: 's', ctrl: true },
  openCommandPalette: { key: 'p', ctrl: true, shift: true },
  search: { key: 'f', ctrl: true },
  newFile: { key: 'n', ctrl: true },
  closeTab: { key: 'w', ctrl: true },
  nextTab: { key: 'Tab', ctrl: true },
  prevTab: { key: 'Tab', ctrl: true, shift: true },
  toggleSidebar: { key: 'b', ctrl: true },
  toggleTerminal: { key: '`', ctrl: true },
  findInFiles: { key: 'f', ctrl: true, shift: true },
  goToLine: { key: 'g', ctrl: true },
  toggleTheme: { key: 't', ctrl: true, shift: true },
}
