export function appendStreamTextWithOverlap(existing: string, incoming: string): { next: string; appended: string } {
  if (!incoming) return { next: existing, appended: '' }
  if (!existing) return { next: incoming, appended: incoming }
  if (existing.endsWith(incoming)) return { next: existing, appended: '' }

  const maxOverlap = Math.min(existing.length, incoming.length, 4096)
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(existing.length - overlap) === incoming.slice(0, overlap)) {
      const appended = incoming.slice(overlap)
      return appended ? { next: `${existing}${appended}`, appended } : { next: existing, appended: '' }
    }
  }
  return { next: `${existing}${incoming}`, appended: incoming }
}

export function formatElapsedLabel(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
  if (safe < 60) return `${safe}s`
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}m ${secs}s`
}

