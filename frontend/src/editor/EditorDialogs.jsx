import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { formatDateTime } from '../utils/display.js';

export function RevisionHistory({ pageId, open, onClose, onRestore, onRollback, canRollback }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState('');
  const closeButton = useRef(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => closeButton.current?.focus());
    setLoading(true);
    api.pages.history(pageId)
      .then((result) => setEntries(result.items || result))
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }, [open, pageId]);

  const restore = async (id) => {
    setRestoring(id);
    try {
      const page = await api.pages.restore(pageId, id);
      onRestore(page);
      onClose();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setRestoring('');
    }
  };

  if (!open) return null;
  return (
    <div className="pb-editor-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="pb-history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header><div><p className="pb-kicker">ВЕРСИИ</p><h2 id="history-title">История версий</h2></div><button ref={closeButton} className="pb-icon-button" onClick={onClose} aria-label="Закрыть историю">×</button></header>
        {error && <p className="pb-alert pb-alert--error">{error}</p>}
        {loading ? <div className="pb-empty-state">Загрузка версий…</div> : entries.length ? (
          <ol>
            {entries.map((entry) => (
              <li key={entry.id}>
                <div><strong>Версия {entry.version}</strong><small>{entry.label || 'Сохранённая версия'} · <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time></small></div>
                <div>
                  <button className="pb-secondary-button pb-secondary-button--small" type="button" onClick={() => restore(entry.id)} disabled={Boolean(restoring)}>{restoring === entry.id ? 'Восстановление…' : 'Восстановить черновик'}</button>
                  {canRollback && <button className="pb-secondary-button pb-secondary-button--small" type="button" onClick={() => onRollback(entry.id)}>Откатить публикацию</button>}
                </div>
              </li>
            ))}
          </ol>
        ) : <div className="pb-empty-state"><strong>Предыдущих версий нет</strong><p>Версии появятся после сохранения страницы.</p></div>}
      </aside>
    </div>
  );
}

export function PublishDialog({ warnings, open, onClose, onConfirm, publishing }) {
  const dialog = useRef(null);
  const errors = warnings.filter((warning) => warning.level === 'error');

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <dialog className="pb-dialog pb-publish-dialog" ref={dialog} onClose={onClose}>
      <div>
        <header><div><p className="pb-kicker">ПЕРЕД ПУБЛИКАЦИЕЙ</p><h2>{warnings.length ? 'Проверьте страницу' : 'Страница готова к публикации'}</h2></div><button type="button" className="pb-icon-button" onClick={onClose} aria-label="Закрыть">×</button></header>
        {warnings.length ? (
          <ul className="pb-publish-checks">
            {warnings.map((warning, index) => (
              <li className={`is-${warning.level}`} key={`${warning.message}-${index}`}><span aria-hidden="true">{warning.level === 'error' ? '!' : 'i'}</span>{warning.message}</li>
            ))}
          </ul>
        ) : <p className="pb-check-success">✓ Проверки доступности, контента и SEO пройдены.</p>}
        {errors.length > 0 && <p className="pb-alert pb-alert--error">Исправьте ошибки перед публикацией. Предупреждения не блокируют публикацию.</p>}
        <footer>
          <button type="button" className="pb-secondary-button" onClick={onClose}>Продолжить редактирование</button>
          <button type="button" className="pb-primary-button" onClick={onConfirm} disabled={errors.length > 0 || publishing}>{publishing ? 'Публикация…' : warnings.length ? 'Опубликовать с предупреждениями' : 'Опубликовать'}</button>
        </footer>
      </div>
    </dialog>
  );
}
