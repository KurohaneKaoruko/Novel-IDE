import React, { useState } from 'react';
import type { Character, CharacterData } from '../services';
import './CharacterCard.css';

export interface CharacterCardProps {
  character: Character;
  onUpdate?: (id: string, data: Partial<CharacterData>) => void;
  onDelete?: (id: string) => void;
  initialMode?: 'view' | 'edit';
}

/**
 * CharacterCard Component
 * Displays character information in card format
 * Supports view mode and edit mode switching
 */
export const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  onUpdate,
  onDelete,
  initialMode = 'view',
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [editData, setEditData] = useState<CharacterData>(character.data);
  const [isSaving, setIsSaving] = useState(false);

  const handleEdit = () => {
    setEditData(character.data);
    setMode('edit');
  };

  const handleCancel = () => {
    setEditData(character.data);
    setMode('view');
  };

  const handleSave = async () => {
    if (!onUpdate) return;

    try {
      setIsSaving(true);
      await onUpdate(character.id, editData);
      setMode('view');
    } catch (error) {
      console.error('Failed to save character:', error);
      // Keep in edit mode on error
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!onDelete) return;
    
    if (window.confirm(`确定要删除人物 "${character.name}" 吗？`)) {
      onDelete(character.id);
    }
  };

  const handleFieldChange = (field: keyof CharacterData, value: string) => {
    setEditData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const renderField = (
    label: string,
    field: keyof CharacterData,
    multiline: boolean = false
  ) => {
    const value = character.data[field] || '';
    const editValue = editData[field] || '';

    if (mode === 'view') {
      return (
        <div className="character-field">
          <div className="field-label">{label}</div>
          <div className="field-value">
            {value || <span className="field-empty">未填写</span>}
          </div>
        </div>
      );
    }

    return (
      <div className="character-field">
        <label className="field-label" htmlFor={`${character.id}-${field}`}>
          {label}
        </label>
        {multiline ? (
          <textarea
            id={`${character.id}-${field}`}
            className="field-input field-textarea"
            value={editValue}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            placeholder={`请输入${label}`}
            rows={4}
          />
        ) : (
          <input
            id={`${character.id}-${field}`}
            type="text"
            className="field-input"
            value={editValue}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            placeholder={`请输入${label}`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="character-card">
      <div className="character-card-header">
        <h3 className="character-name">{character.name}</h3>
        <div className="character-actions">
          {mode === 'view' ? (
            <>
              <button
                className="action-button action-edit"
                onClick={handleEdit}
                title="编辑"
              >
                ✏️
              </button>
              {onDelete && (
                <button
                  className="action-button action-delete"
                  onClick={handleDelete}
                  title="删除"
                >
                  🗑️
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="action-button action-save"
                onClick={handleSave}
                disabled={isSaving}
                title="保存"
              >
                {isSaving ? '⏳' : '💾'}
              </button>
              <button
                className="action-button action-cancel"
                onClick={handleCancel}
                disabled={isSaving}
                title="取消"
              >
                ❌
              </button>
            </>
          )}
        </div>
      </div>

      <div className="character-card-body">
        {renderField('姓名', 'name')}
        {renderField('外貌', 'appearance', true)}
        {renderField('性格', 'personality', true)}
        {renderField('背景', 'background', true)}
        {renderField('关系', 'relationships', true)}
        {renderField('备注', 'notes', true)}
      </div>
    </div>
  );
};
