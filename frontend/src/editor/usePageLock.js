import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, isDemoMode } from '../api/client.js';
import { can } from '../auth/capabilities.js';

export function usePageLock(pageId, user) {
  const editable = can(user, 'edit');
  const [lock, setLock] = useState({
    locked: false,
    isOwner: false,
    readOnly: !editable,
  });
  const [error, setError] = useState('');
  const ownsLock = useRef(false);

  useEffect(() => {
    ownsLock.current = Boolean(lock.isOwner);
  }, [lock.isOwner]);

  const acquire = useCallback(async (force = false) => {
    if (!pageId || !editable) return null;
    try {
      const result = await api.pages.lock(pageId, force);
      setLock(result);
      setError('');
      return result;
    } catch (nextError) {
      if (
        nextError instanceof ApiError
        && nextError.status === 409
        && ['page_locked', 'conflict'].includes(nextError.data?.code)
      ) {
        setLock({
          locked: true,
          isOwner: false,
          readOnly: true,
          warning: nextError.message,
          lockedBy: nextError.data?.details?.lockedBy,
        });
        setError(nextError.message);
        return null;
      }
      setError(nextError.message);
      throw nextError;
    }
  }, [editable, pageId]);

  useEffect(() => {
    let active = true;
    if (!pageId) return undefined;
    const initialize = editable ? acquire() : api.pages.getLock(pageId).then((result) => {
      if (active) setLock({ ...result, readOnly: true });
    });
    Promise.resolve(initialize).catch((nextError) => active && setError(nextError.message));
    return () => { active = false; };
  }, [acquire, editable, pageId]);

  useEffect(() => {
    if (!pageId || !editable || !lock.isOwner) return undefined;
    const interval = setInterval(() => {
      api.pages.heartbeat(pageId)
        .then(setLock)
        .catch((nextError) => {
          setLock((current) => ({ ...current, readOnly: true, isOwner: false }));
          setError(nextError.message);
        });
    }, 45_000);
    return () => clearInterval(interval);
  }, [editable, lock.isOwner, pageId]);

  useEffect(() => () => {
    if (pageId && editable && ownsLock.current && !isDemoMode) {
      api.pages.unlock(pageId).catch(() => {});
    }
  }, [editable, pageId]);

  return {
    lock,
    error,
    forceAcquire: () => acquire(true),
  };
}

