import { useMemo, useState } from 'react'
import type { LaunchMode, ProjectItem, ProjectSource } from '../tauri'
import { AppIcon } from './icons/AppIcon'
import './ProjectPickerPage.css'

type ProjectPickerPageProps = {
  busy: boolean
  error: string | null
  defaultRoot: string
  defaultProjects: ProjectItem[]
  externalProjects: ProjectItem[]
  lastWorkspace: string | null
  launchMode: LaunchMode
  onSelectProject: (path: string, source: ProjectSource) => void
  onLoadExternalProject: () => void
  onForgetExternalProject: (path: string) => void
  onRefresh: () => void
  onLaunchModeChange: (mode: LaunchMode) => void
  manualPathEnabled?: boolean
  onOpenManualPath?: (path: string) => void
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onForget,
}: {
  project: ProjectItem
  busy: boolean
  onOpen: (path: string, source: ProjectSource) => void
  onForget?: (path: string) => void
}) {
  return (
    <div className="project-card">
      <button className="project-card-main" disabled={busy} onClick={() => onOpen(project.path, project.source)}>
        <div className="project-card-title-row">
          <strong className="project-card-title">{project.name}</strong>
          <span className={`project-badge ${project.is_valid_workspace ? 'ok' : 'warn'}`}>
            {project.is_valid_workspace ? '可用' : '待初始化'}
          </span>
        </div>
        <div className="project-card-path" title={project.path}>
          {project.path}
        </div>
      </button>
      {onForget ? (
        <button className="project-card-forget" disabled={busy} onClick={() => onForget(project.path)} title="从外部项目列表移除">
          移除
        </button>
      ) : null}
    </div>
  )
}

export function ProjectPickerPage({
  busy,
  error,
  defaultRoot,
  defaultProjects,
  externalProjects,
  lastWorkspace,
  launchMode,
  onSelectProject,
  onLoadExternalProject,
  onForgetExternalProject,
  onRefresh,
  onLaunchModeChange,
  manualPathEnabled = false,
  onOpenManualPath,
}: ProjectPickerPageProps) {
  const [manualPath, setManualPath] = useState('')
  const allProjectsCount = defaultProjects.length + externalProjects.length

  const groupedStats = useMemo(
    () => ({
      default: defaultProjects.length,
      external: externalProjects.length,
    }),
    [defaultProjects.length, externalProjects.length],
  )

  return (
    <div className="project-picker-page">
      <div className="project-picker-bg" aria-hidden="true" />
      <div className="project-picker-shell">
        <header className="project-picker-header">
          <div className="project-picker-heading">
            <div className="project-picker-brand">
              <span className="project-picker-brand-icon">
                <AppIcon name="projectSwitch" size={14} />
              </span>
              <span>Novel-IDE</span>
            </div>
            <h1>选择项目</h1>
            <p>默认显示安装目录中的项目，你也可以按需载入外部项目。</p>
          </div>
          <div className="project-picker-header-actions">
            <button className="picker-button ghost" onClick={onRefresh} disabled={busy}>
              刷新列表
            </button>
            <button className="picker-button primary" onClick={onLoadExternalProject} disabled={busy}>
              载入外部项目
            </button>
          </div>
        </header>

        <section className="project-launch-mode">
          <label htmlFor="launch-mode">启动行为</label>
          <select
            id="launch-mode"
            value={launchMode}
            disabled={busy}
            onChange={(e) => onLaunchModeChange(e.target.value as LaunchMode)}
          >
            <option value="picker">总是进入项目选择页</option>
            <option value="auto_last">自动打开上次项目</option>
          </select>
          {lastWorkspace ? (
            <span className="project-last-workspace">上次项目：{lastWorkspace}</span>
          ) : (
            <span className="project-last-workspace">上次项目：无</span>
          )}
        </section>

        <section className="project-summary-grid">
          <article>
            <h3>默认项目</h3>
            <p>{groupedStats.default}</p>
          </article>
          <article>
            <h3>外部项目</h3>
            <p>{groupedStats.external}</p>
          </article>
          <article>
            <h3>项目总数</h3>
            <p>{allProjectsCount}</p>
          </article>
        </section>

        <section className="project-section">
          <div className="project-section-title-row">
            <h2>安装目录项目</h2>
            <span className="project-root" title={defaultRoot}>
              {defaultRoot}
            </span>
          </div>
          <div className="project-list">
            {defaultProjects.length === 0 ? (
              <div className="project-empty">未发现项目，请在安装目录下创建 `projects/你的项目`。</div>
            ) : (
              defaultProjects.map((project) => (
                <ProjectCard key={project.path} project={project} busy={busy} onOpen={onSelectProject} />
              ))
            )}
          </div>
        </section>

        <section className="project-section">
          <div className="project-section-title-row">
            <h2>外部项目</h2>
            <span className="project-root">仅在你点击“载入外部项目”后新增</span>
          </div>
          <div className="project-list">
            {externalProjects.length === 0 ? (
              <div className="project-empty">当前没有外部项目。</div>
            ) : (
              externalProjects.map((project) => (
                <ProjectCard
                  key={project.path}
                  project={project}
                  busy={busy}
                  onOpen={onSelectProject}
                  onForget={onForgetExternalProject}
                />
              ))
            )}
          </div>
        </section>

        {manualPathEnabled ? (
          <section className="project-section">
            <div className="project-section-title-row">
              <h2>手动路径</h2>
            </div>
            <div className="project-manual-row">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="输入项目目录绝对路径"
              />
              <button
                className="picker-button primary"
                disabled={busy || !manualPath.trim()}
                onClick={() => {
                  if (!onOpenManualPath) return
                  onOpenManualPath(manualPath.trim())
                }}
              >
                打开
              </button>
            </div>
          </section>
        ) : null}

        {error ? <div className="project-picker-error">{error}</div> : null}
      </div>
    </div>
  )
}
