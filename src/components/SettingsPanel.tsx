'use client'

import './SettingsPanel.css'

export type Theme = 'light' | 'dark' | 'system'

type SettingsPanelProps = {
  isOpen: boolean
  onClose: () => void
  theme: Theme
  onThemeChange: (theme: Theme) => void
}

export function SettingsPanel({ isOpen, onClose, theme, onThemeChange }: SettingsPanelProps) {
  if (!isOpen) return null

  return (
    <div className="settings-panel-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel-header">
          <h2>设置</h2>
          <button className="settings-panel-close" onClick={onClose}>×</button>
        </div>
        
        <div className="settings-panel-content">
          {/* Appearance Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">外观</h3>
            
            <div className="settings-item">
              <div className="settings-item-label">
                <span className="settings-item-icon">🎨</span>
                <span>主题</span>
              </div>
              <div className="settings-item-control">
                <select
                  value={theme}
                  onChange={(e) => onThemeChange(e.target.value as Theme)}
                  className="settings-select"
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="system">跟随系统</option>
                </select>
              </div>
            </div>
          </div>

          {/* Editor Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">编辑器</h3>
            
            <div className="settings-item">
              <div className="settings-item-label">
                <span className="settings-item-icon">📝</span>
                <span>字体大小</span>
              </div>
              <div className="settings-item-control">
                <input
                  type="number"
                  min="10"
                  max="24"
                  defaultValue={14}
                  className="settings-input"
                />
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-label">
                <span className="settings-item-icon">↩️</span>
                <span>自动保存</span>
              </div>
              <div className="settings-item-control">
                <label className="settings-toggle">
                  <input type="checkbox" defaultChecked />
                  <span className="settings-toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

          {/* Shortcuts Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">快捷键</h3>
            
            <div className="shortcuts-list">
              <div className="shortcut-item">
                <span className="shortcut-desc">保存文件</span>
                <kbd className="shortcut-key">Ctrl + S</kbd>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-desc">命令面板</span>
                <kbd className="shortcut-key">Ctrl + Shift + P</kbd>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-desc">AI 对话</span>
                <kbd className="shortcut-key">Ctrl + Shift + L</kbd>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-desc">切换侧边栏</span>
                <kbd className="shortcut-key">Ctrl + B</kbd>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-desc">新建章节</span>
                <kbd className="shortcut-key">Ctrl + N</kbd>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="settings-section">
            <h3 className="settings-section-title">关于</h3>
            <div className="settings-about">
              <p><strong>Novel-IDE</strong></p>
              <p>版本 0.0.0</p>
              <p className="settings-about-desc">本地小说创作IDE，支持AI辅助写作</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
