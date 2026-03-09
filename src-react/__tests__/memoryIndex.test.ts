import { describe, expect, it } from 'vitest'

import { parseMemoryIndexDocument, serializeMemoryIndexDocument } from '../src/services/memoryIndex'

describe('memoryIndex', () => {
  it('serializes metadata and body together', () => {
    const raw = serializeMemoryIndexDocument('# Character State Index\n\n- Alice: suspicious', {
      source: 'manual',
      locked: true,
      updatedAt: '2026-03-09T00:00:00.000Z',
    })

    expect(raw).toContain('source: manual')
    expect(raw).toContain('locked: true')
    expect(raw).toContain('updated_at: 2026-03-09T00:00:00.000Z')
    expect(raw).toContain('- Alice: suspicious')
  })

  it('parses metadata and body from front matter', () => {
    const parsed = parseMemoryIndexDocument([
      '---',
      'source: manual',
      'locked: true',
      'updated_at: 2026-03-09T00:00:00.000Z',
      '---',
      '',
      '# Foreshadow Index',
      '',
      '- The missing key is unresolved',
    ].join('\n'))

    expect(parsed.meta).toEqual({
      source: 'manual',
      locked: true,
      updatedAt: '2026-03-09T00:00:00.000Z',
    })
    expect(parsed.body).toContain('# Foreshadow Index')
  })

  it('falls back to auto defaults when metadata is missing', () => {
    const parsed = parseMemoryIndexDocument('# Character State Index\n\n- Alice: alert')

    expect(parsed.meta.source).toBe('auto')
    expect(parsed.meta.locked).toBe(false)
    expect(parsed.body).toContain('Alice: alert')
  })
})
