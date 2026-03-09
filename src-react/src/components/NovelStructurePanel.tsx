import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { FsEntry } from '../tauri'
import { useI18n } from '../i18n'
import { AppIcon } from './icons/AppIcon'
import './NovelStructurePanel.css'

type NovelStructurePanelProps = {
  workRoot: string | null
  tree: FsEntry | null
  activePath: string | null
  busy: boolean
  error: string | null
  onRefresh: () => void
  onOpenPath: (path: string) => void
  onNewChapter: () => void
  onNewOutline: () => void
  onNewConceptNote: () => void
  onOpenMasterPlan: () => void
  onOpenProjectPicker: () => void
  onDeletePath?: (path: string) => void
}

type SectionKey = 'chapters' | 'outline' | 'concept' | 'plans'

type SectionItem = {
  path: string
  label: string
}

type SectionCollection = Record<SectionKey, SectionItem[]>

type CollapsedState = Record<SectionKey, boolean>

type ItemContextMenuState = {
  x: number
  y: number
  item: SectionItem
} | null

function collectFiles(node: FsEntry | null): FsEntry[] {
  if (!node) return []
  if (node.kind === 'file') return [node]
  return node.children.flatMap((child) => collectFiles(child))
}

function findDir(node: FsEntry | null, name: string): FsEntry | null {
  if (!node || node.kind !== 'dir') return null
  return node.children.find((child) => child.kind === 'dir' && child.name === name) ?? null
}

function buildSectionItems(files: FsEntry[]): SectionItem[] {
  return files
    .filter((entry) => entry.kind === 'file')
    .map((entry) => ({
      path: entry.path,
      label: entry.name.replace(/\.[^.]+$/, ''),
    }))
}

function countLabel(visible: number, total: number, filtered: boolean): string {
  return filtered ? `${visible}/${total}` : String(total)
}

export function NovelStructurePanel({
  workRoot,
  tree,
  activePath,
  busy,
  error,
  onRefresh,
  onOpenPath,
  onNewChapter,
  onNewOutline,
  onNewConceptNote,
  onOpenMasterPlan,
  onOpenProjectPicker,
  onDeletePath,
}: NovelStructurePanelProps) {
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<CollapsedState>({
    chapters: false,
    outline: false,
    concept: false,
    plans: false,
  })
  const [itemContextMenu, setItemContextMenu] = useState<ItemContextMenuState>(null)

  const workspaceName = useMemo(() => {
    if (!workRoot) return t('structure.workspaceDefaultName')
    const parts = workRoot.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? t('structure.workspaceDefaultName')
  }, [t, workRoot])

  const sections = useMemo<SectionCollection>(() => {
    const chapterFiles = collectFiles(findDir(tree, 'stories'))
    const outlineFiles = collectFiles(findDir(tree, 'outline'))
    const conceptFiles = collectFiles(findDir(tree, 'concept'))
    const planFiles = collectFiles(findDir(findDir(tree, '.novel'), 'plans'))

    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    const sortItems = (items: SectionItem[]) => [...items].sort((a, b) => collator.compare(a.label, b.label))

    return {
      chapters: sortItems(buildSectionItems(chapterFiles)),
      outline: sortItems(buildSectionItems(outlineFiles)),
      concept: sortItems(buildSectionItems(conceptFiles)),
      plans: sortItems(buildSectionItems(planFiles)),
    }
  }, [locale, tree])

  const activePathKey = useMemo(() => {
    if (!activePath) return null
    return activePath.replaceAll('\\', '/').toLowerCase()
  }, [activePath])

  const queryKey = useMemo(() => query.trim().toLowerCase(), [query])

  const filteredSections = useMemo<SectionCollection>(() => {
    if (!queryKey) return sections
    const filterItems = (items: SectionItem[]) =>
      items.filter((item) => item.label.toLowerCase().includes(queryKey) || item.path.toLowerCase().includes(queryKey))

    return {
      chapters: filterItems(sections.chapters),
      outline: filterItems(sections.outline),
      concept: filterItems(sections.concept),
      plans: filterItems(sections.plans),
    }
  }, [queryKey, sections])

  const filteredMode = queryKey.length > 0

  const isActiveItem = (path: string): boolean => {
    return activePathKey === path.replaceAll('\\', '/').toLowerCase()
  }

  const toggleSection = (key: SectionKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    if (!itemContextMenu) return
    const onWindowClick = () => setItemContextMenu(null)
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setItemContextMenu(null)
      }
    }
    window.addEventListener('click', onWindowClick)
    window.addEventListener('keydown', onWindowKeyDown)
    return () => {
      window.removeEventListener('click', onWindowClick)
      window.removeEventListener('keydown', onWindowKeyDown)
    }
  }, [itemContextMenu])

  const onItemContextMenu = (event: MouseEvent<HTMLButtonElement>, item: SectionItem) => {
    event.preventDefault()
    event.stopPropagation()
    setItemContextMenu({
      x: event.clientX,
      y: event.clientY,
      item,
    })
  }

  if (!workRoot) {
    return (
      <div className="novel-structure-panel">
        <div className="novel-structure-empty">
          <h3>{t('structure.empty.noProjectTitle')}</h3>
          <p>{t('structure.empty.noProjectHint')}</p>
          <button className="primary-button" onClick={onOpenProjectPicker}>
            {t('structure.action.openProjectPicker')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="novel-structure-panel">
      <div className="novel-structure-header">
        <div className="novel-structure-title">
          <span className="novel-structure-icon"><AppIcon name="chapters" size={14} /></span>
          <strong>{workspaceName}</strong>
        </div>
        <div className="novel-structure-actions">
          <button className="icon-button" disabled={busy} title={t('structure.action.refresh')} onClick={onRefresh}>
            <AppIcon name="refresh" size={14} />
          </button>
          <button className="icon-button" disabled={busy} title={t('structure.action.newChapter')} onClick={onNewChapter}>
            <AppIcon name="add" size={14} />
          </button>
        </div>
      </div>

      {error ? <div className="novel-structure-error">{error}</div> : null}

      <div className="novel-structure-search-row">
        <input
          className="novel-structure-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('structure.searchPlaceholder')}
        />
      </div>

      <div className="novel-structure-sections">
        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('chapters')} title={t('structure.action.collapseExpand')}>
                {collapsed.chapters ? '+' : '-'}
              </button>
              <h4>{t('structure.section.chapters')}</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.chapters.length, sections.chapters.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewChapter} disabled={busy} title={t('structure.action.newChapter')}>
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.chapters ? (
            <div className="novel-structure-list">
              {filteredSections.chapters.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.chapters.length === 0 ? t('structure.empty.chapters') : t('structure.empty.chaptersFiltered')}
                </div>
              ) : (
                filteredSections.chapters.map((item, idx) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                    onContextMenu={(event) => onItemContextMenu(event, item)}
                  >
                    <span className="novel-structure-item-index">{idx + 1}</span>
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('outline')} title={t('structure.action.collapseExpand')}>
                {collapsed.outline ? '+' : '-'}
              </button>
              <h4>{t('structure.section.outline')}</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.outline.length, sections.outline.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewOutline} disabled={busy} title={t('structure.action.newOutline')}>
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.outline ? (
            <div className="novel-structure-list">
              {filteredSections.outline.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.outline.length === 0 ? t('structure.empty.outline') : t('structure.empty.outlineFiltered')}
                </div>
              ) : (
                filteredSections.outline.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                    onContextMenu={(event) => onItemContextMenu(event, item)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('concept')} title={t('structure.action.collapseExpand')}>
                {collapsed.concept ? '+' : '-'}
              </button>
              <h4>{t('structure.section.concept')}</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.concept.length, sections.concept.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onNewConceptNote} disabled={busy} title={t('structure.action.newConcept')}>
                <AppIcon name="add" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.concept ? (
            <div className="novel-structure-list">
              {filteredSections.concept.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.concept.length === 0 ? t('structure.empty.concept') : t('structure.empty.conceptFiltered')}
                </div>
              ) : (
                filteredSections.concept.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                    onContextMenu={(event) => onItemContextMenu(event, item)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>

        <section className="novel-structure-section">
          <div className="novel-structure-section-head">
            <div className="novel-structure-section-head-left">
              <button className="novel-structure-collapse-btn" onClick={() => toggleSection('plans')} title={t('structure.action.collapseExpand')}>
                {collapsed.plans ? '+' : '-'}
              </button>
              <h4>{t('structure.section.plans')}</h4>
            </div>
            <div className="novel-structure-section-head-right">
              <span>{countLabel(filteredSections.plans.length, sections.plans.length, filteredMode)}</span>
              <button className="novel-structure-section-action" onClick={onOpenMasterPlan} disabled={busy} title={t('structure.action.openMasterPlan')}>
                <AppIcon name="preview" size={12} />
              </button>
            </div>
          </div>
          {!collapsed.plans ? (
            <div className="novel-structure-list">
              {filteredSections.plans.length === 0 ? (
                <div className="novel-structure-empty-row">
                  {sections.plans.length === 0 ? t('structure.empty.plans') : t('structure.empty.plansFiltered')}
                </div>
              ) : (
                filteredSections.plans.map((item) => (
                  <button
                    key={item.path}
                    className={`novel-structure-item ${isActiveItem(item.path) ? 'active' : ''}`}
                    onClick={() => onOpenPath(item.path)}
                    onContextMenu={(event) => onItemContextMenu(event, item)}
                  >
                    <span className="novel-structure-item-label">{item.label}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </section>
      </div>
      {itemContextMenu ? (
        <div
          className="novel-structure-context-menu"
          style={{ left: itemContextMenu.x, top: itemContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="novel-structure-context-menu-item"
            onClick={() => {
              onOpenPath(itemContextMenu.item.path)
              setItemContextMenu(null)
            }}
          >
            {t('structure.context.open')}
          </button>
          <button
            className={`novel-structure-context-menu-item${busy || !onDeletePath ? ' disabled' : ''}`}
            disabled={busy || !onDeletePath}
            onClick={() => {
              if (!onDeletePath) return
              onDeletePath(itemContextMenu.item.path)
              setItemContextMenu(null)
            }}
          >
            {t('structure.context.delete')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

