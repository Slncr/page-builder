import { useEffect } from 'react';
import { useBuilderStore } from '../store/builderStore.js';

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || Boolean(target.closest('[role="textbox"]'))
  );
}

export function useEditorShortcuts(onSave, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      const mod = event.metaKey || event.ctrlKey;
      const state = useBuilderStore.getState();

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) state.redo();
        else state.undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        state.redo();
      } else if (mod && event.key.toLowerCase() === 'd' && state.selectedId) {
        event.preventDefault();
        state.duplicateBlock(state.selectedId);
      } else if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && state.selectedId) {
        event.preventDefault();
        const block = state.byId[state.selectedId];
        const siblings = block.parentId
          ? state.childrenByParent[block.parentId] || []
          : state.rootOrder;
        const currentIndex = siblings.indexOf(block.id);
        const nextIndex = currentIndex + (event.key === 'ArrowUp' ? -1 : 1);
        if (nextIndex >= 0 && nextIndex < siblings.length) {
          state.moveBlock(block.id, block.parentId, nextIndex);
        }
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && state.selectedId) {
        event.preventDefault();
        state.removeBlock(state.selectedId);
      } else if (event.key === 'Escape') {
        state.selectBlock(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onSave]);
}
