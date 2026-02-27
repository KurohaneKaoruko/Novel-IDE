import React, { useState, useEffect, useCallback } from 'react';
import { characterService, type Character, type CharacterData } from '../services';
import { CharacterCard } from './CharacterCard';
import './CharacterManager.css';

export interface CharacterManagerProps {
  onCharacterClick?: (character: Character) => void;
}

/**
 * CharacterManager Component
 * Displays all character cards in grid or list view
 * Supports search, filtering, create, edit, and delete operations
 */
export const CharacterManager: React.FC<CharacterManagerProps> = ({
  onCharacterClick,
}) => {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<Character[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCharacterData, setNewCharacterData] = useState<CharacterData>({
    name: '',
  });

  // Load characters on mount
  useEffect(() => {
    loadCharacters();
  }, []);

  // Filter characters when search query or characters change
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredCharacters(characters);
      return;
    }

    const performSearch = async () => {
      try {
        const results = await characterService.searchCharacters(searchQuery);
        setFilteredCharacters(results);
      } catch (err) {
        console.error('Search failed:', err);
        setFilteredCharacters(characters);
      }
    };

    performSearch();
  }, [searchQuery, characters]);

  const loadCharacters = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedCharacters = await characterService.listCharacters();
      setCharacters(loadedCharacters);
      setFilteredCharacters(loadedCharacters);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleCreateCharacter = useCallback(async () => {
    if (!newCharacterData.name.trim()) {
      setError('人物姓名不能为空');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await characterService.createCharacter(newCharacterData);
      await loadCharacters();
      setShowCreateForm(false);
      setNewCharacterData({ name: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [newCharacterData, loadCharacters]);

  const handleUpdateCharacter = useCallback(
    async (id: string, data: Partial<CharacterData>) => {
      setIsLoading(true);
      setError(null);
      try {
        await characterService.updateCharacter(id, data);
        await loadCharacters();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [loadCharacters]
  );

  const handleDeleteCharacter = useCallback(
    async (id: string) => {
      setIsLoading(true);
      setError(null);
      try {
        await characterService.deleteCharacter(id);
        await loadCharacters();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [loadCharacters]
  );

  const handleCancelCreate = useCallback(() => {
    setShowCreateForm(false);
    setNewCharacterData({ name: '' });
    setError(null);
  }, []);

  const handleNewCharacterFieldChange = useCallback(
    (field: keyof CharacterData, value: string) => {
      setNewCharacterData((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  return (
    <div className="character-manager">
      <div className="character-manager-header">
        <h2 className="character-manager-title">人物管理</h2>
        <div className="character-manager-stats">
          共 {characters.length} 个人物
        </div>
      </div>

      <div className="character-manager-toolbar">
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder="搜索人物..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              title="清除搜索"
            >
              ✕
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          <div className="view-mode-toggle">
            <button
              className={`view-mode-button ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="网格视图"
            >
              ⊞
            </button>
            <button
              className={`view-mode-button ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="列表视图"
            >
              ☰
            </button>
          </div>

          <button
            className="create-button"
            onClick={() => setShowCreateForm(true)}
            disabled={isLoading}
          >
            ＋ 新建人物
          </button>
        </div>
      </div>

      {error && (
        <div className="character-manager-error">
          <span className="error-icon">⚠️</span>
          {error}
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="create-character-form">
          <div className="form-header">
            <h3>新建人物</h3>
            <button
              className="form-close"
              onClick={handleCancelCreate}
            >
              ✕
            </button>
          </div>
          <div className="form-body">
            <div className="form-field">
              <label htmlFor="new-character-name">
                姓名 <span className="required">*</span>
              </label>
              <input
                id="new-character-name"
                type="text"
                className="form-input"
                value={newCharacterData.name}
                onChange={(e) =>
                  handleNewCharacterFieldChange('name', e.target.value)
                }
                placeholder="请输入人物姓名"
                autoFocus
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-appearance">外貌</label>
              <textarea
                id="new-character-appearance"
                className="form-textarea"
                value={newCharacterData.appearance || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('appearance', e.target.value)
                }
                placeholder="请输入外貌描述"
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-personality">性格</label>
              <textarea
                id="new-character-personality"
                className="form-textarea"
                value={newCharacterData.personality || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('personality', e.target.value)
                }
                placeholder="请输入性格描述"
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-background">背景</label>
              <textarea
                id="new-character-background"
                className="form-textarea"
                value={newCharacterData.background || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('background', e.target.value)
                }
                placeholder="请输入背景故事"
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-relationships">关系</label>
              <textarea
                id="new-character-relationships"
                className="form-textarea"
                value={newCharacterData.relationships || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('relationships', e.target.value)
                }
                placeholder="请输入人物关系"
                rows={3}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-notes">备注</label>
              <textarea
                id="new-character-notes"
                className="form-textarea"
                value={newCharacterData.notes || ''}
                onChange={(e) =>
                  handleNewCharacterFieldChange('notes', e.target.value)
                }
                placeholder="请输入备注信息"
                rows={3}
              />
            </div>
          </div>
          <div className="form-footer">
            <button
              className="form-button form-button-cancel"
              onClick={handleCancelCreate}
              disabled={isLoading}
            >
              取消
            </button>
            <button
              className="form-button form-button-submit"
              onClick={handleCreateCharacter}
              disabled={isLoading || !newCharacterData.name.trim()}
            >
              {isLoading ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {isLoading && !showCreateForm && (
        <div className="character-manager-loading">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      )}

      {!isLoading && filteredCharacters.length === 0 && !showCreateForm && (
        <div className="character-manager-empty">
          {searchQuery ? (
            <>
              <p>未找到匹配的人物</p>
              <button
                className="empty-action"
                onClick={() => setSearchQuery('')}
              >
                清除搜索
              </button>
            </>
          ) : (
            <>
              <p>还没有创建任何人物</p>
              <button
                className="empty-action"
                onClick={() => setShowCreateForm(true)}
              >
                创建第一个人物
              </button>
            </>
          )}
        </div>
      )}

      {!isLoading && filteredCharacters.length > 0 && (
        <div className={`character-list ${viewMode}`}>
          {filteredCharacters.map((character) => (
            <div
              key={character.id}
              className="character-list-item"
              onClick={() => onCharacterClick?.(character)}
            >
              <CharacterCard
                character={character}
                onUpdate={handleUpdateCharacter}
                onDelete={handleDeleteCharacter}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
