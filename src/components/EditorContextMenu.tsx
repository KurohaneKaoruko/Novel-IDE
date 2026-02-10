import React, { useEffect, useRef } from 'react';
import './EditorContextMenu.css';

export interface EditorContextMenuProps {
  x: number;
  y: number;
  selectedText: string;
  onPolish: () => void;
  onExpand: () => void;
  onCondense: () => void;
  onClose: () => void;
}

/**
 * Context menu component for editor AI assistance features
 * Displays when user right-clicks on selected text in the editor
 */
export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  x,
  y,
  selectedText,
  onPolish,
  onExpand,
  onCondense,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust menu position to stay within viewport
  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = x;
    let adjustedY = y;

    // Adjust horizontal position if menu goes off-screen
    if (x + rect.width > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    // Adjust vertical position if menu goes off-screen
    if (y + rect.height > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    menu.style.left = `${adjustedX}px`;
    menu.style.top = `${adjustedY}px`;
  }, [x, y]);

  const handlePolish = () => {
    onPolish();
    onClose();
  };

  const handleExpand = () => {
    onExpand();
    onClose();
  };

  const handleCondense = () => {
    onCondense();
    onClose();
  };

  // Don't show menu if no text is selected
  if (!selectedText || selectedText.trim().length === 0) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="editor-context-menu-header">
        AI 辅助编辑
      </div>
      <div className="editor-context-menu-items">
        <button
          className="editor-context-menu-item"
          onClick={handlePolish}
          title="使用 AI 润色选中的文本，提升文字质量"
        >
          <span className="menu-icon">✨</span>
          <span className="menu-label">AI 润色</span>
        </button>
        <button
          className="editor-context-menu-item"
          onClick={handleExpand}
          title="使用 AI 扩写选中的文本，增加更多细节"
        >
          <span className="menu-icon">📝</span>
          <span className="menu-label">AI 扩写</span>
        </button>
        <button
          className="editor-context-menu-item"
          onClick={handleCondense}
          title="使用 AI 缩写选中的文本，使其更简洁"
        >
          <span className="menu-icon">✂️</span>
          <span className="menu-label">AI 缩写</span>
        </button>
      </div>
    </div>
  );
};

export default EditorContextMenu;
