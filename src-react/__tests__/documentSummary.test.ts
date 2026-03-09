import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildCharacterStateDigest,
  buildDocumentContextBlock,
  buildStoryCueDigest,
  buildStorySummaryIndex,
  clearDocumentSummaryCache,
  getDocumentSummary,
} from '../src/services/documentSummary'

describe('documentSummary', () => {
  beforeEach(() => {
    clearDocumentSummaryCache()
  })

  it('keeps short documents as full context blocks', () => {
    const content = '# Chapter One\n\nA short opening scene.'
    const block = buildDocumentContextBlock('current file stories/chapter-01.md', 'stories/chapter-01.md', content, {
      fullTextThreshold: 100,
    })

    expect(block).toContain(content)
    expect(block).not.toContain('opening:')
  })

  it('summarizes long documents with stable metadata', () => {
    const content = ['# Chapter One', '', 'The heroine arrives at the ruined observatory and discovers the first clue.', '', '## Midpoint', '', 'A revelation changes the stakes for everyone.', '', 'The scene ends with a promise of danger in the next chapter.']
      .join('\n')
      .repeat(20)

    const summary = getDocumentSummary('stories/chapter-01.md', content)
    const block = buildDocumentContextBlock('file stories/chapter-01.md', 'stories/chapter-01.md', content)

    expect(summary.title).toBe('Chapter One')
    expect(summary.headings).toContain('Midpoint')
    expect(block).toContain('title: Chapter One')
    expect(block).toContain('opening:')
    expect(block).toContain('[excerpt:start]')
  })

  it('builds a compact story summary index for multiple chapters', () => {
    const index = buildStorySummaryIndex([
      {
        path: 'stories/chapter-01.md',
        content: '# Chapter One\n\nThe heroine arrives at the ruined observatory and finds the first clue.',
      },
      {
        path: 'stories/chapter-02.md',
        content: '# Chapter Two\n\nThe rival appears and raises the stakes for the expedition.',
      },
    ])

    expect(index).toContain('[story summary index]')
    expect(index).toContain('stories/chapter-01.md')
    expect(index).toContain('Chapter One')
    expect(index).toContain('stories/chapter-02.md')
  })

  it('builds a recent character state digest from character list and chapter text', () => {
    const digest = buildCharacterStateDigest(
      ['- Alice', '- Bob'].join('\n'),
      [
        { path: 'stories/chapter-01.md', content: 'Alice returns to the ruined tower and hides the map from Bob.' },
        { path: 'stories/chapter-02.md', content: 'Bob realizes Alice is keeping secrets and decides to follow her at dawn.' },
      ],
    )

    expect(digest).toContain('[character state digest]')
    expect(digest).toContain('Alice:')
    expect(digest).toContain('Bob:')
  })

  it('builds a recent cue digest from chapter summaries', () => {
    const digest = buildStoryCueDigest([
      { path: 'stories/chapter-01.md', content: '# One\n\nA clue appears.\n\nThe chapter ends with the key going missing.' },
      { path: 'stories/chapter-02.md', content: '# Two\n\nTension rises.\n\nThe rival finally reaches the observatory gates.' },
    ])

    expect(digest).toContain('[recent cue digest]')
    expect(digest).toContain('stories/chapter-01.md')
    expect(digest).toContain('stories/chapter-02.md')
  })
})
