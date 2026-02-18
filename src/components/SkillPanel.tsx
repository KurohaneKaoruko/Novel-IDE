'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSkills, getSkillCategories, getSkillsByCategory, applySkill, type Skill } from '../tauri'
import './SkillPanel.css'

type SkillPanelProps = {
  isOpen: boolean
  onClose: () => void
  onApplySkill: (skillId: string, content: string) => Promise<string>
  currentContent?: string
}

export function SkillPanel({ isOpen, onClose, onApplySkill, currentContent = '' }: SkillPanelProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    loadSkills()
  }, [isOpen])

  const loadSkills = async () => {
    try {
      const [allSkills, allCategories] = await Promise.all([
        getSkills(),
        getSkillCategories()
      ])
      setSkills(allSkills)
      setCategories(allCategories)
    } catch (error) {
      console.error('Failed to load skills:', error)
    }
  }

  const filteredSkills = selectedCategory === 'all' 
    ? skills 
    : skills.filter(s => s.category === selectedCategory)

  const handleApply = async () => {
    if (!selectedSkill || !currentContent) return
    setApplying(true)
    try {
      const result = await onApplySkill(selectedSkill.id, currentContent)
      onClose()
    } catch (error) {
      console.error('Failed to apply skill:', error)
    } finally {
      setApplying(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="skill-overlay" onClick={onClose}>
      <div className="skill-panel" onClick={(e) => e.stopPropagation()}>
        <div className="skill-header">
          <h2>技能市场</h2>
          <button className="skill-close" onClick={onClose}>×</button>
        </div>

        <div className="skill-content">
          {/* Categories */}
          <div className="skill-categories">
            <button 
              className={`skill-category ${selectedCategory === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedCategory('all')}
            >
              全部
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                className={`skill-category ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Skills List */}
          <div className="skill-list">
            {filteredSkills.map(skill => (
              <div
                key={skill.id}
                className={`skill-item ${selectedSkill?.id === skill.id ? 'selected' : ''}`}
                onClick={() => setSelectedSkill(skill)}
              >
                <div className="skill-name">{skill.name}</div>
                <div className="skill-desc">{skill.description}</div>
              </div>
            ))}
          </div>

          {/* Skill Detail */}
          {selectedSkill && (
            <div className="skill-detail">
              <div className="skill-detail-header">
                <div className="skill-detail-name">{selectedSkill.name}</div>
                <div className="skill-detail-category">{selectedSkill.category}</div>
              </div>
              <div className="skill-detail-desc">{selectedSkill.description}</div>
              <div className="skill-detail-preview">
                <div className="skill-preview-label">技能提示：</div>
                <div className="skill-preview-content">{selectedSkill.prompt.slice(0, 200)}...</div>
              </div>
              <button 
                className="skill-apply-btn"
                disabled={!currentContent || applying}
                onClick={handleApply}
              >
                {applying ? '应用中...' : '应用技能'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
