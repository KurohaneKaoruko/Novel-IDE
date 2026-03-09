import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

import { ModificationService, type ChangeSet } from '../src/services/ModificationService'

const invokeMock = vi.mocked(invoke)

function makeChangeSet(): ChangeSet {
  return {
    id: 'changeset-1',
    timestamp: Date.now(),
    filePath: 'stories/chapter-01.md',
    modifications: [
      {
        id: 'insert-intro',
        type: 'add',
        lineStart: 1,
        lineEnd: 1,
        modifiedText: 'intro',
        status: 'pending',
      },
      {
        id: 'fix-ending',
        type: 'modify',
        lineStart: 3,
        lineEnd: 3,
        originalText: 'gamma',
        modifiedText: 'GAMMA',
        status: 'pending',
      },
    ],
    stats: { additions: 2, deletions: 1 },
    status: 'pending',
  }
}

describe('ModificationService', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('replays accepted modifications from the original snapshot', async () => {
    const originalContent = 'alpha\nbeta\ngamma'
    let currentContent = originalContent
    const writes: string[] = []

    invokeMock.mockImplementation(async (command, args) => {
      if (command === 'read_text') {
        return currentContent
      }
      if (command === 'write_text') {
        currentContent = String((args as { content: string }).content)
        writes.push(currentContent)
        return undefined
      }
      throw new Error(`Unexpected command: ${String(command)}`)
    })

    const service = new ModificationService()
    const changeSet = makeChangeSet()
    service.registerImportedChangeSet(changeSet, originalContent)

    await service.acceptModification(changeSet.id, 'insert-intro')
    await service.acceptModification(changeSet.id, 'fix-ending')

    expect(writes).toEqual([
      'intro\nalpha\nbeta\ngamma',
      'intro\nalpha\nbeta\nGAMMA',
    ])
    expect(service.getChangeSet(changeSet.id)?.status).toBe('accepted')
  })

  it('rejects applying suggestions when the file changed externally', async () => {
    const originalContent = 'one\ntwo'
    let currentContent = 'one\nchanged by user'

    invokeMock.mockImplementation(async (command) => {
      if (command === 'read_text') {
        return currentContent
      }
      if (command === 'write_text') {
        throw new Error('write_text should not run when the file is out of sync')
      }
      throw new Error(`Unexpected command: ${String(command)}`)
    })

    const service = new ModificationService()
    const changeSet = makeChangeSet()
    service.registerImportedChangeSet(
      {
        ...changeSet,
        modifications: [
          {
            id: 'change-line-2',
            type: 'modify',
            lineStart: 2,
            lineEnd: 2,
            originalText: 'two',
            modifiedText: 'TWO',
            status: 'pending',
          },
        ],
        stats: { additions: 1, deletions: 1 },
      },
      originalContent,
    )

    await expect(service.acceptAll(changeSet.id)).rejects.toThrow('changed since the AI suggestion was created')
    expect(currentContent).toBe('one\nchanged by user')
  })
})
