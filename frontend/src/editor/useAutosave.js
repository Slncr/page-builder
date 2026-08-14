import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client.js';
import { useBuilderStore } from '../store/builderStore.js';

export function useAutosave(pageId, delay = 1200) {
  const dirty = useBuilderStore((state) => state.dirty);
  const baseVersion = useBuilderStore((state) => state.baseVersion);
  const conflict = useBuilderStore((state) => state.conflict);
  const revision = useBuilderStore((state) => state.history.past.length);
  const serialize = useBuilderStore((state) => state.serialize);
  const setSaveState = useBuilderStore((state) => state.setSaveState);
  const markSaved = useBuilderStore((state) => state.markSaved);
  const setConflict = useBuilderStore((state) => state.setConflict);
  const loadPage = useBuilderStore((state) => state.loadPage);
  const [error, setError] = useState('');
  const [lockLost, setLockLost] = useState(false);
  const inFlight = useRef(null);

  const saveNow = useCallback(async ({ force = false } = {}) => {
    if (!pageId || (!dirty && !force)) return null;
    if (inFlight.current) return inFlight.current;
    const savedDocument = serialize();
    setSaveState('saving');
    setError('');
    setLockLost(false);
    const operation = api.pages.save(pageId, {
      baseVersion: force ? (conflict?.currentVersion || conflict?.details?.currentVersion || baseVersion) : baseVersion,
      force,
      page: savedDocument,
    }).then((page) => {
      markSaved(page, savedDocument);
      return page;
    }).catch((nextError) => {
      if (
        nextError instanceof ApiError
        && nextError.status === 409
        && !['page_locked', 'lock_lost'].includes(nextError.data?.code)
      ) {
        setConflict(nextError.data || { message: nextError.message });
      } else {
        if (['page_locked', 'lock_lost'].includes(nextError.data?.code)) setLockLost(true);
        setSaveState('error');
        setError(nextError.message || 'Не удалось выполнить автосохранение.');
      }
      throw nextError;
    }).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = operation;
    return operation;
  }, [baseVersion, conflict, dirty, markSaved, pageId, serialize, setConflict, setSaveState]);

  useEffect(() => {
    if (!dirty || conflict || !pageId) return undefined;
    const timeout = setTimeout(() => {
      saveNow().catch(() => {});
    }, delay);
    return () => clearTimeout(timeout);
  }, [conflict, delay, dirty, pageId, revision, saveNow]);

  return {
    error,
    lockLost,
    saveNow,
    forceSave: () => saveNow({ force: true }),
    async reloadServer() {
      const serverPage = conflict?.serverPage || await api.pages.get(pageId);
      loadPage(serverPage);
    },
  };
}
